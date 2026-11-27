# /// script
# requires-python = ">=3.14"
# ///
"""Coder 1: print lines of one tool result (call number N) of a unit, from line matching regex A, B lines."""
import sys, re
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import trace_view as tv
uid, n, rx, k = sys.argv[1], int(sys.argv[2]), sys.argv[3], int(sys.argv[4])
u = [x for x in tv.units() if x['unit_id'] == uid][0]
steps, *_ = tv.payment_trace(u) if u['app'] == 'payment' else tv.moodle_trace(u)
cur = None
for kind, num, name, body in steps:
    if kind == 'call':
        cur = num
    elif kind == 'result' and cur == n:
        lines = body.splitlines()
        for i, l in enumerate(lines):
            if re.search(rx, l):
                print('\n'.join(x[:200] for x in lines[i:i + k])); print('....')
                break
