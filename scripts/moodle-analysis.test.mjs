import test from 'node:test';
import assert from 'node:assert/strict';
import { judge, observed, atTarget } from './analysis/moodle-oracle.mjs';
import { parseKey, judgeAll, summarize, build } from './analysis/moodle.mjs';
import { campaignTrials, repairJobs, repairTaskKey } from './moodle/campaign.mjs';
import { stackPatches } from '../adapters/moodle/state-text.mjs';
import { loadManifest, resolveTarget } from '../adapters/moodle/manifest.mjs';
import { dataHome, resolveMoodleCommit } from '../adapters/moodle/config.mjs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const target = { step_index: 5, step_text: 'I should see "x"' };
const A = (status, idx, text) => ({ arm: 'A', status, failingStepIndex: idx ?? null, failingStep: idx == null ? null : { text: text ?? 'other' } });
const C = (status, idx, verified = true) => ({ arm: 'C', status, behatStepIndex: idx ?? null, failingStepVerified: verified && idx != null, verdict: { failingStepText: 'y' } });

test('summary counts healthy failures from normalized outcomes', () => {
  const result = judge({ healthy: A('failed', 2), faulted: A('failed', 5), target });
  const [row] = summarize([{ ...result, arm: 'A', model: 'none', keyHealthy: 'healthy' }]);
  assert.equal(row.healthyFail, 1);
  assert.equal(row['false-alarm'], 1);
});

test('oracle: caught needs healthy pass and fail at the target step', () => {
  assert.equal(judge({ healthy: A('passed'), faulted: A('failed', 5), target }).outcome, 'caught');
  assert.equal(judge({ healthy: A('passed'), faulted: A('failed', 3), target }).outcome, 'fail-near');
  assert.equal(judge({ healthy: A('passed'), faulted: A('failed', 1), target }).outcome, 'fail-elsewhere');
  assert.equal(judge({ healthy: A('passed'), faulted: A('failed', 3, 'Then I should see "x"'), target }).outcome, 'caught', 'same step text counts as the target step');
  assert.equal(judge({ healthy: A('passed'), faulted: A('passed'), target }).outcome, 'missed');
  assert.equal(judge({ healthy: A('failed', 2), faulted: A('failed', 5), target }).outcome, 'false-alarm');
  assert.equal(judge({ healthy: A('error'), faulted: A('failed', 5), target }).outcome, 'invalid-healthy');
  assert.equal(judge({ healthy: A('passed'), faulted: A('error'), target }).outcome, 'invalid-faulted');
  assert.equal(judge({ healthy: A('passed'), faulted: null, target }).outcome, 'incomplete');
});
test('oracle: agent verdicts count only with a verified step; tolerance is opt-in', () => {
  assert.equal(judge({ healthy: C('pass'), faulted: C('fail', 5), target }).outcome, 'caught');
  assert.equal(judge({ healthy: C('pass'), faulted: C('fail', 5, false), target }).outcome, 'fail-unlocated');
  assert.equal(judge({ healthy: C('pass'), faulted: C('unresolved'), target }).outcome, 'invalid-faulted');
  assert.equal(judge({ healthy: C('pass'), faulted: C('fail', 6), target }).outcome, 'fail-near');
  assert.equal(judge({ healthy: C('pass'), faulted: C('fail', 6), target, tolerance: 1 }).outcome, 'caught');
  assert.equal(observed(C('unresolved')).status, 'invalid');
  assert.equal(atTarget({ located: false, stepIndex: 5 }, target), false);
});
test('trial keys follow the ledger contract and parse back', () => {
  const k = parseKey('abcdef123456/B03.S003/fault:F03/C/claude-haiku-5-5/r2');
  assert.deepEqual(k, { short: 'abcdef123456', caseId: 'B03.S003', state: 'fault:F03', arm: 'C', model: 'claude-haiku-5-5', rep: 2 });
  assert.equal(parseKey('x/y/z'), null);
});
test('plan generator: A is model-free and single, B/C multiply by model and repetition, healthy is shared across faults', () => {
  const pairs = [{ break: 'B03', fault: 'F03', scenario: 'S003' }, { break: 'B03', fault: 'F04', scenario: 'S003' }];
  const t = campaignTrials({ pairs, short: 'p', models: ['m1', 'm2'], reps: 2 });
  assert.equal(t.filter(x => x.arm === 'A').length, 3);            // healthy + 2 faults
  assert.equal(t.filter(x => x.arm === 'B').length, 3 * 2 * 2);
  assert.equal(new Set(t.map(x => x.key)).size, t.length);
  assert.ok(t.every(x => /^p\/B03\.S003\/(healthy|fault:F0[34])\/[ABC]\/(none|m1|m2)\/r[12]$/.test(x.key)));
  assert.deepEqual(repairJobs({ pairs, models: ['m1'], reps: 2 }).map(j => j.taskKey), ['repair:moodle/B03/m1/r1', 'repair:moodle/B03/m1/r2']);
  assert.equal(repairTaskKey('B06', 'claude-haiku-5-5', 1), 'repair:moodle/B06/claude-haiku-5-5/r1');
});
test('analysis separates smoke from measured and labels smoke as not measured', () => {
  const src = join(dataHome(), 'src', resolveMoodleCommit().slice(0, 12));
  if (!existsSync(src)) return;   // needs the pinned Moodle checkout (step indices are resolved against the pin)
  const manifest = loadManifest(), f = manifest.faults[2], s = f.target.scenario, b = f.linked_breaks[0], idx = resolveTarget(manifest, f, src).behatIndex;
  const end = (state, body, task = 'smoke:moodle/x') => ({ type: 'trial-end', key: `p/${b}.${s}/${state}/A/none/r1`, task, outcome: 'recorded', arm: 'A', meter: { wall: {} }, ...body });
  const events = [end('healthy', { status: 'passed' }), end(`fault:${f.id}`, { status: 'failed', failingStepIndex: idx, failingStep: { text: f.target.step_text } })];
  const out = build(events, manifest, {});
  assert.match(out.smoke, /NOT measured/); assert.match(out.smoke, /caught/); assert.match(out.campaign, /no trials recorded/);
});
test('stacked patches must touch disjoint files', () => {
  const p = f => `diff --git a/${f} b/${f}\n--- a/${f}\n+++ b/${f}\n@@ -1 +1 @@\n-a\n+b\n`;
  assert.match(stackPatches([p('x'), p('y')]), /a\/x[\s\S]*a\/y/);
  assert.throws(() => stackPatches([p('x'), p('x')]), /both touch x/);
});

