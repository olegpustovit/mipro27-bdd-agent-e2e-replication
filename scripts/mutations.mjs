import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { cases, manifest } from '../study/manifest.mjs';
export const appRoot = fileURLToPath(new URL('../upstream/cypress-realworld-app/', import.meta.url));
const component = name => `src/components/${name}.tsx`;
// Each mutation changes a real UI command or destination. No fake outcome flags.
export const faults = {
  'auth-login': [component('SignInForm'), 'signInPending(values);', 'signInPending({ ...values, password: "controlled-invalid-password" });'],
  'auth-logout': [component('NavDrawer'), 'const signOut = () => sendAuth("LOGOUT");', 'const signOut = () => undefined;'],
  'profile-name': [component('UserSettingsForm'), 'updateUser({ id: userProfile.id, ...values });', 'updateUser({ id: userProfile.id, ...values, firstName: userProfile.firstName });'],
  'profile-email': [component('UserSettingsForm'), 'email: string().email("Must contain a valid email address").required("Enter an email address"),', 'email: string().required("Enter an email address"),'],
  'bank-create': [component('BankAccountForm'), 'createBankAccount({ ...values, userId });', 'createBankAccount({ ...values, userId, bankName: "Altered Bank" });'],
  'bank-delete': [component('BankAccountItem'), 'deleteBankAccount({ id: bankAccount.id });', 'void bankAccount.id;'],
  'transfer-pay': [component('TransactionCreateStepTwo'), 'createTransaction({ transactionType, ...values });', 'createTransaction({ transactionType, ...values, amount: Number(values.amount) + 1 });'],
  'transfer-request': [component('TransactionCreateStepTwo'), 'createTransaction({ transactionType, ...values });', 'createTransaction({ ...values, transactionType: "payment" });'],
  'social-like': [component('TransactionDetail'), 'onClick={() => transactionLike(transaction.id)}', 'onClick={() => undefined}'],
  'social-comment': [component('CommentForm'), 'transactionComment({ transactionId, ...values });', 'transactionComment({ transactionId, ...values, content: "Altered comment" });'],
  'feed-personal': [component('TransactionNavTabs'), 'to="/personal" data-test="nav-personal-tab"', 'to="/contacts" data-test="nav-personal-tab"'],
  'feed-friends': [component('TransactionNavTabs'), 'to="/contacts" data-test="nav-contacts-tab"', 'to="/personal" data-test="nav-contacts-tab"'],
};
// Benign redesigns preserve data-test contracts, input names, commands and routes.
// Copy changes are ordinary semantic synonyms; layout changes affect every family.
export const benign = [
  [component('SignInForm'), '                Sign In\n', '                Log In\n'],
  [component('NavDrawer'), 'primary="My Account"', 'primary="Account settings"'],
  [component('NavDrawer'), 'primary="Logout"', 'primary="Sign out"'],
  [component('UserSettingsForm'), '                  Save\n', '                  Save changes\n'],
  [component('BankAccountForm'), '                Save\n', '                Save changes\n'],
  ['src/containers/BankAccountsContainer.tsx', '            Create\n', '            Add account\n'],
  [component('BankAccountItem'), '              Delete\n', '              Remove\n'],
  [component('TransactionCreateStepTwo'), '                    Pay\n', '                    Send payment\n'],
  [component('TransactionCreateStepTwo'), '                    Request\n', '                    Request payment\n'],
  [component('TransactionNavTabs'), 'label="Mine"', 'label="My transactions"'],
  [component('TransactionNavTabs'), 'label="Friends"', 'label="Contacts"'],
  [component('UserSettingsForm'), 'margin="dense"', 'margin="normal"', 4],
  [component('BankAccountForm'), 'margin="dense"', 'margin="normal"', 3],
  [component('TransactionCreateStepTwo'), 'margin="dense"', 'margin="normal"', 2],
  [component('TransactionDetail'), 'spacing={2}', 'spacing={3}', 2],
];
const paths = [...new Set([...Object.values(faults), ...benign].map(p => p[0]))];
export function pristineSources() {
  return Object.fromEntries(paths.map(path => [path, execFileSync('git', ['show', `${manifest.appRevision}:${path}`], { cwd: appRoot, encoding: 'utf8' })]));
}
export function replaceChecked(source, before, after, count = 1) {
  if (source.split(before).length - 1 !== count) throw new Error(`Mutation anchor count changed: ${JSON.stringify(before)}`);
  return source.split(before).join(after);
}
export function variantSources(caseId, condition, original = pristineSources()) {
  if (!cases.some(c => c.id === caseId) || !manifest.conditions.includes(condition)) throw new Error('Unknown case or condition');
  const result = { ...original };
  const patches = [...(condition.includes('ui') ? benign : []), ...(condition.includes('fault') ? [faults[caseId]] : [])];
  for (const [path, before, after, count] of patches) result[path] = replaceChecked(result[path], before, after, count);
  for (const path of paths) if (result[path] !== original[path]) result[path] += `\n/*! study-build-${createHash('sha256').update(result[path]).digest('hex').slice(0, 20)} */\n`;
  return result;
}
export function applyVariant(caseId, condition) {
  const originals = pristineSources();
  // Refuse to overwrite unrecognized owner edits or a different source revision.
  for (const path of paths) {
    const current = readFileSync(`${appRoot}${path}`, 'utf8');
    if (current !== originals[path]) throw new Error(`Fixture has an undeclared source edit: ${path}; restore through the harness first`);
  }
  const changed = variantSources(caseId, condition, originals);
  for (const path of paths) if (changed[path] !== originals[path]) writeFileSync(`${appRoot}${path}`, changed[path]);
  const restore = () => { for (const path of paths) if (changed[path] !== originals[path]) {
    if (readFileSync(`${appRoot}${path}`, 'utf8') !== changed[path]) throw new Error(`Fixture changed during trial: ${path}`);
    writeFileSync(`${appRoot}${path}`, originals[path]);
  } };
  restore.ready = async () => {
    const overallDeadline = Date.now() + 15000;
    for (const path of paths) {
      const marker = changed[path].match(/study-build-[a-f0-9]+/)?.[0] || null;
      const deadline = Math.min(overallDeadline, Date.now() + 10000);
      let ready = false;
      while (Date.now() < deadline) {
        const response = await fetch(`http://localhost:3000/${path}?study=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error(`Vite compilation failed for ${path}: HTTP ${response.status}`);
        const compiled = await response.text();
        if (marker ? compiled.includes(marker) : !/study-build-[a-f0-9]+/.test(compiled)) { ready = true; break; }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (!ready) throw new Error(`Vite did not serve the current controlled source for ${path}`);
    }
  };
  return restore;
}
