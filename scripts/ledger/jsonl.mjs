// Append-only JSON-lines files. One write() per line with O_APPEND, fsync before the lock is released.
import { openSync, writeSync, fsyncSync, closeSync, existsSync, readFileSync } from 'node:fs';
import { withLock } from './lock.mjs';

export function appendSync(path, values) {
  const text = [].concat(values).map(v => JSON.stringify(v) + '\n').join('');
  const fd = openSync(path, 'a', 0o600);
  try { writeSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
}
export function readLines(path) {
  if (!existsSync(path)) return [];
  const out = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line) continue;
    try { out.push(JSON.parse(line)); } catch { out.push({ type: 'corrupt-line', raw: line.slice(0, 200) }); }
  }
  return out;
}
// Serialized append of one or more events.
export const append = (path, lockPath, values) => withLock(lockPath, () => appendSync(path, values));
// Read-decide-append under one lock. fn(events) returns events to append (or []); its return value is passed through
// via { append, result }.
export async function transaction(path, lockPath, fn) {
  return withLock(lockPath, async () => {
    const events = readLines(path);
    const out = await fn(events);
    const toAppend = out?.append ?? [];
    if (toAppend.length) appendSync(path, toAppend);
    return out?.result;
  });
}
