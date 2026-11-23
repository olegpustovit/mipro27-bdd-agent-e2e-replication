#!/usr/bin/env node
// Writes a ledger plan manifest (JSON) for Moodle model-driven runs.
//   node scripts/moodle/make-plan.mjs --name moodle-smoke-r1 --kind smoke --pairs B12.F01 --models claude-haiku-5-5 --reps 1 --out study/moodle/smoke-plan.json
// Tasks: one repair task per break x model x rep (`repair:moodle/<b>/<model>/r<k>`), one arm-A/B/C task per pair and worker.
// `--kind smoke` names tasks smoke:moodle/..., `--kind campaign` campaign:moodle/... (the analysis treats only the latter as measured).
import { writeFileSync } from 'node:fs';
import { argOf } from './common.mjs';
import { repairJobs, nextFreeKey } from './campaign.mjs';
import { SELECTION_RULE, selectedPairs } from './v1-report.mjs';
import { GATE_STATEMENT, modeFields } from './mode.mjs';
import { readLines } from '../ledger/jsonl.mjs';
import { ledgerPaths } from '../ledger/paths.mjs';

const name = argOf('name'), kind = argOf('kind', 'smoke'), models = argOf('models').split(','), reps = Number(argOf('reps', 1)), out = argOf('out');
// --selected takes the pairs of the SELECTION_RULE (scripts/moodle/v1-report.mjs) from results/moodle-v1-reproduction.jsonl instead of --pairs; the rule is written into the plan.
const scoped = process.argv.includes('--selected'), pairList = scoped ? selectedPairs().map(p => `${p.break}.${p.fault}@${p.scenario}`) : argOf('pairs').split(',');
const arms = argOf('arms', 'A,B,C').split(','), spread = process.argv.includes('--spread-workers'), usedKeys = new Set(readLines(ledgerPaths().tasks).filter(e => e.type === 'task-planned').map(e => e.key));
const workerOf = (model, fallback) => spread ? `w${models.indexOf(model) % 3 + 1}` : fallback;
const pairs = pairList.map(x => { const [b, f] = x.split('@')[0].split('.'); return { break: b, fault: f }; });
const tasks = [];
import { loadManifest, faultTarget } from '../../adapters/moodle/manifest.mjs';
const manifest = loadManifest();
// the repair sample is the scenario(s) of this break's pairs (alt targets via @scenario)
const sampleOf = b => [...new Set(pairList.filter(x => x.split('.')[0] === b).map(x => { const [bf, sc] = x.split('@'); return faultTarget(manifest, bf.split('.')[1], sc).scenario; }))].join(',');
// fresh keys: an existing repair key is never reused (the next #N is taken); `task start` needs --reason for #N keys
// a smoke plan names its repair tasks smoke:moodle/<plan>/repair-<break>-<model>-r<k> (fresh keys, `smoke:` prefix); a campaign plan keeps repair:moodle/<break>/<model>/r<k>
const repairKey = j => kind === 'smoke' ? `smoke:moodle/${name}/repair-${j.break}-${j.model}-r${j.rep}` : j.taskKey;
const allowUnlisted = process.argv.includes('--allow-unlisted') && kind === 'smoke';   // smoke only: wiring checks on a pair the V1 report does not list as valid (passed on to campaign-run)
if (arms.includes('B')) for (const j of repairJobs({ pairs, models, reps })) tasks.push({ key: nextFreeKey(repairKey(j), usedKeys), cmd: ['node', 'scripts/moodle/repair-run.mjs', '--worker', workerOf(j.model, 'w1'), '--break', j.break, '--model', j.model, '--rep', String(j.rep), '--sample', sampleOf(j.break)] });
const list = pairList.join(',');
if (arms.includes('A')) tasks.push({ key: `${kind}:moodle/${name}/arm-a`, cmd: ['node', 'scripts/moodle/campaign-run.mjs', '--worker', 'w3', '--pairs', list, '--arms', 'A', ...(allowUnlisted ? ['--allow-unlisted'] : [])] });
for (const arm of ['B', 'C'].filter(a => arms.includes(a))) for (const model of models) tasks.push({ key: `${kind}:moodle/${name}/arm-${arm.toLowerCase()}-${model}`, cmd: ['node', 'scripts/moodle/campaign-run.mjs', '--worker', workerOf(model, arm === 'B' ? 'w1' : 'w2'), '--pairs', list, '--arms', arm, '--models', model, '--reps', String(reps), ...(allowUnlisted ? ['--allow-unlisted'] : [])] });
const modeTag = kind === 'campaign' ? modeFields() : {};   // campaign tasks carry studyMode + gatePassExists:false (docs/contracts/moodle-campaign.md)
for (const t of tasks) Object.assign(t, modeTag);
const plan = { plan: name, ...(kind === 'campaign' ? { ...modeFields(), statement: GATE_STATEMENT, ompCostCapUsd: 25 } : {}), ...(scoped ? { selectionRule: { ...SELECTION_RULE }, selectedPairs: pairList } : {}), models, drivers: [...new Set(models.map(m => m.startsWith('claude-') ? 'omp' : 'codex'))], prompts: {},
  pinPatterns: ['adapters/moodle/*.mjs', 'docker/moodle/behat/*', 'docker/moodle/versions.json', 'manifests/moodle.yaml', 'manifests/moodle/patches/*', 'scripts/moodle/*.mjs', 'scripts/ledger/*.mjs', 'scripts/drivers/*.mjs', 'scripts/codex-boundary.mjs', 'scripts/mcp-browser.mjs', 'package.json'], tasks };
writeFileSync(out, JSON.stringify(plan, null, 1) + '\n'); console.log(`${out}: ${tasks.length} tasks`);
