// Private evaluation of the observable scenario trajectory. No database or
// executor verdict is used to establish whether a UI predicate occurred.
import { acknowledgedEvents } from './witness.mjs';
import { scenarioAssertions } from './verdict.mjs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const replaySourcePins = Object.fromEntries(['scenario-evaluation.mjs', 'witness.mjs', 'verdict.mjs'].map(path =>
  ['scripts/' + path, createHash('sha256').update(readFileSync(new URL(path, import.meta.url))).digest('hex')]));

const detailPath = '/transaction/1xfcAhNDZK4';
const bank = "Waters, King and O'Reilly Bank";
const shown = rows => (rows || []).filter(row => row.visible);
const heading = (state, name) => shown(state.headings).some(h => typeof name === 'string' ? h.text === name : name.test(h.text));
const identity = state => shown(state.identityCandidates).some(candidate => candidate.text === '@Heath93');
// UI values at the command boundary, not native FormData or Formik/wire data.
// A UI-to-payload mapping error is a possible product defect, not actor error.
const field = (event, name) => { const found = (event.fields || []).filter(f => f.name === name); return found.length === 1 ? found[0] : null; };
const visibleAction = event => event.targetVisible && !event.targetDisabled;
const clicked = (event, id) => event.kind === 'click' && event.testId === id && visibleAction(event);
const submitted = event => event.kind === 'submit' && visibleAction(event);
const profileAssociation = (state, context, name) => {
  const mapping = state.profileContext, field = state[name];
  const primary = context.actions.primary;
  const primaryControl = name === 'email' ? primary?.controlUID : (primary?.fields || []).find(f => f.name === name)?.controlUID;
  return state.path === '/user/settings' && mapping?.formCount === 1 && mapping.fields?.[name]?.count === 1 &&
    field?.visible && field.formUID === mapping.formUID && field.controlUID === mapping.fields[name].uid &&
    (context.phase !== 'primary' || (primary?.formUID === mapping.formUID && primary.documentId === state.documentId && primaryControl === field.controlUID)) ? 'matched' : 'unknown';
};
const profileField = (state, context, name) => profileAssociation(state, context, name) === 'matched';
const uniqueProfileAction = (event, name, inputEvent = false) => {
  const mapping = event.profileContext, value = inputEvent ? event : field(event, name);
  return event.path === '/user/settings' && event.formId === 'user-settings-form' && mapping?.formCount === 1 &&
    mapping.fields?.[name]?.count === 1 && event.formUID === mapping.formUID &&
    value?.formUID === mapping.formUID && value.controlUID === mapping.fields[name].uid;
};
const twelveDollars = value => {
  if (typeof value !== 'string') return false;
  const digits = value.replace(/[$,\s]/g, '');
  return /^\d+(?:\.\d+)?$/.test(digits) && Number(digits) === 12;
};
const numericLike = state => {
  const counts = shown(state.likeCounts).filter(r => r.id === 'transaction-like-count-1xfcAhNDZK4');
  if (!counts.length || !counts.every(c => /^\d+$/.test(c.text.trim()))) return null;
  const values = counts.map(c => Number(c.text.trim()));
  return values.every(n => n === values[0]) ? values[0] : null;
};
const likeResult = (state, context) => state.path === detailPath && context.likesBefore !== null && numericLike(state) === context.likesBefore + 1 &&
  shown(state.likeButtons).some(b => b.id === 'transaction-like-button-1xfcAhNDZK4' && b.disabled);

