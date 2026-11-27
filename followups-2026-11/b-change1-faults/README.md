# Stream B: seeded faults on the change-1 (v1) interface of the payment app

Status: `exploratory-owner-directed`, `gatePassExists: false`. Run 2026-11-26 without a gate pass. This whole
follow-up was decided after the original campaigns, so it is post-hoc. The healthy-v1 check runs and the split of
the coded arm by healthy-v1 outcome were also decided post-hoc (see below).

## What was run

- **Fault port.** No new fault code. The harness already builds a faulty change-1 interface:
  `harness/scripts/ui-revisions.mjs` `revisionSources(case, 'v1', {fault: true})` applies the same fault spec
  (`scripts/mutations.mjs` `faults`) before the v1 copy and hook changes, exactly as it does for v2. All 12 faults ported.
  None had to be left out.
  - Static check (`scripts/verify-v1-fault-builds.mjs`, `data/fault-build-static-check.jsonl`). On v0, v1 and v2,
    each faulty build differs from its healthy build only in the fault's file, by exactly the fault edit, and parses
    as TSX. Result: 36/36 checks pass.
  - Behaviour check: the same model-free calibration used for the revisions (`harness/scripts/calibration-capture.mjs
    --revision <r> --conditions reference,fault`), with the private, fully correct step bindings for that revision.
    These bindings are not the measured coded suite. Output is in `data/calibration-v{0,1,2}.jsonl`, summarised in
    `results/calibration-targets.txt`. v1: healthy builds pass 12/12, faulty builds fail 12/12, and the failure is
    at the fault's target check 12/12. v0 and v2 were rerun as a control, with the same 12/12/12 result.
- **Campaigns.** Four campaigns, one per arm, run one after another under `flock /tmp/mipro-next/run.lock`. Each has
  three stages: healthy-v1-1 (a post-hoc check), fault-v1-1 and fault-v1-2. That makes 36 runs per arm and 144 in total.
  None were retried and none were excluded.
  - Coded: campaign A's frozen v1 step definitions, implementation `1e4d5280…`. This is the candidate left when the
    v1 update session ended, with 2 accepted edits, restored from A's events. No update session was run.
  - Luna (`gpt-6-luna`, Codex) and Terra (`gpt-5.6-terra`, Codex), both at medium effort, and Haiku
    (`claude-haiku-5-5`, omp, medium thinking).
  - The prompt, 240 s / 60 s limits, 80 tool calls, sandbox, browser proxy and reload tool are the same as in
    campaigns B–D. The faulty design matches v0 and v2: 12 faults × 2 repetitions.
  - Runner: `scripts/run-v1-faults.mjs` is `exploratory-runner.mjs` with three marked changes, diffed in
    `data/run-v1-faults.diff`: the stage list, arm selection, and recording its own hash. Plan:
    `scripts/v1-fault-plan.mjs`. Launcher: `scripts/launch-campaigns.sh`. Order seed `b-change1-20261126-<arm>`.
- **Data.** `data/campaigns/campaign-g-20261126-v1faults-{coded,luna,terra,haiku}/` holds trials and events (zstd)
  and the journal, in the `data/campaigns/` layout. `data/SHA256SUMS` hashes the decompressed files. The originals
  are in `~/.local/share/cucumber-study/runs/`.
- **Counts.** `uv run scripts/count_v1_faults.py` writes `results/counts.txt` and `counts.json`. It reuses
  `scripts/counts/common.py`, `payment.py` (status rule, paired-catch rule) and `verified.py` (normalisation and
  target check), plus `verdict_parser.py` for a parser-v1 replay. The cost estimate made before any measured run is
  in `results/estimate.md`.

## Definitions (the paper's)

- A catch is a faulty run that does not pass; for agents, `unresolved` counts as not passing.
- A paired catch is a catch whose healthy run of the same case and revision passes. v1 has one healthy repetition,
  so both fault repetitions pair with healthy-v1-1. The partner is the **recorded 2026-11-01 healthy-v1-1 run of the
  same arm** (A for coded, B/C/D for the agents). The fresh healthy-v1 run from this follow-up is a post-hoc
  sensitivity check only.
- A verified catch has status `fail`, never `unresolved`, and its normalised failed assertion equals the case's
  target check. A verified paired catch is a verified catch whose partner passes.
- Coded arm: 7 of its 12 scenarios do not pass the healthy v1 build: bank-create, bank-delete, profile-email,
  profile-name, social-like, transfer-pay and transfer-request. That was so in the recorded run and again in the
  fresh run. Faulty runs of these scenarios cannot show a catch, so they are reported separately and never counted
  as catches.

## Results (v1 faulty builds; 12 faults × 2 repetitions per arm)

