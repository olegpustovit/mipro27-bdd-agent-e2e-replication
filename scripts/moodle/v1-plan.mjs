// Model-free V1 reproduction plan: which (scenario, state) trials exist, derived from the manifest only.
//   healthy            pin as is (= "adapted": current UI + the developers' repaired tests), once per scenario, shared by every pair
//   before:Bxx         old UI + old tests                      (state before the break)
//   broken:Bxx         new UI + old tests                      (developer test half reverted)
//   broken-steps:Bxx   new UI + the developers' NEW .feature files + OLD step definitions (arm B's starting state); run only where it differs from broken:Bxx
//   fault:Fxx          pin with the fix's non-test hunks reverted (the linked scenario must fail near the manifest target step)
// Usable breaks only (manifest `usable`); class i and class ii.
import { loadManifest } from '../../adapters/moodle/manifest.mjs';

export function v1Trials(manifest = loadManifest(), { perBreakMax = 99 } = {}) {
  const scen = new Set(), items = [];
  const add = (scenario, state, meta) => { items.push({ scenario, state, ...meta }); };
  const breaks = manifest.breaks.filter(b => b.usable);
  for (const b of breaks) {
    const linked = manifest.faults.filter(f => f.linked_breaks.includes(b.id)).map(f => f.target.scenario);
    const sc = [...new Set([...linked, ...b.affected_scenarios])].slice(0, perBreakMax);
    for (const s of sc) { scen.add(s); add(s, `broken:${b.id}`, { break: b.id }); add(s, `before:${b.id}`, { break: b.id }); if (b.test_half_split && !b.test_half_split.identical_to_broken) add(s, `broken-steps:${b.id}`, { break: b.id }); }
  }
  for (const f of manifest.faults) { scen.add(f.target.scenario); add(f.target.scenario, `fault:${f.id}`, { fault: f.id }); }
  for (const s of scen) add(s, 'healthy', {});
  const seen = new Set(); return items.filter(i => { const k = `${i.scenario}|${i.state}`; if (seen.has(k)) return false; seen.add(k); return true; });
}
// Group trials by state so a worker applies each patch once; balance groups over workers (largest first).
export function assignGroups(trials, workers) {
  const groups = new Map(); for (const t of trials) (groups.get(t.state) ?? groups.set(t.state, []).get(t.state)).push(t);
  const load = Object.fromEntries(workers.map(w => [w, 0])), out = Object.fromEntries(workers.map(w => [w, []]));
  for (const [state, list] of [...groups].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) {
    const w = workers.reduce((x, y) => load[y] < load[x] ? y : x); load[w] += list.length + 1; out[w].push(...list.map(t => ({ ...t, group: state })));
  }
  return out;
}
