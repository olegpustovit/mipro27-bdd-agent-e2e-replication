// Reads manifests/moodle.yaml and resolves scenarios and patches. The manifest names scenarios by feature + title; the
// line number is looked up in the pinned source (never stored: it would be a copy of Moodle test code).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { repoRoot } from './config.mjs';
import { parseFeature } from './gherkin.mjs';

export function loadManifest(root = repoRoot) {
  const m = YAML.parse(readFileSync(join(root, 'manifests/moodle.yaml'), 'utf8'));
  m.scenarioById = new Map(m.scenarios.map(s => [s.id, s]));
  m.breakById = new Map(m.breaks.map(b => [b.id, b]));
  m.faultById = new Map(m.faults.map(f => [f.id, f]));
  // Wave-2 fault candidates (mined from history or seeded) are addressable as `fault:<id>` states like the original faults.
  m.candidateById = new Map((m.fault_candidates ?? []).map(f => [f.id, f]));
  for (const [id, c] of m.candidateById) { if (m.faultById.has(id)) throw new Error(`Duplicate fault id ${id}`); m.faultById.set(id, c); }
  return m;
}
export const patchFile = (entry, root = repoRoot) => entry ? join(root, entry.file) : null;
// Feature path relative to the Moodle root (the pin uses the public/ layout).
export const featurePath = s => (s.feature.startsWith('public/') ? s.feature : `public/${s.feature}`);
// {feature, line, name, steps, tags} of a manifest scenario, read from the worker's (or base) source tree.
export function locateScenario(manifest, id, srcDir) {
  const s = manifest.scenarioById.get(id); if (!s) throw new Error(`Unknown scenario ${id}`);
  const feature = parseFeature(readFileSync(join(srcDir, featurePath(s)), 'utf8'));
  const hits = feature.scenarios.filter(x => x.name === s.name);
  if (hits.length !== 1) throw new Error(`Scenario ${id} "${s.name}": ${hits.length} matches in ${s.feature}`);
  return { id, feature: featurePath(s), line: hits[0].line, name: s.name, kind: hits[0].kind, javascript: s.javascript };
}
// Which patch (relative path) puts a worker into a state. null = the pin itself (healthy / adapted).
export function stateSpec(manifest, state) {
  const [kind, id] = state.split(':');
  if (state === 'healthy') return { kind, patch: null };
  if (kind === 'before' || kind === 'broken') { const b = manifest.breakById.get(id); if (!b?.patches?.[kind]) throw new Error(`No ${kind} patch for ${id}`); return { kind, id, patch: b.patches[kind], flags: b.patch_flags }; }
  // Arm B's starting state: new UI + the developers' NEW .feature files + OLD step definitions/selectors (only the non-.feature test hunks reverted).
  // An empty patch (the developers' fix touched no step definition: a Gherkin-only fix) is the clean pin itself.
  if (kind === 'broken-steps') {
    const b = manifest.breakById.get(id), p = b?.patches?.broken_steps; if (!p || !b.test_half_split) throw new Error(`No broken-steps patch for ${id}`);
    return { kind, id, patch: b.test_half_split.empty ? null : p, emptyPatch: b.test_half_split.empty, patchRecord: p, flags: b.patch_flags };
  }
  if (kind === 'fault') { const f = manifest.faultById.get(id); if (!f?.patch) throw new Error(`No fault patch for ${id}`); return { kind, id, patch: f.patch, flags: f.patch_flags }; }
  throw new Error(`Unknown state ${state}`);
}

// The manifest's target `step_index` counts the scenario's own steps (0-based, mined at the fix commit); Behat's step index also counts the
// Background steps that run first, and the scenario at the pin may have been edited since the fix. The comparable target is therefore:
//   the pin step whose text equals the manifest step text (closest to background + step_index when several), method "text";
//   else background + step_index, method "index" (text no longer present at the pin).
import { parseFeature as _parse, effectiveSteps as _eff } from './gherkin.mjs';
export function resolveTarget(manifest, fault, srcDir) {
  const s = manifest.scenarioById.get(fault.target.scenario), feature = _parse(readFileSync(join(srcDir, featurePath(s)), 'utf8'));
  const sc = feature.scenarios.find(x => x.name === s.name), steps = _eff(feature, sc), background = steps.filter(x => x.background).length, nominal = background + fault.target.step_index;
  const hits = steps.filter(x => x.text === fault.target.step_text).sort((a, b) => Math.abs(a.index - nominal) - Math.abs(b.index - nominal));
  return hits.length ? { behatIndex: hits[0].index, method: 'text', nominal, background, textHits: hits.length } : { behatIndex: nominal, method: 'index', nominal, background, textHits: 0 };
}

// The target of a fault in a given scenario: the primary `target` or one of `alt_targets` (same fix, another scenario).
export function faultTarget(manifest, faultId, scenario) {
  const f = manifest.faultById.get(faultId); if (!f) throw new Error(`Unknown fault ${faultId}`);
  if (!scenario || scenario === f.target.scenario) return { ...f.target };
  // Seeded/mined candidates keep their other scenarios as `screen_targets` (first failing step of the screening run, frozen before break pairing), not as `alt_targets`.
  const alt = (f.alt_targets ?? []).find(a => a.scenario === scenario) ?? (f.screen_targets ?? []).find(a => a.scenario === scenario);
  if (!alt) throw new Error(`${faultId} has no target in ${scenario}`);
  return { ...f.target, ...alt };
}
