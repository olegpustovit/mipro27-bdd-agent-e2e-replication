import { createHash } from 'node:crypto';
import { defaultActions } from './baseline.mjs';
import { locators, validateLocators } from '../study/locators.mjs';
import { validateActions } from './repair-policy.mjs';
import { InfrastructureError } from './infrastructure.mjs';
const digest = value => createHash('sha256').update(value).digest('hex');
const clone = value => structuredClone(value);

export function implementation({ actions = defaultActions(), selectors = locators } = {}) {
  validateActions(actions); validateLocators(selectors);
  const value = { actions, selectors: Object.fromEntries(Object.entries(selectors).sort(([a], [b]) => a.localeCompare(b))) };
  return { ...value, sha256: digest(JSON.stringify(value)) };
}

// One state per campaign. No trial or probe method can mutate its artifacts.
export function createMaintenanceState({ initial = implementation(), maxEdits = 3, maxValidations = 4, emit = () => {} } = {}) {
  let current = implementation(initial), phase = null;
  const frozen = new Map([['v0', clone(current)]]);
  const view = () => ({ ...clone(current), phase: phase && { revision: phase.revision, edits: phase.edits,
    validations: phase.validations, editsRemaining: maxEdits - phase.edits, validationsRemaining: maxValidations - phase.validations } });
  const requirePhase = () => { if (!phase || phase.finished) throw new Error('Shared maintenance is not active; frozen trials cannot repair'); if (phase.failure) throw new InfrastructureError('Shared maintenance infrastructure failed'); };
  return {
    begin(revision, from) {
      if (phase && !phase.finished) throw new Error('A shared maintenance phase is already active');
      if (!['v1', 'v2'].includes(revision) || frozen.has(revision) || !frozen.has(from) || (revision === 'v1' ? from !== 'v0' : from !== 'v1')) throw new Error('Invalid cumulative maintenance transition');
      current = clone(frozen.get(from)); phase = { revision, from, edits: 0, validations: 0, finished: false };
      emit({ type: 'maintenance-begin', revision, from, initial: view() }); return view();
    },
    read: view,
    poison(reason) { if (phase && !phase.finished) { phase.failure = String(reason); emit({ type: 'maintenance-poisoned', revision: phase.revision, error: phase.failure }); } },
    repair(args) {
      requirePhase();
      if (!args || typeof args !== 'object' || Array.isArray(args) || !Object.keys(args).length || Object.keys(args).some(k => !['actions', 'locators'].includes(k))) throw new Error('Supply actions and/or complete locators');
      const candidate = implementation({ actions: args.actions ?? current.actions, selectors: args.locators ? { ...current.selectors, ...args.locators } : current.selectors });
      if (candidate.sha256 === current.sha256) return { changed: false, ...view() };
      if (phase.edits >= maxEdits) throw new Error('Shared maintenance edit limit reached');
      const before = current.sha256; current = candidate; phase.edits++;
      emit({ type: 'maintenance-edit', revision: phase.revision, edit: phase.edits, before, implementation: clone(current) });
      return { changed: true, sha256: current.sha256, edits: phase.edits };
    },
    validation() {
      requirePhase(); if (phase.validations >= maxValidations) throw new Error('Shared maintenance validation limit reached');
      phase.validations++; return { number: phase.validations, revision: phase.revision, implementation: clone(current) };
    },
    finish(reason) {
      if (!phase || phase.finished) throw new Error('No active maintenance phase');
      phase.finished = true; frozen.set(phase.revision, clone(current));
      const result = { revision: phase.revision, from: phase.from, edits: phase.edits, validations: phase.validations, reason, implementation: clone(current) };
      emit({ type: 'maintenance-frozen', ...result }); return result;
    },
    // Resume uses only the append-only recorded frozen artifact; it never
    // replays a maintenance agent or reconstructs an edit from a later probe.
    restore(revision, from, saved) {
      if (!['v1', 'v2'].includes(revision) || frozen.has(revision) || !frozen.has(from) || !saved) throw new Error('Invalid persisted maintenance state');
      const restored = implementation(saved);
      if (saved.sha256 !== restored.sha256) throw new Error('Persisted maintenance artifact digest differs');
      frozen.set(revision, clone(restored)); current = clone(restored);
      emit({ type: 'maintenance-restored', revision, from, implementation: clone(restored) });
      return clone(restored);
    },
    frozen(revision) { if (!frozen.has(revision)) throw new Error('No frozen implementation for ' + revision); return clone(frozen.get(revision)); },
  };
}

export const maintenanceTools = [
  { name: 'baseline_read', description: 'Read the shared retained actions, locator registry, immutable Cucumber assertions and remaining maintenance limits. Repairs carry forward across releases.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'baseline_repair', description: 'Replace shared UI actions and/or complete locator values. Assertions and scenarios are immutable. Each UI mutation must be one returned primitive in its own awaited World.act. Up to three accepted shared edits in this healthy release.', inputSchema: { type: 'object', properties: { actions: { type: 'string' }, locators: { type: 'object', additionalProperties: { type: 'string' } } }, additionalProperties: false } },
  { name: 'baseline_validate', description: 'Validate the current shared implementation against all twelve unchanged Cucumber scenarios on this healthy UI. Data and browser state reset per scenario. Returns actual test failures, without private oracle feedback. Up to four suites including the initial diagnostic suite.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
];
export function createMaintenanceTools(requestHost) {
  return async (name, args = {}) => {
    if (!maintenanceTools.some(t => t.name === name)) throw new Error('Unknown shared maintenance tool');
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Tool arguments must be an object');
    if (name !== 'baseline_repair' && Object.keys(args).length) throw new Error('This tool takes no arguments');
    return requestHost('maintenance-' + name.slice('baseline_'.length), args);
  };
}
