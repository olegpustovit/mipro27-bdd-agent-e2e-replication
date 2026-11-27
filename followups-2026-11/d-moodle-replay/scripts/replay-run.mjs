#!/usr/bin/env node
// Stream D: replay of real Moodle interface changes (B04, B07, B15) on the Moodle commits just before and just after each change.
// One ledger job per (build, arm[, model]); every trial is one Behat run (arm A) or one browser-agent run (arm C) with the unchanged
// study code: adapters/moodle (adapter, Behat runner, arm-C hand-off, prompt, verdict decoder, sandbox) and scripts/ledger (trial ledger).
//
//   node scripts/replay-run.mjs --build B04:post --arm C --model gpt-6-luna --states healthy [--reps 2]
//   node scripts/replay-run.mjs --build B04:post --arm A --states healthy,fault
//
// Arms:   A-old = developers' step definitions as they were BEFORE the change (pre build: the tree itself; post build: the tree with the
//                 change's step-definition hunks reverted, data/patches/<B>.old-steps-at-post.patch, verified equal to the pre file)
//         A-new = developers' step definitions after the change (post build only: the tree itself)
//         C     = browser agent (same harness, prompt, 60 tool calls, 300 s, models as campaign 6ac189f540b8)
// States: healthy | fault:<X> (post build only; the seeded fault patch of the campaign, applied unchanged; B15 with the public/ prefix removed)
// Ledger: STUDY_DATA_DIR=<stream>/data/ledger (set by this script). Trial key: replay-d1/<B>.<S>/<pre|post>/<state>/<arm>/<model|none>/r<k>.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url)), stream = join(here, '..'), repo = join(stream, '../..');
process.env.STUDY_DATA_DIR = process.env.REPLAY_LEDGER_DIR || join(stream, 'data/ledger');   // smoke checks use a separate directory
const imp = p => import(join(repo, p));
const { MoodleAdapter } = await imp('adapters/moodle/adapter.mjs');
const { run } = await imp('adapters/moodle/shell.mjs');
const { runScenario } = await imp('adapters/moodle/behat-runner.mjs');
const { ensureStateText } = await imp('adapters/moodle/state-text.mjs');
const { loadManifest, faultTarget, resolveTarget } = await imp('adapters/moodle/manifest.mjs');
const { parseFeature, effectiveSteps } = await imp('adapters/moodle/gherkin.mjs');
const { applyRuntime, RUNTIME_OF } = await import(join(here, 'runtime.mjs'));
const { scenarioTextSha } = await imp('adapters/moodle/scenario-text.mjs');
const { runTrials, foldTrials } = await imp('scripts/ledger/trials.mjs');
const { ensureDirs } = await imp('scripts/ledger/paths.mjs');
const { readLines } = await imp('scripts/ledger/jsonl.mjs');
const { createBlobStore } = await imp('scripts/ledger/blobstore.mjs');
const { modeFields, ompCostGuard } = await imp('scripts/moodle/mode.mjs');

