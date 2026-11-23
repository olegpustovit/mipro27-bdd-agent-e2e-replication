import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
import { installUIObserver, observerMappings } from './ui-observer.mjs';

test('stalled private bindings stop admission permanently and the capture waits only for its bounded prefix', { timeout: 30000 }, async () => {
  const handlers = new Map();
  let calls = 0;
  const window = { __studyUIWitness() { calls++; return new Promise(() => {}); }, addEventListener() {} };
  const document = { addEventListener(type, fn) { handlers.set(type, fn); }, querySelectorAll() { return []; } };
  const sandbox = { window, document, location: { origin: 'http://localhost:3000', pathname: '/signin' },
    crypto: { randomUUID }, performance: { timeOrigin: Date.now(), now: () => 0 },
    getComputedStyle: () => ({ visibility: 'visible', display: 'block' }),
    HTMLFormElement: class {}, setTimeout, clearTimeout, queueMicrotask, console };
  runInNewContext('(' + installUIObserver.toString() + ')(' + JSON.stringify({ mapping: observerMappings.v0, observerVersion: 'v0', expectedPassword: 'synthetic', sampleUI: false }) + ')', sandbox);
  const target = { tagName: 'BUTTON', textContent: 'Continue', name: '', form: null,
    matches() { return false; },
    getBoundingClientRect() { return { width: 100, height: 20 }; },
    getAttribute() { return null; }, closest(selector) { return selector.startsWith('button,') ? this : null; } };
  const action = () => handlers.get('click')({ type: 'click', target });
  action();
  const began = performance.now();
  const barrier = window.__studyCaptureUI();
  // These are admitted after the capture's sequence prefix, not added to its
  // completion condition. Deliberately never acknowledge the underlying RPCs.
  const timer = setInterval(action, 10);
  const result = await barrier;
  clearInterval(timer);
  assert(performance.now() - began < 12000);
  assert.match(result.metrics.failure, /saturated|exceeded 10000ms/);
  assert(calls <= 64, 'unacknowledged underlying RPCs exceeded the bound');
  const stoppedAt = calls;
  for (let i = 0; i < 100; i++) action();
  assert.equal(calls, stoppedAt, 'terminal failure admitted more underlying RPCs');
});
