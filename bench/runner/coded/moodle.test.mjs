import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { resolveMoodleItem } from './moodle.mjs';

const bench = new URL('../../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('apps/moodle/changes.json', bench)));

test('every coded item in the P7c Moodle grid resolves against its manifest phase', t => {
  const changes = manifest.changes.filter(change => change.decision === 'chosen');
  assert.deepEqual(changes.map(change => change.id).sort(), ['B01', 'B04', 'B05', 'B07', 'B15']);
  let count = 0;
  let bugs = 0;
  for (const change of changes) {
    for (const scenario of change.scenarios.filter(entry => ['eligible', 'coded-only'].includes(entry.decision))) {
      const bugId = `mdl-${change.id}-${scenario.id}`;
      const bugPatch = new URL(`bugs/${bugId}/patch.diff`, bench);
      assert.equal(existsSync(bugPatch), scenario.decision === 'eligible', bugId);
      for (const [phase, arm] of [['pre', 'sd-old'], ['post', 'sd-old'], ['post', 'sd-new']]) {
        const conditions = phase === 'post' && existsSync(bugPatch) ? ['healthy', 'bug'] : ['healthy'];
        for (const condition of conditions) {
          const item = {
            app: 'mdl', change: change.id, scenario: scenario.id, phase, arm, condition,
            version: `${change.id}-${phase}`, bugId: condition === 'bug' ? bugId : null,
          };
          const resolved = resolveMoodleItem(item);
          const expected = scenario[phase];
          assert.deepEqual(resolved, {
            ...expected, name: scenario.name, commit: change.builds[phase].commit, arm,
            stepPatch: phase === 'post' && arm === 'sd-old'
              ? new URL(`moodle-steps/${change.id}.patch`, import.meta.url) : null,
            bugPatch: condition === 'bug' ? bugPatch : null,
          }, `${bugId}/${phase}/${arm}/${condition}`);
          assert.ok(existsSync(new URL(resolved.scenarioTextPath, bench)));
          if (resolved.stepPatch) assert.match(readFileSync(resolved.stepPatch, 'utf8'), /^diff --git /);
          if (resolved.bugPatch) {
            assert.match(readFileSync(resolved.bugPatch, 'utf8'), /^diff --git /);
            bugs++;
          }
          count++;
        }
      }
    }
  }
  assert.equal(count, 88);
  assert.equal(bugs, 34);
  t.diagnostic(`Resolved ${count} coded items, including ${bugs} bug items`);
});

test('rejects cross-change scenarios and bugs on the wrong build', () => {
  const item = {
    app: 'mdl', change: 'B01', scenario: 'S027', version: 'B01-post',
    phase: 'post', condition: 'bug', arm: 'sd-new', bugId: 'mdl-B01-S027',
  };
  assert.throws(() => resolveMoodleItem({ ...item, scenario: 'S042' }), /Unknown Moodle scenario/);
  assert.throws(() => resolveMoodleItem({ ...item, bugId: 'mdl-B07-S027' }), /Expected post-change Moodle bug/);
  assert.throws(() => resolveMoodleItem({ ...item, phase: 'pre', version: 'B01-pre' }), /Expected post-change Moodle bug/);
});
