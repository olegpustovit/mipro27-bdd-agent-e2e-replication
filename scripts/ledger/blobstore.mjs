// Per-trial content-addressed trace store.
//   <blobs>/objects/<aa>/<sha256>          immutable blob bytes (dedup across trials)
//   <blobs>/trials/<fileSafe(trialKey)>.json  manifest: [{ name, kind, sha256, bytes, at, meta }]
// Hooks: attach(trialKey, kind, name, bytesOrPath) from any lane (Playwright trace.zip, MCP snapshots, CLI rollout).
import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, copyFileSync, statSync, createReadStream, openSync, fsyncSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { ledgerPaths } from './paths.mjs';
import { fileSafe } from './keys.mjs';
import { withLock } from './lock.mjs';

export const KINDS = ['playwright-trace', 'mcp-snapshot', 'cli-rollout', 'screenshot', 'other'];
const hashFile = path => new Promise((resolve, reject) => { const h = createHash('sha256'); createReadStream(path).on('data', d => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject); });

export function createBlobStore({ root = ledgerPaths().blobs } = {}) {
  const objects = join(root, 'objects'), trials = join(root, 'trials');
  const manifestPath = key => join(trials, fileSafe(key) + '.json');
  const objectPath = sha => join(objects, sha.slice(0, 2), sha);
  const fsyncPath = p => { const fd = openSync(p, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } };
  async function putObject(source) {
    // source: Buffer/string content, or { path } of an existing file.
    const isPath = source && typeof source === 'object' && !Buffer.isBuffer(source);
    const sha = isPath ? await hashFile(source.path) : createHash('sha256').update(source).digest('hex');
    const dest = objectPath(sha);
    if (!existsSync(dest)) {
      mkdirSync(join(objects, sha.slice(0, 2)), { recursive: true });
      const tmp = `${dest}.tmp-${process.pid}-${Date.now()}`;
      if (isPath) copyFileSync(source.path, tmp); else writeFileSync(tmp, source);
      fsyncPath(tmp); renameSync(tmp, dest);
    }
    return { sha256: sha, bytes: statSync(dest).size };
  }
  return {
    root,
    objectPath,
    async attach(trialKey, kind, name, source, meta = {}) {
      if (!KINDS.includes(kind)) throw new Error(`Unknown blob kind ${kind}; use one of ${KINDS.join(', ')}`);
      const { sha256, bytes } = await putObject(source);
      mkdirSync(trials, { recursive: true });
      await withLock(manifestPath(trialKey) + '.lock', () => {
        const file = manifestPath(trialKey);
        const manifest = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { trialKey, entries: [] };
        if (!manifest.entries.some(e => e.name === name && e.sha256 === sha256)) manifest.entries.push({ name, kind, sha256, bytes, at: new Date().toISOString(), meta });
        const tmp = file + '.tmp'; writeFileSync(tmp, JSON.stringify(manifest, null, 2)); fsyncPath(tmp); renameSync(tmp, file);
      });
      return { sha256, bytes };
    },
    manifest(trialKey) { const f = manifestPath(trialKey); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : { trialKey, entries: [] }; },
    read(sha) { return readFileSync(objectPath(sha)); },
    // Re-hash every stored object of a trial; returns the entries whose bytes no longer match.
    async verify(trialKey) { const bad = []; for (const e of this.manifest(trialKey).entries) { if (!existsSync(objectPath(e.sha256)) || await hashFile(objectPath(e.sha256)) !== e.sha256) bad.push(e); } return bad; },
  };
}
