import test from 'node:test';
import assert from 'node:assert/strict';
import { phpFunctions, annotationRegex, patchHunks, impact, stepInImpact, targetKind, duplicates, structureRow, structureTotals, patchedText, repairImpact, renderStructure } from '../../scripts/moodle/pair-structure.mjs';
import { selectionWording } from '../../scripts/moodle/v1-report.mjs';

const PHP = `<?php
class behat_demo {
    /**
     * Searches.
     * @When /^I search for "(?P<query>[^"]*)" using the demo box$/
     */
    public function i_search($query) {
        $this->click_toggle();
        $this->fill($query);
    }
    private function click_toggle() {
        $this->execute('x');
    }
    /**
     * @Then /^the demo button for "(?P<name>[^"]*)" should be disabled$/
     */
    public function disabled($name) {
        return $name;
    }
    private function fill($q) {
        return $q;
    }
}
`;
const lineOf = needle => PHP.split('\n').findIndex(l => l.includes(needle)) + 1;
const hunk = (path, line, n = 1) => `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -${line},${n} +${line},${n} @@\n`;

test('phpFunctions reads docblock annotations and function ranges', () => {
  const { funcs } = phpFunctions(PHP);
  assert.deepEqual(Object.keys(funcs), ['i_search', 'click_toggle', 'disabled', 'fill']);
  assert.equal(funcs.i_search.annots.length, 1); assert.equal(funcs.click_toggle.annots.length, 0);
  assert.ok(annotationRegex(funcs.disabled.annots[0]).test('the demo button for "A" should be disabled'));
});
test('patchHunks reads the pin-side ranges per file', () => {
  const h = patchHunks(hunk('a/b.php', 10, 3) + hunk('c.php', 5));
  assert.deepEqual(h.map(x => [x.path, x.ranges]), [['a/b.php', [[10, 3]]], ['c.php', [[5, 1]]]]);
});
test('impact: a hunk in an annotated step definition names its pattern; a hunk in a helper follows same-file callers', () => {
  const direct = impact(hunk('p.php', lineOf('$this->fill($query)')), () => PHP);
  assert.deepEqual(direct.funcs, ['i_search']); assert.equal(stepInImpact('I search for "toads" using the demo box', direct), 'definition');
  assert.equal(stepInImpact('the demo button for "A" should be disabled', direct), 'none', 'a step of another definition is not in the impact');
  const viaHelper = impact(hunk('p.php', lineOf("$this->execute('x')")), () => PHP);
  assert.deepEqual(viaHelper.funcs, ['click_toggle']); assert.equal(stepInImpact('I search for "x" using the demo box', viaHelper), 'definition', 'helper edit reaches the calling step definition');
  assert.equal(impact(hunk('p.php', 1), () => null).unmapped, 1, 'unreadable file counted as unmapped');
});
test('impact: named-selector keys are matched by their quoted name', () => {
  const SEL = "<?php\nclass sel {\n    protected static $x = [\n        'blocky' => 'a',\n        'other' => 'b',\n    ];\n}\n";
  const im = impact(hunk('lib/named_selector.php', 5), () => SEL);
  assert.deepEqual(im.selectors, ['other']); assert.equal(stepInImpact('I click on "Go" "other"', im), 'selector'); assert.equal(stepInImpact('I click on "Go" "blocky"', im), 'none');
});
test('targetKind: visible-text and existence assertions versus others', () => {
  for (const t of ['I should see "x"', 'I should not see "x"', '".a" "css_element" should exist', '"b" "button" should not exist', '"A" "text" should appear after "B" "text" in the "U" "autocomplete"', 'I do not see "x"']) assert.equal(targetKind(t), 'visible-or-existence', t);
  for (const t of ['the manual completion button for "x" should be disabled', 'I click on "Save" "button"', 'I set the field "a" to "b"']) assert.equal(targetKind(t), 'other', t);
});
test('duplicates: same normalised text at other indices; unique text reports one occurrence', () => {
  const steps = [{ index: 0, text: 'I log in as "a"' }, { index: 1, text: 'I should see "x"' }, { index: 2, text: 'I click on "go" "button"' }, { index: 3, text: 'I should see   "x"' }];
  assert.deepEqual(duplicates(steps, 1, 'I should see "x"'), [1, 3]); assert.deepEqual(duplicates(steps, 2), [2]);
});
test('structureRow and totals: distance, position, kind, duplicates, text/index agreement', () => {
  const steps = [{ index: 0, text: 'a' }, { index: 1, text: 'I should see "x"' }, { index: 2, text: 'b' }, { index: 3, text: 'I should see "x"' }];
  const inDef = { patterns: ['^b$'], selectors: [], funcs: [], files: [], unmapped: 0 }, none = { patterns: [], selectors: [], funcs: [], files: [], unmapped: 0 };
  const r1 = structureRow({ pair: { break: 'B1', scenario: 'S1', fault: 'X1', target_step_index: 2, target_step_text: 'b' }, steps, biteIndex: 1, biteText: 'I should see "x"', im: inDef });
  assert.deepEqual([r1.distance, r1.position, r1.kind, r1.ambiguous, r1.target_text_matches_index], [1, 'target in a repaired step', 'other', false, true]);
  const r2 = structureRow({ pair: { break: 'B2', scenario: 'S1', fault: 'X1', target_step_index: 3, target_step_text: 'I should see "x"' }, steps, biteIndex: 0, im: none });
  assert.deepEqual([r2.distance, r2.position, r2.kind, r2.ambiguous, r2.duplicate_indices], [3, 'downstream', 'visible-or-existence', true, [1, 3]]);
  const t = structureTotals([r1, r2]); assert.deepEqual([t.pairs, t.in_changed_step, t.downstream, t.visible_or_existence, t.other_kind, t.duplicate_text, t.unique_text, t.distance_sum], [2, 1, 1, 1, 1, 1, 1, 4]);
  const text = renderStructure([r1, r2], t);
  assert.match(text, /TOTALS \(2 pairs\): target in a repaired step 1, downstream 1; kind visible-or-existence 1, other 1/); assert.match(text, /AMBIGUOUS PAIRS \(target text occurs more than once; flagged, not dropped\): B2\.X1@S1/);
  assert.match(text, /1 of the 2 selected targets|1 of the 2/);
});
test('patchedText applies one file of a patch; repairImpact locates edits in the running text', () => {
  const patch = `diff --git a/p.php b/p.php\n--- a/p.php\n+++ b/p.php\n@@ -19,3 +19,3 @@\n     public function disabled($name) {\n-        return $name;\n+        return strtoupper($name);\n     }\n`;
  const out = patchedText(PHP, 'p.php', patch); assert.match(out, /strtoupper/);
  assert.equal(patchedText(PHP, 'p.php', patch.replace('return $name;', 'return NOPE;')), null, 'a patch that does not apply gives null');
  assert.equal(patchedText(null, 'p.php', patch), null); assert.equal(patchedText(PHP, 'p.php', ''), PHP);
  const ri = repairImpact([{ path: 'p.php', old_text: '$this->fill($query);', new_text: '$this->fill(trim($query));' }, { path: 'p.php', old_text: 'return $name;', new_text: 'return 1;' }, { path: 'p.php', old_text: 'not there', new_text: 'x' }], () => PHP);
  assert.deepEqual(ri.funcs, ['disabled', 'i_search']); assert.equal(ri.unlocated, 1); assert.deepEqual(ri.files, ['p.php']); assert.equal(ri.patterns.length, 2);
});
test('selectionWording: strict counts pairs, one strict break; core pairs are the old step definitions run against the current UI', () => {
  const brk = (id, strict, before) => ({ break: id, reproduced_strict: strict, scenarios: [{ scenario: 'S1', before }] });
  const a = { breaks: [brk('B1', true, 'passed'), brk('B2', false, 'not-run'), brk('B3', false, 'failed')] };
  const sel = [{ break: 'B1', scenario: 'S1', valid_strict: true }, { break: 'B1', scenario: 'S1', valid_strict: true }, { break: 'B2', scenario: 'S1', valid_strict: false }, { break: 'B3', scenario: 'S1', valid_strict: false }];
  const w = selectionWording(sel, a, {});
  assert.match(w, /2 of 4 selected pairs are strict/); assert.match(w, /Only 1 of the 3 selected breaks is strict \(B1\)/); assert.match(w, /The 2 core pairs have no passing before state \(before state of their scenario: not-run 1, failed 1\)/);
  assert.match(w, /not "the effect of the named UI change"; it is the old step definitions from before the developers' fix, run against the current UI at the pin/);
});
