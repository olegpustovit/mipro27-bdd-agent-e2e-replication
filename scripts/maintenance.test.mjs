import test from 'node:test';
import assert from 'node:assert/strict';
import { createMaintenanceState, implementation, createMaintenanceTools } from './maintenance.mjs';

test('shared edits carry forward once and frozen fault probes cannot mutate them', () => {
  const events = [], state = createMaintenanceState({ emit: e => events.push(e) });
  const v0 = state.frozen('v0');
  assert.throws(() => state.repair({ actions: v0.actions }));
  state.begin('v1', 'v0');
  const v1Selectors = { ...v0.selectors, signIn: 'role=button[name="Continue"]' };
  state.repair({ locators: v1Selectors }); state.validation();
  const v1 = state.finish('last submitted candidate');
  assert.notEqual(v1.implementation.sha256, v0.sha256);
  assert.equal(state.frozen('v0').sha256, v0.sha256);
  const probe = state.frozen('v1'); probe.selectors.signIn = 'corruption';
  assert.equal(state.frozen('v1').selectors.signIn, v1Selectors.signIn);
  assert.throws(() => state.repair({ locators: v0.selectors }));
  state.begin('v2', 'v1'); assert.equal(state.read().sha256, v1.implementation.sha256);
  assert.equal(events.filter(e => e.type === 'maintenance-edit').length, 1);
});

test('edits are atomic, order-only locator changes are no-ops and validation limits are shared', () => {
  const state = createMaintenanceState({ maxEdits: 1, maxValidations: 1 }); state.begin('v1', 'v0');
  const before = state.read();
  assert.equal(state.repair({ locators: Object.fromEntries(Object.entries(before.selectors).reverse()) }).changed, false);
  assert.throws(() => state.repair({ actions: 'invalid source', locators: before.selectors }));
  assert.equal(state.read().sha256, before.sha256);
  state.repair({ locators: { ...before.selectors, signIn: 'role=button[name="Continue"]' } });
  assert.throws(() => state.repair({ locators: { ...before.selectors, signIn: 'role=button[name="Other"]' } }));
  state.validation(); assert.throws(() => state.validation());
  const frozen = state.finish('validation incomplete');
  assert.equal(frozen.implementation.selectors.signIn, 'role=button[name="Continue"]', 'freeze latest accepted artifact rather than selecting the best validation');
  assert.equal(implementation(frozen.implementation).sha256, frozen.implementation.sha256);
});

test('maintenance tools delegate only the declared read/repair/validate interface', async () => {
  const calls = [], handler = createMaintenanceTools(async (name, args) => { calls.push({ name, args }); return { accepted: true }; });
  await handler('baseline_read', {}); await handler('baseline_repair', { actions: 'candidate' }); await handler('baseline_validate', {});
  assert.deepEqual(calls.map(c => c.name), ['maintenance-read', 'maintenance-repair', 'maintenance-validate']);
  await assert.rejects(handler('baseline_run', {})); await assert.rejects(handler('baseline_validate', { caseId: 'easy-only' }));
});
