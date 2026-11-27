# /// script
# requires-python = ">=3.14"
# ///
"""Coder 2: write ../codes-coder2.jsonl from codes2.tsv, one line per unit in units.jsonl order, with checks."""
import json, collections
from pathlib import Path
H = Path(__file__).resolve().parent
U = [json.loads(l) for l in open(H.parent / 'units.jsonl')]
rows = {}
for l in open(H / 'codes2.tsv'):
    idx, uid, code, conf, ev, ptr, note = l.rstrip('\n').split('\t')
    assert idx not in rows, idx
    rows[int(idx)] = (uid, code, conf, ev, ptr, note)
FIX = {
 "is not a unit (it passed)": "is not a unit (it passed or was setup-excluded)",
 "are not units (they passed)": "are not units (they passed or were setup-excluded)",
 "one gpt-6-luna and one gpt-5.6-terra repetition of this case passed within the budget": "one gpt-6-luna and one gpt-5.6-terra healthy repetition of this case are not units (passed or setup-excluded)",
 "the other gpt-5.6-terra repetition passed, so": "the other gpt-5.6-terra healthy repetition is not a unit (passed or setup-excluded), so",
}
FAULTY = {'CORRECT', 'WRONG-REASON', 'UNCLEAR'}; HEALTHY = {'AGENT-ERROR', 'ENVIRONMENT', 'SCENARIO-AMBIGUOUS', 'APP-BEHAVIOUR'}
out = open(H.parent / 'codes-coder2.jsonl', 'w')
dist = collections.Counter()
for i, u in enumerate(U):
    uid, code, conf, ev, ptr, note = rows[i]
    assert uid == u['unit_id']
    assert code in (FAULTY if u['build_type'] == 'faulty' else HEALTHY), (i, code)
    for a, b in FIX.items(): note = note.replace(a, b)
    rec = {'unit_id': uid, 'code': code, 'evidence': ev, 'pointer': ptr, 'confidence': conf}
    if note: rec['note'] = note
    out.write(json.dumps(rec, ensure_ascii=False) + '\n')
    dist[(u['app'], u['build_type'], code)] += 1
assert len(rows) == len(U) == 386
for k in sorted(dist): print(k, dist[k])
