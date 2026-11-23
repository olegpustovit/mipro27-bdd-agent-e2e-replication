// Plan identity: sha256 over the canonical JSON of
//   { manifest, sourcePins, models, cliVersions, promptHashes, drivers }
// so a change to the frozen manifest, any pinned source file, a model id, a CLI version or a prompt changes the hash.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJSON, sha256, planShort } from './keys.mjs';
import { loadDriver } from '../drivers/index.mjs';

export const defaultRepoRoot = () => process.env.STUDY_REPO_ROOT || fileURLToPath(new URL('../../', import.meta.url));
export const DEFAULT_PIN_PATTERNS = ['scripts/*.mjs', 'scripts/**/*.mjs', 'study/*.mjs', 'study/*.feature', 'package.json', 'package-lock.json'];

export function sourcePinsAt(root, patterns = DEFAULT_PIN_PATTERNS) {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', ...patterns], { cwd: root, encoding: 'utf8' });
  const files = [...new Set(out.trim().split('\n').filter(Boolean))].sort();
  return Object.fromEntries(files.map(f => [f, sha256(readFileSync(join(root, f)))]));
}
export function readManifest(path) {
  const text = readFileSync(path, 'utf8'), manifest = JSON.parse(text);
  if (!manifest.plan || !/^[A-Za-z0-9._-]+$/.test(manifest.plan)) throw new Error('Manifest needs a "plan" name matching [A-Za-z0-9._-]+');
  return { manifest, manifestSha256: sha256(text) };
}
export async function computePlan(manifestPath, { root = defaultRepoRoot() } = {}) {
  manifestPath = resolve(manifestPath);
  const { manifest } = readManifest(manifestPath), base = dirname(manifestPath);
  const drivers = {}, cliVersions = {}, models = new Set(manifest.models ?? []);
  for (const spec of manifest.drivers ?? []) {
    const driver = await loadDriver(spec, base), frozen = await driver.frozenInputs();
    drivers[driver.name] = frozen; cliVersions[driver.name] = frozen.cliVersion; models.add(frozen.model);
  }
  const promptHashes = Object.fromEntries(Object.entries(manifest.prompts ?? {}).map(([k, p]) => [k, sha256(readFileSync(resolve(root, p)))]));
  const inputs = { manifest, sourcePins: sourcePinsAt(root, manifest.pinPatterns), models: [...models].sort(), cliVersions, promptHashes, drivers };
  const hash = sha256(canonicalJSON(inputs));
  return { name: manifest.plan, hash, short: planShort(hash), inputs, manifestPath };
}
// What differs between two plan-input objects, for a readable refusal.
export function diffInputs(a, b) {
  const out = [];
  for (const k of ['manifest', 'models', 'cliVersions', 'promptHashes', 'drivers']) if (canonicalJSON(a[k]) !== canonicalJSON(b[k])) out.push(k);
  const files = new Set([...Object.keys(a.sourcePins), ...Object.keys(b.sourcePins)]);
  const changed = [...files].filter(f => a.sourcePins[f] !== b.sourcePins[f]);
  if (changed.length) out.push(`sourcePins(${changed.slice(0, 5).join(', ')}${changed.length > 5 ? ', ...' : ''})`);
  return out;
}
