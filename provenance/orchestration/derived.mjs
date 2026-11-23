// Derived estimates from recorded trials. Never observations. Usage: node derived.mjs <campaign-dir> [adjudication.jsonl]
import fs from 'node:fs';
const dir = process.argv[2], adjPath = process.argv[3];
const rows = p => fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const trials = rows(dir + '/trials.jsonl'), journal = rows(dir + '/journal.jsonl');
const adj = new Map(adjPath ? rows(adjPath).map(a => [a.trialId, a]) : []);
const med = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const mean = a => a.reduce((p, c) => p + c, 0) / a.length;
const valid = trials.filter(t => t.result === 'recorded');
const R = valid.filter(t => t.record.trial.arm === 'runtime'), M = valid.filter(t => t.record.trial.arm === 'maintained');
const tok = t => { const u = t.record.agent.usage; return u.input_tokens + u.output_tokens; };
const unc = t => { const u = t.record.agent.usage; return u.input_tokens - (u.cached_input_tokens || 0) + u.output_tokens; };
const rt = { tokMean: mean(R.map(tok)), uncMean: mean(R.map(unc)), msMean: mean(R.map(t => t.record.elapsedMs)) };
const mt = { msMean: mean(M.map(t => t.record.elapsedMs)) };
const maint = journal.filter(l => l.type === 'maintenance-finished').map(l => l.record);
const repTok = maint.map(r => r.agent.usage.input_tokens + r.agent.usage.output_tokens);
const repUnc = maint.map(r => r.agent.usage.input_tokens - (r.agent.usage.cached_input_tokens || 0) + r.agent.usage.output_tokens);
const repMs = maint.map(r => r.elapsedMs);
console.log('Per 12-scenario suite run: agent', Math.round(12 * rt.tokMean), 'tokens,', Math.round(12 * rt.uncMean), 'uncached+output,', (12 * rt.msMean / 60000).toFixed(1), 'min sequential; scripts 0 tokens,', (12 * mt.msMean / 60000).toFixed(1), 'min');
console.log('Repair per transition: tokens', repTok, 'uncached+output', repUnc, 'minutes', repMs.map(m => (m / 60000).toFixed(1)));
const repairMean = mean(repTok), repairUnc = mean(repUnc), repairMs = mean(repMs);
console.log(`Break-even, tokens: one mean repair (${Math.round(repairMean)}) equals ${(repairMean / (12 * rt.tokMean)).toFixed(1)} agent suite runs; on uncached+output ${(repairUnc / (12 * rt.uncMean)).toFixed(1)}.`);
const dt = 12 * (rt.msMean - mt.msMean);
console.log(`Break-even, time: the agent suite costs ${(dt / 60000).toFixed(1)} min more per run, so one mean repair (${(repairMs / 60000).toFixed(1)} min agent time) equals ${(repairMs / dt).toFixed(1)} suite runs.`);
console.log('Sensitivity: construction cost of step code unmeasured; each unit of it moves break-even by its token cost / agent suite tokens. Scripted-arm tokens are repair only.');
// Hybrid replay: script first, agent only when the script fails, same stage, case and repetition.
const key = t => t.record.trial.stage + '|' + t.record.trial.caseId;
const byR = new Map(R.map(t => [key(t), t]));
const out = {};
for (const m of M) {
  const k = m.record.trial.kind + '-' + m.record.trial.revision; const o = out[k] ??= { n: 0, scriptPass: 0, scriptFail: 0, agentPassAfterFail: 0, agentFailAfterFail: 0, agentUnresolved: 0, missing: 0, agentRunsTok: 0 };
  o.n++;
  if (m.record.reportedStatus === 'pass') { o.scriptPass++; continue; }
  o.scriptFail++; const r = byR.get(key(m)); if (!r) { o.missing++; continue; }
  o.agentRunsTok += tok(r); const s = r.record.reportedStatus; if (s === 'pass') o.agentPassAfterFail++; else if (s === 'fail') o.agentFailAfterFail++; else o.agentUnresolved++;
}
console.log('\nHybrid replay by stage kind/revision (script first, agent only on script failure):'); for (const [k, v] of Object.entries(out)) console.log(k, JSON.stringify(v));
// Which scenarios broke when, on the step-code side.
for (const r of maint) { const c = r.initialValidation?.cases || []; console.log(`Initial suite after change to ${r.revision}: ${c.filter(x => JSON.stringify(x).match(/"(passed|status)":\s*(true|"passed")/)).length}/${c.length} (raw keys ${Object.keys(c[0] || {}).join(',')})`); }
if (adj.size) { const counts = {}; for (const a of adj.values()) { const k = `${a.kind}|${a.arm}|${a.classification}`; counts[k] = (counts[k] || 0) + 1; } console.log('\nAdjudicated:', JSON.stringify(counts, null, 0)); }
const healthyR = R.filter(t => t.record.trial.kind === 'healthy');
const contract = t => t.record.observation?.completionWitnessed && t.record.observation?.valid && !t.record.observation?.contractViolated;
console.log('\nAgent healthy runs: contract witnessed but verdict not pass:', healthyR.filter(t => contract(t) && t.record.reportedStatus !== 'pass').length, 'of', healthyR.length);
console.log('Agent healthy false-alarm candidates by case:', JSON.stringify(healthyR.filter(t => t.record.reportedStatus !== 'pass').reduce((c, t) => (c[t.record.trial.caseId] = (c[t.record.trial.caseId] || 0) + 1, c), {})));
for (const t of healthyR.filter(t => t.record.reportedStatus !== 'pass').slice(0, 6)) console.log(' ', t.record.trial.id, t.record.reportedStatus, '|', String(t.record.agent.rawResponse).slice(0, 190));

