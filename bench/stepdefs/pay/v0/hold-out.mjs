import assert from 'node:assert/strict';
import { Given, When, Then } from '@cucumber/cucumber';
import { expect } from 'playwright/test';
import * as actions from '../../../../study/actions.mjs';

const app = 'http://localhost:3000';
const button = (scope, name) => scope.getByRole('button', { name, exact: true });
const heading = (scope, name) => scope.getByRole('heading', { name, exact: true });
const signupField = (page, name) => page.locator(`[data-test="signup-${name}"] input`);

async function signIn(world, username, password) {
  await actions.signIn(world, username, password);
  await expect(world.locator('signedIn')).toHaveText('@' + username);
}

Given('Ted Parisian is signed in as {string} with password {string}', async function (username, password) {
  await this.act(() => this.page.goto(app + '/signin'));
  await signIn(this, username, password);
});

const notification = (page, text) => page.locator('[data-test^="notification-list-item-"]')
  .filter({ has: page.getByText(text, { exact: true }) });

Given('Ted opens the Notifications page', async function () {
  await this.act(() => this.page.getByRole('link', { name: 'Notifications', exact: true }).click());
  await expect(heading(this.page, 'Notifications')).toBeVisible();
});

Given('the notification {string} is listed', async function (text) {
  await expect(notification(this.page, text)).toBeVisible();
});

When('Ted clicks {string} on the notification {string}', async function (name, text) {
  await this.act(() => button(notification(this.page, text), name).click());
});

Then('the notification {string} is no longer listed', async function (text) {
  await expect(notification(this.page, text)).toHaveCount(0);
});

Given('the visitor is on the Sign Up page', async function () {
  await this.act(() => this.page.goto(app + '/signup'));
  await expect(heading(this.page, 'Sign Up')).toBeVisible();
});

async function fillSignup(world, first, last, username, password) {
  for (const [name, value] of [['first-name', first], ['last-name', last], ['username', username], ['password', password]]) {
    await world.act(() => signupField(world.page, name).fill(value));
  }
}

When('the visitor signs up with first name {string}, last name {string}, username {string}, password {string} and confirmation {string}', async function (first, last, username, password, confirmation) {
  await fillSignup(this, first, last, username, password);
  await this.act(() => signupField(this.page, 'confirmPassword').fill(confirmation));
  await this.act(() => button(this.page, 'Sign Up').click());
  await expect(this.locator('signInHeading')).toBeVisible();
});

When('the visitor signs in as {string} with password {string}', async function (username, password) {
  await actions.signIn(this, username, password);
});

Then('the {string} dialog is shown', async function (title) {
  const dialog = this.page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(heading(dialog, title)).toBeVisible();
});

When('the visitor fills in first name {string}, last name {string}, username {string} and password {string}', async function (first, last, username, password) {
  await fillSignup(this, first, last, username, password);
});

When('the visitor enters {string} as the password confirmation and leaves the field', async function (confirmation) {
  const field = signupField(this.page, 'confirmPassword');
  await this.act(() => field.fill(confirmation));
  await this.act(() => field.press('Tab'));
});

Then('the message {string} is shown under Confirm Password', async function (message) {
  const field = signupField(this.page, 'confirmPassword');
  await expect(field).toHaveAccessibleDescription(message);
  await expect(this.page.locator('[data-test="signup-confirmPassword"]').getByText(message, { exact: true })).toBeVisible();
});

Then('the {string} button is disabled', async function (name) {
  const control = button(this.page, name);
  await expect(control).toBeVisible();
  await expect(control).toBeDisabled();
});

const phone = page => page.getByPlaceholder('Phone Number', { exact: true });

Given('Ted opens the My Account page', async function () {
  await this.act(() => this.locator('account').click());
  await expect(this.locator('profileForm')).toBeVisible();
});

Then('the Phone Number field shows {string}', async function (number) {
  await expect(phone(this.page)).toBeVisible();
  await expect(phone(this.page)).toHaveValue(number);
});

When('Ted replaces the phone number with {string}', async function (number) {
  await this.act(() => phone(this.page).fill(number));
});

When('Ted clicks {string}', async function (name) {
  const control = button(this.page, name);
  if (name !== 'Save') {
    await this.act(() => control.click());
    return;
  }
  const [response] = await Promise.all([
    this.page.waitForResponse(response => response.request().method() === 'PATCH' &&
      /^\/users\/[^/]+$/.test(new URL(response.url()).pathname), { timeout: 5000 }),
    this.act(() => control.click()),
  ]);
  assert(response.ok(), `Profile save returned HTTP ${response.status()}`);
});

When('Ted reloads the My Account page', async function () {
  await this.act(() => this.page.reload());
});

When('Ted clicks {string} in the top bar', async function (name) {
  await this.act(() => this.page.getByRole('link', { name, exact: true }).click());
});

async function expectFirstPerson(world, name) {
  await expect(world.locator('userRows').first().getByText(name, { exact: true })).toBeVisible();
}

Given('the people list shows {string} first', async function (name) {
  await expectFirstPerson(this, name);
});

When('Ted types {string} into the {string} box', async function (value, placeholder) {
  await this.act(() => this.page.getByPlaceholder(placeholder, { exact: true }).fill(value));
});

Then('the first person in the list is {string}', async function (name) {
  await expectFirstPerson(this, name);
});