test('trial keys of seeded and mined wave-2 faults (X, C) parse like the original F faults', async () => {
  const { parseKey } = await import('./analysis/moodle.mjs');
  for (const f of ['F01', 'X010', 'C007']) assert.equal(parseKey(`abc123/B12.S076/fault:${f}/C/gpt-6-luna/r1`)?.state, `fault:${f}`);
  assert.equal(parseKey('abc123/B01.repair/broken:B01/B/gpt-5.6-terra/r1#2')?.model, 'gpt-5.6-terra');
});

test('budget projection: counts follow the plan generator; the selection rule replaces the scope rule; the 240M cap is the binding budget', async () => {
  const { project, selectedPairs, MODELS, PILOT, TOKEN_CAP, render } = await import('./moodle/budget.mjs');
  const campaign = await import('./moodle/campaign.mjs');
  assert.equal(campaign.SCOPE_RULE, undefined); assert.equal(campaign.applyScopeRule, undefined);   // the 15 -> 13 rule is gone (history in docs)
  const pairs = selectedPairs(), means = { A: { wallMs: 1000 } };
  for (const m of MODELS) means[m] = { c: { n: 1, tokens: PILOT[m].tokens * 1.5, wallMs: 1000, tools: 10 }, r: { n: 1, tokens: 100000, wallMs: 1000 }, b: { n: 1, wallMs: 1000 } };
  const p = project({ pairs, means }), breaks = new Set(pairs.map(x => x.break)).size;
  assert.ok(pairs.length > 0 && pairs.length <= 16);
  assert.deepEqual([p.counts.trialsBC, p.counts.repairs, p.counts.trialsA], [pairs.length * 2 * 2 * 3 * 2, breaks * 3 * 2, pairs.length * 2]);   // pairs x states x arms x models x reps ; breaks x models x reps ; pairs x states
  assert.equal(TOKEN_CAP, 240e6);
  p.selection = { pairs: [], counts: { total: 0, byClass: [], byBreak: [], byOrigin: [], byBite: [] } };
  assert.match(render(p, means), /BINDING BUDGET CHECK: original cap 240M tokens in total/);
});

