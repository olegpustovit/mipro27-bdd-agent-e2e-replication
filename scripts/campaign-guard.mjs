import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { appRoot } from './mutations.mjs';
import { manifest, cases } from '../study/manifest.mjs';
import { cumulativeConfig } from '../study/cumulative-plan.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const canonical = value => value && typeof value === 'object' ? Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export function recordDigest(record) {
  const { type, recordSHA, excludedFromStudy, ...payload } = record;
  return sha256(JSON.stringify(canonical(payload)));
}
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 5000 });
const paths = (cwd, patterns) => [...new Set(git(cwd, ['ls-files', '--cached', '--others', '--exclude-standard', '--', ...patterns]).trim().split('\n').filter(Boolean))].sort();
export function sourcePins({ normalizeEnable = false, enabled = false } = {}) {
  return Object.fromEntries(paths(root, ['scripts/*.mjs', 'study/*.mjs', 'study/*.feature', 'package.json', 'package-lock.json']).map(path => {
    let content = readFileSync(root + path);
    if ((normalizeEnable || enabled) && path === 'study/cumulative-plan.mjs') {
      const text = content.toString();
      if ((text.match(/campaignEnabled: (?:true|false),/g) || []).length !== 1) throw new Error('Ambiguous campaign enable literal');
      content = enabled ? text.replace('campaignEnabled: false,', 'campaignEnabled: true,') : text.replace('campaignEnabled: true,', 'campaignEnabled: false,');
    }
    return [path, sha256(content)];
  }));
}
export function appPins() {
  return { revision: git(appRoot, ['rev-parse', 'HEAD']).trim(),
    files: Object.fromEntries(paths(appRoot, ['src/*', 'backend/*', 'package.json', 'yarn.lock', '*config*', 'tsconfig*', 'data/database-seed.json']).map(path => [path, sha256(readFileSync(appRoot + path))])) };
}
export function samePins(actual, expected, name) {
  if (JSON.stringify(canonical(actual)) !== JSON.stringify(canonical(expected))) throw new Error(name + ' differs from the frozen inputs');
}
// The trusted launching controller must obtain gateNode and the exact manifest
// through live Foundry MCP immediately before invocation. This function binds
// that receipt to execution; it does not authenticate arbitrary caller JSON.
// The MCP workflow, not a local boolean or this parser, decides gate approval.
export function verifyApproval(approval, { source = sourcePins(), disabledSource = sourcePins({ normalizeEnable: true }), app = appPins(), environment, deadline } = {}) {
  const node = approval?.gateNode, input = approval?.manifest;
  if (approval?.verificationMode !== 'trusted-controller-live-MCP' || node?.id !== 'mipro27-bdd-agent-e2e/evidence-plan/4' || node.state !== 'done' || node.verdict?.verdict !== 'pass' || node.verdict.id !== approval.gateRef || !node.outputs?.some(out => out.sha256 === approval.reviewedArtifactSHA)) throw new Error('Exact fresh Foundry Evidence pass and reviewed artifact are required');
  if (!input || sha256(JSON.stringify(input)) !== approval.reviewedArtifactSHA) throw new Error('Reviewed manifest content differs from its Foundry artifact hash');
  if (!deadline || input.originalDeadline !== deadline || app.revision !== manifest.appRevision) throw new Error('Approved deadline/application revision differs');
  const disabled = structuredClone(input.enabledSourcePins);
  const changed = Object.keys(disabled).filter(path => disabled[path] !== input.sourcePins[path]);
  if (changed.length !== 1 || changed[0] !== 'study/cumulative-plan.mjs' || Object.keys(disabled).length !== Object.keys(input.sourcePins).length) throw new Error('Only the reviewed enabling delta is permitted');
  samePins(source, input.enabledSourcePins, 'Enabled study source'); samePins(app, input.appPins, 'Application/seed/dependencies');
  samePins(disabledSource, input.sourcePins, 'Source with only campaignEnabled normalized');
  samePins(environment, input.environment, 'Installed environment');
  return approval;
}
export function validatePlan(stages) {
  const trials = stages.flatMap(s => s.trials), count = (key, value) => trials.filter(t => t[key] === value).length;
  if (cases.length !== 12 || new Set(cases.map(c => c.id)).size !== 12 || new Set(cases.map(c => c.family)).size !== 6 || trials.length !== 216 || new Set(trials.map(t => t.id)).size !== 216 || count('kind', 'healthy') !== 120 || count('kind', 'fault') !== 96 || count('arm', 'maintained') !== 108 || count('arm', 'runtime') !== 108) throw new Error('Full216trial allocation is invalid');
  for (const stage of stages) {
    if (stage.kind === 'maintenance') { if (stage.trials.length) throw new Error('Maintenance cannot contain probes'); continue; }
    if (stage.trials.length !== 24) throw new Error('Each trial stage requires all12cases in both arms');
    for (const item of cases) for (const arm of ['maintained', 'runtime']) {
      const matches = stage.trials.filter(t => t.caseId === item.id && t.arm === arm);
      if (matches.length !== 1 || matches[0].family !== item.family || matches[0].repairAllowed !== false || matches[0].fault !== (stage.kind === 'fault') || matches[0].revision !== stage.revision) throw new Error('Trial allocation or repair isolation differs');
    }
  }
  return trials;
}
export function createTrialLedger(stages) {
  const entries = new Map(validatePlan(stages).map(trial => [trial.id, { trial, status: 'not-run', reason: 'campaign has not reached this trial' }]));
  const emitted = new Map();
  const entry = id => { if (!entries.has(id)) throw new Error('Unknown trial ID'); return entries.get(id); };
  return {
    start(id) { const e = entry(id); if (e.status !== 'not-run' || [...entries.values()].some(x => x.status === 'started')) throw new Error('Duplicate/overlapping trial'); e.status = 'started'; delete e.reason; },
    emitted(record) {
      const id = record.trial.id; entry(id);
      if (emitted.has(id) || record.trialId !== id || record.recordSHA !== recordDigest(record)) throw new Error('Duplicate or invalid emitted trial record');
      emitted.set(id, { digest: record.recordSHA, implementationSHA: record.implementationSHA });
    },
    record(id, record, expectedImplementationSHA) {
      const e = entry(id), emission = emitted.get(id);
      if (e.status !== 'started' || record.trial.id !== id || record.trialId !== id || record.recordSHA !== recordDigest(record) || emission?.digest !== record.recordSHA || emission.implementationSHA !== record.implementationSHA || record.implementationSHA !== expectedImplementationSHA) throw new Error('Trial record attribution, emission or frozen artifact differs');
      e.status = record.error ? 'infrastructure-invalid' : 'recorded'; e.recordSHA = record.recordSHA; e.implementationSHA = record.implementationSHA; if (record.error) e.reason = record.error;
    },
    stop(reason) { for (const e of entries.values()) if (e.status === 'started' || e.status === 'not-run') { if (e.status === 'started') e.status = 'infrastructure-invalid'; e.reason = reason; } },
    finish(frozenSHA) {
      if (emitted.size !== 216 || [...entries.values()].some(e => e.status !== 'recorded' || e.recordSHA !== emitted.get(e.trial.id)?.digest || e.implementationSHA !== frozenSHA(e.trial.revision))) throw new Error('Campaign terminal ledger is incomplete or unreconciled');
      return [...entries.values()];
    },
    snapshot: () => structuredClone([...entries.values()]),
  };
}
export function remainingBudget(stages, stageIndex, trialIndex = 0) {
  let ms = cumulativeConfig.finalizationReserveMs;
  for (let i = stageIndex; i < stages.length; i++) {
    const stage = stages[i];
    if (stage.kind === 'maintenance') ms += cumulativeConfig.maintenanceWallMs + cumulativeConfig.maintenanceCleanupMs;
    else for (const trial of stage.trials.slice(i === stageIndex ? trialIndex : 0)) ms += cumulativeConfig.fixtureEnvelopeMs + (trial.arm === 'runtime' ? cumulativeConfig.runtimeWallMs : cumulativeConfig.retainedWallMs);
  }
  return ms;
}