| | coded (partly updated) | Luna | Terra | Haiku |
|---|---:|---:|---:|---:|
| faulty runs | 24 | 24 | 24 | 24 |
| catches | 10/10 on the 5 scenarios passing healthy v1 | 24/24 | 24/24 | 24/24 |
| faulty runs on scenarios failing healthy v1 (not catches) | 14 (all 14 failed) | – | – | – |
| misses (faulty run passed) | 0 | 0 | 0 | 0 |
| unresolved (included in catches) | 0 | 3 | 3 | 0 |
| paired catches | 10/24 | 20/24 | 20/24 | 20/24 |
| verified catches | 10/10 (eligible scenarios) | 20/24 | 21/24 | 23/24 |
| verified paired catches | 10/24 | 18/24 | 20/24 | 20/24 |
| infrastructure-invalid runs (of 36) | 0 | 0 | 0 | 0 |
| tokens, all 36 runs (M, input+output) | – | 4.01 (35 runs; 1 unknown) | 8.70 | 8.63 |
| trial minutes, all 36 runs | 3.7 | 23.0 | 32.3 | 27.6 |
| post-hoc fresh healthy v1 not passing | 7/12 (the same 7) | 0/12 | 2/12 (social) | 0/12 |
| post-hoc paired catches against the fresh partner | 10/24 | 24/24 | 20/24 | 24/24 |
| post-hoc verified paired catches against the fresh partner | 10/24 | 20/24 | 20/24 | 23/24 |

Notes on the table:
- **Agents' 4 unpaired runs.** For every agent, these are the social-like and social-comment runs. The recorded
  2026-11-01 healthy-v1 run of both social scenarios failed for all three agents.
- **Agent runs that are not verified catches.**
  - Luna: social-like rep 1 and rep 2 were unresolved (the transaction could not be found in the feed).
    bank-delete rep 1 was unresolved after hitting the 240 s limit; no usage was recorded, so its tokens are
    unknown. transfer-request rep 2 failed at "a confirmation heading shows 'Study request'", which is an earlier
    check the fault also breaks, but not the target check.
  - Terra: social-like rep 1 and rep 2, and social-comment rep 1, were unresolved (transaction not found).
  - Haiku: social-comment rep 1 failed at the sign-in check "the authenticated home identifies 'Heath93'", before
    reaching the fault.
- **Coded arm, the 14 runs that are not catches.** All failed, and each failed at the same step as its healthy v1
  run.
  - 8 failed at an action step, before any assertion: bank-create, bank-delete, transfer-pay and transfer-request.
  - 2 failed at a precondition assertion, "the displayed like count is a number": social-like.
  - 4 failed at the target check: profile-name and profile-email. But the healthy v1 runs of those two scenarios
    also fail at that same target check, so these failures carry no information about the fault.
- **Verdict parser.** Recorded statuses use the current parser v2. Replaying parser v1 on every raw response
  changes 0 of the 108 agent statuses (all 108 replayed).
- **Cost against the estimate.** Agent tokens totalled 21.34M across all 108 agent runs, against an estimate of
  26.22M. The faulty runs alone used 14.77M, against an estimate of 17.48M. Elapsed time per campaign, start to end:
  coded 3.7 min, Luna 23.7, Terra 33.7, Haiku 29.4.

## Limitations and what went wrong

- **Different host and tool versions.** The original ran on host `main` (aarch64) with Codex CLI 0.159.3 and
  omp 18.14.0, at commits 02f4758, f7857ea and 2b2589f. This follow-up ran on host `<host>` (x86_64, WSL2) with
  Codex CLI 0.169.0 and omp 18.20.2, from the replication harness at 9c9eee2. Since campaigns B–D, 21 pinned source
  files changed: driver plumbing, lock location, origin hooks and verdict parser v2. The agent prompt text is
  unchanged. Node v24.22.1, Playwright 1.65.0-alpha-2026-10-30, @playwright/mcp 0.0.84, bubblewrap 0.9.0. The app
  is at upstream 0729f68 and its pinned files equal campaign A's. Hosted models may also have changed since
  2026-11-01.
- **Pairing across dates.** The pairing partners are healthy runs from 2026-11-01, under the older versions above.
  The fresh healthy-v1 check differs for Luna and Haiku: their social scenarios passed this time but failed in the
  recorded run. With the fresh partner, their paired catches would be 24/24. The paper's rule uses the recorded
  partner, which gives 20/24.
- **Repetitions.** There is one healthy-v1 repetition per arm, as in the original design, against two faulty
  repetitions.
- **No LLM grading.** The new runs have no first-grader adjudication, unlike campaigns A–D's `adjudication.jsonl`.
  "Verified" here is the mechanical target-check rule only. Not done: "stopped before fault" grader counts.
- **Host restart.** The host restarted at about 21:45 UTC during the first calibration cell, before any measured
  run. The harness-written app source files were restored with `git checkout`, and the stale locks were removed.
  The calibration then reran from the start. A stale app lock from 2026-11-18 was also removed before the first
  app start. All of this is logged in `data/logs/operations.log`.
- **First app start failed.** It hit the harness's 30 s readiness limit, under memory pressure at the time. After
  pre-bundling Vite dependencies it started.
- **Lock sharing.** Stream D held the run lock between the coded and Luna campaigns. The runs did not overlap.
- **Home-directory paths.** The raw files keep the home-directory path. Redact it to `<home>` at release, as done
  for the existing package.
- **Harness location.** `harness/` is a local clone of the replication repo at 9c9eee2, with node_modules and the
  pinned app copied in. It is git-ignored and not part of the deliverable.