// ---- arm B at the unit level, repair edits, independence of arms A and C ----
import { repairRecords, armBPairRows, armBUnits, renderArmB, independence, renderIndependence } from './analysis/moodle.mjs';
import { parseSelected, smokeTrials } from './moodle/timeline.mjs';
const PHP_STEPS = `<?php
class behat_demo {
    /**
     * @When /^I search for "(?P<q>[^"]*)" using the demo box$/
     */
    public function i_search($q) {
        $this->execute('click');
    }
    /**
     * @Then /^the demo button should be disabled$/
     */
    public function disabled() {
        return 1;
    }
}
`;
const repairEvent = (key, edits, over = {}) => ({ key, caseId: key.split('/')[1], model: 'm1', rep: 1, kind: 'repair', state: 'broken-steps:B1', body: { edits, editedFiles: [...new Set(edits.map(e => e.path))], policyState: { acceptedEdits: edits.length, scenarioRuns: 2 }, allSamplePass: true, ...over } });
const startTextOf = () => path => path === 'p.php' ? PHP_STEPS : null;
const bRow = (o = {}) => ({ arm: 'B', fault: 'X1', break: 'B1', scenario: 'S1', caseId: 'B1.S1', model: 'm1', rep: 1, outcome: 'caught', target: 4, targetText: 'the demo button should be disabled', repairKey: 'pl/B1.repair/broken-steps:B1/B/m1/r1', keyFaulted: 'pl/B1.S1/fault:X1/B/m1/r1', ...o });

