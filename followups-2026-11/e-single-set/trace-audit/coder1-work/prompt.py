# /// script
# requires-python = ">=3.14"
# ///
"""Coder 1: print the user prompt (feature instructions) the agent received for a payment unit, from the event log."""
import sys, json, re
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import trace_view as tv
from common import read_jsonl
uid = sys.argv[1]
u = [u for u in tv.units() if u['unit_id'] == uid][0]
log = tv.selector_path(u['paths']['log'])
cur = None
for e in read_jsonl(log):
    if e['type'] == 'trial-start':
        cur = e['trial']['id']
    if cur != u['trial_id']:
        continue
    s = json.dumps(e, ensure_ascii=False)
    if e['type'] == 'codex-rollout' or e['type'] == 'agent-event':
        if '"role": "user"' in s or '"role":"user"' in s or 'user_message' in s:
            print(s[:6000]); print('-----')
