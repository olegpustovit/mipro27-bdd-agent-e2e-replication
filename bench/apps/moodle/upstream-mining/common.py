# /// script
# requires-python = ">=3.11"
# ///
"""Shared helpers for Moodle history mining. Only commit ids, paths and short summaries are kept."""
import re, subprocess, json, os

MOODLE = os.path.expanduser(os.environ.get("MOODLE_REPO", "~/projects/cms-work/moodle"))


def git(*args, check=True, input=None):
    r = subprocess.run(["git", "-C", MOODLE, *args], capture_output=True, text=True, errors="replace", input=input)
    if check and r.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)}: {r.stderr[:500]}")
    return r.stdout


def norm(path):
    return path[len("public/"):] if path.startswith("public/") else path


def component(path):
    p = norm(path)
    parts = p.split("/")
    if parts[0] == "mod" and len(parts) > 1: return "mod_" + parts[1]
    if parts[0] == "blocks" and len(parts) > 1: return "block_" + parts[1]
    if parts[0] == "course" and len(parts) > 1 and parts[1] == "format" : return "format_" + parts[2]
    if parts[0] == "theme" and len(parts) > 1: return "theme_" + parts[1]
    if parts[0] in ("admin", "user", "course", "question", "grade", "enrol", "auth", "message", "calendar",
                    "comment", "tag", "report", "badges", "cohort", "group", "files", "backup", "repository",
                    "contentbank", "reportbuilder", "login", "my", "search", "lib", "availability", "filter", "analytics"):
        if parts[0] == "admin" and len(parts) > 2 and parts[1] in ("tool", "settings", "roles"):
            return "tool_" + parts[2] if parts[1] == "tool" else "admin"
        if parts[0] in ("question",) and len(parts) > 2 and parts[1] in ("type", "behaviour", "bank", "format"):
            return f"qtype_{parts[2]}" if parts[1] == "type" else f"qbank_{parts[2]}" if parts[1] == "bank" else f"{parts[1]}_{parts[2]}"
        if parts[0] == "grade" and len(parts) > 2 and parts[1] in ("report", "export", "import"):
            return f"gradereport_{parts[2]}" if parts[1] == "report" else f"grade{parts[1]}_{parts[2]}"
        if parts[0] == "report" and len(parts) > 1: return "report_" + parts[1]
        if parts[0] == "enrol" and len(parts) > 1: return "enrol_" + parts[1]
        if parts[0] == "auth" and len(parts) > 1: return "auth_" + parts[1]
        if parts[0] == "filter" and len(parts) > 1: return "filter_" + parts[1]
        if parts[0] == "repository" and len(parts) > 1: return "repository_" + parts[1]
        return parts[0] if parts[0] != "lib" else "core"
    return parts[0]


RX_FEATURE = re.compile(r"(^|/)tests/behat/[^/]*\.feature$")
RX_BEHATPHP = re.compile(r"(^|/)(tests/behat|behat)/.*\.php$|(^|/)behat_[^/]*\.php$")
RX_BEHAT_ANY = re.compile(r"(^|/)tests/behat/|(^|/)lib/behat/|behat")


def kind(path):
    p = norm(path)
    if RX_FEATURE.search(p): return "feature"
    if RX_BEHATPHP.search(p): return "behatphp"
    if p.endswith(".mustache"): return "ui"
    if re.search(r"(^|/)amd/src/.*\.js$", p): return "ui"
    if re.search(r"(^|/)classes/output/", p) or re.search(r"(^|/)(renderer|renderers?)[^/]*\.php$", p) or re.search(r"/classes/(output|external)?/?.*renderer", p): return "ui"
    if re.search(r"(^|/)lang/en/[^/]*\.php$", p): return "ui"
    if re.search(r"(^|/)(classes/form/|templates/)", p): return "ui"
    if re.search(r"(^|/)(styles?|scss)/.*\.(scss|css)$", p) or p.endswith(".scss"): return "style"
    if re.search(r"(^|/)(tests?|fixtures)/", p): return "othertest"
    if p.endswith(".php"): return "php"
    return "other"


MDL = re.compile(r"\b(MDL-\d+)\b")


def load_commits(ref, since, until=None, cache=None):
    if cache and os.path.exists(cache):
        return [json.loads(l) for l in open(cache)]
    args = ["log", ref, "--no-merges", "--no-renames", "--name-status", f"--since={since}", "--format=@@%H%x09%ct%x09%at%x09%an%x09%s"]
    if until: args.append(f"--until={until}")
    out = git(*args)
    commits, cur = [], None
    for line in out.split("\n"):
        if line.startswith("@@"):
            sha, ct, at, an, subj = line[2:].split("\t", 4)
            cur = {"sha": sha, "ct": int(ct), "at": int(at), "subject": subj, "files": []}
            m = MDL.search(subj)
            cur["mdl"] = m.group(1) if m else None
            commits.append(cur)
        elif line.strip() and "\t" in line:
            st, p = line.split("\t", 1)
            cur["files"].append({"s": st, "p": p, "k": kind(p), "c": component(p)})
    if cache:
        with open(cache, "w") as f:
            for c in commits: f.write(json.dumps(c) + "\n")
    return commits