const predicates = {
  signIn: { text: 'the sign-in heading is visible', test: s => s.path === '/signin' && heading(s, /^(Sign in|Log in)$/i) },
  identity: { text: 'the authenticated home identifies "Heath93"', test: identity },
  homeRoute: { text: 'the authenticated home route is "/" or "/public"', test: s => ['/', '/public'].includes(s.path) },
  signedOut: { text: 'the sign-in page and URL are visible', test: s => s.path === '/signin' && heading(s, /^(Sign in|Log in)$/i) },
  firstName: { text: 'my "First Name" field is "Study"', test: (s, c) => profileField(s, c, 'firstName') && s.firstName.value === 'Study' },
  fullName: { text: 'my displayed full name contains "Study"', test: (s, c) => profileField(s, c, 'firstName') && s.fullName?.visible && s.fullName.text.includes('Study') },
  emailError: { text: 'the profile form displays email error "Must contain a valid email address"',
    test: (s, c) => profileField(s, c, 'email') && shown(s.exactTexts?.['Must contain a valid email address']).some(t => t.inProfileForm && t.formUID === s.profileContext.formUID),
    applies: (s, c) => profileField(s, c, 'email') && s.email.value === 'invalid-email' },
  saveDisabled: { text: 'the profile Save control is visible and disabled', test: (s, c) => profileField(s, c, 'email') && shown(s.profileSave).some(control => control.disabled && control.formUID === s.profileContext.formUID),
    applies: (s, c) => profileField(s, c, 'email') && s.email.value === 'invalid-email' },
  originalEmail: { text: 'my "Email" field is "Santos.Runte65@gmail.com"', test: (s, c) => profileField(s, c, 'email') && s.email.value === 'Santos.Runte65@gmail.com' },
  newBank: { text: 'bank "Study Credit Union" is visible exactly once', test: s => s.path === '/bankaccounts' && shown(s.bankRows).filter(r => r.text.includes('Study Credit Union')).length === 1 },
  deletedBank: { text: `bank "${bank}" is visibly marked deleted`, test: s => s.path === '/bankaccounts' && shown(s.bankRows).some(r => r.text.includes(bank) && r.text.includes('(Deleted)')) },
  detail: { text: 'the transaction detail heading is visible', test: s => s.path === detailPath && heading(s, 'Transaction Detail') },
  numericLike: { text: 'the displayed like count is a number', test: s => s.path === detailPath && numericLike(s) !== null },
  like: { text: 'the displayed like count is one greater and Like is disabled', test: likeResult },
  comment: { text: 'comment "Study comment" is visible in the transaction\'s comments', test: s => s.path === detailPath && shown(s.exactTexts?.['Study comment']).some(t => t.inComments) },
  singleComment: { text: 'comment "Study comment" is visible exactly once in the transaction\'s comments', test: s => s.path === detailPath && shown(s.exactTexts?.['Study comment']).filter(t => t.inComments).length === 1 },
};
for (const key of ['firstName', 'fullName', 'emailError', 'saveDisabled', 'originalEmail']) {
  const name = ['firstName', 'fullName'].includes(key) ? 'firstName' : 'email';
  predicates[key].association = (state, context) => profileAssociation(state, context, name);
}
for (const [type, verb] of [['payment', 'paid'], ['request', 'requested']]) {
  predicates[type + 'Confirmation'] = { text: `a confirmation heading shows "Study ${type}"`, test: s => heading(s, new RegExp('Study ' + type)) };
  predicates[type + 'Row'] = { text: `my personal feed contains one visible "Study ${type}" transaction for "$12.00" with "Kristian" as "${verb}"`, test: s => {
    const rows = shown(s.transactionRows).filter(r => r.text.includes('Study ' + type));
    return s.path === '/personal' && rows.length === 1 && rows[0].text.includes('$12.00') && rows[0].text.includes('Kristian') && rows[0].text.includes(verb);
  } };
}
for (const [key, path, header] of [['personal', '/personal', 'Personal'], ['friends', '/contacts', 'Contacts']]) {
  predicates[key + 'Feed'] = { text: `the "${header}" feed at "${path}" contains transactions`, test: s => s.path === path && shown(s.feedHeaders).some(h => h.text === header) && shown(s.transactionRows).length > 0 };
}

