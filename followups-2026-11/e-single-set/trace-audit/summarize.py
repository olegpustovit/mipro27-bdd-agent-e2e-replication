# /// script
# requires-python = ">=3.14"
# dependencies = []
# ///
"""Stream A1: validate codes-<coder>.jsonl against units.jsonl and print unit counts and code distributions.
FOLLOWUP-E-TA: copy of followups-2026-11/a-trace-audit/summarize.py for the single-set units; changes marked FOLLOWUP-E-TA.

  uv run followups-2026-11/e-single-set/trace-audit/summarize.py [coderN-work/codes-coderN.jsonl]
Post-hoc analysis. With no codes file it prints unit counts only.
"""
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
FAULTY = ['CORRECT', 'WRONG-REASON', 'UNCLEAR']
HEALTHY = ['AGENT-ERROR', 'ENVIRONMENT', 'SCENARIO-AMBIGUOUS', 'APP-BEHAVIOUR']
GROUPS = [  # (label, run sets)  FOLLOWUP-E-TA: single-set run sets
    ('payment Luna', ['pay-Luna']), ('payment Terra', ['pay-Terra']), ('payment Haiku', ['pay-Haiku']),
    ('Moodle Luna', ['moodle-Luna']), ('Moodle Terra', ['moodle-Terra']), ('Moodle Haiku', ['moodle-Haiku']),
]
NPAY = 3  # FOLLOWUP-E-TA: number of payment groups


def load(name):
    return [json.loads(l) for l in (HERE / name).read_text('utf-8').splitlines() if l.strip()]


def main():
    units = {u['unit_id']: u for u in load('units.jsonl')}
    codes = None
    if len(sys.argv) > 1:  # FOLLOWUP-E-TA: the codes file is always named
        rows = load(sys.argv[1])
        ids = [r['unit_id'] for r in rows]
        assert len(ids) == len(set(ids)), 'duplicate unit codes'
        assert set(ids) == set(units), f'coded {len(set(ids))} of {len(units)}; unknown {set(ids) - set(units)}'
        for r in rows:
            u = units[r['unit_id']]
            assert r['code'] in (FAULTY if u['build_type'] == 'faulty' else HEALTHY), r
            assert r['evidence'].strip() and r['pointer'].strip() and '\n' not in r['evidence'], r
            assert r['confidence'] in ('high', 'medium', 'low'), r
        codes = {r['unit_id']: r for r in rows}
        print(f'codes file valid: {len(rows)} units coded')

    print('\nUnits by run set and build type (faulty-build failures = counted catches; healthy-build failures = counted false alarms)')
    print(f'{"run set":<28}{"faulty":>8}{"  of which unresolved":>22}{"healthy":>9}{"  of which unresolved":>22}')
    tot = Counter()
    for label, sets in GROUPS:
        us = [u for u in units.values() if u['run_set'] in sets]
        f = [u for u in us if u['build_type'] == 'faulty']
        h = [u for u in us if u['build_type'] == 'healthy']
        fu = sum(u['reported_status'] == 'unresolved' for u in f)
        hu = sum(u['reported_status'] == 'unresolved' for u in h)
        tot.update(f=len(f), fu=fu, h=len(h), hu=hu)
        print(f'{label:<28}{len(f):>8}{fu:>22}{len(h):>9}{hu:>22}')
    print(f'{"total":<28}{tot["f"]:>8}{tot["fu"]:>22}{tot["h"]:>9}{tot["hu"]:>22}')
    if not codes:
        return

    def table(title, kind, cats):
        print(f'\n{title}')
        print(f'{"run set":<28}' + ''.join(f'{c:>20}' for c in cats) + f'{"n":>6}')
        total = Counter()
        for label, sets in GROUPS + [('payment, all', [s for l, ss in GROUPS[:NPAY] for s in ss]),
                                     ('Moodle, all', [s for l, ss in GROUPS[NPAY:] for s in ss])]:
            us = [u for u in units.values() if u['run_set'] in sets and u['build_type'] == kind]
            c = Counter(codes[u['unit_id']]['code'] for u in us)
            if label not in ('payment, all', 'Moodle, all'):
                total.update(c)
            print(f'{label:<28}' + ''.join(f'{c[k]:>20}' for k in cats) + f'{len(us):>6}')
        print(f'{"all units":<28}' + ''.join(f'{total[k]:>20}' for k in cats) + f'{sum(total.values()):>6}')

    table(f'Faulty-build failures (counted catches): {sys.argv[1]}', 'faulty', FAULTY)
    table(f'Healthy-build failures (counted false alarms): {sys.argv[1]}', 'healthy', HEALTHY)

    print('\nFaulty-build codes by reported status (fail / unresolved)')
    for st in ('fail', 'unresolved'):
        c = Counter(codes[u['unit_id']]['code'] for u in units.values() if u['build_type'] == 'faulty' and u['reported_status'] == st)
        print(f'  {st:<11}' + '  '.join(f'{k} {c[k]}' for k in FAULTY))
    # FOLLOWUP-E-TA: units carry no reported_equals_target_text; payment uses the step position, as Moodle does
    print('\nCORRECT faulty units whose reported step number is not a target step number (mechanical fields)')
    pay = [u for u in units.values() if u['app'] == 'payment' and u['build_type'] == 'faulty' and codes[u['unit_id']]['code'] == 'CORRECT']
    print(f'  payment: {sum(not set(u["reported_failing_step_number"] or []) & set(u["target_step_numbers"]) for u in pay)} of {len(pay)} (no step reported: {sum(not u["reported_failing_step_number"] for u in pay)})')
    mdl = [u for u in units.values() if u['app'] == 'moodle' and u['build_type'] == 'faulty' and codes[u['unit_id']]['code'] == 'CORRECT']
    print(f'  Moodle: {sum(u["reported_failing_step_number"] != u["target_step_numbers"][0] for u in mdl)} of {len(mdl)}')
    print('\nConfidence: ' + ', '.join(f'{k} {v}' for k, v in Counter(r['confidence'] for r in codes.values()).items()))
    by = defaultdict(Counter)
    for uid, r in codes.items():
        by[units[uid]['scenario']][r['code']] += 1
    print('\nCodes by scenario')
    for s in sorted(by):
        print(f'  {s:<18} ' + ', '.join(f'{k} {v}' for k, v in sorted(by[s].items())))


if __name__ == '__main__':
    main()
