// Pair logic of the V1 report for wave-2 faults: a pair is valid when the break bites in the scenario (strict: before passes too), the fault
// reproduced (screening + confirmation rerun) and the confirmation failed at or near the frozen target step.
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyse, stepClass, EXACT } from './moodle/v1-report.mjs';

const row = (status, extra = {}) => [{ round: 1, status, ...extra }];
const manifest = {
  scenarios: [{ id: 'S900' }, { id: 'S901' }], faults: [],
  breaks: [{ id: 'B90', mdl: 'MDL-1', class: 'ii', usable: true }, { id: 'B91', mdl: 'MDL-2', class: 'i', usable: true }],
  fault_candidates: [
    { id: 'C900', origin: 'mined', mdl: 'MDL-3', status: 'accepted', targets: [{ scenario: 'S900', step_index: 3, behat_step_index: 9, step_text: 'I should see "x"', frozen_at: 't0', confirm_class: 'at' }], confirm: { S900: { class: 'at', failing_step_index: 9, failing_step_text: 'I should see "x"' } } },
    { id: 'X900', origin: 'seeded', status: 'accepted', targets: [{ scenario: 'S900', step_index: 1, behat_step_index: 4, step_text: 'a', frozen_at: 't0', confirm_class: 'later' }], confirm: { S900: { class: 'later', failing_step_index: 20, failing_step_text: 'b' } } },
    { id: 'C902', origin: 'mined', mdl: 'MDL-4', status: 'accepted', targets: [{ scenario: 'S900', step_index: 3, behat_step_index: 9, step_text: 'I should see "x"', frozen_at: 't0', confirm_class: 'near' }], confirm: { S900: { class: 'near', failing_step_index: 10, failing_step_text: 'other' } } },
    { id: 'C901', origin: 'mined', status: 'rejected', targets: [] },
  ],
};
manifest.breakById = new Map(manifest.breaks.map(b => [b.id, b]));
manifest.scenarioById = new Map(manifest.scenarios.map(s => [s.id, s]));
manifest.faultById = new Map();
const rows = new Map([
  ['S900|healthy', row('passed')], ['S900|broken:B90', row('failed', { failingStepIndex: 7, failingStep: { text: 'p' } })], ['S900|before:B90', row('passed')],
  ['S900|broken:B91', row('failed', { failingStepIndex: 7, failingStep: { text: 'p' } })], ['S900|before:B91', row('failed', { failingStepIndex: 2, failingStep: { text: 'q' } })],
  ['S901|healthy', row('passed')], ['S901|broken:B90', row('passed')],
]);

test('step class: at (same index or text), near (<= 2), earlier, later', () => {
  assert.equal(stepClass(9, 9), 'at'); assert.equal(stepClass(5, 9, 't', 't'), 'at'); assert.equal(stepClass(11, 9), 'near'); assert.equal(stepClass(12, 9), 'later'); assert.equal(stepClass(3, 9), 'earlier');
});
test('wave-2 pairs: strict needs before-pass, a far failing step is never valid, origin is kept', () => {
  const a = analyse(manifest, rows, '/nonexistent'), p = (b, f) => a.pairs.find(x => x.break === b && x.fault === f);
  assert.equal(p('B90', 'C900').valid_strict, true); assert.equal(p('B90', 'C900').origin, 'mined');
  assert.equal(p('B91', 'C900').valid_strict, false); assert.equal(p('B91', 'C900').valid_core, true);   // before state fails: core only
  assert.equal(p('B90', 'X900').valid_strict, false); assert.equal(p('B90', 'X900').valid_core, false);   // failing step "later" than the target
  assert.equal(p('B90', 'X900').origin, 'seeded');
  assert.equal(a.pairs.some(x => x.fault === 'C901'), false);                                             // rejected candidates make no pairs
  assert.equal(a.pairs.some(x => x.scenario === 'S901'), false);                                          // the break does not bite in S901
});

test('exact step rule: a near failure (within 2 steps) never makes a valid pair; it stays visible as an old-rule pair', () => {
  const a = analyse(manifest, rows, '/nonexistent'), p = a.pairs.find(x => x.break === 'B90' && x.fault === 'C902');
  assert.equal(p.fault_step_vs_target, 'near'); assert.equal(p.valid_strict, false); assert.equal(p.valid_core, false);
  assert.equal(p.valid_old_rule, true);                   // valid under the first report's rule (within 2 steps)
  assert.equal(EXACT('near'), false); assert.equal(EXACT('at'), true);
});
test('break bite is measured in arm B\'s starting state: a break that bites only with the whole test half reverted makes no valid pair', () => {
  const m = { ...manifest, breaks: [{ id: 'B92', mdl: 'MDL-5', class: 'ii', usable: true, test_half_split: { identical_to_broken: false, empty: true, feature_files: ['f.feature'], step_files: [] } }] };
  m.breakById = new Map(m.breaks.map(b => [b.id, b]));
  const r = new Map([['S900|healthy', row('passed')], ['S900|broken:B92', row('failed', { failingStepIndex: 7, failingStep: { text: 'p' } })], ['S900|before:B92', row('passed')], ['S900|broken-steps:B92', row('passed')]]);
  const a = analyse(m, r, '/nonexistent'), b = a.breaks.find(x => x.break === 'B92'), p = a.pairs.find(x => x.break === 'B92' && x.fault === 'C900');
  assert.equal(b.start_state, 'broken-steps:B92'); assert.equal(b.reproduced_core, false); assert.equal(b.old_reproduced_core, true);
  assert.equal(p.valid_core, false); assert.equal(p.valid_strict, false); assert.equal(p.old_break_core, true); assert.equal(p.valid_old_rule, true);
});
