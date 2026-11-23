import test from 'node:test';
import assert from 'node:assert/strict';
import { cumulativeStages, cumulativeBudget } from '../study/cumulative-plan.mjs';
import { historicalDeadlines } from '../study/campaign-config.mjs';
const deadline = historicalDeadlines['campaigns-20261101'];
import { createTrialLedger, remainingBudget, validatePlan, verifyApproval, recordDigest, sha256 } from './campaign-guard.mjs';
test('all216IDs remain in terminal ledger after interruption, without replacement', () => {
  const stages = cumulativeStages(), all = validatePlan(stages), ledger = createTrialLedger(stages);
  const record = { trial: all[0], trialId: all[0].id, implementationSHA: 'frozen' }; record.recordSHA = recordDigest(record);
  ledger.start(all[0].id); ledger.emitted(record); ledger.record(all[0].id, record, 'frozen');
  assert.throws(() => ledger.start(all[0].id), /Duplicate/);
  ledger.start(all[1].id); ledger.stop('original deadline');
  const rows = ledger.snapshot(); assert.equal(rows.length, 216); assert.equal(rows[0].status, 'recorded'); assert.equal(rows[1].status, 'infrastructure-invalid'); assert.equal(rows.filter(r => r.status === 'not-run').length, 214);
  assert.throws(() => ledger.finish(), /incomplete/);
  const duplicate = structuredClone(stages); duplicate[0].trials[1].id = duplicate[0].trials[0].id; assert.throws(() => validatePlan(duplicate), /invalid/);
  assert.equal(remainingBudget(stages, 0), cumulativeBudget(Date.now(), deadline).totalMs);
});
test('completion reconciles every emitted digest and exact frozen revision artifact', () => {
  const stages = cumulativeStages(), ledger = createTrialLedger(stages), trials = validatePlan(stages);
  for (const trial of trials) {
    ledger.start(trial.id); const record = { trial, trialId: trial.id, implementationSHA: 'frozen-' + trial.revision }; record.recordSHA = recordDigest(record);
    assert.throws(() => ledger.record(trial.id, record, record.implementationSHA), /differs/);
    ledger.emitted({ type: 'trial-record', ...record });
    assert.throws(() => ledger.record(trial.id, record, 'wrong'), /differs/);
    ledger.record(trial.id, record, record.implementationSHA);
  }
  assert.equal(ledger.finish(revision => 'frozen-' + revision).length, 216);
  assert.throws(() => ledger.finish(() => 'wrong'), /unreconciled/);
});
test('approval binds exact feature/code/application/seed hashes and original deadline', () => {
  const source = { 'study/scenarios.feature': 'a', 'study/actions.mjs': 'b', 'study/cumulative-plan.mjs': 'enabled' }, app = { revision: '0729f68ac220f7cda4ad09c5693dba11d7c532c6', files: { seed: 'c' } }, environment = { actualInstalledContent: 'e' };
  const input = { originalDeadline: deadline, sourcePins: { ...source, 'study/cumulative-plan.mjs': 'disabled' }, enabledSourcePins: source, appPins: app, environment };
  const reviewedArtifactSHA = sha256(JSON.stringify(input)), gateRef = 'mipro27-bdd-agent-e2e/evidence-plan/4/99';
  const approval = { verificationMode: 'trusted-controller-live-MCP', gateRef, reviewedArtifactSHA, manifest: input, gateNode: { id: 'mipro27-bdd-agent-e2e/evidence-plan/4', state: 'done', verdict: { id: gateRef, verdict: 'pass' }, outputs: [{ sha256: reviewedArtifactSHA }] } };
  const actual = { source, disabledSource: input.sourcePins, app, environment, deadline };
  assert.equal(verifyApproval(approval, actual), approval);
  assert.throws(() => verifyApproval(approval, { ...actual, deadline: '2026-12-01T00:00:00Z' }), /deadline/);
  assert.throws(() => verifyApproval(approval, { ...actual, source: { ...source, 'study/scenarios.feature': 'changed' } }), /differs/);
  assert.throws(() => verifyApproval(approval, { ...actual, app: { ...app, files: { seed: 'changed' } } }), /differs/);
  assert.throws(() => verifyApproval({ ...approval, gateNode: { ...approval.gateNode, verdict: { id: gateRef, verdict: 'stop' } } }, actual), /pass/);
  assert.throws(() => verifyApproval({ ...approval, manifest: { ...input, environment: { actualInstalledContent: 'tampered' } } }, actual), /hash/);
  assert.throws(() => verifyApproval(approval, { ...actual, disabledSource: { ...input.sourcePins, 'study/cumulative-plan.mjs': 'runtime limit also changed' } }), /normalized/);
});
