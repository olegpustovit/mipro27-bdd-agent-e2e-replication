# /// script
# requires-python = ">=3.14"
# ///
"""Coder 1 helper: per unit, list URLs visited (ordered, deduped), last calls, and verdict. Reads only traces/units."""
import re, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import trace_view as tv
sel = sys.argv[1:]
for u in tv.units():
    if not any(s in u['unit_id'] for s in sel):
        continue
    steps, msgs, raw, _ = tv.payment_trace(u) if u['app'] == 'payment' else tv.moodle_trace(u)
    urls = []
    for k, n, name, body in steps:
        if k == 'result':
            for m in re.finditer(r'Page URL: (\S+)', body):
                if not urls or urls[-1] != m[1]:
                    urls.append(m[1])
    errs = [body[:200].replace('\n', ' ') for k, n, name, body in steps if k == 'result' and re.search(r'^### Error|ERROR|Timeout|timed out', body, re.M)]
    print(f"== {u['unit_id'].split(':',2)[-1]} | {u['reported_status']} | calls {u['tool_calls']} timedOut {u['agent_timed_out']} | rep {u['reported_failing_step_number']} tgt {u['target_step_numbers']}")
    print('   URLS', ' > '.join(x.replace('http://localhost:3000', '') for x in urls)[:400])
    for e in errs[-3:]:
        print('   ERR', e)
    print('   R', (u['reported_reason'] or f"<none: {u['verdict_parse_error']}>")[:500])
