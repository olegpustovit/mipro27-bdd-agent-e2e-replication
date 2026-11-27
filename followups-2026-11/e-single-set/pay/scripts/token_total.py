# /// script
# requires-python = ">=3.14"
# dependencies = []
# ///
"""Token guard helper: total measured agent tokens (input+output, as in stream B's count) over stream E's
campaigns, read live from the harness run directories. Prints one integer (unknown usage counts as 0)."""
import json
import sys
from pathlib import Path

RUNS = Path.home() / '.local/share/cucumber-study/runs'
total = 0
for d in sorted(RUNS.glob('campaign-h-20261127-single-*')):
    p = d / 'trials.jsonl'
    if not p.exists():
        continue
    for line in p.read_text().splitlines():
        if not line.strip():
            continue
        u = ((json.loads(line).get('record') or {}).get('agent') or {}).get('usage') or {}
        total += (u.get('input_tokens') or 0) + (u.get('output_tokens') or 0)
if '-v' in sys.argv:
    print(total, file=sys.stderr)
print(total)
