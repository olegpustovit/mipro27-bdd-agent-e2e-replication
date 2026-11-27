#!/usr/bin/env node
// Stream E-moodle: rerun of the Moodle campaign cells (plan 6ac189f540b8, 16 Nov) on the current setup, at the campaign pin.
// A copy of scripts/moodle/campaign-run.mjs (arms A and C only) with the additions stream D's runner makes
// (followups-2026-11/d-moodle-replay/scripts/replay-run.mjs): own ledger, worker start, recorded versions, harness flags,
// token and deadline guards. The study code that runs a trial is unchanged and imported from the repository:
// adapters/moodle (adapter, states, Behat runner, arm-C hand-off, pre-authentication, prompt, verdict decoder, sandbox),
// scripts/ledger (trial ledger, attempt mechanism), scripts/moodle/mode.mjs (study mode, omp cost guard).
//
//   node single-run.mjs --arm A --states healthy,fault                       (16 cases x 1)
//   node single-run.mjs --arm C --model gpt-6-luna --states healthy --rep 1  (14 cases, one repetition)
//   --smoke: separate ledger (data/smoke-ledger), task key smoke:..., not measured; --cases limits the cases (smoke only)
//   --dry: print the trials and the harness flags, run nothing
//
// Trial key (as the campaign's): <short>/<break>.<scenario>/<healthy|fault:X>/<A|C>/<model|none>/r<k>, short = e-moodle-1.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url)), stream = join(here, '..'), repo = join(stream, '../../..');
const argOf = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const SMOKE = process.argv.includes('--smoke'), DRY = process.argv.includes('--dry');
process.env.STUDY_DATA_DIR = join(stream, SMOKE ? 'data/smoke-ledger' : 'data/ledger');
const imp = p => import(join(repo, p));
const { workerAdapter, loadManifest, isRunnablePair } = await imp('scripts/moodle/common.mjs');
const { ensureState } = await imp('adapters/moodle/states.mjs');
const { stateSpec, locateScenario, faultTarget, resolveTarget } = await imp('adapters/moodle/manifest.mjs');
const { runScenario } = await imp('adapters/moodle/behat-runner.mjs');
const { assertPinScenarioText } = await imp('adapters/moodle/scenario-text.mjs');
const { planHandoff, isDataStep } = await imp('adapters/moodle/handoff.mjs');
const { runTrials, foldTrials } = await imp('scripts/ledger/trials.mjs');
const { ensureDirs } = await imp('scripts/ledger/paths.mjs');
const { readLines } = await imp('scripts/ledger/jsonl.mjs');
const { createBlobStore } = await imp('scripts/ledger/blobstore.mjs');
const { modeFields, ompCostGuard } = await imp('scripts/moodle/mode.mjs');
const { assignGroups } = await imp('scripts/moodle/v1-plan.mjs');

export const SHORT = SMOKE ? 'e-moodle-smoke' : 'e-moodle-1';
export const WORKER = 'w2';   // a pin worker of this host (w1 is stream D's); measured jobs hold /tmp/mipro-next/run.lock
export const PIN = 'cfe123f26fc7071981fe949cb16cd5a08a8234f1';
// The campaign's 16 pairs (moodle-ledger/tasks.jsonl, campaign:moodle/moodle-campaign-20261116/*), in the campaign's order.
export const PAIRS = ['B07.X010@S028', 'B07.X011@S025', 'B07.X010@S029', 'B04.X014@S036', 'B04.X014@S037', 'B04.X014@S041', 'B15.X021@S094', 'B15.X022@S091',
  'B25.X020@S125', 'B27.X023@S131', 'B28.X025@S134', 'B28.X025@S137', 'B29.X026@S138', 'B29.X026@S139', 'B34.X018@S153', 'B34.X018@S154'];
// The campaign's setup exclusion ("Scenario has no leading data steps..."): the agents never reached these; arm C runs the other 14.
export const NO_AGENT = new Set(['B07.S025', 'B27.S131']);
export const TOKEN_CAP = 85e6, NEXT_RUN_RESERVE = 1.5e6;   // brief: stop starting agent runs if measured agent tokens + 1.5M would exceed 85M
export const DEADLINE = Date.parse('2026-11-28T18:00:00Z');

