export function classify({ healthy, status, observation, modelVerified = true, timedOut = false, assertionFailure = false, scenarioCount = 1 }) {
  if (observation.observerProtocol === 'ordered-ui-phase-v1-provisional' && observation.adjudicationStatus !== 'complete') {
    throw new Error('Phase evidence is provisional: complete independent adjudication before deriving trial outcome labels');
  }
  const invalidTrial = !modelVerified || scenarioCount !== 1 || !observation.evaluable;
  const blocked = timedOut || !observation.triggerWitnessed || status === 'unresolved';
  const eligible = !invalidTrial && !blocked;
  return {
    invalidTrial, timedOut, blocked,
    correctPass: eligible && healthy && status === 'pass' && observation.completionWitnessed,
    unjustifiedPass: !invalidTrial && status === 'pass' && !observation.completionWitnessed,
    faultConditionPass: !invalidTrial && !healthy && status === 'pass',
    falsePass: !invalidTrial && status === 'pass' && observation.defectObserved,
    falseAlarm: eligible && healthy && status === 'fail' && assertionFailure && !observation.defectObserved,
    actionFailure: !invalidTrial && status === 'fail' && (!assertionFailure || !observation.triggerWitnessed || (healthy && observation.defectObserved)),
    detectionCandidate: eligible && !healthy && status === 'fail' && assertionFailure && observation.defectObserved,
    requiresIndependentAdjudication: eligible && !healthy && status === 'fail' && assertionFailure && observation.defectObserved,
  };
}
