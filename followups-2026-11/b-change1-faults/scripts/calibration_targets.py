# /// script
# requires-python = ">=3.14"
# dependencies = []
# ///
"""For each revision's model-free calibration (data/calibration-<rev>.jsonl), check that the healthy build passes,
the faulty build fails, and the first failed assertion of the faulty build is the case's target check (verified.py rule).
Also print, for the coded arm, the failed assertion of each healthy-v1 run (recorded 2026-11-01 and fresh)."""
import json, sys
from pathlib import Path
HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE / 'scripts'))
import count_v1_faults as c  # noqa: E402
from common import read_jsonl  # noqa: E402
target = c.targets()
lines = []
for rev in ('v0', 'v1', 'v2'):
    rows = [json.loads(l) for l in (HERE / f'data/calibration-{rev}.jsonl').read_text().splitlines() if l]
    ok_h = sum(r['condition'] == 'reference' and r['baseline']['code'] == 0 for r in rows)
    ok_f = sum(r['condition'] == 'fault' and r['baseline']['code'] == 1 for r in rows)
    at = [r['caseId'] for r in rows if r['condition'] == 'fault' and r['baseline']['assertionFailures']
          and c.verified.normalize(r['baseline']['assertionFailures'][0]['step']) == target[r['caseId']]]
    lines.append(f'{rev}: healthy builds pass {ok_h}/12; faulty builds fail {ok_f}/12; faulty failure at target check {len(at)}/12'
                 + ('' if len(at) == 12 else f' (not at target: {sorted(set(target) - set(at))})'))
for label, path in (('recorded 2026-11-01', 'data/campaigns/campaign-20261101-04d8551/trials.jsonl.zst'),
                    ('fresh 2026-11-26', f'{c.STREAM}/data/campaigns/{c.NEW["coded"]}/trials.jsonl.zst')):
    for row in read_jsonl(path):
        r = row['record']; t = r['trial']
        if t['arm'] == 'maintained' and t['kind'] == 'healthy' and t['revision'] == 'v1' and r['baseline']['code'] != 0:
            f = r['baseline']['assertionFailures']; s = r['baseline'].get('stepFailures') or []
            lines.append(f'coded healthy v1 {label} {t["caseId"]}: failed assertion={c.verified.normalize(f[0]["step"]) if f else None!r}; '
                         f'first failing step={(s[0].get("step") if s else None)!r}; target={target[t["caseId"]]!r}')
print('\n'.join(lines))
(HERE / 'results' / 'calibration-targets.txt').write_text('\n'.join(lines) + '\n')
