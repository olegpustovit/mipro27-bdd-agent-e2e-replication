# /// script
# requires-python = ">=3.14"
# ///
import sys, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import trace_view as tv
from common import read_jsonl
uid = sys.argv[1]
u = [u for u in tv.units() if u['unit_id'] == uid][0]
rec = tv.payment_records(tv.selector_path(u['paths']['trace']))[u['trial_id']]
print('trial keys', {k: (str(v)[:150]) for k, v in rec['trial'].items()})
log = tv.selector_path(u['paths']['log'])
for e in read_jsonl(log):
    if e['type'] == 'trial-start' and e['trial']['id'] == u['trial_id']:
        print('trial-start keys', list(e.keys()), list(e['trial'].keys()))
        break
types = {}
cur = None
for e in read_jsonl(log):
    if e['type'] == 'trial-start':
        cur = e['trial']['id']
    if cur == u['trial_id']:
        types[e['type']] = types.get(e['type'], 0) + 1
        if e['type'] == 'agent-event':
            et = e['event'].get('type')
            types['ev:' + str(et)] = types.get('ev:' + str(et), 0) + 1
print(types)
