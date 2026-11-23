import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { runBaseline, defaultActions } from './baseline.mjs';
import { locators, validateLocators } from '../study/locators.mjs';
import { validateActions } from './repair-policy.mjs';
import { reset, clearBrowser } from './fixture.mjs';
import { manifest } from '../study/manifest.mjs';
import { InfrastructureError } from './infrastructure.mjs';
export const baselineTools = [
  { name: 'baseline_read', description: 'Read the retained action implementation, shared locators and immutable Cucumber assertions. Only actions and locator values can be repaired.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'baseline_repair', description: 'Replace retained UI action functions and/or locator values. Scenario and assertion code are immutable. Each click, fill, press or goto must be returned by its own awaited World.act inline callback, as in the supplied actions. No imports, app internals, direct requests or code evaluation. At most two accepted edits.', inputSchema: { type: 'object', properties: { actions: { type: 'string' }, locators: { type: 'object', additionalProperties: { type: 'string' } } }, additionalProperties: false } },
  { name: 'baseline_run', description: 'Reset the fixture and browser, then rerun the same frozen Cucumber scenario with the current maintained implementation. At most two additional runs after the initial scripted run.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
];
const root = fileURLToPath(new URL('../', import.meta.url));
const digest = value => createHash('sha256').update(value).digest('hex');
export function createBaselineTools({ caseId, endpoint, audit = () => {}, initialActions = 0, requestHost }) {
  let selectors = { ...locators }, actions = defaultActions(), edits = 0, runs = 1, actionCount = initialActions;
  return async (name, args) => {
    if (name === 'baseline_read') return { actions, locators: selectors, immutableAssertions: readFileSync(`${root}study/steps.mjs`, 'utf8'), limits: { acceptedEditsRemaining: manifest.limits.repairEdits - edits, additionalRunsRemaining: manifest.limits.baselineRuns - runs, retainedBrowserActionsRemaining: manifest.limits.retainedBrowserActionsTotal - actionCount } };
    if (name === 'baseline_repair') {
      if (edits >= manifest.limits.repairEdits) throw new Error('Repair edit limit reached');
      if (!args || Object.keys(args).some(key => !['actions', 'locators'].includes(key)) || !Object.keys(args).length) throw new Error('Supply actions and/or complete locators');
      const nextActions = args.actions === undefined ? actions : validateActions(args.actions);
      const nextSelectors = args.locators === undefined ? selectors : validateLocators(args.locators);
      if (nextActions === actions && JSON.stringify(nextSelectors) === JSON.stringify(selectors)) return { changed: false, edits };
      const before = { actions: digest(actions), locators: digest(JSON.stringify(selectors)) };
      actions = nextActions; selectors = { ...nextSelectors }; edits++;
      audit({ type: 'baseline-edit', edits, before, after: { actions: digest(actions), locators: digest(JSON.stringify(selectors)) }, actions, locators: selectors });
      return { changed: true, edits };
    }
    if (name === 'baseline_run') {
      if (runs >= manifest.limits.baselineRuns) throw new Error('Baseline run limit reached');
      if (actionCount >= manifest.limits.retainedBrowserActionsTotal) throw new Error('Retained browser action limit reached');
      runs++;
      try {
      const browser = await chromium.connectOverCDP(endpoint);
      try { await clearBrowser(browser.contexts()[0]); await reset(); } finally { await browser.close(); }
      if (typeof requestHost !== 'function') throw new Error('Attempt-scoped observer channel is required for a retained rerun');
      await requestHost('begin-retained-attempt', { attempt: runs });
      const result = await runBaseline({ caseId, endpoint, selectors, actions, actionLimit: manifest.limits.retainedBrowserActionsTotal - actionCount });
      if (result.actions === null) throw new Error('Retained action count unavailable; stopping rather than silently resetting budget');
      actionCount += result.actions;
      const observation = await requestHost('observe-retained-attempt', { attempt: runs });
      // This observation belongs to the private audit only, never the tool
      // response seen by the testing agent.
      await requestHost('record-retained-result', { type: 'baseline-run', attempt: runs, ...result, oracle: observation });
      return result;
      } catch (error) { throw new InfrastructureError(`Retained rerun infrastructure failed: ${error.message}`, { cause: error }); }
    }
    throw new Error('Unknown baseline tool');
  };
}
