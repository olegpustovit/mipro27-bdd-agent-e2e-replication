import test from 'node:test';
import assert from 'node:assert/strict';
import { createWitness, beginAttempt, recordWitness, snapshotWitness, findReloadAfter, observationLedgerError, acknowledgedEvents } from './witness.mjs';

test('earlier validation, reload and authentication cannot credit a repaired rerun', () => {
  const witness = createWitness();
  recordWitness(witness, 0, { kind: 'authenticated' });
  recordWitness(witness, 0, { kind: 'input', name: 'email', value: 'invalid-email', emailValidation: { saveDisabled: true, errorVisible: true } });
  recordWitness(witness, 0, { kind: 'load', path: '/user/settings' });
  const initial = snapshotWitness(witness);
  const current = beginAttempt(witness, 'retained-rerun-2');
  assert.equal(witness.signedIn, false);
  assert.deepEqual(witness.events, []);
  assert.equal(recordWitness(witness, 0, { kind: 'load', path: '/user/settings' }), false);
  assert.equal(recordWitness(witness, 0, { kind: 'authenticated' }), false);
  assert.deepEqual(witness.events, []);
  assert.equal(witness.signedIn, false);
  assert.equal(initial.events.length, 3);
  assert.equal(initial.signedIn, true);
  assert.equal(witness.history.length, 5);
  recordWitness(witness, current, { kind: 'load', path: '/signin' });
  assert.equal(witness.events.length, 1);
  assert.equal(initial.events.length, 3);
});

test('a required reload needs the correct trigger and a newly committed reload document', () => {
  const trigger = { kind: 'click', documentId: 'before', path: '/user/settings' };
  const stale = { kind: 'navigation', navigationType: 'reload', documentId: 'old', persisted: false, path: '/user/settings' };
  const navigated = { kind: 'navigation', navigationType: 'navigate', documentId: 'new', path: '/user/settings' };
  assert.equal(findReloadAfter([stale, trigger, navigated], 1, '/user/settings'), null);
  assert.equal(findReloadAfter([trigger, stale], -1, '/user/settings'), null);
  assert.equal(findReloadAfter([trigger, { ...stale, documentId: 'before' }], 0, '/user/settings'), null);
  assert.equal(findReloadAfter([trigger, stale], 0, '/bankaccounts'), null);
  assert.equal(findReloadAfter([trigger, stale], 0, '/user/settings'), stale);
  assert.equal(findReloadAfter([trigger, { ...stale, persisted: true }], 0, '/user/settings'), null);
  assert.equal(findReloadAfter([stale, trigger, stale], 1, '/user/settings'), null);
});

test('event order is harness-owned and truncation is explicitly exposed', () => {
  const witness = createWitness();
  recordWitness(witness, 0, { kind: 'click', sequence: 999 });
  recordWitness(witness, 0, { kind: 'navigation', sequence: 0 });
  assert.deepEqual(witness.events.map(e => e.sequence), [1, 2]);
  witness.events.length = 2000;
  recordWitness(witness, 0, { kind: 'click' });
  assert.equal(snapshotWitness(witness).truncated, true);
});

test('diagnosis observations cannot become final retained-test evidence', () => {
  const witness = createWitness();
  const diagnosis = beginAttempt(witness, 'diagnosis');
  recordWitness(witness, diagnosis, { kind: 'click', testId: 'bankaccount-submit' });
  const final = beginAttempt(witness, 'retained-rerun-2');
  recordWitness(witness, diagnosis, { kind: 'input', name: 'bankName', value: 'Study Credit Union' });
  recordWitness(witness, final, { kind: 'load', path: '/bankaccounts' });
  assert.equal(snapshotWitness(witness).events.some(e => e.kind === 'click'), false);
  assert.equal(witness.history.some(e => e.kind === 'click'), true);
});

test('an observation barrier rejects missing events, previous-document errors and truncated evidence', () => {
  const witness = { observerEnabled: true, events: [
    { documentId: 'old', browserSequence: 2, kind: 'ui-state' },
    { documentId: 'old', browserSequence: 1, kind: 'ui-state' },
    { documentId: 'old', kind: 'document-barrier', throughSequence: 2, metrics: { failedEmits: 0 } },
    { documentId: 'new', browserSequence: 1, kind: 'ui-state' },
    { documentId: 'new', browserSequence: 2, kind: 'ui-state' },
  ] };
  const final = { state: { documentId: 'new' }, throughSequence: 2 };
  witness.attemptId = 0;
  witness.events.forEach((event, i) => { event.attemptId = 0; event.sequence = i + 1;
    if (event.browserSequence) event.browserTime = (event.documentId === 'old' ? 100 : 200) + event.browserSequence;
  });
  assert.equal(observationLedgerError(witness, final), null, 'host arrival order must not replace per-document ordering');
  for (const modify of [
    w => w.events.splice(2, 1),
    w => w.events.splice(0, 1),
    w => { [w.events[2], w.events[3]] = [w.events[3], w.events[2]]; w.events.forEach((event, index) => event.sequence = index + 1); },
    w => w.events[2].metrics.failedEmits = 1,
    w => w.events.pop(),
    w => w.events.push({ documentId: 'new', browserSequence: 2, kind: 'ui-state' }),
    w => Object.assign(w.events[3], { kind: 'navigation', persisted: true }),
    w => w.truncated = true,
    w => w.observerError = 'Earlier document projection failed',
    w => w.events[0].attemptId = -1,
    w => w.events[0].browserTime = NaN,
    w => w.events[0].browserTime = 99,
  ]) {
    const broken = structuredClone(witness); modify(broken);
    assert(observationLedgerError(broken, final));
  }
});

test('late barrier and old sample preserve acknowledged document order across reloads', () => {
  const witness = { attemptId: 0, observerEnabled: true, events: [
    { documentId: 'old', browserSequence: 1, browserTime: 1548, kind: 'ui-state' },
    { documentId: 'old', browserSequence: 2, browserTime: 1549, kind: 'document-barrier', throughSequence: 2 },
    { documentId: 'new', browserSequence: 1, browserTime: 100, kind: 'navigation' },
    { documentId: 'new', browserSequence: 2, browserTime: 110, kind: 'ui-state' },
  ], finalObservation: { documentId: 'new', throughSequence: 2 } };
  witness.events.forEach((event, i) => Object.assign(event, { attemptId: 0, sequence: i + 1 }));
  // Campaign F recorded the old sample and barrier ~1.5 s after the new clock's first event.
  assert.equal(observationLedgerError(witness, { state: { documentId: 'new' }, throughSequence: 2 }), null);
  assert.deepEqual(acknowledgedEvents(witness).map(e => [e.documentId, e.browserSequence]),
    [['old', 1], ['old', 2], ['new', 1], ['new', 2]]);
});
