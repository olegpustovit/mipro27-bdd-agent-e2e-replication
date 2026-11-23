#!/usr/bin/env node
// Budget projection for the measured Moodle campaign, from the smoke trials in the ledger (nothing is run, no model is called).
//   node scripts/moodle/budget.mjs [--plan <planShort>[,...]] [--workers 3] [--reps 2]  -> results/moodle-budget.txt
// Trial counts come from the real plan generator (campaignTrials, repairJobs) over the SELECTED PAIRS of the V1 report.
// Tokens per run = inputTokens + outputTokens as reported (input includes cache reads), the unit of the pilot references.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readLines } from '../ledger/jsonl.mjs';
import { ledgerPaths } from '../ledger/paths.mjs';
import { repoRoot } from '../../adapters/moodle/config.mjs';
import { campaignTrials, repairJobs } from './campaign.mjs';
import { selectedPairs as selectedPairsFromReport, SELECTION_RULE, selectionCounts, fmtCounts } from './v1-report.mjs';
import { collectTrials } from '../analysis/moodle.mjs';

export const MODELS = ['gpt-6-luna', 'gpt-5.6-terra', 'claude-haiku-5-5'];
export const MODEL_LABEL = { 'gpt-6-luna': 'luna', 'gpt-5.6-terra': 'terra', 'claude-haiku-5-5': 'haiku (omp)' };
// Pilot references computed from results/pilot-resources.txt: tokens (total) / executions, mean wall ms.
//   luna = campaigns A+B (216 executions: 14487734 + 13949843 tokens; wall 2789508 + 2685301 ms); terra = campaign C; haiku = campaign D.
export const PILOT = {
  'gpt-6-luna': { tokens: (14487734 + 13949843) / 216, wallMs: (2789508 + 2685301) / 216 },
  'gpt-5.6-terra': { tokens: 24288760 / 108, wallMs: 5582866 / 108 },
  'claude-haiku-5-5': { tokens: 40418404 / 108, wallMs: 6496883 / 108 },
};
const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const tok = t => (t.body.meter?.inputTokens ?? null) == null || t.body.meter?.outputTokens == null ? null : t.body.meter.inputTokens + t.body.meter.outputTokens;
const wallOf = t => t.body.meter?.wall?.totalMs ?? null;

// The binding budget: the original cap of 240M tokens for the whole measured campaign (arm-C sessions and repair sessions of all models). The 2x per-run criterion below is reported, not binding.
export const TOKEN_CAP = 240e6;
export const selectedPairs = (path = join(repoRoot, 'results/moodle-v1-reproduction.jsonl')) => selectedPairsFromReport(path).map(p => ({ break: p.break, fault: p.fault, scenario: p.scenario }));

// Smoke means per model from ledger trials: arm C per run (tokens, wall), arm B scenario run (wall; no tokens), arm A run (wall), repair session (tokens, wall).
export function smokeMeans(trials, { repairPlans = null } = {}) {
  const out = {};
  for (const model of MODELS) {
    const c = trials.filter(t => t.kind === 'smoke' && t.arm === 'C' && t.model === model && !t.caseId.endsWith('.repair'));
    const r = trials.filter(t => t.caseId.endsWith('.repair') && t.model === model && ['smoke', 'repair'].includes(t.kind) && (!repairPlans || repairPlans.includes(t.short)));
    const b = trials.filter(t => t.kind === 'smoke' && t.arm === 'B' && t.model === model && !t.caseId.endsWith('.repair'));
    out[model] = { c: { n: c.length, tokens: mean(c.map(tok).filter(Number.isFinite)), wallMs: mean(c.map(wallOf).filter(Number.isFinite)), tools: mean(c.map(t => t.body.toolCalls).filter(Number.isFinite)) },
      r: { n: r.length, tokens: mean(r.map(tok).filter(Number.isFinite)), wallMs: mean(r.map(wallOf).filter(Number.isFinite)) },
      b: { n: b.length, wallMs: mean(b.map(wallOf).filter(Number.isFinite)) } };
  }
  out.A = { wallMs: mean(trials.filter(t => t.kind === 'smoke' && t.arm === 'A').map(wallOf).filter(Number.isFinite)) };
  return out;
}

