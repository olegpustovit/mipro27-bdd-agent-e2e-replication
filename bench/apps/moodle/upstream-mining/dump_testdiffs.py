# /// script
# requires-python = ">=3.11"
# ///
"""Cache per-commit behat-file changed lines (U0) for a ref. Cache is local only (gitignored)."""
import sys, os, json, subprocess
sys.path.insert(0, os.path.dirname(__file__))
from common import *
ref, since, name = sys.argv[1:4]
out = git("log", ref, "--no-merges", "--no-renames", "-p", "-U0", f"--since={since}", "--format=@@%H", "--",
          "*/tests/behat/*", "*/behat/*", "*behat_*.php")
res = {}; cur = None; f = None
for line in out.splitlines():
    if line.startswith("@@") and len(line) == 42:
        cur = res.setdefault(line[2:], {}); f = None
    elif line.startswith("diff --git"):
        f = line.split(" b/", 1)[1]; cur[f] = {"add": [], "del": []}
    elif f and line.startswith("+") and not line.startswith("+++"): cur[f]["add"].append(line[1:])
    elif f and line.startswith("-") and not line.startswith("---"): cur[f]["del"].append(line[1:])
json.dump(res, open(f"{os.path.dirname(__file__)}/cache-td-{name}.json", "w"))
print(name, len(res))
