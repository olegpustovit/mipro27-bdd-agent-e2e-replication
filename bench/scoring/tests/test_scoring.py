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
from score import CAUSES, classify, reason_agreement, target_passed, verdict, wilson


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
        self.assertEqual(len(manifest), 663)
        self.assertEqual(len({item for cell in manifest for item in cell["items"]}), 1989)

    def test_counts_on_synthetic_ledger(self):
        passed = record("pass")
        caught = record("fail", 2)
        elsewhere = record("fail", 1)
        examples = {
            ("a", "luna", "healthy"): [elsewhere, passed, passed],
            ("a", "luna", "bug"): [caught, caught, record("unresolved", cause="loop")],
            ("b", "luna", "healthy"): [passed, caught, record("fail", 3)],
            ("b", "luna", "bug"): [caught, elsewhere, passed],
            ("a", "sd-cur", "healthy"): [passed] * 3,
            ("a", "sd-cur", "bug"): [caught] * 3,
            ("b", "sd-cur", "healthy"): [passed] * 3,
            ("b", "sd-cur", "bug"): [elsewhere, caught, passed],
            ("a", "sd-stale", "healthy"): [elsewhere, passed, elsewhere],
            ("b", "sd-stale", "healthy"): [passed] * 3,
            ("a", "terra", "healthy"): [passed, passed, None],
            ("a", "terra", "bug"): [caught] * 3,
            ("c", "terra", "healthy"): [None] * 3,
            ("c", "terra", "bug"): [None, None, record("fail", valid=False)],
        }
        metadata = {
            "targets": {
                "pay/v1/a": {"step": 2, "kind": "reverted"},
                "pay/v1/b": {"step": 2, "kind": "recreated"},
            },
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
            meta_path = root / "metadata.json"
            meta_path.write_text(json.dumps(metadata))
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
            command = [str(SCORING / "counts"), "--plan", str(plan_path),
                       "--ledger", str(root), "--metadata", str(meta_path)]
            report = json.loads(subprocess.check_output(command))
            expected_sha = hashlib.sha256(ledger.path.read_bytes()).hexdigest()
            self.assertEqual(report["ledger_sha256"], expected_sha)
            self.assertEqual(report["ledger_head_sha256"], ledger.head)
            ledger.path.write_bytes(ledger.path.read_bytes().replace(b'"minutes":2', b'"minutes":3', 1))
            corrupt = subprocess.run(command, capture_output=True, text=True)
            self.assertNotEqual(corrupt.returncode, 0)
            self.assertIn("record hash or previous hash mismatch", corrupt.stderr)

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
        self.assertIn("missing confirmed target", missing["c", "bug"]["reasons"])
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
