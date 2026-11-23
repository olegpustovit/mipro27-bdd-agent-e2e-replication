import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { listCampaigns, loadCampaign, trialRows, maintenance } from './lib/campaign-data.mjs';
const root = new URL('../', import.meta.url);
export function summarize(rows) {
  const count = classification => rows.filter(x => x.classification === classification).length;
  return { detections: count('supported_detection'), faults: rows.filter(x => x.kind === 'fault').length, passes: count('true_pass'), healthy: rows.filter(x => x.kind === 'healthy').length, falseAlarms: count('false_alarm'), actionFailures: count('action_failure'), invalid: count('invalid'), unsupportedPasses: count('unsupported_healthy_pass'), noOpportunity: count('no_opportunity') };
}
export function usageSummary(values) {
  const token = n => Number.isSafeInteger(n) && n >= 0;
  const inputs = values.filter(u => u && token(u.input_tokens));
  const outputs = values.filter(u => u && token(u.output_tokens));
  const reads = inputs.filter(u => token(u.cached_input_tokens) && u.cached_input_tokens <= u.input_tokens);
  const writes = reads.filter(u => token(u.cache_write_input_tokens) && u.cached_input_tokens + u.cache_write_input_tokens <= u.input_tokens);
  const complete = reads.filter(u => token(u.output_tokens));
  const paired = inputs.filter(u => token(u.output_tokens));
  const sum = (rows,key) => rows.reduce((n,u) => n+u[key],0);
  const full = rows => values.length > 0 && rows.length === values.length;
  const input = full(inputs) ? sum(inputs,'input_tokens') : null;
  const output = full(outputs) ? sum(outputs,'output_tokens') : null;
  const cachedInput = full(reads) ? sum(reads,'cached_input_tokens') : null;
  const cacheWriteInput = full(writes) ? sum(writes,'cache_write_input_tokens') : null;
  return { observed: complete.length, missing: values.length-complete.length,
    inputObserved: inputs.length, outputObserved: outputs.length, cacheReadObserved: reads.length, cacheWriteObserved: writes.length,
    observedInput: inputs.length ? sum(inputs,'input_tokens') : null, observedOutput: outputs.length ? sum(outputs,'output_tokens') : null, observedCacheRead: reads.length ? sum(reads,'cached_input_tokens') : null, observedCacheWrite: writes.length ? sum(writes,'cache_write_input_tokens') : null, inputOutputPairs: paired.length, observedPairedTotal: paired.length ? sum(paired,'input_tokens')+sum(paired,'output_tokens') : null,
    input, cachedInput, cacheWriteInput, nonCacheReadInput: input !== null && cachedInput !== null ? input-cachedInput : null,
    newInputExcludingCacheWrites: input !== null && cachedInput !== null && cacheWriteInput !== null ? input-cachedInput-cacheWriteInput : null,
    output, total: input !== null && output !== null ? input+output : null };
}
export function resourceSummary(trials) {
  const recorded = trials.filter(t => t.result === 'recorded');
  const finite = n => Number.isFinite(n) && n >= 0;
  const times = trials.map(t => t.record.elapsedMs).filter(finite);
  const retainedTimes = recorded.map(t => t.record.elapsedMs).filter(finite).sort((a,b) => a-b);
  const mean = values => values.length ? values.reduce((n,v) => n+v,0)/values.length : null;
  const middle = Math.floor(retainedTimes.length/2);
  const median = retainedTimes.length ? retainedTimes.length%2 ? retainedTimes[middle] : (retainedTimes[middle-1]+retainedTimes[middle])/2 : null;
  return { trials: trials.length, recorded: recorded.length, otherResults: trials.length-recorded.length,
    elapsed: { observed: times.length, missing: trials.length-times.length, totalMs: times.reduce((n,v) => n+v,0), recordedObserved: retainedTimes.length, recordedMeanMs: mean(retainedTimes), recordedMedianMs: median },
    usage: usageSummary(trials.map(t => t.record.agent?.usage)) };
}
export function studyFacts() {
  return listCampaigns().map(c => {
    const rows = trialRows(c.id), runtime = rows.filter(x => x.arm === 'runtime');
    const campaign = loadCampaign(c.id), raw = campaign.trials;
    return { ...c, resources: { runtime: resourceSummary(raw.filter(t => t.record.trial.arm === 'runtime')), maintained: resourceSummary(raw.filter(t => t.record.trial.arm === 'maintained')) }, all: summarize(runtime), withoutSocial: summarize(runtime.filter(x => !['social-like', 'social-comment'].includes(x.caseId))), maintained: summarize(rows.filter(x => x.arm === 'maintained')), repairs: maintenance(c.id).map(m => {
      const after = rows.filter(x => x.arm === 'maintained' && x.stage === `healthy-${m.revision}-1`);
      const usage = usageSummary([m.usage]);
      return { ...m, tokens: usage.total, usage, afterPasses: after.filter(x => x.classification === 'true_pass').length, afterTotal: after.length };
    }) };
  });
}
export function humanAgreement({ answerFile = new URL('data/human-adjudication.jsonl', root), sampleFile = new URL('data/human-sample.json', root) } = {}) {
  if (!fs.existsSync(answerFile)) return 'Human check: not started (0/40)';
  const sample = JSON.parse(fs.readFileSync(sampleFile, 'utf8')), answers = new Map();
  for (const answer of fs.readFileSync(answerFile, 'utf8').split('\n').filter(Boolean).map(JSON.parse)) {
    if (answer.schema !== 1 || !answer.rater) throw new Error('Invalid human answer');
    if (!sample.some(s => s.campaign === answer.campaign && s.trialId === answer.trialId)) throw new Error('Human answer outside fixed sample');
    answers.set(JSON.stringify([answer.rater, answer.campaign, answer.trialId]), answer);
  }
  if (!answers.size) return 'Human check: not started (0/40)';
  const groups = new Map(), disagreements = [];
  for (const a of answers.values()) {
    const trial = trialRows(a.campaign).find(x => x.trialId === a.trialId), stratum = sample.find(s => s.campaign === a.campaign && s.trialId === a.trialId).stratum;
    if (!trial?.classification) throw new Error('Human answer lacks LLM comparison');
    const agree = a.classification === trial.classification;
    for (const key of [`${a.rater}: overall`, `${a.rater}: LLM class ${trial.classification}`, `${a.rater}: stratum ${stratum}`]) {
      const g = groups.get(key) || { agree: 0, total: 0 }; g.total++; if (agree) g.agree++; groups.set(key, g);
    }
    if (!agree) disagreements.push(`${a.rater} ${a.campaign} ${a.trialId}: human ${a.classification} vs LLM ${trial.classification}`);
  }
  return ['Human check (stratified descriptive sample, not population accuracy):', ...[...groups].map(([k, g]) => `${k}: agree ${g.agree}/${g.total}`), ...disagreements].join('\n');
}
export function renderFacts(options) {
  const lines = ['Exploratory owner-directed campaigns; Evidence gate STOP; no gate pass.', 'Corrected supplement: recovered analysis/derived initial-suite lines are wrong; use the counts below.', 'Counts describe one app; repeated executions are not independent systems. Detection classifications are LLM judgments, not independent proof.'];
  const fmt = s => `det ${s.detections}/${s.faults}; true pass ${s.passes}/${s.healthy}; false alarms ${s.falseAlarms}; action failures ${s.actionFailures}; invalid ${s.invalid}; unsupported passes ${s.unsupportedPasses}; no opportunity ${s.noOpportunity}`;
  for (const c of studyFacts()) {
    lines.push(`\nCampaign ${c.label} (${c.id})`, `Agent all: ${fmt(c.all)}`, `Agent without social-like/social-comment: ${fmt(c.withoutSocial)}`);
    const resources = c.resources.runtime;
    const cli = c.label === 'D' ? 'omp 18.14.0' : 'Codex CLI 0.159.3';
    lines.push(`Runtime CLI pin (REPRODUCE.md): ${cli}.`, `Agent resource source table (JSON, milliseconds and tokens): ${JSON.stringify(resources)}`);
    if (c.resources.maintained.trials) lines.push(`Maintained execution resources (JSON; repairs separate): ${JSON.stringify(c.resources.maintained)}`);
    if (c.maintained.faults) lines.push(`Step definitions all: ${fmt(c.maintained)}`, `Step definitions without social: ${fmt(summarize(trialRows(c.id).filter(x => x.arm === 'maintained' && !['social-like', 'social-comment'].includes(x.caseId))))}`);
    for (const r of c.repairs) lines.push(`UI ${r.from}→${r.revision}: broke ${r.initialBroken.length}/${r.initialCases.length}: ${r.initialBroken.map(x => x.caseId).join(', ')}`, `Repair: ${(r.elapsedMs / 60000).toFixed(2)} min maintenance-phase elapsed; ${r.edits}/10 accepted edits; ${r.suites}/12 suites; ${r.tokens} tokens (null means unavailable). Repair usage categories: ${JSON.stringify(r.usage)}. Subsequent healthy step-definition passes ${r.afterPasses}/${r.afterTotal}.`, `Repair agent final message (self-report; journal counts above are authoritative): ${r.agentFinal}`);
  }
  lines.push('\nResource accounting: elapsed totals and observed usage include all trial results, including infrastructure-invalid results. Recorded-run mean/median elapsed excludes other result classes and names its denominator; missing measurements are explicit. Token input includes cache-read input. nonCacheReadInput is input minus cache-read input and can include cache-write input (omp). Separate write/new-input fields are null when their counters are not known; no price category is inferred. Null/absent counters remain unknown, never zero. Usage observed/missing counts refer to complete input/output/cache-read triples; per-field coverage is also named. These are usage counters, not billed charges. Initial construction, tool/harness engineering and human labor remain unmeasured.', 'Median convention: arithmetic mean of the two middle elapsed observations for even sample sizes; historical recovered scripts instead use the upper middle observation. Do not mix conventions.', 'Elapsed boundary: record.elapsedMs spans runTrial setup (environment/UI revision readiness/reset/browser creation), execution, observer evaluation and cleanup/source restoration, ending just before trial-record emit. Maintenance elapsed spans setup, initial validation, agent session/validation tools, browser cleanup and source restore; ends before maintenance-record emit. Phase sums exclude between-phase orchestration and initial app/bootstrap costs and are not total campaign wall or pure inference time.', '\nLimits: initial step-definition construction cost unmeasured; mild UI changes; hidden-ID asymmetry; Campaign A reload-tool defect; model/CLI confound in D; adjudicator also tested in C; adjudicator isolation was instructional only.', humanAgreement(options));
  return lines.join('\n') + '\n';
}
export function writeFacts() { const text = renderFacts(); fs.writeFileSync(new URL('results/facts.txt', root), text); return text; }
if (process.argv[1] === fileURLToPath(import.meta.url)) process.stdout.write(writeFacts());
