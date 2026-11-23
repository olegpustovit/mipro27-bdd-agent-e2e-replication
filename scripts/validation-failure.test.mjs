import test from 'node:test';
import assert from 'node:assert/strict';
import { runValidationSuite } from './cumulative-runner.mjs';
import { createMaintenanceState } from './maintenance.mjs';
import { createWitness } from './witness.mjs';
test('private validation failure poisons the whole maintenance phase without disclosing its reason to actor', async () => {
  const events = [], state = createMaintenanceState(); state.begin('v1', 'v0');
  const browser = { context: { pages: () => [], clearCookies: async () => { throw new Error('PRIVATE_ORACLE_SENTINEL'); } }, witness: createWitness(), terminate: async () => {} };
  await assert.rejects(runValidationSuite({ browser, state, emit: e => events.push(e), deadline: Date.now() + 1000 }), e => e.code === 'STUDY_INFRASTRUCTURE' && !e.message.includes('SENTINEL'));
  assert(events.some(e => e.error?.includes('PRIVATE_ORACLE_SENTINEL')));
  assert.throws(() => state.validation(), /infrastructure failed/);
  assert.throws(() => state.repair({ actions: state.read().actions }), /infrastructure failed/);
  assert.equal(state.finish('fatal test').revision, 'v1');
});
