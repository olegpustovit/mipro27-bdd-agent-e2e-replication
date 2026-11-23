// Cross-process mutual exclusion through util-linux flock(1).
// Why flock and not an O_EXCL lock file: the kernel drops the lock when the holder dies (kill -9, OOM, power loss),
// so there is no stale-lock detection to get wrong. A helper `flock ... cat` process holds the lock; closing its
// stdin (or the death of this process, which closes the pipe) releases it.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export async function acquire(lockPath, { timeoutMs = 60000 } = {}) {
  mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 });
  const child = spawn('flock', ['-x', '-w', String(Math.ceil(timeoutMs / 1000)), lockPath, 'sh', '-c', 'echo L; exec cat'], { stdio: ['pipe', 'pipe', 'ignore'] });
  const exited = new Promise(resolve => child.once('close', code => resolve(code)));
  await new Promise((resolve, reject) => {
    let buf = '';
    child.stdout.on('data', d => { buf += d; if (buf.includes('L')) resolve(); });
    child.once('error', reject);
    exited.then(code => reject(new Error(`could not take lock ${lockPath} (flock exit ${code})`)));
  });
  let released = false;
  return async () => { if (released) return; released = true; child.stdin.end(); await exited; };
}
export async function withLock(lockPath, fn, options) {
  const release = await acquire(lockPath, options);
  try { return await fn(); } finally { await release(); }
}
