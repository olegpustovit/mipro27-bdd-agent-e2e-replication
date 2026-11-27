# Stream E-moodle: the Moodle campaign cells rerun on the single-set setup

Status of every run: `exploratory-owner-directed`, `gatePassExists: false` (run without a gate pass). Decided after the original
Moodle campaign (plan 6ac189f540b8, 16 Nov): **post hoc**. Plan: `../plan.md` ("Moodle"); no amendment was needed.
Measured runs 2026-11-27 06:16–09:47 UTC, started after stream E-pay's `pay/README.md` appeared (05:54 UTC).

## What ran

The 16 Nov Moodle campaign's arms A and C, the same 16 pairs, the same harness code, on the setup of streams B and D. Arm B
(LLM-updated old step definitions) was not run.

| arm | design | planned | recorded | excluded |
|---|---|---:|---:|---:|
| A, developers' current step definitions (Behat) | 16 cases x {healthy, faulty} x 1 | 32 | 32 (16 healthy, 16 faulty) | 0 |
| C, Luna `gpt-6-luna` (Codex, medium) | 14 cases x {healthy, faulty} x 2 | 56 | 56 (14 per state x rep) | 0 |
| C, Terra `gpt-5.6-terra` (Codex, medium) | same | 56 | 56 (14 per state x rep) | 0 |
| C, Haiku `claude-haiku-5-5` (omp, medium thinking) | same | 56 | 56 (14 per state x rep) | 0 |

The 14 agent cases are the 16 campaign cases without B07.S025 and B27.S131. The agents never reached those two in the campaign
(setup exclusion: "Scenario has no leading data steps"), so they were not scheduled for arm C here. Arm A runs all 16.

- 200 trials, each with one attempt. There were no interrupted attempts, no harness exceptions and no setup exclusions.
  The token cap, deadline and omp cost guards never stopped the schedule.
- All 168 agent runs passed the sandbox self-check and were pre-authenticated. None had a CLI timeout, a provider error, a
  non-zero CLI exit or a fatal infrastructure event.
- Arm A: 16 healthy runs passed and 16 faulty runs failed.

## Versions (recorded in every trial record, identical across all 200)

Host `<host>` (x86_64, WSL2). Replication harness at 9c9eee2478ca (tracked tree clean). Codex CLI 0.169.0, omp 18.20.2,
Node v24.22.1, bubblewrap 0.9.0, Playwright 1.65.0-alpha-2026-10-30, @playwright/mcp 0.0.84. Moodle at the campaign pin
`cfe123f26fc7071981fe949cb16cd5a08a8234f1` (5.3.1, Build 20261112), PHP 8.3.36, PostgreSQL 17.12, Selenium Chrome 157.0.8103.38.
Images, moodle-docker and composer are as pinned in `docker/moodle/versions.json`, with golden site `cfe123f26fc7-1b7bccec5d`.
Worker `w2` is a pin worker of this host; stream D's worker `w1` was not used.

Differences from the 16 Nov campaign: it ran from the original study repo with Codex CLI 0.159.3 and omp 18.14.0, on a
different host (both recorded in `REPRODUCE.md` and `moodle-ledger/tasks.jsonl`). Everything that defines a trial is unchanged:
pairs, seeded faults, scenario text (asserted per trial against the pin), hand-off, pre-authentication, prompt, 60-tool-call
limit, 300 s timeout, sandbox and verdict decoder (parser v2).

## Harness

`scripts/single-run.mjs` is a copy of `scripts/moodle/campaign-run.mjs` with arms A and C only. Each job uses the same group
ordering (assignGroups: (break, state, arm) groups, larger first, trials shuffled inside a group by the ledger with a recorded
seed). It adds what stream D's runner adds:
- its own ledger (`data/ledger`) and worker start;
- the recorded fault target step;
- recorded versions;
- harness flags, which do not change outcomes:
  - `harness-setup-step-handed-to-agent` comes from the scenario text before the run and applies to B07.S028, B07.S029,
    B29.S138 and B29.S139. Their "the following config values are set as admin:" step comes after the first UI step, so the
    agent gets it as a UI step.
  - `tool-budget` marks a run that ended unresolved after more than 60 tool calls.