// One entry for every public Then/And occurrence, including repeated assertions
// after a reload. These bindings must exactly match the frozen Gherkin.
const phases = {
  'auth-login': [['open', ['signIn']], ['login', ['identity', 'homeRoute']]],
  'auth-logout': [['login', ['identity']], ['primary', ['signedOut']], ['reload', ['signedOut']]],
  'profile-name': [['login', ['identity']], ['primary', ['firstName', 'fullName']], ['reload', ['firstName']]],
  'profile-email': [['login', ['identity']], ['primary', ['emailError', 'saveDisabled']], ['reload', ['originalEmail']]],
  'bank-create': [['login', ['identity']], ['primary', ['newBank']], ['reload', ['newBank']]],
  'bank-delete': [['login', ['identity']], ['primary', ['deletedBank']], ['reload', ['deletedBank']]],
  'transfer-pay': [['login', ['identity']], ['primary', ['paymentConfirmation']], ['reload', ['paymentRow']]],
  'transfer-request': [['login', ['identity']], ['primary', ['requestConfirmation']], ['reload', ['requestRow']]],
  'social-like': [['login', ['identity']], ['detail', ['detail', 'numericLike']], ['primary', ['like']], ['reload', ['like']]],
  'social-comment': [['login', ['identity']], ['detail', ['detail']], ['primary', ['comment']], ['reload', ['singleComment']]],
  'feed-personal': [['login', ['identity']], ['primary', ['personalFeed']]],
  'feed-friends': [['login', ['identity']], ['primary', ['friendsFeed']]],
};

const reloadPaths = { 'auth-logout': '/signin', 'profile-name': '/user/settings', 'profile-email': '/user/settings',
  'bank-create': '/bankaccounts', 'bank-delete': '/bankaccounts', 'transfer-pay': '/personal', 'transfer-request': '/personal',
  'social-like': detailPath, 'social-comment': detailPath };

