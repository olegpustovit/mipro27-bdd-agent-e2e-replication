# Stream D report: replay of real Moodle interface changes

Status: `exploratory-owner-directed`, `gatePassExists: false`, run without a gate pass. This is a post-hoc analysis, decided after the
original Moodle campaign. The plan and its amendments A1 and A2 were written before any measured run (`plan.md`; sha256 at A1 and A2 in `data/`).
Counts use the paper's rules: pass is Behat `passed` or the agent's `pass`; `unresolved` counts as fail; a healthy run that does not pass is a
false alarm (for the old step definitions on the post-change build, the expected break); a faulty run that does not pass is a catch; a paired
catch also needs the healthy post-change run of the same scenario and repetition to pass. Script: `scripts/count_replay.py`;
output: `results/counts-replay.txt`.

## 1. What ran

- **Builds.** For each change: the Moodle commit just before it (`pre`, parent of the UI commit) and just after it (`post`, the UI commit).
  14 golden Behat sites were built with the unchanged study adapter, plus 1 for the post-hoc diagnostic.
  - B04, B07, B15 use the campaign runtime: PHP 8.3, Postgres 17, pinned images.
  - B25, B27, B28, B29 (Moodle 4.0dev, 2021) use a second runtime: PHP 8.0.30 and Postgres 13.23, pinned by digest. Selenium and moodle-docker are as in the campaign (amendment A1).
  - B34 is not run: its scenarios (S153, S154) did not exist before the change.
- **Arms.**
  - A-old: the developers' step definitions as they were before the change. At `post` the change's step-definition hunks are reverted; the resulting file is verified byte-identical to the `pre` file.
  - A-new: the developers' step definitions after the change (`post` only). For B28 this is the later fix commit 8662be1d's step-definition diff.
  - C: browser agents Luna (gpt-6-luna) and Terra (gpt-5.6-terra) via Codex CLI 0.169.0, and Haiku (claude-haiku-5-5) via omp 18.20.2. Reasoning/thinking effort medium; same hand-off, prompt, 60-tool-call limit, 300 s timeout, sandbox and verdict decoder as the Moodle campaign; 2 repetitions.
- **Measured runs.** 256 trial records: 64 Behat runs (39 A-old, 25 A-new) and 192 agent runs (64 per model). There were no exclusions, no
  interrupted attempts, no reruns and no schedule stops.
  - P1, healthy pre and post of B04/B07/B15: 24 Behat and 84 agent runs.
  - P2, faulty post of B04/B07/B15: 16 Behat and 42 agent runs.
  - P4, healthy 2021: 18 Behat and 60 agent runs.
  - P5, faulty 2021: 6 Behat and 6 agent runs. B28's faulty pairs failed rule F (fault not reproduced at its target step by A-new), so no agent ran them. X023 (B27) and X026 (B29) do not apply at post.
- **Agent tokens.**
  - Measured ledger: 94.94M (Luna 22.18M, Terra 30.49M, Haiku 42.26M). Trial wall time: 46.9 / 75.0 / 53.5 min.
  - Technical smoke checks, separate ledger: 2 Luna runs, 0.51M tokens; plus 4 Behat runs. The token guard counted only the measured ledger, so the stream total is **95.45M, 0.45M over the 95M cap.**
- **Time.** The first measured run started 2026-11-26 22:54 UTC; the last ended 2026-11-27 06:48 UTC, well before the cut-off.
- **Post-hoc diagnostic** (not measured; `data/diagnostics.jsonl`): Behat on B28's own fix commit 8662be1d, 2 runs.
- **Data.**
  - Ledger: `data/ledger/trials.jsonl`; agent event blobs: `data/ledger/blobs/`; smoke checks: `data/smoke-ledger/`.
  - Patches: `data/patches/` (with SHA256SUMS); builds: `data/builds.jsonl`.
  - Scripts: `scripts/`; operations log: `README.md` and `logs/run-plan.log`.

## 2. Results

### B04, B07, B15: campaign environment, scenario text identical to the campaign's

