// Moodle campaign plan generator. Input: the manifest and the (break, fault) pairs that the V1 reproduction found valid.
// Output: trial keys per the ledger contract `<planShort>/<case>/<state>/<arm>/<model>/r<k>`.
//   case   = `<break>.<scenario>` (the break decides what arm B repairs; the scenario is what runs)
//   state  = `healthy` | `fault:<Fxx>`   (the build the arm runs against)
//   arm    = A (developer test half = the pin's own tests) | B (old step definitions + LLM repair for the break) | C (browser agent)
//   model  = `none` for A (deterministic, one run), else the model id
// Arm B's repair is its own ledger task per break x model x repetition: `repair:moodle/<break>/<model>/r<k>`, trial key
// `<planShort>/<break>.repair/broken-steps:<break>/B/<model>/r<k>`; arm-B trials of repetition k use that repair.
export const ARMS = ['A', 'B', 'C'];
export const repairTaskKey = (breakId, model, rep) => `repair:moodle/${breakId}/${model}/r${rep}`;
export const repairTrialKey = (short, breakId, model, rep) => `${short}/${breakId}.repair/broken-steps:${breakId}/B/${model}/r${rep}`;

export function campaignTrials({ pairs, short, arms = ARMS, models = [], reps = 1 }) {
  const out = new Map(), add = t => { out.set(t.key, t); };
  for (const p of pairs) {
    const caseId = `${p.break}.${p.scenario}`;
    for (const state of ['healthy', `fault:${p.fault}`]) for (const arm of arms) {
      if (arm === 'A') add({ key: `${short}/${caseId}/${state}/A/none/r1`, caseId, break: p.break, scenario: p.scenario, state, arm, model: 'none', rep: 1, fault: state.startsWith('fault') ? p.fault : null });
      else for (const model of models) for (let rep = 1; rep <= reps; rep++)
        add({ key: `${short}/${caseId}/${state}/${arm}/${model}/r${rep}`, caseId, break: p.break, scenario: p.scenario, state, arm, model, rep, fault: state.startsWith('fault') ? p.fault : null });
    }
  }
  return [...out.values()];
}
export function repairJobs({ pairs, models, reps = 1 }) {
  const breaks = [...new Set(pairs.map(p => p.break))].sort(), jobs = [];
  for (const b of breaks) for (const model of models) for (let rep = 1; rep <= reps; rep++) jobs.push({ break: b, model, rep, taskKey: repairTaskKey(b, model, rep) });
  return jobs;
}

// The pair selection rule (class (i) first, then class (ii), up to 16) lives with the V1 report: scripts/moodle/v1-report.mjs SELECTION_RULE. The earlier 15 -> 13 pair-count
// scope rule was dropped (docs/contracts/moodle-campaign.md, history).
// Next free task key for a base key: base, then base#2, base#3, ... (a key is one piece of work forever; a deliberate re-run is a new suffix).
export const nextFreeKey = (base, usedKeys) => { if (!usedKeys.has(base)) return base; let n = 2; while (usedKeys.has(`${base}#${n}`)) n++; return `${base}#${n}`; };
