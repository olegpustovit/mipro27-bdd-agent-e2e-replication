# Stream E-pay: payment-app cells of the single set

Status: `exploratory-owner-directed`, `gatePassExists: false`. Run 2026-11-27 without a gate pass. The single set
was decided after the original campaigns, so it is post hoc. The plan, fixed before any measured run, is
`../plan.md`; it was followed without amendment.

## What was run

- **Cells.** The payment-app stages the single set still needed, per arm: healthy-v0-1, fault-v0-1, fault-v0-2,
  healthy-v2-1, healthy-v2-2, healthy-v2-3, fault-v2-1, fault-v2-2. That is 12 runs per stage, 96 per arm and 384 in total.
  The stage shapes are `harness/study/cumulative-plan.mjs` `cumulativeStages()` unchanged: the same trial ids and
  trial objects, `repairAllowed` false. The maintenance stages and the v1 stages are left out. The v1 cells
  (healthy-v1-1, fault-v1-1, fault-v1-2) are stream B's runs from 2026-11-26 (`../../b-change1-faults/`).
- **Campaigns.** Four campaigns, one per arm, run one after another, each under `flock /tmp/mipro-next/run.lock`.
  None was retried and no run was excluded.
  - Coded: campaign A's frozen step code, restored from `STUDY_RUNTIME_RERUN_FROM=campaign-20261101-04d8551`. No
    step-definition update session was run. v0 runs used implementation `b907e925…`. This equals the harness's
    `implementation()` default, the original step definitions, and campaign A's v0 (the `initial` of its v1
    maintenance-begin event and its 36 v0 runs). v2 runs used `e4daecf8…`, campaign A's frozen v2 (its v2
    `maintenance-record`, also used by its 60 v2 runs). Checked on every trial record: v0 36/36 `b907e925`, v2
    60/60 `e4daecf8`.
  - Luna (`gpt-6-luna`, Codex) and Terra (`gpt-5.6-terra`, Codex), both at medium effort, and Haiku
    (`claude-haiku-5-5`, omp, medium thinking). Driver defaults are the same as stream B's.
  - The prompt, 240 s / 60 s limits, 80 tool calls, sandbox, browser proxy, reload tool and verdict parser (v2) are
    the ones harness 9c9eee2 ships. No scenario, prompt or parser change was made.
  - Runner: `scripts/run-single-pay.mjs` is stream B's `run-v1-faults.mjs` with the changes marked FOLLOWUP-E:
    the stage list (from `scripts/single-pay-plan.mjs`), the stream label, and the names of its own hashed files.
    It keeps B's arm selection (`STUDY_ARMS`). Diffs: `data/run-single-pay-vs-b.diff` (against B's runner) and
    `data/run-single-pay.diff` (against `harness/scripts/exploratory-runner.mjs`). Recorded file hashes are in each
    journal's frozen inputs: `run-single-pay.mjs` `8be43e6a…`, `single-pay-plan.mjs` `89814085…`.
  - Launcher: `scripts/launch-campaigns.sh`, B's launcher with marked changes. Campaign ids are
    `campaign-h-20261127-single-{coded,luna,terra,haiku}`, order seeds `e-single-20261127-<arm>`, and the deadline
    is 2026-11-28T12:00:00Z. Before each agent campaign it checks the 70M token guard and a stop file.
    `scripts/token-guard.sh` ran beside it to stop an agent campaign after a finished trial once 70M was exceeded.
    It never triggered.
- **Data.** `data/campaigns/campaign-h-20261127-single-*/` holds trials and events (zstd) and the journal, in B's
  layout. `data/SHA256SUMS` hashes the decompressed files. The originals are in
  `~/.local/share/cucumber-study/runs/`. Logs: `logs/operations.log` (setup and incidents), `logs/campaigns.log`
  (lock waits, start and end), `logs/app.log` (payment app).
- **Counts.** `uv run scripts/count_pay.py` writes `results/counts.txt` and `counts.json`. It reuses
  `scripts/counts/common.py` (reading), `payment.py` (`paired_catches`) and `verified.py` (normalisation; the target
  check is derived as there). The v1 rows read stream B's packaged campaigns.

## Versions (verified before the runs and recorded in each journal's frozen inputs)

