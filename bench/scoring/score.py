"""Mechanical scoring of complete cells from verified attempt histories."""
from collections import Counter
from math import sqrt
from statistics import NormalDist

from cells import FIELDS

BASELINE = {"pay": "sd-cur", "mdl": "sd-new"}
AGENTS = ("luna", "terra", "sol")
STALE = {"pay": "sd-stale", "mdl": "sd-old"}
CAUSES = ("budget_time", "budget_tools", "loop", "no_readable_answer")
TOKEN_FIELDS = ("input", "cached", "output")


def ratio(numerator, denominator):
    return numerator / denominator if denominator else None


def wilson(successes, total):
    if total == 0:
        return None
    z = NormalDist().inv_cdf(0.975)
    p = successes / total
    denominator = 1 + z**2 / total
    center = (p + z**2 / (2 * total)) / denominator
    margin = z * sqrt(p * (1 - p) / total + z**2 / (4 * total**2)) / denominator
    return [max(0, center - margin) if successes else 0.0,
            min(1, center + margin) if successes < total else 1.0]


def proportion(successes, total, *, interval=False):
    result = {"numerator": successes, "denominator": total, "rate": ratio(successes, total)}
    if interval:
        result["wilson95"] = wilson(successes, total)
    return result


def classify(record, condition, target=None):
    if not record["valid"]:
        return "invalid", None
    answer = record["agent_answer"] or record["coded_result"]
    state = answer["status"]
    step = answer["failed_step"]
    if target and step is None and target.get("text"):
        if answer["failed_step_text"] == target["text"]:
            step = target["step"]
    if state == "unresolved":
        return "unresolved", None
    if condition == "healthy":
        return ("correct" if state == "pass" else "false_alarm"), step
    if state == "pass":
        return "missed", step
    return ("caught" if step == target["step"] else "detected_elsewhere"), step


def cell_key(cell):
    return tuple(cell[field] for field in FIELDS[:-1])


def target_key(cell):
    return "/".join(str(cell[field]) for field in ("app", "version", "scenario"))


def read_cells(manifest, history, targets):
    results = {}
    excluded = []
    invalid = []
    for cell in manifest:
        condition = cell["condition"]
        target = None
        if condition == "bug":
            key = target_key(cell)
            frozen = targets.get(key)
            if frozen is None or frozen["bug_id"] != cell["bug_id"]:
                raise ValueError(f"no matching frozen target for {key} ({cell['bug_id']})")
            approach = "agent" if cell["arm"] in AGENTS else "coded"
            target = {**frozen[approach], "kind": frozen["kind"]}
        missing = []
        records = []
        for item in cell["items"]:
            attempts = history.get(item, ())
            valid = [row for row in attempts if row["valid"]]
            invalid.extend({"item_id": item, "attempt": row["attempt"],
                            "reason": row.get("invalid_reason")} for row in attempts if not row["valid"])
            if len(valid) > 1:
                raise ValueError(f"multiple valid attempts for {item}")
            if valid:
                records.append(valid[0])
            else:
                missing.append(item)
        reasons = []
        if missing:
            reasons.append("missing valid repetitions")
        if reasons:
            excluded.append({**cell, "missing_items": missing, "reasons": reasons})
            continue
        outcomes = [classify(record, condition, target)[0] for record in records]
        results[cell_key(cell), condition] = {
            "cell": cell, "records": records, "outcomes": outcomes, "target": target,
        }
    return results, excluded, invalid


def target_passed(record, target):
    outcome, step = classify(record, "healthy", target)
    return outcome == "correct" or (
        outcome == "false_alarm" and step is not None and step > target["step"]
    )


