#!/usr/bin/env node
// Build (or verify) the golden Behat seed of each replay commit with the unchanged study adapter (adapters/moodle/adapter.mjs bootstrap()).
// Technical preparation, not a measured trial. Usage: node scripts/build-golden.mjs <sha40> [<sha40> ...]
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendFileSync } from 'node:fs';
const here = dirname(fileURLToPath(import.meta.url)), repo = join(here, '../../..');
const { MoodleAdapter } = await import(join(repo, 'adapters/moodle/adapter.mjs'));
const { run } = await import(join(repo, 'adapters/moodle/shell.mjs'));
const bind = process.env.STUDY_MOODLE_BIND || (await run('docker', ['network', 'inspect', 'bridge', '--format', '{{(index .IPAM.Config 0).Gateway}}'], { check: false })).stdout.trim() || '127.0.0.1';
const { applyRuntime } = await import(join(here, 'runtime.mjs'));
const rt = await applyRuntime(repo, process.env.REPLAY_RUNTIME || 'pin'); console.log('runtime', JSON.stringify(rt));
for (const commit of process.argv.slice(2)) {
  const t0 = Date.now(), a = new MoodleAdapter({ worker: 'w1', moodleCommit: commit, bind });
  try { const v = await a.bootstrap(); appendFileSync(join(here, '../data/builds.jsonl'), JSON.stringify({ commit, ok: true, runtime: rt, ms: Date.now() - t0, version: v, at: new Date().toISOString() }) + '\n'); console.log('OK', commit, Date.now() - t0); }
  catch (e) { appendFileSync(join(here, '../data/builds.jsonl'), JSON.stringify({ commit, ok: false, runtime: rt, ms: Date.now() - t0, error: String(e.message).slice(0, 2000), at: new Date().toISOString() }) + '\n'); console.log('FAIL', commit, e.message.slice(0, 500)); }
}
