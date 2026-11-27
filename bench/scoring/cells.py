# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Generate the condition-level cell manifest from the locked run grid."""
import argparse
import json
from pathlib import Path

BENCH = Path(__file__).resolve().parents[1]
FIELDS = ("app", "version", "scenario", "change", "phase", "arm", "condition")


def cells(plan):
    grouped = {}
    ids = set()
    for item in plan["items"]:
        key = tuple(item.get(field) for field in FIELDS)
        cell = grouped.setdefault(key, {
            **dict(zip(FIELDS, key)), "bug_id": item.get("bugId"), "items": {},
        })
        rep = item["rep"]
        if item["id"] in ids or rep in cell["items"] or cell["bug_id"] != item.get("bugId"):
            raise ValueError(f"inconsistent cell or duplicate item {item['id']}")
        ids.add(item["id"])
        cell["items"][rep] = item["id"]
    expected = set(range(1, plan["reps"] + 1))
    for cell in grouped.values():
        if cell["items"].keys() != expected:
            raise ValueError(f"incomplete run grid: {cell}")
        cell["items"] = [cell["items"][rep] for rep in sorted(expected)]
    return list(grouped.values())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, default=BENCH / "plan/plan.json")
    args = parser.parse_args()
    rows = cells(json.loads(args.plan.read_bytes()))
    print("[\n" + ",\n".join("  " + json.dumps(row) for row in rows) + "\n]")


if __name__ == "__main__":
    main()
