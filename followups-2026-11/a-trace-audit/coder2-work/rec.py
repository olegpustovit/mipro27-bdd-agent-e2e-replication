# /// script
# requires-python = ">=3.14"
# ///
"""Coder 2: append hand-assigned codes to codes2.tsv.
stdin lines: idx|code|confidence|evidence|pointer|note   (evidence/pointer may be 'AUTO' to take the locator's hit)."""
import json, sys, csv
from items import items, D
import check_pay
U = [json.loads(l) for l in open(D.HERE.parent / 'units.jsonl')]
out = open(D.HERE / 'codes2.tsv', 'a')
for line in sys.stdin:
    line = line.rstrip('\n')
    if not line.strip() or line.startswith('#'): continue
    p = line.split('|') + [''] * 6
    idx, code, conf, evid, ptr, note = p[:6]
    u = U[int(idx)]
    if evid == 'REASON':
        evid = 'verdict reason: ' + (u.get('reported_reason') or '')[:300]
    if evid == 'AUTO':
        its, raw = items(u); e = check_pay.ev(u, its)
        assert e, f'no auto evidence for {idx}'
        evid = e[1]; ptr = f'tool result of call #{e[0]}' + (f'; {ptr}' if ptr and ptr != 'AUTO' else '')
    out.write('\t'.join([idx, u['unit_id'], code, conf, evid.replace('\t', ' '), ptr, note]) + '\n')
    print(idx, code)
