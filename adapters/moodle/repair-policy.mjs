// Repair policy for Moodle arm B (old Behat step definitions + an LLM repair agent).
// What may be edited, what is read-only, and the budgets (the pilot's maintenance budget: study/exploratory-plan.mjs maintenanceEdits 10, maintenanceSuites 12).
import { posix } from 'node:path';

import { exploratoryConfig } from '../../study/exploratory-plan.mjs';
// The pilot repaired step definitions per UI transition under the maintenance budget (scripts/maintenance.mjs: `edit` and `validation` counters).
// Its validations are the agent's own suite runs; no harness run is counted. Same here: the harness's initial run is not counted, so
// the agent gets `scenarioRuns` runs of its own (the initial run's results are given in moodle_repair_read).
// (The per-execution baseline limits of study/manifest.mjs, repairEdits 2 / baselineRuns 3, belong to the maintained arm of a single execution and are not the repair budget.)
export const LIMITS = { acceptedEdits: exploratoryConfig.maintenanceEdits, scenarioRuns: exploratoryConfig.maintenanceSuites };
// Context classes (step definitions) and the Behat selector registry only.
const CONTEXT = /^public\/(?:[\w.-]+\/)*tests\/behat\/behat_[\w]+\.php$/;
const SELECTORS = /^public\/lib\/behat\/classes\/(?:partial_named_selector|named_selector)\.php$/;
// Shared infrastructure that decides how data is created or tests are reset: never repairable.
const INFRA = /(?:^|\/)(?:behat_hooks|behat_data_generators|behat_core_generator|behat_config_manager|behat_util|behat_init_)[\w]*\.php$|generator/i;
const ASSERTION = /\b(?:ExpectationException|ElementNotFoundException|ElementTextException|ExpectationFailedException|assert[A-Z]\w*|throw new)\b/g;
const count = (text, re) => (text.match(re) ?? []).length;

export function classifyPath(path) {
  const p = posix.normalize(path.replace(/\\/g, '/'));
  if (p.startsWith('/') || p.startsWith('..')) return { kind: 'outside', p };
  if (p.endsWith('.feature')) return { kind: 'gherkin', p };
  if (INFRA.test(p)) return { kind: 'infra', p };
  if (CONTEXT.test(p)) return { kind: 'context', p };
  if (SELECTORS.test(p)) return { kind: 'selector', p };
  return { kind: 'product-or-other', p };
}

// Gherkin (.feature files) is READ-ONLY for arm B in every break class. The scenario text is the developers' own (class i: unchanged by the break; class ii: their NEW wording),
// identical for arms A, B and C, so the target step index means the same step for every arm. Arm B's starting state is `broken-steps:Bxx` (new UI + the developers' new .feature files +
// old step definitions/selectors; mining/make_steps_patches.py): there is nothing in Gherkin for the repair to change, and an edit to a .feature file is refused for class i and class ii alike.
// allowedFiles: context/selector files the sampled scenarios' steps resolve to (computed by the harness from Behat's step definitions); null = any context file.
export function createRepairPolicy({ breakClass, allowedFiles = null, gherkinEditable }) {
  if (!['i', 'ii'].includes(breakClass)) throw new Error('breakClass must be "i" or "ii"');
  if (gherkinEditable !== undefined) throw new Error('gherkinEditable was removed: Gherkin is read-only for arm B in every break class');
  const allowed = allowedFiles && new Set(allowedFiles);
  let edits = 0, runs = 0;
  return {
    limits: LIMITS,
    get state() { return { acceptedEdits: edits, scenarioRuns: runs }; },
    // before/after: full file text; used to refuse edits that remove assertions.
    checkEdit({ path, before, after }) {
      if (edits >= LIMITS.acceptedEdits) return { ok: false, reason: `edit budget exhausted (${LIMITS.acceptedEdits})` };
      const { kind, p } = classifyPath(path);
      if (kind === 'outside') return { ok: false, reason: 'path must be relative to the Moodle root' };
      if (kind === 'infra') return { ok: false, reason: 'data generators, hooks and reset logic are not repairable' };
      if (kind === 'product-or-other') return { ok: false, reason: 'product code and non-Behat files are read-only (injected defects are never repaired)' };
      if (kind === 'gherkin') return { ok: false, reason: 'Gherkin is read-only for arm B in every break class (the developers\' feature files are the scenario text of every arm)' };
      if (allowed && !allowed.has(p)) return { ok: false, reason: 'file is not used by the sampled scenarios' };
      if (typeof before === 'string' && typeof after === 'string') {
        const b = count(before, ASSERTION), a = count(after, ASSERTION);
        if (a < b) return { ok: false, reason: `edit removes assertions/failure paths (${b} -> ${a}); weakening a check is not a repair` };
      }
      return { ok: true, kind, path: p };
    },
    acceptEdit() { if (edits >= LIMITS.acceptedEdits) throw new Error('edit budget exhausted'); edits++; return edits; },
    checkRun() { return runs < LIMITS.scenarioRuns ? { ok: true } : { ok: false, reason: `run budget exhausted (${LIMITS.scenarioRuns})` }; },
    acceptRun() { if (runs >= LIMITS.scenarioRuns) throw new Error('run budget exhausted'); runs++; return runs; },
  };
}
