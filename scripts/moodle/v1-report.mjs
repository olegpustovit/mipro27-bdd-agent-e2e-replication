#!/usr/bin/env node
// Builds results/moodle-v1-reproduction.txt + .jsonl from the trial ledger (model-free V1 reproduction).
// A trial's effective result is its first round with status passed|failed (an `error` run did not execute a scenario);
// every round is listed in the jsonl and disagreement between rounds is flagged. Nothing is dropped.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { readLines } from '../ledger/jsonl.mjs';
import { ledgerPaths } from '../ledger/paths.mjs';
import { loadManifest, resolveTarget } from '../../adapters/moodle/manifest.mjs';
import { repoRoot, dataHome, resolveMoodleCommit } from '../../adapters/moodle/config.mjs';
import { selectedStructure, structureTotals, renderStructure } from './pair-structure.mjs';

export function collect(events, plan = null) {
  const rows = new Map();   // `${scenario}|${state}` -> [rounds]
  for (const e of events) {
    if (e.type !== 'trial-end' || e.outcome === undefined || !/\/v1\/none\/r\d+/.test(e.key)) continue;
    if (plan && !e.key.startsWith(plan + '/')) continue;
    const round = Number(/\/r(\d+)(?:#\d+)?$/.exec(e.key)[1]), k = `${e.scenario}|${e.state}`;
    (rows.get(k) ?? rows.set(k, []).get(k)).push({ round, key: e.key, ...e });
  }
  for (const list of rows.values()) list.sort((a, b) => String(a.at).localeCompare(String(b.at)));   // time order: the effective result is the earliest that executed a scenario
  return rows;
}
// effective result: the latest round flagged `corrects` (a rerun that supersedes an earlier, wrongly set up trial; the old one stays in the jsonl), else the earliest that executed a scenario
const eff = list => { const ok = list?.filter(r => r.status === 'passed' || r.status === 'failed') ?? [], fix = ok.filter(r => r.corrects).at(-1); return fix ?? ok[0] ?? null; };
// Arm B's starting state: new UI + the developers' NEW .feature files + OLD step definitions (mining/make_steps_patches.py). Where that patch is byte-identical to
// `broken:Bxx` (class i: the test half has no .feature file) the broken rows are the start-state rows; otherwise `broken-steps:Bxx` was run on its own.
// Wave-3 breaks (B14+) were run under the arm B name itself (`test_half_split.start_rows: 'broken-steps'`: class i, the patch is byte-identical to broken, the model-free trials carry the state `broken-steps:Bxx`).
export const startState = b => b.test_half_split && (!b.test_half_split.identical_to_broken || b.test_half_split.start_rows === 'broken-steps') ? `broken-steps:${b.id}` : `broken:${b.id}`;
// Step rule, ONE rule for the valid-pair gate and for campaign scoring (tolerance 0): the failing step is the target step when it has the same Behat index or the same step text.
// 'near' (within 2 steps) and the others are classified for the report only; they never make a pair valid and never count as a catch.
export const EXACT = cls => cls === 'at';
export const stepClass = (failing, target, failingText, targetText) => failing == null ? 'none' : failing === target || (targetText && failingText === targetText) ? 'at' : Math.abs(failing - target) <= 2 ? 'near' : failing < target ? 'earlier' : 'later';

export function analyse(manifest, rows, srcDir = join(dataHome(), 'src', resolveMoodleCommit().slice(0, 12))) {
  const get = (s, st) => rows.get(`${s}|${st}`), e = (s, st) => eff(get(s, st));
  // One row per fault target: the primary target, plus alternative targets of the same fix that were run (manifest `alt_targets`).
  const targets = manifest.faults.flatMap(f => [{ f, alt: false, t: f.target }, ...(f.alt_targets ?? []).filter(a => get(a.scenario, `fault:${f.id}`)).map(a => ({ f, alt: true, t: { ...f.target, ...a } }))]);
  const faults = targets.map(({ f, alt, t }) => {
    const s = t.scenario, run = e(s, `fault:${f.id}`), healthy = e(s, 'healthy'), tgt = resolveTarget(manifest, { ...f, target: t }, srcDir);
    const reproduced = !!run && !!healthy && run.status === 'failed' && healthy.status === 'passed';
    const fs = run?.failingStepIndex ?? null;
    return { fault: f.id, alt, mdl: f.mdl, scenario: s, linked_breaks: f.linked_breaks, target_step_index: tgt.behatIndex, target_resolved_by: tgt.method, manifest_step_index: t.step_index, target_step_text: t.step_text, healthy: healthy?.status ?? 'not-run',
      faulted: run?.status ?? 'not-run', reproduced, failing_step_index: fs, failing_step_text: run?.failingStep?.text ?? null, step_vs_target: reproduced ? stepClass(fs, tgt.behatIndex, run.failingStep?.text, tgt.method === 'text' ? t.step_text : null) : 'n/a',
      step_delta: reproduced && fs != null ? fs - tgt.behatIndex : null, failing_error: run?.failingStep?.error?.slice(0, 160) ?? null, wall_ms: run?.scenarioWallMs ?? null, rounds: (get(s, `fault:${f.id}`) ?? []).map(r => r.status) };
  });
  const breaks = manifest.breaks.map(b => {
    if (!b.usable) return { break: b.id, mdl: b.mdl, class: b.class, usable: false, note: b.notes ?? 'not usable', scenarios: [], reproduced_strict: false, reproduced_core: false };
    const scen = [...new Set(manifest.scenarios.map(x => x.id).filter(id => get(id, `broken:${b.id}`) || get(id, startState(b))))], start = startState(b);
    const per = scen.map(s => {
      const bef = e(s, `before:${b.id}`), old = e(s, `broken:${b.id}`), brk = e(s, start), ad = e(s, 'healthy');   // old = whole test half reverted (provenance); brk = arm B's starting state
      const core = !!brk && !!ad && ad.status === 'passed' && brk.status === 'failed', strict = core && bef?.status === 'passed';
      const oldCore = !!old && !!ad && ad.status === 'passed' && old.status === 'failed', oldStrict = oldCore && bef?.status === 'passed';
      return { scenario: s, before: bef?.status ?? 'not-run', whole_half_broken: old?.status ?? 'not-run', broken: brk?.status ?? 'not-run', start_state: start, adapted: ad?.status ?? 'not-run', core, strict, old_core: oldCore, old_strict: oldStrict, broken_failing_step: brk?.failingStepIndex ?? null, broken_failing_text: brk?.failingStep?.text ?? null,
        broken_error: brk?.failingStep?.error?.slice(0, 140) ?? null, before_failing_text: bef?.status === 'failed' ? bef.failingStep?.text ?? null : null, wall_ms: { before: bef?.scenarioWallMs ?? null, broken: brk?.scenarioWallMs ?? null, adapted: ad?.scenarioWallMs ?? null } };
    });
    return { break: b.id, mdl: b.mdl, class: b.class, usable: true, start_state: start, split: b.test_half_split ?? null, scenarios: per, reproduced_strict: per.some(p => p.strict), reproduced_core: per.some(p => p.core), old_reproduced_core: per.some(p => p.old_core), old_n_core: per.filter(p => p.old_core).length, n_strict: per.filter(p => p.strict).length, n_core: per.filter(p => p.core).length, n_scenarios: per.length };
  });
  const bmap = new Map(breaks.map(b => [b.break, b]));
  const pairs = [];
  // Every (break, fault) combination whose break was run in the fault's scenario: manifest-linked ones and the cross-product (round 2).
  const combos = []; for (const f of faults) for (const b of breaks) if (b.usable && (f.linked_breaks.includes(b.break) || b.scenarios.some(x => x.scenario === f.scenario))) combos.push([f, b.break]);
  for (const [f, bid] of combos) {
    const b = bmap.get(bid), p = b?.scenarios.find(x => x.scenario === f.scenario), linked = f.linked_breaks.includes(bid);
    const bi = f.alt ? null : manifest.faultById.get(f.fault).break_step_index?.[bid] ?? null;
    pairs.push({ break: bid, fault: f.fault, alt_target: f.alt, scenario: f.scenario, manifest_linked: linked, break_reproduced_strict: !!p?.strict, break_reproduced_core: !!p?.core, fault_reproduced: f.reproduced,
      old_break_core: !!p?.old_core, old_break_strict: !!p?.old_strict, valid_strict: !!p?.strict && f.reproduced, valid_core: !!p?.core && f.reproduced, manifest_break_step_index: bi, observed_break_failing_step: p?.broken_failing_step ?? null,
      break_step_match: bi == null || p?.broken_failing_step == null ? 'n/a' : bi === p.broken_failing_step ? 'same' : `delta ${p.broken_failing_step - bi}`, fault_step_vs_target: f.step_vs_target });
  }
  // Wave 2: accepted fault candidates (mined or seeded), one row per confirmed target scenario. The target step was frozen from the screening
  // run (mining/record_candidates.py screen) before any pairing; the confirmation rerun must fail at or near it. Pairs use the same break rows.
  const wave = [...(manifest.fault_candidates ?? []), ...(manifest.fault_cross_runs ?? [])].filter(c => c.status === 'accepted').flatMap(c => c.targets.map(t => ({ fault: c.id, origin: c.origin ?? 'mined', mdl: c.mdl ?? null, scenario: t.scenario, target_step_index: t.behat_step_index, target_step_text: t.step_text, frozen_at: t.frozen_at,
    confirm: c.confirm?.[t.scenario] ?? null, step_vs_target: t.confirm_class ?? c.confirm?.[t.scenario]?.class ?? 'n/a', failing_step_index: c.confirm?.[t.scenario]?.failing_step_index ?? null, failing_step_text: c.confirm?.[t.scenario]?.failing_step_text ?? null })));
  for (const w of wave) for (const b of breaks) {
    const p = b.usable ? b.scenarios.find(x => x.scenario === w.scenario) : null; if (!p?.core && !p?.old_core) continue;
    const atNear = EXACT(w.step_vs_target);
    pairs.push({ break: b.break, fault: w.fault, origin: w.origin, alt_target: false, scenario: w.scenario, manifest_linked: false, wave2: true, break_reproduced_strict: p.strict, break_reproduced_core: p.core, fault_reproduced: true, old_break_core: p.old_core, old_break_strict: p.old_strict, valid_strict: p.strict && atNear, valid_core: p.core && atNear,
      manifest_break_step_index: null, observed_break_failing_step: p.broken_failing_step, break_step_match: 'n/a', fault_step_vs_target: w.step_vs_target, target_step_text: w.target_step_text, failing_step_text: w.failing_step_text, failing_step_index: w.failing_step_index, target_step_index: w.target_step_index });
  }
  // The original faults: the same gate definition (failing step at or near the target) on top of the V1 flags.
  for (const p of pairs) if (!p.wave2) { p.origin = 'mined'; const f = faults.find(x => x.fault === p.fault && x.scenario === p.scenario && x.alt === p.alt_target); p.target_step_text = f?.target_step_text ?? null; p.failing_step_text = f?.failing_step_text ?? null; p.failing_step_index = f?.failing_step_index ?? null; p.target_step_index = f?.target_step_index ?? null;
    const atNear = EXACT(p.fault_step_vs_target); p.valid_strict_v1 = p.valid_strict; p.valid_core_v1 = p.valid_core; p.valid_strict = p.valid_strict && atNear; p.valid_core = p.valid_core && atNear; }
  for (const p of pairs) p.valid_old_rule = !!p.old_break_core && !!p.fault_reproduced && ['at', 'near'].includes(p.fault_step_vs_target);   // the rule of the first report: whole-test-half break, within 2 steps
  return { faults, breaks, pairs, wave };
}

// ---- Pair selection (rule written down 2026-11-16 after the model-driven smoke trials of results/moodle-timeline.txt; no measured campaign trial existed; it replaces the old 15->13 SCOPE_RULE) ----
// Candidates are the VALID pairs: the break bites in arm B's starting state (new UI + the developers' new Gherkin + old step definitions), the fault reproduces
// there, and the faulted run fails at the target step under the ONE step rule (same Behat index or same step text; no tolerance).
//   1. class (i) first: every valid class (i) pair, at most SELECTION_RULE.perBreakI (3) per break; no two selected pairs share the same fault and scenario
//      (a (fault, scenario) is taken by the first break in the order strict breaks first, then break id; within a break distinct faults come first, then scenario id).
//   2. then class (ii) pairs, at most SELECTION_RULE.perBreakII (2) per break, in rank rounds over the breaks (strict breaks first, then id), skipping a (fault, scenario) already
//      selected, until SELECTION_RULE.total (16) pairs are selected.
// No model result, token count or smoke outcome enters the rule's inputs; it uses model-free V1 rows only (the smoke trials existed before the rule was written; see results/moodle-timeline.txt).
// AMENDMENT 2026-11-16 (class-i-first-v3), committed after model-driven smoke trials (results/moodle-timeline.txt lists them; the dropped and added pairs had none): a candidate must also satisfy the ORDERING criterion. A pair measures whether detection survives adaptation only if the fault's target
// step (Behat index) is at or after the step where the break bites in arm B's starting state: if the fault fails earlier (for example B30.C760@S141, target 0, bite 1) the adapted steps cannot affect
// detection. `orderOk` is applied to every valid pair; the pairs that fail it are listed as excluded with this reason (`orderExcluded`). Everything else is unchanged.
export const orderOk = p => p.target_step_index == null || p.observed_break_failing_step == null || p.target_step_index >= p.observed_break_failing_step;
export const SELECTION_RULE = Object.freeze({
  id: 'class-i-first-v3', ordering: 'target step index >= index of the step where the break bites (amended 2026-11-16)', supersedes: 'class-i-first-v2 (same rule without the ordering criterion; its selection is kept in docs/contracts/moodle-campaign.md as superseded)', total: 16, perBreakI: 3, perBreakII: 2, stepRule: 'exact (same Behat index or same step text)',
  replaces: 'keep-first-13-selected-pairs (SCOPE_RULE, 15 -> 13): it cut pairs but did not address tokens per run; the 2x per-run criterion stays unmet for luna and terra and the paper must say so',
});
export function selectPairs(a) {
  const brk = id => a.breaks.find(x => x.break === id), classOf = id => brk(id)?.class, order = b => (brk(b)?.reproduced_strict ? 0 : 1) + b;
  const validAll = a.pairs.filter(p => p.valid_strict || p.valid_core), valids = validAll, orderExcluded = validAll.filter(p => !orderOk(p));
  const sorted = valids.slice().sort((x, y) => Number(y.valid_strict) - Number(x.valid_strict) || order(x.break).localeCompare(order(y.break)) || x.fault.localeCompare(y.fault) || x.scenario.localeCompare(y.scenario));
  // per-break preference: strict first, then distinct faults before a second scenario of the same fault, then fault id and scenario id
  const prefer = list => { const byFault = new Map(); for (const p of list) (byFault.get(p.fault) ?? byFault.set(p.fault, []).get(p.fault)).push(p); const out = [], lists = [...byFault.values()]; for (let r = 0; lists.some(l => l[r]); r++) for (const l of lists) if (l[r]) out.push(l[r]); return out; };
  const taken = new Set(), selected = [], keyOf = p => `${p.fault}@${p.scenario}`, room = () => SELECTION_RULE.total - selected.length;
  const ordered = sorted.filter(orderOk), breaksOf = cls => [...new Set(ordered.filter(p => classOf(p.break) === cls).map(p => p.break))].sort((x, y) => order(x).localeCompare(order(y)));
  const pool = b => prefer(ordered.filter(p => p.break === b));
  const classI = breaksOf('i'), classII = breaksOf('ii');
  for (const b of classI) for (const p of pool(b)) { if (selected.filter(q => q.break === b).length >= SELECTION_RULE.perBreakI || room() <= 0) break; if (taken.has(keyOf(p))) continue; taken.add(keyOf(p)); selected.push(p); }
  const pools = new Map(classII.map(b => [b, pool(b)]));
  for (let r = 0; r < SELECTION_RULE.perBreakII; r++) for (const b of classII) {
    if (room() <= 0) break;
    const p = pools.get(b).find(q => !taken.has(keyOf(q)) && !selected.includes(q)); if (!p || selected.filter(q => q.break === b).length >= SELECTION_RULE.perBreakII) continue;
    taken.add(keyOf(p)); selected.push(p);
  }
  const breakOrder = [...new Set(selected.map(p => p.break))];
  return { valids, validAll, orderExcluded, sorted, selected, breakOrder, classI, classII };
}
// The selection recorded in the jsonl of the last report run (pairs and breaks rows), with the break class added; `.breaks` carries the break rows.
export function selectedPairs(path = join(repoRoot, 'results/moodle-v1-reproduction.jsonl')) {
  const rec = readFileSync(path, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)), breaks = rec.filter(r => r.type === 'break');
  return Object.assign(selectPairs({ pairs: rec.filter(r => r.type === 'pair'), breaks }).selected.map(p => ({ ...p, class: breaks.find(b => b.break === p.break).class })), { breaks });
}
// Counts of a selection by class, break, origin (mined/seeded) and bite (strict/core), for the report and the budget file.
export function selectionCounts(selected, breaks) {
  const classOf = id => breaks.find(x => x.break === id)?.class, tally = key => { const m = new Map(); for (const p of selected) m.set(key(p), (m.get(key(p)) ?? 0) + 1); return [...m].sort(([x], [y]) => String(x).localeCompare(String(y))); };
  return { total: selected.length, byClass: tally(p => `class ${classOf(p.break)}`), byBreak: tally(p => p.break), byOrigin: tally(p => p.origin), byBite: tally(p => p.valid_strict ? 'strict' : 'core'), byFault: tally(p => p.fault) };
}
export const fmtCounts = c => ['byClass', 'byBreak', 'byOrigin', 'byBite'].map(k => `${{ byClass: 'by class', byBreak: 'by break', byOrigin: 'by origin', byBite: 'strict/core' }[k]}: ${c[k].map(([x, n]) => `${x} ${n}`).join(', ') || 'none'}`).join('; ');

// What the selected pairs do and do not measure, stated with counts from the selection itself.
export function selectionWording(selected, a, cts = selectionCounts(selected, a.breaks)) {
  const strictPairs = selected.filter(p => p.valid_strict), corePairs = selected.filter(p => !p.valid_strict), brk = id => a.breaks.find(b => b.break === id);
  const strictBreaks = [...new Set(selected.filter(p => brk(p.break)?.reproduced_strict).map(p => p.break))], allBreaks = [...new Set(selected.map(p => p.break))];
  const beforeOf = p => brk(p.break)?.scenarios.find(x => x.scenario === p.scenario)?.before ?? 'not-run', tally = {}; for (const p of corePairs) tally[beforeOf(p)] = (tally[beforeOf(p)] ?? 0) + 1;
  const L = ['WORDING OF THE SELECTION (counts from the selected pairs above)'];
  L.push(`"strict" counts pairs: ${strictPairs.length} of ${selected.length} selected pairs are strict (before state passes, start state fails, pin passes). Only ${strictBreaks.length} of the ${allBreaks.length} selected breaks is strict${strictBreaks.length ? ` (${strictBreaks.join(', ')})` : ''}; the other ${allBreaks.length - strictBreaks.length} breaks contribute core pairs only.`);
  L.push(`The ${corePairs.length} core pairs have no passing before state (before state of their scenario: ${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}). For them the break is not "the effect of the named UI change"; it is the old step definitions from before the developers' fix, run against the current UI at the pin. The MDL id and date of each UI commit are listed under UI COMMITS below (B25, B27, B28, B29 and B34 are 2019-2021 changes).`);
  return L.join('\n');
}

export function render(manifest, a, rows, { plan, srcDir = join(dataHome(), 'src', resolveMoodleCommit().slice(0, 12)) } = {}) {
  const L = [], n = (x, w) => String(x ?? '-').padEnd(w), ok = v => v ? 'yes' : 'NO';
  const all = [...rows.values()].flat(), total = all.length, byStatus = {}; for (const r of all) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  L.push('Moodle model-free V1 reproduction (developers\' own Behat step definitions; no model, not a measured campaign)');
  L.push(`pin ${manifest.moodle.pin.commit} (${manifest.moodle.pin.release}); plan ${plan ?? 'any'}; trials recorded: ${total} (${Object.entries(byStatus).map(([k, v]) => `${k} ${v}`).join(', ')})`);
  L.push('States: healthy = pin (= "adapted": current UI + developers\' repaired tests). before = old UI + old tests (UI half and test half reverted). broken = new UI + old tests (test half reverted). fault = pin with the fix\'s non-test hunks reverted. broken-steps = new UI + the developers\' NEW .feature files + OLD step definitions/selectors (only the non-.feature test hunks reverted): arm B\'s starting state in every class; an empty patch means the fix touched no step definition (Gherkin-only fix) and the state is the pin itself. Where broken-steps is byte-identical to broken (class i without .feature hunks) the broken rows are used for it.');
  L.push('before/broken states are patches at the pin; where later commits touched the same lines the conflicting region takes the pre-change side (see manifests/moodle/patches/index.json), so "before" can fail for reasons other than the UI change.');
  L.push('Step indices are Behat\'s: 0-based over all executed steps, Background first. The manifest target (own-step index at the fix commit) is resolved to a Behat index at the pin: the step with the same text (closest to background + manifest index), else background + manifest index. "at" = same index or same step text. ONE step rule for the valid-pair gate and for campaign scoring: exact (tolerance 0). "near" (within 2 steps) is classified for the report only; a near pair is not valid and a near failure is not a catch.');
  L.push('');
  L.push('BREAKS (bite measured in arm B\'s starting state: reproduced strict = some affected scenario: before passes, start state fails, adapted passes; core = start state fails and adapted passes; whole-half = old state with the whole developer test half reverted, provenance only)');
  L.push(`${n('break', 6)}${n('mdl', 12)}${n('cls', 4)}${n('strict', 7)}${n('core', 6)}${n('whole-half core', 16)}scenarios strict/core/total  detail`);
  for (const b of a.breaks) {
    if (!b.usable) { L.push(`${n(b.break, 6)}${n(b.mdl, 12)}${n(b.class, 4)}${n('n/a', 7)}${n('n/a', 6)}${n('n/a', 16)}not usable: ${b.note}`); continue; }
    const first = b.scenarios.find(p => p.strict) ?? b.scenarios.find(p => p.core);
    L.push(`${n(b.break, 6)}${n(b.mdl, 12)}${n(b.class, 4)}${n(ok(b.reproduced_strict), 7)}${n(ok(b.reproduced_core), 6)}${n(`${ok(b.old_reproduced_core)} (${b.old_n_core})`, 16)}${b.n_strict}/${b.n_core}/${b.n_scenarios}  ${first ? `e.g. ${first.scenario}: ${b.start_state} fails at step ${first.broken_failing_step} "${first.broken_failing_text}"` : `no scenario fails in ${b.start_state}`}`);
  }
  L.push('');
  L.push('ARM B STARTING STATE per break (mining/make_steps_patches.py): the developer test half split into .feature files and step-definition/selector files; class (i) must hold no .feature file');
  L.push(`${n('break', 6)}${n('cls', 4)}${n('feature files', 14)}${n('step files', 11)}${n('== broken', 10)}${n('patch', 11)}${n('Gherkin check', 27)}start state`);
  for (const b of a.breaks) { const sp = b.split ?? manifest.breakById.get(b.break).test_half_split; if (!sp) continue; const clsI = b.class === 'i', bad = clsI && sp.feature_files.length > 0;
    L.push(`${n(b.break, 6)}${n(b.class, 4)}${n(sp.feature_files.length, 14)}${n(sp.step_files.length, 11)}${n(sp.identical_to_broken ? 'yes' : 'no', 10)}${n(sp.empty ? 'empty' : 'non-empty', 11)}${n(clsI ? (bad ? 'class i HAS .feature hunk' : 'no .feature hunk') : 'new Gherkin kept', 27)}${sp.identical_to_broken ? `broken:${b.break} (same bytes)` : `broken-steps:${b.break}${sp.empty ? ' (= the pin: Gherkin-only fix, no step definition to repair)' : ''}`}`); }
  L.push('');
  L.push('BREAK x SCENARIO (before = old UI + old tests; whole-half = new UI + whole developer test half reverted; start = arm B\'s starting state; adapted = the pin)');
  L.push(`${n('break', 6)}${n('scen', 6)}${n('before', 8)}${n('whole-half', 11)}${n('start', 8)}${n('adapted', 8)}${n('step', 5)}${n('wall b/k/a s', 16)}start-state failure`);
  for (const b of a.breaks.filter(x => x.usable)) for (const p of b.scenarios)
    L.push(`${n(b.break, 6)}${n(p.scenario, 6)}${n(p.before, 8)}${n(p.whole_half_broken, 11)}${n(p.broken, 8)}${n(p.adapted, 8)}${n(p.broken_failing_step, 5)}${n(Object.values(p.wall_ms).map(v => v == null ? '-' : (v / 1000).toFixed(0)).join('/'), 16)}${p.broken_error ?? ''}`);
  L.push('');
  L.push('FAULTS (reproduced = at the adapted state with the fix reverted the linked scenario fails, and passes without the revert; * = alternative target of the same fix, run separately)');
  L.push(`${n('fault', 6)}${n('mdl', 12)}${n('scen', 6)}${n('linked', 11)}${n('repro', 6)}${n('healthy', 8)}${n('faulted', 8)}${n('fail@', 6)}${n('target@', 8)}${n('vs target', 10)}${n('wall s', 7)}failing step`);
  for (const f of a.faults) L.push(`${n(f.fault + (f.alt ? '*' : ''), 6)}${n(f.mdl, 12)}${n(f.scenario, 6)}${n(f.linked_breaks.join(','), 11)}${n(ok(f.reproduced), 6)}${n(f.healthy, 8)}${n(f.faulted, 8)}${n(f.failing_step_index, 6)}${n(f.target_step_index, 8)}${n(f.step_vs_target + (f.step_delta ? ` (${f.step_delta > 0 ? '+' : ''}${f.step_delta})` : ''), 10)}${n(f.wall_ms == null ? '-' : (f.wall_ms / 1000).toFixed(0), 7)}${f.failing_step_text ?? ''}`);
  L.push('');
  L.push('(break, fault) COMBINATIONS (the break bites in arm B\'s starting state in the fault\'s scenario AND the fault reproduces there; valid = also fails at the target step under the exact step rule)');
  L.push(`(${a.pairs.filter(p => p.manifest_linked).length} manifest-linked combinations plus ${a.pairs.filter(p => !p.manifest_linked).length} cross-product combinations in which the break was run in the fault's scenario; listed below: the linked ones and any combination where the break bites; the rest have a break that passes in that scenario)`);
  L.push(`${n('break', 6)}${n('fault', 6)}${n('scen', 6)}${n('linked', 7)}${n('brk strict', 11)}${n('brk core', 9)}${n('fault', 6)}${n('valid strict', 13)}${n('valid core', 11)}${n('brk step', 12)}fault step vs target`);
  for (const p of a.pairs.filter(x => x.manifest_linked || x.break_reproduced_core || x.old_break_core)) L.push(`${n(p.break, 6)}${n(p.fault, 6)}${n(p.scenario, 6)}${n(p.manifest_linked ? 'yes' : 'no', 7)}${n(ok(p.break_reproduced_strict), 11)}${n(ok(p.break_reproduced_core), 9)}${n(ok(p.fault_reproduced), 6)}${n(ok(p.valid_strict), 13)}${n(ok(p.valid_core), 11)}${n(p.break_step_match, 12)}${p.fault_step_vs_target}`);
  const errored = [...rows].filter(([, list]) => list.every(r => r.status === 'error')).map(([k]) => k.replace('|', ' ')).sort();
  L.push('');
  L.push(`NEVER EXECUTED (Behat reported no scenario, every round): ${errored.length ? errored.join(', ') : 'none'}${errored.some(x => x.startsWith('S009')) ? '. S009 carries @_cross_browser: Moodle\'s generated Behat configuration does not list its feature, so the original rounds ran no scenario. Since wave 2 it runs under study-behat-cross-browser.yml (healthy and F09 only; its break and before states were not re-run, no break bites there).' : ''}`);
  const vs = a.pairs.filter(p => p.valid_strict), vc = a.pairs.filter(p => p.valid_core);
  const classOf = id => manifest.breakById.get(id).class;
  L.push('');
  const cands = [...(manifest.fault_candidates ?? []), ...(manifest.fault_cross_runs ?? [])], cnt = k => cands.filter(c => c.status === k).length;
  L.push('WAVE-2 FAULT CANDIDATES (real bug-fix commits screened for the scenarios where a break bites; origin mined unless stated; every candidate tried is listed)');
  L.push(`candidates ${cands.length}: tried ${cands.filter(c => c.tried).length} (accepted ${cnt('accepted')}, rejected after running ${cands.filter(c => c.tried && c.status === 'rejected').length}, awaiting confirmation ${cands.filter(c => c.tried && c.status === 'pending').length}); not run: static revert failure ${cands.filter(c => c.tried === false).length}, not yet scheduled ${cands.filter(c => !c.tried && c.tried !== false).length}`);
  L.push(`${n('id', 6)}${n('origin', 8)}${n('mdl', 11)}${n('status', 10)}${n('probed', 7)}${n('failed', 7)}reason / scenarios failing`);
  for (const c of cands.filter(c => c.tried)) L.push(`${n(c.id, 6)}${n(c.origin, 8)}${n(c.mdl ?? '-', 11)}${n(c.status, 10)}${n(Object.keys(c.screen ?? {}).length, 7)}${n((c.screen_failed_scenarios ?? []).length, 7)}${c.status === 'rejected' ? c.rejection_reason.replace(/\s+/g, ' ') : (c.screen_failed_scenarios ?? []).join(',')}`);
  L.push('');
  L.push(`SEEDED FAULTS (origin seeded; written by Claude Code subagent ${manifest.seeded_provenance.subagent.id}, parent session ${manifest.seeded_provenance.subagent.parent_session}, model per transcript claude-sonnet-5-5, transcript sha256 ${manifest.seeded_provenance.subagent.transcript_sha256.slice(0, 16)}...; reads before the freeze commits: manifest seeded_provenance; intent and expected failing step written to the manifest before the first run, written_at)`);
  L.push(`${n('id', 6)}${n('kind', 17)}${n('status', 10)}${n('expected', 14)}observed in the screening run (scenario@step) / reason`);
  for (const c of cands.filter(c => c.origin === 'seeded')) { const e = c.seeded.expected_failing_step, got = c.screen?.[e.scenario], obs = c.screen_targets?.find(t => t.scenario === e.scenario);
    L.push(`${n(c.id, 6)}${n(c.semantic_change, 17)}${n(c.status, 10)}${n(`${e.scenario}`, 14)}${obs ? `${e.scenario}@${obs.behat_step_index} ${obs.step_text === e.step_text ? 'as expected' : `DIFFERENT step: ${obs.step_text}`}` : c.status === 'rejected' ? c.rejection_reason.replace(/\s+/g, ' ') : `${e.scenario}: ${got ?? 'not run'}`}`); }
  L.push('');
  L.push('WAVE-2 ACCEPTED FAULTS (target = first failing step of the screening run, frozen with a timestamp before pairing; confirmation = independent rerun)');
  L.push(`${n('fault', 6)}${n('origin', 8)}${n('scen', 6)}${n('target@', 8)}${n('confirm@', 9)}${n('vs target', 10)}${n('frozen at', 22)}target step`);
  for (const w of a.wave) L.push(`${n(w.fault, 6)}${n(w.origin, 8)}${n(w.scenario, 6)}${n(w.target_step_index, 8)}${n(w.failing_step_index, 9)}${n(w.step_vs_target, 10)}${n(w.frozen_at, 22)}${w.target_step_text}`);
  L.push('');
  L.push(`SUMMARY: breaks reproduced strict ${a.breaks.filter(b => b.reproduced_strict).length}/${a.breaks.filter(b => b.usable).length} usable (core ${a.breaks.filter(b => b.reproduced_core).length}); faults reproduced ${a.faults.filter(f => f.reproduced && !f.alt).length}/${a.faults.filter(f => !f.alt).length} (primary targets; alternative targets run: ${a.faults.filter(f => f.alt).length}, reproduced ${a.faults.filter(f => f.alt && f.reproduced).length}); fault failing step vs target (primary): ${a.faults.filter(f => !f.alt && f.step_vs_target === 'at').length} at, ${a.faults.filter(f => !f.alt && f.step_vs_target === 'near').length} near, ${a.faults.filter(f => !f.alt && f.reproduced && !['at', 'near'].includes(f.step_vs_target)).length} earlier/later`);
  L.push(`valid pairs strict ${vs.length}/${a.pairs.length} (distinct faults ${new Set(vs.map(p => p.fault)).size}, distinct breaks ${new Set(vs.map(p => p.break)).size}; class i ${vs.filter(p => classOf(p.break) === 'i').length}); valid pairs core ${vc.length}/${a.pairs.length} (distinct faults ${new Set(vc.map(p => p.fault)).size})`);
  L.push('');
  // Gate definition. A pair (break B, fault F) is valid in scenario S when (1) B bites in S in arm B's starting state: strict = the before state passes, the start state
  // (new UI + the developers' new Gherkin + old step definitions) fails and the adapted (pin) state passes; core = start fails and adapted passes; (2) F reproduces in S: the adapted
  // state passes and the faulted state (pin with the fix reverted, or the seeded mutation) fails, in the screening run and again in an independent rerun (wave 2) or in the V1 run
  // (original faults); (3) the failing step of the faulted run is the fault's target step under the ONE exact rule (same Behat index or same step text), the rule campaign scoring uses.
  const { valids, validAll, orderExcluded, sorted, selected, breakOrder } = selectPairs(a);
  L.push('VALID PAIRS (every valid combination under the exact step rule, before the ordering criterion; the gate needs >= 4, target 12)');
  L.push(`valid combinations: strict ${valids.filter(p => p.valid_strict).length}, core-only ${valids.filter(p => !p.valid_strict).length}; by class ${['i', 'ii'].map(c => `${c} ${valids.filter(p => classOf(p.break) === c).length}`).join(', ')}; distinct breaks ${new Set(valids.map(p => p.break)).size}, distinct faults ${new Set(valids.map(p => p.fault)).size}; by origin ${['mined', 'seeded'].map(o => `${o} ${valids.filter(p => p.origin === o).length}`).join(', ')}`);
  const row = (p, i) => `${n(i, 4)}${n(p.break, 6)}${n(classOf(p.break), 6)}${n(p.valid_strict ? 'strict' : 'core', 7)}${n(p.scenario, 6)}${n(p.fault, 6)}${n(p.origin, 8)}${n(p.target_step_index, 8)}${n(p.failing_step_index, 8)}${n(p.fault_step_vs_target, 7)}${p.target_step_text ?? ''}`;
  const head = `${n('#', 4)}${n('break', 6)}${n('class', 6)}${n('bite', 7)}${n('scen', 6)}${n('fault', 6)}${n('origin', 8)}${n('target@', 8)}${n('fail@', 8)}${n('vs', 7)}target step`;
  L.push(head); valids.length ? sorted.forEach((p, i) => L.push(row(p, i + 1))) : L.push('(none)');
  L.push('');
  // Pairs of the first report (whole test half reverted as the break, within 2 steps) that are not valid now, each with its reason.
  const excluded = a.pairs.filter(p => p.valid_old_rule && !(p.valid_strict || p.valid_core)), nearMiss = a.pairs.filter(p => p.old_break_core && p.break_reproduced_core && p.fault_reproduced && !EXACT(p.fault_step_vs_target) && !p.valid_old_rule);
  L.push(`EXCLUDED PAIRS (valid under the first report's rule: break = whole developer test half reverted, failing step within 2 steps of the target; not valid now): ${excluded.length}`);
  L.push(`${n('break', 6)}${n('class', 6)}${n('scen', 6)}${n('fault', 6)}${n('origin', 8)}${n('target@', 8)}${n('fail@', 7)}reason`);
  for (const p of excluded) { const why = []; if (!p.break_reproduced_core) why.push(`the break no longer bites in arm B's starting state (${a.breaks.find(b => b.break === p.break).start_state} passes)`); if (!EXACT(p.fault_step_vs_target)) why.push(`the faulted run fails at step ${p.failing_step_index}, the target is step ${p.target_step_index} (${p.fault_step_vs_target}): exact rule, no tolerance`);
    L.push(`${n(p.break, 6)}${n(classOf(p.break), 6)}${n(p.scenario, 6)}${n(p.fault, 6)}${n(p.origin, 8)}${n(p.target_step_index, 8)}${n(p.failing_step_index, 7)}${why.join('; ')}`); }
  if (!excluded.length) L.push('(none)');
  L.push('');
  const lost = a.breaks.filter(b => b.usable && b.old_reproduced_core && !b.reproduced_core).map(b => `${b.break} (${b.start_state} passes in all ${b.scenarios.length} scenarios run; whole-half bite in ${b.old_n_core})`);
  L.push(`BREAKS THAT NO LONGER BITE in arm B's starting state (whole-half bite before, none now): ${lost.length ? lost.join('; ') : 'none'}`);
  L.push('');
  const cts = selectionCounts(selected, a.breaks);
  L.push(`ORDERING-EXCLUDED PAIRS (valid under the exact rule, but the fault's target step is before the step where the break bites, so adapted steps cannot affect detection; amendment ${SELECTION_RULE.id}): ${orderExcluded.length} of ${validAll.length} valid pairs`);
  L.push(head); orderExcluded.forEach((p, i) => L.push(`${row(p, i + 1)}   [target ${p.target_step_index} < bite ${p.observed_break_failing_step}]`));
  if (!orderExcluded.length) L.push('(none)');
  L.push('');
  L.push(`SELECTION RULE ${SELECTION_RULE.id} (not written before every model result: model-driven smoke trials preceded it, listed in results/moodle-timeline.txt, with the exact commit times): class (i) first (all valid class (i) pairs, at most ${SELECTION_RULE.perBreakI} per break), then class (ii) pairs (at most ${SELECTION_RULE.perBreakII} per break) up to ${SELECTION_RULE.total} in total; no two pairs share the same fault and scenario; step rule ${SELECTION_RULE.stepRule}.`);
  L.push(`SELECTED PAIRS: ${selected.length} pairs over ${breakOrder.length} breaks (${fmtCounts(cts)})`);
  L.push(head); selected.forEach((p, i) => L.push(row(p, i + 1)));
  L.push('');
  L.push(...selectionWording(selected, a, cts).split('\n'));
  L.push('');
  try {
    const rowsS = selectedStructure({ manifest, a, selected, srcDir });
    L.push(...renderStructure(rowsS, structureTotals(rowsS), { manifest, a }).trimEnd().split('\n'));
  } catch (err) { L.push(`PER-PAIR STRUCTURE unavailable: ${err.message}`); }
  return L.join('\n') + '\n';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const plan = process.argv.includes('--plan') ? process.argv[process.argv.indexOf('--plan') + 1] : null;
  const manifest = loadManifest(), rows = collect(readLines(ledgerPaths().trials), plan), a = analyse(manifest, rows);
  mkdirSync(join(repoRoot, 'results'), { recursive: true });
  writeFileSync(join(repoRoot, 'results/moodle-v1-reproduction.txt'), render(manifest, a, rows, { plan }));
  const lines = [...a.breaks.map(x => ({ type: 'break', ...x })), ...a.faults.map(x => ({ type: 'fault', ...x })), ...a.pairs.map(x => ({ type: 'pair', ...x })),
    ...[...rows.values()].flat().map(r => ({ type: 'trial', key: r.key, round: r.round, corrects: r.corrects ?? false, ranScenario: r.ran ?? null, scenario: r.scenario, state: r.state, worker: r.worker, status: r.status, failingStepIndex: r.failingStepIndex, failingStep: r.failingStep, stepCount: r.stepCount, scenarioWallMs: r.scenarioWallMs, stateMs: r.stateMs, at: r.at }))];
  writeFileSync(join(repoRoot, 'results/moodle-v1-reproduction.jsonl'), lines.map(x => JSON.stringify(x)).join('\n') + '\n');
  console.log(render(manifest, a, rows, { plan }).split('\n').slice(-3).join('\n'));
}
