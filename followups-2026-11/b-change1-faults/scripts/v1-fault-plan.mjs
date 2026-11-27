// Stream B follow-up plan (2026-11-26): seeded faults on the change-1 (v1) interface.
// Same trial shape as harness/study/cumulative-plan.mjs `trialStage` (ids `<kind>-<revision>-<repetition>/<case>/<arm>`,
// repairAllowed false). The original design ran each fault stage twice (fault-v0-1/2, fault-v2-1/2), so v1 gets
// fault-v1-1 and fault-v1-2. healthy-v1-1 is a post-hoc environment check on this host and tool versions; it is
// reported separately and is not the pairing partner under the paper's rule (that stays the 2026-11-01 healthy-v1-1 run).
import { cases } from '../harness/study/manifest.mjs';

export function v1FaultStages() {
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
  trialStage('healthy', 'v1', 1);
  trialStage('fault', 'v1', 1); trialStage('fault', 'v1', 2);
  return stages;
}

export function followupArms() {
  const arms = (process.env.STUDY_ARMS || 'runtime').split(',');
  if (!arms.length || arms.some(arm => !['maintained', 'runtime'].includes(arm)) || new Set(arms).size !== arms.length) {
    throw new Error('STUDY_ARMS must be maintained, runtime or both');
  }
  return arms;
}
