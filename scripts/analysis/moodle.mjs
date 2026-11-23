#!/usr/bin/env node
// Moodle campaign analysis, separate from the pilot (scripts/analysis/run.mjs is untouched).
//   node scripts/analysis/moodle.mjs [--plan <planShort>[,<planShort>...]] [--data <dir>]
// Reads the trial ledger and writes results/moodle-campaign.txt (measured trials: tasks `campaign:`), results/moodle-smoke.txt
// (tasks `smoke:`, labelled engineering smoke, NOT measured trials) and results/moodle-resources.txt (tokens, wall, repairs).
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readLines } from '../ledger/jsonl.mjs';
import { ledgerPaths } from '../ledger/paths.mjs';
import { loadManifest, resolveTarget, faultTarget } from '../../adapters/moodle/manifest.mjs';
import { repoRoot, dataHome, resolveMoodleCommit } from '../../adapters/moodle/config.mjs';
import { judge, OUTCOMES, observed } from './moodle-oracle.mjs';
import { repairImpact, stepInImpact, patchedText, patchHunks } from '../moodle/pair-structure.mjs';

// Haiku pilot (campaign D, results/pilot-resources.txt): 40,418,404 total tokens / 108 executions; mean wall 60,156.3 ms.
export const PILOT_HAIKU = { runs: 108, totalTokens: 40418404, meanTokens: 40418404 / 108, meanWallMs: 60156.3, meanToolCalls: 32.0 };

