# /// script
# requires-python = ">=3.11"
# ///
"""Pairwise agreement (percent and Cohen's kappa) between trace-audit coders, by unit kind."""
import json, sys, itertools, collections
from pathlib import Path
base = Path(__file__).resolve().parent.parent
units = {}
for line in open(base / "units.jsonl"):
    u = json.loads(line); units[u["unit_id"]] = u
def kind(u):
    k = u.get("build_kind") or u.get("kind") or ("faulty" if u.get("fault_id") else "healthy")
    return "faulty" if "fault" in str(k) and "health" not in str(k) else "healthy"
def app(u): return "moodle" if "moodle" in json.dumps(u.get("app", u.get("run_set",""))).lower() else "payment"
files = {"c1": base/"codes-coder1.jsonl", "c2": base/"codes-coder2.jsonl", "c3": base/"coder3-work/codes-coder3.jsonl"}
codes = {}
for name, f in files.items():
    if f.exists():
        codes[name] = {json.loads(l)["unit_id"]: json.loads(l)["code"] for l in open(f) if l.strip()}
def kappa(a, b):
    n = len(a); po = sum(x == y for x, y in zip(a, b)) / n
    ca, cb = collections.Counter(a), collections.Counter(b)
    pe = sum(ca[k] * cb[k] for k in set(ca) | set(cb)) / n / n
    return po, (po - pe) / (1 - pe) if pe < 1 else float("nan")
for x, y in itertools.combinations(sorted(codes), 2):
    common = [i for i in units if i in codes[x] and i in codes[y]]
    print(f"== {x} vs {y}: {len(common)} common units")
    for grp in ("faulty", "healthy"):
        for ap in ("payment", "moodle", "all"):
            ids = [i for i in common if kind(units[i]) == grp and (ap == "all" or app(units[i]) == ap)]
            if not ids: continue
            po, k = kappa([codes[x][i] for i in ids], [codes[y][i] for i in ids])
            print(f"  {grp:7} {ap:7} n={len(ids):3}  agree={po*100:5.1f}%  kappa={k:.2f}")
    dis = collections.Counter((codes[x][i], codes[y][i]) for i in common if codes[x][i] != codes[y][i])
    print("  disagreements:", dict(dis))
