// Stream E-pay follow-up plan (2026-11-27): the payment-app cells of the single set (e-single-set/plan.md).
// Stages are taken unchanged from harness/study/cumulative-plan.mjs `cumulativeStages()` (same ids, trial objects,
// repairAllowed false), with the maintenance stages skipped (no step-definition update session is run) and the v1
// stages left out (healthy-v1-1, fault-v1-1, fault-v1-2 were run by stream B). Remaining: healthy-v0-1, fault-v0-1,
// fault-v0-2, healthy-v2-1, healthy-v2-2, healthy-v2-3, fault-v2-1, fault-v2-2 (12 trials per arm each, 96 per arm).
// followupArms() is stream B's arm selection (b-change1-faults/scripts/v1-fault-plan.mjs), unchanged.
import { cumulativeStages } from '../harness/study/cumulative-plan.mjs';

export const singlePayStageIds = ['healthy-v0-1', 'fault-v0-1', 'fault-v0-2', 'healthy-v2-1', 'healthy-v2-2', 'healthy-v2-3', 'fault-v2-1', 'fault-v2-2'];

export function singlePayStages() {
  const stages = cumulativeStages().filter(stage => stage.kind !== 'maintenance' && stage.revision !== 'v1');
  if (stages.map(stage => stage.id).join(',') !== singlePayStageIds.join(',')) throw new Error('Unexpected cumulative stage list');
  return stages;
}

export function followupArms() {
  const arms = (process.env.STUDY_ARMS || 'runtime').split(',');
  if (!arms.length || arms.some(arm => !['maintained', 'runtime'].includes(arm)) || new Set(arms).size !== arms.length) {
    throw new Error('STUDY_ARMS must be maintained, runtime or both');
  }
  return arms;
}
