#!/usr/bin/env node
// Writes study/moodle/v1-r2-spec.json: what V1 round 2 runs, derived from the round-1 ledger and the manifest.
//   cross    every usable break x every fault target scenario not yet run (a break "affects" a scenario when it bites there, not only
//            when the manifest's static pattern says so): broken:<b> and before:<b>
//   error    every round-1 trial that never executed a scenario (Behat `error`): rerun as round 2
//   confirm  every fault whose round-1 trial passed (fault not reproduced): rerun once as round 2 to rule out a flaky pass
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readLines } from '../ledger/jsonl.mjs';
import { ledgerPaths } from '../ledger/paths.mjs';
import { loadManifest } from '../../adapters/moodle/manifest.mjs';
import { repoRoot } from '../../adapters/moodle/config.mjs';
import { collect } from './v1-report.mjs';

const manifest = loadManifest(), rows = collect(readLines(ledgerPaths().trials), process.argv[2] ?? null), have = (s, st) => rows.get(`${s}|${st}`) ?? [];
const spec = [], seen = new Set(), add = (scenario, state, round, reason) => { const k = `${scenario}|${state}|${round}`; if (!seen.has(k)) { seen.add(k); spec.push({ scenario, state, round, reason }); } };
const faultScenarios = [...new Set(manifest.faults.map(f => f.target.scenario))], stage = Number(process.argv[3] ?? 2);
const effective = (s, st) => have(s, st).find(r => r.status === 'passed' || r.status === 'failed');
// stage 2: broken:<b> everywhere it has not run. stage 3: before:<b> where the break bit (broken failed, healthy passed) and no before exists.
for (const b of manifest.breaks.filter(x => x.usable)) for (const s of faultScenarios) {
  if (stage === 2 && !have(s, `broken:${b.id}`).length) add(s, `broken:${b.id}`, 1, null);
  if (stage === 3 && effective(s, `broken:${b.id}`)?.status === 'failed' && effective(s, 'healthy')?.status === 'passed' && !have(s, `before:${b.id}`).length) add(s, `before:${b.id}`, 1, null);
}
if (stage === 2) for (const [k, list] of rows) { const [scenario, state] = k.split('|'); if (list.every(r => r.status === 'error')) add(scenario, state, 2, 'round 1 never executed a scenario (Behat error: Scenario Outline rows were not step-logged); rerun with the fixed step-log extension'); }
if (stage === 2) for (const f of manifest.faults) { const list = have(f.target.scenario, `fault:${f.id}`); if (list.length && list.every(r => r.status === 'passed')) add(f.target.scenario, `fault:${f.id}`, 2, 'fault trial passed in round 1 (fault not reproduced); rerun to rule out a flaky pass'); }
writeFileSync(join(repoRoot, `study/moodle/v1-r${stage}-spec.json`), JSON.stringify(spec, null, 1) + '\n');
console.log(`spec: ${spec.length} trials (${spec.filter(t => t.round === 1).length} cross, ${spec.filter(t => t.round === 2).length} reruns)`);
