#!/usr/bin/env node
// Ledger job: model-free V1 reproduction share of one worker. `node scripts/moodle/v1-run.mjs --worker w1 [--workers w1,w2,w3] [--round 1]`
// Every (scenario, state) is a trial `<plan>/<scenario>/<state>/v1/none/r<round>`; trial-end is final, so a resume never re-runs one.
import { readFileSync } from 'node:fs';
import { runTrials } from '../ledger/trials.mjs';
import { ensureDirs } from '../ledger/paths.mjs';
import { workerAdapter, argOf, runInState, loadManifest } from './common.mjs';
import { v1Trials, assignGroups } from './v1-plan.mjs';

const worker = argOf('worker', 'w1'), workers = argOf('workers', 'w1,w2,w3').split(','), round = Number(argOf('round', 1));
const only = argOf('only'), reason = argOf('reason');   // round >= 2: explicit list of "scenario|state" keys re-run on purpose (new key, recorded reason)
const manifest = loadManifest(), short = process.env.STUDY_PLAN_SHORT || 'adhoc';
let trials = v1Trials(manifest).map(t => ({ ...t, round }));
if (only) { const keep = new Set(only.split(',')); trials = trials.filter(t => keep.has(`${t.scenario}|${t.state}`)); }
// --spec <file>: an explicit list of { scenario, state, round, reason } (round 2 = a deliberate rerun with a recorded reason)
if (argOf('spec')) trials = JSON.parse(readFileSync(argOf('spec'), 'utf8')).map(t => ({ ...t, ...(t.state.startsWith('fault:') ? { fault: t.state.slice(6) } : { break: t.state.split(':')[1] }) }));
const mine = assignGroups(trials, workers)[worker] ?? [];
const specs = mine.map(t => ({ key: `${short}/${t.scenario}/${t.state}/v1/none/r${t.round ?? round}`, block: t.group, ...t, ...((t.round ?? round) > 1 ? { rerunReason: t.reason ?? reason } : {}) }));
const adapter = await workerAdapter(worker), release = adapter.lease(`v1-run:${process.env.STUDY_TASK_KEY ?? 'adhoc'}`);
try {
  const result = await runTrials({ taskKey: process.env.STUDY_TASK_KEY ?? `adhoc:v1/${worker}`, trials: specs, seed: `v1-${short}-${worker}`, shuffleBlocks: false, paths: ensureDirs(),
    runOne: async spec => { const r = await runInState(adapter, manifest, { scenario: spec.scenario, state: spec.state }); return { ...r, ...(spec.corrects ? { corrects: true } : {}), wall: { fixtureMs: r.stateMs } }; } });
  console.log(JSON.stringify({ worker, ...result, results: undefined }));
} finally { try { await adapter.revertDiff(); } catch (e) { console.error('final revert failed:', e.message); } release(); }