function actionRules(caseId, observerVersion) {
  const rules = [];
  const add = (name, family, qualify = () => true, allowCorrections = false) => rules.push({ name, family, qualify, allowCorrections });
  if (caseId === 'auth-login') add('open', e => e.kind === 'ui-state' && e.state.path === '/signin');
  add('login', e => e.kind === 'submit' && e.path === '/signin', e => submitted(e) && field(e, 'username')?.value === 'Heath93' && field(e, 'password')?.passwordMatchesExpected === true, true);
  if (caseId === 'auth-login') return rules;
  if (caseId.startsWith('social-')) add('detail', e => e.kind === 'ui-state' && e.state.path === detailPath);
  if (caseId === 'auth-logout') add('primary', e => e.kind === 'click' && e.testId === 'sidenav-signout', visibleAction);
  if (caseId === 'profile-name') add('primary', e => e.kind === 'submit' && e.path === '/user/settings' && e.formId === 'user-settings-form', e => submitted(e) && uniqueProfileAction(e, 'firstName') && field(e, 'firstName')?.value === 'Study');
  if (caseId === 'profile-email') add('primary', e => e.kind === 'input' && e.path === '/user/settings' && e.formId === 'user-settings-form' && e.name === 'email' && e.value === 'invalid-email', e => visibleAction(e) && uniqueProfileAction(e, 'email', true));
  if (caseId === 'bank-create') add('primary', e => e.kind === 'submit' && e.formId === 'bankaccount-form', e => submitted(e) && field(e, 'bankName')?.value === 'Study Credit Union' && field(e, 'routingNumber')?.value === '987654321' && field(e, 'accountNumber')?.value === '123456789');
  if (caseId === 'bank-delete') {
    if (observerVersion === 'v2') add('primary', e => e.kind === 'click' && e.testId === 'bankaccount-delete-confirm', (e, c) => {
      const prior = c.events.slice(0, c.events.indexOf(e)).findLast(event => event.state)?.state;
      const dialogs = shown(prior?.bankDeleteDialogs).filter(dialog => dialog.text.includes(bank));
      return visibleAction(e) && e.path === '/bankaccounts' && prior?.path === '/bankaccounts' &&
        dialogs.length === 1 && e.dialogUID && dialogs[0].dialogUID === e.dialogUID;
    });
    else add('primary', e => e.kind === 'click' && e.testId === 'bankaccount-delete', e => visibleAction(e) && e.rowVisible && e.rowText?.includes(bank));
  }
  if (caseId.startsWith('transfer-')) {
    const request = caseId === 'transfer-request', type = request ? 'request' : 'payment';
    add('primary', e => e.kind === 'submit' && e.formId === 'transaction-create-form', (e, c) => {
      const prior = c.events.slice(0, c.events.indexOf(e)).findLast(event => event.state)?.state;
      const receiverVisible = shown(prior?.selectedRecipients).some(receiver => /^Kristian Bradtke(?:\s*(?:payment|request))?$/.test(receiver.text));
      return submitted(e) && receiverVisible && twelveDollars(field(e, 'amount')?.value) && field(e, 'description')?.value === 'Study ' + type && e.submitter?.testId === 'transaction-create-submit-' + type;
    });
    // This is a required route action, before the subsequent actual reload.
    add('personal', (e, c) => e.kind === 'ui-state' && e.state.path === '/personal' && c.navigation.get(e.documentId)?.navigationType !== 'reload');
  }
  if (caseId === 'social-like') add('primary', e => e.kind === 'click' && e.testId === 'transaction-like-button-1xfcAhNDZK4', e => visibleAction(e) && e.path === detailPath);
  if (caseId === 'social-comment') add('primary', e => e.kind === 'submit' && e.path === detailPath && field(e, 'content'), e => submitted(e) && field(e, 'content')?.value === 'Study comment');
  if (caseId.startsWith('feed-')) {
    const id = caseId === 'feed-personal' ? 'nav-personal-tab' : 'nav-contacts-tab';
    add('primary', e => e.kind === 'click' && e.testId === id, visibleAction);
  }
  if (reloadPaths[caseId]) add('reload', (e, c) => {
    const prior = c.actions.personal || c.actions.primary;
    return e.kind === 'navigation' && e.navigationType === 'reload' && e.persisted === false && e.path === reloadPaths[caseId] && e.documentId !== prior?.documentId &&
      !c.events.slice(0, prior?.index + 1).some(old => old.documentId === e.documentId);
  });
  return rules;
}

export function predicateContract(feature, caseId) {
  if (!phases[caseId]) throw new Error('Unknown scenario: ' + caseId);
  const rows = phases[caseId].flatMap(([after, names]) => names.map(name => ({ after, predicate: name, assertion: predicates[name].text })));
  const actual = scenarioAssertions(feature, caseId);
  if (JSON.stringify(actual) !== JSON.stringify(rows.map(r => r.assertion))) throw new Error('Private predicate bindings differ from frozen Then occurrences: ' + caseId);
  return rows.map((row, i) => ({ ...row, id: caseId + '/then/' + (i + 1) }));
}

export function expandCapturedWitness(witness) {
  if (!witness.encoding) return witness;
  if (witness.encoding !== 'state-dictionary-v1') throw new Error('Unknown witness encoding');
  return { ...witness, events: witness.events.map(event => {
    if (!Object.hasOwn(event, 'stateRef')) return event;
    const state = witness.states[event.stateRef];
    if (!state) throw new Error('Missing state dictionary entry');
    const { stateRef, ...rest } = event; return { ...rest, state };
  }) };
}

