// Browser-visible behavior summaries for instrumentation. The executable input
// to both approaches is the identical Gherkin, including intermediate checks.
export const contracts = Object.freeze({
  'auth-login': 'Enter the specified credentials and verify the authenticated home identifies @Heath93.',
  'auth-logout': 'After signing out, verify the sign-in page and URL, reload, and verify they remain.',
  'profile-name': 'Save First Name as Study, verify the field and displayed full name reflect it, then reload and verify the field remains Study.',
  'profile-email': 'Enter invalid-email; verify the visible valid-email error and disabled Save, then reload and verify the original Email is retained.',
  'bank-create': 'Enter all specified bank, routing and account values. Verify exactly one matching bank listing before and after reload. Saved routing/account digits are not displayed and are not scored assertions.',
  'bank-delete': 'Delete the named bank. Verify its listing is marked (Deleted) before and after reload.',
  'transfer-pay': 'Submit the specified payment and verify its confirmation heading. Open the personal feed, reload, and verify exactly one matching note row showing $12.00, Kristian and paid.',
  'transfer-request': 'Submit the specified request and verify its confirmation heading. Open the personal feed, reload, and verify exactly one matching note row showing $12.00, Kristian and requested.',
  'social-like': 'Record the initial count, like the transaction, and verify the count increases by exactly one and the Like control is disabled, both before and after reload.',
  'social-comment': 'Submit the specified comment, verify it is visible, then reload and verify it appears exactly once.',
  'feed-personal': 'Select Mine and verify /personal, the Personal feed heading and at least one visible transaction row.',
  'feed-friends': 'Select Friends and verify /contacts, the Contacts feed heading and at least one visible transaction row.',
});

// Private consistency checks are useful audits but cannot silently add a
// behavioral obligation absent from both arms' browser-visible contract.
const audits = new Set([
  'session-authenticated', 'session-ended', 'persisted-first-name',
  'invalid-email-not-persisted', 'one-persisted-account',
  'account-details-audit-only', 'soft-delete-persisted',
  'exactly-one-new-transaction', 'exact-transaction-fields',
  'one-persisted-like', 'one-new-like-total', 'one-new-comment',
  'exact-comment', 'feed-membership-audit',
]);
export function checkKind(name, requested = 'contract') {
  return audits.has(name) ? 'audit' : requested;
}
export function summarizeChecks(checks, triggerWitnessed) {
  const contractChecks = checks.filter(c => c.kind === 'contract');
  const publicChecks = checks.filter(c => c.kind !== 'audit');
  const contractSatisfied = contractChecks.length > 0 && contractChecks.every(c => c.ok);
  const completionWitnessed = Boolean(triggerWitnessed) && publicChecks.length > 0 && publicChecks.every(c => c.ok);
  return {
    valid: completionWitnessed, triggerWitnessed: Boolean(triggerWitnessed), completionWitnessed,
    defectObserved: Boolean(triggerWitnessed) && !contractSatisfied,
    contractViolated: !contractSatisfied,
    violatedPredicates: contractChecks.filter(c => !c.ok).map(c => c.name),
    auditMismatches: checks.filter(c => c.kind === 'audit' && !c.ok).map(c => c.name),
    evaluable: true, checks,
  };
}
