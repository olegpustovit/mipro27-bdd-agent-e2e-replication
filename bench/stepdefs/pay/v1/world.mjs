import { Before, After, setDefaultTimeout, setWorldConstructor } from '@cucumber/cucumber';
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { locators, validateLocators } from './locators.mjs';
setDefaultTimeout(10000);
class World {
  constructor() { this.selectors = process.env.STUDY_LOCATORS ? validateLocators(JSON.parse(readFileSync(process.env.STUDY_LOCATORS, 'utf8'))) : locators; this.actions = 0; }
  locator(key, scope = this.page) {
    const selector = this.selectors[key];
    if (selector.startsWith('label=')) return scope.getByLabel(selector.slice(6), { exact: true });
    if (selector.startsWith('placeholder=')) return scope.getByPlaceholder(selector.slice(12), { exact: true });
    const role = selector.match(/^role=(\w+)\[name=(.+)\]$/);
    if (role) {
      const regex = role[2].match(/^\/(.*)\/([a-z]*)$/);
      const name = regex ? new RegExp(regex[1], regex[2]) : JSON.parse(role[2]);
      return scope.getByRole(role[1], { name, exact: !regex });
    }
    return scope.locator(selector);
  }
  async act(fn) {
    if (++this.actions > Number(process.env.STUDY_ACTION_LIMIT || 80)) throw new Error('Browser action cap reached');
    // Generic private observation boundary, with no scenario expectations or
    // result feedback. The runtime proxy uses the same boundary before actions.
    try { if (this.page.url().startsWith('http://localhost:3000/')) await this.page.evaluate(async () => {
      if (typeof window.__studyCaptureUI !== 'function') throw new Error('Private observer unavailable');
      const result = await window.__studyCaptureUI({ markBarrier: true });
      if (result.metrics.failure || result.metrics.failedEmits) throw new Error('Private observer delivery failed: ' + (result.metrics.failure || 'failedEmits=' + result.metrics.failedEmits));
    }); } catch (error) {
      // Transport a stable fatal tag through Cucumber JSON. The host removes
      // this entire result from repair feedback and retains diagnostics privately.
      throw new Error('STUDY_PRIVATE_CAPTURE: ' + error.message);
    }
    return fn();
  }
}
setWorldConstructor(World);
Before(async function () {
  if (!process.env.STUDY_CDP_ENDPOINT) throw new Error('Use the study harness; an isolated browser endpoint is required');
  this.browser = await chromium.connectOverCDP(process.env.STUDY_CDP_ENDPOINT);
  this.context = this.browser.contexts()[0];
  this.page = await this.context.newPage();
  await this.page.setViewportSize({ width: 1280, height: 720 });
  this.page.setDefaultTimeout(5000);
  this.page.setDefaultNavigationTimeout(15000);
});
After(async function () {
  // The independent harness inspects this same page before closing the browser.
  console.log(JSON.stringify({ type: 'baseline-actions', count: this.actions }));
  await this.browser?.close(); // disconnect CDP; the harness owns the Chromium process
});