// Canonical semantic identifiers are private mapping data, independent of the
// repairable execution registry. Raw versioned traces are never rewritten.
function canonicalEvents(events, version) {
  if (version === 'v0') return events.map(e => ({ ...e }));
  const id = value => typeof value === 'string' && value.startsWith('v1-') ? value.slice(3) : value;
  return events.map(event => {
    const copy = { ...event, testId: id(event.testId), formId: id(event.formId), rowId: id(event.rowId) };
    if (event.submitter) copy.submitter = { ...event.submitter, testId: id(event.submitter.testId) };
    if (event.state) {
      copy.state = { ...event.state };
      for (const key of ['bankRows', 'transactionRows', 'userRows', 'commentRows', 'likeCounts', 'likeButtons']) {
        if (event.state[key]) copy.state[key] = event.state[key].map(row => ({ ...row, id: id(row.id) }));
      }
    }
    return copy;
  });
}

function phaseEnd(caseId, after, start, events) {
  const anchor = events[start];
  const stableRoute = after === 'reload' || after === 'detail' || (after === 'primary' && /^(profile-|social-|bank-delete|transfer-)/.test(caseId));
  const emailInternal = e => e.formUID === anchor.formUID && (
    (['input', 'keydown'].includes(e.kind) && e.name === 'email' && e.value === 'invalid-email') ||
    (e.kind === 'focusout' && e.formId === 'user-settings-form') ||
    (e.kind === 'keydown' && e.key === 'Enter' && e.formId === 'user-settings-form') ||
    (e.kind === 'click' && e.testId === 'user-settings-submit') ||
    (e.kind === 'submit' && e.path === '/user/settings' && field(e, 'email')?.value === 'invalid-email'));
  for (let i = start + 1; i < events.length; i++) {
    // A later document or user mutation cannot rescue a missing outcome, even
    // if its enclosing MCP tool failed to create another wrapper boundary.
    if (events[i].documentId !== anchor.documentId) return i;
    if (events[i].kind === 'ui-navigation' && (events[i].navigationType === 'traverse' ||
      (stableRoute && events[i].fromPath !== events[i].toPath))) return i;
    if (stableRoute && (events[i].state?.path || events[i].path) && (events[i].state?.path || events[i].path) !== anchor.path) return i;
    if (['input', 'click', 'submit'].includes(events[i].kind) && events[i].isTrusted !== false) {
      if (!(caseId === 'profile-email' && after === 'primary' && emailInternal(events[i]))) return i;
    }
    if (events[i].kind !== 'document-barrier') continue;
    if (caseId === 'profile-email' && after === 'primary') {
      // This When can type, blur, and attempt Save. Those UI primitives are
      // part of the same public action, rather than subsequent Then phases.
      let end = events.findIndex((e, j) => j > i && (e.kind === 'document-barrier' || e.kind === 'navigation'));
      if (end < 0) end = events.length;
      const actions = events.slice(i + 1, end).filter(e => ['input', 'focusout', 'click', 'submit', 'keydown'].includes(e.kind));
      const internal = actions.length && actions.every(emailInternal);
      if (internal) continue;
    }
    return i;
  }
  return events.length;
}

