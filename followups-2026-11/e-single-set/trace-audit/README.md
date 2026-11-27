# Stream E trace audit: units for the single set (preparation only)

Status: post-hoc analysis, decided 2026-11-27 after the single-set runs. The audited runs are `exploratory-owner-directed`
without a gate pass. No new runs, no model calls, no changes to data. **This folder holds no codes.** The person who
prepared it does not code.

Added at release v1.2.0: the sentence above describes the folder when it was prepared. Three coders then coded every
unit (363 lines in each `coderN-work/codes-coderN.jsonl`); see "Coders". Agreement and consensus are in
`results/agreement-consensus.txt`.

## Question and rule

The question is A1's: when a browser agent reported a failure that the single-set counts score, does the recorded
trace support its report? The rule is `coding-rule.md`, copied unchanged from `../../a-trace-audit/coding-rule.md`
(sha256 `74ddf5aa50ce598b8ae6149540d0effe88647b9fbadd3ef72d87fba7d2247035`, identical). Its text names A1's unit count
(386) and campaigns; those sentences describe A1's set, not this one (see each `coderN-work/CODER.md`).

## Unit set

Every browser-agent run that the single-set count scripts score as not passing. `unresolved` counts as fail.
Faulty-build units are counted catches; healthy-build units are counted false alarms.

| app | run sets | data | count script |
|---|---|---|---|
| payment | Luna, Terra, Haiku; v0 and v2 | `../pay/data/campaigns/campaign-h-20261127-single-{luna,terra,haiku}` | `../pay/scripts/count_pay.py` |
| payment | Luna, Terra, Haiku; v1 (healthy-v1-1 = B's fresh partner, fault-v1-1/2) | `../../b-change1-faults/data/campaigns/campaign-g-20261126-v1faults-{luna,terra,haiku}` | same |
| Moodle | arm C, Luna, Terra, Haiku; 14 cases x {healthy, faulty} x 2 | `../moodle/data/ledger` (first trial-end per key; harness-exception records excluded, as in the count script) | `../moodle/scripts/count_moodle.py` |

Not in the set: the coded arms (no agent trace), and runs scored `pass`.

Target step (faulty units only), as in A1:
- payment: the single `failedAssertion` shared by campaign A's step-definition faulty runs of the case (`scripts/counts/verified.py`);
- Moodle: the pair's target step in `results/moodle-campaign.txt`. The builder also asserts that it equals the
  `targetStepIndex` the E-moodle runner resolved for each trial.

Units hold no automated grade, no verdict-rule output beyond the agent's reported status, and no earlier codes. A1's
`reported_equals_target_text` (payment) and `reported_failing_step_verified` / `reported_failing_step_behat_index`
(Moodle; verdict-parser step check) are not written. The re-read and clock-recovery fields do not apply and are not
written either. The mechanical step position stays (`reported_failing_step_number` against `target_step_numbers`). No
run has screenshots.

## Coders

| coder | session | model | effort |
|---|---|---|---|
| 1 | Claude Code | Claude Opus 5.5 | high |
| 2 | Claude Code | Claude Opus 5.5 | high |
| 3 | Codex CLI | gpt-6.2-sol | high |

Each coder was a fresh session, started by the coordinating session on 2026-11-27 at about 09:51 UTC. Its
instructions are the `CODER.md` in its folder. They forbid opening the other coders' folders, earlier codes, count
outputs and results, automated grades and verdict-rule outputs, grader files, the paper and Research Foundry. The
session identities, models and start time come from the coordinating session; the coder folders do not record them.

Blindness exposures, as the coders reported them to the coordinating session (none of the coder folders holds a note
on this):
- Coder 1 and coder 2 each saw one record's `failedAssertionVerified` field while listing a record's fields, and did
  not use it.
- No exposure is recorded for coder 3.

## Files

| file | what it holds |
|---|---|
| `build_units.py` | Copy of A1's builder with changes marked `FOLLOWUP-E-TA` (`diffs/build_units.py.diff`). It asserts that the units reproduce the count scripts' catch and false-alarm counts. |
| `moodle_ui_steps.mjs` | A1's helper; only the import paths changed. |
| `trace_view.py`, `add_codes.py`, `summarize.py`, `agreement/` | A1's coding aids, summary and agreement scripts, with paths for three coders (`diffs/`). `add_codes.py --coder N` writes `coderN-work/codes-coderN.jsonl` and refuses to run before `UNITS_READY`. |
| `coding-rule.md` | The rule, unchanged. |
| `units.jsonl` | The units. |
| `units.SHA256SUMS`, `UNITS_READY` | Written when the Moodle units are in. |
| `coder1-work/`, `coder2-work/`, `coder3-work/` | One folder per coder, each with `CODER.md`. |

Rebuild from the repository root (tools: uv 0.13.5, Python 3.14 via uv, Node v24.22.1, PyYAML 6.0.3; Moodle text
from the pin checkout `cfe123f26fc7071981fe949cb16cd5a08a8234f1`):

```sh
uv run followups-2026-11/e-single-set/trace-audit/build_units.py --moodle-expected '<from E-moodle README>'
uv run followups-2026-11/e-single-set/trace-audit/summarize.py
```

## Reproduction check

Payment (built 2026-11-27 ~06:00 UTC). For each arm and revision, faulty units equal the catches and healthy units equal
the false alarms. Three sources agree: `count_pay.py`'s own functions, the frozen `../pay/results/counts.json`, and
the table in `../pay/README.md`.

| arm | v0 faulty / healthy | v1 faulty / healthy | v2 faulty / healthy | units (of which unresolved) |
|---|---|---|---|---|
| Luna | 24 / 2 | 24 / 0 | 24 / 6 | 72 faulty (7) + 8 healthy (6) |
| Terra | 24 / 2 | 24 / 2 | 24 / 4 | 72 faulty (5) + 8 healthy (8) |
| Haiku | 24 / 3 | 24 / 0 | 24 / 9 | 72 faulty (5) + 12 healthy (5) |
| total | | | | 216 faulty + 28 healthy = 244 |

Moodle (built 2026-11-27 after E-moodle's run plan logged DONE at 09:47:27 UTC and its README existed). Per model, faulty
units equal the catches and healthy units equal the false alarms. Two sources agree: `count_moodle.py`'s own `load()`,
`status()` and `summary()` on `../moodle/data/ledger`, and the values in `../moodle/README.md` (passed as
`--moodle-expected 'Luna=25,23;Terra=26,7;Haiku=27,11'`). The ledger holds 200 trial-ends (32 arm A, 168 arm C). It has
no key with a second attempt and no harness-exception record, so 0 runs were excluded. All 119 trace blobs are present.
For every faulty unit, the runner's `targetStepIndex` equals the frozen pair target.

| model | faulty units (unresolved) | healthy units (unresolved) | records |
|---|---|---|---|
| Luna | 25 of 28 (4) | 23 of 28 (2) | 56 |
| Terra | 26 of 28 (4) | 7 of 28 (3) | 56 |
| Haiku | 27 of 28 (4) | 11 of 28 (5) | 56 |
| total | 78 | 41 | 168 |

All units: 244 payment + 119 Moodle = **363** (294 faulty, 69 healthy; 29 unresolved in each). The 244 payment lines
are byte-identical to the payment-only build. `units.SHA256SUMS` covers the unit file, the rule and the scripts the
coders use. `UNITS_READY` was then created.
