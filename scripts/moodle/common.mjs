// Shared by the Moodle campaign jobs: adapter construction on a worker and one scenario run in a named state.
import { MoodleAdapter } from '../../adapters/moodle/adapter.mjs';
import { runScenario } from '../../adapters/moodle/behat-runner.mjs';
import { run } from '../../adapters/moodle/shell.mjs';
import { loadManifest, locateScenario, stateSpec } from '../../adapters/moodle/manifest.mjs';
import { ensureState } from '../../adapters/moodle/states.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../../adapters/moodle/config.mjs';

export async function workerAdapter(worker) {
  const bind = process.env.STUDY_MOODLE_BIND || (await run('docker', ['network', 'inspect', 'bridge', '--format', '{{(index .IPAM.Config 0).Gateway}}'], { check: false })).stdout.trim() || '127.0.0.1';
  return new MoodleAdapter({ worker, bind });
}
export const argOf = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; };

// Run one scenario in a state; returns a compact, JSON-safe record. Steps keep index/status/ms only (text is in the feature).
export async function runInState(adapter, manifest, { scenario, state, timeoutMs = 300000 }) {
  // State first, then the line lookup: class ii states edit feature files, so the line is only valid in the tree the scenario runs in.
  const t0 = performance.now(), applied = await ensureState(adapter, stateSpec(manifest, state)), stateMs = Math.round(performance.now() - t0);
  const loc = locateScenario(manifest, scenario, adapter.dirs.src);
  const r = await runScenario(adapter, { feature: loc.feature, line: loc.line, reset: true, timeoutMs });
  const sc = r.scenarios[0] ?? null, fail = sc?.failingStep ?? null;
  // The scenario Behat ran must be the one asked for (outline rows are titled by their example row, so only plain scenarios can be checked).
  const ranOk = !sc || loc.kind !== 'scenario' || sc.name === loc.name;
  if (!ranOk) r.status = 'error';
  return { scenario, state, worker: adapter.worker, status: r.status, ran: sc && { name: sc.name, line: sc.line, expectedLine: loc.line }, wrongScenario: ranOk ? undefined : true, failingStepIndex: r.failingStepIndex, stepCount: sc?.steps.length ?? 0,
    failingStep: fail && { index: fail.index, keyword: fail.keyword, text: fail.text, background: fail.background, status: fail.status, error: String(fail.error ?? '').slice(0, 400) },
    stepsMs: sc?.steps.map(s => [s.index, s.status[0], s.ms]) ?? [], scenarioWallMs: r.wallMs, stateChanged: applied.changed, stateMs, assets: applied.assets ?? null,
    stdoutTail: r.status === 'error' ? r.stdoutTail.slice(-1500) : undefined, stderrTail: r.status === 'error' ? r.stderrTail.slice(-500) : undefined };
}
export { loadManifest };

// A (break, fault) pair may be run only when the V1 report recorded it as valid in the scenario (arm B's starting state bites, the fault reproduces, the failing step is the
// target under the exact rule). A manifest link alone is no longer enough: B12 + F01 @ S079 is linked but fails at step 25, target 24. `report` = parsed lines of results/moodle-v1-reproduction.jsonl.
export function validPairRecords(path = join(repoRoot, 'results/moodle-v1-reproduction.jsonl')) {
  return existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => r.type === 'pair' && (r.valid_strict || r.valid_core)) : [];
}
export function isRunnablePair(manifest, { break: b, fault, scenario }, records = validPairRecords()) {
  const f = manifest.faultById.get(fault); if (!f) return false;
  return records.some(r => r.break === b && r.fault === fault && (!scenario || r.scenario === scenario));
}
