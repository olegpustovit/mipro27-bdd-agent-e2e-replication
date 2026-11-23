import test from 'node:test';
import assert from 'node:assert/strict';
import { bounded } from './deadlines.mjs';
test('deadline aborts and drains work and termination before returning', async () => {
  let drained = false, terminated = false;
  await assert.rejects(bounded('fixture', signal => new Promise(resolve => signal.addEventListener('abort', () => setTimeout(() => { drained = true; resolve(); }, 5))), { deadline: Date.now() + 15, terminate: async () => { terminated = true; }, settleMs: 100 }), e => e.code === 'STUDY_BUDGET');
  assert(drained && terminated);
});
test('uncooperative work is marked unquiescent; already cancelled work never begins', async () => {
  await assert.rejects(bounded('stuck', () => new Promise(() => {}), { deadline: Date.now() + 5, settleMs: 10 }), e => e.code === 'STUDY_UNQUIESCENT');
  const controller = new AbortController(); controller.abort(); let began = false;
  await assert.rejects(bounded('cancelled', () => { began = true; }, { signal: controller.signal, deadline: Date.now() + 100 }), e => e.code === 'STUDY_BUDGET' || e.name === 'AbortError'); assert.equal(began, false);
});
test('termination rejection and nested unsettled work cannot become ordinary timeouts', async () => {
  await assert.rejects(bounded('failed termination', signal => new Promise(resolve => signal.addEventListener('abort', resolve)), { deadline: Date.now() + 5, terminate: async () => { throw new Error('kill failed'); } }), e => e.code === 'STUDY_UNQUIESCENT');
});
