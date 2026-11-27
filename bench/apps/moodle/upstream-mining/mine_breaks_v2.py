# /// script
# requires-python = ">=3.11"
# dependencies = ["pyyaml"]
# ///
"""Break mining, wave 3 (widened): every commit reachable from the pin whose test half is Behat PHP (step definitions / selectors) and no .feature file.

usage: mine_breaks_v2.py [--dump] [--stage screen|patch|impact]
  --dump   write mining/cache-pinfull.jsonl (name-status of every non-merge commit reachable from the pin, all history; gitignored)
Stages (every commit examined is written to mining/out/candidates-v2-breaks-screen.jsonl with its decision; nothing is dropped):
  screen   T = a non-merge commit that edits Behat PHP (behat_*.php, tests/behat/*.php, lib/behat selector classes) and touches no .feature file.
           UI link: `combined` (the same commit also changes a UI/style file), `same-mdl` (an earlier non-test commit with the same MDL id within
           120 days changes UI/style files), `same-component` (subject mentions behat, most recent UI commit of the same component within 30 days),
           else `none` (rejected: no UI-changing commit linked).
  patch    reverse-apply T's Behat-PHP hunks at the pin (plain, -C1, 3way, per-file merge); layout pre-public via --directory=public.
           records the developers' fix size (files, hunks, +/- lines) and the pin->old-steps patch size.
  impact   which step definitions the reverted hunks sit in (docblock @Given/@When/@Then regex, helpers followed through same-file callers, named
           selectors by key) and which scenarios of the pin's features use them (static approximation; Behat decides later).
Only commit ids, paths and short summaries are written."""
import sys, os, re, json, datetime, collections
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from common import git, load_commits
import patchlib
from patchlib import Scratch, fwd, files as pfiles, PIN, GENERATED
from scenarios import parse

CACHE = f"{HERE}/cache-pinfull.jsonl"; OUTD = f"{HERE}/out"
SRC = os.path.expanduser(f"~/.local/share/cucumber-study/moodle/src/{PIN[:12]}")
day = lambda t: datetime.datetime.fromtimestamp(t, datetime.timezone.utc).strftime("%Y-%m-%d")

def commits():
    if "--dump" in sys.argv or not os.path.exists(CACHE):
        load_commits(PIN, "2000-01-01", cache=CACHE)
    return [json.loads(l) for l in open(CACHE)][::-1]   # oldest first

def is_test(c): return any(f["k"] in ("feature", "behatphp") for f in c["files"])
def ui_files(c): return [f["p"] for f in c["files"] if f["k"] in ("ui", "style") and not GENERATED.search(f["p"])]
def comps(c, kinds): return sorted({f["c"] for f in c["files"] if f["k"] in kinds})

def screen():
    cs = commits(); os.makedirs(OUTD, exist_ok=True)
    by_mdl = collections.defaultdict(list); ui_commits = []
    for u in cs:
        if not is_test(u) and ui_files(u):
            ui_commits.append(u)
            if u["mdl"]: by_mdl[u["mdl"]].append(u)
    out = []
    for t in cs:
        phpt = [f for f in t["files"] if f["k"] == "behatphp"]
        if not phpt: continue
        rec = {"sha": t["sha"], "date": day(t["ct"]), "mdl": t["mdl"], "subject": t["subject"], "behat_php_files": [f["p"] for f in phpt][:8], "n_files": len(t["files"])}
        if any(f["k"] == "feature" for f in t["files"]):
            rec["decision"] = "rejected: touches a .feature file (class ii/iii, not class i)"; out.append(rec); continue
        if all(f["s"] == "D" for f in phpt):
            rec["decision"] = "rejected: only deletes Behat PHP files"; out.append(rec); continue
        links = []
        if ui_files(t):
            links.append({"link": "combined", "ui_commits": [t["sha"]], "ui_files": ui_files(t)[:10]})
        else:
            us = [u for u in by_mdl.get(t["mdl"], []) if 0 <= t["ct"] - u["ct"] <= 120 * 86400 and u["sha"] != t["sha"]] if t["mdl"] else []
            if us:
                links.append({"link": "same-mdl", "ui_commits": [u["sha"] for u in us], "ui_files": sorted({p for u in us for p in ui_files(u)})[:10], "ui_dates": [day(u["ct"]) for u in us]})
            elif "behat" in t["subject"].lower():
                tc = set(comps(t, ("behatphp",)))
                for u in reversed([u for u in ui_commits if u["ct"] <= t["ct"]]):
                    if t["ct"] - u["ct"] > 30 * 86400: break
                    if u["sha"] != t["sha"] and set(comps(u, ("ui", "style"))) & tc:
                        links.append({"link": "same-component", "ui_commits": [u["sha"]], "ui_files": ui_files(u)[:10], "ui_dates": [day(u["ct"])]}); break
        if not links:
            rec["decision"] = "rejected: no UI-changing commit linked (not combined, no same-MDL UI commit in 120 days, no same-component UI commit in 30 days)"
        else:
            rec.update(links[0]); rec["decision"] = "candidate"
        out.append(rec)
    with open(f"{OUTD}/candidates-v2-breaks-screen.jsonl", "w") as f:
        for r in out: f.write(json.dumps(r) + "\n")
    print("commits in history", len(cs), "behat-php commits", len(out), collections.Counter(r["decision"].split(":")[0] if r["decision"] != "candidate" else r["link"] for r in out))