Coded arms ran 8 scenarios; agents ran 7 (B07.S025 has no leading data steps, the campaign's setup exclusion). Agent cells have 14 runs:
7 scenarios x 2 repetitions.

| arm | pre: pass | post: pass | post: not passing (unresolved) | pass pre -> not post (same scenario, rep) | faulty post: catches | paired catches |
|---|---|---|---|---|---|---|
| A-old: steps before the change | 8/8 | 0/8 | 8/8 break | 8/8 | 8/8 | 0/8 |
| A-new: steps after the change | – | 8/8 | 0/8 | – | 8/8 | 8/8 |
| Luna | 7/14 | 7/14 | 7/14 (0) | 4/14 (the reverse also 4/14) | 11/14 | 6/14 |
| Terra | 14/14 | 12/14 | 2/14 (0) | 2/14 | 12/14 | 10/14 |
| Haiku | 11/14 | 12/14 | 2/14 (1) | 1/14 (the reverse 2/14) | 14/14 | 12/14 |

Context (campaign, Moodle pin, same 7 scenarios, healthy): not passing Luna 4/14, Terra 0/14, Haiku 2/14.

Per change, healthy post not passing: B04 A-old 3/3, A-new 0/3, Luna 4/6, Terra 2/6, Haiku 1/6. B07 A-old 3/3, A-new 0/3, Luna 1/4,
Terra 0/4, Haiku 0/4. B15 A-old 2/2, A-new 0/2, Luna 2/4, Terra 0/4, Haiku 1/4.

Terra's two post-change failures are both B04.S041, and both are tied to the real change (B04 moved the manual completion button into the
activity header). After toggling, Terra read the button as "Music history is marked as done. Press to undo." and reported step 7
("... is displayed as "Done"") as failed. On the pre-change build both of its runs passed.

### 2021 changes: Moodle 4.0dev, PHP 8.0 runtime; reported separately

| case (text) | A-old pre | A-old post | A-new post | faulty (A-new) | Luna pass pre / post | Terra pass pre / post | Haiku pass pre / post | agents faulty |
|---|---|---|---|---|---|---|---|---|
| B27.S131 (campaign text) | pass | fail (break) | pass | fault does not apply | not run (no leading data steps) | – | – | – |
| B25.S125 (historical text) | pass | fail (break) | pass | caught, paired 1/1 | 0/2 / 0/2 | 0/2 / 0/2 | 0/2 / 0/2 | 6/6 not passing, paired 0/6 |
| B28.S134 (campaign text) | fail @5 | fail @5 | fail @5 | invalid (rule F) | 0/2 / 2/2 | 2/2 / 2/2 | 2/2 / 2/2 | not run |
| B28.S137 (historical text) | fail @5 | fail @5 | fail @5 | invalid (rule F) | 0/2 / 0/2 | 2/2 / 2/2 | 1/2 / 1/2 | not run |
| B29.S138, S139 (historical text) | fail @6 | fail @6 | fail @6 | fault does not apply | 0/4 / 0/4 | 0/4 / 0/4 | 0/4 / 0/4 | – |

- **B25.S125** (25 UI steps). Of the 18 agent runs, none passed: 15 were unresolved, and 10 of those ended above the 60-tool-call limit
  (flag `tool-budget`; 4 more stopped at 50 to 60 calls, 1 at 8). This repeats the campaign, where no model finished S125 within 60 calls.
  These are budget results, not robustness failures.
- **B28.** Every coded variant fails at step 5, "I select ... user in messaging" (message-drawer search field not found): old steps,
  new steps, healthy and faulty. The diagnostic shows the developers' own tests also fail at their fix commit 8662be1d on this stack. So the
  2021 Behat stack cannot run B28's scenarios in this environment, and B28 has no coded baseline here. The cause (old Behat with Chrome 157,
  PHP 8.0, or something else) is not isolated.
- **B29.** The 2021 text uploads a file through the UI at step 6. Every coded variant fails there ("Files" filepicker can not be found). All
  24 agent runs stop at that step (20 unresolved, 4 fail): the study's browser policy gives the agents no file-upload tool. Neither arm can run
  B29's historical scenarios. These are not robustness results. Nothing was substituted, per the owner's direction.

