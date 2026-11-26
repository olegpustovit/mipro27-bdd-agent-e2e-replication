# /// script
# requires-python = ">=3.14"
# dependencies = []
# ///
"""Verified catches in the payment app and Moodle, and payment-app healthy-run counts."""
import re
from collections import defaultdict

import moodle
import payment
from common import Checker, main, read_jsonl

EXPECTED_PAYMENT = {
    'coded': ('48/48', '45/48', '40/40'),
    'Luna': ('37/48', '37/48', '37/40'),
    'Terra': ('41/48', '40/48', '40/40'),
    'Haiku': ('44/48', '36/48', '40/40'),
}
EXPECTED_PAIRED_OUTSIDE_SOCIAL = {'coded': '39/40', 'Luna': '37/40', 'Terra': '40/40', 'Haiku': '33/40'}
EXPECTED_HEALTHY_NOT_PASSING = {
    'coded': ('1/12', '7/12', '1/36'),
    'Luna': ('2/12', '2/12', '6/36'),
    'Terra': ('2/12', '2/12', '3/36'),
    'Haiku': ('3/12', '2/12', '6/36'),
}
EXPECTED_SOCIAL = {'Luna': '7/8', 'Terra': '5/8', 'Haiku': '3/8'}
EXPECTED_MOODLE = {'Luna': '8/28', 'Terra': '18/28', 'Haiku': '13/28'}


def normalize(assertion):
    if assertion is None:
        return None
    return re.sub(r'^(Given|When|Then|And|But)\s+', '', assertion.strip(), flags=re.IGNORECASE).strip().lower()


def failed_assertions(label):
    campaign, arm = payment.CAMPAIGNS[label]
    return {
        record['trialId']: normalize(record.get('failedAssertion'))
        for row in read_jsonl(f'data/campaigns/{campaign}/trials.jsonl.zst')
        if (record := row['record'])['trial']['arm'] == arm and record['trial']['kind'] == 'fault'
    }


def payment_counts(ck):
    ck.section('Payment app: verified catches and social follow-up denominators')
    coded_assertions = failed_assertions('coded')
    coded_rows = payment.runs('coded')[1]
    targets = defaultdict(set)
    for row in coded_rows:
        if row['kind'] == 'fault':
            targets[row['caseId']].add(coded_assertions[row['trialId']])
    for case, assertions in targets.items():
        assert len(assertions) == 1 and all(assertions), (case, assertions)
    target_by_case = {case: next(iter(assertions)) for case, assertions in targets.items()}

    for label in payment.CAMPAIGNS:
        rows = coded_rows if label == 'coded' else payment.runs(label)[1]
        assertions = coded_assertions if label == 'coded' else failed_assertions(label)
        faulty = [r for r in rows if r['kind'] == 'fault']
        healthy = [r for r in rows if r['kind'] == 'healthy']
        verified = [r for r in faulty if r['status'] == 'fail'
                    and assertions[r['trialId']] == target_by_case[r['caseId']]]
        paired, _ = payment.paired_catches(healthy + verified)
        outside_social = sum(r['caseId'] not in payment.SOCIAL for r in faulty)
        verified_outside = sum(r['caseId'] not in payment.SOCIAL for r in verified)
        expected_verified, expected_paired, expected_outside = EXPECTED_PAYMENT[label]
        ck.check(f'{label} verified catches', f'{len(verified)}/{len(faulty)}', expected_verified)
        ck.check(f'{label} verified paired catches', f'{paired}/{len(faulty)}', expected_paired)
        ck.check(f'{label} verified catches outside social scenarios',
                 f'{verified_outside}/{outside_social}', expected_outside)
        paired_outside, _ = payment.paired_catches(
            [r for r in healthy + verified if r['caseId'] not in payment.SOCIAL])
        ck.check(f'{label} verified paired catches outside social scenarios',
                 f'{paired_outside}/{outside_social}', EXPECTED_PAIRED_OUTSIDE_SOCIAL[label])
        if label in EXPECTED_SOCIAL:
            social = [r for r in healthy if r['caseId'] in payment.SOCIAL and r['revision'] in ('v0', 'v2')]
            ck.check(f'{label} healthy social runs not passing (v0 and v2)',
                     f'{sum(r["status"] != "pass" for r in social)}/{len(social)}', EXPECTED_SOCIAL[label])


def healthy_version_counts(ck):
    ck.section('Payment app: healthy runs not passing by revision')
    for label, expected_counts in EXPECTED_HEALTHY_NOT_PASSING.items():
        healthy = [r for r in payment.runs(label)[1] if r['kind'] == 'healthy']
        for revision, expected in zip(('v0', 'v1', 'v2'), expected_counts, strict=True):
            runs = [r for r in healthy if r['revision'] == revision]
            failed = [r for r in runs if r['status'] != 'pass']
            ck.check(f'{label} healthy runs not passing ({revision})', f'{len(failed)}/{len(runs)}', expected)
            if revision == 'v1' and label != 'coded':
                social = sum(r['caseId'] in payment.SOCIAL for r in failed)
                ck.check(f'{label} healthy v1 failures in social scenarios', f'{social}/{len(failed)}', '2/2')


def moodle_counts(ck):
    ck.section('Moodle: step-verified paired catches')
    pairs, causes = moodle.parse()
    coded = [p for p in pairs if p['arm'] == 'A']
    agent_cases = set()
    for model, label in moodle.MODELS.items():
        analysed = []
        for pair in pairs:
            if pair['arm'] != 'C' or pair['model'] != model:
                continue
            healthy = moodle.status(pair, 'healthy', causes)
            faulty = moodle.status(pair, 'faulty', causes)
            if healthy is not None or faulty is not None:
                agent_cases.add(pair['case'])
            if healthy is None or faulty is None:
                assert pair['outcome'] != 'caught', pair
            else:
                analysed.append(pair)
        ck.check(f'{label} verified paired catches (arm C)', caught_fraction(analysed), EXPECTED_MOODLE[label])
    ck.check('coded verified paired catches (arm A)', caught_fraction(coded), '16/16')
    ck.check("coded verified paired catches on agents' pairs (arm A)",
             caught_fraction([p for p in coded if p['case'] in agent_cases]), '14/14')


def caught_fraction(pairs):
    return f'{sum(p["outcome"] == "caught" for p in pairs)}/{len(pairs)}'


def run(ck: Checker):
    payment_counts(ck)
    healthy_version_counts(ck)
    moodle_counts(ck)


if __name__ == '__main__':
    main(run)
