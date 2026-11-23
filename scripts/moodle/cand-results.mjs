#!/usr/bin/env node
// Prints, as JSON lines, every ledger trial of a wave-2 fault candidate (state fault:C### / fault:X###) with what mining/record_candidates.py needs:
// scenario, round, status, failing Behat step index and text, the scenario's own-step index of that step (Behat index minus Background steps),
// and the healthy result of the same scenario (earliest passed|failed round, as the V1 report does).
import { readLines } from '../ledger/jsonl.mjs';
import { ledgerPaths } from '../ledger/paths.mjs';
import { loadManifest, locateScenario } from '../../adapters/moodle/manifest.mjs';
import { parseFeature } from '../../adapters/moodle/gherkin.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataHome, resolveMoodleCommit } from '../../adapters/moodle/config.mjs';
import { collect } from './v1-report.mjs';

// Only trials of the wave-2 plans (moodle-cand-*) count: the original faults F01..F24 were also run in the V1 plans, which stay as they are.
const shorts = new Set(readLines(ledgerPaths().tasks).filter(e => e.type === 'plan-frozen' && /^moodle-cand-/.test(e.plan)).map(e => e.short));
const manifest = loadManifest(), src = join(dataHome(), 'src', resolveMoodleCommit().slice(0, 12)), events = readLines(ledgerPaths().trials), rows = collect(events);
function background(id) { return bgOf(id); }
const bgOf = id => { const s = manifest.scenarioById.get(id), f = parseFeature(readFileSync(join(src, s.feature.startsWith('public/') ? s.feature : `public/${s.feature}`), 'utf8')); return f.background?.steps.length ?? 0; };
const healthy = id => (rows.get(`${id}|healthy`) ?? []).find(r => r.status === 'passed' || r.status === 'failed')?.status ?? 'not-run';
// A state the adapter refused to build (e.g. a patch touching db/install.xml) ends the trial with outcome `error` and no scenario run.
for (const e of events) if (e.type === 'trial-end' && e.outcome === 'error' && /\/fault:([CX]\d{3}|F\d{2})\//.test(e.key ?? '') && shorts.has(e.key.split('/')[0])) {
  const [, scenario, state] = e.key.split('/');
  console.log(JSON.stringify({ candidate: state.slice(6), scenario, round: Number(/\/r(\d+)/.exec(e.key)[1]), key: e.key, at: e.at, status: 'refused', healthy: healthy(scenario), failingStepIndex: null, failingText: null, failingError: String(e.error).slice(0, 200), background: 0, ownStepIndex: null, inBackground: false, javascript: manifest.scenarioById.get(scenario).javascript, wallMs: null }));
}
for (const [k, list] of rows) {
  const [scenario, state] = k.split('|');
  if (!/^fault:([CX]\d{3}|F\d{2})$/.test(state)) continue;
  const bg = background(scenario);
  for (const r of list.filter(r => shorts.has(r.key.split('/')[0]))) {
    const fi = r.failingStepIndex ?? null;
    console.log(JSON.stringify({ candidate: state.slice(6), scenario, round: r.round, key: r.key, at: r.at, status: r.status, healthy: healthy(scenario), failingStepIndex: fi, failingText: r.failingStep?.text ?? null, failingError: r.failingStep?.error?.slice(0, 200) ?? null,
      background: bg, ownStepIndex: fi == null ? null : fi - bg, inBackground: fi != null && fi < bg, javascript: manifest.scenarioById.get(scenario).javascript, wallMs: r.scenarioWallMs ?? null }));
  }
}
