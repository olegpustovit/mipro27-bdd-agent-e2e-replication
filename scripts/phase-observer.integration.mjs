// Model-free private-instrumentation calibration, not a measured study trial.
import assert from 'node:assert/strict';
import { acquireLock, reset, freshBrowser, flushUIObservation } from './fixture.mjs';
import { applyVariant } from './mutations.mjs';
import { runBaseline } from './baseline.mjs';
import { snapshotWitness } from './witness.mjs';

const unlock = acquireLock();
let failures = 0;
try {
  for (const condition of ['reference', 'fault']) {
    const restore = applyVariant('profile-name', condition);
    let browser, evidence;
    try {
      await restore.ready(); await reset(); browser = await freshBrowser();
      const baseline = await runBaseline({ caseId: 'profile-name', endpoint: browser.endpoint });
      const final = await flushUIObservation(browser.context, browser.witness);
      const witness = snapshotWitness(browser.witness);
      const submit = witness.events.find(e => e.kind === 'submit' && e.fields?.some(f => f.name === 'firstName' && f.value === 'Study'));
      const states = witness.events.filter(e => e.kind === 'ui-state');
      const beforeReload = submit ? states.filter(e => e.documentId === submit.documentId && e.browserSequence > submit.browserSequence) : [];
      evidence = { condition, baselineExit: baseline.code, observerMetrics: final.metrics, witnessTruncated: witness.truncated,
        acknowledgedDocuments: [...new Set(witness.events.map(e => e.documentId).filter(Boolean))],
        closedDocumentMetrics: witness.events.filter(e => e.kind === 'document-barrier'),
        submit: submit && { documentId: submit.documentId, sequence: submit.browserSequence, fields: submit.fields },
        navigation: witness.events.filter(e => e.kind === 'navigation'),
        states: states.map(e => ({ documentId: e.documentId, sequence: e.browserSequence, at: e.browserTime,
          identity: e.state.identity, firstName: e.state.firstName, fullName: e.state.fullName, path: e.state.path })),
      };
      assert(submit, 'qualified profile submit must be visible to independent instrumentation');
      assert.equal(witness.truncated, false);
      assert.equal(final.metrics.failedEmits, 0); assert.equal(final.metrics.failure, null);
      assert.equal(baseline.code, condition === 'reference' ? 0 : 1);
      assert(beforeReload.some(e => e.state.firstName.value === 'Study' && e.state.firstName.visible));
      if (condition === 'reference') {
        assert(beforeReload.some(e => e.state.fullName.visible && e.state.fullName.text.includes('Study')));
        assert(states.some(e => e.documentId !== submit.documentId && e.state.firstName.value === 'Study' && e.state.firstName.visible));
      } else {
        assert(beforeReload.some(e => e.state.firstName.value === 'Study' && e.state.fullName.visible && !e.state.fullName.text.includes('Study') && e.browserTime - submit.browserTime >= 5000), 'old displayed name must be distinguished from optimistic field value after the comparison timeout');
      }
      console.log(JSON.stringify({ type: 'phase-observer-calibration', excludedFromStudy: true, languageModelUsed: false, ok: true, ...evidence }));
    } catch (error) {
      failures++;
      console.log(JSON.stringify({ type: 'phase-observer-calibration', excludedFromStudy: true, languageModelUsed: false, ok: false, condition, error: error.stack, evidence,
        witness: browser ? snapshotWitness(browser.witness) : null }));
    } finally { await browser?.close(); restore(); }
  }
} finally { try { await reset(); } finally { unlock(); } }
process.exitCode = failures ? 1 : 0;
