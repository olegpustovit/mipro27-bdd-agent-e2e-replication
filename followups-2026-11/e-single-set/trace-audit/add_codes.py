# /// script
# requires-python = ">=3.14"
# dependencies = []
# ///
"""Coder helper: append coder N's codes to coderN-work/codes-coderN.jsonl from tab-separated lines on stdin.
FOLLOWUP-E-TA: copy of followups-2026-11/a-trace-audit/add_codes.py; changes marked FOLLOWUP-E-TA (--coder N, output path,
payment short-id prefix).

  uv run followups-2026-11/e-single-set/trace-audit/add_codes.py --coder N [--prefix pay:pay-Luna:] < codes.tsv

Columns: unit  code  confidence  pointer  evidence  [note]
- unit: a full unit_id, or a short id that --prefix completes (payment: '<stage>/<case>' -> 'pay:<set>:<stage>/<case>/runtime',
  e.g. --prefix pay:pay-Luna: and 'fault-v0-1/bank-create').
- pointer / evidence '@hit': take the last matching symptom line in a payment trace (trace_view.SYMPTOM) and its call
  number. The coder still chooses the code for each unit; this only copies the quoted text exactly from the trace.
It refuses unknown units, codes of the wrong family, re-coding a unit, and empty evidence.
"""
import argparse
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import trace_view as tv  # noqa: E402

FAULTY = {'CORRECT', 'WRONG-REASON', 'UNCLEAR'}
HEALTHY = {'AGENT-ERROR', 'ENVIRONMENT', 'SCENARIO-AMBIGUOUS', 'APP-BEHAVIOUR'}
OUT = None  # FOLLOWUP-E-TA: set from --coder: HERE / 'coder<N>-work' / 'codes-coder<N>.jsonl'


def last_hit(u, needle=None):
    steps, _, _, _ = tv.payment_trace(u)
    pat = tv.SYMPTOM[u['scenario']]
    n, best = None, None
    for kind, num, _, body in steps:
        if kind == 'call':
            n = num
        elif kind == 'result':
            # last result that matches; within it, the first matching line (feeds list newest first)
            for m in re.finditer(pat, body):
                t = m.group(0).strip()
                if needle is None or needle in t:
                    best = (n, t)
                    break
    return best


def last_re(u, regex):
    """Last tool result matching regex; returns (call label, first matching text in that result)."""
    steps, _, _, _ = tv.payment_trace(u) if u['app'] == 'payment' else tv.moodle_trace(u)
    rx = re.compile(regex)
    label, best = None, None
    for kind, num, name, body in steps:
        if kind == 'call':
            label = f'#{num} {name}'
        elif kind == 'result':
            m = rx.search(body)
            if m:
                best = (label, m.group(0).strip())
    return best


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--prefix', default='', help="e.g. 'pay:pay-Luna:' (short payment ids get '/runtime' appended)")
    ap.add_argument('--coder', type=int, choices=(1, 2, 3), required=True)  # FOLLOWUP-E-TA
    a = ap.parse_args()
    global OUT
    assert (HERE / 'UNITS_READY').exists(), 'UNITS_READY is missing: the unit set is not final yet'  # FOLLOWUP-E-TA
    OUT = HERE / f'coder{a.coder}-work' / f'codes-coder{a.coder}.jsonl'  # FOLLOWUP-E-TA
    units = {u['unit_id']: u for u in tv.units()}
    done = set()
    if OUT.exists():
        done = {json.loads(l)['unit_id'] for l in OUT.read_text('utf-8').splitlines() if l.strip()}
    rows = []
    for raw in sys.stdin.read().splitlines():
        if not raw.strip() or raw.startswith('#'):
            continue
        cols = raw.split('\t')
        assert len(cols) in (5, 6), raw
        uid, code, conf, pointer, evidence = cols[:5]
        note = cols[5] if len(cols) == 6 else ''
        if uid not in units:
            uid = a.prefix + uid + ('/runtime' if a.prefix.startswith('pay:') else '')
        u = units.get(uid)
        assert u, f'unknown unit {uid}'
        assert uid not in done, f'already coded {uid}'
        assert code in (FAULTY if u['build_type'] == 'faulty' else HEALTHY), (uid, code)
        assert conf in ('high', 'medium', 'low'), conf
        if evidence.startswith('@hit'):
            needle = evidence[5:] or None
            hit = last_hit(u, needle)
            assert hit, f'no symptom hit in {uid}'
            evidence = f'tool result: {hit[1][:220]}'
            if pointer == '@hit':
                pointer = f'record.agent.ledger, result of call #{hit[0]}'
        if evidence.startswith('@re:'):
            hit = last_re(u, evidence[4:])
            assert hit, f'no regex hit in {uid}: {evidence[4:]}'
            evidence = f'tool result: {hit[1][:220]}'
            if pointer == '@re':
                pointer = (f'record.agent.ledger, result of call {hit[0]}' if u['app'] == 'payment'
                           else f'trace blob, result of tool call {hit[0]}')
        if evidence.startswith('@reason'):
            evidence = 'verdict reason: "' + (u['reported_reason'] or '')[:230] + ('…"' if len(u['reported_reason'] or '') > 230 else '"')
            if pointer == '@reason':
                pointer = 'verdict (record.agent.rawResponse)' if u['app'] == 'payment' else 'final agent message (verdict) in the trace blob'
        assert evidence.strip() and pointer.strip(), raw
        rows.append({'unit_id': uid, 'code': code, 'evidence': evidence, 'pointer': pointer, 'confidence': conf, 'note': note})
        done.add(uid)
    with OUT.open('a', encoding='utf-8') as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + '\n')
    print(f'appended {len(rows)}; total coded {len(done)} of {len(units)}')


if __name__ == '__main__':
    main()