Host `<host>` (x86_64, WSL2). The replication harness is a git-ignored local copy of stream B's clone at
**9c9eee2** (`harness/`), clean apart from the untracked `upstream/` app, as in B. The app is at upstream 0729f68
with campaign A's pinned `backend/app.ts`. `appPins` and `sourcePins` are equal to those in stream B's frozen
inputs. Tool versions: Codex CLI 0.169.0, omp 18.20.2, Node v24.22.1, Playwright 1.65.0-alpha-2026-10-30,
@playwright/mcp 0.0.84, bubblewrap 0.9.0. Every agent run reported only the requested model (Luna 96/96
`gpt-6-luna`, Terra 96/96 `gpt-5.6-terra`, Haiku 96/96 `claude-haiku-5-5`), with `modelVerified` true for 288/288.

## Definitions (the paper's, as in stream B's README)

- A false alarm is a healthy run that does not pass. For agents, `unresolved` counts as not passing.
- A catch is a faulty run that does not pass. Unresolved runs are counted in the catches and also shown on their own.
- A paired catch is a catch whose healthy run of the same case, revision and repetition passes; with no such
  healthy repetition, repetition 1 is used. v0: both fault repetitions pair with healthy-v0-1. v2: fault rep r pairs
  with healthy-v2-r. **v1 in the single set: the partner is stream B's fresh healthy-v1-1 run** (the same campaign as
  the v1 faulty runs). It is not the 2026-11-01 run, which is B's primary partner.
- A verified catch has status `fail`, never `unresolved`, and its normalised failed assertion equals the case's
  target check. A verified paired catch is a verified catch whose partner passes.
