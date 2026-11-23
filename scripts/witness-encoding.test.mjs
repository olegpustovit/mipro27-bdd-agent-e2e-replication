import test from 'node:test';
import assert from 'node:assert/strict';
import { compactWitness } from './witness-encoding.mjs';
import { expandCapturedWitness } from './scenario-evaluation.mjs';
test('lossless witness transport preserves repeated states, actions and exact ordering without mutating evidence', () => {
  const state = { path: '/user/settings', value: 'Study' };
  const raw = { attemptId: 4, events: [{ kind: 'ui-state', browserSequence: 1, state },
    { kind: 'click', browserSequence: 2, targetVisible: true }, { kind: 'ui-state', browserSequence: 3, state: { ...state } }] };
  const original = structuredClone(raw), encoded = compactWitness(raw), decoded = expandCapturedWitness(encoded);
  assert.equal(encoded.states.length, 1); assert.deepEqual(decoded.events, raw.events); assert.deepEqual(raw, original);
  assert.equal(encoded.attemptId, 4); assert.throws(() => compactWitness(encoded));
});
