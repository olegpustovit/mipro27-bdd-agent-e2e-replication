#!/usr/bin/env node
// Plan generator for fault-candidate screening (model-free; wave 2).
//   node scripts/moodle/cand-plan.mjs --name moodle-cand-b01 --prefix public/mod/data/,public/customfield/ [--ids C001,C002] [--confirm C001,C002] --workers w1,w2,w3
// Writes study/moodle/<name>-spec.json (one trial per candidate x probe scenario, round 1; `--confirm` ids: round 2 reruns of
// candidates that failed in round 1, with a recorded reason) and study/moodle/<name>-plan.json (one ledger task per worker).
// A candidate/scenario pair that already has a trial in the ledger is never planned again (a key is one piece of work forever).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readLines } from '../ledger/jsonl.mjs';
import { ledgerPaths } from '../ledger/paths.mjs';
import { loadManifest } from '../../adapters/moodle/manifest.mjs';
import { repoRoot } from '../../adapters/moodle/config.mjs';
import { argOf } from './common.mjs';

const name = argOf('name'), workers = argOf('workers', 'w1,w2,w3').split(','), prefixes = argOf('prefix', '').split(',').filter(Boolean);
const maxProbes = Number(argOf('max-probes', 99)), ids = argOf('ids')?.split(','), confirm = argOf('confirm')?.split(',');
const manifest = loadManifest(), have = new Set(readLines(ledgerPaths().trials).filter(e => e.type === 'trial-end' && e.state?.startsWith('fault:')).flatMap(e => { const r = /\/r(\d+)/.exec(e.key)?.[1]; return [`${e.scenario}|${e.state}|${r}`, ...(r === '1' ? [`${e.scenario}|${e.state}`] : [])]; }));
const spec = [], planned = {};
// Probe ranking (cheap relevance heuristic, not an oracle): shared 5-letter stems between the words of the candidate's changed paths and summary and the words of the
// scenario's feature path and title. The best `maxProbes` scenarios are run; the rest of the area's scenarios stay unprobed and the candidate says so.
const words = t => new Set(String(t).toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4).map(w => w.slice(0, 5)));
const score = (c, sid) => { const sc = manifest.scenarioById.get(sid), a = words([...c.revert_hunks.source_files, c.summary ?? ''].join(' ')), b = words(`${sc.feature} ${sc.name}`); return [...a].filter(w => b.has(w)).length; };
const ranked = c => [...c.probe_scenarios].map((sid, i) => ({ sid, i, sc: score(c, sid) })).sort((x, y) => y.sc - x.sc || x.i - y.i).slice(0, maxProbes).map(x => x.sid);
const crossAll = process.argv.includes('--cross');
for (const c of [...(manifest.fault_candidates ?? []), ...(manifest.fault_cross_runs ?? [])]) {
  const isCross = !c.id.match(/^[CX]/);
  if (!c.applies_cleanly || c.status === 'rejected' && c.tried === false) continue;
  if (confirm?.includes(c.id)) {
    for (const s of c.screen_failed_scenarios ?? []) if (!have.has(`${s}|fault:${c.id}|2`)) spec.push({ scenario: s, state: `fault:${c.id}`, round: 2, reason: 'confirmation rerun of a round-1 failure (screening froze the target step; the rerun must fail at or near it)' });
    continue;
  }
  if (isCross ? !(crossAll && c.status === 'pending') : ids ? !ids.includes(c.id) : !(c.status === 'pending' && c.revert_hunks.source_files.some(f => prefixes.some(p => f.startsWith(p))))) continue;
  const probes = !isCross && maxProbes < c.probe_scenarios.length ? ranked(c) : c.probe_scenarios; planned[c.id] = probes;
  for (const s of probes) if (!have.has(`${s}|fault:${c.id}`)) spec.push({ scenario: s, state: `fault:${c.id}`, round: 1 });
}
writeFileSync(join(repoRoot, `study/moodle/${name}-probes.json`), JSON.stringify(planned, null, 1) + '\n');   // what screening of each candidate covers in this plan
writeFileSync(join(repoRoot, `study/moodle/${name}-spec.json`), JSON.stringify(spec, null, 1) + '\n');
const plan = { plan: name, models: [], drivers: [], prompts: {}, pinPatterns: ['adapters/moodle/adapter.mjs', 'adapters/moodle/behat-runner.mjs', 'adapters/moodle/gherkin.mjs', 'adapters/moodle/manifest.mjs', 'adapters/moodle/states.mjs', 'adapters/moodle/shell.mjs',
    'adapters/moodle/lock.mjs', 'adapters/moodle/config.mjs', 'docker/moodle/versions.json', 'docker/moodle/behat/*', 'manifests/moodle.yaml', 'manifests/moodle/patches/*', 'scripts/moodle/common.mjs', 'scripts/moodle/v1-plan.mjs', 'scripts/moodle/v1-run.mjs', 'scripts/ledger/*.mjs', `study/moodle/${name}-spec.json`],
  tasks: workers.map(w => ({ key: `v1:${name}/${w}`, cmd: ['node', 'scripts/moodle/v1-run.mjs', '--worker', w, '--workers', workers.join(','), '--spec', `study/moodle/${name}-spec.json`] })) };
writeFileSync(join(repoRoot, `study/moodle/${name}-plan.json`), JSON.stringify(plan, null, 1) + '\n');
console.log(`${name}: ${spec.length} trials, ${new Set(spec.map(t => t.state)).size} fault states, workers ${workers.join(',')}`);
