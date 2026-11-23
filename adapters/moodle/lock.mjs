// Per-worker exclusive lock under the data directory (never /tmp). Stale locks (dead pid) are reclaimed.
import { openSync, closeSync, writeSync, readFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
export function acquireLock(path, owner = 'adapter') {
  mkdirSync(dirname(path), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, 'wx');
      writeSync(fd, JSON.stringify({ pid: process.pid, owner, since: new Date().toISOString() }));
      closeSync(fd);
      let released = false;
      return () => { if (released) return; released = true; try { unlinkSync(path); } catch {} };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let held; try { held = JSON.parse(readFileSync(path, 'utf8')); } catch { held = null; }
      if (held && alive(held.pid)) throw new Error(`Worker lock ${path} held by pid ${held.pid} (${held.owner}) since ${held.since}`);
      try { unlinkSync(path); } catch {}   // stale or our own earlier crash
    }
  }
  throw new Error(`Cannot acquire lock ${path}`);
}
