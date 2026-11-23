import { readFileSync } from 'node:fs';
// Start time (clock ticks since boot) from /proc/<pid>/stat: distinguishes a live process from a reused pid.
export function pidStart(pid) {
  try { const s = readFileSync(`/proc/${pid}/stat`, 'utf8'); return Number(s.slice(s.lastIndexOf(')') + 2).split(' ')[19]); } catch { return null; }
}
export function pidAlive(pid, start = null) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); } catch (e) { if (e.code !== 'EPERM') return false; }
  if (start != null) { const now = pidStart(pid); if (now != null && now !== start) return false; }
  try { const s = readFileSync(`/proc/${pid}/stat`, 'utf8'); if (s.slice(s.lastIndexOf(')') + 2, s.lastIndexOf(')') + 3) === 'Z') return false; } catch {}
  return true;
}
