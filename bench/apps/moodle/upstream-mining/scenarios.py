# /// script
# requires-python = ">=3.11"
# ///
"""Minimal Gherkin scenario indexer over git objects (no checkout needed).
usage: scenarios.py REF NAME  -> cache-scen-NAME.json  {path: {tags, background, scenarios:[{name,line,tags,steps,outline}]}}"""
import sys, os, re, json, subprocess
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from common import *

STEP = re.compile(r"^\s*(Given|When|Then|And|But)\s+(.*\S)\s*$")


def parse(text):
    feat_tags, cur_tags, scen, bg = [], [], [], []
    mode, cur = None, None
    for i, raw in enumerate(text.splitlines(), 1):
        s = raw.strip()
        if not s or s.startswith("#"): continue
        if s.startswith("@"):
            cur_tags += s.split(); continue
        if s.startswith("Feature:"):
            feat_tags, cur_tags, mode = cur_tags, [], "feature"; continue
        if s.startswith("Background:"):
            mode = "bg"; cur_tags = []; continue
        m = re.match(r"(Scenario Outline|Scenario Template|Scenario):\s*(.*)", s)
        if m:
            cur = {"name": m.group(2).strip(), "line": i, "tags": cur_tags, "steps": [], "outline": m.group(1) != "Scenario"}
            scen.append(cur); cur_tags, mode = [], "scen"; continue
        if s.startswith("Examples:"):
            mode = "examples"; cur_tags = []; continue
        sm = STEP.match(raw)
        if sm and mode == "bg": bg.append({"line": i, "text": sm.group(2)})
        elif sm and mode == "scen": cur["steps"].append({"line": i, "text": sm.group(2), "kw": sm.group(1)})
    return {"tags": feat_tags, "background": bg, "scenarios": scen}


def index(ref):
    files = [l.split("\t")[1] for l in git("ls-tree", "-r", ref).splitlines() if l.endswith(".feature")]
    out = {}
    p = subprocess.run(["git", "-C", MOODLE, "cat-file", "--batch"], input="".join(f"{ref}:{f}\n" for f in files).encode(), capture_output=True)
    data, pos = p.stdout, 0
    for f in files:
        nl = data.index(b"\n", pos); hdr = data[pos:nl].decode().split(); pos = nl + 1
        size = int(hdr[2]); body = data[pos:pos + size].decode("utf-8", "replace"); pos += size + 1
        out[norm(f)] = parse(body)
    return out


if __name__ == "__main__":
    ref, name = sys.argv[1:3]
    idx = index(ref)
    json.dump(idx, open(f"{HERE}/cache-scen-{name}.json", "w"))
    print(len(idx), sum(len(v["scenarios"]) for v in idx.values()))