export function evaluateScenario(caseId, recorded, feature, { observationWaitMs = 5000 } = {}) {
  if (!Number.isFinite(observationWaitMs) || observationWaitMs < 5000) throw new Error('Observation wait must be finite and at least 5000ms');
  const contract = predicateContract(feature, caseId), witness = expandCapturedWitness(recorded);
  if (!['v0', 'v1', 'v2'].includes(witness.observerVersion)) throw new Error('Unknown private semantic mapping: ' + witness.observerVersion);
  if (witness.captureProtocol !== 'ui-projection-v4') throw new Error('Phase evaluation requires the complete v4 UI projection');
  if (!witness.observerEnabled || !Number.isInteger(witness.attemptId)) throw new Error('Missing configured private observation metadata');
  const unopened = !witness.finalObservation && !witness.events.length && !witness.observerError && !witness.truncated;
  const events = canonicalEvents(unopened ? [] : acknowledgedEvents(witness), witness.observerVersion), states = new Map(), latest = new Map();
  if (caseId === 'bank-delete' && witness.observerVersion === 'v2' && events.some(e => e.kind === 'click' && e.testId === 'bankaccount-delete-confirm' && !Object.hasOwn(e, 'dialogUID'))) throw new Error('v2 confirmation capture lacks dialog association metadata');
  for (const event of events) {
    if (event.kind === 'ui-state') { states.set(event.documentId + '/' + event.browserSequence, event.state); latest.set(event.documentId, event.browserSequence); }
    if (event.kind === 'ui-sample') {
      if (event.projectionConfirmed !== true) throw new Error('Heartbeat lacks fresh projection confirmation');
      if (event.stateSequence !== latest.get(event.documentId)) throw new Error('Heartbeat references a superseded private state');
      const state = states.get(event.documentId + '/' + event.stateSequence);
      if (!state) throw new Error('Sample references an unavailable acknowledged state');
      event.state = state;
    }
  }
  const context = { events, actions: {}, navigation: new Map(events.filter(e => e.kind === 'navigation').map(e => [e.documentId, e])), likesBefore: null };
  const actionChecks = []; let cursor = -1, actionPrefix = true;
  for (const rule of actionRules(caseId, witness.observerVersion)) {
    const index = actionPrefix ? events.findIndex((event, i) => i > cursor && rule.family(event, context) && (!rule.allowCorrections || rule.qualify(event, context))) : -1;
    const event = index >= 0 ? events[index] : null;
    const ok = Boolean(event && rule.qualify(event, context));
    const mappingUnknown = Boolean(event && rule.name === 'primary' && caseId.startsWith('profile-') && !uniqueProfileAction(event, caseId === 'profile-email' ? 'email' : 'firstName', caseId === 'profile-email'));
    actionChecks.push({ name: rule.name, ok, reason: mappingUnknown ? 'mapping-unknown' : !event ? 'missing-action' : ok ? null : 'wrong-action-input-or-target', evidence: event && { documentId: event.documentId, sequence: event.browserSequence, at: event.browserTime } });
    if (event) { context.actions[rule.name] = { ...event, index, qualified: ok }; cursor = index; }
    actionPrefix &&= ok;
  }
  if (caseId === 'social-like' && context.actions.primary?.qualified) {
    const before = events.slice(context.actions.detail?.index, context.actions.primary.index).filter(e => e.state && e.state.path === detailPath && numericLike(e.state) !== null);
    if (before.length) context.likesBefore = numericLike(before.at(-1).state);
  }
  const checks = []; let predicatePrefix = true, phaseCursor = new Map();
  for (const row of contract) {
    const anchor = context.actions[row.after];
    const start = anchor?.index ?? -1;
    const stop = start >= 0 ? phaseEnd(caseId, row.after, start, events) : events.length;
    const endIndex = stop < events.length ? stop : -1;
    const begin = Math.max(start + (row.after === 'open' || row.after === 'detail' ? 0 : 1), phaseCursor.get(row.after) ?? 0);
    const candidates = anchor?.qualified ? events.slice(begin, stop).map((e, i) => ({ ...e, index: begin + i })).filter(e => e.state) : [];
    const predicate = predicates[row.predicate], phaseContext = { ...context, phase: row.after };
    const associated = e => !predicate.association || predicate.association(e.state, phaseContext) === 'matched';
    const match = candidates.find(e => associated(e) && predicate.test(e.state, phaseContext));
    const unknown = !match && (actionChecks.find(a => a.name === row.after)?.reason === 'mapping-unknown' || candidates.some(e => !associated(e)));
    const wrong = !match && !unknown && candidates.findLast(e => e.browserTime - anchor.browserTime >= observationWaitMs && (!predicate.applies || predicate.applies(e.state, phaseContext)) && !predicate.test(e.state, phaseContext));
    const prerequisiteActions = actionChecks.slice(0, actionChecks.findIndex(a => a.name === row.after) + 1).every(a => a.ok);
    const qualifiedPrefix = prerequisiteActions && predicatePrefix;
    // A negative sampled state is not proof that a positive transient outcome
    // never occurred. Preserve it for independent actor-visible/fault review;
    // never automatically turn absence of a positive sample into defect truth.
    const status = match ? 'witnessed' : unknown ? 'mapping-unknown' : !anchor?.qualified ? 'missing-or-wrong-action' : 'unwitnessed';
    checks.push({ ...row, kind: 'contract', name: row.id, ok: Boolean(match), status, qualifiedPrefix,
      evidence: (match || wrong) ? { documentId: (match || wrong).documentId, sequence: (match || wrong).browserSequence, at: (match || wrong).browserTime } : null,
      negativeSampleCandidate: Boolean(wrong && qualifiedPrefix),
      phase: { after: row.after, start: anchor?.browserTime ?? null, beforeNextAction: endIndex >= 0 ? events[endIndex].browserTime : null } });
    if (match) phaseCursor.set(row.after, match.index);
    predicatePrefix &&= Boolean(match);
  }
  const primaryName = caseId === 'auth-login' ? 'login' : 'primary';
  const primaryIndex = actionChecks.findIndex(a => a.name === primaryName);
  const triggerWitnessed = primaryIndex >= 0 && actionChecks.slice(0, primaryIndex + 1).every(a => a.ok);
  const candidates = checks.filter(c => c.negativeSampleCandidate);
  const mappingAudit = caseId.startsWith('profile-') ? events.filter(e => e.path === '/user/settings' || e.state?.path === '/user/settings').flatMap(e => {
    const mapping = e.state?.profileContext || e.profileContext;
    return mapping?.formCount > 1 || Object.values(mapping?.fields || {}).some(f => f.count > 1) ? [{ documentId: e.documentId, sequence: e.browserSequence, reason: 'ambiguous-profile-form-or-control' }] : [];
  }) : [];
  const mappingIssues = [...actionChecks.filter(a => a.reason === 'mapping-unknown').map(a => ({ action: a.name, evidence: a.evidence, reason: 'ambiguous-or-lost-profile-association' })),
    ...checks.filter(c => c.status === 'mapping-unknown').map(c => ({ predicate: c.id, phase: c.phase, reason: 'ambiguous-or-lost-profile-association' }))];
  const completionWitnessed = !mappingIssues.length && actionChecks.every(a => a.ok) && checks.every(c => c.ok);
  return { observerProtocol: 'ordered-ui-phase-v1-provisional', evaluable: !mappingIssues.length, mappingIssues, mappingAudit, valid: completionWitnessed,
    triggerWitnessed, completionWitnessed, defectObserved: false, contractViolated: false,
    adjudicationRequired: candidates.length > 0, possibleViolationPredicates: candidates.map(c => c.assertion),
    violatedPredicates: [], unobservedPredicates: checks.filter(c => c.status === 'unwitnessed').map(c => c.id),
    actions: actionChecks, checks, comparisonOperands: caseId === 'social-like' ? { likesBefore: context.likesBefore, source: 'last acknowledged visible pre-action count in controlled fixture; does not prove internal recording' } : null,
    limitations: ['Sampled observable trajectory, not proof of internal checks.', 'Failure reports require separate actor-visible evidence and seeded-fault adjudication.', 'Each versioned mapping requires independent calibration and gate evidence before measured use.'] };
}

export function evaluateCalibration(record, feature, options) {
  const hash = createHash('sha256').update(feature).digest('hex');
  if (record.sourcePins?.['study/scenarios.feature'] !== hash) throw new Error('Captured Gherkin hash differs from the evaluated contract');
  if ((record.revision || 'v0') !== record.witness.observerVersion) throw new Error('Capture revision differs from its private observer mapping');
  return { ...evaluateScenario(record.caseId, record.witness, feature, options),
    provenance: { captureSourcePins: record.sourcePins, replaySourcePins, evaluatedFeatureSHA: hash } };
}
