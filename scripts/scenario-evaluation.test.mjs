import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { cases } from '../study/manifest.mjs';
import { predicateContract, evaluateScenario, evaluateCalibration } from './scenario-evaluation.mjs';
import { classify } from './outcomes.mjs';
const feature = readFileSync(new URL('../study/scenarios.feature', import.meta.url), 'utf8');

// Synthetic temporal counterexamples, not copies of captured study evidence.
function profile({ beforeName = 'Study P', submittedName = 'Study', reload = true, stopBeforeReload = false } = {}) {
  const witness = { attemptId: 0, observerVersion: 'v0', captureProtocol: 'ui-projection-v4', observerEnabled: true, events: [] };
  const seq = new Map(); let hostSequence = 0;
  const emit = (doc, time, value) => {
    const n = (seq.get(doc) || 0) + 1; seq.set(doc, n);
    const event = { ...value, documentId: doc, browserSequence: n, sequence: ++hostSequence, attemptId: 0, browserTime: time };
    if (event.state) event.state.documentId = doc;
    witness.events.push(event); return event;
  };
  const state = (path, name = 'Ted P') => ({ path, identity: { visible: true, text: '@Heath93' }, identityCandidates: [{ visible: true, text: '@Heath93' }],
    firstName: { visible: true, value: 'Study', formUID: 'profile', controlUID: 'firstName' }, fullName: { visible: true, text: name }, headings: [],
    profileContext: { formCount: 1, formUID: 'profile', fields: { firstName: { count: 1, uid: 'firstName' }, email: { count: 1, uid: 'email' } } } });
  emit('old', 1000, { kind: 'submit', path: '/signin', targetVisible: true,
    fields: [{ name: 'username', value: 'Heath93' }, { name: 'password', passwordMatchesExpected: true }] });
  emit('old', 1010, { kind: 'ui-state', state: state('/') });
  const before = emit('old', 1020, { kind: 'document-barrier' }); before.throughSequence = before.browserSequence;
  emit('old', 1030, { kind: 'submit', path: '/user/settings', targetVisible: true, formId: 'user-settings-form', formUID: 'profile',
    profileContext: state('/user/settings').profileContext, fields: [{ name: 'firstName', value: submittedName, formUID: 'profile', controlUID: 'firstName' }] });
  emit('old', 1040, { kind: 'ui-state', state: state('/user/settings', beforeName) });
  if (stopBeforeReload) {
    const end = emit('old', 7000, { kind: 'ui-state', state: state('/user/settings', beforeName) });
    witness.finalObservation = { documentId: 'old', throughSequence: end.browserSequence }; return witness;
  }
  const closing = emit('old', 1050, { kind: 'document-barrier' }); closing.throughSequence = closing.browserSequence;
  emit('new', 1060, { kind: 'ui-state', state: state('/user/settings', 'Study P') });
  emit('new', 1070, { kind: 'navigation', path: '/user/settings', navigationType: reload ? 'reload' : 'navigate', persisted: false });
  const end = emit('new', 1080, { kind: 'ui-state', state: state('/user/settings', 'Study P') });
  witness.finalObservation = { documentId: 'new', throughSequence: end.browserSequence }; return witness;
}

function reindex(witness) {
  const counts = new Map();
  witness.events.forEach((event, i) => {
    const n = (counts.get(event.documentId) || 0) + 1; counts.set(event.documentId, n);
    event.sequence = i + 1; event.browserSequence = n;
    if (event.kind === 'document-barrier') event.throughSequence = n;
  });
  witness.finalObservation.throughSequence = counts.get(witness.finalObservation.documentId);
}

test('all39 public Then occurrences have exact phase bindings across all12scenarios', () => {
  assert.equal(cases.length, 12);
  assert.equal(cases.flatMap(c => predicateContract(feature, c.id)).length, 39);
  assert.throws(() => predicateContract(feature.replace('my displayed full name contains', 'my full name contains'), 'profile-name'));
});

