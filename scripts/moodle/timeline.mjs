#!/usr/bin/env node
// results/moodle-timeline.txt: when the pair-selection rule was defined or amended (git log, UTC) against when model-driven smoke trials ran (ledger, UTC).
//   node scripts/moodle/timeline.mjs [--data <dir>]
// Model-driven = arm C trials and arm-B repair sessions (a model acts), plus arm-B Behat runs (they run the model's repaired step definitions). Arm A trials are model-free and only counted.
// A trial "matches" a selected pair when its scenario and fault equal the pair's: the break id is not part of the match (arms A and C run at the pin and do not see the break; B01.S028+X010 is the same scenario and fault as B07.X010@S028).
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readLines } from '../ledger/jsonl.mjs';
import { ledgerPaths } from '../ledger/paths.mjs';
import { repoRoot } from '../../adapters/moodle/config.mjs';

const git = (...a) => execFileSync('git', ['-C', repoRoot, ...a], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
const utc = sec => new Date(sec * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
const REPORT = 'results/moodle-v1-reproduction.txt';

// "SELECTED PAIRS" block of a report text: [{ break, scenario, fault }]
export function parseSelected(text) {
  const lines = text.split('\n'), i = lines.findIndex(l => l.startsWith('SELECTED PAIRS')); if (i < 0) return null;
  const rows = []; for (const l of lines.slice(i + 2)) { const m = /^\d+\s+(B\d+)\s+(?:i|ii)\s+(?:strict|core)\s+(S\d+)\s+([A-Z]\d+)\s/.exec(l); if (!m) break; rows.push({ break: m[1], scenario: m[2], fault: m[3] }); }
  return rows;
}
export const pairKey = p => `${p.fault}@${p.scenario}`;

// Commits that defined or amended the selection: every commit that changed the SELECTED PAIRS block of the report, plus every commit that changed the rule code or its text.
export function selectionHistory() {
  const events = new Map();   // sha -> { sha, at, subject, why: Set, pairs }
  const add = (sha, why) => { if (!events.has(sha)) { const [ct, subject] = git('log', '-1', '--format=%ct%x09%s', sha).trim().split('\t'); events.set(sha, { sha: sha.slice(0, 7), full: sha, at: utc(Number(ct)), ct: Number(ct), subject, why: new Set(), pairs: null }); } events.get(sha).why.add(why); };
  let prev = null;
  for (const sha of git('log', '--reverse', '--format=%H', '--', REPORT).trim().split('\n').filter(Boolean)) {
    let text; try { text = git('show', `${sha}:${REPORT}`); } catch { continue; }
    const rows = parseSelected(text); if (!rows) continue;
    const sig = rows.map(r => `${r.break}.${pairKey(r)}`).sort().join(',');
    if (sig !== prev) { add(sha, 'selected set changed in the report'); events.get(sha).pairs = rows; prev = sig; }
  }
  for (const pat of ['SELECTED PAIRS', 'SELECTION_RULE', 'SCOPE_RULE', 'orderOk', 'selectPairs', 'perBreakI']) for (const sha of git('log', '--format=%H', `-S${pat}`, '--', 'scripts', 'adapters', 'docs').trim().split('\n').filter(Boolean)) add(sha, `rule code or text mentions ${pat}`);
  const list = [...events.values()].sort((a, b) => a.ct - b.ct || a.sha.localeCompare(b.sha));
  // the selected set in force after each event (report text at that commit, else the last known)
  let cur = null; for (const e of list) { if (e.pairs) cur = e.pairs; else { try { const r = parseSelected(git('show', `${e.full}:${REPORT}`)); if (r) cur = r; } catch { /* keep */ } } e.inForce = cur; }
  return list;
}

// Model-driven (and model-dependent) smoke trials from the ledger.
export function smokeTrials(events) {
  const starts = new Map(); for (const e of events) if (e.type === 'trial-start') starts.set(`${e.task}|${e.key}|${e.attempt ?? ''}`, e.at);
  const out = [];
  for (const e of events) {
    // smoke tasks and arm-B repair sessions (tasks repair:); the ledger holds no measured campaign trial, so every repair session is a smoke or wiring session
    if (e.type !== 'trial-end' || !(/^smoke:/.test(e.task ?? '') || /^repair:/.test(e.task ?? ''))) continue;
    const m = /^([^/]+)\/(B\d+)(?:\.(S\d+|repair))?\/([^/]+)\/([ABC])\/([^/]+)\/r(\d+)$/.exec(e.key); if (!m) continue;
    const [, plan, brk, scen, state, arm, model, rep] = m;
    if (arm === 'A') { out.push({ arm, model: 'none', modelFree: true, plan, break: brk, scenario: scen, state, end: e.at, task: e.task, key: e.key }); continue; }
    out.push({ arm, model, plan, break: brk, scenario: scen === 'repair' ? null : scen, repair: scen === 'repair', state, fault: state.startsWith('fault:') ? state.slice(6) : null, rep: Number(rep), task: e.task, key: e.key,
      start: starts.get(`${e.task}|${e.key}|${e.attempt ?? ''}`) ?? null, end: e.at, body: e });
  }
  // a healthy trial and a repair session belong to the faults run for the same plan, break (and scenario) and model
  for (const t of out) {
    if (t.modelFree) continue;
    if (t.repair) { t.faults = [...new Set(out.filter(x => !x.modelFree && x.plan === t.plan && x.break === t.break && x.model === t.model && x.fault).map(x => `${x.fault}@${x.scenario}`))].sort(); t.scenarios = (t.body.sample ?? []); }
    else if (!t.fault) t.fault = [...new Set(out.filter(x => !x.modelFree && x.plan === t.plan && x.break === t.break && x.scenario === t.scenario && x.model === t.model && x.arm === t.arm && x.fault).map(x => x.fault))].join(',') || null;
  }
  return out;
}
const outcome = t => {
  const b = t.body;
  if (t.repair) return `repair: sample ${b.allSamplePass ? 'passes' : 'does not pass'} after ${b.policyState?.acceptedEdits ?? '?'} accepted edits in ${b.policyState?.scenarioRuns ?? '?'} runs; files ${(b.editedFiles ?? []).join(', ') || 'none'}`;
  if (t.arm === 'C') return `${b.status}${b.behatStepIndex != null ? ` at Behat step ${b.behatStepIndex}` : ''}${b.failingStepVerified ? ' (verified)' : ''}`;
  return `${b.status}${b.failingStepIndex != null ? ` at step ${b.failingStepIndex}` : ''}`;
};

export function build(trialEvents) {
  const hist = selectionHistory(), trials = smokeTrials(trialEvents), model = trials.filter(t => !t.modelFree).sort((a, b) => String(a.start ?? a.end).localeCompare(String(b.start ?? b.end)) || a.key.localeCompare(b.key));
  const free = trials.filter(t => t.modelFree), L = [];
  const v3 = [...hist].reverse().find(e => e.inForce)?.inForce ?? [], v3keys = new Set(v3.map(pairKey)), keysOf = t => t.repair ? t.faults.map(f => f.replace(/^(.*)@(.*)$/, '$1@$2')) : t.fault ? t.fault.split(',').map(f => `${f}@${t.scenario}`) : [];
  const matches = t => keysOf(t).filter(k => v3keys.has(k));
  L.push('Moodle timeline: selection-rule commits against model-driven smoke trials (generated by scripts/moodle/timeline.mjs from git log and the trial ledger; all times UTC)');
  L.push(`Model-driven smoke trials: ${model.length} (arm C ${model.filter(t => t.arm === 'C').length}, arm-B repair sessions ${model.filter(t => t.repair).length}, arm-B Behat runs of model-repaired step code ${model.filter(t => t.arm === 'B' && !t.repair).length}); model-free arm A smoke trials: ${free.length} (not listed). No measured campaign trial exists in the ledger (tasks "campaign:").`);
  L.push('A pair is matched by (scenario, fault); the break is not part of the match, because arms A and C run at the pin and do not see the break. B01.S028+X010 is the same scenario and fault as B07.X010@S028.');
  L.push('');
  L.push('A. COMMITS THAT DEFINED OR AMENDED THE SELECTION (set = the SELECTED PAIRS block of the report at that commit)');
  L.push(`${'commit'.padEnd(9)}${'time (UTC)'.padEnd(22)}${'pairs'.padEnd(6)}${'smoke trials before (on selected pairs)'.padEnd(40)}why / subject`);
  const earlier = at => model.filter(t => String(t.start ?? t.end) < at.replace('Z', ''));
  for (const e of hist) L.push(`${e.sha.padEnd(9)}${e.at.padEnd(22)}${String(e.inForce?.length ?? '-').padEnd(6)}${`${earlier(e.at).length} (${earlier(e.at).filter(t => matches(t).length).length})`.padEnd(40)}${[...e.why].join('; ')} | ${e.subject.slice(0, 110)}`);
  L.push('');
  L.push('B. SELECTED SETS, CHANGES BETWEEN THEM, AND MODEL TRIALS ON THE PAIRS THAT CHANGED');
  let prev = null;
  const trialsOn = k => model.filter(t => keysOf(t).includes(k)), trialsOnScen = s => model.filter(t => t.scenario === s || (t.repair && (t.scenarios ?? []).includes(s)));
  for (const e of hist.filter(e => e.pairs)) {
    const keys = new Set(e.pairs.map(pairKey));
    L.push(`${e.sha} ${e.at}: ${e.pairs.length} pairs`);
    if (prev) {
      const dropped = [...prev.pairs].filter(p => !keys.has(pairKey(p))), added = e.pairs.filter(p => !prev.keys.has(pairKey(p)));
      const desc = p => `${p.break}.${pairKey(p)}: model trials on this scenario+fault ${trialsOn(pairKey(p)).length}, on this scenario with any fault ${trialsOnScen(p.scenario).length}`;
      L.push(`  dropped ${dropped.length}${dropped.length ? ':' : ''}`); dropped.forEach(p => L.push(`    ${desc(p)}`));
      L.push(`  added ${added.length}${added.length ? ':' : ''}`); added.forEach(p => L.push(`    ${desc(p)}`));
    }
    prev = { pairs: e.pairs, keys };
  }
  L.push('');
  L.push(`C. MODEL-DRIVEN SMOKE TRIALS (${model.length}); "match" = scenario and fault of a pair in the current selection (${hist.at(-1).sha} set: ${v3.length} pairs)`);
  L.push(`${'start (UTC)'.padEnd(21)}${'end (UTC)'.padEnd(21)}${'model'.padEnd(18)}${'arm'.padEnd(5)}${'break'.padEnd(7)}${'scenario'.padEnd(9)}${'fault'.padEnd(12)}${'state'.padEnd(14)}${'selected pair'.padEnd(16)}outcome`);
  const f = s => s ? s.replace(/\.\d+Z$/, 'Z') : 'n/a';
  for (const t of model) { const mt = matches(t); L.push(`${f(t.start).padEnd(21)}${f(t.end).padEnd(21)}${t.model.padEnd(18)}${t.arm.padEnd(5)}${t.break.padEnd(7)}${(t.repair ? (t.scenarios.join(',') || '-') : t.scenario).padEnd(9)}${(t.repair ? (t.faults.join(',') || '-') : t.fault ?? '-').padEnd(12)}${(t.repair ? 'repair' : t.state).padEnd(14)}${(mt.length ? 'MATCH ' + mt.join(',') : 'no').padEnd(16)}${outcome(t)}`); }
  L.push('');
  const hit = model.filter(t => matches(t).length), pairsHit = [...new Set(hit.flatMap(matches))];
  L.push('D. SUMMARY');
  L.push(`model-driven smoke trials: ${model.length}; first start ${f(model[0].start)}, last end ${f(model.at(-1).end)}; trials that match a pair of the current selection: ${hit.length} (arm C ${hit.filter(t => t.arm === 'C').length}, repair ${hit.filter(t => t.repair).length}, arm-B Behat ${hit.filter(t => t.arm === 'B' && !t.repair).length}); distinct current-selection pairs (scenario+fault) with a model-driven smoke trial: ${pairsHit.length}${pairsHit.length ? ` (${pairsHit.join(', ')})` : ''}.`);
  L.push('');
  L.push('E. EXACT STATEMENTS (derived from sections A to C)');
  const ev = sha => hist.find(e => e.sha === sha), stmt = (sha, label) => { const e = ev(sha); if (!e) return; const n = earlier(e.at), m = n.filter(t => matches(t).length), after = model.filter(t => String(t.start ?? t.end) >= e.at.replace('Z', ''));
    L.push(`${label} (${e.sha}, ${e.at}): ${n.length} model-driven smoke trials had started before this commit (arm C ${n.filter(t => t.arm === 'C').length}, repair sessions ${n.filter(t => t.repair).length}, arm-B Behat runs ${n.filter(t => t.arm === 'B' && !t.repair).length}); ${m.length} of them were on the scenario and fault of a pair of the current selection (${[...new Set(m.flatMap(matches))].join(', ') || 'none'}); ${after.length} started after it.`); };
  stmt('582eda3', 'first selection code (at most 3 per break, strict first)'); stmt('c486e46', 'first report with a SELECTED PAIRS block (15 pairs)'); stmt('c39c627', 'class-i-first-v2'); stmt('f24e1b0', 'class-i-first-v3');
  const sel = sha => ev(sha)?.pairs, drop = (a, b) => sel(a).filter(p => !sel(b).some(q => pairKey(q) === pairKey(p))), plus = (a, b) => sel(b).filter(p => !sel(a).some(q => pairKey(q) === pairKey(p)));
  if (sel('fac5165') && sel('f24e1b0')) { const d = drop('fac5165', 'f24e1b0'), a = plus('fac5165', 'f24e1b0'), n = p => trialsOn(pairKey(p)).length + trialsOnScen(p.scenario).length;
    L.push(`v2 -> v3 amendment: dropped ${d.map(p => `${p.break}.${pairKey(p)}`).join(', ')}; added ${a.map(p => `${p.break}.${pairKey(p)}`).join(', ')}; model-driven smoke trials on the scenario of any of these ${d.length + a.length} pairs: ${[...d, ...a].reduce((x, p) => x + n(p), 0)}.`); }
  if (sel('c486e46') && sel('c39c627')) { const d = drop('c486e46', 'c39c627'), a = plus('c486e46', 'c39c627'), withTrials = d.filter(p => trialsOn(pairKey(p)).length);
    L.push(`first selection (15 pairs) -> v2 (7 pairs): dropped ${d.length}, added ${a.length}; dropped pairs with a model-driven smoke trial on the same scenario and fault: ${withTrials.map(p => `${p.break}.${pairKey(p)} (${trialsOn(pairKey(p)).length} trials)`).join(', ') || 'none'}; added pairs with such a trial: ${a.filter(p => trialsOn(pairKey(p)).length).length}.`); }
  return L.join('\n') + '\n';
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const i = process.argv.indexOf('--data'), paths = ledgerPaths(i > 0 ? process.argv[i + 1] : undefined);
  const text = build(readLines(paths.trials)); writeFileSync(join(repoRoot, 'results/moodle-timeline.txt'), text); console.log(text.split('\n').filter(l => /^D\. |^model-driven/.test(l)).join('\n'));
}
