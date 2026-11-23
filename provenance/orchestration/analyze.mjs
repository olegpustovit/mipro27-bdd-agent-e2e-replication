// Counts from the campaign records, per the frozen protocol. Usage: node analyze.mjs <campaign-dir> [adjudication.jsonl]
import fs from 'node:fs';
const dir = process.argv[2], adjPath = process.argv[3];
const rows = p => fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const trials = rows(dir + '/trials.jsonl');
const journal = rows(dir + '/journal.jsonl');
const adj = new Map(adjPath ? rows(adjPath).map(a => [a.trialId, a]) : []);
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
const stage = {}, perCase = {};
for (const t of trials) {
  const r = t.record, tr = r.trial, key = tr.stage + '|' + tr.arm;
  const s = stage[key] ??= { stage: tr.stage, kind: tr.kind, arm: tr.arm, n: 0, invalid: 0, pass: 0, fail: 0, unresolved: 0, contractFulfilled: 0, timedOut: 0, adj: {}, ms: [], tokens: [], uncached: [], output: [] };
  s.n++;
  if (t.result !== 'recorded') s.invalid++;
  else {
    const st = r.reportedStatus; if (st === 'pass') s.pass++; else if (st === 'fail') s.fail++; else s.unresolved++;
    if (r.observation?.completionWitnessed && r.observation?.valid && !r.observation?.contractViolated) s.contractFulfilled++;
    if (r.agent?.timedOut || r.baseline?.timedOut) s.timedOut++;
    s.ms.push(r.elapsedMs);
    if (r.agent?.usage) { const u = r.agent.usage; s.tokens.push(u.input_tokens + u.output_tokens); s.uncached.push(u.input_tokens - (u.cached_input_tokens || 0)); s.output.push(u.output_tokens); }
    const a = adj.get(tr.id); if (a) s.adj[a.classification] = (s.adj[a.classification] || 0) + 1;
    (perCase[tr.caseId + '|' + tr.kind + '|' + tr.revision + '|' + tr.arm] ??= []).push(st);
  }
}
console.log('stage | arm | n | invalid | pass | fail | unresolved | contract fulfilled | timeouts | median s | median tokens | adjudicated');
for (const s of Object.values(stage)) console.log([s.stage, s.arm, s.n, s.invalid, s.pass, s.fail, s.unresolved, s.contractFulfilled, s.timedOut, (q(s.ms, .5) / 1000).toFixed(1), q(s.tokens, .5) ?? '-', JSON.stringify(s.adj)].join(' | '));
const all = Object.values(stage);
for (const arm of ['maintained', 'runtime']) {
  const a = all.filter(s => s.arm === arm), ms = a.flatMap(s => s.ms), tk = a.flatMap(s => s.tokens), un = a.flatMap(s => s.uncached), out = a.flatMap(s => s.output), sum = x => x.reduce((p, c) => p + c, 0);
  console.log(`\n${arm}: runs ${ms.length}; total wall ${(sum(ms) / 60000).toFixed(1)} min; median ${(q(ms, .5) / 1000).toFixed(1)} s, p90 ${(q(ms, .9) / 1000).toFixed(1)} s; tokens total ${sum(tk)}, uncached input ${sum(un)}, output ${sum(out)}`);
}
const reps = {}; for (const [k, v] of Object.entries(perCase)) if (v.length > 1) { const arm = k.split('|')[3]; (reps[arm] ??= { same: 0, differ: 0, list: [] }); if (new Set(v).size === 1) reps[arm].same++; else { reps[arm].differ++; reps[arm].list.push(k + ':' + v.join('/')); } }
console.log('\nVerdict consistency across repetitions (same scenario, kind, revision):', JSON.stringify(reps));
const m = journal.filter(l => l.type === 'maintenance-finished');
for (const l of m) { const r = l.record, a = r.agent; console.log(`\nMaintenance ${r.from}->${r.revision}: ${(r.elapsedMs / 60000).toFixed(1)} min, edits ${r.frozen?.edits}, suites ${r.frozen?.validations}, error ${r.error ?? 'none'}, budgetExpired ${r.budgetExpired}, model ${a?.actualModels}, tokens ${a?.usage ? a.usage.input_tokens + a.usage.output_tokens : '-'} (uncached input ${a?.usage ? a.usage.input_tokens - (a.usage.cached_input_tokens || 0) : '-'}, output ${a?.usage?.output_tokens ?? '-'})`); console.log('  initial suite: ' + (r.initialValidation?.cases || []).map(c => c.caseId + ':' + ((c.stepFailures?.length || c.assertionFailures?.length || c.status === 'failed') ? 'F' : 'P')).join(' ')); console.log('  agent final: ' + String(a?.rawResponse || '').slice(0, 500)); }
console.log('\nJournal:', JSON.stringify(journal.reduce((c, l) => (c[l.type + (l.result ? ':' + l.result : '')] = (c[l.type + (l.result ? ':' + l.result : '')] || 0) + 1, c), {})));