test('capture revision metadata cannot select a different private action mapping', () => {
  const record = { caseId: 'profile-name', revision: 'v2', witness: profile(),
    sourcePins: { 'study/scenarios.feature': createHash('sha256').update(feature).digest('hex') } };
  assert.throws(() => evaluateCalibration(record, feature), /revision differs/);
});

test('a successful final field cannot rescue a missing displayed-name outcome before reload', () => {
  assert(evaluateScenario('profile-name', profile(), feature).valid);
  const result = evaluateScenario('profile-name', profile({ beforeName: 'Ted P' }), feature);
  assert.equal(result.valid, false);
  assert.equal(result.checks[2].status, 'unwitnessed');
  assert.equal(result.checks[3].ok, true, 'post-reload field remains a separate occurrence');
});

test('UI values at the submit action and actual reload identity take precedence over a correct final screen', () => {
  const wrong = evaluateScenario('profile-name', profile({ submittedName: 'Other' }), feature);
  assert.equal(wrong.triggerWitnessed, false); assert.equal(wrong.valid, false);
  const ordinaryNavigation = evaluateScenario('profile-name', profile({ reload: false }), feature);
  assert.equal(ordinaryNavigation.valid, false);
  assert.equal(ordinaryNavigation.actions.find(a => a.name === 'reload').ok, false);
});

test('an unrelated email input cannot borrow an existing profile error and disabled Save', () => {
  const makeEmail = () => {
    const witness = profile();
    const action = witness.events.find(e => e.kind === 'submit' && e.path === '/user/settings');
    Object.assign(action, { kind: 'input', name: 'email', value: 'invalid-email', formId: 'user-settings-form', controlUID: 'email' });
    for (const event of witness.events) if (event.state?.path === '/user/settings') Object.assign(event.state, {
      email: { visible: true, value: event.documentId === 'old' ? 'invalid-email' : 'Santos.Runte65@gmail.com', formUID: 'profile', controlUID: 'email' },
      exactTexts: { 'Must contain a valid email address': [{ visible: true, inProfileForm: true, formUID: 'profile' }] },
      profileSave: [{ visible: true, text: 'Save', disabled: true, formUID: 'profile' }],
    });
    return witness;
  };
  assert.equal(evaluateScenario('profile-email', makeEmail(), feature).valid, true);
  const resetAfterRejection = makeEmail();
  for (const event of resetAfterRejection.events) if (event.state?.email) event.state.email.value = 'Santos.Runte65@gmail.com';
  assert.equal(evaluateScenario('profile-email', resetAfterRejection, feature).valid, true, 'a rejected input may reset without borrowing another form\'s error');
  for (const change of [e => e.formId = 'newsletter-form', e => e.path = '/']) {
    const wrong = makeEmail(); change(wrong.events.find(e => e.kind === 'input'));
    const result = evaluateScenario('profile-email', wrong, feature);
    assert.equal(result.triggerWitnessed, false);
    assert.equal(result.completionWitnessed, false);
  }
  const changedForm = makeEmail();
  changedForm.events.find(e => e.kind === 'input').formUID = 'different-form';
  assert.equal(evaluateScenario('profile-email', changedForm, feature).completionWitnessed, false);
  for (const change of [m => m.formCount = 2, m => m.fields.email.count = 2]) {
    const ambiguous = makeEmail();
    for (const event of ambiguous.events) if (event.state?.path === '/user/settings') change(event.state.profileContext);
    const result = evaluateScenario('profile-email', ambiguous, feature);
    assert.equal(result.evaluable, false); assert.equal(result.completionWitnessed, false);
    assert(result.mappingIssues.length);
  }
  const otherOutcomeForm = makeEmail();
  for (const event of otherOutcomeForm.events) if (event.state?.path === '/user/settings') {
    event.state.exactTexts['Must contain a valid email address'][0].formUID = 'other';
    event.state.profileSave[0].formUID = 'other';
  }
  assert.equal(evaluateScenario('profile-email', otherOutcomeForm, feature).completionWitnessed, false);
  for (const replacement of ['form', 'control']) {
    const changed = makeEmail();
    for (const event of changed.events) if (event.documentId === 'old' && event.state?.path === '/user/settings') {
      if (replacement === 'form') {
        event.state.profileContext.formUID = 'replacement'; event.state.email.formUID = 'replacement';
        event.state.exactTexts['Must contain a valid email address'][0].formUID = 'replacement';
        event.state.profileSave[0].formUID = 'replacement';
      } else { event.state.profileContext.fields.email.uid = 'replacement'; event.state.email.controlUID = 'replacement'; }
    }
    const result = evaluateScenario('profile-email', changed, feature);
    assert.equal(result.evaluable, false); assert.equal(result.adjudicationRequired, false);
    assert(result.checks.some(c => c.status === 'mapping-unknown'));
  }
});

