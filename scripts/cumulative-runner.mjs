import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cases, manifest } from '../study/manifest.mjs';
import { requireDeadline } from '../study/campaign-config.mjs';
import { cumulativeConfig, cumulativeStages, cumulativeBudget } from '../study/cumulative-plan.mjs';
import { applyUIRevision } from './ui-revisions.mjs';
import { acquireLock, reset, freshBrowser, clearBrowser, flushUIObservation } from './fixture.mjs';
import { runBaseline } from './baseline.mjs';
import { runBrowserAgent } from './agent-session.mjs';
import { createMaintenanceState } from './maintenance.mjs';
import { beginAttempt, snapshotWitness } from './witness.mjs';
import { evaluateCalibration } from './scenario-evaluation.mjs';
import { normalizeAssertion, scenarioAssertions } from './verdict.mjs';
import { compactWitness } from './witness-encoding.mjs';
import { bounded, BudgetError } from './deadlines.mjs';
import { InfrastructureError } from './infrastructure.mjs';
import { sourcePins, appPins, samePins, verifyApproval, createTrialLedger, remainingBudget, recordDigest } from './campaign-guard.mjs';
import { environmentFingerprint, fixtureProvenance } from './environment.mjs';
export { sourcePins } from './campaign-guard.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const feature = readFileSync(root + 'study/scenarios.feature', 'utf8');
const publicResult = result => ({ code: result.code, scenarioCount: result.scenarioCount, timedOut: result.timedOut,
  actions: result.actions, elapsedMs: result.elapsedMs, failures: result.stepFailures || [], stderr: result.stderr,
  ...(result.scenarioCount !== 1 ? { stdout: result.stdout } : {}) });

export async function runValidationSuite({ browser, state, emit, signal, deadline }) {
  const validation = state.validation(), results = [];
  emit({ type: 'validation-begin', ...validation, browserPolicy: 'one shared browser process; fresh pages/storage/cache and exact seed per scenario' });
  try {
  for (const item of cases) {
    if (signal?.aborted || Date.now() >= deadline) throw new BudgetError('Maintenance deadline reached');
    let baseline, observation;
    try {
      await bounded('Validation case', async caseSignal => {
        await clearBrowser(browser.context, { clearCache: true }); await reset({ signal: caseSignal });
        beginAttempt(browser.witness, `maintenance-validation-${validation.number}/${item.id}`);
        browser.witness.eventLimit = 2000;
        baseline = await runBaseline({ caseId: item.id, endpoint: browser.endpoint, ...validation.implementation,
          timeoutMs: Math.min(cumulativeConfig.retainedWallMs, Math.max(1, deadline - Date.now())), actionLimit: 80, signal: caseSignal });
        if (caseSignal.aborted) throw new BudgetError('Maintenance deadline reached');
        if (baseline.privateCaptureFailed) throw new InfrastructureError('Cucumber private observation failed');
        if (!baseline.timedOut && (baseline.scenarioCount !== 1 || baseline.stepFailures.some(f => !f.step))) throw new InfrastructureError('Cucumber scenario/hook infrastructure failed');
        await flushUIObservation(browser.context, browser.witness);
        const witness = snapshotWitness(browser.witness);
        observation = evaluateCalibration({ caseId: item.id, revision: validation.revision, sourcePins: sourcePins(), witness }, feature);
        emit({ type: 'validation-case', validation: validation.number, revision: validation.revision, caseId: item.id,
          implementationSHA: validation.implementation.sha256, baseline, observation, witness: compactWitness(witness) });
      }, { deadline: Math.min(deadline, Date.now() + cumulativeConfig.retainedWallMs + cumulativeConfig.fixtureEnvelopeMs), signal, terminate: () => browser.terminate() });
    } catch (caught) {
      emit({ type: 'validation-case-error', validation: validation.number, revision: validation.revision, caseId: item.id,
        implementationSHA: validation.implementation.sha256, baseline, error: caught.message, errorCode: caught.code, witness: compactWitness(snapshotWitness(browser.witness)) });
      throw caught;
    }
    results.push({ caseId: item.id, ...publicResult(baseline) });
  }
  if (!signal?.aborted && Date.now() < deadline) {
    await bounded('Validation diagnosis reset', async resetSignal => {
      await clearBrowser(browser.context, { clearCache: true }); await reset({ signal: resetSignal });
      beginAttempt(browser.witness, 'maintenance-diagnosis'); browser.witness.eventLimit = 40000;
      const page = await browser.context.newPage(); await page.goto('http://localhost:3000/signin', { timeout: 10000 });
    }, { deadline: Math.min(deadline, Date.now() + 30000), signal, terminate: () => browser.terminate() });
  }
  return { validation: validation.number, implementationSHA: validation.implementation.sha256,
    complete: results.length === cases.length, cases: results };
  } catch (error) {
    if (error.code === 'STUDY_UNQUIESCENT') { browser.quiescenceFailed = true; state.poison(error.message); throw error; }
    if (signal?.aborted || Date.now() >= deadline) throw new BudgetError('Maintenance deadline reached');
    state.poison(error.message);
    emit({ type: 'validation-private-infrastructure', validation: validation.number, error: error.message });
    throw new InfrastructureError('Shared validation infrastructure failed');
  }
}

