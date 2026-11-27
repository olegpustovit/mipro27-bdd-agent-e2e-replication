# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Print analysis and provenance for a verified ledger and frozen scoring inputs."""
import argparse
from collections import Counter, defaultdict
import json
from pathlib import Path
import sys

from cells import BENCH, FIELDS, cells
from score import (
    BASELINE, CAUSES, STALE, catch_metrics, divide_cost, healthy_metrics,
    paired_units, proportion, ratio, read_cells, reason_agreement, total_cost, verdict,
)

sys.path.insert(0, str(BENCH / "runner"))
from ledger import Ledger, digest, file_digest, locked


def suite_metrics(planned, complete, rates):
    expected = {cell["scenario"] for cell in planned}
    actual = {cell["cell"]["scenario"] for cell in complete}
    if not expected or actual != expected:
        return {"missing_scenarios": sorted(expected - actual), "one_run": None,
                "best_of_3": None, "aligned_repetitions": None, "cost": None}
    outcomes = [cell["outcomes"] for cell in complete]
    green = [all(outcome == "correct" for outcome in rep) for rep in zip(*outcomes)]
    records = [cell["records"] for cell in complete]
    cost = total_cost((row for series in records for row in series), rates)
    return {
        "missing_scenarios": [],
        "one_run": green[0],
        "best_of_3": all("correct" in series for series in outcomes),
        "aligned_repetitions": proportion(sum(green), len(green)),
        "cost": {
            "one_run": total_cost((series[0] for series in records), rates),
            "mean_per_run": divide_cost(cost, len(green)),
            "best_of_3": cost,
        },
    }


def by_scope(rows, suite=False):
    grouped = defaultdict(list)
    for key, value in rows:
        app, version, _, change, phase, arm = key
        scope = (app, version, change, phase, arm) if suite else (app, arm)
        grouped[scope].append((key, value))
    return grouped


def summarize(manifest, history, metadata):
    targets = metadata.get("targets", {})
    for item, target in targets.items():
        if type(target["step"]) is not int or target["step"] < 1:
            raise ValueError(f"invalid target step for {item}")
    results, excluded, invalid = read_cells(manifest, history, targets)
    units, unpaired = paired_units(results)
    healthy = [(key, cell) for (key, condition), cell in results.items() if condition == "healthy"]
    healthy_by_arm = by_scope(healthy)
    units_by_arm = by_scope(units.items())
    rates = metadata.get("rates_per_million", {})
    levels = metadata.get("levels", {"retention": 0.8, "false_alarms": 0.1, "source": "study fallback"})
    per_arm = []
    for app, arm in sorted({(cell["app"], cell["arm"]) for cell in manifest}):
        own_units = units_by_arm.get((app, arm), [])
        baseline = {key: units[key[:-1] + (BASELINE[app],)]
                    for key, _ in own_units if key[:-1] + (BASELINE[app],) in units}
        # Headline healthy cohorts use the phase on which bugs were also scheduled.
        group = [value for key, value in healthy_by_arm.get((app, arm), []) if key[4] != "pre"]
        alarm = healthy_metrics(group)
        if arm == BASELINE[app]:
            alarm = {"defined_as_zero": True}
        catches = catch_metrics(own_units, baseline)
        secondary = [cell for (key, _), cell in results.items() if key[0] == app and key[-1] == arm]
        causes = Counter(row["unresolved_cause"] for cell in secondary for row in cell["records"]
                         if row["unresolved_cause"] is not None)
        row = {
            "app": app, "arm": arm, "catch": catches, "false_alarms": alarm,
            "retention_missing_baseline": [key for key, _ in own_units if key not in baseline],
            "unresolved_by_cause": {cause: causes[cause] for cause in CAUSES},
            "detected_any_step": proportion(
                sum(unit["detected_any_step"] for _, unit in own_units), 3 * len(own_units)),
            "by_bug_kind": {
                kind: catch_metrics([(key, unit) for key, unit in own_units if (unit["bug_kind"] or "unspecified") == kind],
                                    {key: baseline[key] for key, unit in own_units
                                     if (unit["bug_kind"] or "unspecified") == kind and key in baseline})
                for kind in sorted({unit["bug_kind"] or "unspecified" for _, unit in own_units})
            },
        }
        # Use paired bug and healthy execution costs for per-catch accounting.
        costs = {}
        for mode in ("one_run", "best_of_3", "reliable"):
            count = 1 if mode == "one_run" else 3
            if own_units:
                total = total_cost(
                    (record for key, _ in own_units for condition in ("healthy", "bug")
                     for record in results[key, condition]["records"][:count]), rates.get(arm))
                costs[mode] = divide_cost(total, sum(unit[mode] for _, unit in own_units))
            else:
                costs[mode] = None
        row["cost_per_caught_bug"] = costs
        if arm in ("luna", "terra", "sol"):
            for mode in ("one_run", "best_of_3"):
                retention = catches[mode]["catch_retention"]
                alarms = alarm[f"{mode}_false_alarms"]["wilson95"]
                if app == "mdl" and len(own_units) < 20:
                    catches[mode]["verdict"] = None
                    catches[mode]["sensitivity"] = []
                    continue
                catches[mode]["verdict"] = verdict(retention["wilson95"], alarms,
                                                   levels["retention"], levels["false_alarms"])
                catches[mode]["sensitivity"] = [
                    {"retention": c, "false_alarms": f,
                     "verdict": verdict(retention["wilson95"], alarms, c, f)}
                    for c in sorted({0.7, 0.8, 0.9, levels["retention"]})
                    for f in sorted({0.05, 0.1, 0.15, levels["false_alarms"]})
                ]
        per_arm.append(row)

    suites = []
    complete_suites = by_scope(healthy, suite=True)
    planned_suites = by_scope(
        ((tuple(cell[field] for field in FIELDS[:-1]), cell)
         for cell in manifest if cell["condition"] == "healthy"), suite=True)
    for scope, planned in sorted(planned_suites.items()):
        app, version, change, phase, arm = scope
        suite = suite_metrics([cell for _, cell in planned],
                              [cell for _, cell in complete_suites.get(scope, ())], rates.get(arm))
        suites.append({"app": app, "version": version, "change": change, "phase": phase,
                       "arm": arm, **suite})
    return {
        "levels": levels, "by_app_arm": per_arm, "suites": suites,
        "gap": gaps(healthy, units),
        "maintenance": maintenance(metadata, suites),
        "replication_reason_match": reason_agreement(metadata.get("reason_ratings", {})),
        "moodle_history": moodle_history(metadata),
        "cells": [{**value["cell"], "outcomes": value["outcomes"],
                   "outcome_counts": dict(Counter(value["outcomes"])),
                   "attempts": [row["attempt"] for row in value["records"]]}
                  for value in results.values()],
        "paired_scenarios": [{**dict(zip(FIELDS[:-1], key)), **unit} for key, unit in units.items()],
        "excluded_cells": excluded, "unpaired_bug_cells": unpaired, "invalid_attempts": invalid,
    }


