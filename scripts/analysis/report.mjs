// Renders the pilot result files. Every number comes from code in pilot.mjs / agreement.mjs.
import fs from 'node:fs';
import { listCampaigns, loadCampaign, trialRows, maintenance } from '../lib/campaign-data.mjs';
import { pilotTables, breakage, resources, root, SOCIAL } from './pilot.mjs';
import { agreement, renderAgreement } from './agreement.mjs';

const f = x => x === null || x === undefined ? 'null' : Number.isInteger(x) ? String(x) : x.toFixed(1);
const frac = (a, n) => `${a}/${n}`;
export function renderTables() {
  const L = ['Pilot headline tables (Cypress Real-World App; exploratory-owner-directed; Evidence gate STOP; no gate pass).',
    'Every table is given twice: all 12 scenarios, and excluding the 2 social scenarios (social-like, social-comment), whose target transaction ID is hidden and only reachable through a test hook.',
    'Each outcome class is its own count over the same denominator (fault runs or healthy runs). Classes are LLM-reviewer (judge1) classifications. Repeated executions of one app are not independent systems.', ''];
  for (const t of pilotTables()) {
    L.push(`== Campaign ${t.label} (${t.campaign}) arm=${t.arm === 'runtime' ? 'agent (runtime)' : 'step definitions (maintained)'} scope=${t.scope} ==`);
    for (const k of ['fault', 'healthy']) {
      const x = t[k]; L.push(`${k} runs N=${x.n}: ` + Object.entries(x.counts).map(([c, n]) => `${c} ${frac(n, x.n)}`).join('; ') + (x.unclassified ? `; UNCLASSIFIED ${x.unclassified}` : '') + (Object.keys(x.unexpected).length ? `; UNEXPECTED ${JSON.stringify(x.unexpected)}` : ''));
    }
    L.push('');
  }
  L.push('== Step-definition breakage and repair, from raw records (campaign A) ==');
  for (const c of listCampaigns().filter(c => c.label === 'A'))
    for (const b of breakage(c.id)) {
      L.push(`UI ${b.from}->${b.revision}: step definitions broke ${frac(b.broken, b.cases)} (${b.brokenIds.join(', ')})`,
        `  accepted edits: journal ${b.journalEdits}/10; event stream ${b.eventEdits}/10 (maintenance-frozen says ${b.eventFrozenEdits}); agent ledger: ${b.ledgerRepairCalls} baseline_repair calls of which ${b.ledgerRepairErrors} errored`,
        `  validation suites: journal ${b.journalSuites}/12; event stream validation-begin ${b.eventSuiteStarts}/12; agent ledger lists ${b.ledgerValidateCalls} baseline_validate calls (ledger is ${b.journalSuites - b.ledgerValidateCalls} short of the journal/event count; journal and event stream agree, so they are the record)`,
        `  self-report conflict: ${b.selfReport ? `agent final message claims ${b.selfReport.edits} edits and ${b.selfReport.suites} suites; ${b.selfReportConflict ? 'CONFLICTS with the record (' + b.journalEdits + ' edits, ' + b.journalSuites + ' suites). The record is authoritative.' : 'matches the record'}` : 'final message gives no counts'}`,
        `  healthy step-definition passes right after repair (stage healthy-${b.revision}-1): ${frac(b.afterPasses, b.afterTotal)} true_pass; reported pass ${frac(b.afterReportedPass, b.afterTotal)}`);
    }
  return L.join('\n') + '\n';
}

