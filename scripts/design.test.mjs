import test from 'node:test';
import assert from 'node:assert/strict';
import { cases, plan } from '../study/manifest.mjs';
import { replaceChecked, variantSources, pristineSources, faults, benign } from './mutations.mjs';
test('fixed paired design contains 144 paired cells and 288 executions across six workflow families', () => {
  assert.equal(cases.length, 12); assert.equal(new Set(cases.map(c => c.family)).size, 6);
  const trials = plan(); assert.equal(trials.length, 288);
  const cells = new Map();
  for (const t of trials) { const key = `${t.caseId}/${t.condition}/${t.repetition}`; cells.set(key, [...(cells.get(key) || []), t.arm]); }
  assert.equal(cells.size, 144);
  for (const arms of cells.values()) assert.deepEqual([...arms].sort(), ['maintained', 'runtime']);
});
test('all predeclared mutations apply exactly once and preserve pristine inputs', () => {
  const original = pristineSources();
  for (const c of cases) {
    assert.deepEqual(variantSources(c.id, 'reference', original), original);
    for (const condition of ['ui', 'fault', 'ui-fault']) {
      const changed = variantSources(c.id, condition, original);
      assert.notDeepEqual(changed, original);
      if (condition.includes('fault')) { const [path, , after] = faults[c.id]; assert(changed[path].includes(after)); }
      if (condition.includes('ui')) for (const [path, , after] of benign) assert(changed[path].includes(after));
    }
  }
  assert.throws(() => replaceChecked('aa', 'a', 'b'));
  assert.throws(() => variantSources('not-a-case', 'reference', original));
});
