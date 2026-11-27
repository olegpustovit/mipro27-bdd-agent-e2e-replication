# /// script
# requires-python = ">=3.11"
# ///
"""Screen break candidates: UI-changing commit -> Behat repair, from cached git metadata.

usage: mine_breaks.py NAME [--until-date YYYY-MM-DD] [--since-date YYYY-MM-DD]
Writes out/candidates-breaks-NAME.jsonl (screening output; merged later).
"""
import sys, os, json, re, argparse
from collections import defaultdict
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from common import *
import datetime

ap = argparse.ArgumentParser()
ap.add_argument("name"); ap.add_argument("--since-date"); ap.add_argument("--until-date")
a = ap.parse_args()
cs = [json.loads(l) for l in open(f"{HERE}/cache-{a.name}.jsonl")][::-1]  # oldest first
td = json.load(open(f"{HERE}/cache-td-{a.name}.json"))
ts = lambda d: int(datetime.datetime.fromisoformat(d).replace(tzinfo=datetime.timezone.utc).timestamp())
if a.since_date: cs = [c for c in cs if c["ct"] >= ts(a.since_date)]
if a.until_date: cs = [c for c in cs if c["ct"] < ts(a.until_date)]
day = lambda t: datetime.datetime.fromtimestamp(t, datetime.timezone.utc).strftime("%Y-%m-%d")

STEP = re.compile(r"^\s*(Given|When|Then|And|But)\s+(.*)$")
SELTYPES = {"icon", "button", "link", "link_or_button", "menuitem", "field", "text", "region", "css_element", "xpath_element",
            "table_row", "dialogue", "checkbox", "radio", "select", "table", "fieldset", "list_item", "menu", "tab", "heading"}


def norm_step(s):
    m = STEP.match(s)
    return (m.group(2) if m else s).strip()


def strip_sel(s):
    # drop trailing selector-type literal, e.g. click on "X" "icon" -> click on "X"
    return re.sub(r'\s+"(%s)"\s*$' % "|".join(SELTYPES), "", s)


def classify_test_half(c):
    """Return dict(class, flags, features, php, scenarios) from the cached U0 diff of behat files."""
    d = td.get(c["sha"], {})
    feat_files = {f: v for f, v in d.items() if RX_FEATURE.search(norm(f))}
    php_files = [f for f in d if not RX_FEATURE.search(norm(f)) and f.endswith(".php")]
    added_feat = [f["p"] for f in c["files"] if f["k"] == "feature" and f["s"] == "A"]
    step_changes, data_changes, new_scen, sel_only = [], [], 0, 0
    for f, v in feat_files.items():
        dels = [l for l in v["del"] if l.strip() and not l.strip().startswith(("#", "@"))]
        adds = [l for l in v["add"] if l.strip() and not l.strip().startswith(("#", "@"))]
        new_scen += sum(1 for l in adds if re.match(r"\s*Scenario", l)) - sum(1 for l in dels if re.match(r"\s*Scenario", l))
        dsteps = [l for l in dels if STEP.match(l)]
        asteps = [l for l in adds if STEP.match(l)]
        drows = [l for l in dels if l.strip().startswith("|")]
        arows = [l for l in adds if l.strip().startswith("|")]
        if f in [norm(x) for x in added_feat] or f in added_feat:
            continue
        if dsteps:
            # step wording changed in an existing scenario
            dn = [norm_step(l) for l in dsteps]; an = [norm_step(l) for l in asteps]
            data_like = lambda s: bool(re.match(r"the following .* exist", s)) or s.startswith("the following ")
            real_d = [s for s in dn if not data_like(s)]
            if real_d:
                step_changes.append({"file": f, "del": real_d[:3], "add": [s for s in an if not data_like(s)][:3]})
                if len(real_d) == len([s for s in an if not data_like(s)]) and all(strip_sel(x) == strip_sel(y) and x != y for x, y in zip(real_d, [s for s in an if not data_like(s)])):
                    sel_only += 1
            else:
                data_changes.append(f)
        elif drows or arows or adds:
            data_changes.append(f)
    cls = "unknown"
    if added_feat and not php_files and not step_changes: cls = "iii"
    elif step_changes: cls = "ii"
    elif php_files: cls = "i"
    elif data_changes: cls = "iii"
    return {"cls": cls, "step_changes": step_changes[:4], "selector_type_only": bool(sel_only and sel_only == len(step_changes)),
            "feature_files": sorted(feat_files)[:8], "php_files": php_files[:8], "new_scenarios": new_scen,
            "data_files": data_changes[:4], "added_features": added_feat[:4]}


