import { createHash } from 'node:crypto';

export const sha256 = v => createHash('sha256').update(v).digest('hex');
export const canonical = v => v && typeof v === 'object'
  ? Array.isArray(v) ? v.map(canonical) : Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
export const canonicalJSON = v => JSON.stringify(canonical(v));
export const planShort = hash => hash.slice(0, 12);

// Task key: <kind>:<scope>, optionally #N (N >= 2) for a deliberate, reasoned re-run.
const TASK = /^([a-z][a-z0-9-]*):([A-Za-z0-9._/-]+?)(?:#(\d+))?$/;
export function parseTaskKey(key) {
  const m = TASK.exec(key);
  if (!m) throw new Error(`Invalid task key "${key}": expected <kind>:<scope>[#N], e.g. campaign:moodle/luna`);
  const rerun = m[3] === undefined ? 1 : Number(m[3]);
  if (m[3] !== undefined && rerun < 2) throw new Error('A re-run suffix must be #2 or higher');
  return { kind: m[1], scope: m[2], base: `${m[1]}:${m[2]}`, rerun, key };
}
// Trial key: <planShort>/<case>/<state>/<arm>/<model>/r<k>[#N]
export function trialKey({ plan, caseId, state, arm, model, repetition, rerun = 1 }) {
  for (const [n, v] of Object.entries({ plan, caseId, state, arm, model })) if (!v || /[\s]/.test(String(v))) throw new Error(`Trial key part ${n} is missing or contains whitespace`);
  if (!Number.isInteger(repetition) || repetition < 1) throw new Error('Trial repetition must be a positive integer');
  return `${plan}/${caseId}/${state}/${arm}/${model}/r${repetition}${rerun > 1 ? `#${rerun}` : ''}`;
}
// systemd unit name: readable prefix plus a hash so distinct keys never collide after sanitizing.
export const unitName = key => `study-${key.replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)}-${sha256(key).slice(0, 8)}`;
export const fileSafe = key => unitName(key).slice('study-'.length);