### Flagged agent runs (amendment A2)

- `harness-setup-step-handed-to-agent` applies only to B07.S028 and S029 (a non-leading `the following config values are set as admin:` step). Among runs that did not pass: tier 1 healthy pre Luna 2, Haiku 2; healthy post Luna 1; faulty post Luna 2, Terra 4, Haiku 4. In the B07 faulty cells, these flagged runs were also catches (they did not pass).
- B29's 2021 text has no such step, so the campaign's B29 harness cause does not recur here.
- `tool-budget` (unresolved, more than 60 tool calls): 11 of the 39 unresolved agent runs; 10 are B25.S125 and 1 is B28.S137 (Haiku pre).

## 3. Limitations and what went wrong

- 2021 changes ran on a different runtime from the campaign: PHP 8.0 and Postgres 13 instead of 8.3 and 17; Selenium and Chrome 157 unchanged. On that stack B28 and B29 could not be run by the coded arm at all; for B28 the agents can be read, but there is no coded comparison.
- Four 2021 scenarios run with their historical text, which differs from the campaign's text.
- Agent noise is large at 2 repetitions: Luna's pre-change build had as many failures (7/14) as its post-change build. Its "breaks" (4/14) are matched by an equal number of reverse changes (4/14), and its pin rate in the campaign was 4/14. Per-model differences of 1-2 runs are not evidence of a change effect.
- Host: x86_64 WSL2 ("<host>"). REPRODUCE.md records host "main" (aarch64) for the payment-app campaigns; I did not find the Moodle campaign's host in the files I read. The Codex CLI and omp versions equal those recorded for the Moodle campaign. Node 24.22.1, Playwright 1.65.0-alpha-2026-10-30, @playwright/mcp 0.0.84 (package-lock). Study repo HEAD: 9c9eee2.
- CLI versions are not in the per-trial records. The trial records' `env` holds the build, Moodle commit, runtime
  images and `studyRepoHead` (9c9eee2 in all 256), but no Codex CLI or omp version. The agent event blobs do not hold
  them either: Codex `exec --json` streams carry no version, and omp's `session` event gives only its session-format
  version (3). The versions stated above (Codex CLI 0.169.0, omp 18.20.2) come from the stream plan (`plan.md`) and this
  session's own report, not from per-trial records. For context only: stream E-moodle, run next on the same host from
  06:16 UTC, recorded `codex-cli 0.169.0` and `omp/18.20.2` in all 200 of its trial records.
- Token cap: the stream total of 95.45M exceeds 95M by 0.45M, because the 0.51M smoke tokens were outside the guard's count. The measured runs alone used 94.94M.
- Host restart at 21:45 UTC on 26 Nov, before any run.
- Scheduling change at 03:18 UTC on 27 Nov, approved by the coordinator: the lock was held per group instead of per job. No trial, order or rule changed.
- The arm-A "catches" for A-old on faulty builds are not informative: those builds are already broken (paired 0/8). The B04 A-old runs fail at the fault's target step because B04's break sits in the target assertion.
- The B28 diagnostic is post hoc and not part of the counts.

## 4. Sentences the paper could use

Replaying three real Moodle interface changes (B04, B07, B15) on the commits just before and after each one, the developers' earlier step
definitions passed all 8 scenarios before the change and failed all 8 after it. On the same post-change builds the browser agents did not pass
7/14 (Luna), 2/14 (Terra) and 2/14 (Haiku) healthy runs, against 7/14, 0/14 and 3/14 before the change. Faults seeded into the post-change
builds were caught with paired catches of 6/14, 10/14 and 12/14, against 8/8 for the developers' updated step definitions.
Of the four 2021 changes, both arms could be compared only on B25, where the earlier step definitions broke and no agent run finished the
25-step scenario within the 60-tool-call budget. B27 ran the coded arm only, B28 and B29 could not be run by the coded arm on the 2021 test stack,
and B29's scenarios need a file upload that the agents' tools do not offer.