- a token guard (no agent run starts if measured tokens + 1.5M > 85M) and a deadline guard (2026-11-28 18:00 UTC).

`scripts/run-plan.sh` ran one job per model x state x repetition. Each job held `flock /tmp/mipro-next/run.lock`. The order was
arm A healthy, arm A faulty, then for each of Luna, Terra and Haiku: r1 healthy, r1 faulty, r2 healthy, r2 faulty.
Logs are in `logs/` and the agent CLI event streams in `data/ledger/blobs`.

## Results (`uv run scripts/count_moodle.py`, output in `results/counts.txt`)

Scoring follows `scripts/counts/moodle.py`. Pass is the runner's `passed` or the agent's `pass`. `unresolved` counts as fail.
A catch is a faulty run that did not pass. A false alarm is a healthy run that did not pass. A paired catch needs the healthy
partner (same case and repetition) to pass and the faulty run not to pass.
A verified paired catch also needs the faulty run to have status `fail` (never `unresolved`) and to fail at the fault's target
Behat step. For an agent, the failing step counts only when the parser verified its number against the listed step text
(this is the campaign's `caught` oracle).

| arm / model | false alarms (healthy) | of which unresolved | catches (faulty) | of which unresolved | paired catches | verified paired catches |
|---|---:|---:|---:|---:|---:|---:|
| A, 16 cases | 0/16 | 0 | 16/16 | 0 | 16/16 | 16/16 |
| A, agents' 14 cases | 0/14 | 0 | 14/14 | 0 | 14/14 | 14/14 |
| Luna | 23/28 | 2 | 25/28 | 4 | 5/28 | 4/28 |
| Terra | 7/28 | 3 | 26/28 | 4 | 19/28 | 18/28 |
| Haiku | 11/28 | 5 | 27/28 | 4 | 16/28 | 14/28 |

Paired catches by change: same-assertion change B04 (6 pairs) and downstream changes (22 pairs).
- Luna: 3/6 and 2/22.
- Terra: 6/6 and 13/22.
- Haiku: 6/6 and 10/22.

For reference, the 16 Nov campaign on the same 14 cases x 2 (not compared formally):

| model | catches | false alarms | paired catches |
|---|---|---|---|
| Luna | 27/28 (2 unresolved) | 16/28 | 11/28 |
| Terra | 26/28 (4 unresolved) | 7/28 (3 unresolved) | 19/28 |
| Haiku | 27/28 (6 unresolved) | 13/28 (6 unresolved) | 14/28 |
| arm A | 16/16 | 0/16 | 16/16 |

### Without the four flagged cases (10 cases x 2)

| model | false alarms | catches | paired | verified paired |
|---|---:|---:|---:|---:|
| Luna | 15/20 (1 unresolved) | 19/20 (3 unresolved) | 5/20 | 4/20 |
| Terra | 3/20 (3 unresolved) | 18/20 (4 unresolved) | 15/20 | 14/20 |
| Haiku | 7/20 (5 unresolved) | 20/20 (4 unresolved) | 13/20 | 11/20 |

### Flagged runs (counted above as recorded)

- `harness-setup-step-handed-to-agent` (16 runs per model). Healthy runs not passing / faulty runs not passing:
  - Luna 8/8 and 6/8.
  - Terra 4/8 and 8/8.
  - Haiku 4/8 and 7/8.
- `tool-budget` (unresolved after 61–64 tool calls):
  - Luna 2 of 6 unresolved: B25.S125 faulty r1 and r2.
  - Terra 5 of 7: B25.S125 healthy r1 and r2, B25.S125 faulty r2, B34.S154 healthy r1, B34.S154 faulty r2.
  - Haiku 5 of 9: B25.S125 healthy r1 and r2, B25.S125 faulty r1 and r2, B34.S154 faulty r1.
  - All other unresolved runs ended below the limit without a timeout: the agent reported `unresolved` itself. They are listed in
    `results/counts.txt`.
- B25.S125 was unresolved in all 8 of its Terra and Haiku runs, and in 2 of 4 Luna runs (both faulty). Luna's two healthy B25.S125
  runs failed with an unverified step.

## Resources (every attempt; tokens = input incl. cache reads/writes + output)

| part | runs | agent tokens | plan estimate | mean per run (campaign mean) | cached share of input | trial minutes | plan minutes |
|---|---:|---:|---:|---:|---:|---:|---:|
| A | 32 | 0 | 0 | – | – | 6.9 | 9 |
| Luna | 56 | 16.01M | 17.1M | 285.9k (304.9k) | 0.883 | 50.2 | 39 |
| Terra | 56 | 22.94M | 25.1M | 409.6k (448.6k) | 0.915 | 70.0 | 61 |
| Haiku | 56 | 29.87M | 33.8M | 533.3k (603.7k) | 0.917 | 44.8 | 47 |
| total | 200 | **68.81M** | 76.0M | | | 171.9 | 156 |

- All 168 agent runs recorded usage counters.
- Haiku's omp-reported cost was $0.688 in total. Codex does not report a cost.
- Trial minutes sum each trial's whole wall time, including reset, data hand-off and cleanup. Wall clock from the first to the
  last measured trial was 3 h 31 min. That includes waits for the shared run lock.
- The token guard was never close to binding: the cap was 85M.

Technical smoke check (`data/smoke-ledger`, not measured, `logs/smoke*.log`): 6 runs on B04.S041.
- Arm A: healthy passed; faulty failed at the target step 6.
- One faulty run per agent: Luna, Terra and Haiku each failed at verified step 6.
- Smoke agent tokens: Luna 54,282, Terra 122,223, Haiku 87,055, total 263,560 (Haiku reported $0.0035).

## Limitations and observations

- Luna's false alarms rose from 16/28 (16 Nov, Codex CLI 0.159.3) to 23/28 here (Codex CLI 0.169.0), and its paired catches
  fell from 11/28 to 5/28. Terra (7/28, 19/28) and Haiku (13/28 to 11/28 false alarms, 14/28 to 16/28 paired) are close to
  the campaign.
- I checked the harness for a cause and found none:
  - all Luna runs were pre-authenticated, sandboxed and finished without timeouts or CLI errors;
  - the global search setting of the seed is off;
  - the other two models passed the same healthy builds in the same session.
- Luna's healthy failures are spread over agent steps 1–4 and 12. Example: B04.S041 healthy r1 and r2, where Luna searched the
  course list for "Music history", which is the assignment's name, and reported fail at step 1.
- With one model and two repetitions per cell, the change between campaigns cannot be attributed to the CLI version, the host
  or run-to-run variation.
- Luna's step-1 failures cannot be verified against a step: the step text Luna returns includes the hand-off's "(already done:
  ...)" annotation, so the parser does not verify the step. They count as failures, not as verified catches. The parser was
  unchanged on purpose.
- The four flagged cases hand an admin configuration step to the agent (known defect, kept). Their results are shown above and
  are not robustness failures of the tests.
- Most `tool-budget` runs are on B25.S125 and B34.S154, which are long scenarios. 60 tool calls was the campaign's limit and
  was kept.
- The single set is one run per arm A cell and two per agent cell, as in the campaign. No interval estimates are given.

## Files

- `scripts/single-run.mjs`: runner.
- `scripts/run-plan.sh`: measured order.
- `scripts/smoke.sh`: smoke check.
- `scripts/status.sh`: progress, infrastructure only.
- `scripts/count_moodle.py`: counts.
- `data/ledger/trials.jsonl` and `data/ledger/blobs/`: measured trial records and CLI event streams.
- `data/smoke-ledger/`: smoke check.
- `logs/run-plan.log`, `logs/job-*.log`, `logs/smoke*.log`: job logs.
- `results/counts.txt`: output of `count_moodle.py`. Its "reproduced/paper" columns come from the shared Checker. Every row is
  `info`: there is no paper value to compare.
