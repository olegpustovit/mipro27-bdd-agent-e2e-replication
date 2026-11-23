import { database, seed } from './fixture.mjs';
import { checkKind, summarizeChecks } from '../study/contracts.mjs';
import { findReloadAfter } from './witness.mjs';
// Executed only by the harness after the testing agent has finished.
// These checks do not accept an agent's final answer as evidence.
export async function oracle(caseId, context, witness = { signedIn: false, events: [] }) {
  const db = database(), before = seed(), user = before.users[0], recipient = before.users[1];
  const pages = context.pages();
  const page = pages.findLast(p => p.url().startsWith('http://localhost:3000'));
  const checks = [];
  const check = (name, ok, actual, kind = 'contract') => checks.push({ name, ok: Boolean(ok), actual, kind: checkKind(name, kind) });
  if (!page) return { valid: false, triggerWitnessed: false, completionWitnessed: false, defectObserved: false, evaluable: false, checks: [{ name: 'application-page', ok: false }] };
  page.setDefaultTimeout(1000);
  const clicked = test => witness.events.some(e => e.kind === 'click' && test(e));
  const entered = (name, value) => witness.events.some(e => e.kind === 'input' && e.name === name && e.value === value);
  const clickedId = id => clicked(e => e.testId === id);
  const saved = clicked(e => /^(Save|Save changes)$/i.test(e.text));
  const triggers = {
    'auth-login': entered('username', 'Heath93') && clickedId('signin-submit'),
    'auth-logout': witness.signedIn && clickedId('sidenav-signout'),
    'profile-name': witness.signedIn && entered('firstName', 'Study') && saved,
    'profile-email': witness.signedIn && entered('email', 'invalid-email'),
    'bank-create': witness.signedIn && entered('bankName', 'Study Credit Union') && saved,
    'bank-delete': witness.signedIn && clickedId('bankaccount-delete'),
    'transfer-pay': witness.signedIn && clickedId('transaction-create-submit-payment'),
    'transfer-request': witness.signedIn && clickedId('transaction-create-submit-request'),
    'social-like': witness.signedIn && clicked(e => e.testId === 'transaction-like-button-1xfcAhNDZK4'),
    'social-comment': witness.signedIn && entered('content', 'Study comment') && witness.events.some(e => e.kind === 'keydown' && e.key === 'Enter' && e.name === 'content'),
    'feed-personal': witness.signedIn && clickedId('nav-personal-tab'),
    'feed-friends': witness.signedIn && clickedId('nav-contacts-tab'),
  };
  const url = new URL(page.url());
  const current = db.users.find(u => u.id === user.id);
  const triggerSelectors = {
    'auth-login': e => e.kind === 'click' && e.testId === 'signin-submit',
    'auth-logout': e => e.kind === 'click' && e.testId === 'sidenav-signout',
    'profile-name': e => e.kind === 'click' && e.testId === 'user-settings-submit',
    'profile-email': e => e.kind === 'input' && e.name === 'email' && e.value === 'invalid-email',
    'bank-create': e => e.kind === 'click' && e.testId === 'bankaccount-submit',
    'bank-delete': e => e.kind === 'click' && e.testId === 'bankaccount-delete',
    'transfer-pay': e => e.kind === 'click' && e.testId === 'transaction-create-submit-payment',
    'transfer-request': e => e.kind === 'click' && e.testId === 'transaction-create-submit-request',
    'social-like': e => e.kind === 'click' && e.testId === 'transaction-like-button-1xfcAhNDZK4',
    'social-comment': e => e.kind === 'keydown' && e.key === 'Enter' && e.name === 'content',
  };
  const triggerIndex = triggerSelectors[caseId] ? witness.events.findLastIndex(triggerSelectors[caseId]) : -1;
  const reloadPaths = { 'auth-logout': '/signin', 'profile-name': '/user/settings', 'profile-email': '/user/settings', 'bank-create': '/bankaccounts', 'bank-delete': '/bankaccounts', 'transfer-pay': '/personal', 'transfer-request': '/personal', 'social-like': '/transaction/1xfcAhNDZK4', 'social-comment': '/transaction/1xfcAhNDZK4' };
  if (reloadPaths[caseId]) check('required-reload-after-action', Boolean(findReloadAfter(witness.events, triggerIndex, reloadPaths[caseId])), reloadPaths[caseId], 'completion');
  if (caseId === 'auth-login' || caseId === 'auth-logout') {
    // A separate observer checks the persisted session through the ordinary API.
    const response = await context.request.get('http://localhost:3001/checkAuth');
    const body = response.ok() ? await response.json() : null;
    const authenticated = body?.user?.id === user.id;
    if (caseId === 'auth-login') { check('session-authenticated', authenticated, body?.user?.id ?? response.status()); check('home-url', url.pathname === '/' || url.pathname === '/public', url.pathname); check('visible-identity', await page.locator('[data-test="sidenav-username"]').textContent().catch(() => '') === '@Heath93', 'Heath93'); }
    else { check('session-ended', !authenticated && response.status() === 401, response.status()); check('signin-url', url.pathname === '/signin', url.pathname); check('visible-signin', await page.getByRole('heading', { name: /Sign in|Log in/i }).isVisible(), 'Sign in'); }
  }
  if (caseId === 'profile-name') { check('persisted-first-name', current.firstName === 'Study', current.firstName); check('visible-first-name', await page.getByPlaceholder('First Name', { exact: true }).inputValue().catch(() => '') === 'Study', 'Study'); }
  if (caseId === 'profile-email') {
    check('invalid-email-not-persisted', current.email === user.email, current.email);
    const validations = witness.events.map(e => e.emailValidation).filter(Boolean);
    check('observable-invalid-email-rejection', validations.some(v => v.saveDisabled && v.errorVisible), validations);
    check('visible-retained-email', await page.getByPlaceholder('Email', { exact: true }).inputValue().catch(() => '') === user.email, user.email, 'completion');
  }
  if (caseId === 'bank-create') {
    check('required-routing-and-account-entered', entered('routingNumber', '987654321') && entered('accountNumber', '123456789'), { routing: '987654321', account: '123456789' }, 'completion');
    const banks = db.bankaccounts.filter(b => b.userId === user.id && b.bankName === 'Study Credit Union');
    check('one-persisted-account', banks.length === 1, banks.length);
    // The UI does not display saved account/routing numbers. Preserve their
    // audit evidence without using an inaccessible truth to score either arm.
    check('account-details-audit-only', banks.length === 1 && banks[0].accountNumber === '123456789' && banks[0].routingNumber === '987654321' && banks[0].isDeleted === false, banks.map(b => ({ accountNumber: b.accountNumber, routingNumber: b.routingNumber, isDeleted: b.isDeleted })), 'audit');
    check('visible-bank-listing', await page.locator('[data-test^="bankaccount-list-item-"]').filter({ hasText: 'Study Credit Union' }).count() === 1, 'Study Credit Union');
  }
  if (caseId === 'bank-delete') { const id = before.bankaccounts.find(b => b.userId === user.id).id; check('soft-delete-persisted', db.bankaccounts.find(b => b.id === id)?.isDeleted === true, db.bankaccounts.find(b => b.id === id)?.isDeleted); check('visible-deleted-bank', (await page.locator(`[data-test="bankaccount-list-item-${id}"]`).textContent().catch(() => '')).includes('(Deleted)'), id); }
  if (caseId.startsWith('transfer-')) {
    const request = caseId === 'transfer-request';
    const records = db.transactions.filter(t => !before.transactions.some(old => old.id === t.id));
    check('exactly-one-new-transaction', records.length === 1, records.length);
    const t = records[0];
    check('exact-transaction-fields', records.length === 1 && t.amount === 1200 && t.description === `Study ${request ? 'request' : 'payment'}` && t.senderId === user.id && t.receiverId === recipient.id && (request ? t.requestStatus === 'pending' && t.status === 'pending' : (t.requestStatus ?? '') === ''), t && { amount: t.amount, description: t.description, senderId: t.senderId, receiverId: t.receiverId, status: t.status, requestStatus: t.requestStatus });
    const rows = page.locator('[data-test^="transaction-item-"]').filter({ hasText: `Study ${request ? 'request' : 'payment'}` });
    const visible = await rows.count() === 1 ? await rows.textContent() : '';
    check('visible-exact-transfer', visible.includes('$12.00') && visible.includes('Kristian') && visible.includes(request ? 'requested' : 'paid'), visible);
  }
  if (caseId === 'social-like') {
    const likes = db.likes.filter(l => l.transactionId === '1xfcAhNDZK4' && l.userId === user.id);
    check('one-persisted-like', likes.length === 1, likes.length);
    check('one-new-like-total', db.likes.length === before.likes.length + 1, db.likes.length - before.likes.length);
    const expected = before.likes.filter(l => l.transactionId === '1xfcAhNDZK4').length + 1;
    check('visible-like-count', Number((await page.locator('[data-test="transaction-like-count-1xfcAhNDZK4"]').textContent().catch(() => '')).trim()) === expected, expected);
    check('visible-like-disabled', await page.locator('[data-test="transaction-like-button-1xfcAhNDZK4"]').isDisabled().catch(() => false), true);
  }
  if (caseId === 'social-comment') {
    const comments = db.comments.filter(c => !before.comments.some(old => old.id === c.id));
    check('one-new-comment', comments.length === 1, comments.length);
    check('exact-comment', comments.length === 1 && comments[0].transactionId === '1xfcAhNDZK4' && comments[0].userId === user.id && comments[0].content === 'Study comment', comments.map(c => ({ transactionId: c.transactionId, userId: c.userId, content: c.content })));
    check('visible-single-comment', await page.getByText('Study comment', { exact: true }).count() === 1, 'Study comment');
  }
  if (caseId.startsWith('feed-')) {
    const personal = caseId === 'feed-personal';
    check('feed-route', url.pathname === (personal ? '/personal' : '/contacts'), url.pathname);
    const header = personal ? 'Personal' : 'Contacts';
    check('feed-header', await page.locator('.MuiListSubheader-root').filter({ hasText: new RegExp(`^${header}$`) }).isVisible(), header);
    const ids = await page.locator('[data-test^="transaction-item-"]').evaluateAll(rows => rows.map(r => r.getAttribute('data-test').slice('transaction-item-'.length)));
    const contacts = new Set(before.contacts.filter(c => c.userId === user.id).map(c => c.contactUserId));
    // The pinned educational app's contacts endpoint includes every transaction
    // involving a contact. Do not impose a different privacy contract here.
    const eligible = before.transactions.filter(t => personal ? t.senderId === user.id || t.receiverId === user.id : contacts.has(t.senderId) || contacts.has(t.receiverId));
    check('visible-nonempty-feed', ids.length > 0, ids.length);
    check('feed-membership-audit', ids.every(id => eligible.some(t => t.id === id)), ids);
  }
  const triggerWitnessed = Boolean(triggers[caseId]);
  const result = summarizeChecks(checks, triggerWitnessed);
  return witness.truncated ? { ...result, evaluable: false, valid: false, completionWitnessed: false, instrumentationError: 'Witness event bound exceeded' } : result;
}
