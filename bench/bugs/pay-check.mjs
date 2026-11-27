import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const timeout = 10000;
const fixturePassword = 's3cret'; // Public upstream synthetic seed password.
const bankName = "Waters, King and O'Reilly Bank";
const transactionId = '1xfcAhNDZK4';

const test = (scope, name) => scope.locator(`[data-test="${name}"]`);
const prefix = (scope, name) => scope.locator(`[data-test^="${name}"]`);
const visibleText = (scope, value) => scope.getByText(value, { exact: true }).filter({ visible: true });
const input = (scope, name) => test(scope, name).locator('input');

function response(page, method, path, action, status = 200, matches = () => true) {
  return Promise.all([
    page.waitForResponse((reply) => {
      const url = new URL(reply.url());
      return url.pathname.replace(/^\/api(?=\/)/, '') === path && reply.request().method() === method && matches(reply, url);
    }, { timeout }),
    action(),
  ]).then(([reply]) => {
    assert.equal(reply.status(), status, `${method} ${path}`);
    return reply;
  });
}

async function eventually(read, expected, label) {
  const until = Date.now() + timeout;
  let actual;
  do {
    actual = await read();
    if (actual === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 80));
  } while (Date.now() < until);
  assert.equal(actual, expected, label);
}

async function login(page, version, name = 'Heath93', waitForHome = true) {
  await page.goto('/signin');
  const prefix = version === 'v0' ? 'signin' : 'login';
  await input(page, `${prefix}-username`).fill(name);
  await input(page, `${prefix}-password`).fill(fixturePassword);
  const reply = await response(page, 'POST', '/login', () => test(page, 'signin-submit').click());
  if (waitForHome) await test(page, 'sidenav-username').filter({ hasText: name }).waitFor();
  return reply.json();
}

async function signup(page, version, confirmation) {
  await page.goto('/signup');
  for (const [name, value] of Object.entries({
    'first-name': 'Avery', 'last-name': 'Lane', username: 'Avery_Lane', password: fixturePassword,
    [version === 'v2' ? 'confirm-password' : 'confirmPassword']: confirmation,
  })) {
    await input(page, `signup-${name}`).fill(value);
  }
  await page.locator('#confirmPassword').blur();
}

