// Counterfactual trace controls; these are not new application executions or
// measured study trials. Originals stay unchanged in Research Foundry.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { evaluateCalibration } from './scenario-evaluation.mjs';

const record = JSON.parse(process.env.STUDY_CALIBRATION_RECORD);
const feature = readFileSync(new URL('../study/scenarios.feature', import.meta.url), 'utf8');
const results = [];
const states = r => r.witness.states;
const canonicalId = value => record.revision && typeof value === 'string' && value.startsWith('v1-') ? value.slice(3) : value;
function control(name, mutate, expectedValid, rejects = false) {
  const changed = structuredClone(record); mutate(changed);
  try {
    const evaluated = evaluateCalibration(changed, feature);
    if (rejects) throw new Error('Malformed evidence was not rejected');
    assert.equal(evaluated.valid, expectedValid);
    assert.equal(evaluated.defectObserved, false, 'No synthetic negative control proves product defect truth');
    if (name.endsWith('remain-unknown')) {
      assert.equal(evaluated.evaluable, false);
      assert.equal(evaluated.adjudicationRequired, false, 'mapping-unknown evidence cannot supply a product-negative candidate');
    }
    results.push({ name, ok: true, valid: evaluated.valid, evaluable: evaluated.evaluable, mappingIssues: evaluated.mappingIssues, adjudicationRequired: evaluated.adjudicationRequired });
  } catch (error) {
    if (rejects && rejects.test(error.message)) results.push({ name, ok: true, rejected: error.message });
    else { results.push({ name, ok: false, error: error.message }); process.exitCode = 1; }
  }
}

assert(evaluateCalibration(record, feature).valid, 'Adverse replay needs a verified healthy source trace');
control('untracked-followup-action-cannot-rescue-primary', r => {
  const evaluated = evaluateCalibration(r, feature), primary = evaluated.actions.find(a => a.name === (r.caseId === 'auth-login' ? 'login' : 'primary')).evidence;
  const target = r.witness.events.find(e => e.documentId === primary.documentId && e.browserSequence === primary.sequence);
  const at = target.browserSequence, doc = target.documentId;
  for (const event of r.witness.events) if (event.documentId === doc) {
    if (event.browserSequence > at) event.browserSequence++;
    if (event.stateSequence > at) event.stateSequence++;
    if (event.throughSequence > at) event.throughSequence++;
  }
  if (r.witness.finalObservation.documentId === doc && r.witness.finalObservation.throughSequence > at) r.witness.finalObservation.throughSequence++;
  r.witness.events.splice(r.witness.events.indexOf(target) + 1, 0, { kind: 'click', isTrusted: true,
    testId: 'unrelated-control', documentId: doc, browserSequence: at + 1, browserTime: target.browserTime,
    attemptId: target.attemptId, path: target.path, targetVisible: true, targetDisabled: false });
  r.witness.events.forEach((event, i) => event.sequence = i + 1);
}, false);
control('foreign-attempt', r => r.witness.events[0].attemptId--, false, /Foreign attempt/);
control('nonfinite-clock', r => r.witness.events.find(e => e.browserSequence).browserTime = NaN, false, /timestamp/);
control('missing-private-event', r => r.witness.events.splice(r.witness.events.findIndex(e => e.browserSequence === 1), 1), false, /gap|missing|sample/i);
control('hidden-identities', r => states(r).forEach(s => {
  if (s.identity) s.identity.visible = false;
  for (const identity of s.identityCandidates || []) identity.visible = false;
}), false);
control('duplicate-identity-wrong-first', r => states(r).forEach(s => {
  if (s.identityCandidates.some(i => i.visible && i.text === '@Heath93')) {
    s.identityCandidates.unshift({ visible: true, text: '@OtherUser' });
    s.identity = { visible: true, text: '@OtherUser' };
  }
}), true);

