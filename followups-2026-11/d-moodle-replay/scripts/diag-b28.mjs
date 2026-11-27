#!/usr/bin/env node
// POST-HOC DIAGNOSTIC (not a measured trial; decided after the B28 coded runs failed at step 5 on every variant).
// Runs B28's scenarios S134/S137 with Behat on the developers' own fix commit 8662be1d (its tree as is) on the Moodle 4.0dev runtime,
// to tell a stack/environment failure from a patch-combination failure. Output: data/diagnostics.jsonl.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendFileSync, readFileSync } from 'node:fs';
const here = dirname(fileURLToPath(import.meta.url)), repo = join(here, '../../..');
const { applyRuntime } = await import(join(here, 'runtime.mjs'));
const rt = await applyRuntime(repo, 'm40');
const { MoodleAdapter } = await import(join(repo, 'adapters/moodle/adapter.mjs'));
const { run } = await import(join(repo, 'adapters/moodle/shell.mjs'));
const { runScenario } = await import(join(repo, 'adapters/moodle/behat-runner.mjs'));
const { parseFeature } = await import(join(repo, 'adapters/moodle/gherkin.mjs'));
const commit = '8662be1d8591a01d7eb110c95f26a718963813c2';
const bind = (await run('docker', ['network', 'inspect', 'bridge', '--format', '{{(index .IPAM.Config 0).Gateway}}'], { check: false })).stdout.trim();
const a = new MoodleAdapter({ worker: 'w1', moodleCommit: commit, bind }), release = a.lease('diag-b28');
try {
  await a.start();
  const feature = 'message/tests/behat/block_user.feature', text = readFileSync(join(a.dirs.src, feature), 'utf8');
  for (const name of ['Unable to block a user', 'Block a user']) {
    const line = parseFeature(text).scenarios.find(s => s.name === name).line;
    const r = await runScenario(a, { feature, line, reset: true }), sc = r.scenarios[0], f = sc?.failingStep;
    const rec = { diagnostic: 'post-hoc', what: 'B28 scenario on developers fix commit 8662be1d, tree as is', commit, runtime: rt, scenario: name, status: r.status, failingStepIndex: r.failingStepIndex, failingStep: f && { index: f.index, text: f.text, error: String(f.error ?? '').slice(0, 300) }, at: new Date().toISOString() };
    appendFileSync(join(here, '../data/diagnostics.jsonl'), JSON.stringify(rec) + '\n'); console.log(JSON.stringify(rec).slice(0, 400));
  }
} finally { await a.revertDiff().catch(() => {}); release(); }
