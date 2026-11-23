import test from 'node:test';
import assert from 'node:assert/strict';
import { cumulativeStages, cumulativeTrials, cumulativeBudget, cumulativeConfig } from '../study/cumulative-plan.mjs';
import { historicalDeadlines, requireDeadline } from '../study/campaign-config.mjs';
const deadline = historicalDeadlines['campaigns-20261101'];

test('full cumulative plan retains12cases/6families and216trials with frozen probes and no per-cell repairs', () => {
  const stages = cumulativeStages(), trials = cumulativeTrials();
  assert.equal(trials.length, 216); assert.equal(new Set(trials.map(t => t.id)).size, 216);
  assert.equal(new Set(trials.map(t => t.caseId)).size, 12); assert.equal(new Set(trials.map(t => t.family)).size, 6);
  assert.equal(trials.filter(t => t.kind === 'healthy').length, 120); assert.equal(trials.filter(t => t.kind === 'fault').length, 96);
  for (const arm of ['maintained', 'runtime']) assert.equal(trials.filter(t => t.arm === arm).length, 108);
  assert(trials.every(t => t.repairAllowed === false));
  assert.equal(stages.filter(s => s.kind === 'maintenance').length, 2);
  for (const version of ['v1', 'v2']) {
    const maintenance = stages.findIndex(s => s.kind === 'maintenance' && s.revision === version);
    assert(stages.findIndex(s => s.trials.some(t => t.revision === version)) > maintenance);
  }
  assert(trials.filter(t => t.fault).every(t => ['v0', 'v2'].includes(t.revision)));
  assert.equal(cumulativeConfig.campaignEnabled, false);
});

test('budget preserves the absolute deadline and refuses a nominally late start', () => {
  const now = Date.parse('2026-11-01T00:00:00Z'), budget = cumulativeBudget(now, deadline);
  assert.equal(budget.originalDeadline, '2026-11-01T21:55:00Z');
  assert(budget.feasibleUnderEnvelopes);
  assert.equal(cumulativeBudget(Date.parse(budget.latestStart) + 1, deadline).feasibleUnderEnvelopes, false);
  assert.equal(cumulativeBudget(now + 1000, deadline).totalMs, budget.totalMs);
  assert.throws(() => cumulativeBudget(NaN, deadline));
  assert.throws(() => cumulativeBudget(now), /deadline is required/);
  assert.throws(() => requireDeadline('tomorrow'), /Invalid/);
  assert.equal(cumulativeConfig.originalDeadline, undefined);
});