test('same-document profile replacement is association unknown, never negative product evidence', () => {
  const witness = profile({ stopBeforeReload: true });
  for (const event of witness.events) if (event.state?.path === '/user/settings') {
    event.state.profileContext.formUID = 'replacement'; event.state.firstName.formUID = 'replacement';
  }
  const result = evaluateScenario('profile-name', witness, feature);
  assert.equal(result.evaluable, false); assert.equal(result.adjudicationRequired, false);
  assert.equal(result.checks[1].status, 'mapping-unknown'); assert.equal(result.checks[2].status, 'mapping-unknown');
});

test('transient duplicate forms before a qualified action remain audit-only', () => {
  const witness = profile(), state = structuredClone(witness.events.find(e => e.state?.path === '/user/settings').state);
  state.profileContext.formCount = 2;
  witness.events.splice(3, 0, { kind: 'ui-state', state, documentId: 'old', browserTime: 1025, attemptId: 0 });
  reindex(witness);
  const result = evaluateScenario('profile-name', witness, feature);
  assert.equal(result.valid, true); assert.equal(result.evaluable, true); assert(result.mappingAudit.length);
});

test('an associated positive outcome resolves earlier ambiguity within the same predicate interval', () => {
  const witness = profile(), state = structuredClone(witness.events.find(e => e.state?.path === '/user/settings').state);
  state.profileContext.formCount = 2;
  witness.events.splice(4, 0, { kind: 'ui-state', state, documentId: 'old', browserTime: 1035, attemptId: 0 });
  reindex(witness);
  const result = evaluateScenario('profile-name', witness, feature);
  assert.equal(result.valid, true); assert.equal(result.evaluable, true);
  assert(result.mappingAudit.length); assert.equal(result.mappingIssues.length, 0);
});

test('an intervening user action without another wrapper boundary cannot rescue a missing profile outcome', () => {
  const witness = profile();
  witness.events.splice(4, 0, { kind: 'click', isTrusted: true, documentId: 'old', browserTime: 1035, attemptId: 0 });
  reindex(witness);
  const result = evaluateScenario('profile-name', witness, feature);
  assert.equal(result.valid, false); assert.equal(result.checks[1].ok, false); assert.equal(result.checks[2].ok, false);
});

test('a same-document route excursion cannot rescue a missing profile outcome after returning', () => {
  for (const kind of ['ui-state', 'ui-navigation']) {
    const witness = profile(), event = { kind, documentId: 'old', browserTime: 1035, attemptId: 0, path: '/user/settings' };
    if (kind === 'ui-state') event.state = { ...structuredClone(witness.events[4].state), path: '/other' };
    else Object.assign(event, { fromPath: '/user/settings', toPath: '/other', navigationType: 'push', sameDocument: true });
    witness.events.splice(4, 0, event); reindex(witness);
    assert.equal(evaluateScenario('profile-name', witness, feature).valid, false);
  }
});

