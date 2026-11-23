// Builds the blinded packet for one pilot trial. The judge sees: scenario text, fault definition (fault stages only),
// the execution trace, and the observer evidence. It never sees the arm label, the first reviewer's verdict,
// the trial id/stage (they carry the arm) or any other trial.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { listCampaigns, loadCampaign } from '../lib/campaign-data.mjs';
import { faults } from '../mutations.mjs';
import { cases } from '../../study/manifest.mjs';

const feature = fs.readFileSync(new URL('../../study/scenarios.feature', import.meta.url), 'utf8');
export const FAULT_CLASSES = ['supported_detection', 'wrong_reason', 'unsupported_pass', 'no_opportunity', 'action_failure', 'unresolved', 'invalid'];
export const HEALTHY_CLASSES = ['true_pass', 'unsupported_healthy_pass', 'false_alarm', 'action_failure', 'unresolved', 'invalid'];
export const opaqueId = (campaign, trialId) => createHash('sha256').update(`judge2-v1:${campaign}:${trialId}`).digest('hex').slice(0, 16);

export function scenarioText(caseId) {
  const lines = feature.split('\n'), i = lines.findIndex(l => l.trim() === `@${caseId}`);
  if (i < 0) throw new Error(`Scenario not found: ${caseId}`);
  const out = [];
  for (let j = i + 1; j < lines.length && !lines[j].trim().startsWith('@'); j++) out.push(lines[j]);
  return out.join('\n').trim();
}
const cut = (s, n) => { s = String(s ?? ''); return s.length > n ? `${s.slice(0, n)} ...[truncated ${s.length - n} chars]` : s; };
const stripStack = s => String(s ?? '').split('\n').filter(l => !/^\s+at .*(\(|:\d+)/.test(l)).join('\n').replace(/\/tmp\/[\w.-]+\//g, '');

export function buildPacket(campaignId, entry, { resultChars = 3000, maxTraceChars = 60000 } = {}) {
  const r = entry.record, t = r.trial, lines = [];
  const c = cases.find(x => x.id === t.caseId);
  lines.push('## Scenario', scenarioText(t.caseId), '', `Expected observable outcome: ${c.expected}`, '', `Stage type: ${t.kind === 'fault' ? 'FAULT stage: a seeded defect is present in the application' : 'HEALTHY stage: no defect is present'}`, `UI revision: ${t.revision}${t.revision === 'v0' ? ' (original interface)' : ' (interface changed by a benign redesign: labels, layout, test-hook names may differ from earlier revisions)'}`);
  if (t.kind === 'fault') { const [file, before, after] = faults[t.caseId]; lines.push('', '## Seeded defect (source change)', `File: ${file}`, `Original: ${before}`, `Defective: ${after}`); }
  lines.push('', `## Run status`, `Infrastructure result: ${entry.result}`, `Reported verdict of the executing system: ${r.reportedStatus ?? null}`, `Reported failed assertion: ${JSON.stringify(r.failedAssertion ?? null)}`);
  let step = 0, trace = [];
  if (r.agent) {
    lines.push(`Executing system final report: ${cut(r.agent.rawResponse, 3000)}`);
    const calls = [];
    for (const it of r.agent.ledger || []) {
      if (it.type === 'tool-call') calls.push({ name: it.name, args: it.arguments, text: null, isError: false });
      else if (it.type === 'tool-result') { const s = calls.findLast(x => x.text === null); if (s) { s.text = (it.result?.content || []).map(x => x.text || '').join('\n'); s.isError = Boolean(it.result?.isError); } }
    }
    for (const s of calls) trace.push(`[step ${++step}] ${s.name} ${cut(JSON.stringify(s.args), 600)}\n  -> ${s.isError ? 'ERROR ' : ''}${cut(s.text ?? '(no result recorded)', resultChars)}`);
  }
  if (r.baseline) {
    const b = r.baseline;
    lines.push(`Scenario run exit code: ${b.code}; scenario completed: ${b.scenarioCompleted}; timed out: ${b.timedOut}`);
    for (const f of b.stepFailures || []) trace.push(`[step ${++step}] failing scenario step "${f.step}"\n  -> ${cut(stripStack(f.error), resultChars)}`);
    if (!(b.stepFailures || []).length) for (const f of b.assertionFailures || []) trace.push(`[step ${++step}] assertion failure "${f.step}"\n  -> ${cut(stripStack(f.error), resultChars)}`);
    if (!trace.length) trace.push(`(no step failures recorded; stdout tail: ${cut((b.stdout || '').slice(-600), 600)})`);
  }
  let body = trace.join('\n');
  if (body.length > maxTraceChars) body = `${body.slice(0, maxTraceChars / 2)}\n...[middle of trace omitted: ${body.length - maxTraceChars} chars]...\n${body.slice(-maxTraceChars / 2)}`;
  lines.push('', '## Execution trace', body || '(empty)');
  const o = r.observation || {};
  lines.push('', '## Observer evidence (private browser observer; an input, not the answer)',
    `valid=${o.valid} triggerWitnessed=${o.triggerWitnessed} completionWitnessed=${o.completionWitnessed} defectObserved=${o.defectObserved} contractViolated=${o.contractViolated}`,
    `violatedPredicates=${JSON.stringify(o.violatedPredicates ?? [])} unobservedPredicates=${JSON.stringify(o.unobservedPredicates ?? [])}`,
    'Actions: ' + JSON.stringify((o.actions || []).map(a => ({ name: a.name, ok: a.ok, reason: a.reason }))),
    'Checks:\n' + (o.checks || []).map(k => `- after ${k.after}: ${k.assertion} => ${k.status} (ok=${k.ok}, kind=${k.kind})`).join('\n'));
  return { opaqueId: opaqueId(campaignId, t.id), kind: t.kind, classes: t.kind === 'fault' ? FAULT_CLASSES : HEALTHY_CLASSES, text: lines.join('\n'), steps: step };
}
export function allPackets() {
  const out = [];
  for (const c of listCampaigns()) for (const e of loadCampaign(c.id).trials) out.push({ campaign: c.id, trialId: e.record.trial.id, entry: e });
  return out;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [id, trialId] = process.argv.slice(2), e = loadCampaign(id).trials.find(x => x.record.trial.id === trialId);
  console.log(buildPacket(id, e).text);
}
