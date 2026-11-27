# Stream A1: trace audit of browser-agent failures (coder 1)

Status: post-hoc analysis, decided on 2026-11-26 after all runs. No new runs, no model calls and no changes to data.
The audited runs were made in `exploratory-owner-directed` mode without a gate pass (see `AGENTS.md`).
Repository commit: `9c9eee2` (v1.1.4). Tools: uv 0.13.5, Python 3.14 (via uv), Node v24.22.1, PyYAML 6.0.3.
Moodle scenario text comes from the pin checkout `cfe123f26fc7071981fe949cb16cd5a08a8234f1`.

## Question

When a browser agent reported a failure that the paper counts, does the recorded trace support its report?

## Files

| file | what it holds |
|---|---|
| `build_units.py`, `moodle_ui_steps.mjs` | Build `units.jsonl` from the recorded runs. The builder asserts that the units reproduce the paper's catch and false-alarm counts per run set. |
| `units.jsonl` | 386 units, no codes. |
| `coding-rule.md` | The coding rule, written before any unit was coded. |
| `units.SHA256SUMS` | Checksums of the four files above, taken when `UNITS_READY` was created. |
| `UNITS_READY` | Empty flag file for the second coder. |
| `codes-coder1.jsonl` | Coder 1's codes: one line per unit with code, evidence, pointer, confidence and note. |
| `results-coder1.txt` | Output of `summarize.py` for coder 1. |
| `trace_view.py`, `add_codes.py`, `summarize.py` | Coding aids and the summary. `trace_view.py` only reformats recorded traces and holds no codes. `add_codes.py` appends codes and copies quotes verbatim from the trace. `summarize.py` validates a codes file and prints the tables. |
| `coder2-work/` | The second coder's folder. Coder 1 did not open it. |

Reproduce from the repository root:

```sh
uv run followups-2026-11/a-trace-audit/build_units.py
uv run followups-2026-11/a-trace-audit/summarize.py
```

## Unit set

Every browser-agent run the count scripts score as not passing. Status `unresolved` counts as fail, as in the paper.

| run set | data | script |
|---|---|---|
| payment-app campaigns B, C, D (Luna, Terra, Haiku) | `data/campaigns/` | `scripts/counts/payment.py` |
| follow-up comparison (Haiku, Luna, Sonnet, Opus) | `experiment-4/` | `matched.py`; Opus units also record the verdict-parser v2 re-read status |
| E (Sol) and F (Opus via omp) | `moodle-ledger/runs/` | `followups.py`; F also records the re-read status |
| Moodle arm C, plan 6ac189f540b8 | `moodle-ledger/` | `moodle.py` |

Runs not in the unit set, following the paper's own rules:
- 24 Moodle setup-invalid runs that never reached the agent;
- the 72 runs of the first Sol campaign (e23c7f6), where the pinned model was absent;
- the discarded campaign A browser-agent runs (owner decision of 2026-11-18).

Healthy-build Opus units are coded on the original record. The paper's re-read view leaves 1 of the 8 follow-up-comparison units and 1 of the 2 F units failing.

The target step is defined as follows:
- payment app: the single `failedAssertion` shared by the step-definition faulty runs of the case (`verified.py`);
- Moodle: the pair's target step in `results/moodle-campaign.txt`.

No run has screenshots. No agent called `browser_take_screenshot`, so the evidence is the accessibility snapshots in the trace.

## How coder 1 coded

Coder 1 is the Claude agent that ran this stream. It read the agent trace of each unit: tool calls, results and agent messages.

It did not consult `adjudication.jsonl`, `second-grader.jsonl`, the clock-recovery grades, observer conclusions or the outcome classes in `results/`.

The observer's raw UI samples (`record.witness`) were used as supporting evidence in 2 units, X4-sonnet and X4-opus `healthy-v2-1/bank-delete`. Both units say so in their codes.

Systematic checks run during coding changed codes before they were final:
- **Save order.** The order of Save and fill in every profile-name trace was checked. It changed 2 faulty-build codes:
  - D `fault-v0-1/profile-name`: CORRECT → WRONG-REASON;
  - X4-haiku `fault-v2-1/profile-name`: CORRECT → UNCLEAR.
- **Observation after the action.** Every no-op fault (logout, delete, like) was checked for an observation after the faulted action. All were confirmed.
- **Depth-limited snapshots.** Five Moodle Luna and Haiku units were recoded before they were appended, because the snapshots were depth-limited or showed no submission.

Evidence strings were reworded afterwards for clarity. Their codes did not change.
