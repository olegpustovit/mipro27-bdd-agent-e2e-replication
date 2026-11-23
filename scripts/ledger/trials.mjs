// Trial-level ledger (trials.jsonl). A trial key is one piece of work forever:
//   trial-end recorded            -> done, never re-run
//   trial-start without a closer  -> trial-interrupted is written (both attempts kept) and the trial re-runs as attempt n+1
//   a deliberate re-run           -> a new key with suffix #2 and a recorded reason
import { createHash, randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { ledgerPaths, ensureDirs } from './paths.mjs';
import { appendSync, transaction, readLines } from './jsonl.mjs';
import { meter } from './metering.mjs';
import { pidAlive, pidStart } from './process.mjs';

export function foldTrials(events) {
  const trials = new Map(), planned = new Map();
  for (const e of events) {
    if (e.type === 'trials-planned') { planned.set(e.task, e); continue; }
    if (!e.key) continue;
    const t = trials.get(e.key) ?? { key: e.key, task: e.task, attempts: [], end: null };
    if (e.type === 'trial-start') t.attempts.push({ n: e.attempt, start: e, closed: false, task: e.task });
    else if (e.type === 'trial-interrupted') { const a = t.attempts.find(x => x.n === e.attempt); if (a) { a.closed = true; a.interrupted = e; } }
    else if (e.type === 'trial-end') { const a = t.attempts.find(x => x.n === e.attempt); if (a) { a.closed = true; a.end = e; } if (!t.end) t.end = e; }
    trials.set(e.key, t);
  }
  return { trials, planned };
}
export const openAttempt = t => t?.attempts.find(a => !a.closed) ?? null;

// Seeded, stable randomized blocked order: blocks (optionally) shuffled, then trials shuffled inside each block.
const rng = seed => { let a = createHash('sha256').update(String(seed)).digest().readUInt32LE(0); return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
const shuffle = (arr, rand) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
export function blockedOrder(trials, { seed, shuffleBlocks = true }) {
  const rand = rng(seed), blocks = new Map();
  for (const t of trials) { const b = t.block ?? ''; if (!blocks.has(b)) blocks.set(b, []); blocks.get(b).push(t); }
  const names = shuffleBlocks ? shuffle([...blocks.keys()], rand) : [...blocks.keys()];
  return names.flatMap(n => shuffle(blocks.get(n), rand));
}

export function trialStatus(taskKey, events = null, paths = ledgerPaths()) {
  const { trials, planned } = foldTrials(events ?? []);
  const plan = planned.get(taskKey);
  const total = plan ? plan.order.length : null;
  const mine = plan ? plan.order.map(k => trials.get(k)).filter(Boolean) : [];
  const done = mine.filter(t => t.end);
  const sum = k => done.length && done.every(t => t.end.meter?.[k] != null) ? done.reduce((n, t) => n + t.end.meter[k], 0) : null;
  return { total, done: done.length, running: mine.filter(t => !t.end && openAttempt(t)).length, seed: plan?.seed ?? null,
    inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens'), meteredTrials: done.filter(t => t.end.meter?.inputTokens != null).length };
}

const NOW = () => new Date().toISOString();
// Record (or recall) the trial order of a task. A recorded order is reused as-is: stable on resume.
export async function planTrials({ taskKey, trials, seed = randomBytes(8).toString('hex'), shuffleBlocks = true, order = null, paths = ensureDirs() }) {
  const specs = new Map(trials.map(t => [t.key, t]));
  if (specs.size !== trials.length) throw new Error('Duplicate trial keys in the plan');
  for (const t of trials) if (/#\d+$/.test(t.key) && !t.rerunReason) throw new Error(`Trial ${t.key} is a re-run (#N) and needs a rerunReason`);
  return transaction(paths.trials, paths.trialsLock, events => {
    const prior = foldTrials(events).planned.get(taskKey);
    if (prior) {
      const same = prior.order.length === specs.size && prior.order.every(k => specs.has(k));
      if (!same) throw new Error(`Trial set for ${taskKey} differs from the recorded plan (seed ${prior.seed}); refusing to reorder or drop trials`);
      return { result: { order: prior.order, seed: prior.seed } };
    }
    const chosen = order ?? blockedOrder(trials, { seed, shuffleBlocks }).map(t => t.key);
    return { append: [{ type: 'trials-planned', task: taskKey, seed, shuffleBlocks, order: chosen, at: NOW() }], result: { order: chosen, seed } };
  });
}
// trial-start. Returns { skip: true } when the trial already has a trial-end. A start without an end from a dead
// process is closed with trial-interrupted first (both attempts stay on the ledger) and the next attempt number is used.
export async function startTrial({ taskKey, spec, paths = ensureDirs() }) {
  const key = spec.key;
  return transaction(paths.trials, paths.trialsLock, events => {
    const t = foldTrials(events).trials.get(key);
    if (t?.end) return { result: { skip: true } };
    const out = [], open = openAttempt(t);
    if (open) {
      const s = open.start;
      if (s.host === hostname() && s.pid !== process.pid && pidAlive(s.pid, s.pidStart)) throw new Error(`Trial ${key} attempt ${open.n} is still running in pid ${s.pid}`);
      out.push({ type: 'trial-interrupted', key, task: taskKey, attempt: open.n, reason: 'trial-start without trial-end (process died)', at: NOW() });
    }
    const attempt = (t?.attempts.length ?? 0) + 1;
    out.push({ type: 'trial-start', key, task: taskKey, attempt, block: spec.block ?? null, rerunReason: spec.rerunReason ?? null, host: hostname(), pid: process.pid, pidStart: pidStart(process.pid), at: NOW() });
    return { append: out, result: { attempt, recoveredInterrupted: open ? 1 : 0 } };
  });
}
// trial-end with metering. `body` may carry usage / wall / costUsd (metered, unknown = null) and any other fields.
export function endTrial({ taskKey, key, attempt, body, paths = ensureDirs() }) {
  const { usage, wall, costUsd, ...rest } = body;
  const metered = meter({ usage, costUsd, wall });
  appendSync(paths.trials, { type: 'trial-end', key, task: taskKey, attempt, ...rest, meter: metered, at: NOW() });
  return metered;
}

// Run every not-yet-ended trial once, in the recorded order. runOne(trial, { attempt }) -> result object.
// shouldStop(spec) -> null | record: checked before each not-yet-ended trial; a record stops scheduling, is written as `schedule-stopped` and the remaining trials stay open.
export async function runTrials({ taskKey, trials, seed, shuffleBlocks = true, runOne, shouldStop = null, paths = ensureDirs() }) {
  const specs = new Map(trials.map(t => [t.key, t]));
  const { order, seed: usedSeed } = await planTrials({ taskKey, trials, seed, shuffleBlocks, paths });
  const summary = { ran: 0, skipped: 0, recoveredInterrupted: 0, results: [] };
  for (const key of order) {
    const spec = specs.get(key);
    if (shouldStop && !foldTrials(readLines(paths.trials)).trials.get(key)?.end) { const stop = shouldStop(spec); if (stop) { appendSync(paths.trials, { type: 'schedule-stopped', task: taskKey, key, ...stop, at: NOW() }); summary.stopped = { key, ...stop }; break; } }
    const claim = await startTrial({ taskKey, spec, paths });
    if (claim.skip) { summary.skipped++; continue; }
    summary.recoveredInterrupted += claim.recoveredInterrupted;
    const began = Date.now();
    let result, error = null;
    try { result = await runOne(spec, { attempt: claim.attempt }); } catch (e) { error = e; }
    const body = error ? { outcome: 'error', error: String(error.message ?? error) } : { outcome: 'recorded', ...(result ?? {}) };
    body.wall = { totalMs: Date.now() - began, ...body.wall };
    endTrial({ taskKey, key, attempt: claim.attempt, body, paths });
    summary.ran++; summary.results.push({ key, attempt: claim.attempt, outcome: body.outcome });
    if (error && error.fatal) throw error;
  }
  return { seed: usedSeed, order, ...summary };
}

// A trial that a runner's own journal already finished (e.g. a crash between the journal write and the ledger
// write) gets its trial-end on the ledger without running anything.
export async function reconcileEnded({ taskKey, spec, body, paths = ensureDirs() }) {
  const t = foldTrials((await import('./jsonl.mjs')).readLines(paths.trials)).trials.get(spec.key);
  if (t?.end) return false;
  const claim = await startTrial({ taskKey, spec, paths });
  if (claim.skip) return false;
  endTrial({ taskKey, key: spec.key, attempt: claim.attempt, body: { ...body, reconciled: true }, paths });
  return true;
}