Given(/^Lia Rosenbaum \("([^"]+)", password "([^"]+)"\) has requested \$(\d+\.\d{2}) from Ted Parisian for "([^"]+)"$/, async function (username, password, amount, note) {
  await this.act(() => this.page.goto(app + '/signin'));
  await signIn(this, username, password);
  await actions.transfer(this, 'Request', amount, 'Ted Parisian', note);
  await expect(heading(this.page, `Requested $${amount} for ${note}`)).toBeVisible();
  await actions.signOut(this);
  await expect(this.locator('signInHeading')).toBeVisible();
});

Given('Ted opens the transaction {string} from the {string} tab', async function (note, tab) {
  await actions.selectFeed(this, tab);
  const row = this.locator('transactionRows').filter({ has: this.page.getByText(note, { exact: true }) });
  await this.act(() => row.click());
  await expect(heading(this.page, 'Transaction Detail')).toBeVisible();
});

Then(/^the transaction (?:still )?reads "([^"]+)"$/, async function (title) {
  const transaction = this.locator('transactionRows');
  await expect(transaction.getByText(title, { exact: true })).toBeVisible();
});

Given('the {string} and {string} buttons are shown', async function (first, second) {
  for (const name of [first, second]) await expect(button(this.page, name)).toBeVisible();
});

Then('the {string} and {string} buttons are no longer shown', async function (first, second) {
  for (const name of [first, second]) await expect(button(this.page, name)).toBeHidden();
});

Given('Ted opens the {string} tab', async function (name) {
  await actions.selectFeed(this, name);
});

const rangeChip = page => page.locator('[data-test="transaction-list-filter-amount-range-button"]');
const dollars = text => Number(text.replace(/[$,]/g, ''));

When(/^Ted opens the "([^"]+)" filter and sets the range to (\$[\d,]+) - (\$[\d,]+)$/, async function (initial, low, high) {
  await this.act(() => rangeChip(this.page).getByText(initial, { exact: true }).click());
  const slider = this.page.locator('[data-test="transaction-list-filter-amount-range-slider"]');
  await expect(slider).toBeVisible();
  // Reset the upper thumb to the minimum so the small range can be set
  // with a few key presses. Re-resolve the thumbs after each render.
  const thumbs = slider.getByRole('slider');
  await this.act(() => thumbs.last().press('Home'));
  for (let amount = 0; amount < dollars(high); amount += 10) {
    await this.act(() => thumbs.last().press('ArrowRight'));
  }
  for (let amount = 0; amount < dollars(low); amount += 10) {
    await this.act(() => thumbs.first().press('ArrowRight'));
  }
  const backdrop = this.page.locator('#amount-range-popover .MuiBackdrop-root');
  await this.act(() => backdrop.click({ position: { x: 10, y: 10 } }));
  await expect(slider).toBeHidden();
});

Then('the filter chip reads {string}', async function (text) {
  await expect(rangeChip(this.page)).toHaveText(text);
});

Then('at least one transaction is listed', async function () {
  await expect(this.locator('transactionRows').first()).toBeVisible();
});

Then(/^every listed transaction shows an amount between (\$[\d,.]+) and (\$[\d,.]+)$/, async function (low, high) {
  const grid = this.page.locator('[data-test="transaction-list"] .ReactVirtualized__Grid');
  const rows = this.locator('transactionRows', grid);
  const minimum = dollars(low);
  const maximum = dollars(high);
  const inRange = text => typeof text === 'string' && /^[+-]\$[\d,]+\.\d{2}$/.test(text) &&
    Math.abs(dollars(text)) >= minimum && Math.abs(dollars(text)) <= maximum;
  const displayedAmounts = () => rows.evaluateAll(elements => elements.map(element =>
    element.querySelector('[data-test^="transaction-amount-"]')?.textContent ?? null));

  // The previous feed can remain mounted while the amount filter loads.
  await expect.poll(async () => {
    const amounts = await displayedAmounts();
    return amounts.length > 0 && amounts.every(inRange);
  }).toBe(true);

  const inner = grid.locator('.ReactVirtualized__Grid__innerScrollContainer');
  for (let window = 0; window < 50; window++) {
    // The last slot is empty while the infinite list fetches another page.
    // Wait until actual rows cover this whole viewport before checking its amounts.
    await expect.poll(() => inner.evaluate(element => {
      const { scrollTop, clientHeight } = element.parentElement;
      const first = element.firstElementChild;
      const last = element.lastElementChild;
      return first && last && first.offsetTop <= scrollTop &&
        last.offsetTop + last.offsetHeight >= Math.min(scrollTop + clientHeight, element.clientHeight) - 1;
    })).toBe(true);

    const amounts = await displayedAmounts();
    assert(amounts.length > 0 && amounts.every(inRange), `Unexpected displayed amounts: ${JSON.stringify(amounts)}`);
    const viewport = await grid.evaluate(element => ({
      top: element.scrollTop, height: element.clientHeight, total: element.scrollHeight,
    }));
    if (viewport.top + viewport.height >= viewport.total - 1) return;
    await this.act(() => grid.evaluate(element => element.scrollBy(0, element.clientHeight * 0.75)));
    await expect.poll(() => grid.evaluate(element => element.scrollTop)).toBeGreaterThan(viewport.top);
  }
  assert.fail('The filtered transaction list did not end within 50 scroll windows');
});