const checks = {
  async 'auth-login'({ page, version, bug, api }) {
    if (bug) {
      await response(page, 'POST', '/logout', () => login(page, version, 'Heath93', false), 302);
      await test(page, 'signin-submit').waitFor();
      await page.waitForURL('**/signin');
      assert.equal(await test(page, 'signin-error').count(), 0);
      assert.equal((await page.request.get(`${api}/checkAuth`)).status(), 401);
    } else {
      await login(page, version);
      assert.match(new URL(page.url()).pathname, /^\/(?:public)?$/);
      assert.equal((await page.request.get(`${api}/checkAuth`)).status(), 200);
    }
  },

  async 'auth-logout'({ page, version, bug, api }) {
    await login(page, version);
    await response(page, 'POST', '/logout', async () => {
      await test(page, 'sidenav-signout').click();
      if (version === 'v2') await test(page, 'signout-confirm').click();
    }, 302);
    assert.equal((await page.request.get(`${api}/checkAuth`)).status(), 401);
    if (bug) {
      await visibleText(page, 'Public').waitFor();
      await test(page, 'sidenav-username').filter({ hasText: 'Heath93' }).waitFor();
      assert.match(new URL(page.url()).pathname, /^\/(?:public)?$/);
      assert.equal(await test(page, 'signin-submit').count(), 0);
    } else {
      await test(page, 'signin-submit').waitFor();
      await page.waitForURL('**/signin');
    }
    await page.reload();
    await test(page, 'signin-submit').waitFor();
    await page.waitForURL('**/signin');
  },

  async 'profile-name'(context) {
    const { page, bug } = context;
    const { oldName, oldValue, field, saved } = await editProfile(context, 'firstName', 'Study');
    assert.equal(saved.firstName, bug ? oldValue : 'Study');
    assert.equal(await field.inputValue(), 'Study');
    await eventually(() => test(page, 'sidenav-user-full-name').innerText(),
      bug ? oldName : oldName.replace(/^\S+/, 'Study'), 'displayed full name');
  },

  async 'profile-email'({ page, version, bug }) {
    const { user } = await login(page, version);
    await test(page, 'sidenav-user-settings').click();
    const field = test(page, 'user-settings-email-input');
    await field.fill('invalid-email');
    await field.blur();
    const save = test(page, version === 'v2' ? 'user-settings-save' : 'user-settings-submit');
    const error = visibleText(page, 'Must contain a valid email address');
    if (bug) {
      await response(page, 'PATCH', `/users/${user.id}`, () => save.click(), 204);
      assert.equal(await error.count(), 0);
      assert.equal(await field.inputValue(), 'invalid-email');
    } else {
      await error.waitFor();
      await eventually(() => save.isDisabled(), true, 'invalid email disables Save');
    }
  },

  async 'bank-create'({ page, version, bug }) {
    await openBankAccounts(page, version);
    await test(page, 'bankaccount-new').click();
    const name = 'Study Credit Union';
    for (const [key, value] of Object.entries({
      bankName: name, routingNumber: '987654321', accountNumber: '123456789',
    })) await input(page, `bankaccount-${key}-input`).fill(value);
    const [reply, refreshed] = await Promise.all([
      graphql(page, 'CreateBankAccount', () => test(page, 'bankaccount-submit').click()),
      graphql(page, 'ListBankAccount', () => Promise.resolve()),
    ]);
    assert.equal(reply.createBankAccount.bankName, name);
    assert.equal(refreshed.listBankAccount.filter((row) => row.bankName === name).length, bug ? 0 : 1);
    await page.waitForURL('**/bankaccounts');
    await visibleText(page, bankName).waitFor();
    await eventually(() => visibleText(page, name).count(), bug ? 0 : 1, 'new bank row');
  },

  async 'bank-delete'({ page, version, bug }) {
    await openBankAccounts(page, version);
    const row = prefix(page, 'bankaccount-list-item-').filter({ hasText: bankName });
    const marker = visibleText(row, `${bankName} (Deleted)`);
    const remove = version === 'v2' ? 'bankaccount-remove' : 'bankaccount-delete';
    await test(row, remove).waitFor();
    const [reply, refreshed] = await Promise.all([
      graphql(page, 'DeleteBankAccount', async () => {
        await test(row, remove).click();
        if (version !== 'v0') await test(page, `${remove}-confirm`).click();
      }),
      graphql(page, 'ListBankAccount', () => Promise.resolve()),
    ]);
    assert.equal(reply.deleteBankAccount, true);
    assert.equal(refreshed.listBankAccount.find((account) => account.bankName === bankName).isDeleted, !bug);
    await eventually(() => marker.count(), bug ? 0 : 1, 'deleted marker');
    if (bug) await test(row, remove).waitFor();
  },

  async 'transfer-pay'(context) {
    await transfer(context, 'Pay', 'Study payment', 'paid', '-$1,200.00');
  },

  async 'transfer-request'(context) {
    await transfer(context, 'Request', 'Study request', 'requested', '+$0.00');
  },

  async 'social-like'({ page, version, bug }) {
    await login(page, version);
    await openDetail(page, transactionId);
    const likes = test(page, `transaction-like-count-${transactionId}`);
    const like = test(page, `transaction-like-button-${transactionId}`);
    const count = async () => Number((await likes.innerText()).trim());
    const before = await count();
    assert(Number.isInteger(before) && !(await like.isDisabled()));
    await like.click();
    await eventually(count, before + 1, 'like count before reload');
    await eventually(() => like.isDisabled(), true, 'Like disabled before reload');
    await page.reload();
    await like.waitFor();
    await eventually(count, bug ? before : before + 1, 'like count after reload');
    assert.equal(await like.isDisabled(), !bug);
  },

  async 'social-comment'({ page, version, bug }) {
    await login(page, version);
    await openDetail(page, transactionId);
    const text = 'Study comment';
    const comment = test(page, `transaction-comment-input-${transactionId}`);
    await comment.fill(text);
    const refreshed = await response(page, 'GET', `/transactions/${transactionId}`, () =>
      response(page, 'POST', `/comments/${transactionId}`, () => comment.press('Enter'), bug ? 503 : 200));
    const { transaction } = await refreshed.json();
    assert.equal(transaction.comments.filter(({ content }) => content === text).length, bug ? 0 : 1);
    await responseDetailReady(page, transactionId);
    await eventually(() => visibleText(test(page, 'comments-list'), text).count(),
      bug ? 0 : 1, 'posted comment in thread');
  },

  async 'feed-personal'(context) {
    await feed(context, 'personal', '/transactions', 'Personal');
  },

  async 'feed-friends'(context) {
    await feed(context, 'contacts', '/transactions/contacts', 'Contacts');
  },

  async 'hold-01'({ page, version, bug }) {
    await login(page, version);
    await test(page, 'sidenav-notifications').click();
    const text = visibleText(page, 'Kristian Bradtke liked a transaction.');
    await text.waitFor();
    const row = prefix(page, 'notification-list-item-').filter({ has: text });
    const id = (await row.getAttribute('data-test')).slice('notification-list-item-'.length);
    const refreshed = await response(page, 'GET', '/notifications', () =>
      response(page, 'PATCH', '/notifications/' + id,
        () => prefix(row, 'notification-mark-read-').click(), 204));
    const { results } = await refreshed.json();
    assert.equal(results.some((notification) => notification.id === id), bug);
    await eventually(() => text.count(), bug ? 1 : 0, 'notification after dismissal');
  },

  async 'hold-02'({ page, version, bug }) {
    await signup(page, version, fixturePassword);
    await response(page, 'POST', '/users', () => test(page, 'signup-submit').click(), 201);
    await login(page, version, 'Avery_Lane');
    await test(page, 'transaction-list').waitFor();
    const dialog = page.getByRole('dialog', { name: 'Get Started with Real World App' });
    await eventually(() => dialog.count(), bug ? 0 : 1, 'first sign-in onboarding dialog');
  },

  async 'hold-03'({ page, version, bug }) {
    await signup(page, version, 's3cret99');
    await eventually(() => test(page, 'signup-submit').isDisabled(), true, 'confirmation blocks submission');
    const message = visibleText(page, 'Password does not match');
    await eventually(() => message.count(), bug ? 0 : 1, 'confirmation mismatch message');
  },

  async 'hold-04'(context) {
    const { page, bug } = context;
    const { field, oldValue } = await editProfile(context, 'phoneNumber', '555-123-4567');
    assert.equal(oldValue, '398-225-9900');
    assert.equal(await field.inputValue(), '555-123-4567');
    await page.reload();
    await eventually(() => field.inputValue(), bug ? oldValue : '555-123-4567', 'reloaded phone');
  },

  async 'hold-05'({ page, version, bug }) {
    await login(page, version);
    await test(page, 'nav-top-new-transaction').click();
    const first = prefix(page, 'user-list-item-').first();
    await visibleText(first, 'Kristian Bradtke').waitFor();
    const reply = await response(page, 'GET', '/users/search',
      () => test(page, 'user-list-search-input').fill('Ruthie'),
      200, (_reply, url) => url.searchParams.get('q') === 'Ruthie');
    const { results } = await reply.json();
    const [firstMatch] = results;
    assert(firstMatch, 'the fixture has fuzzy matches through other fields');
    const firstName = `${firstMatch.firstName} ${firstMatch.lastName}`;
    assert.equal(firstName, bug ? 'Darrel Ortiz' : 'Ruthie Prosacco');
    await visibleText(first, firstName).waitFor();
  },

  async 'hold-06'(context) {
    await respondToRequest(context, 'Accept', 'Concert tickets', 2500);
  },

  async 'hold-07'(context) {
    await respondToRequest(context, 'Reject', 'Pizza night', 3000);
  },

  async 'hold-08'({ page, version, bug }) {
    await login(page, version);
    await test(page, 'nav-personal-tab').click();
    await test(page, 'transaction-list').waitFor();
    const chip = test(page, 'transaction-list-filter-amount-range-button');
    await chip.click();
    const thumbs = test(page, 'transaction-list-filter-amount-range-slider').getByRole('slider');
    const reply = await response(page, 'GET', '/transactions', async () => {
      await thumbs.last().press('Home');
      await thumbs.last().press('ArrowRight');
      await thumbs.last().press('ArrowRight');
      await thumbs.first().press('ArrowRight');
    }, 200, (_reply, url) => url.searchParams.get('amountMin') === '1000'
      && url.searchParams.get('amountMax') === '2000');
    await page.keyboard.press('Escape');
    await visibleText(chip, 'Amount: $10 - $20').waitFor();
    const { results, pageData } = await reply.json();
    assert(results.length > 0);
    const outside = results.find(({ amount }) => amount > 2000);
    assert.equal(Boolean(outside), bug);
    assert(results.every(({ amount }) => amount >= 1000));
    if (bug) await test(page, `transaction-amount-${outside.id}`).waitFor();
    else await checkRemainingPages(page, reply.url(), pageData);
  },
};

