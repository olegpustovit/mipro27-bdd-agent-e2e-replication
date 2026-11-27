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
function isBankList(request) {
  if (!/^(?:\/api)?\/graphql$/.test(new URL(request.url()).pathname)) return false;
  try { return request.postDataJSON()?.operationName === 'ListBankAccount'; } catch { return false; }
}
// The app ignores a delete sent while it is loading the bank list, and it may load the list
// more than once. Wait until list loading has finished.
async function afterBankListSettles(w, open) {
  // Track list requests until each has a response; ignore requests that never report finishing.
  const pending = new Set();
  let seen = 0, last = Date.now();
  const started = request => { if (isBankList(request)) { pending.add(request); seen++; last = Date.now(); } };
  const answered = response => { if (pending.delete(response.request())) last = Date.now(); };
  const failed = request => { if (pending.delete(request)) last = Date.now(); };
  w.page.on('request', started); w.page.on('response', answered); w.page.on('requestfailed', failed);
  try {
    await open();
    const opened = Date.now(), deadline = opened + 7000;
    // Settled: loading started and every request was answered 500 ms ago, or no loading started within 1.5 s.
    while (!(pending.size === 0 && (seen > 0 ? Date.now() - last >= 500 : Date.now() - opened >= 1500))) {
      if (Date.now() > deadline) throw new Error('The bank list did not finish loading');
      await w.page.waitForTimeout(50);
    }
  } finally {
    w.page.off('request', started); w.page.off('response', answered); w.page.off('requestfailed', failed);
  }
}
export async function deleteBank(w, bank) {
  await afterBankListSettles(w, () => w.act(() => w.locator('banks').click()));
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
