// Executable design constants. Findings and gate decisions belong in Foundry.
export const manifest = Object.freeze({
  schema: 1,
  appRevision: '0729f68ac220f7cda4ad09c5693dba11d7c532c6',
  model: 'gpt-6-luna',
  cliVersion: '0.159.3',
  nodeVersion: 'v24.22.1',
  campaignEnabled: false, // Change only after an independently passed Evidence gate.
  repetitions: 3,
  conditions: ['reference', 'ui', 'fault', 'ui-fault'],
  arms: ['maintained', 'runtime'],
  limits: { maxRunMs: 86400000, wallMs: 240000, toolCalls: 80, retainedBrowserActionsTotal: 80, baselineRuns: 3, repairEdits: 2, scenarioMs: 60000, stepMs: 10000 },
  technicalCases: ['auth-login', 'auth-logout', 'profile-name'],
  pilotCells: [
    { caseId: 'auth-login', condition: 'reference' },
    { caseId: 'profile-email', condition: 'fault' },
    { caseId: 'bank-create', condition: 'ui' },
  ],
});
export const cases = Object.freeze([
  { id: 'auth-login', family: 'authentication', expected: 'Authenticated home shows @Heath93 after valid sign-in' },
  { id: 'auth-logout', family: 'authentication', expected: 'Sign-out returns to sign-in; reload remains signed out' },
  { id: 'profile-name', family: 'profile', expected: 'First name Study persists after reload' },
  { id: 'profile-email', family: 'profile', expected: 'Invalid email is rejected with validation, disabled Save and original value after reload' },
  { id: 'bank-create', family: 'banking', expected: 'Exactly one Study Credit Union account persists in the reloaded bank list; hidden number fields are audit-only' },
  { id: 'bank-delete', family: 'banking', expected: 'Original account is soft deleted and marked Deleted after reload' },
  { id: 'transfer-pay', family: 'transfers', expected: 'Exactly one $12 payment to Kristian Bradtke persists with note Study payment' },
  { id: 'transfer-request', family: 'transfers', expected: 'Exactly one $12 pending request to Kristian Bradtke persists with note Study request' },
  { id: 'social-like', family: 'social', expected: 'Exactly one new like by Heath93 persists on transaction 1xfcAhNDZK4' },
  { id: 'social-comment', family: 'social', expected: 'Exactly one Study comment persists on transaction 1xfcAhNDZK4' },
  { id: 'feed-personal', family: 'feeds', expected: 'Mine opens /personal with Personal feed and seeded personal transactions' },
  { id: 'feed-friends', family: 'feeds', expected: 'Friends opens /contacts with Contacts feed and seeded contacts transactions' },
]);
export function plan(repetitions = manifest.repetitions, selected = cases) {
  const trials = [];
  // Fixed, balanced arm order within each paired repetition. No adaptive ordering.
  for (let repetition = 1; repetition <= repetitions; repetition++) {
    for (let c = 0; c < selected.length; c++) {
      for (let k = 0; k < manifest.conditions.length; k++) {
        const arms = (repetition + c + k) % 2 ? [...manifest.arms] : [...manifest.arms].reverse();
        for (const arm of arms) trials.push({ caseId: selected[c].id, condition: manifest.conditions[k], repetition, arm });
      }
    }
  }
  return trials;
}
