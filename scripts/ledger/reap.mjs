// Reap processes that outlived a job. Playwright starts Chromium detached (its own session and process group), so killing the job's
// process or process group after a SIGKILL leaves the browser (and its zygote/renderers) running as an orphan. Every job the ledger
// launches carries STUDY_REAP_TAG=<task key> in its environment; children inherit it whatever their process group, so the tag finds
// them in /proc/<pid>/environ. Linux only (like the flock-based locks). Only processes of the same user can be inspected, which is
// all a job's children ever are.
import { readdirSync, readFileSync } from 'node:fs';

export const REAP_ENV = 'STUDY_REAP_TAG';
const sleep = ms => new Promise(r => setTimeout(r, ms));
function ancestors() {
  const out = new Set([process.pid]);
  for (let pid = process.ppid; pid > 1 && !out.has(pid); ) {
    out.add(pid);
    try { const s = readFileSync(`/proc/${pid}/stat`, 'utf8'); pid = Number(s.slice(s.lastIndexOf(')') + 2).split(' ')[1]); } catch { break; }
  }
  return out;
}
// Processes (pid, comm) whose environment carries the tag, never this process or its ancestors.
export function findTagged(tag) {
  const mine = ancestors(), needle = `${REAP_ENV}=${tag}`, found = [];
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name) || mine.has(Number(name))) continue;
    try {
      const env = readFileSync(`/proc/${name}/environ`, 'latin1').split('\0');
      if (!env.includes(needle)) continue;
      const stat = readFileSync(`/proc/${name}/stat`, 'utf8');
      if (stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3) === 'Z') continue;   // zombie: nothing left to kill
      found.push({ pid: Number(name), comm: stat.slice(stat.indexOf('(') + 1, stat.lastIndexOf(')')) });
    } catch { /* gone, or not ours to read */ }
  }
  return found;
}
// SIGTERM, wait up to graceMs, SIGKILL what is left. Returns { found, killed, survivors } (comm names, no secrets).
export async function reapTagged(tag, { graceMs = 3000 } = {}) {
  const first = findTagged(tag);
  if (!first.length) return { found: 0, killed: [], survivors: 0 };
  for (const p of first) try { process.kill(p.pid, 'SIGTERM'); } catch {}
  const until = Date.now() + graceMs;
  while (Date.now() < until && findTagged(tag).length) await sleep(100);
  let left = findTagged(tag);
  for (const p of left) try { process.kill(p.pid, 'SIGKILL'); } catch {}
  if (left.length) { const t2 = Date.now() + 2000; while (Date.now() < t2 && findTagged(tag).length) await sleep(50); }
  return { found: first.length, killed: first.map(p => p.comm), survivors: findTagged(tag).length };
}