- Coded arm on v1 (stream B's rule): faulty runs of scenarios whose step definitions do not pass healthy v1 cannot
  show a catch. They are reported separately and never counted as catches.

## Results (single set; v0 and v2 from this stream, v1 from stream B)

| arm | version | false alarms | catches | unresolved (in catches) | misses | paired catches | verified catches | verified paired |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| coded | v0 | 0/12 | 24/24 | – | 0 | 24/24 | 24/24 | 24/24 |
| coded | v1 | 7/12 | 10/10 on the 5 scenarios passing healthy v1 (+14 not eligible, all failed) | – | 0 | 10/24 | 10/10 | 10/24 |
| coded | v2 | 0/36 | 24/24 | – | 0 | 24/24 | 24/24 | 24/24 |
| Luna | v0 | 2/12 | 24/24 | 2 | 0 | 20/24 | 22/24 | 20/24 |
| Luna | v1 | 0/12 | 24/24 | 3 | 0 | 24/24 | 20/24 | 20/24 |
| Luna | v2 | 6/36 | 24/24 | 2 | 0 | 20/24 | 20/24 | 18/24 |
| Terra | v0 | 2/12 | 24/24 | 1 | 0 | 20/24 | 23/24 | 20/24 |
| Terra | v1 | 2/12 | 24/24 | 3 | 0 | 20/24 | 21/24 | 20/24 |
| Terra | v2 | 4/36 | 24/24 | 1 | 0 | 21/24 | 23/24 | 21/24 |
| Haiku | v0 | 3/12 | 24/24 | 2 | 0 | 18/24 | 22/24 | 17/24 |
| Haiku | v1 | 0/12 | 24/24 | 0 | 0 | 24/24 | 23/24 | 23/24 |
| Haiku | v2 | 9/36 | 24/24 | 3 | 0 | 18/24 | 21/24 | 16/24 |

Notes on the table:
- **No misses.** No faulty run passed in any arm or version.
- **False alarms by scenario** (healthy runs not passing; how many were unresolved).
  - Luna v0: social-comment, social-like (1 unresolved). Luna v2: social-comment 3, social-like 2, bank-delete 1
    (5 unresolved).
  - Terra v0: social-comment, social-like (both unresolved). Terra v2: social-comment 2, social-like 2 (all 4 unresolved).
  - Haiku v0: profile-name, social-comment, transfer-pay (1 unresolved). Haiku v2: profile-name 2, social-like 2,
    auth-logout, bank-create, bank-delete, social-comment, transfer-pay 1 each (4 unresolved).
  - Coded: none on v0 and v2. On v1, the same 7 scenarios as in stream B: bank-create, bank-delete, profile-email,
    profile-name, social-like, transfer-pay, transfer-request.
- **Unpaired agent catches** are mostly the social scenarios. They come from the partner false alarms above (e.g.
  Luna v0 social-comment and social-like, both repetitions). Haiku v0 also loses profile-name and transfer-pay
  (both repetitions), and Haiku v2 loses auth-logout, bank-create, bank-delete and profile-name rep 1.
- **Agent catches that are not verified.** These are unresolved runs (mostly social: the transaction could not be
  found), plus a few `fail` runs whose recorded failed assertion is an earlier check rather than the target check:
  Luna v2 profile-name rep 2 and transfer-pay rep 2. The per-fault lists are in `results/counts.txt`.
- **Verdict parser.** All statuses are from the parser shipped at 9c9eee2 (v2). No parser-v1 replay was made for
  these runs.

## Cost against the plan estimate (this stream's 96 runs per arm)

| arm | runs | agent tokens (M, input+output) | cached share of input | trial minutes | plan estimate | campaign elapsed (lock held) | lock wait |
|---|---:|---:|---:|---:|---|---:|---:|
| coded | 96 | – | – | 7.5 | 0, 10 min | 7.5 min | 1.1 min |
| Luna | 96 | 13.42 (96/96 runs with usage) | 0.848 | 46.2 | 11.0M, 61 min | 46.2 min | 2.7 min |
| Terra | 96 | 19.72 | 0.897 | 81.4 | 23.2M, 86 min | 81.5 min | 2.7 min |
| Haiku | 96 | 32.31 | 0.920 | 85.4 | 23.0M, 74 min | 85.5 min | 18.7 min |
| total | 384 | **65.45** | | 220.5 | 57.2M, 231 min | | |

The 70M token guard did not trigger (final total 65.45M). Haiku used 40% more tokens than estimated (32.31M
against 23.0M) and 15% more trial time. Luna used 22% more tokens than estimated, in less time. Including stream
B's v1 runs, single-set agent tokens are Luna 17.44M (131 of 132 runs with usage), Terra 28.43M and Haiku 40.95M.
All 384 runs finished at 05:51:33 UTC on 2026-11-27, well before the deadline.

## Limitations and what went wrong

- **One infrastructure-invalid run.** Luna fault-v2-1/auth-logout ended with the harness error "Previous private
  document has no acknowledged navigation barrier" (the observer's navigation check, after the agent's run). The
  model was verified and usage was recorded. The agent reported `fail` at "the sign-in page and URL are visible",
  which is the target check. Under the runner's rules it is kept and was not retried. As in the paper's rule
  (`payment.py` scores invalid coded runs by their runner verdict), it is scored by its reported status, so it
  counts as a verified catch. Without it, Luna v2 would have 23/23 catches and 19/23 verified catches.
- **Retries.** The harness made no retries: `runnerRetries` is 0 on all 288 agent runs, there was no
  trial-interrupted record and no attempt > 1. Six browser-tool transport failures (MCP `ECONNRESET`, "retryable:
  no") were reported to the Haiku agent inside 5 runs. Neither the harness nor the driver retried them; the agent
  saw the error and carried on. The runs are fault-v0-1/transfer-pay (fail), healthy-v2-1/transfer-pay (pass),
  healthy-v2-1/bank-create (unresolved, a false alarm), healthy-v2-3/social-comment (2 failures; unresolved, a false
  alarm) and fault-v2-2/auth-login (fail). Stream B's Haiku campaign had 2 such failures (healthy-v1-1 bank-create
  and bank-delete). Luna and Terra had none. `count_pay.py` lists them per trial.
- **Same setup, different day.** These runs used stream B's host, harness and tool versions, one day later
  (2026-11-27 against 2026-11-26). Hosted models may still have changed in between; the reported model ids are
  the same.
- **Pairing for v1** uses stream B's fresh healthy-v1-1 run (one repetition, as in the original design). With B's
  primary 2026-11-01 partner the v1 paired catches would be lower for Luna and Haiku (20/24 each; see B's README).
- **No LLM grading.** "Verified" is the mechanical target-check rule only. No "stopped before fault" grading was
  done for these runs.
- **Lock sharing.** Stream D held the run lock between campaigns (lock waits above). The runs did not overlap with
  its runs.
- **App.** The payment app was started from this stream's harness copy before the first campaign (01:45 UTC) and
  stopped after the last (05:58 UTC). The harness restored all written source files: `git status` afterwards showed
  only campaign A's pinned `backend/app.ts`. No study locks were left behind.
- **Home-directory paths.** The raw files keep the home-directory path. Redact it to `<home>` at release, as done
  for the existing package.
- **Harness location.** `harness/` is a git-ignored copy and not part of the deliverable.