export function project({ pairs, means, workers = 3, reps = 2, models = MODELS }) {
  const short = 'projection', counts = {};
  const trialsBC = campaignTrials({ pairs, short, arms: ['B', 'C'], models, reps }), trialsA = campaignTrials({ pairs, short, arms: ['A'], models, reps });
  const repairs = repairJobs({ pairs, models, reps });
  counts.pairs = pairs.length; counts.breaks = new Set(pairs.map(p => p.break)).size;
  counts.states = 2; counts.arms = 2; counts.models = models.length; counts.reps = reps;
  counts.trialsBC = trialsBC.length; counts.trialsA = trialsA.length; counts.repairs = repairs.length;
  const perModel = {};
  let seconds = 0;
  for (const model of models) {
    const m = means[model], nC = trialsBC.filter(t => t.arm === 'C' && t.model === model).length, nB = trialsBC.filter(t => t.arm === 'B' && t.model === model).length, nR = repairs.filter(j => j.model === model).length;
    const tokensC = nC * m.c.tokens, tokensR = nR * m.r.tokens;
    const wallC = nC * m.c.wallMs, wallB = nB * m.b.wallMs, wallR = nR * m.r.wallMs;
    perModel[model] = { nC, nB, nR, tokensC, tokensR, tokens: tokensC + tokensR, wallMs: wallC + wallB + wallR, perRunC: m.c.tokens, perSession: (tokensC + tokensR) / (nC + nR), perRepair: m.r.tokens, ratioC: m.c.tokens / PILOT[model].tokens, ratioAll: ((tokensC + tokensR) / (nC + nR)) / PILOT[model].tokens, ratioWallC: m.c.wallMs / PILOT[model].wallMs };
    seconds += perModel[model].wallMs / 1000;
  }
  const aMs = counts.trialsA * means.A.wallMs; seconds += aMs / 1000;   // arm A: deterministic baseline, one run per pair and state
  const out = { counts, perModel, armAMs: aMs, totalSeconds: seconds, parallelSeconds: seconds / workers, workers };
  return out;
}

