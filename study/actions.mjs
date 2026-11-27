// Repairable retained Cucumber action implementation. Assertions live in steps.mjs.
// This module intentionally imports nothing; the approved UI capability is `w`.
export async function signIn(w, username, password) {
  await w.act(() => w.locator('username').fill(username));
  await w.act(() => w.locator('password').fill(password));
  await w.act(() => w.locator('signIn').click());
}
export async function signOut(w) { await w.act(() => w.locator('signOut').click()); }
export async function updateProfile(w, key, value) {
  await w.act(() => w.locator('account').click());
  await w.act(() => w.locator(key).fill(value));
  await w.act(() => w.locator('save').click());
}
export async function invalidEmail(w, value) {
  await w.act(() => w.locator('account').click());
  await w.act(() => w.locator('email').fill(value));
  await w.act(() => w.locator('email').press('Tab'));
}
export async function addBank(w, bank, routing, account) {
  await w.act(() => w.locator('banks').click());
  await w.act(() => w.locator('createBank').click());
  await w.act(() => w.locator('bankName').fill(bank));
  await w.act(() => w.locator('routing').fill(routing));
  await w.act(() => w.locator('accountNumber').fill(account));
  await w.act(() => w.locator('save').click());
}
function isBankList(response) {
  if (!/^(?:\/api)?\/graphql$/.test(new URL(response.url()).pathname)) return false;
  try { return response.request().postDataJSON()?.operationName === 'ListBankAccount'; } catch { return false; }
}
export async function deleteBank(w, bank) {
  // The app ignores a delete sent while it is still loading the list; wait for the list first.
  const listed = w.page.waitForResponse(isBankList, { timeout: 10000 });
  await w.act(() => w.locator('banks').click());
  await listed;
  const row = w.locator('bankRows').filter({ hasText: bank });
  await w.act(() => w.locator('deleteBank', row).click());
}
export async function transfer(w, type, amount, recipient, note) {
  await w.act(() => w.locator('newTransfer').click());
  await w.act(() => w.locator('search').fill(recipient));
  await w.act(() => w.locator('userRows').filter({ hasText: recipient }).click());
  await w.act(() => w.locator('amount').fill(amount));
  await w.act(() => w.locator('note').fill(note));
  await w.act(() => w.locator(type === 'Pay' ? 'pay' : 'request').click());
}
export async function openPersonalFeed(w) {
  await w.act(() => w.page.goto('http://localhost:3000/'));
  await w.act(() => w.locator('mine').click());
}
export async function like(w) { await w.act(() => w.locator('like').click()); }
export async function comment(w, text) {
  await w.act(() => w.locator('comment').fill(text));
  await w.act(() => w.locator('comment').press('Enter'));
}
export async function selectFeed(w, feed) { await w.act(() => w.locator(feed === 'Mine' ? 'mine' : 'friends').click()); }
