import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MoodleAdapter } from '../../../adapters/moodle/adapter.mjs';
import { runScenario } from '../../../adapters/moodle/behat-runner.mjs';
import { run } from '../../../adapters/moodle/shell.mjs';
import { parseFeature } from '../../../adapters/moodle/gherkin.mjs';
import { loadManifest } from '../../../adapters/moodle/manifest.mjs';
import { ensureStateText, stackPatches } from '../../../adapters/moodle/state-text.mjs';
import { applyRuntime, RUNTIME_OF } from '../../../followups-2026-11/d-moodle-replay/scripts/runtime.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));

export async function moodle(item) {
  const { change, phase, scenario, condition, arm, bugId } = item;
  const replay = join(root, 'followups-2026-11/d-moodle-replay');
  const pins = readFileSync(join(replay, 'feasibility/commits.tsv'), 'utf8').split('\n')
    .map(line => line.split('\t')).find(([id]) => id === change);
  const commit = pins?.[phase === 'pre' ? 2 : 1];
  if (!RUNTIME_OF[change] || !commit || !['pre', 'post'].includes(phase) || item.version !== `${change}-${phase}`) {
    throw new Error('Unknown Moodle build or inconsistent version, change and phase');
  }
  if (!['sd-old', 'sd-new'].includes(arm)) throw new Error('Unknown Moodle coded arm');
  const target = loadManifest(root).scenarioById.get(scenario);
  if (!target) throw new Error(`Unknown Moodle scenario: ${scenario}`);

  const patches = [];
  if (arm === 'sd-old' && phase === 'post') {
    patches.push(readFileSync(join(root, 'followups-2026-11/d-moodle-replay/data/patches',
      `${change}.old-steps-at-post.patch`), 'utf8'));
  }
  if (condition === 'bug') {
    if (typeof bugId !== 'string' || !/^[\w-]+$/.test(bugId)) throw new Error('Invalid Moodle bug ID');
    const path = join(root, 'bench/bugs', bugId, 'patch.diff');
    if (!existsSync(path)) throw new Error(`Missing Moodle bug patch for ${bugId}`);
    patches.push(readFileSync(path, 'utf8'));
  }
  const patch = stackPatches(patches);
  await applyRuntime(root, RUNTIME_OF[change]);
  const adapter = new MoodleAdapter({
    moodleCommit: commit, worker: process.env.BENCH_MOODLE_WORKER ?? 'w89',
  });
  const release = adapter.lease('bench coded-run');
  let started = false;
  try {
    await adapter.start();
    started = true;
    const head = await run('git', ['rev-parse', 'HEAD'], { cwd: adapter.dirs.src });
    if (head.stdout.trim() !== commit) throw new Error(`Moodle worker is not at ${commit}`);
    await ensureStateText(adapter, patch);
    const relative = target.feature.replace(/^public\//, '');
    const feature = existsSync(join(adapter.dirs.src, 'public', relative)) ? `public/${relative}` : relative;
    const source = readFileSync(join(adapter.dirs.src, feature), 'utf8');
    const matches = parseFeature(source).scenarios.filter(entry => entry.name === target.name);
    if (matches.length !== 1) throw new Error(`Expected one Moodle scenario named ${target.name}`);
    const result = await runScenario(adapter, { feature, line: matches[0].line, timeoutMs: 120_000 });
    if (result.status === 'error' || !result.scenarios.length ||
        (matches[0].kind === 'scenario' && result.scenarios.some(entry => entry.name !== target.name))) {
      throw new Error(`Behat did not complete ${scenario} (exit ${result.exitCode})`);
    }
    const failed = result.scenarios.find(entry => entry.status !== 'passed');
    if (!failed) return { status: 'pass', message: `Behat passed at ${commit}` };
    const step = failed.failingStep;
    const steps = failed.steps.filter(entry => !entry.background);
    return {
      status: 'fail',
      failed_step: step && !step.background ? steps.indexOf(step) + 1 : null,
      failed_step_text: step && !step.background ? `${step.keyword} ${step.text}` : null,
      message: step ? `Behat ${step.background ? 'Background' : 'scenario'} step: ${step.status}` : 'Behat scenario failed outside a numbered step',
    };
  } finally {
    try { if (started) await adapter.revertDiff(); } finally { release(); }
  }
}
