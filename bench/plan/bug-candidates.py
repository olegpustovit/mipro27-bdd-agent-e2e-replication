#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# ///
"""Find upstream candidates. Selection and symptom matching require review."""

import argparse
import json
import subprocess
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def github_search(kind, query):
    for page in range(1, 11):
        params = urlencode({"q": query, "per_page": 100, "page": page})
        request = Request(
            f"https://api.github.com/search/{kind}?{params}",
            headers={"Accept": "application/vnd.github+json"},
        )
        with urlopen(request, timeout=30) as response:
            result = json.load(response)
        if result["incomplete_results"]:
            raise SystemExit(f"GitHub returned incomplete {kind} results. Retry the query.")
        for item in result["items"]:
            title = item["title"] if kind == "issues" else item["commit"]["message"].splitlines()[0]
            print(f"{item['html_url']}\t{title}")
        if page * 100 >= result["total_count"]:
            return
    raise SystemExit("GitHub search is capped at 1000 hits. Narrow the query.")


def moodle_search(jql):
    params = {"jql": f"project = MDL AND ({jql})", "fields": "summary", "maxResults": 100}
    while True:
        url = "https://moodle.atlassian.net/rest/api/3/search/jql?" + urlencode(params)
        with urlopen(url, timeout=30) as response:
            result = json.load(response)
        for issue in result["issues"]:
            print(f"https://moodle.atlassian.net/browse/{issue['key']}\t{issue['fields']['summary']}")
        if result.get("isLast", True):
            return
        params["nextPageToken"] = result["nextPageToken"]



def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("app", choices=["rwa", "moodle"])
    parser.add_argument("checkout", help="Local upstream checkout")
    parser.add_argument("revision", help="Tested revision")
    parser.add_argument("pattern", help="Extended regex for commit messages")
    parser.add_argument("--path", action="append", default=[])
    parser.add_argument("--issue-query", default="", help="GitHub terms or a Moodle tracker JQL filter")
    args = parser.parse_args()
    git = ["git", "-C", args.checkout]
    revision = subprocess.check_output(
        [*git, "rev-parse", "--verify", f"{args.revision}^{{commit}}"], text=True
    ).strip()
    print(f"Tested revision {revision}", flush=True)
    subprocess.run(
        [
            *git, "log", "--all", revision, "--no-merges", "--oneline",
            "--regexp-ignore-case", "--extended-regexp", f"--grep={args.pattern}",
            "--", *args.path,
        ],
        check=True,
    )
    if args.app == "rwa":
        github_search(
            "issues",
            f"repo:cypress-io/cypress-realworld-app is:issue {args.issue_query}".strip(),
        )
    elif args.issue_query:
        moodle_search(args.issue_query)


if __name__ == "__main__":
    main()
