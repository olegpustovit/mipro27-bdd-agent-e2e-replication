# /// script
# requires-python = ">=3.11"
# dependencies = ["pyyaml"]
# ///
"""Shared patch helpers for make_patches.py and make_candidates.py: file classification, forward diffs, and the scratch-index
reverse application (plain, -C1, 3way, per-file merge) at the pin. Importing this reads manifests/moodle.yaml for the pin."""
import sys, os, re, json, hashlib, subprocess, tempfile
import yaml
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from common import git, MOODLE, kind
OUT = f"{ROOT}/manifests/moodle/patches"
MANIFEST = f"{ROOT}/manifests/moodle.yaml"
m = yaml.safe_load(open(f"{ROOT}/manifests/moodle.yaml"))
PIN = m["moodle"]["pin"]["commit"]
GENERATED = re.compile(r"^\.upgradenotes/|(^|/)version\.php$|/(amd|yui)/build/|\.min\.js(\.map)?$|\.map$|/style/.*\.css$|(^|/)package(-lock)?\.json$|npm-shrinkwrap|/esm/build/")
isTest = lambda f: kind(f) in ("feature", "behatphp") or "/behat/" in f
isOtherTest = lambda f: bool(re.search(r"(^|/)(tests?|fixtures)/", f))

def files(sha, want):
    fs = git("diff-tree", "--no-commit-id", "--name-only", "-r", "--no-renames", sha).splitlines()
    if want == "test": return [f for f in fs if isTest(f)]
    return [f for f in fs if not isTest(f) and not isOtherTest(f) and not GENERATED.search(f)]

def fwd(sha, fs):
    return git("diff", "--binary", "--full-index", "--no-renames", f"{sha}^", sha, "--", *fs) if fs else ""

class Scratch:
    """A scratch index at the pin; apply reverse/forward patches and read back the diff pin -> tree."""
    def __init__(self):
        self.td = tempfile.mkdtemp(); self.env = dict(os.environ, GIT_INDEX_FILE=f"{self.td}/index")
        self.sh("read-tree", PIN)
    def sh(self, *a, input=None, check=True):
        r = subprocess.run(["git", "-C", MOODLE, *a], input=input, env=self.env, text=True, capture_output=True)
        if check and r.returncode: raise RuntimeError(f"git {' '.join(a)}: {r.stderr[:400]}")
        return r
    def reverse(self, patch, commit=None, fs=(), extra=()):
        """Reverse-apply one patch to the scratch index; returns the method used or raises.
        Last resort (later commits edited the same lines): per-file 3-way merge pin/post/pre where each conflicting
        region takes the pre-fix side (`git merge-file --theirs`); the method string lists those files."""
        if not patch.strip(): return "empty"
        import shutil
        backup = f"{self.td}/index.bak"; shutil.copy(f"{self.td}/index", backup)
        for name, flags in (("plain", []), ("context1", ["-C1"]), ("3way", ["--3way"])):
            if self.sh("apply", "-R", "--cached", *extra, *flags, "-", input=patch, check=False).returncode == 0: return name
            shutil.copy(backup, f"{self.td}/index")   # a failed --3way leaves unmerged entries behind
        if not commit: raise RuntimeError("does not reverse-apply (plain, -C1, 3way)")
        resolved, notes = [], []
        for f in fs:
            cur = self.sh("show", f":{f}", check=False)
            post = subprocess.run(["git", "-C", MOODLE, "show", f"{commit}:{f}"], capture_output=True); pre = subprocess.run(["git", "-C", MOODLE, "show", f"{commit}^:{f}"], capture_output=True)
            if cur.returncode and post.returncode and not pre.returncode:   # deleted/moved away by the commit: restore the pre-fix file
                blob = subprocess.run(["git", "-C", MOODLE, "hash-object", "-w", "--stdin"], input=pre.stdout, capture_output=True).stdout.decode().strip()
                self.sh("update-index", "--add", "--cacheinfo", f"100644,{blob},{f}"); notes.append(f"{f}=deleted-by-commit(restored)"); continue
            if cur.returncode: notes.append(f"{f}=absent-at-pin(skipped)"); continue
            if pre.returncode: self.sh("update-index", "--force-remove", f); notes.append(f"{f}=added-by-commit(removed)"); continue
            if post.returncode: raise RuntimeError(f"{f}: deleted by the commit but present at the pin")
            cur_b = subprocess.run(["git", "-C", MOODLE, "cat-file", "blob", self.sh("rev-parse", f":{f}").stdout.strip()], capture_output=True).stdout
            with tempfile.TemporaryDirectory() as d:
                for n, data in (("cur", cur_b), ("post", post.stdout), ("pre", pre.stdout)): open(f"{d}/{n}", "wb").write(data)
                probe = subprocess.run(["git", "merge-file", "-p", f"{d}/cur", f"{d}/post", f"{d}/pre"], capture_output=True)
                if probe.returncode > 0: resolved.append(f"{f}[{probe.returncode} conflict(s): pre-fix side taken]")
                # language files only add or retitle strings: keep both sides (the pre-fix line comes last and wins in PHP)
                mode_flag = "--union" if "/lang/en/" in f else "--theirs"
                r = subprocess.run(["git", "merge-file", "-p", mode_flag, f"{d}/cur", f"{d}/post", f"{d}/pre"], capture_output=True)
                if r.returncode < 0 or r.returncode > 127: raise RuntimeError("merge-file failed")
                blob = subprocess.run(["git", "-C", MOODLE, "hash-object", "-w", "--stdin"], input=r.stdout, capture_output=True).stdout.decode().strip()
            mode = self.sh("ls-files", "-s", f).stdout.split()[0]
            self.sh("update-index", "--cacheinfo", f"{mode},{blob},{f}")
        return "merge" + (" conflicts: " + "; ".join(resolved) if resolved else " clean") + (" notes: " + "; ".join(notes) if notes else "")
    def diff(self):
        tree = self.sh("write-tree").stdout.strip()
        return git("diff", "--binary", "--full-index", "--no-renames", PIN, tree)

def h(text): return hashlib.sha256(text.encode()).hexdigest()
def put(name, text):
    open(f"{OUT}/{name}", "w").write(text); return {"file": f"manifests/moodle/patches/{name}", "sha256": h(text), "bytes": len(text.encode())}
def stat(patch):
    fs = re.findall(r"^diff --git a/(\S+) b/", patch, re.M)
    return {"files": fs, "touches": sorted({("amd" if "/amd/src/" in f else "scss" if f.endswith(".scss") else "theme" if f.startswith("public/theme/") else "other") for f in fs} - {"other"})}

