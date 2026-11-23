import assert from 'node:assert/strict';
import { acquireLock, freshBrowser, reset, flushUIObservation } from './fixture.mjs';
import { applyUIRevision } from './ui-revisions.mjs';
import { runValidationSuite } from './cumulative-runner.mjs';
import { createMaintenanceState } from './maintenance.mjs';
const unlock = acquireLock(), events = []; let browser, restore, quiescent = true;
const emit = event => { events.push(event); process.stdout.write(JSON.stringify({ ...event, excludedFromStudy: true }) + '\n'); };
try {
  restore = applyUIRevision('auth-login', 'v1'); await restore.ready(); await reset();
  browser = await freshBrowser({ observerVersion: 'v1' });
  await browser.context.addInitScript(() => {
    // The capture entry point is deliberately non-writable. Inject a single
    // rejection at its Promise-settlement dependency, then restore immediately.
    const settle = Promise.allSettled;
    Promise.allSettled = function (values) { Promise.allSettled = settle; throw new Error('PRIVATE_WORLD_SENTINEL'); };
  });
  const state = createMaintenanceState({ emit }); state.begin('v1', 'v0');
  await assert.rejects(runValidationSuite({ browser, state, emit, deadline: Date.now() + 60000 }), error => error.code === 'STUDY_INFRASTRUCTURE' && !error.message.includes('SENTINEL'));
  const failed = events.find(e => e.type === 'validation-case-error');
  assert.equal(failed.baseline.privateCaptureFailed, true); assert(failed.baseline.stepFailures.some(f => f.step && f.error.includes('PRIVATE_WORLD_SENTINEL')));
  assert.throws(() => state.validation(), /infrastructure failed/); assert.throws(() => state.repair({ actions: state.read().actions }), /infrastructure failed/);
  await flushUIObservation(browser.context, browser.witness);
  emit({ type: 'world-capture-failure-calibration', ok: true, namedCucumberFailureTransported: true, finalCaptureRecovered: true, wholeMaintenancePoisoned: true, actorReceivedOnlyGenericFailure: true });
} catch (error) { if (error.code === 'STUDY_UNQUIESCENT' || browser?.quiescenceFailed) quiescent = false; throw error; }
finally {
  await browser?.close();
  if (quiescent) try { restore?.(); await reset(); } finally { unlock(); }
}
