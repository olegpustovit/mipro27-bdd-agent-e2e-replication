// Task ledger (tasks.jsonl): plan freezing, claim/start/resume/cancel and status.
// States: planned -> claimed -> running -> done | failed | interrupted. All decisions are taken under tasks.lock.
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync, existsSync, rmSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { ensureDirs } from './paths.mjs';
import { transaction, append, readLines } from './jsonl.mjs';
import { parseTaskKey, unitName, fileSafe } from './keys.mjs';
import { computePlan, diffInputs, defaultRepoRoot } from './plan.mjs';
import { pidAlive, pidStart } from './process.mjs';
import { REAP_ENV, reapTagged } from './reap.mjs';
import { foldTrials, trialStatus } from './trials.mjs';

export const HEARTBEAT_MS = () => Number(process.env.STUDY_HEARTBEAT_MS) || 15000;
export const DEAD_LEASE_MS = () => Number(process.env.STUDY_DEAD_LEASE_MS) || 120000;
const LIVE = new Set(['claimed', 'running']);
const TERMINAL = { 'task-done': 'done', 'task-failed': 'failed', 'task-interrupted': 'interrupted' };
const now = () => new Date().toISOString();
const studyScript = fileURLToPath(new URL('../study.mjs', import.meta.url));

export function foldTasks(events) {
  const plans = new Map(), tasks = new Map();
  for (const e of events) {
    if (e.type === 'plan-frozen') { plans.set(e.plan, e); continue; }
    const t = tasks.get(e.key);
    if (e.type === 'task-planned') { if (!t) tasks.set(e.key, { key: e.key, base: e.base, plan: e.plan, planHash: e.planHash, cmd: e.cmd, cwd: e.cwd, reason: e.reason ?? null, rerunOf: e.rerunOf ?? null, state: 'planned', attempt: 0, lease: null, terminal: null, cancel: null }); continue; }
    if (!t) continue;
    if (e.type === 'task-claimed') { t.prevState = t.state; t.state = 'claimed'; t.attempt = e.attempt; t.lease = { ...e.lease, attempt: e.attempt, resume: !!e.resume, pid: null, pidStart: null }; t.terminal = null; t.cancel = null; }
    else if (e.attempt !== t.attempt) continue;
    else if (e.type === 'task-running' && t.state === 'claimed') { t.state = 'running'; Object.assign(t.lease, { pid: e.pid, pidStart: e.pidStart, host: e.host, runningAt: e.at }); }
    else if (TERMINAL[e.type] && LIVE.has(t.state)) { t.state = TERMINAL[e.type]; t.terminal = e; }
    else if (e.type === 'task-launch-failed' && t.state === 'claimed') { t.state = t.prevState; t.lease = null; t.launchError = e.error; }
    else if (e.type === 'task-cancel-requested') t.cancel = e;
  }
  return { plans, tasks };
}

export const heartbeatPath = (paths, key) => join(paths.heartbeats, fileSafe(key) + '.json');
export function readHeartbeat(paths, key) { try { return JSON.parse(readFileSync(heartbeatPath(paths, key), 'utf8')); } catch { return null; } }
function writeHeartbeat(paths, key, body) {
  const file = heartbeatPath(paths, key), tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(body)); renameSync(tmp, file);
}

// Lease view. alive = !dead. A lease is dead only when its pid is gone (or on another host: unknowable, so heartbeat only)
// AND the last sign of life (heartbeat, else claim time) is older than DEAD_LEASE_MS.
export function leaseView(task, paths, { at = Date.now(), deadMs = DEAD_LEASE_MS() } = {}) {
  if (!task.lease || !LIVE.has(task.state)) return { live: false };
  const hb = readHeartbeat(paths, task.key);
  const lastMs = Math.max(Date.parse(task.lease.startedAt) || 0, hb && hb.attempt === task.attempt ? Date.parse(hb.at) || 0 : 0);
  const sameHost = task.lease.host === hostname();
  const pidKnown = task.lease.pid != null;
  const pidIsAlive = sameHost ? (pidKnown ? pidAlive(task.lease.pid, task.lease.pidStart) : false) : null;
  const ageMs = at - lastMs;
  const dead = (pidIsAlive === false || pidIsAlive === null) && ageMs > deadMs;
  return { live: true, dead, alive: !dead, pidAlive: pidIsAlive, heartbeatAgeMs: ageMs, lastBeatAt: new Date(lastMs).toISOString(), sameHost };
}

