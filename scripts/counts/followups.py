# /// script
# requires-python = ">=3.14"
# dependencies = []
# ///
"""Later payment-app follow-up runs without the URL instruction: GPT-6.2 Sol (Codex CLI 0.169.0)
and Claude Opus 5.5 through omp 18.20.2. Ledgers under moodle-ledger/runs/.

Same rules as the paper: the agent's own reported status; "unresolved" counts as fail; runs the
environment could not start are left out (the first Sol campaign, e23c7f6: 72 runs with
"Pinned model absent", none reached the agent). A paired catch matches a faulty run with the
healthy run of the same scenario, version and repetition, or with that scenario's single
healthy run on the version. The Opus "re-read" view replaces records by verdict parser v2
records (campaign-f-20261118-opus-verdict-v2), as in the follow-up comparison.
"""
from collections import defaultdict

from common import Checker, main, read_jsonl

EXPECTED = {
    'sol_not_started': '72/72',
    'Sol': {'catches': '24/24', 'catch_unresolved': 0, 'false_alarms': '0/12', 'fa_unresolved': 0, 'paired': '24/24'},
    'Opus omp': {'catches': '12/12', 'catch_unresolved': 0, 'false_alarms': '2/24', 'fa_unresolved': 2, 'paired': '11/12'},
    'Opus omp, re-read': {'catches': '12/12', 'catch_unresolved': 0, 'false_alarms': '1/24', 'fa_unresolved': 1, 'paired': '11/12'},
}


def records(campaign):
    return [row['record'] for row in read_jsonl(f'moodle-ledger/runs/{campaign}/trials.jsonl')]


def outcomes(rows):
    status = {}
    for r in rows:
        t = r['trial']
        status[(t['kind'], t['revision'], t['repetition'], t['caseId'])] = r['reportedStatus']
    faulty = {k: s for k, s in status.items() if k[0] == 'fault'}
    healthy = {k: s for k, s in status.items() if k[0] == 'healthy'}
    reps = defaultdict(list)
    for k in healthy:
        reps[(k[1], k[3])].append(k)
    paired = total = 0
    for (_, version, rep, case), s in faulty.items():
        match = ('healthy', version, rep, case)
        if match not in healthy and len(reps[(version, case)]) == 1:
            match = reps[(version, case)][0]
        if match in healthy:
            total += 1
            paired += s != 'pass' and healthy[match] == 'pass'
    return {
        'catches': f'{sum(s != "pass" for s in faulty.values())}/{len(faulty)}',
        'catch_unresolved': sum(s == 'unresolved' for s in faulty.values()),
        'false_alarms': f'{sum(s != "pass" for s in healthy.values())}/{len(healthy)}',
        'fa_unresolved': sum(s == 'unresolved' for s in healthy.values()),
        'paired': f'{paired}/{total}',
    }


def run(ck: Checker):
    ck.section('Payment-app follow-up runs without the instruction (Sol; Opus through omp)')
    first = records('campaign-e-20261118-e23c7f6')
    ck.check('Sol first campaign: runs that never reached the agent',
             f"{sum(r.get('error') == 'Pinned model absent' for r in first)}/{len(first)}", EXPECTED['sol_not_started'])
    opus = records('campaign-f-20261118-opus')
    reread = {r['trialId']: r for r in records('campaign-f-20261118-opus-verdict-v2')}
    for label, rows in (('Sol', records('campaign-e-20261118-continuation')), ('Opus omp', opus),
                        ('Opus omp, re-read', [reread.get(r['trialId'], r) for r in opus])):
        got = outcomes(rows)
        for key, value in EXPECTED[label].items():
            ck.check(f'{label} {key.replace("_", " ")}', got[key], value)


if __name__ == '__main__':
    main(run)
