// results/paper-numbers.txt: every number the paper may quote, one per line, with generating script and source file.
// Format: id | value | script | source | abstract claim | status
// Abstract claims are those given to this lane by the owner brief (the abstract text itself is not in this repository);
// numbers without a stated abstract claim say "no abstract claim" and are not checked.
import fs from 'node:fs';
import { listCampaigns, loadCampaign, maintenance } from '../lib/campaign-data.mjs';
import { pilotTables, breakage, resources, root } from './pilot.mjs';

const SCRIPT = 'scripts/analysis/pilot.mjs';
const CLAIMS = {
  'A.step.all.detections': '48/48',
  'B.agent.all.detections': '40/48', 'B.agent.all.true_pass': '50/60', 'B.agent.all.false_alarms': '0',
  'C.agent.all.detections': '40/48', 'C.agent.all.true_pass': '50/60', 'C.agent.all.false_alarms': '0',
  'D.agent.all.detections': '43/48', 'D.agent.all.true_pass': '49/60', 'D.agent.all.false_alarms': '4',
  'repair.v1.edits': '2/10', 'repair.v1.suites': '3/12', 'repair.v1.broke': '12/12', 'repair.v1.healthy_after': '5/12',
  'repair.v2.edits': '5/10', 'repair.v2.suites': '6/12', 'repair.v2.broke': '8/12', 'repair.v2.healthy_after': '12/12',
};
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
export function pilotNumbers() {
  const rows = [], add = (id, value, source, script = SCRIPT) => rows.push({ id, value: String(value), script, source });
  const tables = pilotTables(), res = resources(), data = c => `data/campaigns/${c}/{trials.jsonl.zst,adjudication.jsonl}`;
  for (const t of tables) {
    const key = `${t.label}.${t.arm === 'runtime' ? 'agent' : 'step'}.${t.scope === 'all' ? 'all' : 'nosocial'}`;
    const F = t.fault, H = t.healthy;
    add(`${key}.detections`, `${F.counts.supported_detection}/${F.n}`, data(t.campaign));
    add(`${key}.true_pass`, `${H.counts.true_pass}/${H.n}`, data(t.campaign));
    add(`${key}.false_alarms`, H.counts.false_alarm, data(t.campaign));
    add(`${key}.false_alarms_of`, `${H.counts.false_alarm}/${H.n}`, data(t.campaign));
    for (const c of ['action_failure', 'no_opportunity', 'unsupported_pass', 'wrong_reason', 'unresolved', 'invalid']) if (F.counts[c] || c === 'action_failure') add(`${key}.fault.${c}`, `${F.counts[c]}/${F.n}`, data(t.campaign));
    for (const c of ['action_failure', 'unsupported_healthy_pass', 'unresolved', 'invalid']) add(`${key}.healthy.${c}`, `${H.counts[c]}/${H.n}`, data(t.campaign));
  }
  const A = listCampaigns().find(c => c.label === 'A').id;
  for (const b of breakage(A)) {
    const p = `repair.${b.revision}`, src = `data/campaigns/${A}/journal.jsonl,events.jsonl.zst`;
    add(`${p}.broke`, `${b.broken}/${b.cases}`, src); add(`${p}.edits`, `${b.journalEdits}/10`, src); add(`${p}.suites`, `${b.journalSuites}/12`, src);
    add(`${p}.healthy_after`, `${b.afterPasses}/${b.afterTotal}`, `data/campaigns/${A}/{trials.jsonl.zst,adjudication.jsonl}`);
    if (b.selfReport) add(`${p}.self_report_edits_CONFLICT`, `${b.selfReport.edits} (record: ${b.journalEdits})`, src);
  }
  for (const r of res) {
    const k = r.label, src = `data/campaigns/${r.campaign}/trials.jsonl.zst`;
    for (const [arm, a] of Object.entries(r.arms)) {
      const n = `${k}.${arm === 'runtime' ? 'agent' : 'step'}`, u = a.usage;
      add(`${n}.tokens.input`, u.input, src); add(`${n}.tokens.cached`, u.cachedInput, src); add(`${n}.tokens.cache_write`, u.cacheWriteInput, src); add(`${n}.tokens.output`, u.output, src); add(`${n}.tokens.total`, u.total, src);
      add(`${n}.wall_ms.sum`, a.wall.sum, src); add(`${n}.wall_ms.mean_recorded`, a.recordedWall.mean, src); add(`${n}.wall_ms.median_recorded`, a.recordedWall.median, src);
      if (a.toolCalls) { add(`${n}.tool_calls.sum`, a.toolCalls.sum, src); add(`${n}.tool_calls.mean`, a.toolCalls.mean, src); add(`${n}.tool_calls.median`, a.toolCalls.median, src); }
    }
    for (const rp of r.repairs) { const n = `${k}.repair.${rp.revision}`; add(`${n}.tokens.total`, rp.usage.total, `data/campaigns/${r.campaign}/journal.jsonl`); add(`${n}.maintenance_ms`, rp.maintenanceElapsedMs, `data/campaigns/${r.campaign}/journal.jsonl`); add(`${n}.agent_ms`, rp.agentElapsedMs, `data/campaigns/${r.campaign}/journal.jsonl`); add(`${n}.tool_calls`, rp.toolCalls, `data/campaigns/${r.campaign}/journal.jsonl`); }
    if (r.adjudication) { const a = r.adjudication, s = `provenance/adjudication/${r.campaign}.codex-rollout.jsonl.zst`; add(`${k}.adjudication.tokens.total`, a.tokens?.total ?? null, s); add(`${k}.adjudication.tokens.input`, a.tokens?.input ?? null, s); add(`${k}.adjudication.tokens.output`, a.tokens?.output ?? null, s); add(`${k}.adjudication.wall_ms`, a.wallMs, s); add(`${k}.adjudication.tool_calls`, a.toolCalls, s); }
    // Derived break-even (same formulas as provenance/orchestration/derived.mjs; derived, never observations).
    const rt = loadCampaign(r.campaign).trials.filter(t => t.record.trial.arm === 'runtime' && t.result === 'recorded');
    const mt = loadCampaign(A).trials.filter(t => t.record.trial.arm === 'maintained' && t.result === 'recorded');
    const tk = t => t.record.agent.usage.input_tokens + t.record.agent.usage.output_tokens;
    const suiteTok = Math.round(12 * mean(rt.map(tk))), suiteMin = 12 * mean(rt.map(t => t.record.elapsedMs)) / 60000, scriptMin = 12 * mean(mt.map(t => t.record.elapsedMs)) / 60000;
    const repairs = maintenance(A), repairTok = mean(repairs.map(m => m.tokens)), repairMs = mean(repairs.map(m => m.elapsedMs)), dMs = 12 * (mean(rt.map(t => t.record.elapsedMs)) - mean(mt.map(t => t.record.elapsedMs)));
    const d = 'scripts/analysis/paper-numbers.mjs (formulas of provenance/orchestration/derived.mjs)', dsrc = `results/${r.campaign}.derived.txt`;
    add(`${k}.derived.agent_suite_tokens_per_12`, suiteTok, dsrc, d); add(`${k}.derived.agent_suite_minutes_per_12`, suiteMin.toFixed(1), dsrc, d); add(`${k}.derived.script_suite_minutes_per_12`, scriptMin.toFixed(1), dsrc, d);
    add(`${k}.derived.repair_tokens_mean`, Math.round(repairTok), dsrc, d); add(`${k}.derived.repair_minutes_mean`, (repairMs / 60000).toFixed(1), dsrc, d);
    add(`${k}.derived.repair_equals_agent_suites_tokens`, (repairTok / suiteTok).toFixed(1), dsrc, d); add(`${k}.derived.repair_equals_suite_runs_time`, (repairMs / dMs).toFixed(1), dsrc, d);
  }
  return rows;
}
// Cross-check against the original recovered derived outputs: they must agree with the recomputation.
export function derivedCrossCheck(rows) {
  const out = [];
  for (const c of listCampaigns()) {
    const f = `${root}results/${c.id}.derived.txt`; if (!fs.existsSync(f)) continue;
    const text = fs.readFileSync(f, 'utf8'), m = /Per 12-scenario suite run: agent (\d+) tokens.*?, ([\d.]+) min sequential; scripts 0 tokens, ([\d.]+) min/.exec(text);
    const v = id => rows.find(r => r.id === `${c.label}.derived.${id}`)?.value;
    out.push([c.label, m && m[1] === v('agent_suite_tokens_per_12') && m[2] === v('agent_suite_minutes_per_12') && m[3] === v('script_suite_minutes_per_12')]);
  }
  return out;
}
export function renderPaperNumbers() {
  const rows = pilotNumbers(), L = ['Numbers the paper may quote (pilot, Cypress Real-World App). Status: exploratory-owner-directed; Evidence gate STOP; no gate pass. Say so wherever these are quoted.',
    'Format: id | value | generating script | source file | abstract claim | status.  null = unknown, never zero.  Classes are judge1 (LLM reviewer) classifications; see results/judge-agreement.txt for the second judge.',
    'Abstract claims below are the ones in the owner brief (the accepted abstract text is not in this repository). Token/time comparisons: abstract values not available to this lane, so derived values are listed as "no abstract claim" for the owner to compare.', ''];
  let confirmed = 0, differs = 0;
  for (const r of rows) {
    const claim = CLAIMS[r.id] ?? null;
    let status = 'no abstract claim';
    if (claim !== null) { const ok = claim === r.value; status = ok ? 'CONFIRMED exactly' : `DIFFERS (data: ${r.value})`; ok ? confirmed++ : differs++; }
    L.push([r.id, r.value, r.script, r.source, claim ?? '-', status].join(' | '));
  }
  const x = derivedCrossCheck(rows);
  L.push('', `Abstract claims checked: ${confirmed + differs}; confirmed exactly: ${confirmed}; differ: ${differs}.`,
    `Self-report conflict: the first repair agent's final message says three edits; the journal, the event stream and maintenance-frozen all say 2 accepted edits. 2/10 is the recorded value.`,
    `Recomputed break-even inputs match the original derived.txt "Per 12-scenario suite run" lines: ${x.map(([l, ok]) => `${l} ${ok ? 'yes' : 'NO'}`).join(', ')}.`);
  return L.join('\n') + '\n';
}