// ---- systemd / spawn ----
export function systemdAvailable() {
  if (process.env.STUDY_LAUNCHER) return process.env.STUDY_LAUNCHER === 'systemd';
  try { execFileSync('systemctl', ['--user', 'show', '--property=Version'], { stdio: 'ignore', timeout: 5000 }); return true; } catch { return false; }
}
export function unitExists(unit) {
  if (!systemdAvailable()) return false;
  try {
    const out = execFileSync('systemctl', ['--user', 'show', `${unit}.service`, '--property=LoadState,ActiveState'], { encoding: 'utf8', timeout: 5000 });
    const p = Object.fromEntries(out.trim().split('\n').map(l => l.split('=')));
    return p.LoadState !== 'not-found' || ['active', 'activating', 'deactivating'].includes(p.ActiveState);
  } catch { return false; }
}
function launch({ unit, key, attempt, cwd, paths }) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('STUDY_') || ['PATH', 'HOME', 'XDG_RUNTIME_DIR', 'LANG'].includes(k)));
  env.STUDY_DATA_DIR = paths.dir;
  const args = [studyScript, 'task', 'exec', key, '--attempt', String(attempt)];
  if (systemdAvailable()) {
    const sd = ['--user', `--unit=${unit}`, '--collect', '--quiet', `--working-directory=${cwd}`, ...Object.entries(env).map(([k, v]) => `--setenv=${k}=${v}`), process.execPath, ...args];
    execFileSync('systemd-run', sd, { stdio: ['ignore', 'ignore', 'pipe'], timeout: 20000 });
    return { launcher: 'systemd' };
  }
  const log = openSync(join(paths.logs, `${fileSafe(key)}.launcher.log`), 'a');
  const child = spawn(process.execPath, args, { cwd, env, detached: true, stdio: ['ignore', log, log] });
  child.unref(); closeSync(log);
  return { launcher: 'spawn', pid: child.pid };
}

// ---- plan ----
export async function freezePlan(manifestPath, { paths = ensureDirs(), root = defaultRepoRoot() } = {}) {
  const plan = await computePlan(manifestPath, { root });
  return transaction(paths.tasks, paths.tasksLock, events => {
    const { plans, tasks } = foldTasks(events), prior = plans.get(plan.name);
    if (prior && prior.hash !== plan.hash) throw new Error(`Plan ${plan.name} is already frozen with a different hash (${prior.short}, now ${plan.short}); changed: ${diffInputs(prior.inputs, plan.inputs).join(', ') || 'unknown'}. A changed plan needs a new plan name.`);
    const out = [];
    if (!prior) out.push({ type: 'plan-frozen', plan: plan.name, hash: plan.hash, short: plan.short, inputs: plan.inputs, manifestPath: plan.manifestPath, at: now() });
    for (const t of plan.inputs.manifest.tasks ?? []) {
      const { base } = parseTaskKey(t.key);
      if (!tasks.has(t.key)) out.push({ type: 'task-planned', key: t.key, base, plan: plan.name, planHash: plan.hash, cmd: t.cmd, cwd: t.cwd ?? root, ...(t.gatePassExists === false ? { gatePassExists: false, studyMode: t.studyMode ?? null } : {}), at: now() });
    }
    return { append: out, result: { status: prior ? 'already-frozen' : 'frozen', plan: plan.name, hash: plan.hash, short: plan.short, tasks: (plan.inputs.manifest.tasks ?? []).map(t => t.key), sourcePinCount: Object.keys(plan.inputs.sourcePins).length, models: plan.inputs.models, cliVersions: plan.inputs.cliVersions } };
  });
}
async function verifyPlan(task, plans, root) {
  const frozen = plans.get(task.plan);
  if (!frozen) throw new Error(`Plan ${task.plan} is not frozen; run: study plan freeze <manifest>`);
  if (frozen.hash !== task.planHash) throw new Error(`Task ${task.key} was planned against plan hash ${task.planHash.slice(0, 12)} but ${task.plan} is frozen as ${frozen.short}`);
  const current = await computePlan(frozen.manifestPath, { root });
  if (current.hash !== frozen.hash) throw new Error(`Plan or pins changed since freeze (${frozen.short} -> ${current.short}); changed: ${diffInputs(frozen.inputs, current.inputs).join(', ')}`);
}
const attachHint = (t, paths) => `attach: journalctl --user -fu ${t.lease?.unit ?? unitName(t.key)}  or  tail -f ${join(paths.logs, fileSafe(t.key))}.attempt-${t.attempt}.log`;

