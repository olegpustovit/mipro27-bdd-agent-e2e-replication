// Excluded model-free calibration; evidence is streamed to process memory/MCP,
// never written to a local research data file.
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { cases, manifest } from '../study/manifest.mjs';
import { acquireLock, reset, freshBrowser, flushUIObservation } from './fixture.mjs';
import { applyVariant } from './mutations.mjs';
import { runBaseline } from './baseline.mjs';
import { snapshotWitness, acknowledgedEvents } from './witness.mjs';
import { applyUIRevision, revisions } from './ui-revisions.mjs';
import { revisionCalibrationBindings } from './revision-calibration.mjs';

const selected = process.argv.includes('--case') ? process.argv[process.argv.indexOf('--case') + 1] : null;
const revision = process.argv.includes('--revision') ? process.argv[process.argv.indexOf('--revision') + 1] : null;
if (revision && !revisions.includes(revision)) throw new Error('Unknown calibration UI revision');
if (selected && !cases.some(c => c.id === selected)) throw new Error('Unknown calibration case');
const requestedCondition = process.argv.includes('--condition') ? process.argv[process.argv.indexOf('--condition') + 1] : null;
if (requestedCondition && (!manifest.conditions.includes(requestedCondition) || process.argv.includes('--variants'))) throw new Error('Choose one declared condition or --variants');
const requestedConditions = process.argv.includes('--conditions') ? process.argv[process.argv.indexOf('--conditions') + 1]?.split(',') : null;
if (requestedConditions && (requestedCondition || process.argv.includes('--variants') || !requestedConditions.length || new Set(requestedConditions).size !== requestedConditions.length || requestedConditions.some(c => !manifest.conditions.includes(c)))) throw new Error('Choose a unique declared condition list without other condition flags');
const conditions = requestedConditions || (requestedCondition ? [requestedCondition] : process.argv.includes('--variants') ? manifest.conditions : ['reference']);
if (revision && conditions.some(c => !['reference', 'fault'].includes(c))) throw new Error('Revision capture accepts reference/fault only');
const unlock = acquireLock();
const sourcePaths = ['study/scenarios.feature', 'study/steps.mjs', 'study/world.mjs', 'study/locators.mjs', 'study/actions.mjs',
  'scripts/fixture.mjs', 'scripts/witness.mjs', 'scripts/ui-observer.mjs', 'scripts/mutations.mjs', 'scripts/scenario-evaluation.mjs',
  'scripts/calibration-capture.mjs', 'scripts/repair-policy.mjs', 'scripts/mcp-browser.mjs', 'scripts/browser-inspect.mjs',
  'scripts/ui-revisions.mjs', 'scripts/revision-calibration.mjs', 'study/ui-contract.mjs'];
sourcePaths.push('scripts/baseline.mjs', 'scripts/verdict.mjs', 'study/manifest.mjs', 'package-lock.json');
const sourcePins = Object.fromEntries(sourcePaths.map(path => [path, createHash('sha256').update(readFileSync(new URL('../' + path, import.meta.url))).digest('hex')]));
let failed = false;
try {
  for (const item of cases.filter(c => !selected || c.id === selected)) for (const condition of conditions) {
    let browser, restore, baseline;
    try {
      restore = revision ? applyUIRevision(item.id, revision, { fault: condition === 'fault' }) : applyVariant(item.id, condition);
      await restore.ready(); await reset(); browser = await freshBrowser({ observerVersion: revision || 'v0' });
      baseline = await runBaseline({ caseId: item.id, endpoint: browser.endpoint, ...(revision ? revisionCalibrationBindings(revision) : {}) });
      await flushUIObservation(browser.context, browser.witness);
      const witness = snapshotWitness(browser.witness);
      acknowledgedEvents(witness);
      const stateIds = new Map(), states = [];
      const events = witness.events.map(event => {
        if (!event.state) return event;
        const key = JSON.stringify(event.state);
        if (!stateIds.has(key)) { stateIds.set(key, states.length); states.push(event.state); }
        const { state, ...metadata } = event;
        return { ...metadata, stateRef: stateIds.get(key) };
      });
      const expectedExit = condition.includes('fault') ? 1 : 0;
      const ok = baseline.code === expectedExit;
      failed ||= !ok;
      const record = { type: 'full-ui-calibration', excludedFromStudy: true, languageModelUsed: false,
        sourcePins,
        caseId: item.id, condition, ...(revision ? { revision, privateCalibrationBindings: true } : {}), ok, baseline: { code: baseline.code, scenarioCount: baseline.scenarioCount,
          assertionFailures: baseline.assertionFailures, elapsedMs: baseline.elapsedMs, timedOut: baseline.timedOut,
          ...(!ok ? { stdout: baseline.stdout, stderr: baseline.stderr } : {}) },
        witness: { ...witness, encoding: 'state-dictionary-v1', states, events } };
      if (!process.stdout.write(JSON.stringify(record) + '\n')) await once(process.stdout, 'drain');
    } catch (error) {
      failed = true;
      if (!process.stdout.write(JSON.stringify({ type: 'full-ui-calibration-error', excludedFromStudy: true,
        sourcePins, caseId: item.id, condition, ...(revision ? { revision } : {}), error: error.stack, baseline,
        witness: browser ? snapshotWitness(browser.witness) : null }) + '\n')) await once(process.stdout, 'drain');
    } finally { await browser?.close(); restore?.(); }
  }
} finally { try { await reset(); } finally { unlock(); } }
process.exitCode = failed ? 1 : 0;
