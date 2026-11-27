import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

const command = fileURLToPath(new URL('./diff-check', import.meta.url));
const source = `
import { Then } from '@cucumber/cucumber';
import { expect } from 'playwright/test';
Then('the profile is visible', async function () {
  await expect(this.locator('profile')).toHaveText('Alice');
  await expect(this.locator('profile')).toBeVisible();
});
Then('the sign-in page appears', async function () {
  await expect(this.page).toHaveURL(/\\/signin$/);
});
`;

function compare(t, updated) {
  const dir = mkdtempSync(join(tmpdir(), 'p6tool-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const before = join(dir, 'before.mjs');
  const after = join(dir, 'after.mjs');
  writeFileSync(before, source);
  writeFileSync(after, updated);
  return spawnSync(process.execPath, [command, before, after], { encoding: 'utf8' });
}

test('flags a deleted expect', t => {
  const result = compare(t, source.replace("  await expect(this.locator('profile')).toBeVisible();", ''));
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /removed or changed assertion expect\(\.\.\.\)\.toBeVisible/);
});

test('flags a loosened matcher', t => {
  const result = compare(t, source.replace('toHaveText', 'toContainText'));
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /removed or changed assertion expect\(\.\.\.\)\.toHaveText/);
});

test('flags a removed step binding', t => {
  const result = compare(t, source.slice(0, source.indexOf("Then('the sign-in page")));
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /removed or changed step binding Then\('the sign-in page appears'\)/);
});

test('passes a pure locator rename with formatting changes', t => {
  const result = compare(t, source.replaceAll("'profile'", '"accountProfile"').replaceAll(';', ''));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS/);
});

test('rejects changes to matcher arguments', t => {
  const result = compare(t, source.replace("toHaveText('Alice')", "toHaveText(/Alice/)"));
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /changed assertion/);
});

test('rejects bypassing an otherwise unchanged assertion', t => {
  const result = compare(t, source.replace('  await expect', '  if (false) await expect'));
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /execution paths/);
});