export const SHORT = 'replay-d1';
export const PIN = 'cfe123f26fc7071981fe949cb16cd5a08a8234f1';
export const BUILDS = {
  B04: { pre: '746815af497517c350cff2753bfb386a99cd1d33', post: '6200c31f94c9216f32902e263620f545250ad9ab' },
  B07: { pre: 'c87bae8d3979b9e2f131e7d237dd42c2f49d6810', post: '9105de4c3336e35798be4bffb37d1a410bd8f8c2' },
  B15: { pre: 'd65e24a62c0dc3995f9b88eed0d3a4153bb1a290', post: '88dbf8a0d99c4798504eb226b4490d05c908ed8e' },
  // Amendment A1: Moodle 4.0dev (2021), second runtime (scripts/runtime.mjs)
  B25: { pre: '51149a78cc0430ca538ba7f1bfdf381a9616ade4', post: 'e0f584d64ccf753a3d09208708eb996cd2a5c975' },
  B27: { pre: '24d0983142bc8e632c4a6eff67c1567661243300', post: '306a778855ee006abeea4c643ba126ed62638da8' },
  B28: { pre: '1464843a25ee9dfe2dd9121e47a98710a64e038a', post: '6cce0bf42ed688d127afb6c7891b46c3c9547564' },
  B29: { pre: '30b8ad51f424afbc4c7a03d0d579920d0cba97dd', post: 'e3690a392dedc33a3b9e95e343aa3984edb87b80' },
};
// The campaign's pairs of these changes (plan 6ac189f540b8). agent:false = the campaign's setup exclusion (no leading data steps).
export const CASES = {
  B04: [{ s: 'S036', fault: 'X014' }, { s: 'S037', fault: 'X014' }, { s: 'S041', fault: 'X014' }],
  B07: [{ s: 'S028', fault: 'X010' }, { s: 'S025', fault: 'X011', agent: false }, { s: 'S029', fault: 'X010' }],
  B15: [{ s: 'S094', fault: 'X021' }, { s: 'S091', fault: 'X022' }],
  // A1. text 'historical' = the scenario as it existed at pre/post (differs from the pin); expected canonical-text sha prefix from
  // feasibility/scenario-presence.tsv. fault null = the campaign's fault does not apply at post (not run).
  B25: [{ s: 'S125', fault: 'X020', text: 'historical', textSha: '160dd7068de8' }],
  B27: [{ s: 'S131', fault: null, agent: false }],
  B28: [{ s: 'S134', fault: 'X025' }, { s: 'S137', fault: 'X025', text: 'historical', textSha: 'f8fbf3d1ef98' }],
  B29: [{ s: 'S138', fault: null, text: 'historical', textSha: '0be14ad93716' }, { s: 'S139', fault: null, text: 'historical', textSha: 'c2b87f7c9ad8' }],
};
// Step-definition patches on the post build: A-old = the step definitions before the change; A-new = after the developers' fix.
// B28's UI commit kept the old step definitions; the developers fixed them in the later commit 8662be1d (B28.test.diff).
const OLD_AT_POST = { B04: 'B04.old-steps-at-post.patch', B07: 'B07.old-steps-at-post.patch', B15: 'B15.old-steps-at-post.patch', B25: 'B25.old-steps-at-post.patch', B27: 'B27.old-steps-at-post.patch', B28: null, B29: 'B29.old-steps-at-post.patch' };
const NEW_AT_POST = { B28: 'B28.new-steps-at-post.patch' };
const FAULT_PATCH = { X014: 'X014.fault.patch', X010: 'X010.fault.patch', X011: 'X011.fault.patch', X021: 'X021.fault.nopublic.patch', X022: 'X022.fault.nopublic.patch', X020: 'X020.fault.nopublic.patch', X025: 'X025.fault.nopublic.patch' };
export const TOKEN_CAP = Number(process.env.REPLAY_TOKEN_CAP || 95e6);   // agent tokens (input incl. cache + output), stream D total; 80M in plan.md, 95M by amendment A1
export const DEADLINE = Date.parse('2026-11-28T12:00:00Z');   // plan.md: no run starts after the cut-off
const NEXT_RUN_RESERVE = 1.5e6;          // a single run may use up to ~1.2M (campaign max); do not start a run that could cross the cap