const parsePair = x => { const [bf, sc] = x.split('@'), [b, f] = bf.split('.'); return { break: b, fault: f, scenario: sc }; };
export function trialsFor({ arm, model, states, reps, onlyRep, cases }) {
  const out = [];
  for (const p of PAIRS.map(parsePair)) {
    const caseId = `${p.break}.${p.scenario}`;
    if (cases && !cases.includes(caseId)) continue;
    if (arm === 'C' && NO_AGENT.has(caseId)) continue;
    for (const s of states) {
      const state = s === 'healthy' ? 'healthy' : `fault:${p.fault}`, fault = s === 'healthy' ? null : p.fault;
      const base = { caseId, break: p.break, scenario: p.scenario, pairFault: p.fault, state, fault, arm, block: `${p.break}|${state}|${arm}` };
      if (arm === 'A') out.push({ ...base, model: 'none', rep: 1, key: `${SHORT}/${caseId}/${state}/A/none/r1` });
      else for (let r = 1; r <= reps; r++) if (onlyRep == null || r === onlyRep) out.push({ ...base, model, rep: r, key: `${SHORT}/${caseId}/${state}/C/${model}/r${r}` });
    }
  }
  return out;
}
export function agentTokens(events) {   // every attempt counts (input incl. cache reads + output)
  let n = 0;
  for (const t of foldTrials(events).trials.values()) for (const a of t.attempts) { const m = a.end?.meter; if (a.end?.arm === 'C' && m) n += (m.inputTokens ?? 0) + (m.outputTokens ?? 0); }
  return n;
}
const sh = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: 'utf8', timeout: 60000 }).trim(); } catch (e) { return `error: ${String(e.message).slice(0, 120)}`; } };
const pkgVersion = name => JSON.parse(readFileSync(join(repo, 'node_modules', name, 'package.json'), 'utf8')).version;