export function parseKey(key) {
  const m = /^([^/]+)\/([^/]+)\/(healthy|fault:[A-Z]\d+|broken:B\d+|broken-steps:B\d+|before:B\d+)\/([A-Z])\/([^/]+)\/r(\d+)(?:#(\d+))?$/.exec(key);
  return m && { short: m[1], caseId: m[2], state: m[3], arm: m[4], model: m[5], rep: Number(m[6]) };
}
export const kindOf = task => /^([a-z]+):/.exec(task ?? '')?.[1] ?? 'unknown';
const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const med = xs => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const fmt = (v, d = 0) => v == null ? 'null' : Number(v).toFixed(d);

export function collectTrials(events, { plan = null } = {}) {
  const out = [];
  for (const e of events) {
    if (e.type !== 'trial-end') continue;
    const k = parseKey(e.key); if (!k || (plan && !String(plan).split(',').includes(k.short))) continue;
    out.push({ ...k, key: e.key, task: e.task, kind: kindOf(e.task), body: e });
  }
  return out;
}
// One verdict per (case, fault, arm, model, rep): needs the healthy and the faulted trial.
export function judgeAll(trials, manifest, { tolerance = 0, srcDir = join(dataHome(), 'src', resolveMoodleCommit().slice(0, 12)) } = {}) {
  const by = new Map(trials.filter(t => t.arm !== 'repair').map(t => [`${t.short}|${t.caseId}|${t.state}|${t.arm}|${t.model}|${t.rep}`, t]));   // a healthy trial only pairs with faulted trials of the same plan
  const rows = [];
  for (const t of trials) {
    if (!t.state.startsWith('fault:') || t.caseId.endsWith('.repair')) continue;
    const f = manifest.faultById.get(t.state.slice(6)), h = by.get(`${t.short}|${t.caseId}|healthy|${t.arm}|${t.model}|${t.rep}`);
    const scenario = t.caseId.split('.')[1], tgt = resolveTarget(manifest, { ...f, target: faultTarget(manifest, f.id, scenario) }, srcDir);   // Behat step index at the pin, not the manifest's own-step index
    const j = judge({ healthy: h?.body, faulted: t.body, target: { step_index: tgt.behatIndex, step_text: tgt.method === 'text' ? faultTarget(manifest, f.id, scenario).step_text : null }, tolerance });
    rows.push({ kind: t.kind, caseId: t.caseId, break: t.caseId.split('.')[0], scenario: t.caseId.split('.')[1], fault: f.id, arm: t.arm, model: t.model, rep: t.rep, ...j, target: tgt.behatIndex, targetText: faultTarget(manifest, f.id, scenario).step_text ?? null, repairKey: t.body.repairKey ?? null, keyFaulted: t.key, keyHealthy: h?.key ?? null });
  }
  // a healthy trial without its faulted partner still counts for false alarms
  for (const t of trials) if (t.state === 'healthy' && t.kind && !rows.some(r => r.keyHealthy === t.key)) rows.push({ kind: t.kind, caseId: t.caseId, break: t.caseId.split('.')[0], scenario: t.caseId.split('.')[1], fault: null, arm: t.arm, model: t.model, rep: t.rep, ...judge({ healthy: t.body, faulted: null, target: {} }), keyHealthy: t.key, healthyOnly: true });
  return rows;
}
export function summarize(rows) {
  const groups = new Map();
  for (const r of rows) { const k = `${r.arm}|${r.model}`; (groups.get(k) ?? groups.set(k, []).get(k)).push(r); }
  return [...groups].sort().map(([k, list]) => {
    const [arm, model] = k.split('|'), c = Object.fromEntries(OUTCOMES.map(o => [o, list.filter(r => r.outcome === o).length]));
    const healthy = new Map(); for (const r of list) if (r.keyHealthy) healthy.set(r.keyHealthy, r.healthy.status);
    return { arm, model, pairs: list.filter(r => !r.healthyOnly).length, ...c, healthyRuns: healthy.size, healthyFail: [...healthy.values()].filter(s => s === 'fail').length };
  });
}
// ---- Arm B at the unit level: one break-level repair per break x model x repetition ----
const asArray = v => Array.isArray(v) ? v : typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return []; } })() : [];
// Text of a file in arm B's starting state (the pin with the break's step-definition patch applied); null when unavailable.
export function startTextFor(manifest, state, srcDir) {
  const cache = new Map();
  return path => {
    const k = `${state}|${path}`; if (cache.has(k)) return cache.get(k);
    let text = null;
    try {
      const [kind, id] = state.split(':'), b = manifest.breakById.get(id), file = kind === 'broken-steps' ? (b.test_half_split?.empty ? null : b.patches?.broken_steps?.file) : b.patches?.broken?.file;
      const base = existsSync(join(srcDir, path)) ? readFileSync(join(srcDir, path), 'utf8') : null;
      text = base == null ? null : file ? patchedText(base, path, readFileSync(join(repoRoot, file), 'utf8')) : base;
    } catch { text = null; }
    cache.set(k, text); return text;
  };
}
// One record per repair session: the files and step definitions its accepted edits touched. The mapping from edit to step definition is static (docblock regexes, same-file helper callers
// to depth 3, named-selector keys; see scripts/moodle/pair-structure.mjs); the harness records no runtime step-to-definition mapping, so a step definition used by a step through another
// file's helper is not seen. `blobFiles` = files of the recorded patch blob (the net diff of the repaired tree against the pin, which also holds the break's reverted hunks).
export function repairRecords(repairs, { startTextOf, readBlob = () => null } = {}) {
  return repairs.map(r => {
    const b = r.body, edits = asArray(b.edits), state = r.state, im = repairImpact(edits, startTextOf ? startTextOf(state) : () => null), blob = b.patchBlob ? readBlob(b.patchBlob) : null;
    return { key: r.key, break: r.caseId.split('.')[0], model: r.model, rep: r.rep, kind: r.kind, state, acceptedEdits: b.policyState?.acceptedEdits ?? edits.length, runs: b.policyState?.scenarioRuns ?? null, allSamplePass: b.allSamplePass ?? null,
      editedFiles: b.editedFiles ?? im.files, editedFuncs: im.funcs, impact: im, patchBytes: b.patchBytes ?? null, patchBlob: b.patchBlob ?? null, blobFiles: blob == null ? null : patchHunks(blob).map(h => h.path), blobMissing: Boolean(b.patchBlob) && blob == null };
  });
}
// A repair with accepted edits whose edits reach no step definition pattern and no named-selector key (for example a selector class constructor) cannot be tied to any step: 'unmapped', not 'none'.
const mappable = rec => !(rec.acceptedEdits > 0) || rec.impact.patterns.length > 0 || rec.impact.selectors.length > 0;
// Arm B pair rows joined to their repair: did the repair edit a step definition (or selector) that the target step uses?
export function armBPairRows(rows, recs) {
  const byKey = new Map(recs.map(r => [r.key, r]));
  return rows.filter(r => r.arm === 'B' && !r.healthyOnly && r.fault).map(r => { const rec = byKey.get(r.repairKey);
    return { ...r, repair: rec ?? null, targetDefEdited: !rec || !r.targetText ? 'unknown' : mappable(rec) ? stepInImpact(r.targetText, rec.impact) : 'unmapped' }; });
}
const planOf = key => String(key ?? '').split('/')[0];
// Unit key: plan, break, model, repetition (a repair is shared by the arm B trials of the same plan, break, model and repetition).
export function armBUnits(pairRows, recs) {
  const units = new Map(), id = (plan, b, m, k) => `${plan}|${b}|${m}|${k}`;
  const unit = (plan, b, m, k) => units.get(id(plan, b, m, k)) ?? units.set(id(plan, b, m, k), { plan, break: b, model: m, rep: k, repair: null, pairs: [] }).get(id(plan, b, m, k));
  for (const r of recs) unit(planOf(r.key), r.break, r.model, r.rep).repair = r;
  for (const p of pairRows) unit(planOf(p.keyFaulted), p.break, p.model, p.rep).pairs.push(p);
  return [...units.values()].sort((a, b) => a.plan.localeCompare(b.plan) || a.break.localeCompare(b.break) || a.model.localeCompare(b.model) || a.rep - b.rep);
}
export function renderArmB(pairRows, recs, label) {
  const L = [`ARM B (${label}): unit of analysis = one break-level repair per break x model x repetition; pair rows are listed under their unit and share that repair, so they are not independent observations.`];
  L.push('Step-to-definition limit: the harness has no runtime mapping from a step to its step definition. "target def edited" uses a static mapping (docblock @Given/@When/@Then regex of the PHP function an edit sits in, helpers followed through same-file callers to depth 3, named-selector keys); a definition reached through a helper in another file is not seen, so "none" means "not seen", not "proven unedited". "unmapped" = the repair made edits that reach no step definition or selector key (for example a selector class constructor), so no step can be tied to them. "unknown" = no repair record or no target text.');
  const units = armBUnits(pairRows, recs);
  if (!units.length) { L.push('no arm B repair sessions or pair rows recorded'); return L.join('\n') + '\n'; }
  const n = (x, w) => String(x ?? '-').padEnd(w);
  L.push(`${n('plan', 14)}${n('break', 6)}${n('model', 18)}${n('rep', 4)}${n('edits', 6)}${n('runs', 5)}${n('sample', 8)}${n('pairs', 6)}edited files / step definitions`);
  for (const u of units) {
    const r = u.repair;
    L.push(`${n(u.plan, 14)}${n(u.break, 6)}${n(u.model, 18)}${n(u.rep, 4)}${n(r?.acceptedEdits, 6)}${n(r?.runs, 5)}${n(r ? (r.allSamplePass ? 'pass' : 'fail') : 'no repair', 8)}${n(u.pairs.length, 6)}${r ? `${r.editedFiles.join(', ') || 'none'} | defs: ${r.editedFuncs.join(', ') || 'none seen'}${r.impact.unlocated ? ` | ${r.impact.unlocated} edit(s) not located` : ''}${r.blobMissing ? ' | patch blob missing' : ''}` : 'repair record missing'}`);
    for (const p of u.pairs) L.push(`    pair ${p.caseId} ${p.fault}: ${p.outcome}; target step ${p.target} "${p.targetText ?? '?'}"; target def edited: ${p.targetDefEdited}`);
  }
  const rp = recs.length, withEdit = pairRows.filter(p => p.targetDefEdited === 'definition' || p.targetDefEdited === 'selector').length;
  L.push(`TOTALS: repair sessions ${rp}; sample passes ${recs.filter(r => r.allSamplePass).length}; arm B pair rows ${pairRows.length} over ${units.filter(u => u.pairs.length).length} repair units; pair rows whose target step uses an edited definition ${withEdit}, not seen ${pairRows.filter(p => p.targetDefEdited === 'none').length}, edits unmapped ${pairRows.filter(p => p.targetDefEdited === 'unmapped').length}, unknown ${pairRows.filter(p => p.targetDefEdited === 'unknown').length}.`);
  return L.join('\n') + '\n';
}
// Arms A and C run at the pin (healthy and fault states): the break id of a case is a label, not an input. Rows are grouped by (fault, scenario, arm, model, repetition).
export function independence(rows) {
  const groups = new Map();
  for (const r of rows.filter(x => (x.arm === 'A' || x.arm === 'C') && !x.healthyOnly && x.fault)) { const k = `${r.arm}|${r.model}|${r.fault}|${r.scenario}|${r.rep}`; (groups.get(k) ?? groups.set(k, []).get(k)).push(r); }
  return [...groups].map(([k, list]) => ({ key: k, rows: list.length, breaks: [...new Set(list.map(r => r.break))], outcomes: [...new Set(list.map(r => r.outcome))] }));
}
export function renderIndependence(rows) {
  const g = independence(rows), shared = g.filter(x => x.breaks.length > 1), conflicting = g.filter(x => x.outcomes.length > 1);
  const L = ['ARM A AND ARM C DO NOT DEPEND ON THE BREAK: both run at the pin (states healthy and fault:<id>); the break id in a case name only says which pair the trial was planned for. Rows are grouped by (fault, scenario, arm, model, repetition).'];
  L.push(`pair rows of arm A and arm C ${rows.filter(x => (x.arm === 'A' || x.arm === 'C') && !x.healthyOnly && x.fault).length}; distinct (fault, scenario, arm, model, repetition) units ${g.length}; units planned under more than one break ${shared.length}${shared.length ? ` (${shared.map(x => `${x.key} under ${x.breaks.join('+')}`).join('; ')})` : ''}; units whose rows disagree on the outcome ${conflicting.length}${conflicting.length ? ` (${conflicting.map(x => `${x.key}: ${x.outcomes.join(' / ')}`).join('; ')})` : ''}.`);
  return L.join('\n') + '\n';
}

