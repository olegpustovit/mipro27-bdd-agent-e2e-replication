# Stream D: replay of real Moodle interface changes

Status of every run: `exploratory-owner-directed`, `gatePassExists: false`. Post-hoc analysis (decided after the original Moodle campaign).

- `plan.md`: the plan (written before any measured run) with amendments A1 and A2 (also before any measured run).
- `feasibility/`: commits, scenario-text presence per commit, notes.
- `scripts/`: `build-golden.mjs` (golden Behat sites through the unchanged study adapter), `runtime.mjs` (second runtime for Moodle 4.0dev),
  `replay-run.mjs` (one ledger job per build x arm/model, study ledger and arm-C code unchanged), `run-plan.sh` and `run-plan-grouped.sh` (drivers),
  `count_replay.py` (counts, paper rules), `status.sh`, `scenario-presence.mjs`.
- `data/ledger/`: the measured trial ledger (`trials.jsonl`) and agent event blobs. `data/smoke-ledger/`: technical smoke checks (not measured).
  `data/patches/`: step-definition and fault patches with `SHA256SUMS`. `data/builds.jsonl`: golden builds.
- `logs/`: driver log (`run-plan.log`), one log per job.
- `results/`: count output.
- Tool versions: Codex CLI 0.169.0 and omp 18.20.2, as stated in `plan.md` and the report. They are not recorded in
  the per-trial records or event blobs (`results/report.md`, section 3).

## Operations log (UTC)

- 2026-11-26 21:27 start; 21:45 host restart (no runs had started; /tmp lost, brief restored by the coordinator).
- 21:50 plan.md written. 21:48-21:53 golden builds B04/B07/B15 (pin runtime). 21:55 amendment A1 (2021 changes, PHP 8.0 runtime, cap 95M).
- 22:00-22:10 golden builds of the 8 Moodle 4.0dev commits (PHP 8.0.30, Postgres 13.23). 22:13 amendment A2 (flags, cut order).
- 21:53-22:21 smoke checks (separate ledger): 4 Behat runs (B15 pre, B25 pre), 2 Luna runs on B15 pre (0.51M tokens).
- 22:21 measured driver `run-plan.sh all` started (one lock acquisition per job). First measured job started 22:54 (lock held by stream B until then).
- 2026-11-27 03:18 **scheduling change only** (coordinator approval, task t_ddd9c1f45dee036c): the waiting driver (pid 67380) and its waiting
  flock (job P4-B28-post-C-gpt-6-luna-r1, never started) were stopped; `run-plan-grouped.sh` continues the same remaining jobs in the same order,
  holding the shared lock per group (g1: rest of 2021 rep 1; g2: B28 rep 2 and faulty P5; g3: B25/B29 rep 2 and B25 faulty rep 2).
  No trial, order, rule, token guard or cut-off changed. Reason: per-job lock hand-offs to 30-40 min jobs of other streams would have taken ~20 h.
- 2026-11-27 06:48 all measured jobs done (256 trial records; no stops, exclusions or reruns). 06:50-06:54 post-hoc diagnostic: Behat on
  B28's fix commit 8662be1d (golden build on the 4.0dev runtime, 2 runs, `data/diagnostics.jsonl`). Report: `results/report.md`.