const tok = u => `input ${f(u.input)}; cached ${f(u.cachedInput)}; cache-write ${f(u.cacheWriteInput)}; output ${f(u.output)}; total ${f(u.total)}` + (u.input === null || u.cachedInput === null ? ` (partial observed: input ${f(u.observedInput)}, output ${f(u.observedOutput)})` : '');
const st = s => s ? `n=${s.n} observed=${s.observed} sum=${f(s.sum)} mean=${f(s.mean)} median=${f(s.median)}` : 'null (not applicable: no agent)';
export function renderResources() {
  const L = ['Pilot per-campaign resources. Unknown is null, never 0. Tokens are usage counters, not billed charges. Times are phase wall times (record.elapsedMs / maintenance elapsedMs), not full campaign wall time.',
    'Median: mean of the two middle values for even n. Construction cost of the step definitions, harness engineering and human labour are unmeasured.', ''];
  for (const c of resources()) {
    L.push(`== Campaign ${c.label} (${c.campaign}) ==`);
    for (const [arm, a] of Object.entries(c.arms)) {
      L.push(`arm ${arm === 'runtime' ? 'agent (runtime)' : 'step definitions (maintained)'}: ${a.trials} executions, ${a.recorded} recorded, ${a.otherResults} other`,
        `  tokens (all executions): ${tok(a.usage)}`,
        `  wall ms, all executions: ${st(a.wall)}; recorded only: ${st(a.recordedWall)}`,
        `  agent session ms: ${a.agentTimeMs ? st(a.agentTimeMs) : 'null (not applicable)'}`,
        `  tool calls (MCP browser calls per execution): ${a.toolCalls ? st(a.toolCalls) : 'null (step definitions make no model tool calls)'}`);
    }
    for (const r of c.repairs) L.push(`repair session ${r.revision}: tokens ${tok(r.usage)}; maintenance-phase ms ${f(r.maintenanceElapsedMs)}; agent session ms ${f(r.agentElapsedMs)}; tool calls ${f(r.toolCalls)}`);
    if (!c.repairs.length) L.push('repair sessions: none recorded in this campaign (runtime-only rerun against campaign A frozen step code; repairs not repeated)');
    const a = c.adjudication;
    L.push(a ? `adjudication (reviewer session, rollout): tokens ${a.tokens ? `input ${f(a.tokens.input)}; cached ${f(a.tokens.cachedInput)}; cache-write ${f(a.tokens.cacheWrite)}; output ${f(a.tokens.output)}; reasoning-output ${f(a.tokens.reasoningOutput)}; total ${f(a.tokens.total)}` : 'null'}; session wall ms ${f(a.wallMs)}; tool calls ${f(a.toolCalls)}; ${a.model}` : 'adjudication: null (no rollout)', '');
  }
  return L.join('\n') + '\n';
}

// Lines in the committed recovered outputs that are wrong; the files stay byte-identical, this file supersedes them.
export function renderSuperseded() {
  const L = ['Superseded lines in the original recovered outputs. The originals are kept unchanged as history; do not quote these lines.', ''];
  const A = listCampaigns().find(c => c.label === 'A').id, br = breakage(A), correct = Object.fromEntries(br.map(b => [b.revision, b]));
  for (const file of fs.readdirSync(`${root}results`).filter(n => /\.(analysis|derived)\.txt$/.test(n)).sort()) {
    const lines = fs.readFileSync(`${root}results/${file}`, 'utf8').split('\n');
    lines.forEach((line, i) => {
      let m;
      if ((m = /^  initial suite: (.*)$/.exec(line))) L.push(`${file}:${i + 1}\n  old: ${line.trim()}\n  why wrong: reads step-definition failures from a field that does not exist, so every scenario prints P.\n  superseded by: broke ${frac(correct[lines[i - 1].match(/->(v\d)/)[1]].broken, 12)} (raw initialValidation, see pilot-tables.txt)`);
      else if ((m = /^Initial suite after change to (v\d): 0\/12/.exec(line))) { const b = correct[m[1]]; L.push(`${file}:${i + 1}\n  old: ${line.slice(0, 60)}...\n  why wrong: regex looks for passed/status keys the records do not have, so it always prints 0/12.\n  superseded by: ${frac(b.cases - b.broken, b.cases)} passing, ${frac(b.broken, b.cases)} broken${b.broken === 12 ? ' (old value 0/12 is numerically right here by accident)' : ''}`); }
    });
  }
  L.push('', 'Also note (not erroneous, but easy to misquote): derived.txt "Hybrid replay" counts only recorded trials (infrastructure-invalid trials are omitted from its n); the recovered scripts use the upper-middle median where an even-n median is needed, while analysis outputs here use the mean of the two middle values.');
  return L.join('\n') + '\n';
}
export { renderAgreement, agreement };
