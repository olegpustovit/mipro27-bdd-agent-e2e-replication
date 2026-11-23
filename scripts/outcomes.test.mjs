import test from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './outcomes.mjs';
const defect = { evaluable: true, triggerWitnessed: true, completionWitnessed: false, defectObserved: true };
test('an action failure, timeout or absent trigger never counts as detected defect', () => {
  for (const options of [{ assertionFailure: false }, { timedOut: true }, { observation: { ...defect, triggerWitnessed: false } }, { modelVerified: false }, { scenarioCount: 0 }]) assert.equal(classify({ healthy: false, status: 'fail', observation: defect, assertionFailure: true, ...options }).detectionCandidate, false);
  assert.equal(classify({ healthy: false, status: 'fail', observation: defect, assertionFailure: true }).detectionCandidate, true);
});
test('claimed pass without witnessed completion is a false pass, never a correct pass', () => {
  const result = classify({ healthy: true, status: 'pass', observation: { ...defect, triggerWitnessed: false } });
  assert.equal(result.correctPass, false); assert.equal(result.unjustifiedPass, true);
});