test('an unrelated settings submit cannot stand in for the required profile update', () => {
  const witness = profile();
  witness.events.find(e => e.kind === 'submit' && e.path === '/user/settings').formId = 'newsletter-form';
  const result = evaluateScenario('profile-name', witness, feature);
  assert.equal(result.triggerWitnessed, false); assert.equal(result.completionWitnessed, false);
});

test('negative samples stay unconfirmed and cannot automatically establish a product defect', () => {
  const result = evaluateScenario('profile-name', profile({ beforeName: 'Ted P', stopBeforeReload: true }), feature);
  assert(result.adjudicationRequired);
  assert(result.possibleViolationPredicates.includes('my displayed full name contains "Study"'));
  assert.equal(result.defectObserved, false); assert.equal(result.contractViolated, false);
  assert.throws(() => classify({ healthy: false, status: 'fail', observation: result, assertionFailure: true }), /independent adjudication/);
});

test('invalid wait, source mapping, clocks and previous-attempt evidence cannot be scored', () => {
  for (const wait of [0, -1, NaN, Infinity, 4999]) assert.throws(() => evaluateScenario('profile-name', profile(), feature, { observationWaitMs: wait }));
  for (const change of [w => w.observerVersion = 'unmapped-version', w => w.events[0].browserTime = NaN,
    w => w.events[0].attemptId = -1, w => w.events.find(e => e.documentId === 'new' && e.browserSequence === 2).browserTime = 1]) {
    const broken = profile(); change(broken); assert.throws(() => evaluateScenario('profile-name', broken, feature));
  }
});

test('an actor that never opens the application is an execution failure, not an invented observation', () => {
  const empty = { attemptId: 0, observerVersion: 'v0', captureProtocol: 'ui-projection-v4', observerEnabled: true, events: [] };
  const result = evaluateScenario('auth-login', empty, feature);
  assert.equal(result.evaluable, true); assert.equal(result.triggerWitnessed, false); assert.equal(result.valid, false);
});

test('blur through another profile field and a Save attempt remain inside the invalid-email When', () => {
  const witness = profile({ stopBeforeReload: true });
  const action = witness.events.find(e => e.kind === 'submit' && e.path === '/user/settings');
  Object.assign(action, { kind: 'input', name: 'email', value: 'invalid-email', formId: 'user-settings-form', controlUID: 'email' });
  for (const event of witness.events) if (event.state && event.state.path === '/user/settings') {
    Object.assign(event.state, { email: { visible: true, value: 'invalid-email', formUID: 'profile', controlUID: 'email' }, exactTexts: { 'Must contain a valid email address': [] },
      profileSave: [{ visible: true, text: 'Save', disabled: false, formUID: 'profile' }] });
  }
  witness.events.splice(witness.events.length - 1, 0,
    { kind: 'document-barrier', browserTime: 1050 },
    { kind: 'focusout', name: 'email', value: 'invalid-email', formId: 'user-settings-form', browserTime: 1060 },
    { kind: 'document-barrier', browserTime: 1070 },
    { kind: 'focusout', name: 'phoneNumber', formId: 'user-settings-form', browserTime: 1080 },
    { kind: 'click', testId: 'user-settings-submit', formId: 'user-settings-form', browserTime: 1090 });
  witness.events.forEach((event, i) => {
    Object.assign(event, { documentId: 'old', attemptId: 0, sequence: i + 1, browserSequence: i + 1 });
    if (['focusout', 'click'].includes(event.kind)) event.formUID = 'profile';
    if (event.kind === 'document-barrier') event.throughSequence = event.browserSequence;
  });
  witness.finalObservation.throughSequence = witness.events.length;
  const result = evaluateScenario('profile-email', witness, feature);
  assert(result.possibleViolationPredicates.includes('the profile form displays email error "Must contain a valid email address"'));
  assert.equal(result.defectObserved, false);
});
