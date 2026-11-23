// Deterministic "caught" oracle for the Moodle campaign.
//   caught       the same arm (and model, repetition) passes the healthy build at that state AND fails the faulted build at the fix's target step
//   false alarm  the arm fails the healthy build (any step)
// fail-near (healthy passes, faulted fails within two steps of the target) and fail-elsewhere are not catches. Everything else is kept apart: it is not a catch, and it is not hidden. A Behat run that never executed a scenario (`error`) and an agent
// verdict of `unresolved` are invalid observations, not passes and not fails. An agent verdict counts as "at the target" only when its step
// number was verified against the listed step text (verdict parser v2); step numbers map to Behat indices through the hand-off offset.
export function observed(body) {
  if (!body) return { status: 'missing', stepIndex: null, stepText: null };
  if (body.arm === 'C') {
    const status = { pass: 'pass', fail: 'fail', unresolved: 'invalid' }[body.status] ?? 'invalid';
    return { status, stepIndex: body.failingStepVerified ? body.behatStepIndex : null, stepText: body.failingStepVerified ? body.verdict?.failingStepText ?? null : null, located: Boolean(body.failingStepVerified) };
  }
  const status = { passed: 'pass', failed: 'fail' }[body.status] ?? 'invalid';
  return { status, stepIndex: body.failingStepIndex ?? null, stepText: body.failingStep?.text ?? null, located: body.failingStepIndex != null };
}
const same = t => String(t ?? '').replace(/^(?:Given|When|Then|And|But|\*)\s+/, '').replace(/\s+/g, ' ').trim();
export const atTarget = (obs, target, tolerance = 0) => obs.located && (obs.stepIndex === target.step_index || (obs.stepText && same(obs.stepText) === same(target.step_text)) || (tolerance > 0 && Math.abs(obs.stepIndex - target.step_index) <= tolerance));
export function judge({ healthy, faulted, target, tolerance = 0 }) {
  const h = observed(healthy), f = observed(faulted);
  if (h.status === 'missing' || f.status === 'missing') return { outcome: 'incomplete', healthy: h, faulted: f };
  if (h.status === 'fail') return { outcome: 'false-alarm', healthy: h, faulted: f };
  if (h.status !== 'pass') return { outcome: 'invalid-healthy', healthy: h, faulted: f };
  if (f.status === 'invalid') return { outcome: 'invalid-faulted', healthy: h, faulted: f };
  if (f.status === 'pass') return { outcome: 'missed', healthy: h, faulted: f };
  if (!f.located) return { outcome: 'fail-unlocated', healthy: h, faulted: f };
  if (atTarget(f, target, tolerance)) return { outcome: 'caught', healthy: h, faulted: f };
  // not a catch, but visible: the failing step is within two steps of the target (a different step of the same flow)
  return { outcome: Math.abs(f.stepIndex - target.step_index) <= 2 ? 'fail-near' : 'fail-elsewhere', healthy: h, faulted: f, delta: f.stepIndex - target.step_index };
}
export const OUTCOMES = ['caught', 'missed', 'fail-near', 'fail-elsewhere', 'fail-unlocated', 'false-alarm', 'invalid-healthy', 'invalid-faulted', 'incomplete'];