def reverse_test(t, fs):
    """Reverse-apply the Behat-PHP hunks of commit t at the pin; returns (method, patch) or raises."""
    sha = git("rev-parse", t).strip()
    pre = not any(p.startswith("public/") for p in git("diff-tree", "--no-commit-id", "--name-only", "-r", "--no-renames", sha).splitlines())
    d = fwd(sha, fs)
    s = Scratch(); method = s.reverse(d, sha if not pre else None, fs, extra=["--directory=public"] if pre else ())
    return method, s.diff(), d, pre

def size(diff):
    files = re.findall(r"^diff --git a/(\S+) b/", diff, re.M)
    hunks = len(re.findall(r"^@@ ", diff, re.M))
    add = sum(1 for l in diff.splitlines() if l.startswith("+") and not l.startswith("+++"))
    dele = sum(1 for l in diff.splitlines() if l.startswith("-") and not l.startswith("---"))
    return {"files": len(files), "hunks": hunks, "added": add, "deleted": dele}

# ---- impact ----
FUNC = re.compile(r"^\s*(?:(?:public|protected|private|static|final)\s+)*function\s+&?(\w+)\s*\(")
ANNOT = re.compile(r"@(?:Given|When|Then)\s+/(.*)/[a-z]*\s*$")
def functions(text):
    lines = text.split("\n"); starts = [(i, mm.group(1)) for i, l in enumerate(lines) if (mm := FUNC.match(l))]
    funcs = {}
    for k, (i, name) in enumerate(starts):
        end = starts[k + 1][0] if k + 1 < len(starts) else len(lines)
        j = i - 1; annots = []
        while j >= 0 and (lines[j].strip().startswith(("*", "/**", "/*", "*/")) or not lines[j].strip()):
            m = ANNOT.search(lines[j].strip());
            if m: annots.append(m.group(1))
            if lines[j].strip().startswith("/**"): break
            j -= 1
        funcs[name] = {"start": i + 1, "end": end, "annots": annots, "body": "\n".join(lines[i:end])}
    return funcs

def impact(patch):
    """patch = pin -> old steps. Returns {patterns, selectors, funcs} for the pin-side hunks."""
    pats, sels, fnames, unknown = set(), set(), set(), 0
    for blk in re.split(r"(?m)^diff --git ", patch)[1:]:
        pm = re.match(r"a/(\S+)", blk)
        if not pm: continue   # a quoted or unusual path header: no step definition can be mapped
        path = pm.group(1)
        try: text = git("show", f"{PIN}:{path}")
        except Exception: continue
        funcs = functions(text); lines = text.split("\n")
        for m in re.finditer(r"(?m)^@@ -(\d+)(?:,(\d+))? ", blk):
            a = int(m.group(1)); b = int(m.group(2)) if m.group(2) is not None else 1
            rng = range(max(a, 1), max(a, 1) + max(b, 1))
            hit = {n for n, f in funcs.items() if any(f["start"] <= r < f["end"] + 1 for r in rng)}
            if not hit and "selector" in path:
                for r in rng:
                    for j in range(min(r, len(lines)) - 1, -1, -1):
                        mk = re.match(r"^\s*'([a-z_ ]+)'\s*=>", lines[j])
                        if mk: sels.add(mk.group(1)); break
            if not hit and not sels: unknown += 1
            fnames |= hit
        # follow helpers: same-file callers up to depth 3
        seen = set(); front = set(fnames) & set(funcs)
        for _ in range(3):
            nxt = set()
            for n in front:
                if n in seen: continue
                seen.add(n)
                if funcs[n]["annots"]: pats.update(funcs[n]["annots"])
                else: nxt |= {k for k, f in funcs.items() if re.search(r"(?:->|::)" + re.escape(n) + r"\s*\(", f["body"])}
            front = nxt - seen
        if "selector" in path and not sels:   # selector-class edits outside a keyed block: use the changed functions' names only
            pass
    return {"patterns": sorted(pats), "selectors": sorted(sels), "funcs": sorted(fnames), "unmapped_hunks": unknown}

