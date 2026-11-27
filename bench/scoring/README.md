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
incomplete cells, bug cells without a confirmed target, and complete bug cells
without a complete healthy counterpart are listed. A suite estimate requires
every planned healthy scenario for that suite. Catch-retention denominators use
complete matched scenario units for the agent and the up-to-date baseline.

## Analysis conventions

- One run uses repetition 1 from each condition. Best of three gives a catch if
  any buggy repetition caught the bug and any healthy repetition passed the
  target. Reliability requires two repetitions in each condition. A healthy
  completion or a known failure strictly after the target shows that the target
  passed. An unresolved run cannot establish that the target passed.
- False alarms count explicit healthy failures. The report also gives
  operational non-green rates, which count unresolved runs as failures. For
  best of three, a scenario raises a false alarm when all three healthy runs
  explicitly fail. It is non-green when none passes. Wilson intervals use one
  binary observation per scenario/version or scenario/change in each mode.
  The three-repetition false-alarm fraction is descriptive. The up-to-date
  baseline's headline false-alarm figure is zero by the maintenance rule.
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

## Frozen scoring metadata

The optional JSON file supplies analysis inputs the ledger does not carry.
An empty metadata file can be represented by `{}`. Omitted targets keep the
associated bug cells out of scoring. Include a target only after the
independent check confirms it.

- `targets` maps `app/version/scenario` to an object with a positive 1-based
  `step`, optional exact `text` as returned by the adapter, and optional bug
  `kind`. The key shares the target across all arms for the same scenario unit.
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
