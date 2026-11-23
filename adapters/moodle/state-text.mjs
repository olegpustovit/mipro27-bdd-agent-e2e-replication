// States built from patch text rather than a manifest patch file: arm B's repaired tests (optionally with a fault patch on top).
import { createHash } from 'node:crypto';

const sha = text => createHash('sha256').update(text).digest('hex');
const filesOf = text => [...text.matchAll(/^diff --git a\/(\S+) b\/(\S+)/gm)].map(m => m[2]);
// Concatenate patches that touch disjoint files (a git diff is a list of per-file diffs); refuses overlapping files.
export function stackPatches(texts) {
  const seen = new Map();
  for (const [i, t] of texts.entries()) for (const f of filesOf(t)) { if (seen.has(f)) throw new Error(`Patches ${seen.get(f)} and ${i} both touch ${f}; stacking would be ambiguous`); seen.set(f, i); }
  return texts.filter(Boolean).map(t => t.endsWith('\n') ? t : t + '\n').join('');
}
// Put the worker into the state "clean pin + this patch text" (null/'' = clean pin). Idempotent: same text -> no change.
export async function ensureStateText(adapter, text, { allowSchema = false } = {}) {
  const want = text ? sha(text) : null, have = adapter.state.patch?.sha ?? null;
  if (want === have) return { changed: false, applied: have };
  if (have) await adapter.revertDiff();
  if (!text) return { changed: true, applied: null };
  const r = await adapter.applyDiff(text, { allowSchema });
  return { changed: true, applied: r.sha, assets: r.assets };
}
