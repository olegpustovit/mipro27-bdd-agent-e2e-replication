# /// script
# requires-python = ">=3.11"
# ///
"""Majority and unanimous codes across the three trace-audit coders, plus a coarse agent / not-agent split."""
import json, collections
from pathlib import Path
b = Path(__file__).resolve().parent.parent
u = {json.loads(l)["unit_id"]: json.loads(l) for l in open(b/"units.jsonl")}
c = [{json.loads(l)["unit_id"]: json.loads(l)["code"] for l in open(f) if l.strip()}
     for f in (b/"codes-coder1.jsonl", b/"codes-coder2.jsonl", b/"coder3-work/codes-coder3.jsonl")]
def maj(i):
    k = collections.Counter(x[i] for x in c).most_common()
    return k[0][0] if k[0][1] >= 2 else "NO-MAJORITY"
for bt in ("faulty", "healthy"):
    for app in ("payment", "moodle", None):
        ids = [i for i in u if u[i]["build_type"] == bt and (app is None or u[i]["app"] == app)]
        m = collections.Counter(maj(i) for i in ids)
        un = collections.Counter(c[0][i] for i in ids if c[0][i] == c[1][i] == c[2][i])
        print(f"{bt:7} {app or 'all':7} n={len(ids):3} majority={dict(m)} unanimous={dict(un)} (unanimous total {sum(un.values())})")
ids = [i for i in u if u[i]["build_type"] == "healthy"]
coarse = lambda x: "agent" if x == "AGENT-ERROR" else "not-agent"
all3 = [i for i in ids if len({coarse(x[i]) for x in c}) == 1]
print("healthy coarse agent/not-agent unanimous:", len(all3), "of", len(ids), dict(collections.Counter(coarse(c[0][i]) for i in all3)))
print("faulty by run set, majority CORRECT:")
rs = collections.defaultdict(collections.Counter)
for i in u:
    if u[i]["build_type"] == "faulty": rs[(u[i]["app"], u[i]["run_set"], u[i]["model"])][maj(i)] += 1
for k, v in sorted(rs.items()): print("  ", k, dict(v))
