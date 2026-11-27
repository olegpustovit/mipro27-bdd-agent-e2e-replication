# /// script
# requires-python = ">=3.14"
# ///
"""Coder 1: dry-run evidence resolution of a batch (same logic as add_codes.py), prints evidence; writes nothing."""
import sys, argparse
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import add_codes as ac, trace_view as tv
ap = argparse.ArgumentParser(); ap.add_argument('--prefix', default=''); a = ap.parse_args()
units = {u['unit_id']: u for u in tv.units()}
for raw in sys.stdin.read().splitlines():
    c = raw.split('\t'); uid, code, conf, ptr, ev = c[:5]
    if uid not in units: uid = a.prefix + uid + ('/runtime' if a.prefix.startswith('pay:') else '')
    u = units[uid]
    if ev.startswith('@hit'):
        h = ac.last_hit(u, ev[5:] or None); ev = f'HIT #{h[0] if h else None}: {h[1][:160] if h else "NONE!!"}'
    elif ev.startswith('@re:'):
        h = ac.last_re(u, ev[4:]); ev = f'RE {h[0] if h else None}: {h[1][:160] if h else "NONE!!"}'
    elif ev.startswith('@reason'):
        ev = 'REASON ' + (u['reported_reason'] or 'NONE!!')[:100]
    print(f'{uid.split(":",2)[-1][:45]:45} {code:12} {ev}')