async function editProfile({ page, version }, key, value) {
  const { user } = await login(page, version);
  const oldName = await test(page, 'sidenav-user-full-name').innerText();
  await test(page, 'sidenav-user-settings').click();
  const field = test(page, `user-settings-${key}-input`);
  const oldValue = await field.inputValue();
  const refreshed = await response(page, 'GET', '/checkAuth', () =>
    response(page, 'PATCH', `/users/${user.id}`, async () => {
      await field.fill(value);
      await test(page, version === 'v2' ? 'user-settings-save' : 'user-settings-submit').click();
    }, 204));
  const { user: saved } = await refreshed.json();
  return { oldName, oldValue, field, saved };
}

async function openBankAccounts(page, version) {
  await login(page, version);
  await test(page, 'sidenav-bankaccounts').click();
  await visibleText(page, bankName).waitFor();
}

async function graphql(page, operation, action) {
  const reply = await response(page, 'POST', '/graphql', action, 200,
    (reply) => reply.request().postDataJSON().operationName === operation);
  const { data, errors } = await reply.json();
  assert.equal(errors, undefined);
  return data;
}

async function transfer({ page, version, bug }, action, note, verb, wrongAmount) {
  await login(page, version);
  await test(page, 'nav-top-new-transaction').click();
  await visibleText(test(page, 'users-list'), 'Kristian Bradtke').click();
  await input(page, 'transaction-create-amount-input').fill('12');
  await input(page, 'transaction-create-description-input').fill(note);
  const reply = await response(page, 'POST', '/transactions', async () => {
    await page.getByRole('button', { name: action, exact: true }).click();
    if (version === 'v2') {
      await test(page, 'transaction-create-continue').click();
      await test(page, 'transaction-review-confirm').click();
    }
  });
  const { transaction } = await reply.json();
  assert.equal(transaction.amount, 1200);
  await page.getByRole('heading').filter({ hasText: note }).waitFor();
  await page.goto('/personal');
  await test(page, `transaction-item-${transaction.id}`).waitFor();
  await page.reload();
  const row = test(page, `transaction-item-${transaction.id}`);
  await visibleText(row, note).waitFor();
  assert.equal(await prefix(page, 'transaction-item-').filter({ has: visibleText(page, note) }).count(), 1);
  assert.match(await row.innerText(), new RegExp(`${verb}\\s+Kristian`));
  assert.equal(await test(row, `transaction-amount-${transaction.id}`).innerText(),
    bug ? wrongAmount : action === 'Pay' ? '-$12.00' : '+$12.00');
}

