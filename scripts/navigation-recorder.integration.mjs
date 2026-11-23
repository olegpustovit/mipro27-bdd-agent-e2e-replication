// Model-free recorder controls; no measured trial and no application source edits.
import assert from 'node:assert/strict';
import { acquireLock, reset, freshBrowser, flushUIObservation } from './fixture.mjs';
const unlock = acquireLock(); let browser;
try {
  await reset(); browser = await freshBrowser();
  const page = await browser.context.newPage(); await page.goto('http://localhost:3000/signin');
  await page.evaluate(() => {
    const control = document.createElement('div'); control.id = 'unmapped-control'; control.textContent = 'Continue recorder probe';
    control.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;background:white;padding:10px';
    control.onclick = () => { control.textContent = 'Probe outcome'; };
    document.body.appendChild(control);
  });
  await page.locator('#unmapped-control').click();
  await flushUIObservation(browser.context, browser.witness);
  const click = browser.witness.events.findLast(e => e.kind === 'click');
  assert(click?.isTrusted); assert.equal(click.tag, 'DIV'); assert.equal(click.testId, '');
  await page.evaluate(() => { history.pushState({}, '', '/user/settings'); history.replaceState({}, '', '/bankaccounts'); history.back(); });
  await page.waitForURL('http://localhost:3000/signin');
  await flushUIObservation(browser.context, browser.witness);
  const navigation = browser.witness.events.filter(e => e.kind === 'ui-navigation');
  assert.deepEqual(navigation.map(e => e.navigationType), ['push', 'replace', 'traverse']);
  assert(navigation.every(e => e.sameDocument));
  assert.deepEqual(navigation.map(e => [e.fromPath, e.toPath]), [['/signin', '/user/settings'], ['/user/settings', '/bankaccounts'], ['/bankaccounts', '/signin']]);
  console.log(JSON.stringify({ type: 'navigation-and-unmapped-click-calibration', excludedFromStudy: true, languageModelUsed: false, ok: true,
    unmappedClick: { documentId: click.documentId, sequence: click.browserSequence, isTrusted: click.isTrusted, tag: click.tag, testId: click.testId }, navigation,
    limits: ['Recorder-specific browser controls, not experimental outcomes.', 'Read-only Navigation API observation; no history monkey-patching.'] }));
} finally { await browser?.close(); try { await reset(); } finally { unlock(); } }
