#!/usr/bin/env node
// Ledger job: run campaign (or smoke) trials of arms A, B and C on one worker.
//   node scripts/moodle/campaign-run.mjs --worker w1 --pairs B03.F03,B06.F10 --arms A,B,C --models claude-haiku-5-5 --reps 1 [--workers w1,w2,w3]
// Trial keys: <planShort>/<break>.<scenario>/<healthy|fault:Fxx>/<arm>/<model|none>/r<k>. trial-end is final (never re-run on resume).
// Every arm's trial asserts that the scenario text in its tree equals the pin's (adapters/moodle/scenario-text.mjs) and records scenarioTextSha256.
// Arm B needs the repair for (break, model, rep) from the ledger (`repair:moodle/...` task); the job refuses to start without them.
import { readLines } from '../ledger/jsonl.mjs';
import { runTrials } from '../ledger/trials.mjs';
import { ensureDirs } from '../ledger/paths.mjs';
import { createBlobStore } from '../ledger/blobstore.mjs';
import { workerAdapter, argOf, loadManifest, isRunnablePair } from './common.mjs';
import { campaignTrials, repairTrialKey } from './campaign.mjs';
import { assignGroups } from './v1-plan.mjs';
import { ensureState } from '../../adapters/moodle/states.mjs';
import { ensureStateText, stackPatches } from '../../adapters/moodle/state-text.mjs';
import { stateSpec, locateScenario, patchFile, faultTarget } from '../../adapters/moodle/manifest.mjs';
import { runScenario } from '../../adapters/moodle/behat-runner.mjs';
import { assertPinScenarioText } from '../../adapters/moodle/scenario-text.mjs';
import { readFileSync } from 'node:fs';
import { modeFields, ompCostGuard } from './mode.mjs';

const worker = argOf('worker', 'w1'), workers = argOf('workers', worker).split(','), short = process.env.STUDY_PLAN_SHORT || 'adhoc';
const arms = argOf('arms', 'A,B,C').split(','), models = (argOf('models', '') || '').split(',').filter(Boolean), reps = Number(argOf('reps', 1));
// pair syntax: <break>.<fault>[@<scenario>]  (@scenario selects an alternative target of the fault)
const pairs = argOf('pairs').split(',').map(x => { const [bf, sc] = x.split('@'), [b, f] = bf.split('.'); return { break: b, fault: f, scenario: sc }; });
const manifest = loadManifest(), paths = ensureDirs(), blobs = createBlobStore({ root: paths.blobs });
const allowUnlisted = process.argv.includes('--allow-unlisted') && (process.env.STUDY_TASK_KEY ?? '').startsWith('smoke:');   // smoke wiring checks only; never a campaign
for (const p of pairs) { if (!allowUnlisted && !isRunnablePair(manifest, p)) throw new Error(`${p.break}.${p.fault}${p.scenario ? '@' + p.scenario : ''} is neither a manifest pair nor a valid pair of the V1 report`); p.scenario = faultTarget(manifest, p.fault, p.scenario).scenario; }
const taskKey = process.env.STUDY_TASK_KEY ?? `adhoc:campaign/${worker}`;
const all = campaignTrials({ pairs, short, arms, models, reps });
const mine = assignGroups(all.map(t => ({ ...t, state: `${t.break}|${t.state}|${t.arm}` })), workers)[worker] ?? [];   // keep (break, state, arm) groups together
const specs = mine.map(t => ({ ...t, state: t.state.split('|')[1], block: t.group }));

// arm B: repairs must exist
const ended = new Map(readLines(paths.trials).filter(e => e.type === 'trial-end').map(e => [e.key, e]));
const repairFor = (b, model, rep) => ended.get(repairTrialKey(short, b, model, rep));
for (const t of specs.filter(x => x.arm === 'B')) { const r = repairFor(t.break, t.model, t.rep); if (!r) throw new Error(`Arm B trial ${t.key} needs ${repairTrialKey(short, t.break, t.model, t.rep)}; run the repair task first`); }