async function openDetail(page, id) {
  await page.goto(`/transaction/${id}`);
  await responseDetailReady(page, id);
}

async function responseDetailReady(page, id) {
  await test(page, 'transaction-detail-header').waitFor();
  await test(page, `transaction-item-${id}`).waitFor();
}

async function feed({ page, version, bug }, tab, endpoint, title) {
  await login(page, version);
  const reply = await response(page, 'GET', endpoint, () => test(page, `nav-${tab}-tab`).click());
  assert.equal(new URL(page.url()).pathname, `/${tab}`);
  await visibleText(page, title).waitFor();
  const { results } = await reply.json();
  assert.equal(results.length > 0, !bug);
  if (bug) await test(page, 'empty-list-header').waitFor();
  else await prefix(page, 'transaction-item-').first().waitFor();
}

async function respondToRequest({ page, browser, version, bug, api }, action, note, amount) {
  const { user } = await login(page, version);
  const maker = await browser.newContext();
  let transaction;
  try {
    const login = await maker.request.post(`${api}/login`, {
      data: { username: 'Judah_Dietrich50', password: fixturePassword },
    });
    assert.equal(login.status(), 200);
    const reply = await maker.request.post(`${api}/transactions`, {
      data: { transactionType: 'request', receiverId: user.id, amount, description: note },
    });
    assert.equal(reply.status(), 200);
    ({ transaction } = await reply.json());
  } finally {
    await maker.close();
  }
  await test(page, 'nav-personal-tab').click();
  await visibleText(test(page, `transaction-item-${transaction.id}`), note).click();
  const title = async () => {
    const parts = await Promise.all(['sender', 'action', 'receiver'].map((part) =>
      test(page, `transaction-${part}-${transaction.id}`).innerText()));
    return parts.map((part) => part.trim()).join(' ');
  };
  const requested = 'Lia Rosenbaum requested Ted Parisian';
  await eventually(title, requested, 'pending request title');
  const accept = test(page, `transaction-accept-request-${transaction.id}`);
  const reject = test(page, `transaction-reject-request-${transaction.id}`);
  await accept.waitFor();
  await reject.waitFor();
  const endpoint = `/transactions/${transaction.id}`;
  const refreshed = await response(page, 'GET', endpoint, () =>
    response(page, 'PATCH', endpoint, async () => {
      await (action === 'Accept' ? accept : reject).click();
      if (action === 'Reject' && version !== 'v0') await test(page, 'transaction-reject-confirm').click();
    }, 204));
  const state = (await refreshed.json()).transaction;
  assert.equal(state.requestStatus, action === 'Accept' ? 'accepted' : 'rejected');
  await responseDetailReady(page, transaction.id);
  if (action === 'Accept') {
    await eventually(title, bug ? requested : 'Lia Rosenbaum charged Ted Parisian', 'accepted request title');
  } else {
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    const persisted = await page.request.get(api + endpoint);
    assert.equal(persisted.status(), 200);
    assert.equal((await persisted.json()).transaction.requestStatus, 'rejected');
    await eventually(() => accept.isVisible(), bug, 'Accept visibility after rejection');
    assert.equal(await reject.isVisible(), bug);
  }
}

async function checkRemainingPages(page, url, initialPage) {
  const target = new URL(url);
  for (let number = 2; number <= initialPage.totalPages; number++) {
    target.searchParams.set('page', String(number));
    const reply = await page.request.get(target.toString());
    assert.equal(reply.status(), 200);
    const { results } = await reply.json();
    assert(results.every(({ amount }) => amount >= 1000 && amount <= 2000));
  }
}

export async function runCheck(scenario) {
  const [mode, version, baseURL, api] = process.argv.slice(2);
  assert(['healthy', 'bug'].includes(mode) && ['v0', 'v1', 'v2'].includes(version) && baseURL && api,
    'Usage: node check.mjs healthy|bug v0|v1|v2 <app-url> <api-url>');
  const browser = await chromium.launch({
    executablePath: process.env.PAY_CHECK_CHROMIUM || undefined,
  });
  try {
    const page = await browser.newPage({ baseURL, viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(timeout);
    await checks[scenario]({ page, browser, version, api, bug: mode === 'bug' });
    console.log(`PASS pay-${scenario} ${version} ${mode}`);
  } finally {
    await browser.close();
  }
}
