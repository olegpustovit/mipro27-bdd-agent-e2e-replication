import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MoodleAdapter } from '../../../adapters/moodle/adapter.mjs';
import { runScenario } from '../../../adapters/moodle/behat-runner.mjs';
import { run } from '../../../adapters/moodle/shell.mjs';
import { findScenario, parseFeature } from '../../../adapters/moodle/gherkin.mjs';
import { ensureStateText, stackPatches } from '../../../adapters/moodle/state-text.mjs';
import { scenarioBodySteps } from '../moodle/handoff.mjs';

const readJson = url => JSON.parse(readFileSync(url, 'utf8'));
const manifest = readJson(new URL('../../apps/moodle/changes.json', import.meta.url));

export function resolveMoodleItem(item) {
  const { change, phase, scenario, condition, arm, bugId } = item;
  const build = manifest.changes.find(entry => entry.id === change && entry.decision === 'chosen');
  if (!build || !['pre', 'post'].includes(phase) || item.version !== `${change}-${phase}`) {
    throw new Error('Unknown Moodle build or inconsistent version, change and phase');
  }
  const commit = build[phase];
  const target = build.scenarios.find(entry => entry.id === scenario &&
    ['eligible', 'coded-only'].includes(entry.decision));
  if (!target) throw new Error(`Unknown Moodle scenario for ${change}: ${scenario}`);
  if (!['healthy', 'bug'].includes(condition)) throw new Error('Unknown Moodle condition');

  let bugPatch = null;
  if (condition === 'bug') {
    const id = `mdl-${change}-${scenario}`;
    if (phase !== 'post' || bugId !== id) throw new Error(`Expected post-change Moodle bug ${id}`);
    const folder = new URL(`../../bugs/${id}/`, import.meta.url);
    if (!readJson(new URL('applies-to.json', folder)).includes(commit)) {
      throw new Error(`Moodle bug ${id} does not apply to ${commit}`);
    }
    bugPatch = new URL('patch.diff', folder);
  }
  const stepPatch = arm === 'sd-old' && phase === 'post'
    ? new URL(`moodle-steps/${change}.patch`, import.meta.url)
    : null;
  return { ...target[phase], name: target.name, commit, arm, stepPatch, bugPatch };
}

export async function moodle(item, pinScenario) {
  const { scenario, phase } = item;
  const { arm, bugPatch, commit, feature, line, name, stepPatch } = resolveMoodleItem(item);
  if (arm !== 'sd-old' && !(arm === 'sd-new' && phase === 'post')) {
    throw new Error('Unknown Moodle coded arm for this phase');
  }

  // All-pass gate (P6): run a healthy scenario inside an already started pinned web container.
  const pinnedWeb = process.env.BENCH_CODED_MOODLE_CONTAINER;
  if (pinnedWeb) {
    if (item.condition !== 'healthy' || stepPatch || bugPatch || !/^[a-f0-9]{64}$/.test(pinnedWeb)) {
      throw new Error('Pinned Moodle runtime requires unmodified healthy steps and a container ID');
    }
    const adapter = {
      exec(_service, args, { env = {}, cwd, ...options } = {}) {
        return run('docker', ['exec', ...(cwd ? ['-w', cwd] : []),
          ...Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]),
          pinnedWeb, ...args], options);
      },
    };
    const source = await adapter.exec('webserver', ['cat', `/var/www/html/${feature}`]);
    await pinScenario?.(source.stdout);
    const target = findScenario(parseFeature(source.stdout), { line, name });
    const result = await runScenario(adapter, { feature, line, timeoutMs: 120_000 });
    return interpret(result, name, scenario, commit, target.kind === 'scenario');
  }

  if (process.env.BENCH_MOODLE_WEB) {
    const { pinnedMoodle } = await import('../moodle/pinned.mjs');
    const adapter = pinnedMoodle(process.env.BENCH_MOODLE_WEB);
    if (stepPatch) {
      const patch = readFileSync(stepPatch, 'utf8');
      await adapter.exec('webserver', ['git', 'apply', '--check', '-'], { cwd: '/var/www/html', input: patch });
      await adapter.exec('webserver', ['git', 'apply', '-'], { cwd: '/var/www/html', input: patch });
    }
    const source = await adapter.exec('webserver', ['cat', `/var/www/html/${feature}`]);
    await pinScenario?.(source.stdout);
    const target = findScenario(parseFeature(source.stdout), { line, name });
    const result = await runScenario(adapter, { feature, line, timeoutMs: 120_000 });
    return interpret(result, name, scenario, commit, target.kind === 'scenario');
  }
  const patch = stackPatches([stepPatch, bugPatch].filter(Boolean).map(file => readFileSync(file, 'utf8')));
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
    // Native Behat executes the original setup and UI steps together, in source order.
    const source = readFileSync(join(adapter.dirs.src, feature), 'utf8');
    await pinScenario?.(source);
    const target = findScenario(parseFeature(source), { line, name });
    const result = await runScenario(adapter, { feature, line, timeoutMs: 120_000 });
    return interpret(result, name, scenario, commit, target.kind === 'scenario');
  } finally {
    try { if (started) await adapter.revertDiff(); } finally { release(); }
  }
}

function interpret(result, name, scenario, commit, exactName) {
  if (result.status === 'error' || !result.scenarios.length ||
      (exactName && result.scenarios.some(entry => entry.name !== name))) {
    throw new Error(`Behat did not complete ${scenario} (exit ${result.exitCode}): ${result.stderrTail || result.stdoutTail}`);
  }
  const failed = result.scenarios.find(entry => entry.status !== 'passed');
  if (!failed) return { status: 'pass', message: `Behat passed at ${commit}` };
  const step = failed.failingStep;
  const steps = scenarioBodySteps(failed.steps);
  return {
    status: 'fail',
    failed_step: step && !step.background ? steps.indexOf(step) + 1 : null,
    failed_step_text: step && !step.background ? `${step.keyword} ${step.text}` : null,
    message: step ? `Behat ${step.background ? 'Background' : 'scenario'} step: ${step.status}` : 'Behat scenario failed outside a numbered step',
  };
}
