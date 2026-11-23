#!/usr/bin/env node
// Model-free plan for wave-3 break candidates (mining/mine_breaks_v2.py, add_breaks_v2.py). No model is called.
//   node scripts/moodle/brk-plan.mjs --name moodle-brk-s1 --breaks B14,B15 [--stage 1|2] [--scenarios B14=S088,S089;B15=S091] --workers w1,w2,w3
// stage 1: `broken-steps:Bxx` (arm B's starting state: new UI + the developers' Gherkin + old step definitions) on every probe scenario of the break.
// stage h: `healthy` (the pin) on every scenario where the start state failed and no healthy result exists in the ledger yet.
// stage c: round-2 rerun of every bite (start state failed, pin passed) of the given breaks, with a recorded reason.
// stage 2: `before:Bxx` (old UI + old tests) where the start state failed and the pin passed, and the break has a before patch (strict reproduction).
// A (scenario, state) that already has an executed result in the ledger is never planned again; one key is one piece of work.
// Writes study/moodle/<name>-spec.json (with --shard: one spec per worker) and study/moodle/<name>-plan.json (one ledger task per worker); run with scripts/moodle/v1-run.mjs --spec.
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readLines } from '../ledger/jsonl.mjs';
import { ledgerPaths } from '../ledger/paths.mjs';
import { loadManifest } from '../../adapters/moodle/manifest.mjs';
import { repoRoot } from '../../adapters/moodle/config.mjs';
import { argOf } from './common.mjs';
import { collect } from './v1-report.mjs';

const name = argOf('name'), workers = argOf('workers', 'w1,w2,w3').split(','), ids = argOf('breaks', '').split(',').filter(Boolean), stage = ['h', 'c'].includes(argOf('stage', '1')) ? argOf('stage') : Number(argOf('stage', 1));
const manifest = loadManifest(), rows = collect(readLines(ledgerPaths().trials));
const probes = JSON.parse(readFileSync(join(repoRoot, 'mining/out/breaks-v2-probes.json'), 'utf8'));
const extra = Object.fromEntries((argOf('scenarios', '') || '').split(';').filter(Boolean).map(x => [x.split('=')[0], x.split('=')[1].split(',')]));
const eff = (s, st) => (rows.get(`${s}|${st}`) ?? []).find(r => r.status === 'passed' || r.status === 'failed');
const spec = [], seen = new Set(), add = (scenario, state) => { const k = `${scenario}|${state}`; if (!seen.has(k) && !eff(scenario, state)) { seen.add(k); spec.push({ scenario, state, round: 1 }); } };
for (const id of ids) {
  const b = manifest.breakById.get(id); if (!b) throw new Error(`unknown break ${id}`);
  const scen = extra[id] ?? probes[id] ?? [];
  for (const s of scen) {
    if (stage === 1) add(s, `broken-steps:${id}`);
    else if (stage === 'c') { if (eff(s, `broken-steps:${id}`)?.status === 'failed' && eff(s, 'healthy')?.status === 'passed' && !(rows.get(`${s}|broken-steps:${id}`) ?? []).some(r => r.round === 2)) spec.push({ scenario: s, state: `broken-steps:${id}`, round: 2, reason: 'independent rerun of a bite (start state failed, pin passed in round 1): the bite must reproduce' }); }
    else if (stage === 'h') { if (eff(s, `broken-steps:${id}`)?.status === 'failed') add(s, 'healthy'); }
    else if (b.patches.before && eff(s, `broken-steps:${id}`)?.status === 'failed' && eff(s, 'healthy')?.status === 'passed') add(s, `before:${id}`);
  }
}
const shard = process.argv.includes('--shard');   // one spec per worker (a single state, e.g. healthy, would otherwise run on one worker only)
const specs = shard ? Object.fromEntries(workers.map((w, i) => [w, spec.filter((_, k) => k % workers.length === i)])) : { all: spec };
for (const [k, list] of Object.entries(specs)) writeFileSync(join(repoRoot, `study/moodle/${name}${shard ? '-' + k : ''}-spec.json`), JSON.stringify(list, null, 1) + '\n');
const specFile = w => `study/moodle/${name}${shard ? '-' + w : ''}-spec.json`;
const plan = { plan: name, models: [], drivers: [], prompts: {}, pinPatterns: ['adapters/moodle/adapter.mjs', 'adapters/moodle/behat-runner.mjs', 'adapters/moodle/gherkin.mjs', 'adapters/moodle/manifest.mjs', 'adapters/moodle/states.mjs', 'adapters/moodle/shell.mjs',
    'adapters/moodle/lock.mjs', 'adapters/moodle/config.mjs', 'docker/moodle/versions.json', 'docker/moodle/behat/*', 'manifests/moodle.yaml', 'manifests/moodle/patches/*', 'scripts/moodle/common.mjs', 'scripts/moodle/v1-plan.mjs', 'scripts/moodle/v1-run.mjs', 'scripts/ledger/*.mjs', ...workers.map(specFile)],
  tasks: workers.map(w => ({ key: `v1:${name}/${w}`, cmd: ['node', 'scripts/moodle/v1-run.mjs', '--worker', w, '--workers', shard ? w : workers.join(','), '--spec', specFile(w)] })) };
writeFileSync(join(repoRoot, `study/moodle/${name}-plan.json`), JSON.stringify(plan, null, 1) + '\n');
console.log(`${name}: ${spec.length} trials over ${new Set(spec.map(t => t.state)).size} states, workers ${workers.join(',')}${shard ? ' (sharded)' : ''}`);
