// Study mode of the Moodle measured campaign (owner decision 2026-11-01, applied 2026-11-16 to the Moodle campaign after the Evidence-plan gate STOP /151).
// Every campaign task and trial carries these fields; there is no gate pass. The gate verdict itself is never edited.
import { readLines } from '../ledger/jsonl.mjs';
export const STUDY_MODE = 'exploratory-owner-directed';
export const GATE_STATEMENT = 'exploratory-owner-directed; Evidence-plan gate STOP /151';
export const modeFields = () => ({ studyMode: STUDY_MODE, gatePassExists: false });

// omp cost cap: reported cumulative cost of this plan's haiku trials (arm C and repair sessions) in USD. Checked before every model-calling haiku trial.
export const OMP_MODEL = 'claude-haiku-5-5', OMP_COST_CAP_USD = 25;
export function ompCostState(events, short, model = OMP_MODEL) {
  let usd = 0, unknown = 0, trials = 0;
  for (const e of events) if (e.type === 'trial-end' && e.key?.startsWith(`${short}/`) && e.model === model && (e.arm === 'C' || e.key.includes('.repair/'))) {
    trials++; if (Number.isFinite(e.meter?.reportedCostUsd)) usd += e.meter.reportedCostUsd; else unknown++;
  }
  return { usd, unknown, trials };
}
// shouldStop hook for runTrials: null to go on, or the record of the stop.
export const ompCostGuard = ({ short, trialsPath, cap = OMP_COST_CAP_USD }) => spec => {
  if (spec.model !== OMP_MODEL || spec.arm === 'B' && !spec.key.includes('.repair/')) return null;   // arm-B Behat runs call no model
  const s = ompCostState(readLines(trialsPath), short);
  return s.usd > cap ? { reason: 'omp-cost-cap', capUsd: cap, reportedCumulativeUsd: s.usd, haikuTrialsCounted: s.trials, trialsWithUnknownCost: s.unknown } : null;
};
