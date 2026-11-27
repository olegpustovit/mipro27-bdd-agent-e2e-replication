# /// script
# requires-python = ">=3.12"
# dependencies = ["statsmodels==0.14.6"]
# ///
"""Worked examples built from a temporary ledger with real P3 hashes."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest

from statsmodels.stats.proportion import proportion_confint

SCORING = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(SCORING), str(SCORING.parent / "runner")]
from ledger import Ledger, digest
from cells import cells
from report import load_targets, summarize
from score import (
    CAUSES, classify, healthy_metrics, paired_units, read_cells, reason_agreement,
    target_passed, verdict, wilson,
)


def record(status, step=None, text=None, cause=None, *, agent=True, valid=True):
    answer = {"status": status, "failed_step": step, "failed_step_text": text}
    return {
        "valid": valid, "invalid_reason": None if valid else "synthetic reset failure",
        "agent_answer": answer if agent else None, "coded_result": None if agent else answer,
        "unresolved_cause": cause, "minutes": 2,
        "tokens": {"input": 10, "cached": 4, "output": 2} if agent else
                  dict.fromkeys(("input", "cached", "output")),
    }


class ScoringTests(unittest.TestCase):
    def test_outcomes_and_step_matching(self):
        target = {"step": 2, "text": "Then visible"}
        cases = [
            ("healthy", record("pass"), "correct"),
            ("healthy", record("fail", 3), "false_alarm"),
            ("bug", record("pass"), "missed"),
            ("bug", record("fail", 2, agent=False), "caught"),
            ("bug", record("fail", text="Then visible"), "caught"),
            ("bug", record("fail", text="then visible"), "detected_elsewhere"),
            ("bug", record("fail", 1, "Then visible"), "detected_elsewhere"),
            ("bug", record("fail", valid=False), "invalid"),
        ]
        cases.extend((condition, record("unresolved", cause=cause), "unresolved")
                     for cause in CAUSES for condition in ("bug", "healthy"))
        for condition, row, outcome in cases:
            with self.subTest(condition=condition, row=row):
                self.assertEqual(classify(row, condition, target)[0], outcome)
        self.assertTrue(target_passed(record("fail", 3), target))
        self.assertFalse(target_passed(record("fail", 2), target))
        self.assertFalse(target_passed(record("fail", 1), target))
        self.assertFalse(target_passed(record("fail"), target))
        self.assertFalse(target_passed(record("unresolved", cause="loop"), target))

    def test_wilson_reference(self):
        cases = [(k, n) for n in (1, 2, 3, 10, 20, 60, 100) for k in range(n + 1)]
        for k, n in cases:
            with self.subTest(k=k, n=n):
                expected = proportion_confint(k, n, method="wilson")
                for actual, reference in zip(wilson(k, n), expected):
                    self.assertAlmostEqual(actual, reference, delta=1e-14)
        self.assertIsNone(wilson(0, 0))
        print(f"Wilson matched statsmodels on {len(cases)} cases, including 0/n and n/n")

    def test_verdict_and_rating_edges(self):
        self.assertEqual(verdict([0.8, 0.9], [0.01, 0.09], 0.8, 0.1), "good enough")
        self.assertEqual(verdict([0.8, 0.9], [0.1, 0.12], 0.8, 0.1), "not good enough")
        self.assertEqual(verdict([0.7, 0.8], [0.01, 0.1], 0.8, 0.1), "inconclusive")
        self.assertEqual(verdict(None, None, 0.8, 0.1), "inconclusive")
        self.assertIsNone(reason_agreement({"x": [True] * 3})["fleiss_kappa"])
        ratings = reason_agreement({"x": [True] * 3, "y": [False] * 3, "z": [False]})
        self.assertEqual(ratings["fleiss_kappa"], 1)
        self.assertEqual(ratings["excluded"], ["z"])

    def test_committed_manifest(self):
        rendered = subprocess.check_output(["uv", "run", str(SCORING / "cells.py")])
        self.assertEqual(rendered, (SCORING / "cells.json").read_bytes())
        manifest = json.loads(rendered)
        plan_items = json.loads((SCORING.parent / "plan" / "plan.json").read_text())["items"]
        expected_cells = {item["id"].rsplit(".", 1)[0] for item in plan_items}
        self.assertEqual(len(manifest), len(expected_cells))
        self.assertEqual({item for cell in manifest for item in cell["items"]}, {item["id"] for item in plan_items})

    def test_frozen_targets_and_p9_smoke(self):
        targets, pinned = load_targets()
        rendered = subprocess.check_output(["node", str(SCORING / "generate-targets.mjs")])
        self.assertEqual(hashlib.sha256(rendered).hexdigest(), pinned)
        bench = SCORING.parent
        wording = json.loads((bench / "scenarios/moodle/agent-wording.json").read_bytes())
        payment = set()
        moodle = set()
        for key, target in targets.items():
            app, version, scenario = key.split("/")
            coded, agent = (target[name] for name in ("coded", "agent"))
            with self.subTest(key=key):
                if app == "pay":
                    payment.add(scenario)
                    self.assertEqual(coded, agent)
                else:
                    moodle.add((version, scenario))
                    replacement = wording.get(scenario, {}).get("steps", {}).get(str(agent["step"]))
                    if replacement:
                        self.assertEqual(coded["text"], replacement["original"])
                        self.assertEqual(agent["text"], replacement["revised"])
                    else:
                        self.assertEqual(coded["text"], agent["text"])
        self.assertEqual(len(payment), 20)
        self.assertEqual(len(moodle), 18)
        print("Verified coded and agent target texts for 20 payment scenarios and 18 Moodle units")

        # Replay the documented P9 smoke answers as scoring inputs.
        text = 'Then I should see "Teacher One" in the "Logged in user" "block"'
        key = "mdl/B15-post/S091"
        self.assertEqual(targets[key]["coded"], {"step": 5, "text": text})
        self.assertEqual(targets[key]["agent"], {"step": 4, "text": text})
        plan = json.loads((bench / "plan/plan.json").read_bytes())
        smoke = [cell for cell in cells(plan)
                 if cell["version"] == "B15-post" and cell["scenario"] == "S091"
                 and cell["arm"] != "sd-old"]
        self.assertEqual({cell["arm"] for cell in smoke}, {"sd-new", "luna", "sol", "terra"})
        history = {}
        for cell in smoke:
            agent = cell["arm"] != "sd-new"
            if cell["condition"] == "bug":
                answer = record("fail", 4 if agent else 5, text, agent=agent)
            else:
                # A hypothetical healthy failure at 5 comes after the agent
                # target, but is exactly at the coded target.
                answer = record("fail", 5, agent=agent)
            for item in cell["items"]:
                history[item] = [{"attempt": 1, **answer}]
        results, excluded, _ = read_cells(smoke, history, targets)
        self.assertFalse(excluded)
        self.assertEqual([cell["outcomes"] for (_, condition), cell in results.items()
                          if condition == "bug"], [["caught"] * 3] * 4)
        units, _ = paired_units(results)
        for key, unit in units.items():
            self.assertEqual(unit["target_passes"], 0 if key[-1] == "sd-new" else 3)
        print("P9 S091 scored caught for sd-new and all three agent arms")

    def test_healthy_unresolved_counts_toward_best_of_three_false_alarm(self):
        metrics = healthy_metrics([{
            "outcomes": ["unresolved", "false_alarm", "unresolved"],
            "records": [record("unresolved", cause="loop"), record("fail", 1),
                        record("unresolved", cause="budget_time")],
        }])
        for mode in ("one_run", "best_of_3", "per_run"):
            self.assertEqual(metrics[f"{mode}_false_alarms"]["rate"], 1)
        self.assertEqual(metrics["per_run_unresolved"]["rate"], 2 / 3)
        self.assertEqual(metrics["per_run_unresolved_by_cause"]["loop"]["rate"], 1 / 3)

    def test_counts_cli_reads_pin_and_verified_ledger(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "attempts.jsonl"
            path.touch()
            report = json.loads(subprocess.check_output([str(SCORING / "counts"), "--ledger", str(root)]))
        self.assertEqual(report["targets_sha256"], load_targets()[1])
        self.assertEqual(report["ledger_sha256"], digest(b""))
        for row in report["payment_hold_out_by_arm"]:
            self.assertEqual(row["scenarios"], [f"hold-{i:02}" for i in range(1, 9)])
        self.assertEqual(len(report["payment_hold_out_by_arm"]), 5)

    def test_counts_on_synthetic_ledger(self):
        passed = record("pass")
        caught = record("fail", 2)
        elsewhere = record("fail", 1)
        examples = {
            ("a", "luna", "healthy"): [record("unresolved", cause="budget_time"), passed, passed],
            ("a", "luna", "bug"): [caught, caught, record("unresolved", cause="loop")],
            ("hold-01", "luna", "healthy"): [passed, caught, record("fail", 3)],
            ("hold-01", "luna", "bug"): [caught, elsewhere, passed],
            ("a", "sd-cur", "healthy"): [passed] * 3,
            ("a", "sd-cur", "bug"): [caught] * 3,
            ("hold-01", "sd-cur", "healthy"): [passed] * 3,
            ("hold-01", "sd-cur", "bug"): [elsewhere, caught, passed],
            ("a", "sd-stale", "healthy"): [elsewhere, passed, elsewhere],
            ("hold-01", "sd-stale", "healthy"): [passed] * 3,
            ("a", "terra", "healthy"): [passed, passed, None],
            ("a", "terra", "bug"): [caught] * 3,
            ("c", "terra", "healthy"): [None] * 3,
            ("c", "terra", "bug"): [None, None, record("fail", valid=False)],
        }
        targets = {
            f"pay/v1/{scenario}": {"agent": {"step": 2}, "coded": {"step": 2}, "kind": "recreated",
                                  "bug_id": None}
            for scenario in ("a", "hold-01", "c")
        }
        metadata = {
            "targets": {},  # Optional metadata has no influence on the targets.
            "levels": {"retention": 0.8, "false_alarms": 0.05},
            "updates": [{"app": "pay", "version": "v1", "minutes": 16, "tokens": 96}],
            "moodle_history": {"commits": 20, "interface_changes": 4},
        }
        plan = {"planId": "synthetic", "reps": 3, "items": []}
        pending = {}
        for (scenario, arm, condition), series in examples.items():
            for rep, row in enumerate(series, 1):
                item = f"{scenario}.{arm}.{condition}.r{rep}"
                plan["items"].append(dict(id=item, app="pay", version="v1", scenario=scenario,
                                          condition=condition, arm=arm, rep=rep))
                if row is not None:
                    pending[item] = row

        with TemporaryDirectory() as directory:
            root = Path(directory)
            plan_path = root / "plan.json"
            plan_path.write_text(json.dumps(plan))
            (root / "attempts.jsonl").touch()
            ledger = Ledger(root)
            for item, row in reversed(list(pending.items())):
                arm = item.split(".")[1]
                attempts = [row] if item != "a.luna.bug.r1" else [
                    record("fail", valid=False), row,
                ]
                for attempt_row in attempts:
                    attempt, raw = ledger.allocate(item)
                    ledger.append({
                        **attempt_row, "item_id": item, "attempt": attempt, "arm": arm,
                        "plan_id": "synthetic", "plan_sha256": digest(plan_path.read_bytes()),
                        "bug_id": None,
                    }, raw)
            verified = Ledger(root)
            report = summarize(cells(plan), verified.history, metadata, targets)
            expected_sha = hashlib.sha256(ledger.path.read_bytes()).hexdigest()
            ledger.path.write_bytes(ledger.path.read_bytes().replace(b'"minutes":2', b'"minutes":3', 1))
            with self.assertRaisesRegex(ValueError, "record hash or previous hash mismatch"):
                Ledger(root)

        luna = next(row for row in report["by_app_arm"] if row["arm"] == "luna")
        self.assertEqual(luna["catch"]["one_run"]["catch_rate"]["rate"], 0.5)
        self.assertEqual(luna["catch"]["one_run"]["catch_retention"]["rate"], 0)
        self.assertEqual(luna["catch"]["best_of_3"]["catch_rate"]["rate"], 1)
        self.assertEqual(luna["catch"]["reliable"]["catch_rate"]["rate"], 0.5)
        self.assertEqual(luna["catch"]["reliable"]["catch_retention"]["rate"], 1)
        self.assertEqual(luna["false_alarms"]["per_run_false_alarms"]["rate"], 0.5)
        self.assertEqual(luna["false_alarms"]["one_run_false_alarms"]["rate"], 0.5)
        self.assertEqual(luna["false_alarms"]["best_of_3_false_alarms"]["rate"], 0)
        self.assertEqual(luna["unresolved_by_cause"]["loop"], 1)
        self.assertEqual(luna["unresolved_by_cause"]["budget_time"], 1)
        self.assertEqual(luna["false_alarms"]["per_run_unresolved"]["rate"], 1 / 6)
        self.assertEqual(luna["catch"]["one_run"]["verdict"], "not good enough")
        hold = next(row for row in report["payment_hold_out_by_arm"] if row["arm"] == "luna")
        self.assertEqual(hold["scenarios"], ["hold-01"])
        self.assertEqual(hold["catch"]["one_run"]["catch_rate"]["rate"], 1)
        self.assertEqual(hold["catch"]["best_of_3"]["catch_retention"]["rate"], 1)
        self.assertEqual(hold["false_alarms"]["per_run_false_alarms"]["rate"], 2 / 3)
        self.assertEqual(luna["detected_any_step"]["rate"], 4 / 6)
        self.assertEqual(luna["cost_per_caught_bug"]["reliable"]["tokens"], 144)
        self.assertEqual(luna["cost_per_caught_bug"]["reliable"]["minutes"], 24)
        suite = next(row for row in report["suites"] if row["arm"] == "luna")
        self.assertFalse(suite["one_run"])
        self.assertTrue(suite["best_of_3"])
        self.assertEqual(suite["aligned_repetitions"]["rate"], 0)
        self.assertEqual(suite["cost"]["mean_per_run"]["tokens"], 24)
        gap = next(row for row in report["gap"] if row["agent"] == "luna" and row["mode"] == "one_run")
        self.assertEqual(gap["stale_failures"]["rate"], 0.5)
        self.assertEqual(gap["agent_catch_rate"]["rate"], 0.5)
        self.assertEqual(gap["agent_false_alarms"]["rate"], 0.5)
        update = next(row for row in report["maintenance"][0]["break_even"]
                      if row["arm"] == "luna" and row["mode"] == "mean_per_run")
        self.assertEqual(update["suite_runs_per_update"], {"minutes": 4, "tokens": 4})
        self.assertEqual(report["moodle_history"]["suite_runs_per_interface_change"], 5)
        self.assertEqual(len(report["invalid_attempts"]), 2)
        print(f"Synthetic counts reproduced by hand. Ledger SHA-256 {expected_sha}")

        missing = {(row["scenario"], row["condition"]): row for row in report["excluded_cells"]}
        self.assertEqual(missing["a", "healthy"]["missing_items"], ["a.terra.healthy.r3"])
        self.assertEqual(len(missing["c", "healthy"]["missing_items"]), 3)
        self.assertEqual(missing["c", "bug"]["reasons"], ["missing valid repetitions"])
        self.assertEqual(report["unpaired_bug_cells"][0]["cell"]["arm"], "terra")
        terra = next(row for row in report["by_app_arm"] if row["arm"] == "terra")
        self.assertIsNone(terra["catch"]["reliable"]["catch_rate"]["rate"])
        self.assertIsNone(terra["false_alarms"]["one_run_false_alarms"]["wilson95"])
        terra_suite = next(row for row in report["suites"] if row["arm"] == "terra")
        self.assertIsNone(terra_suite["aligned_repetitions"])
        self.assertEqual(terra_suite["missing_scenarios"], ["a", "c"])
        print("Listed 3 excluded cells, 1 unpaired bug cell, and an incomplete suite")


if __name__ == "__main__":
    unittest.main(verbosity=2)
