# /// script
# requires-python = ">=3.14"
# ///
import sys, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import trace_view as tv
uid = sys.argv[1]
u = [u for u in tv.units() if u['unit_id'] == uid][0]
rec = tv.payment_records(tv.selector_path(u['paths']['trace']))[u['trial_id']]
print('record keys', list(rec.keys()))
print('agent keys', list(rec['agent'].keys()))
for k, v in rec['agent'].items():
    if k not in ('ledger', 'rawResponse'):
        print(k, '::', str(v)[:400])
