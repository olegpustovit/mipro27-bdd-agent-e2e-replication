# /// script
# requires-python = ">=3.14"
# dependencies = []
# ///
"""Stream B counts: seeded faults on the change-1 (v1) interface, under the paper's definitions.

Reuses scripts/counts/common.py (reading), payment.py (scored status, paired-catch rule, original campaigns) and
verified.py (assertion normalization, target-check rule). Definitions, as in README "Scoring rules":
- status: coded arm = Cucumber exit code; agents = reported status, `unresolved` counted as not passing.
- catch: a faulty run that does not pass. unresolved: a faulty agent run whose reported status is `unresolved`.
- paired catch: faulty run not passing AND the healthy run of the same case/revision/repetition passing; with no
  healthy run at that repetition, repetition 1. Healthy v1 has one repetition, so both fault repetitions pair with
  the healthy-v1-1 run. Primary partner: the recorded 2026-11-01 healthy-v1-1 run of the same arm (campaign A for
  coded, B/C/D for Luna/Terra/Haiku). Post-hoc sensitivity: the fresh healthy-v1-1 run from this follow-up.
- verified catch: status `fail` (unresolved never counts) and normalized failedAssertion equal to the case's target
  check (the single normalized failedAssertion shared by the coded arm's faulty v0/v2 runs, as in verified.py).
  verified paired catch: verified catch AND the healthy partner passes.
- Coded arm (post-hoc split, stated by the brief): the scenarios whose coded step definitions do not pass the
  recorded healthy v1 build cannot show a catch. Their faulty runs are reported separately, never as catches.
Usage: uv run scripts/count_v1_faults.py  (from the stream folder or anywhere)
"""
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
REPO = HERE.parents[1]
sys.path.insert(0, str(REPO / 'scripts' / 'counts'))
import payment  # noqa: E402
import verified  # noqa: E402
from common import read_jsonl  # noqa: E402
from verdict_parser import decode, scenario_assertions  # noqa: E402

STREAM = 'followups-2026-11/b-change1-faults'
NEW = {'coded': 'campaign-g-20261126-v1faults-coded', 'Luna': 'campaign-g-20261126-v1faults-luna',
       'Terra': 'campaign-g-20261126-v1faults-terra', 'Haiku': 'campaign-g-20261126-v1faults-haiku'}
SOCIAL = payment.SOCIAL
FEATURE = (REPO / 'study/scenarios.feature').read_text('utf-8')


def frac(a, b):
    return f'{a}/{b}'


def new_runs(label):
    """All trial rows of a follow-up campaign, none dropped. Infrastructure-invalid rows are kept and flagged."""
    arm = 'maintained' if label == 'coded' else 'runtime'
    path = f'{STREAM}/data/campaigns/{NEW[label]}/trials.jsonl.zst'
    if not (REPO / path).exists():
        return None
    rows = []
    for row in read_jsonl(path):
        record = row['record']
        trial = record['trial']
        assert trial['arm'] == arm, record['trialId']
        if arm == 'maintained':
            status = 'pass' if (record.get('baseline') or {}).get('code') == 0 else 'fail'
        else:
            status = record['reportedStatus']
            assert status in ('pass', 'fail', 'unresolved'), record['trialId']
        agent = record.get('agent') or {}
        usage = agent.get('usage') or {}
        v1 = None
        if arm == 'runtime' and isinstance(agent.get('rawResponse'), str):
            v1 = decode(agent['rawResponse'], scenario_assertions(FEATURE, trial['caseId']), version=1)['reportedStatus']
        rows.append({'kind': trial['kind'], 'caseId': trial['caseId'], 'revision': trial['revision'],
                     'repetition': trial['repetition'], 'status': status, 'trialId': record['trialId'],
                     'invalid': row['result'] != 'recorded', 'error': record.get('error'),
                     'assertion': verified.normalize(record.get('failedAssertion')),
                     'tokens': (usage.get('input_tokens') or 0) + (usage.get('output_tokens') or 0) if usage else None,
                     'cached': usage.get('cached_input_tokens') if usage else None,
                     'elapsedMs': record.get('elapsedMs'), 'statusParserV1': v1,
                     'models': agent.get('actualModels'), 'modelVerified': agent.get('modelVerified')})
    return rows


def targets():
    coded_assertions = verified.failed_assertions('coded')
    out = defaultdict(set)
    for row in payment.runs('coded')[1]:
        if row['kind'] == 'fault':
            out[row['caseId']].add(coded_assertions[row['trialId']])
    assert all(len(v) == 1 for v in out.values())
    return {case: next(iter(v)) for case, v in out.items()}


def original_healthy_v1(label):
    return {r['caseId']: r['status'] for r in payment.runs(label)[1] if r['kind'] == 'healthy' and r['revision'] == 'v1'}


def paired(faulty, partner):
    """payment.paired_catches applied to faulty rows plus healthy-v1 rep-1 partner rows."""
    healthy = [{'kind': 'healthy', 'caseId': c, 'revision': 'v1', 'repetition': 1, 'status': s} for c, s in partner.items()]
    return payment.paired_catches(healthy + faulty)[0]


