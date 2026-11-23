import { cases, manifest } from '../study/manifest.mjs';
import { reset, freshBrowser, acquireLock } from './fixture.mjs';
import { applyVariant } from './mutations.mjs';
import { runBaseline } from './baseline.mjs';
import { oracle } from './oracle.mjs';
const all = process.argv.includes('--all');
const selectedCase = process.argv.includes('--case') ? process.argv[process.argv.indexOf('--case') + 1] : null;
if (selectedCase && !cases.some(c => c.id === selectedCase)) throw new Error('Unknown technical calibration case');
const selected = selectedCase ? cases.filter(c => c.id === selectedCase) : all ? cases : cases.filter(c => manifest.technicalCases.includes(c.id));
const conditions = process.argv.includes('--variants') ? manifest.conditions : ['reference'];
const unlock = acquireLock();
let failures = 0;
try {
  for (const item of selected) for (const condition of conditions) {
    const restore = applyVariant(item.id, condition);
    let browser;
    try {
      await restore.ready(); await reset(); browser = await freshBrowser();
      const result = await runBaseline({ caseId: item.id, endpoint: browser.endpoint });
      const observed = await oracle(item.id, browser.context, browser.witness);
      const expectedValid = !condition.includes('fault');
      const ok = observed.triggerWitnessed && (expectedValid ? observed.valid && result.code === 0 : observed.defectObserved && result.code !== 0);
      if (!ok) failures++;
      console.log(JSON.stringify({ type: 'technical-check', excludedFromStudy: true, caseId: item.id, condition, baselineExit: result.code, expectedValid, oracle: observed, ok, ...(!ok ? { stdout: result.stdout, stderr: result.stderr } : {}) }));
    } catch (error) { failures++; console.log(JSON.stringify({ type: 'technical-check-error', excludedFromStudy: true, caseId: item.id, condition, error: error.stack })); }
    finally { await browser?.close(); restore(); }
  }
} finally { try { await reset(); } finally { unlock(); } }
process.exitCode = failures ? 1 : 0;