export async function runMaintenance({ revision, from, state, emit, registerInput = () => {}, wallMs = cumulativeConfig.maintenanceWallMs, model = true,
  absoluteDeadline, verifyInputs = () => {}, verifyEnvironment = async () => {} }) {
  if (!Number.isFinite(absoluteDeadline)) throw new Error('An absolute campaign deadline is required (campaign configuration)');
  const began = Date.now(), deadline = Math.min(began + wallMs, absoluteDeadline - cumulativeConfig.finalizationReserveMs - cumulativeConfig.maintenanceCleanupMs);
  const cleanupDeadline = Math.min(deadline + cumulativeConfig.maintenanceCleanupMs, absoluteDeadline - cumulativeConfig.finalizationReserveMs);
  let restore, browser, initialValidation, agent, error, budgetExpired = false, quiescent = true;
  state.begin(revision, from);
  try {
    await bounded('Shared maintenance', async signal => {
    await verifyEnvironment(signal);
    restore = applyUIRevision('auth-login', revision); const activeApp = appPins();
    await restore.ready({ signal, deadline }); await reset({ signal });
    browser = await freshBrowser({ observerVersion: revision, witnessLimits: { eventLimit: 40000, historyLimit: 120000 }, signal, deadline });
    initialValidation = await runValidationSuite({ browser, state, emit, signal, deadline });
    if (model && !signal.aborted && Date.now() < deadline) {
      agent = await runBrowserAgent({ mode: 'maintenance', revision, browser, timeoutMs: deadline - Date.now(), toolCalls: cumulativeConfig.maintenanceToolCalls,
        initialValidation, emit, registerInput, signal, handleMaintenance: async (method, args, sessionSignal) => {
          if (signal.aborted || sessionSignal.aborted || Date.now() >= deadline) throw new BudgetError('Maintenance deadline reached');
          try { verifyInputs({ active: true }); samePins(appPins(), activeApp, 'Active application'); }
          catch (error) { state.poison(error.message); throw new InfrastructureError('Frozen maintenance inputs changed'); }
          if (method === 'maintenance-read') {
            const current = state.read();
            return { actions: current.actions, locators: current.selectors, sha256: current.sha256, limits: current.phase,
              immutableAssertions: readFileSync(root + 'study/steps.mjs', 'utf8') };
          }
          if (method === 'maintenance-repair') return state.repair(args);
          if (method === 'maintenance-validate') return runValidationSuite({ browser, state, emit,
            signal: AbortSignal.any([signal, sessionSignal]), deadline });
          throw new Error('Unknown shared maintenance request');
        } });
    }
    verifyInputs({ active: true }); samePins(appPins(), activeApp, 'Active application');
    await verifyEnvironment(signal);
    }, { deadline, terminate: () => browser?.terminate() });
  } catch (caught) {
    budgetExpired = caught.code === 'STUDY_BUDGET'; if (!budgetExpired) error = caught.message;
    if (caught.code === 'STUDY_UNQUIESCENT') quiescent = false;
    emit({ type: 'maintenance-error', revision, error: caught.message, errorCode: caught.code, budgetExpired });
  }
  finally {
    if (browser?.quiescenceFailed) quiescent = false;
    try { await bounded('Maintenance browser cleanup', () => browser?.close(), { deadline: cleanupDeadline, terminate: () => browser?.terminate() }); }
    catch (caught) { error = [error, caught.message].filter(Boolean).join('; '); quiescent = false; }
    if (quiescent) try { restore?.(); verifyInputs({ active: false }); }
    catch (caught) { error = [error, 'Source cleanup: ' + caught.message].filter(Boolean).join('; '); }
  }
  const frozen = state.finish(error ? 'infrastructure or session error; latest accepted candidate retained' : budgetExpired ? 'maintenance deadline; latest accepted candidate retained' : 'session ended; latest accepted candidate retained');
  const result = { revision, from, elapsedMs: Date.now() - began, initialValidation, agent, error, frozen,
    budgetExpired, quiescent, noModelUsed: !model, constructorCost: 'unmeasured; never imputed zero' };
  emit({ type: 'maintenance-record', ...result }); return result;
}

