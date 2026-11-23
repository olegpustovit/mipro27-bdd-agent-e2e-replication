# /// script
# requires-python = ">=3.14"
# dependencies = []
# ///
"""Payment app (Cypress Real World App), main comparison: catches, false alarms and paired catches.

Scoring: step definitions use the runner's pass/fail; a browser agent uses its reported status,
with "unresolved" counted as fail. No run is excluded: the two infrastructure-invalid
step-definition runs (healthy, runner exit code 1) are scored by the runner and count as false alarms.
"""
from common import Checker, main, read_jsonl

CAMPAIGNS = {
    # label: (campaign directory, arm)
    'coded': ('campaign-20261101-04d8551', 'maintained'),
    'Luna': ('campaign-b-20261101-02f4758', 'runtime'),
    'Terra': ('campaign-c-20261101-f7857ea', 'runtime'),
    'Haiku': ('campaign-d-20261101-2b2589f', 'runtime'),
}
SOCIAL = {'social-like', 'social-comment'}

EXPECTED = {
    'catches': {'coded': '48/48', 'Luna': '48/48', 'Terra': '48/48', 'Haiku': '48/48'},
    'catch_unresolved': {'Luna': 6, 'Terra': 5, 'Haiku': 4},
    'false_alarms': {'coded': '9/60', 'Luna': '10/60', 'Terra': '7/60', 'Haiku': '11/60'},
    'fa_unresolved': {'Luna': 7, 'Terra': 4, 'Haiku': 6},
    'paired': {'coded': '45/48', 'Luna': '41/48', 'Terra': '41/48', 'Haiku': '38/48'},
    'social_fa': {'Luna': '9/10', 'Terra': '7/7', 'Haiku': '5/11'},
    'stopped_before_fault': {'Luna': 8, 'Terra': 8, 'Haiku': 5},
}


def runs(label):
    """Trial rows of one approach as dicts with key fields and a scored status."""
    campaign, arm = CAMPAIGNS[label]
    rows = []
    for row in read_jsonl(f'data/campaigns/{campaign}/trials.jsonl.zst'):
        record = row['record']
        trial = record['trial']
        if trial['arm'] != arm:
            continue
        if arm == 'maintained':
            # Runner verdict: the Cucumber process exit code, also for infrastructure-invalid runs.
            status = 'pass' if record['baseline']['code'] == 0 else 'fail'
            assert status == record['reportedStatus'], record['trialId']
        else:
            assert row['result'] == 'recorded', record['trialId']
            status = record['reportedStatus']
            assert status in ('pass', 'fail', 'unresolved'), record['trialId']
        rows.append({'kind': trial['kind'], 'caseId': trial['caseId'], 'revision': trial['revision'],
                     'repetition': trial['repetition'], 'status': status, 'trialId': record['trialId'],
                     'invalid': row['result'] != 'recorded'})
    return campaign, rows


def paired_catches(rows):
    """Faulty run not passing AND the healthy run of the same case, revision and repetition passing.
    When that repetition has no healthy run, repetition 1 of the same case and revision is used."""
    healthy = {(r['caseId'], r['revision'], r['repetition']): r['status'] for r in rows if r['kind'] == 'healthy'}
    count = 0
    faulty = [r for r in rows if r['kind'] == 'fault']
    for r in faulty:
        key = (r['caseId'], r['revision'], r['repetition'])
        partner = healthy.get(key, healthy.get((r['caseId'], r['revision'], 1)))
        assert partner is not None, key
        if r['status'] != 'pass' and partner == 'pass':
            count += 1
    return count, len(faulty)


def run(ck: Checker):
    ck.section('Payment app: main comparison (runner / reported status, unresolved = fail)')
    for label in CAMPAIGNS:
        campaign, rows = runs(label)
        faulty = [r for r in rows if r['kind'] == 'fault']
        healthy = [r for r in rows if r['kind'] == 'healthy']
        assert len(faulty) == 48 and len(healthy) == 60, (label, len(faulty), len(healthy))
        caught = [r for r in faulty if r['status'] in ('fail', 'unresolved')]
        alarms = [r for r in healthy if r['status'] in ('fail', 'unresolved')]
        invalid = [r for r in rows if r['invalid']]
        ck.check(f'{label} catches', f'{len(caught)}/{len(faulty)}', EXPECTED['catches'][label])
        ck.check(f'{label} false alarms', f'{len(alarms)}/{len(healthy)}', EXPECTED['false_alarms'][label])
        paired, total = paired_catches(rows)
        ck.check(f'{label} paired catches', f'{paired}/{total}', EXPECTED['paired'][label])
        if invalid:
            ck.note(f'{label}: {len(invalid)} infrastructure-invalid run(s) kept and scored by the runner: '
                    + ', '.join(r['trialId'] for r in invalid))
        if label == 'coded':
            continue
        ck.check(f'{label} catches with unresolved verdict', sum(r['status'] == 'unresolved' for r in caught),
                 EXPECTED['catch_unresolved'][label])
        ck.check(f'{label} false alarms with unresolved verdict', sum(r['status'] == 'unresolved' for r in alarms),
                 EXPECTED['fa_unresolved'][label])
        social = sum(r['caseId'] in SOCIAL for r in alarms)
        ck.check(f'{label} false alarms in social scenarios', f'{social}/{len(alarms)}', EXPECTED['social_fa'][label])
        grades = read_jsonl(f'data/campaigns/{campaign}/adjudication.jsonl')
        stopped = sum(g['arm'] == 'runtime' and g['kind'] == 'fault'
                      and g['classification'] in ('action_failure', 'no_opportunity') for g in grades)
        ck.check(f'{label} grader: stopped before fault (faulty runs)', stopped, EXPECTED['stopped_before_fault'][label])


if __name__ == '__main__':
    main(run)
