# /// script
# requires-python = ">=3.14"
# ///
"""Coder 1: print the role=user message text the agent received (feature + instructions) for a unit."""
import sys, json
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
    if cur != u['trial_id'] or e['type'] != 'codex-rollout':
        continue
    p = e['event'].get('payload', {})
    if p.get('type') == 'message' and p.get('role') == 'user':
        for c in p.get('content', []):
            t = c.get('text', '')
            if 'environment_context' in t[:40] or 'AGENTS.md' in t[:60]:
                continue
            print(t); print('-----')
