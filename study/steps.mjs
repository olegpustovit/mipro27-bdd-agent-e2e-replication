import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { expect } from 'playwright/test';
import * as actions from './actions.mjs';

async function home(w, username) {
  await expect(w.locator('signedIn')).toBeVisible();
  await expect(w.locator('signedIn')).toHaveText('@' + username);
}
const profileKey = label => ({ 'First Name': 'firstName', Email: 'email' })[label];

Given('I open the sign-in page', async function () { await this.act(() => this.page.goto('http://localhost:3000/signin')); });
Then('the sign-in heading is visible', async function () { await expect(this.locator('signInHeading')).toBeVisible(); });
When('I sign in as {string} with password {string}', async function (user, password) { await actions.signIn(this, user, password); });
Then('the authenticated home identifies {string}', async function (user) { await home(this, user); });
Then('the authenticated home route is {string} or {string}', async function (first, second) { await expect(this.page).toHaveURL(url => url.origin === 'http://localhost:3000' && [first, second].includes(url.pathname)); });
Given('I am signed in as {string} with password {string}', async function (user, password) {
  await this.act(() => this.page.goto('http://localhost:3000/signin'));
  await actions.signIn(this, user, password);
});
When('I sign out', async function () { await actions.signOut(this); });
Then('the sign-in page and URL are visible', async function () {
  await expect(this.page).toHaveURL(/\/signin$/); await expect(this.locator('signInHeading')).toBeVisible();
});
When('I reload the current page', async function () { await this.act(() => this.page.reload()); });

When('I change my {string} to {string}', async function (field, value) { assert(profileKey(field)); await actions.updateProfile(this, profileKey(field), value); });
Then('my {string} field is {string}', async function (field, value) { assert(profileKey(field)); await expect(this.locator(profileKey(field))).toBeVisible(); await expect(this.locator(profileKey(field))).toHaveValue(value); });
Then('the name shown in the side menu contains {string}', async function (value) { await expect(this.locator('displayedName')).toBeVisible(); await expect(this.locator('displayedName')).toContainText(value); });
When('I enter {string} in the Email field and leave the field', async function (value) { await actions.invalidEmail(this, value); });
Then('the profile form displays email error {string}', async function (message) { await expect(this.locator('profileForm').getByText(message, { exact: true })).toBeVisible(); });
Then('the profile Save control is visible and disabled', async function () {
  const save = this.locator('save', this.locator('profileForm'));
  await expect(save).toBeVisible(); await expect(save).toBeDisabled();
});

When('I add bank {string} with routing {string} and account {string}', async function (bank, routing, account) { await actions.addBank(this, bank, routing, account); });
Then('bank {string} is visible exactly once', async function (bank) { const row = this.locator('bankRows').filter({ hasText: bank, visible: true }); await expect(row).toHaveCount(1); await expect(row).toBeVisible(); });
When('I delete bank {string}', async function (bank) { await actions.deleteBank(this, bank); });
Then('bank {string} is visibly marked deleted', async function (bank) { const row = this.locator('bankRows').filter({ hasText: bank, visible: true }); await expect(row).toBeVisible(); await expect(row).toContainText('(Deleted)'); });

When('I {string} {string} dollars to {string} with note {string}', async function (type, amount, recipient, note) { assert(['Pay', 'Request'].includes(type)); await actions.transfer(this, type, amount, recipient, note); });
When(/^I request \$(\d+(?:\.\d{2})?) from "([^"]+)" with note "([^"]+)"$/, async function (amount, recipient, note) { await actions.transfer(this, 'Request', amount, recipient, note); });
Then('a confirmation heading shows {string}', async function (note) { await expect(this.page.getByRole('heading', { name: new RegExp(note) })).toBeVisible(); });
When('I open my personal feed', async function () { await actions.openPersonalFeed(this); });
Then(/^my personal feed contains one visible "([^"]+)" transaction reading "([^"]+)" for (\$[\d,.]+)$/, async function (note, description, amount) {
  const row = this.locator('transactionRows').filter({ hasText: note, visible: true });
  await expect(row).toHaveCount(1); await expect(row).toBeVisible();
  await expect(row).toContainText(amount); await expect(row.getByText(description, { exact: true })).toBeVisible();
});

When('I open transaction {string}', async function (id) { assert(/^[A-Za-z0-9_-]+$/.test(id)); await this.act(() => this.page.goto('http://localhost:3000/transaction/' + id)); });
Then('the transaction detail heading is visible', async function () { await expect(this.page.getByRole('heading', { name: 'Transaction Detail' })).toBeVisible(); });
Then('the displayed like count is a number', async function () { await expect(this.locator('likeCount')).toBeVisible(); await expect(this.locator('likeCount')).toHaveText(/^\s*\d+\s*$/); });
When('I record the displayed like count', async function () { this.likesBefore = Number((await this.locator('likeCount').textContent()).trim()); });
When('I like the transaction', async function () { await actions.like(this); });
Then('the displayed like count is one greater and Like is disabled', async function () {
  await expect(this.locator('likeCount')).toBeVisible();
  await expect(this.locator('likeCount')).toHaveText(new RegExp('^\\s*' + (this.likesBefore + 1) + '\\s*$'));
  await expect(this.locator('like')).toBeVisible(); await expect(this.locator('like')).toBeDisabled();
});
When('I add comment {string}', async function (text) { await actions.comment(this, text); });
Then('comment {string} is visible in the transaction\'s comments', async function (text) { await expect(this.locator('comments').getByText(text, { exact: true })).toBeVisible(); });
Then('comment {string} is visible exactly once in the transaction\'s comments', async function (text) { const comment = this.locator('comments').getByText(text, { exact: true }).filter({ visible: true }); await expect(comment).toHaveCount(1); await expect(comment).toBeVisible(); });

When('I select the {string} feed using its visible control', async function (feed) { assert(['Mine', 'Friends'].includes(feed)); await actions.selectFeed(this, feed); });
Then('the {string} feed at {string} contains transactions', async function (header, path) {
  await expect(this.page).toHaveURL('http://localhost:3000' + path);
  await expect(this.locator('feedHeading').filter({ hasText: new RegExp('^' + header + '$') })).toBeVisible();
  await expect(this.locator('transactionRows').filter({ visible: true }).first()).toBeVisible();
});
