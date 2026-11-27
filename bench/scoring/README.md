# Plan 1 scoring

Run from the repository root.

```sh
uv run bench/scoring/cells.py > bench/scoring/cells.json
bench/scoring/counts --plan bench/plan/plan.json --ledger bench/ledger --metadata /path/to/frozen-scoring.json
make -C bench test-p3b
```

The manifest groups the plan's run items by app, version, scenario, change, phase,
arm and condition. Item IDs appear in repetition order. Counts verifies the
P3 chain and all raw artifact hashes, checks plan provenance, and emits JSON.
The report includes the exact SHA-256 of the ledger bytes read and the chain head.
Only the sole valid attempt for each item enters scoring. Invalid attempts,
incomplete cells, and complete bug cells without a complete healthy counterpart
are listed. Counts requires a frozen target for each planned bug cell. A suite estimate requires
every planned healthy scenario for that suite. Catch-retention denominators use
complete matched scenario units for the agent and the up-to-date baseline.

## Analysis conventions

- One run uses repetition 1 from each condition. Best of three gives a catch if
  any buggy repetition caught the bug and any healthy repetition passed the
  target. Reliability requires two repetitions in each condition. A healthy
  completion or a known failure strictly after the target shows that the target
  passed. An unresolved run cannot establish that the target passed.
- Healthy failures and unresolved runs both count toward the headline false-alarm
  rates and verdict. For best of three, a scenario raises a false alarm when
  none of its three healthy runs passes. The report also gives the per-run
  unresolved share and its breakdown by cause. Wilson intervals use one binary
  observation per scenario/version or scenario/change in each mode. The
  three-repetition false-alarm fraction is descriptive. The up-to-date baseline's
  headline false-alarm figure is zero by the maintenance rule.
- `payment_hold_out_by_arm` gives catch rate, catch retention and false alarms
  for the eight `hold-*` payment scenarios. Retention uses matched baseline
  units within that subset.
- Per-suite all-green chance is the empirical share of aligned repetitions
  where every planned healthy scenario passes. Best-of-three suite success
  allows a passing repetition per scenario. Gap comparisons use the same
  complete scenario units for the stale and agent figures.
- Minutes sum the recorded execution durations. Tokens sum input and output,
  with cached tokens included in input. Suite costs use the healthy cohort.
  Cost per caught bug includes both conditions and divides by the number of
  successful paired units in the selected mode. Best of three is budgeted as
  three executions. Break-even divides an update session's cost by the agent
  suite cost in each available unit.
- Empty denominators produce JSON null. The fallback verdict levels are 80%
  retention and 10% false alarms until the P0b levels are supplied. A Moodle
  verdict requires at least 20 scored paired scenario units.

## Frozen targets

`bench/plan/targets.json` records the bug ID and the 1-based target step and
exact text for each approach, keyed by app, version and scenario. Coded Moodle
numbering uses the Scenario body. Agent Moodle numbering includes Background UI
steps, omits data steps and uses the prepared prompt wording. Each approach's
numbering applies both to bug catches and to whether a healthy run passed the
target.

Before freezing the plan, generate the table with
`node bench/scoring/generate-targets.mjs`. It checks the plan and bug symptoms
against the runner's scenario inputs and reuses the admission gate's formal P7
checks. Commit the output to `bench/plan/targets.json` and record its SHA-256 in
`bench/env.lock.json` under `targetsSha256`. Counts verifies the pin and includes
it in the report.

## Optional scoring metadata

The optional JSON file supplies analysis inputs absent from the ledger. An
empty metadata file can be represented by `{}`.

- `levels` carries `retention`, `false_alarms`, and a `source` for P0b.
- `rates_per_million` maps arm IDs to dollar rates for `input` (uncached),
  `cached` and `output`. Supply frozen rates to include dollar break-even.
- `updates` lists maintenance sessions with `app`, `version`, any available
  `tokens`, `minutes` and `dollars`, and recorded code-change and session fields.
  The report preserves those fields.
- `moodle_history` carries `commits` and `interface_changes` from the history
  census to compute suite runs per interface change.
- `reason_ratings` optionally maps independently blinded rating IDs to three
  boolean votes. The separate replication result reports majority match and
  Fleiss' kappa.