const argOf = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const sha = t => createHash('sha256').update(t).digest('hex');
const patchText = name => readFileSync(join(stream, 'data/patches', name), 'utf8');
const manifest = loadManifest(repo), pinSrc = join(process.env.HOME, '.local/share/cucumber-study/moodle/src', PIN.slice(0, 12));
const featureIn = (src, s) => { const f = manifest.scenarioById.get(s).feature.replace(/^public\//, ''); return existsSync(join(src, 'public', f)) ? `public/${f}` : f; };
function locate(src, s) {
  const sc = manifest.scenarioById.get(s), feature = featureIn(src, s), text = readFileSync(join(src, feature), 'utf8');
  const hits = parseFeature(text).scenarios.filter(x => x.name === sc.name);
  if (hits.length !== 1) throw new Error(`Scenario ${s} "${sc.name}": ${hits.length} matches in ${feature}`);
  return { id: s, feature, line: hits[0].line, name: sc.name, kind: hits[0].kind, textSha: scenarioTextSha(text, sc.name) };
}
// Every arm on every build must run the same scenario text as the campaign (the pin's developers' Gherkin).
function assertCampaignText(loc) {
  const pin = scenarioTextSha(readFileSync(join(pinSrc, featureIn(pinSrc, loc.id)), 'utf8'), loc.name);
  if (pin !== loc.textSha) throw new Error(`Scenario text of ${loc.id} differs from the campaign's (${loc.textSha.slice(0, 12)} vs ${pin.slice(0, 12)})`);
  return loc.textSha;
}
// A1: historical text must be the text recorded for the pre and post commits in feasibility/scenario-presence.tsv.
function assertHistoricalText(loc, expectedPrefix) {
  if (!loc.textSha.startsWith(expectedPrefix)) throw new Error(`Scenario text of ${loc.id} is ${loc.textSha.slice(0, 12)}, expected the historical ${expectedPrefix}`);
  return loc.textSha;
}
// Fault target as a Behat step index. Campaign text: resolved on the campaign pin (same text, same index). Historical text: the step whose
// text equals the fault's target step text (closest to background + step_index), on the tree that runs; none = null (pair invalid, rule F).
function targetOf(fault, s, c, src) {
  const t = faultTarget(manifest, fault, s);
  if (c.text !== 'historical') return resolveTarget(manifest, { target: t }, pinSrc).behatIndex;
  const sc = manifest.scenarioById.get(s), feature = parseFeature(readFileSync(join(src, featureIn(src, s)), 'utf8')), x = feature.scenarios.find(y => y.name === sc.name);
  const steps = effectiveSteps(feature, x), background = steps.filter(y => y.background).length, nominal = background + t.step_index;
  const hits = steps.filter(y => y.text === t.step_text).sort((a, b) => Math.abs(a.index - nominal) - Math.abs(b.index - nominal));
  return hits.length ? hits[0].index : null;
}

export function trialsFor({ change, build, arm, model, states, reps }) {
  const out = [];
  for (const c of CASES[change]) for (const state of states) {
    if (state !== 'healthy' && (build !== 'post' || !c.fault)) continue;
    const st = state === 'healthy' ? 'healthy' : `fault:${c.fault}`;
    const base = { change, build, scenario: c.s, state: st, fault: st === 'healthy' ? null : c.fault, text: c.text ?? 'campaign' };
    if (arm === 'A') {
      out.push({ ...base, arm: 'A-old', model: 'none', rep: 1, key: `${SHORT}/${change}.${c.s}/${build}/${st}/A-old/none/r1` });
      if (build === 'post') out.push({ ...base, arm: 'A-new', model: 'none', rep: 1, key: `${SHORT}/${change}.${c.s}/${build}/${st}/A-new/none/r1` });
    } else {
      if (c.agent === false) continue;
      for (let r = 1; r <= reps; r++) out.push({ ...base, arm: 'C', model, rep: r, key: `${SHORT}/${change}.${c.s}/${build}/${st}/C/${model}/r${r}` });
    }
  }
  return out;
}
// Pre-registered validity of a faulty post pair (plan.md, rule F): the developers' updated step definitions (A-new) on the faulty post
// build fail at the fault's target step. Agents run a faulty pair only when that A-new run is recorded and valid.
export function faultValid(events, change, scenario, fault) {
  const t = foldTrials(events).trials.get(`${SHORT}/${change}.${scenario}/post/fault:${fault}/A-new/none/r1`);
  if (!t?.end) return { known: false };
  return { known: true, valid: t.end.status === 'failed' && t.end.failingStepIndex === t.end.targetStepIndex, status: t.end.status, failingStepIndex: t.end.failingStepIndex, target: t.end.targetStepIndex };
}
export function agentTokens(events) {
  let n = 0;
  for (const t of foldTrials(events).trials.values()) for (const a of t.attempts) { const m = a.end?.meter; if (a.end?.arm === 'C' && m) n += (m.inputTokens ?? 0) + (m.outputTokens ?? 0); }
  return n;
}

async function main() {
  const [change, build] = argOf('build').split(':'), arm = argOf('arm'), model = argOf('model', null), reps = Number(argOf('reps', 2)), onlyRep = argOf('rep', null) ? Number(argOf('rep')) : null;
  const states = argOf('states', 'healthy').split(','), commit = BUILDS[change]?.[build];
  if (!commit || !['A', 'C'].includes(arm) || (arm === 'C' && !model)) throw new Error('usage: --build <B>:<pre|post> --arm A|C [--model m] --states healthy[,fault]');
  const paths = ensureDirs(), blobs = createBlobStore({ root: paths.blobs });
  let trials = trialsFor({ change, build, arm, model, states, reps: onlyRep ?? reps }).filter(t => onlyRep == null || t.arm !== 'C' || t.rep === onlyRep);
  if (arm === 'C') {   // faulty pairs: only those screened valid by rule F
    const ev = readLines(paths.trials);
    trials = trials.filter(t => { if (t.state === 'healthy') return true; const v = faultValid(ev, change, t.scenario, t.fault); if (!v.known) throw new Error(`Run arm A faulty ${change}.${t.scenario} first (rule F)`); if (!v.valid) console.error(`skip ${t.key}: fault not valid at post (${JSON.stringify(v)})`); return v.valid; });
  }
  if (!trials.length) { console.log(JSON.stringify({ change, build, arm, model, trials: 0 })); return; }
  const taskKey = `replay:moodle/${SHORT}/${change}-${build}/${arm}${model ? '-' + model : ''}/${states.join('+')}${onlyRep ? `/r${onlyRep}` : ''}`;
  const runtime = await applyRuntime(repo, RUNTIME_OF[change]);
  const bind = process.env.STUDY_MOODLE_BIND || (await run('docker', ['network', 'inspect', 'bridge', '--format', '{{(index .IPAM.Config 0).Gateway}}'], { check: false })).stdout.trim() || '127.0.0.1';
  const adapter = new MoodleAdapter({ worker: 'w1', moodleCommit: commit, bind }), release = adapter.lease(`replay:${taskKey}`);
  const startInfo = await adapter.start();
  await adapter.exec('webserver', ['pkill', '-KILL', '-f', 'vendor/bin/behat'], { check: false });
  const head = (await run('git', ['rev-parse', 'HEAD'], { cwd: adapter.dirs.src })).stdout.trim();
  if (head !== commit) throw new Error(`worker tree at ${head}, expected ${commit}`);
  const env = { runtimeImages: runtime, moodleCommit: commit, build, change, version: adapter.versionRecord(), runtime: adapter.state.runtime ?? null, start: startInfo, studyRepoHead: (await run('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim() };
  const oldSteps = build === 'post' && OLD_AT_POST[change] ? patchText(OLD_AT_POST[change]) : '';
  const newSteps = build === 'post' && NEW_AT_POST[change] ? patchText(NEW_AT_POST[change]) : '';
  const tokenGuard = spec => { if (spec.arm !== 'C') return null; const used = agentTokens(readLines(paths.trials)); return used + NEXT_RUN_RESERVE > TOKEN_CAP ? { reason: 'stream-token-cap', capTokens: TOKEN_CAP, usedTokens: used } : null; };
  const omp = ompCostGuard({ short: SHORT, trialsPath: paths.trials });
  async function runOne(spec) {
    const fault = spec.fault ? patchText(FAULT_PATCH[spec.fault]) : '';
    const c = CASES[spec.change].find(x => x.s === spec.scenario);
    const text = [spec.arm === 'A-old' ? oldSteps : spec.arm === 'A-new' ? newSteps : '', fault].filter(Boolean).map(t => t.endsWith('\n') ? t : t + '\n').join('');
    const st = await ensureStateText(adapter, text);
    const patchSha256 = text ? sha(text) : null;
    const loc = locate(adapter.dirs.src, spec.scenario), scenarioTextSha256 = c.text === 'historical' ? assertHistoricalText(loc, c.textSha) : assertCampaignText(loc);
    const target = spec.fault ? targetOf(spec.fault, spec.scenario, c, adapter.dirs.src) : null;
    const common = { replay: SHORT, scenarioText: c.text ?? 'campaign', change: spec.change, build: spec.build, moodleCommit: commit, scenario: spec.scenario, state: spec.state, fault: spec.fault, targetStepIndex: target, patchSha256, stateChanged: st.changed, scenarioTextSha256, feature: loc.feature, env };
    if (spec.arm !== 'C') {
      const r = await runScenario(adapter, { feature: loc.feature, line: loc.line, reset: true }), sc = r.scenarios[0], f = sc?.failingStep ?? null;
      const ok = !sc || loc.kind !== 'scenario' || sc.name === loc.name;
      return { ...common, arm: spec.arm, model: 'none', status: ok ? r.status : 'error', ...(ok ? {} : { wrongScenario: true }), ran: sc && { name: sc.name, line: sc.line, expectedLine: loc.line },
        failingStepIndex: r.failingStepIndex, stepCount: sc?.steps.length ?? 0, failingStep: f && { index: f.index, text: f.text, error: String(f.error ?? '').slice(0, 400) },
        stdoutTail: r.status === 'error' ? r.stdoutTail.slice(-1500) : undefined, scenarioWallMs: r.wallMs, wall: { fixtureMs: 0 } };
    }
    await (await imp('adapters/moodle/agent-run.mjs')).useModel(spec.model);
    const { runArmC } = await imp('adapters/moodle/arm-c.mjs');
    // Amendment A2 flag (recorded, harness unchanged): a data-setup step after the first UI step is handed to the agent as a UI step.
    const { planHandoff, isDataStep } = await imp('adapters/moodle/handoff.mjs');
    const plan = planHandoff(readFileSync(join(adapter.dirs.src, loc.feature), 'utf8'), { line: loc.line, name: loc.name });
    const handedSetupSteps = plan.uiSteps.filter(x => isDataStep(x.text)).map(x => ({ index: x.index, text: x.text }));
    const harnessFlags = handedSetupSteps.length ? ['harness-setup-step-handed-to-agent'] : [];
    const r = await runArmC({ adapter, feature: loc.feature, line: loc.line, model: spec.model });
    if (r.status === 'unresolved' && (r.toolCalls ?? 0) > 60) harnessFlags.push('tool-budget');
    const { rawEvents, ...rest } = r;
    const blob = await blobs.attach(spec.key, 'cli-rollout', 'agent-events.jsonl', Buffer.from(rawEvents ?? ''), { model: spec.model });
    return { ...rest, ...common, arm: 'C', harnessFlags, handedSetupSteps, eventsBlob: blob?.sha256 ?? null };
  }
  try {
    const result = await runTrials({ taskKey, trials, seed: `${SHORT}-${taskKey}`, shuffleBlocks: false, paths,
      runOne: async spec => ({ ...(await runOne(spec)), ...modeFields() }), shouldStop: spec => (Date.now() >= DEADLINE ? { reason: 'deadline', deadline: '2026-11-28T12:00:00Z' } : null) ?? tokenGuard(spec) ?? omp(spec) });
    console.log(JSON.stringify({ taskKey, ...result, results: result.results.map(x => `${x.key} ${x.outcome}`) }));
  } finally { try { await adapter.revertDiff(); } catch (e) { console.error('final revert failed:', e.message); } release(); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