test('arm B: a repair that edits the definition the target step uses is flagged; others are not, unmapped edits are not "none"', () => {
  const recs = repairRecords([
    repairEvent('pl/B1.repair/broken-steps:B1/B/m1/r1', [{ path: 'p.php', old_text: 'return 1;', new_text: 'return 2;' }]),
    repairEvent('pl/B2.repair/broken-steps:B1/B/m1/r1', [{ path: 'p.php', old_text: "$this->execute('click');", new_text: "$this->execute('tap');" }]),
    repairEvent('pl/B3.repair/broken-steps:B1/B/m1/r1', [{ path: 'q.php', old_text: 'x', new_text: 'y' }]),
  ].map(e => ({ ...e, caseId: e.key.split('/')[1] })), { startTextOf });
  assert.deepEqual(recs.map(r => r.editedFiles), [['p.php'], ['p.php'], ['q.php']]); assert.deepEqual(recs[0].editedFuncs, ['disabled']);
  const rows = armBPairRows([bRow(), bRow({ repairKey: recs[1].key, keyFaulted: 'pl/B2.S1/fault:X1/B/m1/r1', break: 'B2' }), bRow({ repairKey: recs[2].key, break: 'B3', keyFaulted: 'pl/B3.S1/fault:X1/B/m1/r1' }), bRow({ repairKey: 'pl/none', keyFaulted: 'pl/B4.S1/fault:X1/B/m1/r1', break: 'B4' })], recs);
  assert.deepEqual(rows.map(r => r.targetDefEdited), ['definition', 'none', 'unmapped', 'unknown']);
});
test('arm B units: one repair per plan x break x model x repetition, pair rows listed under it; totals count what the repair serves', () => {
  const recs = repairRecords([repairEvent('pl/B1.repair/broken-steps:B1/B/m1/r1', [{ path: 'p.php', old_text: 'return 1;', new_text: 'return 2;' }])], { startTextOf });
  const rows = armBPairRows([bRow(), bRow({ scenario: 'S2', caseId: 'B1.S2', keyFaulted: 'pl/B1.S2/fault:X1/B/m1/r1' }), bRow({ rep: 2, keyFaulted: 'pl/B1.S1/fault:X1/B/m1/r2', repairKey: 'pl/B1.repair/broken-steps:B1/B/m1/r2' })], recs);
  const units = armBUnits(rows, recs); assert.equal(units.length, 2); assert.deepEqual(units.map(u => [u.rep, u.pairs.length, !!u.repair]), [[1, 2, true], [2, 1, false]]);
  const text = renderArmB(rows, recs, 'test'); assert.match(text, /one break-level repair per break x model x repetition/); assert.match(text, /arm B pair rows 3 over 2 repair units/); assert.match(text, /target def edited: definition/);
  assert.match(renderArmB([], [], 'none'), /no arm B repair sessions or pair rows recorded/);
});
test('arms A and C are grouped by fault, scenario, model and repetition, not by break', () => {
  const r = (arm, br, o = {}) => ({ arm, break: br, fault: 'X1', scenario: 'S1', model: 'none', rep: 1, outcome: 'caught', ...o });
  const g = independence([r('A', 'B1'), r('A', 'B7'), r('C', 'B1', { model: 'm' }), r('B', 'B1')]);
  assert.equal(g.length, 2); assert.deepEqual(g.find(x => x.key.startsWith('A')).breaks, ['B1', 'B7']);
  assert.match(renderIndependence([r('A', 'B1'), r('A', 'B7')]), /distinct .* units 1; units planned under more than one break 1/);
  assert.match(renderIndependence([r('A', 'B1'), r('A', 'B7', { outcome: 'missed' })]), /units whose rows disagree on the outcome 1/);
  assert.match(renderIndependence([]), /do not depend on the break|DO NOT DEPEND ON THE BREAK/i);
});
test('timeline: SELECTED PAIRS block parsing and smoke trial extraction (arm A is model-free and is not listed as model-driven)', () => {
  const txt = 'x\nSELECTED PAIRS: 2 pairs\n#   break class bite   scen  fault origin  target@ fail@   vs     target step\n1   B07   i     strict S028  X010  seeded  4       4       at     t\n2   B04   i     core   S036  X014  seeded  8       8       at     t\n\nnext';
  assert.deepEqual(parseSelected(txt), [{ break: 'B07', scenario: 'S028', fault: 'X010' }, { break: 'B04', scenario: 'S036', fault: 'X014' }]);
  const ev = [
    { type: 'trial-start', key: 'pl/B1.S1/fault:X1/C/m/r1', task: 'smoke:t', attempt: 1, at: '2026-01-01T00:00:00.000Z' },
    { type: 'trial-end', key: 'pl/B1.S1/fault:X1/C/m/r1', task: 'smoke:t', attempt: 1, status: 'fail', behatStepIndex: 4, failingStepVerified: true, at: '2026-01-01T00:01:00.000Z' },
    { type: 'trial-end', key: 'pl/B1.S1/healthy/C/m/r1', task: 'smoke:t', attempt: 1, status: 'pass', at: '2026-01-01T00:02:00.000Z' },
    { type: 'trial-end', key: 'pl/B1.S1/healthy/A/none/r1', task: 'smoke:t', attempt: 1, status: 'passed', at: '2026-01-01T00:03:00.000Z' },
    { type: 'trial-end', key: 'pl/B1.repair/broken:B1/B/m/r1', task: 'repair:moodle/B1/m/r1', attempt: 1, sample: ['S1'], allSamplePass: true, at: '2026-01-01T00:04:00.000Z' },
    { type: 'trial-end', key: 'pl/B1.S1/fault:X1/C/m/r1', task: 'campaign:x', attempt: 1, status: 'fail', at: '2026-01-01T00:05:00.000Z' },
  ];
  const t = smokeTrials(ev);
  assert.equal(t.filter(x => !x.modelFree).length, 3); assert.equal(t.filter(x => x.modelFree).length, 1);
  assert.equal(t.find(x => x.state === 'healthy' && x.arm === 'C').fault, 'X1', 'a healthy trial takes the fault of its fault-state partner');
  assert.deepEqual(t.find(x => x.repair).faults, ['X1@S1']); assert.equal(t.find(x => x.arm === 'C' && x.state.startsWith('fault')).start, '2026-01-01T00:00:00.000Z');
});
