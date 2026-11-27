# /// script
# requires-python = ">=3.14"
# ///
"""Coder 1: per unit, call-type counts, error results count, and URL sequence (Moodle or payment)."""
import sys, re, collections
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import trace_view as tv
sel = sys.argv[1:]
for u in tv.units():
    if not all(s in u['unit_id'] for s in sel):
        continue
    steps, *_ = tv.payment_trace(u) if u['app'] == 'payment' else tv.moodle_trace(u)
    c = collections.Counter(); errs = 0; urls = []
    for k, n, name, body in steps:
        if k == 'call':
            c[name.split()[0]] += 1
        elif k == 'result':
            if re.search(r'### Error|^ERROR|TimeoutError', body, re.M): errs += 1
            for m in re.finditer(r'Page URL: (\S+)', body):
                x = m[1].replace('http://webserver', '')
                if not urls or urls[-1] != x: urls.append(x)
    print('==', u['unit_id'].split('/', 1)[-1], dict(c), 'errors', errs)
    print('   URLS', ' > '.join(urls)[:900])