def main():
    target = targets()
    out = {'targets': target, 'arms': {}}
    lines = []
    p = lines.append
    for label in NEW:
        rows = new_runs(label)
        if rows is None:
            p(f'{label}: no data yet')
            continue
        faulty = [r for r in rows if r['kind'] == 'fault']
        fresh = [r for r in rows if r['kind'] == 'healthy']
        orig = original_healthy_v1(label)
        fresh_partner = {r['caseId']: r['status'] for r in fresh}
        a = {}
        a['faulty runs'] = len(faulty)
        a['infrastructure-invalid faulty runs'] = sum(r['invalid'] for r in faulty)
        not_pass = [r for r in faulty if r['status'] != 'pass']
        a['unresolved faulty runs'] = sum(r['status'] == 'unresolved' for r in faulty)
        a['misses (faulty run passed)'] = sum(r['status'] == 'pass' for r in faulty)
        ver = [r for r in faulty if r['status'] == 'fail' and r['assertion'] == target[r['caseId']]]
        if label == 'coded':
            eligible_cases = {c for c, s in orig.items() if s == 'pass'}
            elig = [r for r in faulty if r['caseId'] in eligible_cases]
            inel = [r for r in faulty if r['caseId'] not in eligible_cases]
            a['scenarios passing recorded healthy v1'] = f'{len(eligible_cases)}/12: ' + ','.join(sorted(eligible_cases))
            a['catches (eligible scenarios)'] = frac(sum(r['status'] != 'pass' for r in elig), len(elig))
            a['misses (eligible scenarios)'] = sum(r['status'] == 'pass' for r in elig)
            a['faulty runs on scenarios failing healthy v1 (not catches)'] = len(inel)
            a['  of which failed'] = sum(r['status'] != 'pass' for r in inel)
            a['  of which failed at the target check'] = sum(r['status'] == 'fail' and r['assertion'] == target[r['caseId']] for r in inel)
            a['  of which passed'] = sum(r['status'] == 'pass' for r in inel)
            a['not passing, all 24 (paper catch definition, uncorrected)'] = frac(len(not_pass), len(faulty))
            a['verified catches (eligible scenarios)'] = frac(sum(r in ver for r in elig), len(elig))
        else:
            a['catches'] = frac(len(not_pass), len(faulty))
            a['catches with unresolved verdict'] = sum(r['status'] == 'unresolved' for r in not_pass)
            a['verified catches'] = frac(len(ver), len(faulty))
            a['catches outside social scenarios'] = frac(sum(r['caseId'] not in SOCIAL for r in not_pass), sum(r['caseId'] not in SOCIAL for r in faulty))
            a['verified catches outside social scenarios'] = frac(sum(r['caseId'] not in SOCIAL for r in ver), sum(r['caseId'] not in SOCIAL for r in faulty))
            changed = [r['trialId'] for r in rows if r['statusParserV1'] is not None and r['statusParserV1'] != r['status']]
            a['runs whose status differs under verdict parser v1'] = f'{len(changed)}' + (f' ({", ".join(changed)})' if changed else '')
        a['paired catches (recorded 2026-11-01 healthy-v1 partner)'] = frac(paired(faulty, orig), len(faulty))
        a['verified paired catches (recorded partner)'] = frac(paired(ver, orig), len(faulty))
        a['recorded healthy-v1 partner not passing'] = ','.join(sorted(c for c, s in orig.items() if s != 'pass')) or '-'
        a['post-hoc: fresh healthy-v1 runs not passing'] = frac(sum(r['status'] != 'pass' for r in fresh), len(fresh)) + ' ' + ','.join(sorted(r['caseId'] for r in fresh if r['status'] != 'pass'))
        a['post-hoc: fresh healthy-v1 infrastructure-invalid'] = sum(r['invalid'] for r in fresh)
        if len(fresh_partner) == 12:
            a['post-hoc: paired catches (fresh partner)'] = frac(paired(faulty, fresh_partner), len(faulty))
            a['post-hoc: verified paired catches (fresh partner)'] = frac(paired(ver, fresh_partner), len(faulty))
        if label != 'coded':
            tok = [r['tokens'] for r in rows if r['tokens'] is not None]
            a['tokens input+output, all runs (M)'] = f'{sum(tok) / 1e6:.2f} over {len(tok)} runs'
            a['tokens input+output, faulty runs (M)'] = f'{sum(r["tokens"] or 0 for r in faulty) / 1e6:.2f}'
            a['models reported'] = dict(Counter(m for r in rows for m in (r['models'] or ['<none>'])))
            a['runs with modelVerified false'] = sum(r['modelVerified'] is not True for r in rows)
        a['trial minutes, all runs (sum elapsedMs)'] = f'{sum(r["elapsedMs"] or 0 for r in rows) / 60000:.1f}'
        a['trial minutes, faulty runs'] = f'{sum(r["elapsedMs"] or 0 for r in faulty) / 60000:.1f}'
        per_case = defaultdict(list)
        for r in faulty:
            per_case[r['caseId']].append(r['status'] + ('*' if r in ver else '') + ('!' if r['invalid'] else ''))
        a['per fault (rep1,rep2; * = verified at target check, ! = infrastructure-invalid)'] = {c: per_case[c] for c in sorted(per_case)}
        a['invalid run errors'] = {r['trialId']: (r['error'] or '')[:200] for r in rows if r['invalid']}
        out['arms'][label] = a
        p(f'\n## {label} ({NEW[label]})')
        for k, v in a.items():
            p(f'{k:<72} {v}')
    text = '\n'.join(lines)
    print(text)
    (HERE / 'results').mkdir(exist_ok=True)
    (HERE / 'results' / 'counts.txt').write_text(text + '\n')
    (HERE / 'results' / 'counts.json').write_text(json.dumps(out, indent=1, default=str) + '\n')


if __name__ == '__main__':
    main()
