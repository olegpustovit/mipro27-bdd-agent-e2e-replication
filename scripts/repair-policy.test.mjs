import test from 'node:test';
import assert from 'node:assert/strict';
import { validateActions } from './repair-policy.mjs';
import { defaultActions } from './baseline.mjs';
import { locators, validateLocators } from '../study/locators.mjs';
test('retained step actions and strong semantic locator registry are repairable', () => {
  assert.equal(validateActions(defaultActions()), defaultActions());
  assert.deepEqual(validateLocators({ ...locators, signIn: 'role=button[name="Log In"]' }).signIn, 'role=button[name="Log In"]');
  assert.doesNotThrow(() => validateActions(defaultActions().replace("w.locator('signIn').click()", "w.page.getByRole('button', { name: 'Log In' }).click()")));
});
test('repair cannot import, inspect sources, execute code or call fixture APIs', () => {
  for (const text of ['process.env', 'globalThis.fetch("http://localhost:3001/testData/seed")', 'w.page.evaluate("document.cookie")', 'w.page.context()', 'w.page.request.get("/checkAuth")', 'w["page"]', '({}).constructor', 'await import("node:fs")', 'w.page.goto("http:" + "//localhost:3000/src/source.ts")', 'w.page.locator("script").textContent()']) {
    const code = defaultActions().replace("await w.act(() => w.locator('signOut').click());", `${text};`);
    assert.throws(() => validateActions(code), undefined, text);
  }
  assert.throws(() => validateLocators({ ...locators, signIn: 'http://localhost:3001/testData/seed' }));
});

test('repairs cannot bypass or batch the private before-action observation boundary', () => {
  const original = "await w.act(() => w.locator('signOut').click());";
  for (const replacement of [
    "await w.locator('signOut').click();",
    "const fake = { act: fn => fn() }; await fake.act(() => w.locator('signOut').click());",
    "await w.act(async () => { await w.locator('signOut').click(); await w.locator('signIn').click(); });",
    "w.act(() => w.locator('signOut').click());",
    "await w.act(() => { w.locator('signOut').click(); });",
    "const click = w.locator('signOut').click; await click();",
    "{ const w = { act: true }; await w.act(() => w.locator('signOut').click()); }",
    "await w.act(() => w.act(() => w.locator('signOut').click()));",
    "selectFeed(w, 'Mine'); selectFeed(w, 'Friends');",
    "await selectFeed(w, 'Mine');",
  ]) assert.throws(() => validateActions(defaultActions().replace(original, replacement)), undefined, replacement);
  assert.doesNotThrow(() => validateActions(defaultActions().replace(original,
    "await w.act(async () => { return await w.page.getByRole('button', { name: 'Log Out' }).click(); });")));
  assert.doesNotThrow(() => validateActions(defaultActions().replaceAll(/\bw\b/g, 'world')));
});
