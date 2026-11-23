# /// script
# requires-python = ">=3.14"
# dependencies = []
# ///
"""Matched comparison (experiment 4): 36 runs per configuration on one harness version.

Scoring: the agent's reported status, "unresolved" counted as fail. "After re-read" replaces
the 12 Opus records with the verdict-parser-v2 records of the same trial IDs
(experiment-4/campaign-experiment4-opus-verdict-v2; see opus_reparse.py).
Tokens are input + output counters summed over the 36 runs; minutes sum record.elapsedMs.
Cache-read share = cached input tokens / input tokens.
"""
from common import Checker, main, read_jsonl

ARMS = {'Haiku': 'campaign-experiment4-haiku', 'Luna': 'campaign-experiment4-luna',
        'Sonnet': 'campaign-experiment4-sonnet', 'Opus': 'campaign-experiment4-opus'}
EXPECTED = {
    'catches': {'Haiku': '12/12', 'Luna': '12/12', 'Sonnet': '12/12', 'Opus': '12/12'},
    'false_alarms': {'Haiku': '2/24', 'Luna': '1/24', 'Sonnet': '1/24', 'Opus': '8/24'},
    'paired': {'Haiku': '11/12', 'Luna': '11/12', 'Sonnet': '11/12', 'Opus': '8/12'},
    'tokens': {'Haiku': '9.91', 'Luna': '4.64', 'Sonnet': '4.26', 'Opus': '3.23'},
    'minutes': {'Haiku': '26.2', 'Luna': '18.3', 'Sonnet': '13.3', 'Opus': '15.0'},
    'reread': {'catches': '12/12', 'false_alarms': '1/24', 'paired': '11/12'},
}


def load(campaign):
    rows = read_jsonl(f'experiment-4/{campaign}/trials.jsonl')
    assert len(rows) == 36 and all(r['result'] == 'recorded' for r in rows), campaign
    return [r['record'] for r in rows]


def score(records):
    faulty = [r for r in records if r['trial']['kind'] == 'fault']
    healthy = [r for r in records if r['trial']['kind'] == 'healthy']
    caught = sum(r['reportedStatus'] != 'pass' for r in faulty)
    alarms = sum(r['reportedStatus'] != 'pass' for r in healthy)
    partner = {(r['trial']['caseId'], r['trial']['revision'], r['trial']['repetition']): r['reportedStatus'] for r in healthy}
    paired = sum(r['reportedStatus'] != 'pass'
                 and partner[(r['trial']['caseId'], r['trial']['revision'], r['trial']['repetition'])] == 'pass'
                 for r in faulty)
    return f'{caught}/{len(faulty)}', f'{alarms}/{len(healthy)}', f'{paired}/{len(faulty)}'


def run(ck: Checker):
    ck.section('Matched comparison (reported status, unresolved = fail)')
    for label, campaign in ARMS.items():
        records = load(campaign)
        caught, alarms, paired = score(records)
        ck.check(f'{label} catches', caught, EXPECTED['catches'][label])
        ck.check(f'{label} false alarms (stated rule)', alarms, EXPECTED['false_alarms'][label])
        ck.check(f'{label} paired catches', paired, EXPECTED['paired'][label])
        usage = [r['agent']['usage'] for r in records]
        tokens = sum(u['input_tokens'] + u['output_tokens'] for u in usage) / 1e6
        ck.check(f'{label} tokens input+output (M)', tokens, EXPECTED['tokens'][label])
        ck.check(f'{label} trial minutes (sum of elapsedMs)', sum(r['elapsedMs'] for r in records) / 60000,
                 EXPECTED['minutes'][label])
        cached = sum(u['cached_input_tokens'] for u in usage) / sum(u['input_tokens'] for u in usage)
        ck.check(f'{label} cache-read share of input tokens', cached)
    reread = {r['record']['trialId']: r['record'] for r in read_jsonl('experiment-4/campaign-experiment4-opus-verdict-v2/trials.jsonl')}
    original = load(ARMS['Opus'])
    assert set(reread) <= {r['trialId'] for r in original}
    merged = [reread.get(r['trialId'], r) for r in original]
    caught, alarms, paired = score(merged)
    ck.check('Opus after re-read: catches', caught, EXPECTED['reread']['catches'])
    ck.check('Opus after re-read: false alarms', alarms, EXPECTED['reread']['false_alarms'])
    ck.check('Opus after re-read: paired catches', paired, EXPECTED['reread']['paired'])


if __name__ == '__main__':
    main(run)
