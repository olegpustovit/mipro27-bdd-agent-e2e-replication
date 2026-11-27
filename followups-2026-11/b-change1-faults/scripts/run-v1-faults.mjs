// Stream B follow-up (2026-11-26): faulty builds on the change-1 (v1) interface.
// A copy of harness/scripts/exploratory-runner.mjs (replication commit 9c9eee2) with three changes, marked FOLLOWUP-B:
//  1. stages come from ./v1-fault-plan.mjs (healthy-v1-1 environment check, fault-v1-1, fault-v1-2), not exploratoryStages();
//  2. STUDY_ARMS (maintained|runtime) selects the arm; the maintained arm runs campaign A's frozen v1 step code
//     restored from STUDY_RUNTIME_RERUN_FROM (no maintenance session runs);
//  3. the runner's own file hashes are recorded in the frozen inputs.
// Everything else (trial execution, journal, ledger, invalid handling, never re-running a finished trial) is unchanged.
// Explicit owner-directed path.  It must never call verifyApproval or enable
// the approved campaign; records remain exploratory even if a gate later passes.
import { existsSync, mkdirSync, readFileSync, openSync, writeSync, fsyncSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { exploratoryConfig, exploratoryStages } from '../harness/study/exploratory-plan.mjs';
import { v1FaultStages, followupArms } from './v1-fault-plan.mjs'; // FOLLOWUP-B
import { sourcePins, appPins, samePins } from '../harness/scripts/campaign-guard.mjs';
import { runMaintenance, runTrial } from '../harness/scripts/cumulative-runner.mjs';
import { createMaintenanceState } from '../harness/scripts/maintenance.mjs';
import { acquireLock, reset } from '../harness/scripts/fixture.mjs';
import { bounded } from '../harness/scripts/deadlines.mjs';
import { environmentFingerprint, fixtureProvenance } from '../harness/scripts/environment.mjs';
import { dataDir, ledgerPaths, ensureDirs } from '../harness/scripts/ledger/paths.mjs';
import { requireDeadline } from '../harness/study/campaign-config.mjs';
import { blockedOrder, planTrials, startTrial, endTrial, reconcileEnded } from '../harness/scripts/ledger/trials.mjs';
import { trialKey } from '../harness/scripts/ledger/keys.mjs';
import { requestedModel } from '../harness/scripts/codex-boundary.mjs';
import { loadDriver, driverNameForModel } from '../harness/scripts/drivers/index.mjs';

const root = fileURLToPath(new URL('../harness/', import.meta.url)); // FOLLOWUP-B: harness checkout
const followupFiles = ['run-v1-faults.mjs', 'v1-fault-plan.mjs'].map(name => [name, createHash('sha256').update(readFileSync(new URL('./' + name, import.meta.url))).digest('hex')]); // FOLLOWUP-B
const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const now = () => new Date().toISOString();
const append = (path, value) => { const fd = openSync(path, 'a', 0o600); try { writeSync(fd, JSON.stringify(value) + '\n'); fsyncSync(fd); } finally { closeSync(fd); } };
const appendText = (path, text) => { const fd = openSync(path, 'a', 0o600); try { writeSync(fd, text + '\n'); fsyncSync(fd); } finally { closeSync(fd); } };
// Progress/status logs live in the study data dir (never /tmp, which is cleared).
const progress = (id, arm, state) => appendText(join(ensureDirs().logs, 'cucumber-study-progress.log'), `${now()} ${id} ${arm} ${state}`);
const status = text => appendText(join(ensureDirs().logs, 'cucumber-study-status.log'), text);
const all = path => existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];

