# /// script
# requires-python = ">=3.14"
# ///
"""Coder 2 helper: print raw tool result text for given call numbers of a unit (reads trace only)."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import trace_view as tv
uid = sys.argv[1]; want = set(int(x) for x in sys.argv[2].split(','))
maxc = int(sys.argv[3]) if len(sys.argv) > 3 else 4000
u = next(x for x in tv.units() if x['unit_id'] == uid)
steps = (tv.payment_trace if u['app'] == 'payment' else tv.moodle_trace)(u)[0]
n = None
for kind, num, name, body in steps:
    if kind == 'call':
        n = num
        if n in want: print(f'##### call #{n} {name} {body}')
    elif kind == 'result' and n in want:
        print(body[:maxc]); print('-----')