// ---- start / resume ----
async function claim({ key, resume, plan: planName, cmd, cwd, reason, paths, root }) {
  const info = parseTaskKey(key), unit = unitName(key);
  // Plan identity is computed outside the lock (it can spawn CLIs); the decision is re-taken under the lock.
  const pre = foldTasks(readLines(paths.tasks));
  const known = pre.tasks.get(key), name = known?.plan ?? planName;
  if (!name) throw new Error(`Task ${key} is not planned: pass --plan <name> --cmd ...`);
  const frozenPre = pre.plans.get(name);
  if (!frozenPre) throw new Error(`Plan ${name} is not frozen; run: study plan freeze <manifest>`);
  const current = await computePlan(frozenPre.manifestPath, { root });
  const claimed = await transaction(paths.tasks, paths.tasksLock, events => {
    const { plans, tasks } = foldTasks(events), out = [];
    let t = tasks.get(key);
    const frozen = plans.get(name);
    if (current.hash !== frozen.hash) throw new Error(`Refusing ${key}: plan or pins changed since freeze (${frozen.short} -> ${current.short}); changed: ${diffInputs(frozen.inputs, current.inputs).join(', ')}`);
    if (!t) {
      if (resume) throw new Error(`Task ${key} does not exist; nothing to resume`);
      if (!cmd?.length) throw new Error(`Task ${key} is not planned: pass --cmd`);
      let rerunOf = null;
      if (info.rerun > 1) {
        if (!reason) throw new Error(`Re-run ${key} needs --reason (a deliberate re-run is recorded with its reason)`);
        rerunOf = info.rerun === 2 ? info.base : `${info.base}#${info.rerun - 1}`;
        const prev = tasks.get(rerunOf);
        if (!prev) throw new Error(`Re-run ${key}: ${rerunOf} does not exist`);
        if (LIVE.has(prev.state)) throw new Error(`Re-run ${key}: ${rerunOf} is still ${prev.state}`);
      } else if (reason) { /* reason on a first run is just a note */ }
      out.push({ type: 'task-planned', key, base: info.base, plan: name, planHash: frozen.hash, cmd, cwd: cwd ?? root, reason: reason ?? null, rerunOf, at: now() });
      t = { key, state: 'planned', attempt: 0, plan: name, planHash: frozen.hash, cmd, cwd: cwd ?? root };
    } else if (t.planHash !== frozen.hash) throw new Error(`Task ${key} was planned against a different plan hash (${t.planHash.slice(0, 12)} vs ${frozen.short})`);
    const view = leaseView(t, paths);
    if (t.state === 'done') throw new Error(`Refusing: ${key} is done (a key is one piece of work forever). A deliberate re-run needs key ${info.base}#${info.rerun + 1} with --reason.`);
    if (!resume) {
      if (t.state !== 'planned') {
        if (LIVE.has(t.state) && view.alive) throw new Error(`Refusing: ${key} has a live lease (${t.lease.unit}, pid ${t.lease.pid ?? 'starting'}, last beat ${Math.round(view.heartbeatAgeMs / 1000)}s ago); ${attachHint(t, paths)}`);
        throw new Error(`Refusing start: ${key} is ${t.state}; use: study task resume ${key}`);
      }
    } else {
      if (t.state === 'planned') throw new Error(`Refusing resume: ${key} never started; use: study task start ${key}`);
      if (LIVE.has(t.state)) {
        if (view.alive) throw new Error(`Refusing resume: ${key} lease is alive (${view.pidAlive === false ? `pid gone but heartbeat only ${Math.round(view.heartbeatAgeMs / 1000)}s old; wait until it is older than ${DEAD_LEASE_MS() / 1000}s` : `pid ${t.lease.pid} running`}); ${attachHint(t, paths)}`);
        out.push({ type: 'task-interrupted', key, attempt: t.attempt, reason: `lease dead: pid ${t.lease.pid ?? 'never started'} gone, last heartbeat ${view.lastBeatAt}`, synthesized: true, at: now() });
      }
    }
    const lease = { host: hostname(), unit, startedAt: now(), claimerPid: process.pid };
    if (unitExists(unit)) throw new Error(`Refusing: systemd unit ${unit} already exists; ${attachHint({ ...t, key, lease }, paths)}`);
    const attempt = (t.attempt ?? 0) + 1;
    out.push({ type: 'task-claimed', key, attempt, resume: !!resume, lease, at: now() });
    return { append: out, result: { key, attempt, unit, cwd: t.cwd, cmd: t.cmd } };
  });
  // A resume follows a dead lease (checked above): processes still tagged with this task belong to the dead attempt, e.g. a Chromium
  // that outlived a SIGKILLed job. Kill them before the next attempt starts its own browser and takes the same worker.
  if (resume) await reapTagged(key);
  try {
    const launched = launch({ unit: claimed.unit, key, attempt: claimed.attempt, cwd: claimed.cwd, paths });
    return { ...claimed, ...launched, resume: !!resume };
  } catch (error) {
    const detail = String(error.stderr || error.message).trim().slice(0, 500);
    await append(paths.tasks, paths.tasksLock, { type: 'task-launch-failed', key, attempt: claimed.attempt, error: detail, at: now() });
    throw new Error(`Launch failed for ${key}: ${detail}`);
  }
}
export const startTask = opts => claim({ ...opts, resume: false, paths: opts.paths ?? ensureDirs(), root: opts.root ?? defaultRepoRoot() });
export const resumeTask = opts => claim({ ...opts, resume: true, paths: opts.paths ?? ensureDirs(), root: opts.root ?? defaultRepoRoot() });