function renderOutcome(title, label, rows, manifest) {
  const L = [title, label, ''];
  if (!rows.length) { L.push('no trials recorded'); return L.join('\n') + '\n'; }
  L.push('Oracle: caught = same arm passes the healthy build AND fails the faulted build at the fix\'s target step (agent: verified step-level verdict); false alarm = fails the healthy build.');
  L.push('fail-near / fail-elsewhere = healthy passes, faulted fails at another step, within two steps of the target or further (not a catch); fail-unlocated = fails without a verified step; invalid = Behat error or agent "unresolved".');
  L.push('');
  L.push(`${'arm'.padEnd(4)}${'model'.padEnd(22)}${'pairs'.padEnd(6)}${OUTCOMES.map(o => o.padEnd(17)).join('')}healthy runs / failed`);
  for (const s of summarize(rows)) L.push(`${s.arm.padEnd(4)}${s.model.padEnd(22)}${String(s.pairs).padEnd(6)}${OUTCOMES.map(o => String(s[o]).padEnd(17)).join('')}${s.healthyRuns} / ${s.healthyFail}`);
  L.push('', 'Per trial pair');
  L.push(`${'case'.padEnd(12)}${'fault'.padEnd(6)}${'arm'.padEnd(4)}${'model'.padEnd(22)}${'rep'.padEnd(4)}${'outcome'.padEnd(16)}healthy      faulted (step vs target)`);
  const d = o => `${o.status}${o.stepIndex != null ? '@' + o.stepIndex : ''}`;
  for (const r of rows.filter(x => !x.healthyOnly)) L.push(`${r.caseId.padEnd(12)}${String(r.fault).padEnd(6)}${r.arm.padEnd(4)}${r.model.padEnd(22)}${String(r.rep).padEnd(4)}${r.outcome.padEnd(16)}${d(r.healthy).padEnd(13)}${r.faulted ? d(r.faulted) : '-'} (target ${r.target})`);
  return L.join('\n') + '\n';
}
function resources(trials, repairs) {
  const L = ['Moodle resources (tokens are usage counters as reported; unknown = null; wall = whole trial incl. fixture reset and hand-off)', ''];
  const groups = new Map(); for (const t of trials) { const k = `${t.kind}|${t.arm}|${t.model}`; (groups.get(k) ?? groups.set(k, []).get(k)).push(t); }
  for (const [k, list] of [...groups].sort()) {
    const [kind, arm, model] = k.split('|'), m = list.map(t => t.body.meter ?? {}), tok = m.map(x => x.inputTokens == null || x.outputTokens == null ? null : x.inputTokens + x.outputTokens), wall = m.map(x => x.wall?.totalMs).filter(Number.isFinite);
    const seen = tok.filter(v => v != null), tools = list.map(t => t.body.toolCalls).filter(Number.isFinite), cost = m.map(x => x.reportedCostUsd).filter(Number.isFinite);
    L.push(`${kind} arm ${arm} ${model}: ${list.length} trials; tokens/run mean ${fmt(mean(seen))} (observed ${seen.length}/${list.length}); wall mean ${fmt(mean(wall))} ms median ${fmt(med(wall))} ms; tool calls mean ${fmt(mean(tools), 1)}; reported cost mean ${cost.length ? '$' + fmt(mean(cost), 4) : 'null'}`);
  }
  L.push('', 'Per agent trial (arm C): input incl. cache / cached / output tokens, wall, tool calls, outcome, sandbox self-check');
  for (const t of trials.filter(x => x.arm === 'C').sort((x, y) => x.key.localeCompare(y.key))) { const m = t.body.meter ?? {}; L.push(`${t.kind} ${t.key}: in ${m.inputTokens ?? 'null'} cached ${m.cacheReadTokens ?? 'null'} out ${m.outputTokens ?? 'null'}; wall ${m.wall?.totalMs ?? 'null'} ms (agent ${t.body.agentMs ?? 'null'} ms); tool calls ${t.body.toolCalls ?? 'null'}; status ${t.body.status ?? 'null'} (step ${t.body.behatStepIndex ?? '-'}, verified ${t.body.failingStepVerified ?? '-'}); isolation ${t.body.isolation?.ok ?? 'null'}`); }
  L.push('', 'Arm-B repair sessions (one per break x model x repetition)');
  for (const r of repairs) { const m = r.body.meter ?? {}; L.push(`${r.kind} ${r.caseId} ${r.model} r${r.rep}: tokens in ${m.inputTokens ?? 'null'} out ${m.outputTokens ?? 'null'}; cached ${m.cacheReadTokens ?? 'null'}; tool calls ${Array.isArray(r.body.calls) ? r.body.calls.length : 'null'}; isolation ${r.body.isolation?.ok ?? 'null'}; wall ${r.body.meter?.wall?.totalMs ?? 'null'} ms; model ms ${r.body.meter?.wall?.modelMs ?? 'null'}; accepted edits ${r.body.policyState?.acceptedEdits ?? '?'}; runs ${r.body.policyState?.scenarioRuns ?? '?'}; sample passes after repair: ${r.body.allSamplePass}`); }
  if (!repairs.length) L.push('none recorded');
  // Sandbox self-check (isolation) of every model-driven session: arm-C trials and repair sessions. Listed exactly, never summarised as "every session".
  const sessions = [...trials.filter(x => x.arm === 'C'), ...repairs].sort((x, y) => String(x.body.at).localeCompare(String(y.body.at)) || x.key.localeCompare(y.key));
  const passing = sessions.filter(x => x.body.isolation?.ok === true), failing = sessions.filter(x => x.body.isolation?.ok === false), none = sessions.filter(x => x.body.isolation == null);
  L.push('', `SANDBOX SELF-CHECK per agent session (isolation recorded in the trial result by adapters/moodle/agent-run.mjs isolationCheck; the agent never starts when it fails). Agent sessions recorded: ${sessions.length} (arm C ${sessions.filter(x => x.arm === 'C').length}, repair ${sessions.filter(x => x.caseId.endsWith('.repair')).length}); with a passing self-check ${passing.length}; with a FAILED self-check ${failing.length}; WITHOUT a recorded self-check ${none.length}.`);
  L.push(`Cause of the missing records: the self-check and its record in the trial result were added in commit 07d7766 (2026-11-15T22:31:23Z, "Smoke r2 ... sandbox self-check recorded per agent trial"). The sessions without a record ended before that commit (plan f66fd695cc21, smoke r1, ${none.map(x => String(x.body.at).slice(11, 19)).join(', ')} UTC). The code of that run already started agents through scripts/codex-boundary.mjs prepareBoundary (bwrap) but ran no check that the owner's home, the repository and the study data directory are absent, so the isolation of those sessions is UNVERIFIED, not shown to be broken. Claims about isolation cover the listed passing sessions only.`);
  L.push('Sessions WITHOUT a recorded self-check:'); for (const x of none) L.push(`  ${x.kind} ${x.key} (ended ${x.body.at ?? 'null'})`); if (!none.length) L.push('  none');
  if (failing.length) { L.push('Sessions with a FAILED self-check:'); for (const x of failing) L.push(`  ${x.kind} ${x.key}`); }
  L.push('Sessions WITH a passing self-check:'); for (const x of passing) L.push(`  ${x.kind} ${x.key} (ended ${x.body.at ?? 'null'})`);
  // Repair sessions by budget in force: 2 edits / 3 runs until commit cfbc196 (2026-11-16T00:45:42Z), 10 edits / 12 runs from then on (the pilot maintenance budget).
  const CHANGE = '2026-11-16T00:45:42Z', old = repairs.filter(r => String(r.body.at) < CHANGE), now = repairs.filter(r => String(r.body.at) >= CHANGE), ok = list => list.filter(r => r.body.allSamplePass === true).length;
  L.push('', `Repair sessions by budget in force (changed in commit cfbc196, ${CHANGE}, after the first smokes): 2 edits / 3 agent runs: ${old.length} sessions, sample passes after repair ${ok(old)}/${old.length}; 10 edits / 12 agent runs: ${now.length} sessions, sample passes after repair ${ok(now)}/${now.length}. Smoke, not measured.`);
  L.push('', `Pilot reference (Haiku, campaign D, results/pilot-resources.txt): ${PILOT_HAIKU.runs} runs, mean ${fmt(PILOT_HAIKU.meanTokens)} tokens/run, mean wall ${fmt(PILOT_HAIKU.meanWallMs)} ms, mean tool calls ${PILOT_HAIKU.meanToolCalls}.`);
  return L.join('\n') + '\n';
}
export function build(events, manifest, opts = {}) {
  const all = collectTrials(events, opts), repair = all.filter(t => t.caseId.endsWith('.repair')), trials = all.filter(t => !t.caseId.endsWith('.repair') && t.arm !== undefined);
  const measured = trials.filter(t => t.kind === 'campaign'), smoke = trials.filter(t => t.kind === 'smoke');
  const srcDir = opts.srcDir ?? join(dataHome(), 'src', resolveMoodleCommit().slice(0, 12)), readBlob = opts.readBlob ?? (sha => { try { return readFileSync(join(ledgerPaths(opts.data).blobs, 'objects', sha.slice(0, 2), sha), 'utf8'); } catch { return null; } });
  const startTextOf = opts.startTextOf ?? (state => startTextFor(manifest, state, srcDir)), section = (ts, rs, label) => {
    const recs = repairRecords(rs, { startTextOf, readBlob }), rowsJ = judgeAll(ts, manifest, opts);
    return renderIndependence(rowsJ) + '\n' + renderArmB(armBPairRows(rowsJ, recs), recs, label);
  };
  // a repair session belongs to the measured campaign when a measured arm B trial uses it (its repairKey); every other repair session is smoke
  const used = new Set(measured.map(t => t.body.repairKey).filter(Boolean)), mRepairs = repair.filter(r => r.kind === 'campaign' || used.has(r.key)), sRepairs = repair.filter(r => !mRepairs.includes(r));
  const invalid = measured.filter(t => observed(t.body).status === 'invalid');
  const invalidReport = [
    `Invalid individual executions: ${invalid.length}`,
    ...invalid.map(({ key, body }) => `  ${key}: ${body.error ?? body.status ?? body.outcome ?? 'unknown'}`),
  ].join('\n') + '\n';
  return {
    campaign: renderOutcome('Moodle campaign (measured trials; exploratory, run without a gate pass)', `trials: ${measured.length}; repair sessions: ${mRepairs.length}`, judgeAll(measured, manifest, opts), manifest) + '\n' + invalidReport + '\n' + section(measured, mRepairs, 'measured trials'),
    smoke: renderOutcome('Moodle SMOKE (engineering check of the harness; NOT measured trials, not a result)', `trials: ${smoke.length}; repairs: ${repair.filter(r => r.kind === 'smoke' || r.kind === 'repair').length}`, judgeAll(smoke, manifest, opts), manifest) + '\n' + section(smoke, sRepairs, 'smoke, not measured'),
    resources: resources([...measured, ...smoke], repair),
  };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = n => process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : null;
  const paths = ledgerPaths(arg('data') ?? undefined), manifest = loadManifest(), out = build(readLines(paths.trials), manifest, { plan: arg('plan') });
  mkdirSync(join(repoRoot, 'results'), { recursive: true });
  for (const [name, text] of Object.entries({ campaign: out.campaign, smoke: out.smoke, resources: out.resources })) writeFileSync(join(repoRoot, `results/moodle-${name}.txt`), text);
  console.log('wrote results/moodle-campaign.txt, moodle-smoke.txt, moodle-resources.txt');
}