async function frozenInputs({ deadline, orderSeed, runtimeStages, runtimeSource, executions, invalidGuard, comparisonManifestSHA }) {
  const contract = readFileSync(root + 'study/ui-contract.mjs');
  const feature = readFileSync(root + 'study/scenarios.feature');
  const evaluator = readFileSync(root + 'scripts/scenario-evaluation.mjs');
  return { mode: exploratoryConfig.mode, gatePassExists: false, followup: { stream: 'b-change1-faults', arms: followupArms(), files: Object.fromEntries(followupFiles), harnessCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() }, // FOLLOWUP-B
    config: { ...exploratoryConfig, executions, ...(invalidGuard ? { invalidGuard } : {}) }, runtimeStages, runtimeSource, ...(comparisonManifestSHA ? { comparisonManifestSHA } : {}), sourcePins: sourcePins(), appPins: appPins(),
    hashes: { contract: digest(contract), feature: digest(feature), evaluator: digest(evaluator) },
    node: process.version, codex: execFileSync('codex', ['--version'], { encoding: 'utf8' }).trim(),
    // Frozen per campaign: absolute deadline (campaign config), order seed, and the runtime driver's CLI version/model/system-prompt hash (omp: `omp --version`).
    deadline, orderSeed, driver: await (await loadDriver(driverNameForModel(requestedModel))).frozenInputs(), createdAt: now() };
}
function loadCampaign(directory, resume) {
  const journal = join(directory, 'journal.jsonl'); const lines = all(journal);
  if (!resume) { if (lines.length) throw new Error('Campaign directory already has a journal; use --resume'); return { journal, lines, inputs: null }; }
  if (!lines[0] || lines[0].type !== 'campaign-frozen') throw new Error('Resume journal lacks frozen inputs'); return { journal, lines, inputs: lines[0].inputs };
}
function parseArgs(argv) {
  // Forms: --campaign-id <id> [--resume] [--deadline <ISO>] | --resume <id> [--deadline <ISO>]
  let id = null, resume = false, deadline = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--campaign-id') id = argv[++i];
    else if (argv[i] === '--deadline') deadline = argv[++i];
    else if (argv[i] === '--resume') { resume = true; if (argv[i + 1] && !argv[i + 1].startsWith('--')) id = argv[++i]; }
    else throw new Error('Usage: exploratory-runner.mjs --campaign-id <id> [--resume] [--deadline <ISO UTC>] | --resume <id>');
  }
  if (!id) throw new Error('Usage: exploratory-runner.mjs --campaign-id <id> [--resume] [--deadline <ISO UTC>] | --resume <id>');
  return { id, resume, deadline };
}
export async function main(argv = process.argv.slice(2)) {
  const { id, resume, deadline: deadlineArg } = parseArgs(argv); if (!/^[a-zA-Z0-9._-]+$/.test(id)) throw new Error('Invalid campaign id');
  const directory = join(dataDir(), 'runs', id); mkdirSync(directory, { recursive: true, mode: 0o700 });
  const loaded = loadCampaign(directory, resume);
  // The deadline is campaign configuration, frozen in the journal; a resume uses the recorded one and never a new one.
  const deadlineIso = resume && loaded.inputs?.deadline ? loaded.inputs.deadline : requireDeadline(deadlineArg, process.env.STUDY_DEADLINE_UTC);
  if (resume && loaded.inputs?.deadline && [deadlineArg, process.env.STUDY_DEADLINE_UTC].some(v => v && v !== deadlineIso)) throw new Error('Resume deadline differs from the frozen campaign deadline ' + deadlineIso);
  const orderSeed = resume ? loaded.inputs.orderSeed ?? null : process.env.STUDY_ORDER_SEED || randomBytes(8).toString('hex');
  const rerunFrom = process.env.STUDY_RUNTIME_RERUN_FROM || null;
  const runtimeStages = process.env.STUDY_RUNTIME_STAGES?.split(',') ?? null;
  const stages = v1FaultStages(); // FOLLOWUP-B
  if (runtimeStages && (!rerunFrom || new Set(runtimeStages).size !== runtimeStages.length ||
    runtimeStages.some(id => !stages.some(s => s.id === id && s.kind !== 'maintenance')))) {
    throw new Error('Runtime stage selection requires a source campaign and distinct known trial stages');
  }
  const sourceEvents = rerunFrom ? all(join(dataDir(), 'runs', rerunFrom, 'events.jsonl')).filter(
    e => e.type === 'maintenance-record' && e.frozen?.implementation) : [];
  if (rerunFrom && stages.some(s => s.kind === 'maintenance' && !sourceEvents.some(e => e.revision === s.revision))) {
    throw new Error('Source campaign is missing a frozen maintenance implementation');
  }
  const continuation = process.env.STUDY_CONTINUE_UNFINISHED_FROM || null;
  if (continuation && (!rerunFrom || continuation === id || !/^[a-zA-Z0-9._-]+$/.test(continuation))) {
    throw new Error('Continuation requires a distinct prior runtime-only campaign');
  }
  const predecessor = continuation ? all(join(dataDir(), 'runs', continuation, 'journal.jsonl')) : [];
  const terminal = new Set(predecessor.filter(e => e.type === 'trial-finished').map(e => e.trial.id));
  if (continuation && (!terminal.size || predecessor[0]?.inputs?.driver?.model !== requestedModel ||
      predecessor[0]?.inputs?.runtimeSource?.id !== rerunFrom)) {
    throw new Error('Prior campaign must have recorded outcomes for the same model and frozen step code');
  }
  const stageTrials = stage => stage.trials.filter(t => !terminal.has(t.id) &&
    (!rerunFrom || (followupArms().includes(t.arm) && (!runtimeStages || runtimeStages.includes(stage.id))))); // FOLLOWUP-B: arm selection
  const executions = stages.flatMap(stageTrials).length;
  const runtimeSource = rerunFrom ? {
    id: rerunFrom, maintenanceSha256: digest(sourceEvents),
    ...(continuation ? { continuation, predecessorJournalSha256: digest(predecessor), terminal: terminal.size } : {}),
  } : null;
  const comparison = process.env.STUDY_MODEL_COMPARISON === '1';
  const comparisonManifestSHA = comparison ? process.env.STUDY_COMPARISON_MANIFEST_SHA : null;
  if (comparison && !/^[a-f0-9]{64}$/.test(comparisonManifestSHA || '')) throw new Error('Comparison requires a reviewed shared manifest SHA');
  const invalidGuard = comparison ? { first: 12, maxInvalid: 3 } : null;
  if (comparison && (executions !== 36 || !rerunFrom || continuation ||
    [...runtimeStages ?? []].sort().join(',') !== 'fault-v2-1,healthy-v0-1,healthy-v2-1')) {
    throw new Error('Model comparison requires the exact 36-cell runtime allocation');
  }
  const inputs = await frozenInputs({ deadline: deadlineIso, orderSeed, runtimeStages, runtimeSource, executions, invalidGuard, comparisonManifestSHA });
  let verifyFixture;
  if (comparison) {
    const bytes = readFileSync(join(dataDir(), 'runs', 'experiment-4-comparison.json'), 'utf8');
    if (digest(bytes) !== comparisonManifestSHA) throw new Error('Comparison manifest digest differs');
    const { deadline: sealedDeadline, pins } = JSON.parse(bytes);
    const arm = pins.arms.find(arm => arm.campaign === id);
    const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    const cli = { 'claude-code': 'claude', codex: 'codex', omp: 'omp' }[inputs.driver.driver];
    if (!arm || arm.model !== inputs.driver.model || arm.driver !== inputs.driver.driver ||
        pins.versions[cli] !== inputs.driver.cliVersion || pins.commit !== git(['rev-parse', 'HEAD']) ||
        git(['status', '--porcelain', '--', 'scripts', 'study', 'package.json', 'package-lock.json']) ||
        deadlineIso !== sealedDeadline || orderSeed !== pins.seed || rerunFrom !== pins.source ||
        runtimeStages.join(',') !== pins.stages ||
        digest(readFileSync(join(dataDir(), 'runs', rerunFrom, 'events.jsonl'), 'utf8')) !== pins.maintenanceSHA) {
      throw new Error('Comparison execution differs from the reviewed manifest');
    }
    samePins(inputs.sourcePins, pins.sourcePins, 'Comparison source');
    samePins(inputs.appPins, pins.appPins, 'Comparison app');
    verifyFixture = async signal => samePins(await fixtureProvenance({ signal }), pins.fixture, 'Running comparison fixture');
    await verifyFixture();
  }
  if (resume) { samePins(inputs.sourcePins, loaded.inputs.sourcePins, 'Frozen source'); samePins(inputs.appPins, loaded.inputs.appPins, 'Frozen app');
    if (inputs.comparisonManifestSHA !== loaded.inputs.comparisonManifestSHA || JSON.stringify(inputs.config) !== JSON.stringify(loaded.inputs.config) || JSON.stringify(inputs.hashes) !== JSON.stringify(loaded.inputs.hashes) || inputs.node !== loaded.inputs.node || inputs.codex !== loaded.inputs.codex || (loaded.inputs.driver && JSON.stringify(inputs.driver) !== JSON.stringify(loaded.inputs.driver)) || digest(inputs.runtimeStages) !== digest(loaded.inputs.runtimeStages ?? null) || digest(inputs.runtimeSource) !== digest(loaded.inputs.runtimeSource ?? null)) throw new Error('Frozen config, contract, evaluator, version or source differs'); }
  else append(loaded.journal, { type: 'campaign-frozen', at: now(), inputs });
  const eventPath = join(directory, 'events.jsonl');
  const emit = event => append(eventPath, { at: now(), status: exploratoryConfig.mode, gatePassExists: false, ...event });
  const state = createMaintenanceState({ emit, maxEdits: exploratoryConfig.maintenanceEdits, maxValidations: exploratoryConfig.maintenanceSuites });
  const prior = all(loaded.journal), started = new Map(), finished = new Set(), attempts = new Map();
  for (const line of prior) { if (line.type === 'trial-started') { started.set(line.trial.id, line); attempts.set(line.trial.id, (attempts.get(line.trial.id) ?? 0) + 1); } if (line.type === 'trial-finished') finished.add(line.trial.id); }
  const storedRecords = new Map(all(join(directory, 'trials.jsonl')).map(r => [r.record?.trial?.id ?? r.record?.trialId, r]));
  for (const [trialId, line] of started) if (!finished.has(trialId) && storedRecords.has(trialId)) { const r = storedRecords.get(trialId); append(loaded.journal, { type: 'trial-finished', at: now(), status: exploratoryConfig.mode, gatePassExists: false, trial: line.trial, result: r.result, infrastructureInvalid: r.result !== 'recorded', recordSHA: r.record?.recordSHA, reconciled: true }); progress(trialId, line.trial.arm, r.result); finished.add(trialId); }
  // A trial-started record without a trial-finished one means the process died mid-trial. Ledger rule: write
  // trial-interrupted (the started record stays) and run the trial again as the next attempt; a finished trial never re-runs.
  for (const [trialId, line] of [...started]) if (!finished.has(trialId)) { append(loaded.journal, { type: 'trial-interrupted', at: now(), status: exploratoryConfig.mode, gatePassExists: false, trial: line.trial, attempt: attempts.get(trialId), reason: 'process ended after durable trial-started record without trial-finished; re-run as the next attempt' }); progress(trialId, line.trial.arm, 'interrupted'); started.delete(trialId); }
  // Restore every recorded transition, including one that ended in error: its latest accepted candidate is what later probes use. No maintenance session is rerun.
  for (const line of all(eventPath).filter(e => e.type === 'maintenance-record' && e.frozen?.implementation)) state.restore(line.revision, line.from, line.frozen.implementation);
  // Campaign B: runtime arm only, against campaign A's frozen step code. No maintenance session runs.
  for (const line of sourceEvents) state.restore(line.revision, line.from, line.frozen.implementation);
  const checkInvalidGuard = () => {
    if (!invalidGuard || finished.size < invalidGuard.first) return;
    const first = all(loaded.journal).filter(e => e.type === 'trial-finished').slice(0, invalidGuard.first);
    const invalid = first.filter(e => e.infrastructureInvalid).length;
    if (invalid > invalidGuard.maxInvalid) throw new Error(`Model comparison stopped: ${invalid}/${invalidGuard.first} initial executions were infrastructure-invalid`);
  };
  const lock = acquireLock(undefined, { takeoverDeadOwner: resume }); const deadline = Date.parse(deadlineIso); let stopReason = null;
  // Randomized blocked order (block = case; both arms of a case adjacent), seeded and recorded, stable on resume.
  // Campaigns frozen without a seed keep the plan order.
  const taskKey = process.env.STUDY_TASK_KEY, ledger = taskKey ? ensureDirs() : null;
  const trialSpec = t => ({ key: trialKey({ plan: process.env.STUDY_PLAN_SHORT || 'adhoc', caseId: t.caseId, state: `${t.kind}-${t.revision}`, arm: t.arm, model: requestedModel, repetition: t.repetition }), block: t.caseId });
  const orderedTrials = stage => { const list = stageTrials(stage); if (!orderSeed) return list;
    const byKey = new Map(list.map(t => [trialSpec(t).key, t])); return blockedOrder(list.map(trialSpec), { seed: `${orderSeed}/${stage.id}` }).map(s => byKey.get(s.key)); };
  const storedBody = trial => { const r = storedRecords.get(trial.id); return { outcome: r?.result ?? 'unknown', usage: r?.record?.agent?.usage ?? null, wall: { totalMs: r?.record?.elapsedMs ?? null }, recordSHA: r?.record?.recordSHA ?? null }; };
  if (taskKey) { const planned = stages.filter(s => s.kind !== 'maintenance').flatMap(orderedTrials);
    await planTrials({ taskKey, trials: planned.map(trialSpec), order: planned.map(t => trialSpec(t).key), seed: orderSeed ?? 'plan-order', paths: ledger }); }
  try {
    status(`exploratory campaign ${id} ${resume ? 'resumed' : 'started'}; status exploratory-owner-directed; gatePassExists false`);
    checkInvalidGuard();
    for (const stage of stages) {
      if (stage.kind === 'maintenance' && rerunFrom) continue;
      if (stage.kind === 'maintenance') {
        const already = all(eventPath).some(e => e.type === 'maintenance-record' && e.revision === stage.revision);
        if (already) continue;
        emit({ type: 'maintenance-started', stage, status: exploratoryConfig.mode, gatePassExists: false });
        const record = await runMaintenance({ ...stage, state, emit, absoluteDeadline: deadline });
        append(loaded.journal, { type: 'maintenance-finished', at: now(), status: exploratoryConfig.mode, gatePassExists: false, stage, record });
        // A failed session keeps its latest accepted candidate and the campaign goes on; only an unsafe fixture stops it.
        if (!record.quiescent) throw new Error(record.error || 'maintenance did not quiesce');
        continue;
      }
      const order = orderedTrials(stage);
      if (orderSeed && !all(loaded.journal).some(e => e.type === 'stage-order' && e.stage === stage.id)) append(loaded.journal, { type: 'stage-order', at: now(), stage: stage.id, seed: orderSeed, order: order.map(t => t.id) });
      for (const trial of order) {
        if (started.has(trial.id)) { if (taskKey && finished.has(trial.id)) await reconcileEnded({ taskKey, spec: trialSpec(trial), body: storedBody(trial), paths: ledger }); continue; } // finished in this or an earlier attempt: never re-run
        await verifyFixture?.();
        samePins(sourcePins(), loaded.inputs?.sourcePins ?? inputs.sourcePins, 'Frozen source during campaign');
        if (Date.now() + exploratoryConfig.runtimeWallMs + exploratoryConfig.fixtureEnvelopeMs >= deadline) { append(loaded.journal, { type: 'trial-not-run', at: now(), status: exploratoryConfig.mode, gatePassExists: false, trial, reason: 'time ran out before this cell started' }); progress(trial.id, trial.arm, 'not_run'); continue; }
        const attempt = (attempts.get(trial.id) ?? 0) + 1; attempts.set(trial.id, attempt);
        const claim = taskKey ? await startTrial({ taskKey, spec: trialSpec(trial), paths: ledger }) : null;
        if (claim?.skip) { started.set(trial.id, { trial }); continue; }
        append(loaded.journal, { type: 'trial-started', at: now(), status: exploratoryConfig.mode, gatePassExists: false, trial, attempt, trialKey: trialSpec(trial).key }); started.set(trial.id, { trial }); progress(trial.id, trial.arm, attempt > 1 ? `started(attempt ${attempt})` : 'started');
        const record = await runTrial({ trial, state, emit, absoluteDeadline: deadline, verifyEnvironment: verifyFixture });
        const modelFailure = trial.arm === 'runtime' && !record.error && record.agent?.modelVerified !== true;
        const result = record.error || modelFailure ? 'infrastructure-invalid' : 'recorded';
        append(join(directory, 'trials.jsonl'), { type: 'trial', at: now(), status: exploratoryConfig.mode, gatePassExists: false, result, record });
        append(loaded.journal, { type: 'trial-finished', at: now(), status: exploratoryConfig.mode, gatePassExists: false, trial, result, infrastructureInvalid: result !== 'recorded', modelFailure, recordSHA: record.recordSHA, attempt }); finished.add(trial.id); progress(trial.id, trial.arm, result);
        // Cost metering on the ledger: unknown stays null (never 0); browser/fixture wall split is not instrumented here.
        if (taskKey) endTrial({ taskKey, key: trialSpec(trial).key, attempt: claim.attempt, paths: ledger, body: { outcome: result, usage: record.agent?.usage ?? null, costUsd: record.agent?.reportedCostUsd ?? null, wall: { totalMs: record.elapsedMs, modelMs: record.agent?.elapsedMs ?? null }, recordSHA: record.recordSHA, model: record.agent?.actualModels ?? null } });
        // An invalid trial stays in the denominator as infrastructure-invalid and the campaign continues. Only an unsafe fixture stops it.
        if (!record.quiescent) throw new Error(record.error || 'trial did not quiesce');
        if (invalidGuard && finished.size === invalidGuard.first) checkInvalidGuard();
      }
    }
    append(loaded.journal, { type: 'campaign-complete', at: now(), status: exploratoryConfig.mode, gatePassExists: false, executionsPlanned: executions });
  } catch (error) { stopReason = error.message; append(loaded.journal, { type: 'campaign-stopped', at: now(), status: exploratoryConfig.mode, gatePassExists: false, reason: error.message, stack: error.stack }); status(`exploratory campaign ${id} stopped: ${error.message}`); process.exitCode = 1; }
  finally { try { await bounded('Final seed restoration', signal => reset({ signal }), { deadline: Math.min(deadline, Date.now() + 20000) }); lock(); } catch (error) { status(`exploratory campaign ${id} final reset failed: ${error.message}`); process.exitCode = 1; } }
  if (!stopReason) status(`exploratory campaign ${id} complete`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
