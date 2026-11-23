// Exploratory mode fields and the omp cost cap (scripts/moodle/mode.mjs, runTrials shouldStop, ledger task-planned fields).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { modeFields, ompCostState, ompCostGuard, GATE_STATEMENT } from './moodle/mode.mjs';
import { runTrials } from './ledger/trials.mjs';
import { ensureDirs, ledgerPaths } from './ledger/paths.mjs';
import { readLines } from './ledger/jsonl.mjs';

const H = 'claude-haiku-5-5';
const end = (key, model, arm, cost) => ({ type: 'trial-end', key, task: 't', attempt: 1, arm, model, meter: { reportedCostUsd: cost } });
test('mode fields say no gate pass', () => { assert.deepEqual(modeFields(), { studyMode: 'exploratory-owner-directed', gatePassExists: false }); assert.match(GATE_STATEMENT, /Evidence-plan gate STOP \/151/); });
test('ompCostState counts only this plan, haiku, model-calling trials; unknown cost is counted apart', () => {
  const ev = [end('p1/c/healthy/C/' + H + '/r1', H, 'C', 10), end('p1/B07.repair/broken-steps:B07/B/' + H + '/r1', H, 'B', 5), end('p1/c/healthy/B/' + H + '/r1', H, 'B', null), end('p1/c/h/C/' + H + '/r2', H, 'C', null),
    end('p2/c/healthy/C/' + H + '/r1', H, 'C', 99), end('p1/c/healthy/C/gpt-6-luna/r1', 'gpt-6-luna', 'C', 99)];
  assert.deepEqual(ompCostState(ev, 'p1'), { usd: 15, unknown: 1, trials: 3 });
});
test('runTrials stops scheduling haiku trials above the cap and records the stop; other models and finished trials are unaffected', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mode-')); process.env.STUDY_DATA_DIR = dir; const paths = ensureDirs(ledgerPaths());
  const specs = ['r1', 'r2', 'r3'].map(r => ({ key: `p1/c/healthy/C/${H}/${r}`, model: H, arm: 'C', block: 'x' })), luna = { key: 'p1/c/healthy/C/gpt-6-luna/r1', model: 'gpt-6-luna', arm: 'C', block: 'x' };
  const ran = [], runOne = cost => async s => { ran.push(s.key); return { arm: s.arm, model: s.model, costUsd: cost }; };
  const shouldStop = ompCostGuard({ short: 'p1', trialsPath: paths.trials, cap: 25 });
  const r = await runTrials({ taskKey: 't1', trials: [specs[0], luna, specs[1], specs[2]], seed: 's', shuffleBlocks: false, paths, runOne: runOne(26), shouldStop });
  assert.equal(r.stopped?.reason, 'omp-cost-cap');
  assert.ok(r.stopped.reportedCumulativeUsd > 25);
  const stops = readLines(paths.trials).filter(e => e.type === 'schedule-stopped');
  assert.equal(stops.length, 1); assert.equal(stops[0].capUsd, 25);
  assert.equal(ran.filter(k => k.includes(H)).length, 1); assert.ok(stops[0].key.includes(H)); assert.deepEqual(ran, r.order.slice(0, ran.length));
  assert.equal(readLines(paths.trials).filter(e => e.type === 'trial-end' && e.model === H).length, 1);   // only the first haiku trial ran
});

test('plan freeze copies gatePassExists:false and studyMode into task-planned', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mode-freeze-')), repo = join(dir, 'repo'), data = join(dir, 'data'); mkdirSync(join(repo, 'src'), { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repo }); writeFileSync(join(repo, 'src/a.mjs'), 'export const a = 1;\n');
  const manifest = join(repo, 'm.json');
  writeFileSync(manifest, JSON.stringify({ plan: 'pm', models: [], drivers: [], pinPatterns: ['src/*.mjs'], ...modeFields(), statement: GATE_STATEMENT, tasks: [{ key: 'campaign:moodle/pm/arm-a', cmd: ['true'], ...modeFields() }, { key: 'smoke:x', cmd: ['true'] }] }));
  execFileSync(process.execPath, [fileURLToPath(new URL('./study.mjs', import.meta.url)), 'plan', 'freeze', manifest], { env: { ...process.env, STUDY_DATA_DIR: data, STUDY_REPO_ROOT: repo } });
  const planned = readLines(join(data, 'tasks.jsonl')).filter(e => e.type === 'task-planned');
  assert.deepEqual(planned.map(e => [e.key, e.gatePassExists, e.studyMode]), [['campaign:moodle/pm/arm-a', false, 'exploratory-owner-directed'], ['smoke:x', undefined, undefined]]);
  assert.equal(readLines(join(data, 'tasks.jsonl')).find(e => e.type === 'plan-frozen').inputs.manifest.statement, GATE_STATEMENT);
});