def ui_files(c):
    return [f for f in c["files"] if f["k"] in ("ui",)]


def is_test_commit(c): return any(f["k"] in ("feature", "behatphp") for f in c["files"])


def has_ui(c): return any(f["k"] in ("ui", "style", "php") for f in c["files"])


def comps(c, kinds):
    return sorted({f["c"] for f in c["files"] if f["k"] in kinds})


out = []
ui_commits = [c for c in cs if any(f["k"] == "ui" for f in c["files"]) and not is_test_commit(c)]
by_mdl = defaultdict(list)
for u in ui_commits:
    if u["mdl"]: by_mdl[u["mdl"]].append(u)
REPAIR = re.compile(r"behat|fail|fix|broken|adjust|update|follow|tests?\b", re.I)

for t in cs:
    if not is_test_commit(t): continue
    th = classify_test_half(t)
    # combined commit
    if any(f["k"] == "ui" for f in t["files"]):
        if th["cls"] in ("i", "ii") :
            out.append({"kind": "combined", "ui_commit": t["sha"], "test_fix_commit": t["sha"], "mdl": t["mdl"], "date": day(t["ct"]),
                        "subject": t["subject"], "components": comps(t, ("ui", "feature", "behatphp")), "ui_files": [f["p"] for f in ui_files(t)][:10],
                        "lag_days": 0, "link": "combined-commit", "test_half": th})
        continue
    if has_ui(t) and any(f["k"] == "php" for f in t["files"]):  # mixed non-ui php: treat as logic commit, skip
        continue
    if not REPAIR.search(t["subject"]): continue
    tcomps = set(comps(t, ("feature", "behatphp")))
    cand = []
    for u in by_mdl.get(t["mdl"], []) if t["mdl"] else []:
        if 0 <= t["ct"] - u["ct"] <= 14 * 86400 and u["sha"] != t["sha"]:
            cand.append((u, "same-mdl"))
    if not cand and "behat" in t["subject"].lower():
        # component fallback: most recent UI commit in same component within 14 days
        for u in reversed(ui_commits):
            if 0 <= t["ct"] - u["ct"] <= 14 * 86400 and u["sha"] != t["sha"] and (set(comps(u, ("ui",))) & tcomps):
                cand.append((u, "same-component")); break
            if t["ct"] - u["ct"] > 14 * 86400: break
    for u, how in cand:
        out.append({"kind": "paired", "ui_commit": u["sha"], "test_fix_commit": t["sha"], "mdl": t["mdl"] if how == "same-mdl" else None,
                    "ui_mdl": u["mdl"], "date": day(t["ct"]), "ui_date": day(u["ct"]), "subject": t["subject"], "ui_subject": u["subject"],
                    "components": sorted(tcomps | set(comps(u, ("ui",)))), "ui_files": [f["p"] for f in ui_files(u)][:10],
                    "lag_days": round((t["ct"] - u["ct"]) / 86400, 1), "link": how, "test_half": th})

with open(f"{HERE}/out/screen-breaks-{a.name}.jsonl", "w") as f:
    for o in out: f.write(json.dumps(o) + "\n")
from collections import Counter
print(a.name, len(out), Counter((o["kind"], o["link"], o["test_half"]["cls"]) for o in out))
