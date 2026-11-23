// Study data directory and every path inside it. Locks and logs live here, never in /tmp.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

export const dataDir = () => process.env.STUDY_DATA_DIR || join(homedir(), '.local/share/cucumber-study');
export function ledgerPaths(dir = dataDir()) {
  return {
    dir,
    tasks: join(dir, 'tasks.jsonl'),
    tasksLock: join(dir, 'tasks.lock'),
    trials: join(dir, 'trials.jsonl'),
    trialsLock: join(dir, 'trials.lock'),
    heartbeats: join(dir, 'heartbeats'),
    logs: join(dir, 'logs'),
    locks: join(dir, 'locks'),
    blobs: join(dir, 'blobs'),
  };
}
export function ensureDirs(paths = ledgerPaths()) {
  for (const d of [paths.dir, paths.heartbeats, paths.logs, paths.locks]) mkdirSync(d, { recursive: true, mode: 0o700 });
  return paths;
}
