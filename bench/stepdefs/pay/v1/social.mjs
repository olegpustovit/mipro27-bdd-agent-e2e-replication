import { When } from '@cucumber/cucumber';
import { expect } from 'playwright/test';
import './steps.mjs';

When('I open the feed transaction where {string} charged {string} {string} with note {string}', async function (sender, receiver, amount, note) {
  const rows = this.locator('transactionRows');
  const row = rows
    .filter({ hasText: `${sender} charged ${receiver}` })
    .filter({ has: this.page.getByText(note, { exact: true }) })
    .filter({ has: this.page.getByText(`+${amount}`, { exact: true }) });
  await expect(rows.first()).toBeVisible();
  if (!(await row.count())) {
    // The feed renders a window of rows. Scroll one viewport with overlap.
    const grid = this.page.locator('[data-test="transaction-list"] .ReactVirtualized__Grid');
    await this.act(() => grid.evaluate(element => element.scrollBy(0, element.clientHeight * 0.75)));
  }
  await this.act(() => row.click());
});
