// Test-only job: 10 trials through the trial ledger, no model. Behaviour is steered by STUDY_FAKE_* env.
import { appendFileSync, writeFileSync } from 'node:fs';
import { runTrials } from '../trials.mjs';
import { ensureDirs } from '../paths.mjs';
const n = Number(process.env.STUDY_FAKE_TRIALS || 10), ms = Number(process.env.STUDY_FAKE_TRIAL_MS || 50);
const killAt = Number(process.env.STUDY_FAKE_KILL_AT || 0), log = process.env.STUDY_FAKE_RUNLOG;
if (process.env.STUDY_FAKE_PIDFILE) writeFileSync(process.env.STUDY_FAKE_PIDFILE, String(process.pid));
const short = process.env.STUDY_PLAN_SHORT;
const trials = Array.from({ length: n }, (_, i) => ({ key: `${short}/case${i + 1}/healthy/runtime/fake-model/r1`, block: 'b' + String(i + 1).padStart(2, '0'), i: i + 1 }));
const result = await runTrials({ taskKey: process.env.STUDY_TASK_KEY, trials, seed: 'test-seed', shuffleBlocks: false, paths: ensureDirs(),
  runOne: async (trial, { attempt }) => {
    if (log) appendFileSync(log, `${trial.i} ${attempt}\n`);
    if (killAt === trial.i && attempt === 1) process.kill(process.pid, 'SIGKILL');
    await new Promise(r => setTimeout(r, ms));
    if (process.env.STUDY_FAKE_HANG_AT && Number(process.env.STUDY_FAKE_HANG_AT) === trial.i) await new Promise(() => setInterval(() => {}, 1000));
    return { outcome: 'recorded', usage: { input_tokens: 100, output_tokens: 10, cached_input_tokens: 40 }, wall: { modelMs: ms } };
  } });
console.log(JSON.stringify(result));
