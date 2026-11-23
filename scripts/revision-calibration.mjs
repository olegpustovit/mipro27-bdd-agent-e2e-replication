// PRIVATE calibration bindings, never supplied to either measured agent.
// Establish fixture/observer validity, not measured maintenance success.
import { defaultActions } from './baseline.mjs';
import { validateActions } from './repair-policy.mjs';
import { locators, validateLocators } from '../study/locators.mjs';

export function revisionCalibrationBindings(revision) {
  if (!['v0', 'v1', 'v2'].includes(revision)) throw new Error('Unknown calibration revision');
  let actions = defaultActions();
  const selectors = { ...locators };
  if (revision !== 'v0') Object.assign(selectors, {
    signIn: 'role=button[name="Continue"]',
    signedIn: '[data-test="v1-sidenav-username"]', displayedName: '[data-test="v1-sidenav-user-full-name"]',
    profileForm: '[data-test="v1-user-settings-form"]', signOut: '[data-test="v1-sidenav-signout"]',
    save: 'role=button[name=/^(Apply changes|Create account)$/i]',
    bankRows: '[data-test^="v1-bankaccount-list-item-"]',
    pay: 'role=button[name="Send money"]', request: 'role=button[name="Request funds"]',
    mine: 'role=tab[name="My activity"]', friends: 'role=tab[name="People I know"]',
    like: '[data-test^="v1-transaction-like-button-"]', likeCount: '[data-test^="v1-transaction-like-count-"]',
  });
  if (revision === 'v2') {
    const menu = "await w.act(() => w.page.getByRole('button', { name: 'Account menu', exact: true }).click());";
    for (const key of ['signOut', 'account', 'banks']) {
      const command = `await w.act(() => w.locator('${key}').click());`;
      actions = actions.replaceAll(command, menu + '\n  ' + command);
    }
    const command = "await w.act(() => w.locator('deleteBank', row).click());";
    actions = actions.replace(command, command + "\n  await w.act(() => w.page.getByRole('dialog').getByRole('button', { name: 'Confirm deletion', exact: true }).click());");
  }
  return { actions: validateActions(actions), selectors: validateLocators(selectors) };
}
