// Freeze once, review the printed SHA, then run/resume with that reviewed SHA.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appPins, samePins, sha256, sourcePins } from '../../scripts/campaign-guard.mjs';
import { environmentFingerprint, fixtureProvenance } from '../../scripts/environment.mjs';
import { ledgerPaths } from '../../scripts/ledger/paths.mjs';
import { requireDeadline } from '../../study/campaign-config.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const runs = join(ledgerPaths().dir, 'runs');
const manifestPath = join(runs, 'experiment-4-comparison.json');
const source = 'campaign-20261101-04d8551';
const seed = 'mipro-exp4-20261118';
const stages = 'healthy-v0-1,healthy-v2-1,fault-v2-1';
const arms = [
  ['haiku', 'claude-haiku-5-5', 'omp'],
  ['luna', 'gpt-6-luna', 'codex'],
  ['sonnet', 'claude-sonnet-5-5', 'claude-code'],
  ['opus', 'claude-opus-5-5', 'claude-code'],
].map(([id, model, driver]) => ({ campaign: 'campaign-experiment4-' + id, model, driver }));
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const readJsonl = path => readFileSync(path, 'utf8').trim().split('\n').map(JSON.parse);

async function capture() {
  if (git(['status', '--porcelain', '--', 'scripts', 'study', 'package.json', 'package-lock.json'])) {
    throw new Error('Comparison requires committed harness files');
  }
  const fixture = await fixtureProvenance();
  return {
    commit: git(['rev-parse', 'HEAD']),
    source, seed, stages, arms,
    sourcePins: sourcePins(), appPins: appPins(),
    maintenanceSHA: sha256(readFileSync(join(runs, source, 'events.jsonl'))),
    environment: await environmentFingerprint(),
    fixture,
    versions: Object.fromEntries(['omp', 'codex', 'claude'].map(command => [
      command, execFileSync(command, ['--version'], { encoding: 'utf8' }).trim(),
    ])),
  };
}

function requireComplete(rows, campaign) {
  const finished = rows.filter(row => row.type === 'trial-finished');
  if (rows.at(-1)?.type !== 'campaign-complete' ||
      finished.length !== 36 || new Set(finished.map(row => row.trial.id)).size !== 36) {
    throw new Error('Arm did not finish all 36 cells: ' + campaign);
  }
}

const [mode, value] = process.argv.slice(2);
if (mode === '--freeze') {
  const deadline = requireDeadline(value);
  const manifest = { deadline, pins: await capture() };
  const bytes = JSON.stringify(manifest) + '\n';
  writeFileSync(manifestPath, bytes, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ manifestPath, sha256: sha256(bytes), commit: manifest.pins.commit, deadline }));
} else if (mode === '--run') {
  const bytes = readFileSync(manifestPath);
  if (sha256(bytes) !== value) throw new Error('Provide the reviewed manifest SHA-256');
  const manifest = JSON.parse(bytes);
  for (const arm of manifest.pins.arms) {
    samePins(await capture(), manifest.pins, 'Shared comparison');
    const journalPath = join(runs, arm.campaign, 'journal.jsonl');
    const prior = existsSync(journalPath) ? readJsonl(journalPath) : [];
    if (prior.length && prior[0].inputs?.comparisonManifestSHA !== value) throw new Error('Arm does not match the reviewed manifest: ' + arm.campaign);
    if (prior.some(row => row.type === 'campaign-stopped' && row.reason?.startsWith('Model comparison stopped:'))) {
      throw new Error('Comparison already met its early-stop rule in ' + arm.campaign);
    }
    if (prior.at(-1)?.type === 'campaign-complete') { requireComplete(prior, arm.campaign); continue; }
    const env = { ...process.env, STUDY_MODEL: arm.model, STUDY_DRIVER: arm.driver,
      STUDY_ORDER_SEED: seed, STUDY_RUNTIME_RERUN_FROM: source, STUDY_RUNTIME_STAGES: stages,
      STUDY_CONTINUE_UNFINISHED_FROM: '', STUDY_DEADLINE_UTC: manifest.deadline,
      STUDY_MODEL_COMPARISON: '1', STUDY_COMPARISON_MANIFEST_SHA: value };
    const flags = prior.length ? ['--resume', arm.campaign] : ['--campaign-id', arm.campaign];
    const result = spawnSync(process.execPath, ['scripts/exploratory-runner.mjs', ...flags], { cwd: root, env, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('Comparison stopped in ' + arm.campaign);
    requireComplete(readJsonl(journalPath), arm.campaign);
    samePins(await fixtureProvenance(), manifest.pins.fixture, 'Running comparison fixture');
  }
} else {
  throw new Error('Usage: run-experiment-4.mjs --freeze <UTC deadline> | --run <reviewed SHA-256>');
}
