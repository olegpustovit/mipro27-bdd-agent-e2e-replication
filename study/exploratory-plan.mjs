// Owner-directed, non-approved study allocation.  This deliberately lives beside
// (rather than enabling) the approved 216-cell candidate.
import { cases } from './manifest.mjs';
import { cumulativeStages } from './cumulative-plan.mjs';

export const exploratoryConfig = Object.freeze({
  schema: 1,
  mode: 'exploratory-owner-directed',
  gatePassExists: false,
  executions: 216,
  runtimeWallMs: 240000,
  retainedWallMs: 60000,
  fixtureEnvelopeMs: 70000,
  maintenanceWallMs: 45 * 60000,
  maintenanceCleanupMs: 60000,
  maintenanceToolCalls: 240,
  maintenanceEdits: 10,
  maintenanceSuites: 12,
});

export function exploratoryStages() {
  // One Luna run took about 13 s in the excluded check, so the full 216-execution trajectory fits; replaces the earlier 120 cut before any measured trial.
  return cumulativeStages();
}
function reducedStagesUnused() {
  const stages = [];
  const probes = (kind, revision) => {
    const id = `${kind}-${revision}`;
    const index = stages.length;
    const trials = cases.flatMap((item, caseIndex) => ((index + caseIndex) % 2 ? ['maintained', 'runtime'] : ['runtime', 'maintained'])
      .map(arm => ({ id: `${id}/${item.id}/${arm}`, stage: id, kind, revision, repetition: 1,
        caseId: item.id, family: item.family, arm, fault: kind === 'fault', repairAllowed: false })));
    stages.push({ id, kind, revision, repetition: 1, trials });
  };
  probes('healthy', 'v0');
  probes('fault', 'v0');
  stages.push({ id: 'maintenance-v1', kind: 'maintenance', revision: 'v1', from: 'v0', trials: [] });
  probes('healthy', 'v1');
  stages.push({ id: 'maintenance-v2', kind: 'maintenance', revision: 'v2', from: 'v1', trials: [] });
  probes('healthy', 'v2');
  probes('fault', 'v2');
  return stages;
}

export function exploratoryTrials() { return exploratoryStages().flatMap(stage => stage.trials); }
