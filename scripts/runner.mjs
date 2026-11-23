import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { createInterface } from 'node:readline';
import { waitForOutput } from './subprocess.mjs';
import { InfrastructureError, assertNoInfrastructureFailure, requireAuditCompletion } from './infrastructure.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { manifest, cases, plan } from '../study/manifest.mjs';
import { uiContract } from '../study/ui-contract.mjs';
import { applyVariant } from './mutations.mjs';
import { reset, freshBrowser, acquireLock, clearBrowser, flushUIObservation, prepareUIAction } from './fixture.mjs';
import { runBaseline } from './baseline.mjs';
import { oracle } from './oracle.mjs';
import { classify } from './outcomes.mjs';
import { decodeVerdict, scenarioAssertions } from './verdict.mjs';
import { once } from 'node:events';
import { beginAttempt, snapshotWitness } from './witness.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const activeInputs = new Set();
const emit = value => {
  const ready = process.stdout.write(`${JSON.stringify(value)}\n`);
  if (!ready) for (const input of activeInputs) input.pause();
};
process.stdout.on('drain', () => { for (const input of activeInputs) input.resume(); });
const flushOutput = async () => { if (process.stdout.writableNeedDrain) await once(process.stdout, 'drain'); };
const args = new Set(process.argv.slice(2));
if (![...args].every(a => ['--pilot', '--campaign', '--plan', '--session-check'].includes(a))) throw new Error('Usage: runner.mjs --plan | --pilot | --campaign | --session-check');
const campaign = args.has('--campaign');
const sessionCheck = args.has('--session-check');
if (sessionCheck && campaign) throw new Error('The excluded session calibration cannot be a measured campaign');
const sessionTimeoutMs = process.env.STUDY_SESSION_TIMEOUT_MS ? Number(process.env.STUDY_SESSION_TIMEOUT_MS) : null;
if (sessionTimeoutMs !== null && (!sessionCheck || !Number.isInteger(sessionTimeoutMs) || sessionTimeoutMs < 100 || sessionTimeoutMs > 60000)) throw new Error('Session timeout override is restricted to excluded --session-check calibration (100–60000 ms)');
if (campaign && !args.has('--plan') && !manifest.campaignEnabled) throw new Error('Measured campaign is disabled pending the independent Evidence gate. Record its pass in Foundry and explicitly freeze/enable the reviewed code before running.');
const trials = sessionCheck ? [{ caseId: 'auth-login', condition: 'reference', repetition: 0, arm: 'runtime' }] : campaign ? plan() : plan(1).filter(t => manifest.pilotCells.some(p => p.caseId === t.caseId && p.condition === t.condition));
if (args.has('--plan')) { emit({ type: 'plan', campaignEnabled: manifest.campaignEnabled, pairedCells: trials.length / 2, executions: trials.length, runtimeAgentExecutions: trials.filter(t => t.arm === 'runtime').length, trials }); process.exit(0); }
if (!args.has('--pilot') && !campaign && !sessionCheck) throw new Error('Choose --plan, --pilot or --session-check explicitly');
const runBegan = Date.now();
if (campaign && !process.env.STUDY_DEADLINE_UTC) throw new Error('Set the original absolute STUDY_DEADLINE_UTC recorded in Foundry; restarting must not reset the one-day study budget');
const suppliedDeadline = process.env.STUDY_DEADLINE_UTC ? Date.parse(process.env.STUDY_DEADLINE_UTC) : runBegan + manifest.limits.maxRunMs;
if (!Number.isFinite(suppliedDeadline) || suppliedDeadline <= runBegan) throw new Error('The absolute study deadline is invalid or expired');
const deadline = Math.min(suppliedDeadline, runBegan + manifest.limits.maxRunMs);
const cliVersion = execFileSync('codex', ['--version'], { encoding: 'utf8' }).trim();
if (process.version !== manifest.nodeVersion) throw new Error(`Expected Node ${manifest.nodeVersion}, found ${process.version}`);
if (!cliVersion.includes(manifest.cliVersion)) throw new Error(`Expected Codex CLI ${manifest.cliVersion}, found ${cliVersion}`);
const feature = readFileSync(`${root}study/scenarios.feature`, 'utf8');
const featureHash = createHash('sha256').update(feature).digest('hex');
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const dirty = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim());
if (campaign && dirty) throw new Error('Measured campaign requires the exact clean, reviewed implementation commit');
const packageVersions = Object.fromEntries(['@cucumber/cucumber', '@playwright/mcp', 'playwright', 'acorn'].map(name => [name, JSON.parse(readFileSync(`${root}node_modules/${name}/package.json`, 'utf8')).version]));
emit({ type: 'run-start', measured: campaign, excludedFromStudy: !campaign, calibrationKind: sessionCheck ? 'agent-session-transport' : null, deadlineUtc: new Date(deadline).toISOString(), revision, dirty, manifest, featureHash, cliVersion, nodeVersion: process.version, packageVersions, constructionCost: { complete: false, reason: 'Shared infrastructure and initial agent-assisted implementation usage/time are not fully available; never impute zero.' } });
const unlock = acquireLock();
try {
  for (const trial of trials) {
    await flushOutput();
    if (deadline - Date.now() < manifest.limits.wallMs) throw new Error('Study deadline reached: insufficient time for another bounded cell; no restart or replacement');
    const started = performance.now();
    emit({ type: 'trial-start', ...trial, measured: campaign, excludedFromStudy: !campaign });
    const restore = applyVariant(trial.caseId, trial.condition);
    let browser;
    try {
      await restore.ready(); await reset(); browser = await freshBrowser();
      emit({ type: 'browser-ready', ...trial, browserVersion: browser.browserVersion, viewport: { width: 1280, height: 720 } });
      let initialBaseline = null, lastBaseline = null, agent = null;
      const ledger = [];
      if (trial.arm === 'maintained') {
        const remaining = manifest.limits.wallMs - (performance.now() - started) - 10000;
        if (remaining <= 0) throw new Error('Cell budget exhausted during fixture/browser preparation');
        initialBaseline = await runBaseline({ caseId: trial.caseId, endpoint: browser.endpoint, timeoutMs: Math.min(manifest.limits.scenarioMs, remaining) });
        initialBaseline.oracle = await observe(trial.caseId, browser);
        initialBaseline.outcome = classify({ healthy: !trial.condition.includes('fault'), status: initialBaseline.code === 0 ? 'pass' : 'fail', observation: initialBaseline.oracle, timedOut: initialBaseline.timedOut, assertionFailure: Boolean(initialBaseline.assertionFailures?.length), scenarioCount: initialBaseline.scenarioCount });
        lastBaseline = initialBaseline;
        emit({ type: 'baseline-initial', ...trial, ...initialBaseline });
      }
      if (trial.arm === 'runtime' || initialBaseline.code !== 0) {
        if (trial.arm === 'maintained') { await clearBrowser(browser.context); beginAttempt(browser.witness, 'diagnosis'); }
        agent = await runAgent(trial, browser, initialBaseline, ledger, sessionTimeoutMs ?? Math.max(1, manifest.limits.wallMs - (performance.now() - started) - 10000));
        for (const entry of ledger) if (entry.type === 'baseline-run') lastBaseline = entry;
      }
      const observation = trial.arm === 'maintained' ? lastBaseline.oracle : await observe(trial.caseId, browser);
      const reportedStatus = trial.arm === 'maintained' ? (lastBaseline.code === 0 ? 'pass' : 'fail') : agent?.reportedStatus || 'unresolved';
      const healthy = !trial.condition.includes('fault');
      const timedOut = Boolean(agent?.timedOut || lastBaseline?.timedOut);
      const assertionFailure = trial.arm === 'maintained' ? Boolean(lastBaseline.assertionFailures?.length) : Boolean(agent?.failedAssertionVerified);
      const outcome = classify({ healthy, status: reportedStatus, observation, modelVerified: !agent || agent.modelVerified, timedOut, assertionFailure, scenarioCount: lastBaseline?.scenarioCount ?? 1 });
      emit({ type: 'trial-end', ...trial, measured: campaign, excludedFromStudy: !campaign, elapsedMs: Math.round(performance.now() - started), initialScriptedElapsedMs: initialBaseline?.elapsedMs ?? null, repairAgentElapsedMs: trial.arm === 'maintained' ? agent?.elapsedMs ?? 0 : null, runtimeAgentElapsedMs: trial.arm === 'runtime' ? agent?.elapsedMs : null, modelInvoked: Boolean(agent), agent, reportedStatus, oracle: observation, expectedHealthy: healthy, assertionFailure, ...outcome, ledger, witnessHistory: browser.witness.history });
    } catch (error) {
      emit({ type: 'trial-error', ...trial, measured: campaign, excludedFromStudy: !campaign, elapsedMs: Math.round(performance.now() - started), error: error.stack, retries: 0 });
      // Infrastructure errors stop the fixed campaign; no concealed replacement trial.
      throw error;
    } finally { await browser?.close(); restore(); }
  }
} finally { try { await reset(); } finally { unlock(); } }
emit({ type: 'run-end', measured: campaign, excludedFromStudy: !campaign, executionCount: trials.length });

