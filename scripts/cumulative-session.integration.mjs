// Excluded real CLI/tool transport check, never part of the measured campaign.
import assert from 'node:assert/strict';
import { acquireLock, reset } from './fixture.mjs';
import { createMaintenanceState } from './maintenance.mjs';
import { runTrial, runMaintenance } from './cumulative-runner.mjs';
const unlock = acquireLock(); let quiescent = true;
const emit = event => process.stdout.write(JSON.stringify({ ...event, excludedFromStudy: true }) + '\n');
try {
  const state = createMaintenanceState({ emit });
  const runtime = await runTrial({ trial: { id: 'technical-session/auth-login/runtime', kind: 'healthy', revision: 'v0', caseId: 'auth-login', arm: 'runtime', fault: false, repairAllowed: false }, state, emit });
  quiescent = runtime.quiescent;
  assert(!runtime.error, runtime.error); assert.equal(runtime.agent.modelVerified, true); assert.equal(runtime.agent.privateAuditComplete, true);
  emit({ type: 'real-runtime-session-check', ok: true, reportedStatus: runtime.reportedStatus, observedStatus: runtime.observation?.healthyCompletion });
  const phase = await runMaintenance({ revision: 'v1', from: 'v0', state, emit, wallMs: 5 * 60000 });
  quiescent = phase.quiescent;
  assert(!phase.error, phase.error); assert.equal(phase.agent?.modelVerified, true);
  emit({ type: 'real-maintenance-session-check', ok: true, edits: phase.frozen.edits, validations: phase.frozen.validations, budgetExpired: phase.budgetExpired, scope: 'Excluded transport/freeze check; success does not require a complete agent repair.' });
} finally {
  if (quiescent) try { await reset(); } finally { unlock(); }
  else emit({ type: 'fixture-lock-retained', reason: 'unsettled work' });
}
