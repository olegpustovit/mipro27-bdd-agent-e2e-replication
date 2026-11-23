// Candidate executable plan. The driver must still enforce a fresh Evidence
// approval, immutable code/config pins and the campaign's absolute deadline
// (campaign configuration: see study/campaign-config.mjs; the 2026-11-01 value is kept there as provenance).
import { cases } from './manifest.mjs';
import { requireDeadline } from './campaign-config.mjs';

export const cumulativeConfig = Object.freeze({
  schema: 2,
  campaignEnabled: false,
  runtimeWallMs: 240000,
  retainedWallMs: 60000,
  // These envelopes must be enforced by the driver before they can establish
  // feasibility; they are not observed costs or a deadline extension.
  fixtureEnvelopeMs: 70000,
  fixtureSetupMs: 45000,
  maintenanceWallMs: 45 * 60000,
  maintenanceCleanupMs: 60000,
  maintenanceToolCalls: 240,
  maintenanceEdits: 3,
  maintenanceSuites: 4,
  maintenanceTransitions: 2,
  finalizationReserveMs: 15 * 60000,
});

export function cumulativeStages() {
  const stages = [];
  const trialStage = (kind, revision, repetition) => {
    const id = `${kind}-${revision}-${repetition}`, stageIndex = stages.length;
    const trials = cases.flatMap((item, index) => {
      const arms = (stageIndex + index + repetition) % 2 ? ['maintained', 'runtime'] : ['runtime', 'maintained'];
      return arms.map(arm => ({ id: `${id}/${item.id}/${arm}`, stage: id, kind, revision, repetition,
        caseId: item.id, family: item.family, arm, fault: kind === 'fault', repairAllowed: false }));
    });
    stages.push({ id, kind, revision, repetition, trials });
  };
  trialStage('healthy', 'v0', 1);
  trialStage('fault', 'v0', 1); trialStage('fault', 'v0', 2);
  stages.push({ id: 'maintenance-v1', kind: 'maintenance', revision: 'v1', from: 'v0', trials: [] });
  trialStage('healthy', 'v1', 1);
  stages.push({ id: 'maintenance-v2', kind: 'maintenance', revision: 'v2', from: 'v1', trials: [] });
  trialStage('healthy', 'v2', 1); trialStage('healthy', 'v2', 2); trialStage('healthy', 'v2', 3);
  trialStage('fault', 'v2', 1); trialStage('fault', 'v2', 2);
  return stages;
}

export function cumulativeTrials() { return cumulativeStages().flatMap(stage => stage.trials); }

export function cumulativeBudget(now = Date.now(), originalDeadline) {
  if (!Number.isFinite(now)) throw new Error('A finite current timestamp is required');
  requireDeadline(originalDeadline);
  const trials = cumulativeTrials(), config = cumulativeConfig;
  const executionMs = trials.reduce((sum, trial) => sum + (trial.arm === 'runtime' ? config.runtimeWallMs : config.retainedWallMs), 0);
  const fixtureMs = trials.length * config.fixtureEnvelopeMs;
  const maintenanceMs = config.maintenanceTransitions * (config.maintenanceWallMs + config.maintenanceCleanupMs);
  const totalMs = executionMs + fixtureMs + maintenanceMs + config.finalizationReserveMs;
  const deadline = Date.parse(originalDeadline), latestStart = deadline - totalMs;
  return { originalDeadline, executionMs, fixtureMs, maintenanceMs,
    finalizationReserveMs: config.finalizationReserveMs, totalMs, latestStart: new Date(latestStart).toISOString(),
    remainingMs: deadline - now, feasibleUnderEnvelopes: now <= latestStart,
    limitation: 'Conditional bound: driver enforcement and all required setup/calibration/gates must be completed before launch; current time is never substituted for the original deadline.' };
}