async function main() {
  const arm = argOf('arm'), model = argOf('model', null), states = argOf('states', 'healthy').split(',');
  const reps = Number(argOf('reps', 2)), onlyRep = argOf('rep', null) ? Number(argOf('rep')) : null, cases = argOf('cases', null)?.split(',') ?? null;
  if (!['A', 'C'].includes(arm) || (arm === 'C' && !model) || states.some(s => !['healthy', 'fault'].includes(s))) throw new Error('usage: --arm A|C [--model m] --states healthy[,fault] [--rep k]');
  if (cases && !SMOKE) throw new Error('--cases is for smoke checks only');
  const manifest = loadManifest(repo);
  for (const p of PAIRS.map(parsePair)) if (!isRunnablePair(manifest, p)) throw new Error(`${p.break}.${p.fault}@${p.scenario} is not a valid pair of the V1 report`);
  // Order as the campaign's job: (break, state, arm) groups kept together, larger groups first (assignGroups), trials shuffled inside a group by the ledger.
  const trials = (assignGroups(trialsFor({ arm, model, states, reps, onlyRep, cases }).map(t => ({ ...t, groupState: t.state, state: t.block })), [WORKER])[WORKER] ?? [])
    .map(({ groupState, group, ...t }) => ({ ...t, state: groupState, block: group }));
  const adapter = await workerAdapter(WORKER);
  // Harness flags (recorded, the harness is unchanged): data-setup steps after the first UI step are handed to the agent as UI steps.
  const flagsOf = spec => {
    const loc = locateScenario(manifest, spec.scenario, adapter.dirs.base);
    const plan = planHandoff(readFileSync(join(adapter.dirs.base, loc.feature), 'utf8'), { line: loc.line, name: loc.name });
    return plan.uiSteps.filter(x => isDataStep(x.text)).map(x => ({ index: x.index, text: x.text }));
  };
  if (DRY) { for (const t of trials) console.log(t.key, arm === 'C' ? JSON.stringify(flagsOf(t)) : ''); console.log(trials.length, 'trials'); return; }
  if (!trials.length) { console.log('no trials'); return; }
  const paths = ensureDirs(), blobs = createBlobStore({ root: paths.blobs });
  const taskKey = `${SMOKE ? 'smoke' : 'single'}:moodle/${SHORT}/${arm}${model ? '-' + model : ''}/${states.join('+')}${onlyRep ? `/r${onlyRep}` : ''}${cases ? '/' + cases.join('+') : ''}`;
  process.env.STUDY_TASK_KEY = taskKey;
  const release = adapter.lease(`single:${taskKey}`);
  try {
    const startInfo = await adapter.start();
    // After a kill -9 the previous job's `docker exec behat` may still run in the container and would race the next reset: stop it.
    await adapter.exec('webserver', ['pkill', '-KILL', '-f', 'vendor/bin/behat'], { check: false });
    const { run } = await imp('adapters/moodle/shell.mjs');
    const head = (await run('git', ['rev-parse', 'HEAD'], { cwd: adapter.dirs.src })).stdout.trim();
    if (head !== PIN) throw new Error(`worker tree at ${head}, expected the campaign pin ${PIN}`);
    const env = {
      worker: WORKER, moodleCommit: PIN, version: adapter.versionRecord(), runtime: adapter.state.runtime ?? null, start: startInfo,
      studyRepoHead: sh('git', ['-C', repo, 'rev-parse', 'HEAD']), studyRepoTrackedClean: sh('git', ['-C', repo, 'status', '--porcelain', '--untracked-files=no']) === '',
      cli: { codex: sh('codex', ['--version']), omp: sh('omp', ['--version']), node: process.version, bwrap: sh('bwrap', ['--version']), playwright: pkgVersion('playwright'), playwrightMcp: pkgVersion('@playwright/mcp') },
      host: sh('hostname', []), arch: process.arch, limits: arm === 'C' ? { toolCalls: 60, timeoutMs: 300000 } : null,
    };
    const tokenGuard = spec => { if (spec.arm !== 'C' || SMOKE) return null; const used = agentTokens(readLines(paths.trials)); return used + NEXT_RUN_RESERVE > TOKEN_CAP ? { reason: 'stream-token-cap', capTokens: TOKEN_CAP, usedTokens: used } : null; };
    const omp = ompCostGuard({ short: SHORT, trialsPath: paths.trials });
    async function runOne(spec) {
      const target = spec.fault ? resolveTarget(manifest, { target: faultTarget(manifest, spec.fault, spec.scenario) }, adapter.dirs.base) : null;
      const common = { single: SHORT, caseId: spec.caseId, state: spec.state, scenario: spec.scenario, break: spec.break, fault: spec.fault, rep: spec.rep,
        targetStepIndex: target?.behatIndex ?? null, targetMethod: target?.method ?? null,
        targetStepText: target?.method === 'text' ? faultTarget(manifest, spec.fault, spec.scenario).step_text : null, env };
      const st = await ensureState(adapter, stateSpec(manifest, spec.state));
      const loc = locateScenario(manifest, spec.scenario, adapter.dirs.src);   // after the state: the line is only valid in the tree the scenario runs in
      const scenarioTextSha256 = await assertPinScenarioText(adapter.dirs.src, loc);   // the same scenario text for every arm
      if (spec.arm === 'A') {
        const r = await runScenario(adapter, { feature: loc.feature, line: loc.line, reset: true }), sc = r.scenarios[0], f = sc?.failingStep ?? null;
        const ok = !sc || loc.kind !== 'scenario' || sc.name === loc.name;
        return { ...common, arm: 'A', model: 'none', scenarioTextSha256, stateChanged: st.changed, status: ok ? r.status : 'error', ...(ok ? {} : { wrongScenario: true }),
          ran: sc && { name: sc.name, line: sc.line, expectedLine: loc.line }, failingStepIndex: r.failingStepIndex, stepCount: sc?.steps.length ?? 0,
          failingStep: f && { index: f.index, text: f.text, error: String(f.error ?? '').slice(0, 400) }, stdoutTail: r.status === 'error' ? r.stdoutTail.slice(-1500) : undefined,
          scenarioWallMs: r.wallMs, wall: { fixtureMs: 0 } };
      }
      await (await imp('adapters/moodle/agent-run.mjs')).useModel(spec.model);   // pins STUDY_MODEL before scripts/codex-boundary.mjs is first imported
      const { runArmC } = await imp('adapters/moodle/arm-c.mjs');
      const handedSetupSteps = flagsOf(spec), harnessFlags = handedSetupSteps.length ? ['harness-setup-step-handed-to-agent'] : [];
      const r = await runArmC({ adapter, feature: loc.feature, line: loc.line, model: spec.model });
      if (r.status === 'unresolved' && (r.toolCalls ?? 0) > 60) harnessFlags.push('tool-budget');
      const { rawEvents, ...rest } = r;
      const blob = await blobs.attach(spec.key, 'cli-rollout', 'agent-events.jsonl', Buffer.from(rawEvents ?? ''), { model: spec.model });
      return { ...rest, ...common, scenarioTextSha256, stateChanged: st.changed, harnessFlags, handedSetupSteps, eventsBlob: blob?.sha256 ?? null };
    }
    const result = await runTrials({ taskKey, trials, seed: `${SHORT}-${taskKey}`, shuffleBlocks: false, paths,
      runOne: async spec => ({ ...(await runOne(spec)), ...modeFields(), ...(SMOKE ? { smoke: 'technical smoke check, not a measured trial' } : {}) }),
      shouldStop: spec => (Date.now() >= DEADLINE ? { reason: 'deadline', deadline: '2026-11-28T18:00:00Z' } : null) ?? tokenGuard(spec) ?? omp(spec) });
    console.log(JSON.stringify({ taskKey, ...result, results: result.results.map(x => `${x.key} ${x.outcome}`) }));
  } finally {
    try { await adapter.revertDiff(); } catch (e) { console.error('final revert failed:', e.message); }
    release();
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
