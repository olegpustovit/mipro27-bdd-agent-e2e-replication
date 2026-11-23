import test from 'node:test';
import assert from 'node:assert/strict';
import { checkKind, summarizeChecks, contracts } from '../study/contracts.mjs';
import { cases } from '../study/manifest.mjs';

test('hidden implementation inconsistencies cannot silently fail the public test contract', () => {
  const checks = [
    { name: 'visible-exact-transfer', ok: true, kind: checkKind('visible-exact-transfer') },
    { name: 'required-reload-after-action', ok: true, kind: 'completion' },
    { name: 'exact-transaction-fields', ok: false, kind: checkKind('exact-transaction-fields') },
  ];
  const outcome = summarizeChecks(checks, true);
  assert.equal(outcome.valid, true);
  assert.equal(outcome.defectObserved, false);
  assert.deepEqual(outcome.auditMismatches, ['exact-transaction-fields']);
  checks[0].ok = false;
  assert.equal(summarizeChecks(checks, true).valid, false);
  assert.deepEqual(summarizeChecks(checks, true).violatedPredicates, ['visible-exact-transfer']);
});

test('a reload or stored state without this attempt action is never successful completion', () => {
  const checks = [{ name: 'visible-first-name', ok: true, kind: 'contract' }, { name: 'required-reload-after-action', ok: true, kind: 'completion' }];
  assert.equal(summarizeChecks(checks, false).valid, false);
  assert.equal(summarizeChecks(checks, false).defectObserved, false);
});

test('all retained scenarios have a common explicit operational contract', () => {
  assert.deepEqual(Object.keys(contracts).sort(), cases.map(c => c.id).sort());
});