async function observe(caseId, browser) {
  let timer;
  const inspect = async () => {
    await flushUIObservation(browser.context, browser.witness);
    const witness = snapshotWitness(browser.witness);
    return { ...await oracle(caseId, browser.context, witness), attemptId: witness.attemptId, phase: witness.phase, witness };
  };
  return Promise.race([inspect(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Independent observer exceeded reserved ten-second budget')), 10000); })]).finally(() => clearTimeout(timer));
}

async function runAgent(trial, browser, initial, ledger, timeoutMs) {
  const endpoint = browser.endpoint;
  const workspace = mkdtempSync(join(tmpdir(), 'cucumber-study-agent-'));
  const socketPath = join(workspace, 'audit.sock');
  let agentProcess;
  let forceKillTimer;
  let executionTimeoutAt = null;
  const auditSessions = [];
  const auditSockets = new Set();
  const server = createServer(socket => {
    auditSockets.add(socket); socket.on('close', () => auditSockets.delete(socket));
    const session = { completed: false };
    session.closed = new Promise(resolve => socket.once('close', resolve));
    socket.on('error', error => { session.error = error.message; });
    auditSessions.push(session);
    activeInputs.add(socket); socket.on('close', () => activeInputs.delete(socket));
    const input = createInterface({ input: socket });
    input.on('line', async line => {
      const event = JSON.parse(line);
      if (event.type === 'host-request') {
        try {
          let result;
          if (event.method === 'begin-retained-attempt') result = { attemptId: beginAttempt(browser.witness, `retained-rerun-${event.arguments.attempt}`) };
          else if (event.method === 'prepare-ui-action') { await prepareUIAction(browser.context); result = { recorded: true }; }
          else if (event.method === 'observe-retained-attempt') result = await observe(trial.caseId, browser);
          else if (event.method === 'record-retained-result') {
            if (event.arguments?.type !== 'baseline-run') throw new Error('Invalid retained result');
            ledger.push(event.arguments);
            emit({ type: 'tool-event', ...trial, event: event.arguments });
            result = { recorded: true };
          }
          else if (event.method === 'report-infrastructure-failure') {
            const failure = { type: 'fatal-infrastructure', receivedAt: performance.now(), error: String(event.arguments?.error || 'Unspecified proxy infrastructure failure') };
            ledger.push(failure); emit({ type: 'tool-event', ...trial, event: failure });
            result = { recorded: true };
            // The private fatal record is retained before stopping the CLI.
            // A previous baseline result must never substitute for this rerun.
            setImmediate(() => { try { process.kill(-agentProcess.pid, 'SIGKILL'); } catch {} });
          }
          else if (event.method === 'proxy-complete') {
            if (event.arguments?.fatal) session.error = 'Browser proxy reported fatal termination';
            session.completed = true;
            result = { recorded: true };
          }
          else throw new Error('Unknown independent observer request');
          socket.write(`${JSON.stringify({ type: 'host-response', id: event.id, result })}\n`);
        } catch (error) { socket.write(`${JSON.stringify({ type: 'host-response', id: event.id, error: error.message })}\n`); }
        return;
      }
      ledger.push(event); emit({ type: 'tool-event', ...trial, event });
    });
  });
  await new Promise((resolve, reject) => server.listen(socketPath, resolve).once('error', reject));
  const scenario = feature.split(/(?=  @)/).find(block => block.startsWith(`  @${trial.caseId}\n`));
  if (!scenario) throw new Error('Frozen scenario not found');
  const assertions = scenarioAssertions(feature, trial.caseId);
  const featureContext = uiContract + '\n' + feature.split(/(?=  @)/)[0];
  const prompt = `Execute this application acceptance scenario using only the visible UI at http://localhost:3000. The application may work or have a defect. Preserve all expected behavior; never modify the application or assertions. Do not inspect hidden app internals, source, network responses or test fixtures. Complete all assertions, including reload checks. At most ${manifest.limits.toolCalls} tool calls and ${Math.round(timeoutMs / 1000)} seconds are available. No retries beyond those explicitly exposed by the tools.\n${featureContext}${scenario}\n${trial.arm === 'maintained' ? `The retained Cucumber test has already run once and failed. Diagnose with browser UI tools and baseline_read. Repair retained action implementations/locators if the UI contract still works. If behavior is defective, report fail without weakening the contract. Immutable Cucumber assertions are always rerun; at most two edits/two additional baseline_run calls. Initial run output:\n${initial.stdout}\n${initial.stderr}` : 'Interpret the scenario at runtime with the available browser UI tools. Do not create or reuse executable step definitions.'}\nEnd with JSON only: {"status":"pass"|"fail"|"unresolved","reason":"short observed evidence","failedAssertion":"exact frozen Then/And assertion text, or null on pass"}.`;
  const config = { mcpServers: { study: { command: process.execPath, args: [`${root}scripts/mcp-browser.mjs`], env: { STUDY_CDP_ENDPOINT: endpoint, STUDY_CASE_ID: trial.caseId, STUDY_ARM: trial.arm, STUDY_AUDIT_SOCKET: socketPath, STUDY_TOOL_LIMIT: String(manifest.limits.toolCalls), STUDY_INITIAL_ACTIONS: String(initial?.actions || 0) } } } };
  const cliArgs = ['-p', '--model', manifest.model, '--effort', 'high', '--restricted', '--tools', '', '--strict-mcp-config', '--mcp-config', JSON.stringify(config), '--setting-sources', '', '--disable-slash-commands', '--no-session-persistence', '--permission-mode', 'dontAsk', '--allowedTools', 'mcp__study__*', '--output-format', 'stream-json', '--verbose', prompt];
  const began = performance.now();
  try {
    {
      const child = spawn('claude', cliArgs, { cwd: workspace, env: { ...process.env, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', ANTHROPIC_MAX_RETRIES: '0' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
      agentProcess = child;
      activeInputs.add(child.stdout); child.stdout.on('close', () => activeInputs.delete(child.stdout));
      const models = new Set(); let final = null, stderr = '', timedOut = false, bytes = 0;
      const lines = createInterface({ input: child.stdout });
      lines.on('line', line => {
        bytes += line.length;
        if (bytes > 10000000) { process.kill(-child.pid, 'SIGTERM'); return; }
        try { const event = JSON.parse(line); if (event.message?.model) models.add(event.message.model); if (event.modelUsage) for (const model of Object.keys(event.modelUsage)) models.add(model); if (event.type === 'result') final = event; emit({ type: 'agent-event', ...trial, event }); }
        catch { emit({ type: 'agent-nonjson', ...trial, line }); }
      });
      child.stderr.on('data', data => { stderr += data; if (stderr.length > 1000000) process.kill(-child.pid, 'SIGTERM'); });
      const timer = setTimeout(() => { timedOut = true; executionTimeoutAt = performance.now(); emit({ type: 'agent-deadline', ...trial, at: executionTimeoutAt }); try { process.kill(-child.pid, 'SIGTERM'); } catch {} forceKillTimer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 3000); forceKillTimer.unref(); }, timeoutMs);
      const { code, signal } = await waitForOutput(child, { lines, onExit: () => clearTimeout(timer), onDrainTimeout: () => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} } }).finally(() => clearTimeout(timer));
      if (!timedOut) {
        if (code !== 0 || signal) throw new InfrastructureError(`Agent process ended abnormally: code=${code}, signal=${signal}`);
        try { await requireAuditCompletion(auditSessions); }
        catch (error) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} throw error; }
      }
      assertNoInfrastructureFailure(ledger, { timeoutAt: executionTimeoutAt });
      const verdict = decodeVerdict(final?.result, assertions);
      return { code, signal, timedOut, privateAuditComplete: auditSessions.length === 1 && auditSessions[0].completed && !auditSessions[0].error, elapsedMs: Math.round(performance.now() - began), requestedModel: manifest.model, actualModels: [...models], modelVerified: models.size > 0 && [...models].every(model => model === manifest.model), ...verdict, usage: final?.usage ?? null, modelUsage: final?.modelUsage ?? null, reportedCostUsd: final?.total_cost_usd ?? null, stderr, runnerRetries: 0, providerRetryLimit: 'ANTHROPIC_MAX_RETRIES=0 requested; internal provider transport behavior is not independently observable' };
    }
  } finally {
    clearTimeout(forceKillTimer);
    // Stop descendants even when the CLI exits before its timeout grace period.
    // They must not keep changing the fixture while the next cell starts.
    if (agentProcess?.pid) { try { process.kill(-agentProcess.pid, 'SIGKILL'); } catch {} }
    for (const socket of auditSockets) socket.destroy();
    server.close(); rmSync(workspace, { recursive: true, force: true });
  }
}
