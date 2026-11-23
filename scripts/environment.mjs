import { readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { appRoot } from './mutations.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
async function digestTree(path, { signal } = {}) {
  // Hash a deterministic in-memory tar stream. No archive or copy is written.
  // The earlier per-file JS stream walk took78s over120k app files; the same
  // byte coverage through tar avoids120k asynchronous stream lifecycles.
  const hash = createHash('sha256'); let bytes = 0, stderr = '';
  const child = spawn('tar', ['--sort=name', '--format=gnu', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner', '--exclude=./.vite', '--exclude=./.cache', '-cf', '-', '-C', path, '.'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error('Environment tree hashing failed: ' + stderr))); });
  closed.catch(() => {});
  const abort = () => child.kill('SIGKILL'); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
  child.stderr.on('data', chunk => { stderr += chunk; if (stderr.length > 10000) abort(); });
  try { for await (const chunk of child.stdout) { hash.update(chunk); bytes += chunk.length; } await closed; signal?.throwIfAborted(); }
  finally { signal?.removeEventListener('abort', abort); }
  return { sha256: hash.digest('hex'), bytes, algorithm: 'sorted-gnu-tar-v1;mtime=0;owner=group=0;exclude root .vite/.cache' };
}
export async function environmentFingerprint({ signal } = {}) {
  const cliPath = execFileSync('which', ['codex'], { encoding: 'utf8', timeout: 2000 }).trim();
  const result = { nodeVersion: process.version, cliVersion: execFileSync('codex', ['--version'], { encoding: 'utf8', timeout: 5000 }).trim(),
    rootDependencies: await digestTree(root + 'node_modules', { signal }),
    appDependencies: await digestTree(appRoot + 'node_modules', { signal }),
    chromium: await digestTree(dirname(chromium.executablePath()), { signal }),
    nodeExecutable: await digestFile(process.execPath, signal), cliExecutable: await digestFile(cliPath, signal),
    versions: {} };
  for (const [name, base] of [['@playwright/mcp', root], ['playwright', root], ['@cucumber/cucumber', root], ['vite', appRoot], ['ts-node', appRoot]]) result.versions[name] = JSON.parse(await readFile(base + 'node_modules/' + name + '/package.json', 'utf8')).version;
  return result;
}
async function digestFile(path, signal) { const hash = createHash('sha256'); for await (const chunk of createReadStream(path, { signal })) hash.update(chunk); return hash.digest('hex'); }
export async function fixtureProvenance({ signal } = {}) {
  const url = process.env.STUDY_FIXTURE_PROVENANCE_URL;
  if (!url || !/^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{48}$/.test(url)) throw new Error('Owned running fixture provenance URL is required');
  const response = await fetch(url, { signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(3000)]) });
  if (!response.ok) throw new Error('Running fixture provenance is unavailable');
  const result = await response.json();
  if (result.children.length !== 2 || result.children.some(child => !child.alive || !child.commandUnchanged)) throw new Error('Owned fixture process identity changed');
  return result;
}
