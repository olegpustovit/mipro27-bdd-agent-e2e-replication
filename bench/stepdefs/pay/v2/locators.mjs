// Shared maintained locator registry. Repair agents may edit only selector values.
// Roles/labels/placeholders are preferred; test IDs cover controls without names.
export const locators = {
  username: 'label=Username', password: 'label=Password',
  signIn: 'role=button[name=/^(Sign In|Log In)$/i]',
  signedIn: '[data-test="sidenav-username"]',
  displayedName: '[data-test="sidenav-user-full-name"]',
  profileForm: '[data-test="user-settings-form"]',
  comments: '[data-test="comments-list"]',
  signInHeading: 'role=heading[name=/Sign in|Log in/i]',
  signOut: '[data-test="sidenav-signout"]',
  account: 'role=link[name=/My Account|Account settings/i]',
  firstName: 'label=First name *', email: 'label=Email address *',
  save: 'role=button[name=/^(Save|Save changes)$/i]',
  banks: 'role=link[name=/Bank Accounts/i]',
  createBank: 'role=link[name=/^(Create|Add account)$/i]',
  bankName: 'placeholder=Bank Name', routing: 'placeholder=Routing Number', accountNumber: 'placeholder=Account Number',
  bankRows: '[data-test^="bankaccount-list-item-"]', deleteBank: 'role=button[name=/^(Delete|Remove)$/i]',
  newTransfer: 'role=link[name=/New/i]', search: 'placeholder=Search...',
  userRows: '[data-test^="user-list-item-"]', amount: 'placeholder=Amount ($)', note: "placeholder=What's it for?",
  pay: 'role=button[name=/^(Pay|Send payment)$/i]', request: 'role=button[name=/^(Request|Request payment)$/i]',
  mine: 'role=tab[name=/^(Mine|My transactions)$/i]', friends: 'role=tab[name=/^(Friends|Contacts)$/i]',
  transactionRows: '[data-test^="transaction-item-"]',
  feedHeading: '.MuiListSubheader-root',
  like: '[data-test^="transaction-like-button-"]', likeCount: '[data-test^="transaction-like-count-"]',
  comment: 'placeholder=Write a comment...', commentText: '[data-test^="comment-list-item-"]',
};
export function validateLocators(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Locator registry must be an object');
  const keys = Object.keys(locators);
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(keys.sort())) throw new Error('Unknown locator key: repair only existing keys; their values are yours to change');
  for (const [key, selector] of Object.entries(value)) {
    if (typeof selector !== 'string' || !selector.trim() || selector.length > 500) throw new Error(`Invalid selector: ${key}`);
    if (/javascript:|file:|https?:|xpath=|>>.*(?:control|frame)/i.test(selector)) throw new Error(`Only page-local CSS and semantic selectors are permitted: ${key}`);
  }
  return value;
}
