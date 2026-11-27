import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolvePaymentSupport } from './pay.mjs';

test('v1 sd-cur uses the versioned World and scenario support', () => {
  assert.deepEqual(resolvePaymentSupport({ version: 'v1', arm: 'sd-cur', scenario: 'auth-login' }), {
    file: 'study/scenarios.feature',
    world: 'bench/stepdefs/pay/v1/world.mjs',
    support: 'bench/stepdefs/pay/v1/social.mjs',
  });
  assert.deepEqual(resolvePaymentSupport({ version: 'v1', arm: 'sd-cur', scenario: 'hold-01' }), {
    file: 'bench/scenarios/pay/hold-out/hold-01.feature',
    world: 'bench/stepdefs/pay/v1/world.mjs',
    support: 'bench/stepdefs/pay/v1/hold-out.mjs',
  });
});

test('v1 sd-stale uses the legacy v0 World and v0 scenario support', () => {
  assert.deepEqual(resolvePaymentSupport({ version: 'v1', arm: 'sd-stale', scenario: 'auth-login' }), {
    file: 'study/scenarios.feature',
    world: 'study/world.mjs',
    support: 'bench/stepdefs/pay/v0/social.mjs',
  });
});