def gaps(healthy, units):
    grouped = by_scope(healthy, suite=True)
    output = []
    for (app, version, change, phase, arm), stale in grouped.items():
        if phase == "pre" or arm != STALE[app]:
            continue
        for agent in ("luna", "terra", "sol"):
            agents = dict(grouped.get((app, version, change, phase, agent), ()))
            shared = [(key, cell) for key, cell in stale if key[:-1] + (agent,) in units]
            agent_keys = [key[:-1] + (agent,) for key, _ in shared]
            agent_health = [agents[key] for key in agent_keys]
            own = [units[key] for key in agent_keys]
            stale_metrics = healthy_metrics([cell for _, cell in shared])
            agent_metrics = healthy_metrics(agent_health)
            for mode, field in (("one_run", "one_run_non_green"),
                                ("best_of_3", "best_of_3_non_green")):
                output.append({
                    "app": app, "version": version, "change": change, "agent": agent, "mode": mode,
                    "shared_scenarios": [key[2] for key, _ in shared],
                    "excluded_stale_scenarios": [key[2] for key, _ in stale
                                                 if key[:-1] + (agent,) not in units],
                    "stale_failures": stale_metrics[field],
                    "stale_per_run_false_alarms": stale_metrics["per_run_false_alarms"],
                    "agent_reliable_catch_rate": proportion(sum(unit["reliable"] for unit in own), len(own)),
                    "agent_false_alarms": agent_metrics[f"{mode}_false_alarms"],
                    "agent_catch_rate": proportion(sum(unit[mode] for unit in own), len(own)),
                })
    return output


def moodle_history(metadata):
    history = metadata.get("moodle_history")
    if history is None:
        return None
    return {**history, "suite_runs_per_interface_change": ratio(
        history["commits"], history["interface_changes"])}


def maintenance(metadata, suites):
    output = []
    for update in metadata.get("updates", []):
        lines = []
        for suite in suites:
            if (suite["app"], suite["version"]) != (update["app"], update["version"]):
                continue
            if suite["arm"] not in ("luna", "terra", "sol") or suite["cost"] is None:
                continue
            for mode, cost in suite["cost"].items():
                lines.append({
                    "arm": suite["arm"], "mode": mode,
                    "suite_runs_per_update": {
                        name: ratio(update[name], cost[name])
                        for name in ("tokens", "minutes", "dollars")
                        if update.get(name) is not None and cost.get(name) is not None
                    },
                })
        output.append({**update, "break_even": lines})
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, default=BENCH / "plan/plan.json")
    parser.add_argument("--ledger", type=Path, default=BENCH / "ledger")
    parser.add_argument("--metadata", type=Path)
    args = parser.parse_args()
    plan_bytes = args.plan.read_bytes()
    plan = json.loads(plan_bytes)
    if plan["reps"] != 3:
        parser.error("scoring requires exactly three planned repetitions")
    manifest = cells(plan)
    metadata_bytes = args.metadata.read_bytes() if args.metadata else None
    metadata = json.loads(metadata_bytes) if metadata_bytes else {}
    plan_hash = digest(plan_bytes)
    with locked(args.ledger):
        ledger = Ledger(args.ledger)
        ledger_hash = file_digest(ledger.path)
    ids = {item["id"]: item for item in plan["items"]}
    for item, attempts in ledger.history.items():
        if item not in ids:
            parser.error(f"ledger item outside the plan: {item}")
        for row in attempts:
            if (row["plan_id"], row["plan_sha256"], row["bug_id"], row["arm"]) != (
                plan["planId"], plan_hash, ids[item].get("bugId"), ids[item]["arm"]
            ):
                parser.error(f"ledger provenance disagrees with plan for {item}")
    try:
        report = summarize(manifest, ledger.history, metadata)
    except ValueError as error:
        parser.error(str(error))
    print(json.dumps({
        "ledger_sha256": ledger_hash, "ledger_head_sha256": ledger.head, "attempts": ledger.count,
        "plan_sha256": plan_hash,
        "metadata_sha256": digest(metadata_bytes) if metadata_bytes else None,
        **report,
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
