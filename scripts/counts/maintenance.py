# /// script
# requires-python = ">=3.14"
# dependencies = []
# ///
"""Reproduce step-definition maintenance session metrics from the payment-app journal."""
import json

from common import Checker, main, read_jsonl

JOURNAL = 'data/campaigns/campaign-20261101-04d8551/journal.jsonl'
EXPECTED = {
    'v1': ('5.0', 2, 3, 'false', 307434),
    'v2': ('7.3', 5, 6, 'false', 1149221),
}


def run(ck: Checker):
    ck.section('Payment app: step-definition maintenance sessions')
    records = [row['record'] for row in read_jsonl(JOURNAL) if row['type'] == 'maintenance-finished']
    by_revision = {record['revision']: record for record in records}
    assert len(records) == len(EXPECTED) and by_revision.keys() == EXPECTED.keys(), [
        record['revision'] for record in records
    ]

    total_ms = total_tokens = 0
    for revision, (minutes, edits, validations, expired, tokens) in EXPECTED.items():
        record = by_revision[revision]
        usage = record['agent']['usage']
        input_output = usage['input_tokens'] + usage['output_tokens']
        total_ms += record['elapsedMs']
        total_tokens += input_output
        ck.check(f'{revision} session minutes', record['elapsedMs'] / 60000, minutes)
        ck.check(f'{revision} accepted edits', record['frozen']['edits'], edits)
        ck.check(f'{revision} validation runs', record['frozen']['validations'], validations)
        ck.check(f'{revision} budgetExpired', json.dumps(record['budgetExpired']), expired)
        ck.check(f'{revision} tokens (input + output)', input_output, tokens)
    ck.check('Total maintenance session minutes', total_ms / 60000, '12.3')
    ck.check('Total maintenance tokens (millions)', total_tokens / 1000000, '1.46')


if __name__ == '__main__':
    main(run)
