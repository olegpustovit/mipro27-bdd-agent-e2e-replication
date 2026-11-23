// Put a worker's source tree into a named state (patch applied or the clean pin) and keep it there across trials.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { patchFile } from './manifest.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
// Applies the patch of `spec` (from stateSpec) unless the worker is already in exactly that state. Verifies the patch file
// against the manifest hash before applying, so a modified patch can never run silently. Returns { changed, applied }.
export async function ensureState(adapter, spec, { allowSchema = false } = {}) {
  const want = spec.patch ? spec.patch.sha256 : null;
  const have = adapter.state.patch?.sha ?? null;
  if (want === have) return { changed: false, applied: have };
  if (have) await adapter.revertDiff();
  if (!spec.patch) return { changed: true, applied: null };
  const text = readFileSync(patchFile(spec.patch), 'utf8');
  if (sha(text) !== spec.patch.sha256) throw new Error(`Patch ${spec.patch.file} does not match its manifest sha256`);
  const r = await adapter.applyDiff(text, { allowSchema });
  return { changed: true, applied: r.sha, assets: r.assets };
}
