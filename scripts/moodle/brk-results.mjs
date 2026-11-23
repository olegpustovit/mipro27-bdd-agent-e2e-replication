#!/usr/bin/env node
// Prints, as JSON lines, what the ledger recorded for the wave-3 break candidates (states broken-steps:Bxx and before:Bxx; B14+): per break and scenario the effective start-state
// result (earliest round that executed a scenario), the failing step, the healthy result of the same scenario and the before result. mining/finalize_breaks_v2.py reads it.
import { readLines } from '../ledger/jsonl.mjs';
import { ledgerPaths } from '../ledger/paths.mjs';
import { loadManifest } from '../../adapters/moodle/manifest.mjs';
import { collect } from './v1-report.mjs';

const m = loadManifest(), rows = collect(readLines(ledgerPaths().trials)), first = Number(process.argv[2] ?? 14);
const eff = (s, st) => (rows.get(`${s}|${st}`) ?? []).find(r => r.status === 'passed' || r.status === 'failed');
const all = (s, st) => (rows.get(`${s}|${st}`) ?? []).map(r => ({ round: r.round, status: r.status, step: r.failingStepIndex ?? null }));
for (const b of m.breaks) {
  if (Number(b.id.slice(1)) < first) continue;
  for (const s of m.scenarios.map(x => x.id)) {
    const st = `broken-steps:${b.id}`, a = eff(s, st); if (!rows.get(`${s}|${st}`)) continue;
    const h = eff(s, 'healthy'), be = eff(s, `before:${b.id}`);
    console.log(JSON.stringify({ break: b.id, scenario: s, start: a?.status ?? 'error', step: a?.failingStepIndex ?? null, text: a?.failingStep?.text ?? null, error: (a?.failingStep?.error ?? '').replace(/\s+/g, ' ').slice(0, 200),
      healthy: h?.status ?? 'not-run', before: be?.status ?? 'not-run', rounds: all(s, st), healthyRounds: all(s, 'healthy') }));
  }
}