export function render(p, means) {
  const f = (v, d = 0) => v == null ? 'null' : Number(v).toFixed(d), k = v => f(v / 1000, 1) + 'k', h = s => `${f(s / 3600, 2)} h`;
  const c = p.counts, L = [];
  L.push('Moodle measured-campaign BUDGET PROJECTION (computed from smoke trials; smoke is NOT measured; nothing here ran a model)');
  L.push('');
  L.push('Formula');
  L.push('  agent arm-C trials  = pairs x states x models x reps');
  L.push(`                      = ${c.pairs} x ${c.states} x ${c.models} x ${c.reps} = ${c.pairs * c.states * c.models * c.reps}`);
  L.push('  arm-B trials        = pairs x states x models x reps (Behat runs of the repaired step code; no model tokens)');
  L.push(`                      = ${c.pairs} x ${c.states} x ${c.models} x ${c.reps} = ${c.pairs * c.states * c.models * c.reps}`);
  L.push('  repair sessions     = distinct breaks x models x reps (one LLM repair per break, model, repetition; trials of the same break reuse it)');
  L.push(`                      = ${c.breaks} x ${c.models} x ${c.reps} = ${c.breaks * c.models * c.reps}`);
  L.push(`  arm-A trials        = pairs x states = ${c.pairs} x ${c.states} = ${c.trialsA} (deterministic developer tests, one run, no model)`);
  L.push(`  generator check     : campaignTrials(arms B,C) = ${c.trialsBC}; campaignTrials(arm A) = ${c.trialsA}; repairJobs = ${c.repairs}`);
  L.push(`  model-driven sessions = arm-C ${c.pairs * c.states * c.models * c.reps} + repairs ${c.repairs} = ${c.pairs * c.states * c.models * c.reps + c.repairs}`);
  L.push('');
  L.push('Smoke means used (tokens = input + output as reported, input includes cache reads)');
  for (const m of MODELS) { const s = means[m]; L.push(`  ${MODEL_LABEL[m].padEnd(12)} arm C: n=${s.c.n}, ${k(s.c.tokens)} tokens/run, ${f(s.c.wallMs / 1000, 1)} s, ${f(s.c.tools, 1)} tool calls; repair: n=${s.r.n}, ${k(s.r.tokens)} tokens, ${f(s.r.wallMs / 1000, 1)} s; arm-B Behat run: n=${s.b.n}, ${f(s.b.wallMs / 1000, 1)} s`); }
  L.push(`  arm A Behat run: ${f(means.A.wallMs / 1000, 1)} s`);
  L.push(`  repair means: smoke repair sessions of plan(s) ${means.repairPlans ?? 'all smoke plans'} under the 10-edit / 12-run budget (their breaks were B01 and B12; the selection's repairs are for other breaks, so the repair share is an approximation); arm-C means: every smoke arm-C trial in the ledger.`);
  L.push('');
  L.push('Projected tokens per model');
  L.push(`  ${'model'.padEnd(12)}${'C runs'.padEnd(8)}${'repairs'.padEnd(9)}${'C tokens'.padEnd(11)}${'repair tokens'.padEnd(15)}${'total'.padEnd(10)}wall (sequential)`);
  let total = 0;
  for (const m of MODELS) { const x = p.perModel[m]; total += x.tokens; L.push(`  ${MODEL_LABEL[m].padEnd(12)}${String(x.nC).padEnd(8)}${String(x.nR).padEnd(9)}${(f(x.tokensC / 1e6, 2) + 'M').padEnd(11)}${(f(x.tokensR / 1e6, 2) + 'M').padEnd(15)}${(f(x.tokens / 1e6, 2) + 'M').padEnd(10)}${h(x.wallMs / 1000)}`); }
  L.push(`  total ${f(total / 1e6, 2)}M tokens`);
  L.push('');
  L.push(`Wall time with ${p.workers} parallel workers: (sum of model-model wall + arm A ${h(p.armAMs / 1000)}) / ${p.workers} = ${h(p.totalSeconds)} / ${p.workers} = ${h(p.parallelSeconds)} (ideal packing; fixture reset and hand-off are inside the per-trial walls; one worker per Moodle site, a worker runs one job at a time)`);
  L.push('');
  L.push('Check: projected tokens per run <= 2x pilot mean per model');
  L.push(`  ${'model'.padEnd(12)}${'pilot/run'.padEnd(11)}${'2x pilot'.padEnd(11)}${'arm-C smoke/run'.padEnd(17)}${'ratio'.padEnd(8)}${'sessions incl. repairs'.padEnd(24)}${'ratio'.padEnd(8)}verdict (arm-C per run)`);
  for (const m of MODELS) { const x = p.perModel[m], pil = PILOT[m]; L.push(`  ${MODEL_LABEL[m].padEnd(12)}${k(pil.tokens).padEnd(11)}${k(2 * pil.tokens).padEnd(11)}${k(x.perRunC).padEnd(17)}${(f(x.ratioC, 2) + 'x').padEnd(8)}${k(x.perSession).padEnd(24)}${(f(x.ratioAll, 2) + 'x').padEnd(8)}${x.ratioC <= 2 ? 'WITHIN 2x' : 'EXCEEDS 2x'}`); }
  L.push(`  wall per arm-C run vs pilot: ${MODELS.map(m => `${MODEL_LABEL[m]} ${f(p.perModel[m].ratioWallC, 2)}x`).join(', ')}`);
  const grand = MODELS.reduce((a, m) => a + p.perModel[m].tokens, 0), exceed = MODELS.filter(m => p.perModel[m].ratioC > 2);
  L.push('');
  L.push(`The 2x per-run criterion is ${exceed.length ? `NOT MET for ${exceed.map(m => `${MODEL_LABEL[m].replace(' (omp)', '')} (${f(p.perModel[m].ratioC, 2)}x)`).join(' and ')}` : 'met for every model'}; it is met for ${MODELS.filter(m => !exceed.includes(m)).map(m => `${MODEL_LABEL[m].replace(' (omp)', '')} (${f(p.perModel[m].ratioC, 2)}x)`).join(', ') || 'no model'}. The paper must say so. Reducing the number of pairs does not change tokens per run, so the earlier pair-count scope rule (15 -> 13 pairs; docs/contracts/moodle-campaign.md, history) did not address this criterion and is dropped.`);
  L.push('');
  L.push(`BINDING BUDGET CHECK: original cap ${f(TOKEN_CAP / 1e6, 0)}M tokens in total`);
  L.push(`  projected total ${f(grand / 1e6, 2)}M = ${f(100 * grand / TOKEN_CAP, 1)}% of the cap; headroom ${f((TOKEN_CAP - grand) / 1e6, 2)}M; ${grand <= TOKEN_CAP ? 'WITHIN the cap' : 'EXCEEDS the cap'} (arm-C sessions ${f(MODELS.reduce((a, m) => a + p.perModel[m].tokensC, 0) / 1e6, 2)}M + repair sessions ${f(MODELS.reduce((a, m) => a + p.perModel[m].tokensR, 0) / 1e6, 2)}M; arms A and B run Behat only and use no model tokens)`);
  if (p.selection) {
    L.push('');
    L.push(`Pair selection ${SELECTION_RULE.id} (the v3 rule was committed after model-driven smoke trials, listed in results/moodle-timeline.txt; scripts/moodle/v1-report.mjs): class (i) first, all valid class (i) pairs at most ${SELECTION_RULE.perBreakI} per break, no two pairs share the same fault and scenario; then class (ii) pairs at most ${SELECTION_RULE.perBreakII} per break up to ${SELECTION_RULE.total} in total; step rule ${SELECTION_RULE.stepRule}.`);
    L.push(`  ${p.selection.pairs.length} pairs selected (${fmtCounts(p.selection.counts)})`);
    for (const x of p.selection.pairs) L.push(`  ${x.break}.${x.fault}@${x.scenario}  ${x.class}  ${x.bite}  ${x.origin}`);
    L.push(`  Replaces: ${SELECTION_RULE.replaces}.`);
  }
  return L.join('\n') + '\n';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n, d) => process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d;
  const trials = collectTrials(readLines(ledgerPaths().trials), { plan: arg('plan', null) }), rp = arg('repair-plan', null), means = smokeMeans(trials, { repairPlans: rp ? rp.split(',') : null }); means.repairPlans = rp;
  const all = selectedPairs(), workers = Number(arg('workers', 3)), reps = Number(arg('reps', 2));
  const p = project({ pairs: all, means, workers, reps }), sel = selectedPairsFromReport();
  p.selection = { pairs: sel.map(x => ({ break: x.break, fault: x.fault, scenario: x.scenario, class: `class ${x.class}`, bite: x.valid_strict ? 'strict' : 'core', origin: x.origin })), counts: selectionCounts(sel, sel.breaks) };
  const text = render(p, means); writeFileSync(join(repoRoot, 'results/moodle-budget.txt'), text); console.log(text);
}
