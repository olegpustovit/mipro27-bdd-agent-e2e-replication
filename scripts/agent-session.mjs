import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { manifest } from '../study/manifest.mjs';
import { uiContract } from '../study/ui-contract.mjs';
import { prepareUIAction } from './fixture.mjs';
import { waitForOutput } from './subprocess.mjs';
import { InfrastructureError, assertNoInfrastructureFailure, requireAuditCompletion } from './infrastructure.mjs';
import { decodeVerdict, scenarioAssertions } from './verdict.mjs';
import { bounded } from './deadlines.mjs';
import { requestedModel, ompUsage, ompFinal } from './codex-boundary.mjs';
import { createBrowserBridge } from './mcp-http-bridge.mjs';
import { loadDriver, driverNameForModel, collectRequestIds } from './drivers/index.mjs';
import { claudeResult } from './drivers/claude-code.mjs';
import { meter } from './ledger/metering.mjs';
const driverPromise = loadDriver(driverNameForModel(requestedModel));
let driverInputs; // CLI version and model id are fixed for the process.
const frozenDriver = () => driverInputs ??= driverPromise.then(driver => driver.frozenInputs());
const root = fileURLToPath(new URL('../', import.meta.url));

export async function runBrowserAgent({ mode = 'runtime', caseId, revision, browser, timeoutMs,
  toolCalls = 80, initialValidation = null, handleMaintenance, emit = () => {}, registerInput = () => {}, signal: parentSignal }) {
  if (!['runtime', 'maintenance'].includes(mode) || !Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid browser agent session');
  const feature = readFileSync(root + 'study/scenarios.feature', 'utf8');
  const scenario = mode === 'runtime' ? feature.split(/(?=  @)/).find(block => block.startsWith(`  @${caseId}\n`)) : feature;
  if (!scenario) throw new Error('Frozen scenario not found');
  const assertions = mode === 'runtime' ? scenarioAssertions(feature, caseId) : [];
  const workspace = mkdtempSync(join(tmpdir(), 'cumulative-agent-')), socketPath = join(workspace, 'audit.sock');
  const controller = new AbortController(), sockets = new Set(), sessions = [], tasks = new Set(), ledger = [];
  let child, forceKillTimer, timedOut = false, timeoutAt = null;
  const kill = signal => { if (child?.pid) try { process.kill(-child.pid, signal); } catch {} };
  const expire = () => {
    if (timedOut) return;
    timedOut = true; timeoutAt = performance.now(); controller.abort(); emit({ type: 'agent-deadline', at: timeoutAt }); kill('SIGTERM');
    forceKillTimer = setTimeout(() => kill('SIGKILL'), 3000); forceKillTimer.unref();
  };
  const server = createServer(socket => {
    sockets.add(socket); registerInput(socket);
    const session = { completed: false, closed: new Promise(resolve => socket.once('close', resolve)) }; sessions.push(session);
    socket.on('close', () => { sockets.delete(socket); if (!session.completed) { controller.abort(); kill('SIGKILL'); } }); socket.on('error', error => session.error = error.message);
    createInterface({ input: socket }).on('line', line => {
      const task = (async () => {
        const event = JSON.parse(line);
        if (event.type === 'host-cancel') { controller.abort(); kill('SIGKILL'); return; }
        if (event.type !== 'host-request') { ledger.push(event); emit({ type: 'tool-event', event }); return; }
        try {
          let result;
          if (event.method === 'prepare-ui-action') {
            if (controller.signal.aborted) throw new Error('Session has ended');
            try { await prepareUIAction(browser.context); } catch (error) { throw new InfrastructureError(error.message); }
            result = { recorded: true };
          } else if (event.method.startsWith('maintenance-') && mode === 'maintenance') {
            if (controller.signal.aborted) throw new Error('Session has ended');
            result = await handleMaintenance(event.method, event.arguments, controller.signal);
          } else if (event.method === 'report-infrastructure-failure') {
            const failure = { type: 'fatal-infrastructure', receivedAt: performance.now(), error: String(event.arguments?.error || 'Proxy failure') };
            ledger.push(failure); emit({ type: 'tool-event', event: failure }); result = { recorded: true };
            setImmediate(() => { controller.abort(); kill('SIGKILL'); });
          } else if (event.method === 'proxy-complete') {
            if (event.arguments?.fatal) session.error = 'Proxy reported fatal termination';
            session.completed = true; result = { recorded: true };
          } else throw new Error('Unknown private host request');
          if (!socket.destroyed) socket.write(JSON.stringify({ id: event.id, result }) + '\n');
        } catch (error) {
          if (error.code === 'STUDY_UNQUIESCENT') browser.quiescenceFailed = true;
          const fatal = error.code === 'STUDY_INFRASTRUCTURE' || error.code === 'STUDY_UNQUIESCENT';
          if (fatal) { ledger.push({ type: 'fatal-infrastructure', receivedAt: performance.now(), error: error.message }); emit({ type: 'private-host-infrastructure', error: error.message }); }
          if (!socket.destroyed) socket.write(JSON.stringify({ id: event.id, error: fatal ? 'Shared host infrastructure failed' : error.message, fatal }) + '\n');
          if (fatal) setImmediate(() => { controller.abort(); kill('SIGKILL'); });
        }
      })();
      tasks.add(task); task.catch(error => { emit({ type: 'host-handler-error', error: error.message }); controller.abort(); kill('SIGKILL'); }).finally(() => tasks.delete(task));
    });
  });
  await new Promise((resolve, reject) => server.listen(socketPath, resolve).once('error', reject));
  const prompt = mode === 'runtime'
    ? `Execute this application acceptance scenario through the browser UI at http://localhost:3000. It may work or contain a defect. Preserve all required outcomes; do not modify the application, inspect source/network responses/private state or create executable step definitions. Use at most ${toolCalls} tool calls and ${Math.floor(timeoutMs / 1000)} seconds.\n${uiContract}\n${feature.split(/(?=  @)/)[0]}${scenario}\nEnd with JSON only: {"status":"pass"|"fail"|"unresolved","reason":"observed evidence","failedAssertion":"exact frozen Then/And assertion, or null on pass"}.`
    : `Maintain a shared reusable Cucumber implementation against this healthy UI release. This phase contains no injected product faults. Use baseline_read and UI tools to diagnose, baseline_repair to update shared actions/locator values, and baseline_validate for all12scenarios. Scenarios and what each assertion means are immutable, but every locator VALUE is yours to repair, including locators that assertions read such as signedIn: if an assertion's element moved or was renamed, change that locator's selector to the element showing the same thing. Do not stop while a failure can be repaired and limits remain. Repairs carry forward; up to 10 accepted edits and 12 suites including the initial diagnostic suite. One edit may change many locators and actions at once, so batch your fixes. Each UI mutation must return one primitive in its own awaited World.act. You may use semantic page.getByRole calls for menus/dialogs without adding locator keys. Never weaken outcomes or inspect application source/network/private state. Up to ${toolCalls} tool calls and ${Math.floor(timeoutMs / 1000)} seconds. The latest accepted artifact is frozen when time ends, even if incomplete; no best-score selection. Validation resets data/browser state and closes current pages; obtain a new snapshot afterwards.\n${uiContract}\n${feature}\nInitial actual Cucumber results:\n${JSON.stringify(initialValidation)}\nFinish with a brief explanation of completed work and unresolved failures.`;
  const bridge = await createBrowserBridge({proxyPath:root+'scripts/mcp-browser.mjs',env:{...process.env,
    STUDY_CDP_ENDPOINT:browser.endpoint,STUDY_ARM:'runtime',STUDY_CASE_ID:caseId||'auth-login',
    STUDY_MAINTENANCE:mode==='maintenance'?'1':'0',STUDY_AUDIT_SOCKET:socketPath,STUDY_TOOL_LIMIT:String(toolCalls)}});
  const driver = await driverPromise;
  const boundary = driver.prepare({endpoint:bridge.endpoint,prompt});
  let bridgeClosed=false;
  const began = performance.now();
  try {
    child = spawn(boundary.command, boundary.args, { cwd: workspace, env: { PATH:process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    parentSignal?.addEventListener('abort', expire, { once: true }); if (parentSignal?.aborted) expire();
    registerInput(child.stdout);
    const models = new Set(), requestIds = new Set(); let final = null, stderr = '', bytes = 0;
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      bytes += line.length; if (bytes > 10000000) { controller.abort(); kill('SIGKILL'); return; }
      try {
        const event = JSON.parse(line);
        if (event.message?.model) models.add(event.message.model);
        if (event.modelUsage) for (const model of Object.keys(event.modelUsage)) models.add(model);
        if(event.type==='item.completed' && event.item?.type==='agent_message') final={...(final||{}),result:event.item.text};
        if(event.type==='turn.completed') final={...(final||{}),usage:event.usage};
        if(driver.name === 'omp' && event.type==='agent_end') { const {usage,cost}=ompUsage(event.messages||[]), end=ompFinal(event.messages||[]); final={...(final||{}),usage,total_cost_usd:cost,result:end.result,providerError:end.error}; }
        if (driver.name === 'claude-code' && event.type === 'result') final = claudeResult(event);
        for (const id of collectRequestIds([event])) requestIds.add(id);
        emit({ type: 'agent-event', event });
      } catch { emit({ type: 'agent-nonjson', line }); }
    });
    child.stderr.on('data', data => { stderr += data; if (stderr.length > 1000000) { controller.abort(); kill('SIGKILL'); } });
    const timer = setTimeout(expire, timeoutMs);
    const { code, signal } = await waitForOutput(child, { lines, onExit: () => clearTimeout(timer), onDrainTimeout: () => kill('SIGKILL') }).finally(() => clearTimeout(timer));
    const proxyExit=await bridge.close(); bridgeClosed=true; emit({type:'proxy-exit',...proxyExit});
    for(const path of readdirSync(boundary.home,{recursive:true}).filter(p=>p.endsWith('.jsonl'))) {
      for(const line of readFileSync(boundary.home+'/'+path,'utf8').trim().split('\n')) {try {const e=JSON.parse(line); if(e.payload?.model)models.add(e.payload.model);for(const id of collectRequestIds([e]))requestIds.add(id);emit({type:'codex-rollout',event:e});}catch{}}
    }
    if (!timedOut) {
      if (code !== 0 || signal) throw new InfrastructureError(`Agent process ended abnormally: code=${code}, signal=${signal}`);
      if (final?.providerError) throw new InfrastructureError(`Model provider error: ${final.providerError}`);
      await requireAuditCompletion(sessions);
    }
    assertNoInfrastructureFailure(ledger, { timeoutAt });
    const verdict = mode === 'runtime' ? decodeVerdict(final?.result, assertions) : { rawResponse: final?.result ?? null };
    return { code, signal, timedOut, elapsedMs: Math.round(performance.now() - began), requestedModel,
      actualModels: [...models], modelVerified: models.size > 0 && [...models].every(model => model === requestedModel),
      privateAuditComplete: sessions.length === 1 && sessions[0].completed && !sessions[0].error,
      driver: await frozenDriver(), requestIds: [...requestIds],
      // Per-trial cost metering; unknown counters stay null. The model/browser/fixture wall split is not instrumented here.
      meter: meter({ usage: final?.usage, costUsd: final?.total_cost_usd, wall: { totalMs: Math.round(performance.now() - began) } }),
      ...verdict, usage: final?.usage ?? null, modelUsage: final?.modelUsage ?? null, reportedCostUsd: final?.total_cost_usd ?? null,
      stderr, runnerRetries: 0, ledger };
  } finally {
    parentSignal?.removeEventListener('abort', expire);
    controller.abort(); clearTimeout(forceKillTimer); kill('SIGKILL');
    if(!bridgeClosed) await bridge.close(); boundary.cleanup();
    // A timeout must drain validation work before another stage can reset data.
    for (const socket of sockets) socket.destroy();
    try { await bounded('Host work settlement', () => Promise.allSettled([...tasks]), { deadline: Date.now() + 8000, terminate: () => browser.terminate() }); }
    catch (error) { browser.quiescenceFailed = true; throw error; }
    finally { server.close(); rmSync(workspace, { recursive: true, force: true }); }
  }
}
