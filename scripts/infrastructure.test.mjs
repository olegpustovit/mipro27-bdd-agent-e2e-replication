import test from 'node:test';
import assert from 'node:assert/strict';
import { createBaselineTools } from './baseline-tools.mjs';
import { assertNoInfrastructureFailure, isCleanProxyExit, requireAuditCompletion } from './infrastructure.mjs';

test('a retained rerun connection failure is fatal and cannot credit an earlier passing run', async () => {
  const ledger = [{ type: 'baseline-run', code: 0, oracle: { valid: true } }];
  const tools = createBaselineTools({ caseId: 'auth-login', endpoint: 'http://127.0.0.1:1', requestHost: async () => { throw new Error('must not reach observer'); } });
  await assert.rejects(tools('baseline_run', {}), error => {
    assert.equal(error.code, 'STUDY_INFRASTRUCTURE');
    ledger.push({ type: 'fatal-infrastructure', error: error.message });
    return true;
  });
  assert.throws(() => assertNoInfrastructureFailure(ledger), /Retained rerun infrastructure failed/);
});

test('missing private terminal evidence cannot score an earlier retained result', async () => {
  await assert.rejects(requireAuditCompletion([]), /Expected one/);
  await assert.rejects(requireAuditCompletion([{ completed: false, closed: Promise.resolve() }]), /acknowledgement is missing/);
  await assert.rejects(requireAuditCompletion([{ completed: true, error: 'channel failed', closed: Promise.resolve() }]), /channel failed/);
  await assert.rejects(requireAuditCompletion([{ completed: true, closed: new Promise(() => {}) }], { timeoutMs: 10 }), /did not finish/);
  await requireAuditCompletion([{ completed: true, closed: Promise.resolve() }]);
});

test('EOF cannot turn a signalled or nonzero browser exit into private success', () => {
  const clean = { code: 0, signal: null, inputClosed: true, pendingRequests: 0 };
  assert.equal(isCleanProxyExit(clean), true);
  for (const override of [{ code: null, signal: 'SIGKILL' }, { code: 1 }, { inputClosed: false }, { pendingRequests: 1 }]) {
    assert.equal(isCleanProxyExit({ ...clean, ...override }), false);
  }
});

test('deadline-triggered shutdown reports preserve timeout precedence, earlier failures stay fatal', () => {
  const afterDeadline = [{ type: 'fatal-infrastructure', error: 'shutdown', receivedAt: 101 }];
  assert.doesNotThrow(() => assertNoInfrastructureFailure(afterDeadline, { timeoutAt: 100 }));
  assert.throws(() => assertNoInfrastructureFailure(afterDeadline), /shutdown/);
  assert.throws(() => assertNoInfrastructureFailure([{ type: 'fatal-infrastructure', error: 'earlier', receivedAt: 99 }], { timeoutAt: 100 }), /earlier/);
  assert.throws(() => assertNoInfrastructureFailure([{ type: 'fatal-infrastructure', error: 'unknown time' }], { timeoutAt: 100 }), /unknown time/);
});
