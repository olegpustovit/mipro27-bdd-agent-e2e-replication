// Candidate-revision compilation and UI smoke checks, excluded from study data.
import assert from 'node:assert/strict';
import { expect } from 'playwright/test';
import { acquireLock, reset, freshBrowser } from './fixture.mjs';
import { applyUIRevision } from './ui-revisions.mjs';
const unlock = acquireLock(), results = [];
const bank = "Waters, King and O'Reilly Bank";
const checks = [
  { revision: 'v0', caseId: 'auth-login', fault: false },
  { revision: 'v1', caseId: 'bank-delete', fault: false },
  { revision: 'v2', caseId: 'bank-delete', fault: false },
  { revision: 'v2', caseId: 'bank-delete', fault: true },
  { revision: 'v2', caseId: 'feed-personal', fault: true },
];
try {
  for (const item of checks) {
    let restore, browser;
    try {
      restore = applyUIRevision(item.caseId, item.revision, { fault: item.fault });
      await restore.ready(); await reset(); browser = await freshBrowser({ observeUI: false });
      const page = await browser.context.newPage(); await page.goto('http://localhost:3000/signin');
      await page.getByLabel('Username', { exact: true }).fill('Heath93');
      await page.getByLabel('Password', { exact: true }).fill('s3cret');
      await page.getByRole('button', { name: item.revision === 'v0' ? 'Sign In' : 'Continue', exact: true }).click();
      await expect(page.getByText('@Heath93', { exact: true })).toBeVisible();
      let outcome = { signedIn: true };
      if (item.caseId === 'bank-delete') {
        const link = page.getByRole('link', { name: 'Bank Accounts', exact: true });
        if (item.revision === 'v2') {
          await expect(link).toHaveCount(0);
          await page.getByRole('button', { name: 'Account menu', exact: true }).click();
        }
        await link.click();
        const row = page.locator('[data-test="bankaccount-list"] > li').filter({ hasText: bank });
        await row.getByRole('button', { name: 'Delete', exact: true }).click();
        if (item.revision === 'v2') {
          const dialog = page.getByRole('dialog'); await expect(dialog).toContainText(bank);
          await dialog.getByRole('button', { name: 'Confirm deletion', exact: true }).click();
          await expect(dialog).not.toBeVisible();
        }
        if (item.fault) { await page.waitForTimeout(5100); await expect(row).not.toContainText('(Deleted)'); }
        else await expect(row).toContainText('(Deleted)');
        outcome = { ...outcome, bankText: await row.innerText(), confirmationRequired: item.revision === 'v2' };
      }
      if (item.caseId === 'feed-personal') {
        await page.getByRole('tab', { name: 'My activity', exact: true }).click();
        await expect(page).toHaveURL('http://localhost:3000/contacts');
        outcome = { ...outcome, path: new URL(page.url()).pathname };
      }
      results.push({ ...item, ok: true, changedHooks: restore.changedHooks, outcome });
    } catch (error) {
      results.push({ ...item, ok: false, error: error.stack }); process.exitCode = 1;
    } finally { await browser?.close(); restore?.(); }
  }
  console.log(JSON.stringify({ type: 'candidate-ui-revision-smoke', excludedFromStudy: true, languageModelUsed: false,
    ok: results.every(r => r.ok), results, limits: ['Five compilation/UI smoke cases, not all12case/defect calibration.', 'No v1/v2 private semantic mapping or cumulative driver approval.', 'No measured comparison or confirmed agent detections.'] }));
} finally { try { await reset(); } finally { unlock(); } }
