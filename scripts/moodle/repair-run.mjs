#!/usr/bin/env node
// Ledger job for `repair:moodle/<break>/<model>/r<k>`: one LLM repair session for arm B, exactly once per break x model x repetition.
//   node scripts/moodle/repair-run.mjs --worker w1 --break B03 --model claude-haiku-5-5 --rep 1 [--sample S003,S004]
// The trial key is <planShort>/<break>.repair/broken-steps:<break>/B/<model>/r<k>; its trial-end carries the repair patch (blob sha) that arm-B trials use.
import { runTrials } from '../ledger/trials.mjs';
import { ensureDirs } from '../ledger/paths.mjs';
import { readLines } from '../ledger/jsonl.mjs';
import { createBlobStore } from '../ledger/blobstore.mjs';
import { workerAdapter, argOf, loadManifest } from './common.mjs';
import { repairTrialKey } from './campaign.mjs';
import { ensureState } from '../../adapters/moodle/states.mjs';
import { stateSpec } from '../../adapters/moodle/manifest.mjs';
import { runRepair } from '../../adapters/moodle/repair.mjs';
import { collect, startState } from './v1-report.mjs';
import { modeFields, ompCostGuard } from './mode.mjs';

const worker = argOf('worker', 'w1'), breakId = argOf('break'), model = argOf('model'), rep = Number(argOf('rep', 1)), v1plan = argOf('v1-plan');
const short = process.env.STUDY_PLAN_SHORT || 'adhoc', taskKey = process.env.STUDY_TASK_KEY ?? `adhoc:repair/${breakId}`;
const manifest = loadManifest(), paths = ensureDirs(), blobs = createBlobStore({ root: paths.blobs }), b = manifest.breakById.get(breakId);
if (!b?.usable) throw new Error(`Break ${breakId} is not usable`);
// sample = up to 2 scenarios in which the break reproduced in V1 in arm B's starting state (broken-steps, or broken where identical: fails; healthy passes); override with --sample
let sample = argOf('sample')?.split(',');
if (!sample) {
  const rows = collect(readLines(paths.trials), v1plan), ok = id => { const g = k => rows.get(`${id}|${k}`)?.find(r => r.status === 'passed' || r.status === 'failed'); return g(startState(b))?.status === 'failed' && g('healthy')?.status === 'passed'; };
  sample = b.affected_scenarios.filter(ok).slice(0, 2);
  if (!sample.length) throw new Error(`No V1 scenario reproduces ${breakId}; pass --sample explicitly`);
}
const key = repairTrialKey(short, breakId, model, rep), adapter = await workerAdapter(worker), release = adapter.lease(`repair:${breakId}`);
await adapter.exec('webserver', ['pkill', '-KILL', '-f', 'vendor/bin/behat'], { check: false });   // stray behat of a killed predecessor
try {
  const result = await runTrials({ taskKey, trials: [{ key, block: breakId, model, arm: 'B' }], seed: key, shuffleBlocks: false, paths, shouldStop: ompCostGuard({ short, trialsPath: paths.trials }), runOne: async () => {
    await ensureState(adapter, stateSpec(manifest, `broken-steps:${breakId}`));   // new UI + the developers' new .feature files + old step definitions
    const r = await runRepair({ adapter, manifest, breakId, sample, model });
    const patchBlob = await blobs.attach(key, 'other', 'repair.patch', Buffer.from(r.patch), { breakId, model, rep });
    const eventsBlob = await blobs.attach(key, 'cli-rollout', 'repair-agent-events.jsonl', Buffer.from(r.rawEvents ?? ''), { model });
    const { rawEvents, patch, ...rest } = r;
    return { arm: 'B', model, break: breakId, rep, ...modeFields(), ...rest, patchBytes: patch.length, patchBlob: patchBlob?.sha256 ?? null, eventsBlob: eventsBlob?.sha256 ?? null, wall: { modelMs: r.wall.modelMs, fixtureMs: null } };
  } });
  console.log(JSON.stringify({ worker, ...result, results: undefined }));
} finally { try { await adapter.revertDiff(); } catch (e) { console.error('final revert failed:', e.message); } release(); }