if (record.caseId === 'profile-name') {
  control('correct-post-reload-field-cannot-rescue-missing-pre-reload-name', r => states(r).forEach(s => {
    if (s.documentId !== r.witness.finalObservation.documentId && s.fullName.text.includes('Study')) s.fullName.text = 'Ted P';
  }), false);
  control('wrong-UI-value-at-submit', r => {
    r.witness.events.find(e => e.kind === 'submit' && e.path === '/user/settings').fields.find(f => f.name === 'firstName').value = 'Other';
  }, false);
  control('unrelated-settings-form-is-not-profile-update', r => {
    r.witness.events.find(e => e.kind === 'submit' && e.path === '/user/settings').formId = 'newsletter-form';
  }, false);
  control('ordinary-navigation-is-not-reload', r => r.witness.events.filter(e => e.kind === 'navigation' && e.navigationType === 'reload').forEach(e => e.navigationType = 'navigate'), false);
}
if (record.caseId === 'profile-email') {
  control('error-in-wrong-region', r => states(r).forEach(s => (s.exactTexts['Must contain a valid email address'] || []).forEach(t => t.inProfileForm = false)), false);
  control('enabled-profile-save', r => states(r).forEach(s => (s.profileSave || []).forEach(b => b.disabled = false)), false);
  control('same-profile-label-cannot-replace-actual-form-identity', r => {
    for (const event of r.witness.events) if (event.kind === 'input' && event.name === 'email') event.formUID = 'another-form';
  }, false);
  control('profile-error-and-Save-cannot-belong-to-another-form', r => states(r).forEach(s => {
    for (const error of s.exactTexts['Must contain a valid email address']) error.formUID = 'other';
    for (const save of s.profileSave) save.formUID = 'other';
  }), false);
  control('duplicate-visible-profile-forms-remain-unknown', r => states(r).filter(s => s.path === '/user/settings').forEach(s => s.profileContext.formCount = 2), false);
  control('duplicate-visible-email-controls-remain-unknown', r => states(r).filter(s => s.path === '/user/settings').forEach(s => s.profileContext.fields.email.count = 2), false);
  control('replacement-profile-form-remains-unknown', r => states(r).filter(s => s.path === '/user/settings' && s.documentId !== r.witness.finalObservation.documentId).forEach(s => {
    s.profileContext.formUID = 'replacement'; s.email.formUID = 'replacement';
    for (const item of [...s.exactTexts['Must contain a valid email address'], ...s.profileSave]) item.formUID = 'replacement';
  }), false);
}
if (record.caseId === 'bank-create') control('wrong-routing-at-submit', r => {
    r.witness.events.find(e => e.kind === 'submit' && canonicalId(e.formId) === 'bankaccount-form').fields.find(f => f.name === 'routingNumber').value = '000000000';
}, false);
if (record.caseId === 'bank-delete') control('replacement-bank-row-id-preserves-name-and-deleted-truth', r => states(r).forEach(s => {
  for (const row of s.bankRows) if (row.text.includes("Waters, King and O'Reilly Bank")) row.id = 'bankaccount-list-item-replacement';
}), true);
if (record.caseId === 'bank-delete') control('matching-deleted-bank-on-another-route-is-not-completion', r => states(r).filter(s => s.bankRows.some(row => row.text.includes('(Deleted)'))).forEach(s => s.path = '/other'), false);
if (record.caseId.startsWith('transfer-')) {
  control('recipient-changed-before-submit', r => states(r).forEach(s => s.selectedRecipients.forEach(receiver => receiver.text = 'Other Person')), false);
  control('wrong-amount-at-submit-despite-correct-final-row', r => {
    r.witness.events.find(e => e.kind === 'submit' && canonicalId(e.formId) === 'transaction-create-form').fields.find(f => f.name === 'amount').value = '$13';
  }, false);
  control('earlier-picker-click-does-not-override-current-visible-recipient', r => {
    for (const event of r.witness.events) if (event.kind === 'click' && event.rowId?.startsWith('user-list-item-')) event.rowText = 'Other Person';
  }, true);
}
if (record.caseId === 'social-like') {
  control('pre-like-operand-not-hidden-seed-count', r => states(r).forEach(s => {
    for (const count of s.likeCounts) if (count.text === '0') count.text = '5';
  }), false);
  control('hidden-disabled-like-is-not-visible-disabled-like', r => states(r).forEach(s => {
    for (const button of s.likeButtons) if (button.disabled) button.visible = false;
  }), false);
}
if (record.caseId === 'social-comment') {
  control('unrelated-text-is-not-a-transaction-comment', r => states(r).forEach(s => s.exactTexts['Study comment'].forEach(t => t.inComments = false)), false);
  control('duplicate-visible-comment', r => states(r).forEach(s => {
    const visible = s.exactTexts['Study comment'].find(t => t.visible && t.inComments);
    if (visible) s.exactTexts['Study comment'].push({ ...visible });
  }), false);
  control('matching-comment-from-another-transaction-is-not-completion', r => states(r).filter(s => s.exactTexts['Study comment'].some(t => t.visible && t.inComments)).forEach(s => s.path = '/transaction/other'), false);
}
if (record.caseId.startsWith('feed-')) {
  control('route-alone-cannot-replace-visible-feed-control-selection', r => {
    for (const event of r.witness.events) if (event.kind === 'click' && /^nav-(personal|contacts)-tab$/.test(canonicalId(event.testId))) event.kind = 'focusout';
  }, false);
}
if (record.revision === 'v2' && record.caseId === 'bank-delete') {
  control('matching-target-dialog-cannot-qualify-another-dialogs-confirmation', r => {
    for (const event of r.witness.events) if (event.kind === 'click' && canonicalId(event.testId) === 'bankaccount-delete-confirm') event.dialogUID = 'other-dialog';
  }, false);
  control('confirmation-on-another-route-cannot-qualify-deletion', r => {
    for (const event of r.witness.events) if (event.kind === 'click' && canonicalId(event.testId) === 'bankaccount-delete-confirm') event.path = '/other';
  }, false);
  control('opening-delete-dialog-cannot-replace-confirmation', r => {
    for (const event of r.witness.events) if (event.kind === 'click' && canonicalId(event.testId) === 'bankaccount-delete-confirm') event.kind = 'focusout';
  }, false);
  control('confirmation-must-target-the-current-visible-bank', r => states(r).forEach(s => {
    for (const dialog of s.bankDeleteDialogs) dialog.text = 'Delete Other Bank? Cancel Confirm deletion';
  }), false);
  control('hidden-delete-dialog-cannot-qualify-confirmation', r => states(r).forEach(s => s.bankDeleteDialogs.forEach(d => d.visible = false)), false);
  control('two-matching-delete-dialogs-cannot-select-a-unique-bank', r => states(r).forEach(s => {
    const visible = s.bankDeleteDialogs.find(d => d.visible); if (visible) s.bankDeleteDialogs.push({ ...visible });
  }), false);
}
console.log(JSON.stringify({ type: 'counterfactual-trace-controls', excludedFromStudy: true, languageModelUsed: false,
  caseId: record.caseId, captureSourcePins: record.sourcePins,
  replaySourcePins: { ...evaluateCalibration(record, feature).provenance.replaySourcePins,
    'scripts/adverse-replay.mjs': createHash('sha256').update(readFileSync(new URL('./adverse-replay.mjs', import.meta.url))).digest('hex') },
  controls: results, ok: results.every(r => r.ok) }));
