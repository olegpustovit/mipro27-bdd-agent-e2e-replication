# /// script
# requires-python = ">=3.14"
# ///
"""Coder 2 helper: per-unit item list (agent messages, tool calls, tool results) from the agent trace only."""
import json, re, sys
from pathlib import Path
import digest as D

def items(u):
    if u['app'] == 'moodle':
        p = D.ROOT / u['paths']['trace'].split()[0]
        evs = [json.loads(l) for l in open(p) if l.strip()]
        it = D.from_codex(evs) if u['driver'] == 'codex' else D.from_omp(evs)
        raw = None
    else:
        rec = D.trials_of(u['paths']['trace'].split()[0])[u['trial_id']]
        raw = rec['agent'].get('rawResponse')
        if u['run_set'] in ('B', 'C', 'D'):
            evs = D.events_of(u['paths']['log'].split()[0]).get(u['trial_id'], [])
            it = D.from_codex(evs) if u['run_set'] in ('B', 'C') else D.from_omp(evs)
            if not it: it = D.from_ledger(rec['agent']['ledger'])
        else:
            it = D.from_ledger(rec['agent']['ledger'])
    # number calls; pair results with their call number
    out = []; n = 0
    for k, t in it:
        if k == 'CALL': n += 1
        out.append((k, n, t))
    return out, raw
