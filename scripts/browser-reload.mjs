import { chromium } from 'playwright';
import { InfrastructureError } from './infrastructure.mjs';
import { validateCall as defaultValidateCall } from './browser-policy.mjs';

export const reloadTool = {
  name: 'browser_reload', description: 'Reload the currently open application page, then return its browser snapshot. This is a generic UI navigation action; it does not execute a scenario or check expected application behavior.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
};
export async function reloadApplicationPage(endpoint) {
  const appOrigin = process.env.STUDY_APP_ORIGIN || 'http://localhost:3000';
  const validateCall = process.env.STUDY_POLICY_MODULE ? (await import(process.env.STUDY_POLICY_MODULE)).validateCall : defaultValidateCall;
  if (!endpoint) throw new Error('The study browser connection is unavailable');
  let browser;
  try { browser = await chromium.connectOverCDP(endpoint); }
  catch (error) { throw new InfrastructureError(`Cannot connect to study browser: ${error.message}`, { cause: error }); }
  try {
    const pages = browser.contexts().flatMap(context => context.pages()).filter(page => new URL(page.url()).origin === appOrigin);
    if (pages.length !== 1) throw new Error('Reload requires exactly one open application page');
    const denied = validateCall('browser_navigate', { url: pages[0].url() });
    if (denied) throw new Error(denied);
    await pages[0].reload({ waitUntil: 'load', timeout: 15000 });
    // Campaign A returned its snapshot at `load`, before the page's data requests finished, so a page could look empty when it was not.
    await pages[0].waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  } finally { await browser.close(); }
}
