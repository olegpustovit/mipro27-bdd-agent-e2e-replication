# /// script
# requires-python = ">=3.14"
# ///
"""Coder 1: one block per Moodle unit: id, status, reported vs target step, calls, reason."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import trace_view as tv
sel = sys.argv[1:]
for u in tv.units():
    if u['app'] == 'payment' or not all(s in u['unit_id'] for s in sel):
        continue
    sid = u['unit_id'].replace('moodle:e-moodle-1/', '')
    print(f"== {sid} | {u['reported_status']} | rep {u['reported_failing_step_number']} tgt {u['target_step_numbers']} | n{u['tool_calls']} to={u['agent_timed_out']} err={u['run_error']}")
    print('   R', (u['reported_reason'] or f"<none: {u['verdict_parse_error']}>")[:700])