// ---- cancel ----
export async function cancelTask({ key, reason, paths = ensureDirs(), waitMs = 30000 }) {
  if (!reason) throw new Error('cancel needs --reason');
  const t = await transaction(paths.tasks, paths.tasksLock, events => {
    const task = foldTasks(events).tasks.get(key);
    if (!task) throw new Error(`Unknown task ${key}`);
    if (!LIVE.has(task.state)) throw new Error(`Task ${key} is ${task.state}; nothing to cancel`);
    return { append: [{ type: 'task-cancel-requested', key, attempt: task.attempt, reason, at: now() }], result: task };
  });
  if (systemdAvailable() && unitExists(t.lease.unit)) { try { execFileSync('systemctl', ['--user', 'stop', `${t.lease.unit}.service`], { stdio: 'ignore', timeout: 120000 }); } catch {} }
  else if (t.lease.pid && pidAlive(t.lease.pid, t.lease.pidStart)) { try { process.kill(t.lease.pid, 'SIGTERM'); } catch {} }
  await reapTagged(key);
  const deadline = Date.now() + waitMs;
  const settled = () => foldTasks(readLines(paths.tasks)).tasks.get(key);
  while (LIVE.has(settled().state) && Date.now() < deadline) await new Promise(r => setTimeout(r, 200));
  const after = settled();
  if (LIVE.has(after.state)) {
    if (after.lease.pid && pidAlive(after.lease.pid, after.lease.pidStart)) { try { process.kill(after.lease.pid, 'SIGKILL'); } catch {} }
    await append(paths.tasks, paths.tasksLock, { type: 'task-interrupted', key, attempt: after.attempt, reason: `cancelled: ${reason}`, cancelled: true, at: now() });
  }
  return settled();
}

// ---- status ----
export function statusRows(paths = ensureDirs(), only = null) {
  const { tasks } = foldTasks(readLines(paths.tasks)), trialEvents = readLines(paths.trials);
  return [...tasks.values()].filter(t => !only || t.key === only).map(t => {
    const view = leaseView(t, paths), tr = trialStatus(t.key, trialEvents, paths);
    return { key: t.key, plan: t.plan, state: t.state, attempt: t.attempt, lease: view.live ? (view.dead ? 'DEAD' : 'alive') : null,
      trialsDone: tr.done, trialsTotal: tr.total, tokensIn: tr.inputTokens, tokensOut: tr.outputTokens, meteredTrials: tr.meteredTrials,
      lastHeartbeat: view.live ? view.lastBeatAt : null, heartbeatAgeSec: view.live ? Math.round(view.heartbeatAgeMs / 1000) : null,
      unit: t.lease?.unit ?? null, pid: t.lease?.pid ?? null, host: t.lease?.host ?? null, reason: t.reason, terminal: t.terminal ? { type: t.terminal.type, reason: t.terminal.reason ?? null, exit: t.terminal.exit ?? null } : null };
  });
}
export function formatStatus(rows) {
  const cols = [['TASK', r => r.key], ['STATE', r => r.state + (r.lease === 'DEAD' ? ' (lease DEAD)' : '')], ['TRIALS', r => `${r.trialsDone}/${r.trialsTotal ?? '?'}`],
    ['TOKENS in/out', r => `${r.tokensIn ?? '?'}/${r.tokensOut ?? '?'}`], ['HEARTBEAT', r => r.lastHeartbeat ? `${r.heartbeatAgeSec}s ago` : '-'], ['UNIT', r => r.unit ?? '-']];
  const cells = [cols.map(c => c[0]), ...rows.map(r => cols.map(c => String(c[1](r))))];
  const widths = cols.map((_, i) => Math.max(...cells.map(r => r[i].length)));
  return cells.map(r => r.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd()).join('\n');
}