export async function runTrial({ trial, state, emit, registerInput = () => {}, absoluteDeadline, verifyInputs = () => {}, verifyEnvironment = async () => {} }) {
  if (!Number.isFinite(absoluteDeadline)) throw new Error('An absolute campaign deadline is required (campaign configuration)');
  const began = Date.now(), frozen = state.frozen(trial.revision), cap = trial.arm === 'runtime' ? cumulativeConfig.runtimeWallMs : cumulativeConfig.retainedWallMs;
  const cleanupDeadline = Math.min(began + cap + cumulativeConfig.fixtureEnvelopeMs, absoluteDeadline - cumulativeConfig.finalizationReserveMs);
  let restore, browser, baseline, agent, observation, witness, error, quiescent = true;
  emit({ type: 'trial-start', trial, implementationSHA: frozen.sha256, sourcePins: sourcePins() });
  try {
    await bounded('Trial operations', async signal => {
    let activeApp;
    await bounded('Trial setup', async setupSignal => {
      await verifyEnvironment(setupSignal);
      restore = applyUIRevision(trial.caseId, trial.revision, { fault: trial.fault }); activeApp = appPins();
      await restore.ready({ signal: setupSignal, deadline: began + cumulativeConfig.fixtureSetupMs }); await reset({ signal: setupSignal });
      // Keep the total-operation signal after setup returns.
      browser = await freshBrowser({ observerVersion: trial.revision, signal, deadline: began + cumulativeConfig.fixtureSetupMs });
    }, { deadline: began + cumulativeConfig.fixtureSetupMs, signal, terminate: () => browser?.terminate() });
    if (trial.arm === 'maintained') baseline = await runBaseline({ caseId: trial.caseId, endpoint: browser.endpoint,
      ...frozen, timeoutMs: cumulativeConfig.retainedWallMs, actionLimit: 80, signal });
    else agent = await runBrowserAgent({ mode: 'runtime', caseId: trial.caseId, revision: trial.revision, browser,
      timeoutMs: cumulativeConfig.runtimeWallMs, toolCalls: 80, emit, registerInput, signal });
    // Requested model/CLI/usage retained; absent response identity is a disclosed limitation.
    if (baseline?.privateCaptureFailed) throw new InfrastructureError('Cucumber private observation failed');
    verifyInputs({ active: true }); samePins(appPins(), activeApp, 'Active application');
    await verifyEnvironment(signal);
    if (baseline && !baseline.timedOut && (baseline.scenarioCount !== 1 || baseline.stepFailures.some(f => !f.step))) throw new InfrastructureError('Cucumber scenario/hook infrastructure failed');
    await flushUIObservation(browser.context, browser.witness); witness = snapshotWitness(browser.witness);
    observation = evaluateCalibration({ caseId: trial.caseId, revision: trial.revision, sourcePins: sourcePins(), witness }, feature);
    }, { deadline: cleanupDeadline - 12000, terminate: () => browser?.terminate() });
  } catch (caught) { error = caught.message; if (caught.code === 'STUDY_UNQUIESCENT') quiescent = false; if (browser) witness = snapshotWitness(browser.witness); }
  finally {
    if (browser?.quiescenceFailed) quiescent = false;
    try { await bounded('Trial browser cleanup', () => browser?.close(), { deadline: cleanupDeadline, terminate: () => browser?.terminate() }); }
    catch (caught) { error = [error, caught.message].filter(Boolean).join('; '); quiescent = false; }
    if (quiescent) try { restore?.(); verifyInputs({ active: false }); }
    catch (caught) { error = [error, 'Source cleanup: ' + caught.message].filter(Boolean).join('; '); }
  }
  if (state.frozen(trial.revision).sha256 !== frozen.sha256) throw new Error('Frozen implementation changed during a probe');
  const assertions = scenarioAssertions(feature, trial.caseId);
  const failed = baseline?.assertionFailures.map(f => normalizeAssertion(f.step)).find(a => assertions.includes(a));
  const record = { trial, trialId: trial.id, implementationSHA: frozen.sha256, elapsedMs: Date.now() - began, baseline, agent, observation, witness: compactWitness(witness), quiescent,
    error, reportedStatus: baseline ? baseline.code === 0 ? 'pass' : 'fail' : agent?.reportedStatus || 'unresolved',
    failedAssertion: baseline ? failed || null : agent?.normalizedFailedAssertion || null,
    analysisStatus: 'pending-independent-actor-visible-and-seeded-fault-adjudication' };
  record.recordSHA = recordDigest(record);
  emit({ type: 'trial-record', ...record }); return record;
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 1 || !['--plan', '--campaign', '--technical-maintenance'].includes(argv[0])) throw new Error('Choose --plan, --campaign or --technical-maintenance');
  const stages = cumulativeStages();
  const ledger = createTrialLedger(stages);
  if (argv[0] === '--plan') { console.log(JSON.stringify({ type: 'cumulative-plan', config: cumulativeConfig, budget: process.env.STUDY_DEADLINE_UTC ? cumulativeBudget(Date.now(), requireDeadline(process.env.STUDY_DEADLINE_UTC)) : null, stages })); return; }
  const deadlineIso = requireDeadline(process.env.STUDY_DEADLINE_UTC);
  let approval, installedEnvironment, provenance;
  if (argv[0] === '--campaign') {
    if (!cumulativeConfig.campaignEnabled) throw new Error('Cumulative campaign disabled: fresh independent Evidence approval and reviewed enabling commit required');
    if (!cumulativeBudget(Date.now(), deadlineIso).feasibleUnderEnvelopes) throw new Error('Full216trial worst-case envelope no longer fits the original deadline');
    if (execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()) throw new Error('A clean frozen checkout is required');
    if (process.version !== manifest.nodeVersion || !execFileSync('codex', ['--version'], { encoding: 'utf8' }).includes(manifest.cliVersion)) throw new Error('Pinned runtime versions differ');
    await bounded('Installed environment preflight', async signal => {
      installedEnvironment = await environmentFingerprint({ signal }); provenance = await fixtureProvenance({ signal });
      samePins(installedEnvironment, provenance.startupEnvironment, 'Running fixture dependencies');
      samePins(appPins(), provenance.startupApp, 'Running fixture startup source');
      if (provenance.wrapperSHA !== sourcePins()['scripts/app.mjs']) throw new Error('Running fixture wrapper source differs');
      approval = verifyApproval(JSON.parse(process.env.STUDY_APPROVAL_JSON || 'null'), { environment: installedEnvironment, deadline: deadlineIso });
    }, { deadline: Date.now() + 45000 });
  }
  const unlock = acquireLock(), inputs = new Set();
  const registerInput = input => { inputs.add(input); input.once('close', () => inputs.delete(input)); };
  const emit = event => { if (event.type === 'trial-record') ledger.emitted(event); if (!process.stdout.write(JSON.stringify(event) + '\n')) for (const input of inputs) input.pause(); };
  process.stdout.on('drain', () => { for (const input of inputs) input.resume(); });
  const state = createMaintenanceState({ emit, maxEdits: cumulativeConfig.maintenanceEdits, maxValidations: cumulativeConfig.maintenanceSuites });
  const frozenSourcePins = JSON.stringify(sourcePins());
  const initialAppPins = appPins(), absoluteDeadline = Date.parse(deadlineIso);
  const verifyInputs = ({ active = false } = {}) => {
    if (JSON.stringify(sourcePins()) !== frozenSourcePins) throw new Error('Frozen study source changed during the campaign');
    if (!active) {
      samePins(appPins(), initialAppPins, 'Restored application');
      if (approval) verifyApproval(approval, { environment: installedEnvironment, deadline: deadlineIso });
    }
  };
  const verifyEnvironment = async signal => {
    if (!approval) return;
    samePins(await environmentFingerprint({ signal }), installedEnvironment, 'Executed dependency contents');
    const current = await fixtureProvenance({ signal });
    samePins(current, provenance, 'Owned fixture process provenance');
  };
  const admit = (stageIndex, trialIndex = 0) => {
    verifyInputs();
    if (Date.now() + remainingBudget(stages, stageIndex, trialIndex) > absoluteDeadline) throw new BudgetError('Full remaining schedule no longer fits the original deadline');
  };
  let completed = 0, quiescent = true, stopReason = null;
  try {
    emit({ type: 'campaign-start', excludedFromStudy: argv[0] !== '--campaign', config: cumulativeConfig, deadline: deadlineIso, sourcePins: sourcePins(), appPins: initialAppPins, installedEnvironment, provenance, approval, initial: state.frozen('v0') });
    if (argv[0] === '--technical-maintenance') {
      const record = await runMaintenance({ revision: 'v1', from: 'v0', state, emit, registerInput, wallMs: 180000, model: false, absoluteDeadline, verifyInputs });
      quiescent = record.quiescent; if (record.error) throw new Error(record.error);
      emit({ type: 'technical-maintenance-complete', excludedFromStudy: true, frozen: state.frozen('v1') }); return;
    }
    for (let stageIndex = 0; stageIndex < stages.length; stageIndex++) {
      const stage = stages[stageIndex]; admit(stageIndex);
      if (stage.kind === 'maintenance') {
        const phase = await runMaintenance({ ...stage, state, emit, registerInput, absoluteDeadline, verifyInputs, verifyEnvironment });
        quiescent = phase.quiescent; verifyInputs();
        if (phase.error || !phase.agent?.modelVerified || phase.elapsedMs > cumulativeConfig.maintenanceWallMs + cumulativeConfig.maintenanceCleanupMs) throw new Error('Shared maintenance was infrastructure/model invalid or exceeded its cleanup envelope');
      }
      else for (let trialIndex = 0; trialIndex < stage.trials.length; trialIndex++) {
        const trial = stage.trials[trialIndex]; admit(stageIndex, trialIndex);
        const cap = trial.arm === 'runtime' ? cumulativeConfig.runtimeWallMs : cumulativeConfig.retainedWallMs;
        if (absoluteDeadline - Date.now() < cap + cumulativeConfig.fixtureEnvelopeMs + cumulativeConfig.finalizationReserveMs) throw new Error('Insufficient original-deadline budget for the next nominal trial');
        ledger.start(trial.id);
        const record = await runTrial({ trial, state, emit: event => emit({ ...event, trialId: trial.id }), registerInput, absoluteDeadline, verifyInputs, verifyEnvironment });
        quiescent = record.quiescent;
        ledger.record(trial.id, record, state.frozen(trial.revision).sha256); completed++; verifyInputs();
        if (!quiescent || record.error) throw new Error(record.error || 'Trial did not quiesce');
        if (record.agent && !record.agent.modelVerified) throw new Error('Runtime model differs from the frozen requested model');
        if (record.elapsedMs > cap + cumulativeConfig.fixtureEnvelopeMs) throw new Error('A trial exceeded its total envelope; stop rather than overlap unfinished work');
      }
    }
    verifyInputs(); ledger.finish(revision => state.frozen(revision).sha256);
    emit({ type: 'campaign-complete', nominalTrials: 216, completedTrials: completed, analysisStatus: 'pending-independent-adjudication' });
  } catch (error) { stopReason = error.message; ledger.stop(stopReason); emit({ type: 'campaign-stopped', completedTrials: completed, nominalTrials: 216, error: error.stack }); process.exitCode = 1; }
  finally {
    emit({ type: 'terminal-trial-ledger', excludedFromStudy: argv[0] !== '--campaign', nominalTrials: 216, stopReason, entries: ledger.snapshot() });
    if (quiescent) {
      try { await bounded('Final seed restoration', signal => reset({ signal }), { deadline: Math.min(absoluteDeadline, Date.now() + 20000) }); verifyInputs(); }
      catch (error) { quiescent = false; emit({ type: 'finalization-error', error: error.message }); process.exitCode = 1; }
      finally { if (quiescent) unlock(); else emit({ type: 'fixture-lock-retained', reason: 'Final seed restoration was not acknowledged; no fixture reuse is permitted' }); }
    } else emit({ type: 'fixture-lock-retained', reason: 'Unsettled work; no fixture reset or reuse is permitted' });
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
