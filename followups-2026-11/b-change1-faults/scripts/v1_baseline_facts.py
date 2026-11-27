# /// script
# requires-python = ">=3.14"
# dependencies = []
# ///
"""Recorded 2026-11-01 healthy-v1 outcomes per arm (the pairing partners) and the coded v1 maintenance record."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'scripts' / 'counts'))
import payment  # noqa: E402
from common import read_jsonl  # noqa: E402

for label in payment.CAMPAIGNS:
    _, rows = payment.runs(label)
    v1 = sorted((r['caseId'], r['status']) for r in rows if r['kind'] == 'healthy' and r['revision'] == 'v1')
    print(label, 'healthy-v1 not passing:', [c for c, s in v1 if s != 'pass'], f'({sum(s != "pass" for _, s in v1)}/{len(v1)})')
for e in read_jsonl('data/campaigns/campaign-20261101-04d8551/events.jsonl.zst'):
    if e['type'] == 'maintenance-record' and e['revision'] == 'v1':
        f = e['frozen']
        print('coded v1 frozen implementation', f['implementation']['sha256'], '|', f['reason'], '| edits', f['edits'], '| validations', f['validations'])
        vals = [x for x in read_jsonl('data/campaigns/campaign-20261101-04d8551/events.jsonl.zst') if x['type'] == 'validation-finished' or x['type'] == 'validation-record']
        print('validation events', len(vals))
