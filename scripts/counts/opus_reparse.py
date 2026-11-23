# /// script
# requires-python = ">=3.14"
# dependencies = []
# ///
"""Re-derive the re-read Opus verdicts from the original raw responses.

1. Replays every recorded Cypress browser-agent response with the version 1 rules and checks
   that the port reproduces the recorded status and format (a test of the port itself).
2. Replays them with the version 2 rules (one JSON verdict object may end the response after
   prose) and lists every response whose status changes.
3. Checks that the 12 changes in campaign-experiment4-opus equal the records in
   experiment-4/campaign-experiment4-opus-verdict-v2, and the follow-up change equals
   moodle-ledger/runs/campaign-f-20261118-opus-verdict-v2.
"""
from common import ROOT, Checker, main, read_jsonl
from verdict_parser import decode, scenario_assertions

SOURCES = [
    'data/campaigns/campaign-20261101-04d8551/trials.jsonl.zst',
    'data/campaigns/campaign-b-20261101-02f4758/trials.jsonl.zst',
    'data/campaigns/campaign-c-20261101-f7857ea/trials.jsonl.zst',
    'data/campaigns/campaign-d-20261101-2b2589f/trials.jsonl.zst',
    'experiment-4/campaign-experiment4-haiku/trials.jsonl',
    'experiment-4/campaign-experiment4-luna/trials.jsonl',
    'experiment-4/campaign-experiment4-sonnet/trials.jsonl',
    'experiment-4/campaign-experiment4-opus/trials.jsonl',
    'moodle-ledger/runs/campaign-e-20261118-continuation/trials.jsonl',
    'moodle-ledger/runs/campaign-f-20261118-opus/trials.jsonl',
    'clock-recovery/campaign-e-20261118-continuation-clock-recovery/trials.jsonl',
    'clock-recovery/campaign-f-20261118-opus-clock-recovery/trials.jsonl',
]
RECOVERED = {
    'experiment-4/campaign-experiment4-opus/trials.jsonl': 'experiment-4/campaign-experiment4-opus-verdict-v2/trials.jsonl',
    'clock-recovery/campaign-f-20261118-opus-clock-recovery/trials.jsonl':
        'moodle-ledger/runs/campaign-f-20261118-opus-verdict-v2/trials.jsonl',
}
COMPARED = ['reportedStatus', 'verdictFormat', 'failedAssertion', 'normalizedFailedAssertion',
            'failedAssertionVerified', 'verdictReason', 'verdictParseError']


def responses(path):
    for row in read_jsonl(path):
        record = row.get('record') or {}
        agent = record.get('agent') or {}
        if row.get('type') == 'trial' and row.get('result') == 'recorded' and isinstance(agent.get('rawResponse'), str):
            yield record


def run(ck: Checker):
    feature = (ROOT / 'study/scenarios.feature').read_text('utf-8')
    ck.section('Opus re-read: verdict parser v2 replay of recorded responses')
    total = v1_agree = 0
    changes = {}
    for path in SOURCES:
        for record in responses(path):
            agent = record['agent']
            assertions = scenario_assertions(feature, record['trial']['caseId'])
            total += 1
            old = decode(agent['rawResponse'], assertions, version=1)
            if (old['reportedStatus'], old['verdictFormat']) == (agent['reportedStatus'], agent['verdictFormat']):
                v1_agree += 1
            new = decode(agent['rawResponse'], assertions, version=2)
            if new['reportedStatus'] != agent['reportedStatus']:
                changes.setdefault(path, []).append((record, new))
    ck.check('recorded responses replayed', total)
    ck.check('version 1 port reproduces recorded decoding', f'{v1_agree}/{total}', f'{total}/{total}')
    ck.check('responses whose status changes under v2', sum(map(len, changes.values())), 13)
    ck.check('  of which campaign-experiment4-opus', len(changes.get('experiment-4/campaign-experiment4-opus/trials.jsonl', [])), 12)
    ck.check('  of which Opus follow-up (clock recovery)',
             len(changes.get('clock-recovery/campaign-f-20261118-opus-clock-recovery/trials.jsonl', [])), 1)
    others = [p for p in changes if p not in RECOVERED]
    ck.check('  changes in any other campaign', len(others), 0)

    for source, recovered_path in RECOVERED.items():
        recovered = {r['record']['trialId']: r['record'] for r in read_jsonl(recovered_path)}
        derived = {record['trialId']: (record, new) for record, new in changes.get(source, [])}
        name = recovered_path.split('/')[-2]
        ck.check(f'{name}: same trial IDs as re-derived', sorted(derived) == sorted(recovered), True)
        mismatched = []
        for trial_id, (original, new) in derived.items():
            stored = recovered.get(trial_id)
            if stored is None:
                mismatched.append(trial_id)
                continue
            agent = stored['agent']
            same = (all(new[key] == agent.get(key) for key in COMPARED)
                    and stored['reportedStatus'] == new['reportedStatus']
                    and agent['rawResponse'] == original['agent']['rawResponse']
                    and original['agent']['reportedStatus'] == 'unresolved'
                    and stored['verdictRecovery']['sourceRecordSHA'] == original['recordSHA'])
            if not same:
                mismatched.append(trial_id)
        ck.check(f'{name}: re-derived records equal stored', f'{len(derived) - len(mismatched)}/{len(derived)}',
                 f'{len(recovered)}/{len(recovered)}')
        statuses = {}
        for original, new in derived.values():
            key = f'{original["trial"]["kind"]} unresolved -> {new["reportedStatus"]}'
            statuses[key] = statuses.get(key, 0) + 1
        for key, count in sorted(statuses.items()):
            ck.check(f'{name}: {key}', count)


if __name__ == '__main__':
    main(run)
