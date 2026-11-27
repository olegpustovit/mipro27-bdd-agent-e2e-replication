# /// script
# requires-python = ">=3.14"
# ///
"""Coder 2 helper: resolve a batch like add_codes.py does, print evidence; writes nothing."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import add_codes as ac, trace_view as tv
prefix = sys.argv[1] if len(sys.argv) > 1 else ''
units = {u['unit_id']: u for u in tv.units()}
for raw in sys.stdin.read().splitlines():
    if not raw.strip() or raw.startswith('#'):
        continue
    cols = raw.split('\t'); assert len(cols) in (5, 6), raw
    uid, code, conf, pointer, ev = cols[:5]
    if uid not in units:
        uid = prefix + uid + ('/runtime' if prefix.startswith('pay:') else '')
    u = units[uid]
    try:
        if ev.startswith('@hit'):
            h = ac.last_hit(u, ev[5:] or None); ev = f'#{h[0]} {h[1][:150]}'
        elif ev.startswith('@re:'):
            h = ac.last_re(u, ev[4:]); ev = f'{h[0][:30]} {h[1][:150]}'
        elif ev.startswith('@reason'):
            ev = (u['reported_reason'] or '')[:100]
    except Exception as e:
        ev = f'!!! FAIL {e!r}'
    ok = code in (ac.FAULTY if u['build_type'] == 'faulty' else ac.HEALTHY)
    print(('' if ok else '!!!BADCODE ') + f'{uid.split(":",2)[-1][:45]:45} {code:12} {ev}')