const adapter = await workerAdapter(worker), release = adapter.lease(`campaign:${taskKey}`);
// After a kill -9 the previous job's `docker exec behat` may still run in the container and would race the next reset: stop it (the lease means this job owns the worker).
await adapter.exec('webserver', ['pkill', '-KILL', '-f', 'vendor/bin/behat'], { check: false });
async function runOne(spec) {
  const faultPatch = spec.fault ? readFileSync(patchFile(stateSpec(manifest, `fault:${spec.fault}`).patch), 'utf8') : '';
  if (spec.arm === 'A') {
    const st = await ensureState(adapter, stateSpec(manifest, spec.state));
    const loc = locateScenario(manifest, spec.scenario, adapter.dirs.src);   // after the state: the line is only valid in the tree the scenario runs in
    const scenarioTextSha256 = await assertPinScenarioText(adapter.dirs.src, loc);   // the same scenario text for every arm
    const r = await runScenario(adapter, { feature: loc.feature, line: loc.line, reset: true }), sc = r.scenarios[0], f = sc?.failingStep ?? null;
    return { arm: 'A', model: 'none', state: spec.state, scenario: spec.scenario, break: spec.break, scenarioTextSha256, ...verify(r, sc, loc), failingStepIndex: r.failingStepIndex, stepCount: sc?.steps.length ?? 0, failingStep: f && { index: f.index, text: f.text, error: String(f.error ?? '').slice(0, 400) }, scenarioWallMs: r.wallMs, wall: { fixtureMs: 0 } };
  }
  if (spec.arm === 'B') {
    const rep = repairFor(spec.break, spec.model, spec.rep), repairText = blobText(rep.patchBlob);
    await ensureStateText(adapter, stackPatches([repairText, faultPatch]));
    const loc = locateScenario(manifest, spec.scenario, adapter.dirs.src);
    const scenarioTextSha256 = await assertPinScenarioText(adapter.dirs.src, loc);   // arm B ran on the developers' Gherkin; the repair patch holds no .feature hunk
    const r = await runScenario(adapter, { feature: loc.feature, line: loc.line, reset: true }), sc = r.scenarios[0], f = sc?.failingStep ?? null;
    return { arm: 'B', model: spec.model, state: spec.state, scenario: spec.scenario, break: spec.break, repairKey: rep.key, repairPatchSha256: rep.patchSha256, scenarioTextSha256, ...verify(r, sc, loc), failingStepIndex: r.failingStepIndex, stepCount: sc?.steps.length ?? 0, failingStep: f && { index: f.index, text: f.text, error: String(f.error ?? '').slice(0, 400) }, scenarioWallMs: r.wallMs, wall: { fixtureMs: 0 } };
  }
  if (spec.arm === 'C') {
    await ensureState(adapter, stateSpec(manifest, spec.state));
    const loc = locateScenario(manifest, spec.scenario, adapter.dirs.src);
    const scenarioTextSha256 = await assertPinScenarioText(adapter.dirs.src, loc);
    await (await import('../../adapters/moodle/agent-run.mjs')).useModel(spec.model);   // pins STUDY_MODEL before scripts/codex-boundary.mjs is first imported (arm-c -> agent-session)
    const { runArmC } = await import('../../adapters/moodle/arm-c.mjs');
    const r = await runArmC({ adapter, feature: loc.feature, line: loc.line, model: spec.model });
    const { rawEvents, ...rest } = r;
    const blob = await blobs.attach(spec.key, 'cli-rollout', 'agent-events.jsonl', Buffer.from(rawEvents ?? ''), { model: spec.model });
    return { ...rest, state: spec.state, scenario: spec.scenario, break: spec.break, scenarioTextSha256, eventsBlob: blob?.sha256 ?? null };
  }
  throw new Error(`Unknown arm ${spec.arm}`);
}
// The scenario Behat ran must be the one asked for (outline rows are titled by their example row: not checkable).
const verify = (r, sc, loc) => { const ok = !sc || loc.kind !== 'scenario' || sc.name === loc.name; return { status: ok ? r.status : 'error', ran: sc && { name: sc.name, line: sc.line, expectedLine: loc.line }, ...(ok ? {} : { wrongScenario: true }) }; };
const blobText = sha => blobs.read(sha).toString('utf8');
try {
  const result = await runTrials({ taskKey, trials: specs, seed: `campaign-${short}-${worker}`, shuffleBlocks: false, paths, runOne: async (spec, ctx) => ({ ...(await runOne(spec, ctx)), ...modeFields() }), shouldStop: ompCostGuard({ short, trialsPath: paths.trials }) });
  console.log(JSON.stringify({ worker, ...result, results: undefined }));
} finally { try { await adapter.revertDiff(); } catch (e) { console.error('final revert failed:', e.message); } release(); }