_IDX = None
def feature_index():
    global _IDX
    if _IDX is None:
        _IDX = {}
        for root, _, fs in os.walk(f"{SRC}/public"):
            if "node_modules" in root or "/vendor" in root: continue
            for fn in fs:
                if fn.endswith(".feature"):
                    p = os.path.join(root, fn)
                    try: _IDX[os.path.relpath(p, f"{SRC}/public")] = parse(open(p, encoding="utf8").read())
                    except Exception: pass
    return _IDX

def php_to_py(rx):
    rx = rx.replace("\\/", "/")
    return re.compile(rx)

def scenarios_using(pats, sels):
    res = []
    rxs = []
    for p in pats:
        try: rxs.append(php_to_py(p))
        except re.error: pass
    for s in sels: rxs.append(re.compile(r'.*"' + re.escape(s) + r'".*'))
    for f, v in feature_index().items():
        bg = [s["text"] for s in v["background"]]
        for sc in v["scenarios"]:
            texts = bg + [s["text"] for s in sc["steps"]]
            hits = [t for t in texts if any(r.search(t) for r in rxs)]
            if hits: res.append({"feature": f, "scenario": sc["name"], "line": sc["line"], "javascript": "@javascript" in (v["tags"] + sc["tags"]), "tags": sorted(set(v["tags"]) | set(sc["tags"])), "outline": sc["outline"], "steps": len(texts), "n_hit_steps": len(hits), "first_hit": hits[0][:120]})
    return res

if __name__ == "__main__":
    stage = sys.argv[sys.argv.index("--stage") + 1] if "--stage" in sys.argv else "screen"
    if stage == "screen": screen()
    if stage in ("patch", "impact"):
        done = {}
        P = f"{OUTD}/breaks-v2-static.jsonl"
        if os.path.exists(P): done = {json.loads(l)["sha"]: json.loads(l) for l in open(P)}
        cands = [json.loads(l) for l in open(f"{OUTD}/candidates-v2-breaks-screen.jsonl")]
        cands = [c for c in cands if c["decision"] == "candidate"][::-1]   # newest first
        lim = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else 10**9
        import time
        with open(P, "a") as out:
            for i, c in enumerate(cands[:lim]):
                if c["sha"] in done: continue
                t0 = time.time(); r = {"sha": c["sha"], "date": c["date"], "mdl": c["mdl"], "subject": c["subject"], "link": c["link"], "ui_commits": c["ui_commits"]}
                try:
                    fs = [f for f in pfiles(c["sha"], "test") if not f.endswith(".feature")]
                    r["step_files"] = fs
                    method, patch, fixd, pre = reverse_test(c["sha"], fs)
                    r.update(method=method, layout="pre-public" if pre else "public", fix_size=size(fixd), patch_size=size(patch), patch_empty=not patch.strip())
                    if patch.strip():
                        im = impact(patch); r["impact"] = im
                        sc = scenarios_using(im["patterns"], im["selectors"]); r["n_scenarios"] = len(sc); r["scenarios"] = sc[:40]
                        r["decision"] = "static-ok" if sc else "rejected: no scenario at the pin uses the reverted step definitions/selectors"
                    else: r["decision"] = "rejected: reverting the Behat hunks leaves the pin unchanged (empty patch)"
                except Exception as ex:
                    r["decision"] = "rejected: " + ("test hunks do not reverse-apply at the pin" if "apply" in str(ex) or "merge" in str(ex) else "error") ; r["error"] = str(ex)[:300]
                r["secs"] = round(time.time() - t0, 1)
                out.write(json.dumps(r) + "\n"); out.flush()
                print(i, c["date"], c["sha"][:10], r["decision"][:70], r.get("n_scenarios", ""), r["secs"], flush=True)
