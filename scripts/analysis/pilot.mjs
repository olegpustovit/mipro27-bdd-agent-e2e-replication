// Pilot (Cypress Real-World App) numbers computed from recorded data only. No value is typed by hand.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zstdDecompressSync } from 'node:zlib';
import { listCampaigns, loadCampaign, trialRows, maintenance } from '../lib/campaign-data.mjs';
import { resourceSummary, usageSummary } from '../study-facts.mjs';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const SOCIAL = ['social-like', 'social-comment'];
export const FAULT_CLASSES = ['supported_detection', 'wrong_reason', 'unsupported_pass', 'no_opportunity', 'action_failure', 'unresolved', 'invalid'];
export const HEALTHY_CLASSES = ['true_pass', 'unsupported_healthy_pass', 'false_alarm', 'action_failure', 'unresolved', 'invalid'];
export const ALL_CLASSES = [...new Set([...FAULT_CLASSES, ...HEALTHY_CLASSES])];
const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

export function readZstJsonl(file) {
  return zstdDecompressSync(fs.readFileSync(file)).toString().split('\n').filter(Boolean).map(JSON.parse);
}
const eventsOf = id => readZstJsonl(path.join(root, 'data/campaigns', id, 'events.jsonl.zst'));

// Tally outcome classes for one kind (healthy/fault). Every class keeps its own count over the same N.
export function classTable(rows, kind) {
  const sel = rows.filter(r => r.kind === kind), order = kind === 'fault' ? FAULT_CLASSES : HEALTHY_CLASSES;
  const counts = Object.fromEntries(order.map(c => [c, 0])); let unclassified = 0, unexpected = {};
  for (const r of sel) {
    if (r.classification === null) unclassified++;
    else if (r.classification in counts) counts[r.classification]++;
    else unexpected[r.classification] = (unexpected[r.classification] || 0) + 1;
  }
  return { kind, n: sel.length, counts, unclassified, unexpected };
}
export function pilotTables() {
  const out = [];
  for (const c of listCampaigns()) {
    const rows = trialRows(c.id);
    for (const arm of ['runtime', 'maintained']) {
      const armRows = rows.filter(r => r.arm === arm);
      if (!armRows.length) continue;
      for (const [scope, keep] of [['all', () => true], ['excluding-social', r => !SOCIAL.includes(r.caseId)]]) {
        const s = armRows.filter(keep);
        out.push({ campaign: c.id, label: c.label, arm, scope, fault: classTable(s, 'fault'), healthy: classTable(s, 'healthy') });
      }
    }
  }
  return out;
}

const parseSelfReport = text => {
  const m = /(\w+) of the available (\w+) shared edits and ran (\w+) validation suites?/i.exec(text || '');
  return m ? { edits: NUM[m[1].toLowerCase()] ?? null, suites: NUM[m[3].toLowerCase()] ?? null } : null;
};
// D1: breakage and repair budgets from three independent raw sources: journal record, event stream, agent ledger.
export function breakage(id) {
  const campaign = loadCampaign(id), events = eventsOf(id), rows = trialRows(id), starts = validationStartsByRevision(id);
  return maintenance(id).map(m => {
    const rec = campaign.journal.find(j => j.type === 'maintenance-finished' && j.record.revision === m.revision).record;
    const ledger = rec.agent?.ledger || [];
    const evEdits = events.filter(e => e.type === 'maintenance-edit' && e.revision === m.revision).length;
    const frozenEv = events.find(e => e.type === 'maintenance-frozen' && e.revision === m.revision);
    const after = rows.filter(r => r.arm === 'maintained' && r.stage === `healthy-${m.revision}-1`);
    const self = parseSelfReport(m.agentFinal);
    return { from: m.from, revision: m.revision, broken: m.initialBroken.length, cases: m.initialCases.length, brokenIds: m.initialBroken.map(x => x.caseId),
      journalEdits: m.edits, journalSuites: m.suites, eventEdits: evEdits, eventFrozenEdits: frozenEv?.edits ?? null, eventFrozenSuites: frozenEv?.validations ?? null,
      eventSuiteStarts: starts[m.revision] ?? 0,
      ledgerRepairCalls: ledger.filter(i => i.type === 'tool-call' && i.name === 'baseline_repair').length,
      ledgerRepairErrors: ledger.filter(i => i.type === 'baseline-tool-error' && i.name === 'baseline_repair').length,
      ledgerValidateCalls: ledger.filter(i => i.type === 'tool-call' && i.name === 'baseline_validate').length,
      selfReport: self, selfReportConflict: self ? (self.edits !== m.edits || self.suites !== m.suites) : null,
      afterPasses: after.filter(x => x.classification === 'true_pass').length, afterTotal: after.length,
      afterReportedPass: after.filter(x => x.reportedStatus === 'pass').length };
  });
}
export function validationStartsByRevision(id) {
  // validation-begin events carry no revision of their own; assign by position between maintenance-begin and maintenance-frozen.
  const counts = {}; let current = null;
  for (const e of eventsOf(id)) {
    if (e.type === 'maintenance-begin') current = e.revision;
    else if (e.type === 'maintenance-frozen') current = null;
    else if (e.type === 'validation-begin' && current) counts[current] = (counts[current] || 0) + 1;
  }
  return counts;
}