def paired_units(results):
    units = {}
    unpaired = []
    for (key, condition), bug in results.items():
        if condition != "bug":
            continue
        healthy = results.get((key, "healthy"))
        if healthy is None:
            unpaired.append({"cell": bug["cell"], "reason": "missing complete healthy counterpart"})
            continue
        caught = [outcome == "caught" for outcome in bug["outcomes"]]
        passed = [target_passed(row, bug["target"]) for row in healthy["records"]]
        units[key] = {
            "target_passes": sum(passed), "caught": sum(caught),
            "detected_any_step": sum(outcome in ("caught", "detected_elsewhere")
                                     for outcome in bug["outcomes"]),
            "one_run": caught[0] and passed[0],
            "best_of_3": any(caught) and any(passed),
            "reliable": sum(caught) >= 2 and sum(passed) >= 2,
            "bug_kind": bug["target"].get("kind"),
        }
    return units, unpaired


def healthy_metrics(group):
    outcomes = [cell["outcomes"] for cell in group]
    counts = Counter(outcome for series in outcomes for outcome in series)
    one = [series[0] for series in outcomes]
    causes = Counter(row["unresolved_cause"] for cell in group for row in cell["records"]
                     if row["unresolved_cause"] is not None)
    total = sum(counts.values())
    return {
        "per_run_false_alarms": proportion(total - counts["correct"], total),
        "one_run_false_alarms": proportion(len(one) - one.count("correct"), len(one), interval=True),
        "best_of_3_false_alarms": proportion(sum("correct" not in series for series in outcomes),
                                           len(one), interval=True),
        "per_run_unresolved": proportion(counts["unresolved"], total),
        "per_run_unresolved_by_cause": {cause: proportion(causes[cause], total) for cause in CAUSES},
    }


def catch_metrics(units, comparison):
    metrics = {}
    for mode in ("one_run", "best_of_3", "reliable"):
        retained = {key for key, unit in comparison.items() if unit[mode]}
        metrics[mode] = {
            "catch_rate": proportion(sum(unit[mode] for _, unit in units), len(units)),
            "catch_retention": proportion(
                sum(unit[mode] for key, unit in units if key in retained),
                len(retained), interval=True,
            ),
        }
    return metrics


def verdict(retention, alarms, catch_min, alarm_max):
    if retention is None or alarms is None:
        return "inconclusive"
    if retention[1] < catch_min or alarms[0] >= alarm_max:
        return "not good enough"
    if retention[0] >= catch_min and alarms[1] < alarm_max:
        return "good enough"
    return "inconclusive"


def total_cost(records, rates=None):
    records = list(records)
    cost = {"minutes": sum(row["minutes"] for row in records)}
    for field in TOKEN_FIELDS:
        values = [row["tokens"][field] for row in records]
        cost[field + "_tokens"] = sum(values) if values and None not in values else None
    cost["tokens"] = (cost["input_tokens"] + cost["output_tokens"]
                      if cost["input_tokens"] is not None and cost["output_tokens"] is not None else None)
    if rates is not None and cost["tokens"] is not None:
        cached = cost["cached_tokens"]
        cost["dollars"] = ((cost["input_tokens"] - cached) * rates["input"]
                           + cached * rates["cached"] + cost["output_tokens"] * rates["output"]) / 1e6
    return cost


def divide_cost(cost, denominator):
    return {key: ratio(value, denominator) if value is not None else None
            for key, value in cost.items()}


def reason_agreement(ratings):
    """Fleiss' kappa for separate, complete sets of three binary reason judgments."""
    counts = Counter()
    excluded = []
    agreement = 0
    for item, votes in ratings.items():
        if len(votes) != 3 or any(type(vote) is not bool for vote in votes):
            excluded.append(item)
            continue
        counts[sum(votes)] += 1
        agreement += 1 if len(set(votes)) == 1 else 1 / 3
    total = sum(counts.values())
    match_share = ratio(sum(yes * count for yes, count in counts.items()), 3 * total)
    kappa = None
    if match_share is not None:
        chance = match_share**2 + (1 - match_share)**2
        kappa = ratio(agreement / total - chance, 1 - chance)
    return {"items": total, "votes_for_match": dict(sorted(counts.items())),
            "majority_match": proportion(counts[2] + counts[3], total),
            "fleiss_kappa": kappa, "excluded": excluded}