// ---- the process inside the unit: owns the lease, heartbeats, runs the job, records the outcome ----
export async function execTask({ key, attempt, paths = ensureDirs() }) {
  const { tasks } = foldTasks(readLines(paths.tasks)), t = tasks.get(key);
  if (!t || t.state !== 'claimed' || t.attempt !== attempt) { console.error(`study exec: ${key} attempt ${attempt} is not the claimed attempt (state ${t?.state}, attempt ${t?.attempt}); not running`); return 3; }
  const plan = foldTasks(readLines(paths.tasks)).plans.get(t.plan);
  await append(paths.tasks, paths.tasksLock, { type: 'task-running', key, attempt, pid: process.pid, pidStart: pidStart(process.pid), host: hostname(), unit: t.lease.unit, at: now() });
  const beat = () => writeHeartbeat(paths, key, { key, attempt, pid: process.pid, host: hostname(), at: now() });
  beat(); const timer = setInterval(beat, HEARTBEAT_MS());
  const logPath = join(paths.logs, `${fileSafe(key)}.attempt-${attempt}.log`), log = openSync(logPath, 'a', 0o600);
  const argv = [...t.cmd.slice(1), ...(t.lease.resume ? ['--resume'] : [])];
  const env = { ...process.env, [REAP_ENV]: key, STUDY_DATA_DIR: paths.dir, STUDY_TASK_KEY: key, STUDY_TASK_ATTEMPT: String(attempt), STUDY_PLAN: t.plan, STUDY_PLAN_HASH: t.planHash, STUDY_PLAN_SHORT: plan?.short ?? t.planHash.slice(0, 12), STUDY_RESUME: t.lease.resume ? '1' : '0' };
  const child = spawn(t.cmd[0], argv, { cwd: t.cwd, env, stdio: ['ignore', log, log] });
  let terminating = false, killTimer;
  const stop = signal => { terminating = true; try { child.kill(signal); } catch {} clearTimeout(killTimer); killTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 15000); };
  process.on('SIGTERM', () => stop('SIGTERM')); process.on('SIGINT', () => stop('SIGINT'));
  const { code, signal, spawnError } = await new Promise(resolve => { child.once('error', e => resolve({ spawnError: e.message })); child.once('close', (code, signal) => resolve({ code, signal })); });
  clearInterval(timer); clearTimeout(killTimer);
  // The job is gone (exit, SIGKILL, signal): whatever it started and left behind (a detached Chromium) goes before the outcome is recorded.
  const reaped = await reapTagged(key); closeSync(log);
  let event;
  const finalState = foldTasks(readLines(paths.tasks)).tasks.get(key);
  if (terminating || finalState.cancel) event = { type: 'task-interrupted', reason: finalState.cancel?.reason ? `cancelled: ${finalState.cancel.reason}` : 'terminated by signal', exit: code, signal };
  else if (spawnError) event = { type: 'task-failed', reason: `could not start job: ${spawnError}` };
  else if (code === 0) {
    const tr = trialStatus(key, readLines(paths.trials), paths);
    event = tr.total != null && tr.done < tr.total ? { type: 'task-failed', exit: 0, reason: `job exited 0 but only ${tr.done}/${tr.total} trials have a trial-end` } : { type: 'task-done', exit: 0 };
  } else event = { type: 'task-failed', exit: code, signal, reason: signal ? `job killed by ${signal}` : `job exited ${code}` };
  await append(paths.tasks, paths.tasksLock, { ...event, key, attempt, log: logPath, ...(reaped.found ? { reaped: reaped.killed, reapSurvivors: reaped.survivors } : {}), at: now() });
  rmSync(heartbeatPath(paths, key), { force: true });
  return 0;
}