const toolCalls = t => t.record.agent?.ledger ? t.record.agent.ledger.filter(i => i.type === 'tool-call').length : null;
const stats = values => {
  const v = values.filter(x => Number.isFinite(x)).sort((a, b) => a - b);
  if (values.length === 0 || v.length !== values.length) return { n: values.length, observed: v.length, sum: v.length === values.length && v.length ? v.reduce((a, b) => a + b, 0) : null, mean: null, median: null, observedSum: v.length ? v.reduce((a, b) => a + b, 0) : null };
  const sum = v.reduce((a, b) => a + b, 0), mid = Math.floor(v.length / 2);
  return { n: v.length, observed: v.length, sum, mean: sum / v.length, median: v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2, observedSum: sum };
};
export function adjudicationUsage(id) {
  const file = path.join(root, 'provenance/adjudication', `${id}.codex-rollout.jsonl.zst`);
  if (!fs.existsSync(file)) return null;
  const ev = readZstJsonl(file);
  const totals = ev.filter(e => e.payload?.type === 'token_count' && e.payload.info?.total_token_usage).map(e => e.payload.info.total_token_usage);
  const last = totals.reduce((a, b) => (b.total_tokens > (a?.total_tokens ?? -1) ? b : a), null);
  const ts = ev.map(e => Date.parse(e.timestamp)).filter(Number.isFinite);
  const start = ev.find(e => e.payload?.type === 'task_started'), end = ev.findLast(e => e.payload?.type === 'task_complete');
  return {
    tokens: last ? { input: last.input_tokens ?? null, cachedInput: last.cached_input_tokens ?? null, cacheWrite: last.cache_write_input_tokens ?? null, output: last.output_tokens ?? null, reasoningOutput: last.reasoning_output_tokens ?? null, total: last.total_tokens ?? null } : null,
    wallMs: ts.length > 1 ? Math.max(...ts) - Math.min(...ts) : null,
    taskMs: start && end ? Date.parse(end.timestamp) - Date.parse(start.timestamp) : null,
    toolCalls: ev.filter(e => e.payload?.type === 'custom_tool_call').length,
    model: 'gpt-5.6-terra (reasoning high; REPRODUCE.md section 3)',
  };
}
export function resources() {
  return listCampaigns().map(c => {
    const raw = loadCampaign(c.id).trials, out = { campaign: c.id, label: c.label, arms: {} };
    for (const arm of ['runtime', 'maintained']) {
      const t = raw.filter(x => x.record.trial.arm === arm); if (!t.length) continue;
      const summary = resourceSummary(t);
      out.arms[arm] = { ...summary, wall: stats(t.map(x => x.record.elapsedMs)), recordedWall: stats(t.filter(x => x.result === 'recorded').map(x => x.record.elapsedMs)),
        toolCalls: arm === 'runtime' ? stats(t.map(toolCalls)) : null, agentTimeMs: arm === 'runtime' ? stats(t.map(x => x.record.agent?.elapsedMs)) : null };
    }
    out.repairs = maintenance(c.id).map(m => {
      const rec = loadCampaign(c.id).journal.find(j => j.type === 'maintenance-finished' && j.record.revision === m.revision).record;
      return { revision: m.revision, maintenanceElapsedMs: m.elapsedMs, agentElapsedMs: rec.agent?.elapsedMs ?? null, usage: usageSummary([m.usage]), toolCalls: rec.agent?.ledger ? rec.agent.ledger.filter(i => i.type === 'tool-call').length : null };
    });
    out.adjudication = adjudicationUsage(c.id);
    return out;
  });
}
