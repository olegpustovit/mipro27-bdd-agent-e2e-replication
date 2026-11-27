# Stream D: replay of real Moodle interface changes (plan, fixed before any measured run)

Written 2026-11-26 21:50 UTC, before any measured run. Status of every run: `exploratory-owner-directed`, `gatePassExists: false`.
This analysis was decided after the original Moodle campaign (plan 6ac189f540b8) and is **post hoc**.
Study repo HEAD: 9c9eee2478ca761902f963fd7ccc791a57a4439b (untracked stream folder only).

## Question

In the Moodle campaign the browser agents ran only against the pin (Moodle 5.3.1, `cfe123f2`), which already contains all 8
historical changes. Here each change is replayed on real builds: the Moodle commit just before the change (`pre` = parent of the
UI commit) and just after it (`post` = the UI commit). Per arm: does the scenario pass on the healthy post-change build
(robust to the real change), and on the pre-change build (baseline)? On faulty post-change builds: is the seeded fault caught?

## Feasibility result (details: `feasibility/notes.md`, `feasibility/scenario-presence.tsv`, `feasibility/commits.tsv`)

| change | pre / post commit | Moodle | campaign scenarios | same scenario text pre = post = pin | builds in the campaign environment | verdict |
|---|---|---|---|---|---|---|
| B04 | 746815af / 6200c31f | 5.2dev, 2026-02 | S036 S037 S041 | yes | yes (PHP 8.3) | **run** |
| B07 | c87bae8d / 9105de4c | 5.3dev, 2026-06 | S025 S028 S029 | yes | yes | **run** (S025: arm A only, see below) |
| B15 | d65e24a6 / 88dbf8a0 | 5.1dev, 2025-05 | S091 S094 | yes | yes (pre-`public/` layout) | **run** |
| B25 | 51149a78 / e0f584d6 | 4.0dev, 2021-12 | S125 | no (historical text differs) | no: Moodle 4.0 needs PHP <= 8.0 | stretch only (P3) |
| B27 | 24d09831 / 306a7788 | 4.0dev, 2021-08 | S131 | yes | no: PHP <= 8.0 | stretch only (P3), arm A only |
| B28 | 1464843a / 6cce0bf4 (test fix 8662be1d) | 4.0dev, 2021-08 | S134 S137 | S134 yes, S137 no | no: PHP <= 8.0 | stretch only (P3) |
| B29 | 30b8ad51 / e3690a39 | 4.0dev, 2021-06 | S138 S139 | no | no: PHP <= 8.0 | stretch only (P3) |
| B34 | 40ea6753 / cacf6925 | 3.9dev, 2019-12 | S153 S154 | scenarios do not exist yet | no | **not feasible** |

Checked for B04, B07, B15 (all OK): the step-definition fix of each change reverse-applies at `post`, and the resulting step-definition
file is byte-identical to the `pre` file (`data/patches/<B>.old-steps-at-post.patch`); the campaign's seeded faults X014, X010, X011,
X021, X022 apply cleanly at `post` (B15: same patch with the `public/` path prefix removed, the only change). Golden Behat sites are built by the
unchanged study adapter (`scripts/build-golden.mjs` → `adapters/moodle/adapter.mjs bootstrap()`), pinned images, PHP 8.3, Postgres 17.

The campaign's agents could not run B07.S025 and B27.S131 (no leading data steps; setup exclusion). They are not run for arm C here.

## Arms (same harness as the campaign)

- **A-old**: developers' step definitions as they were before the change, i.e. the ones the change broke. `pre`: the tree as is;
  `post`: the tree with the change's step-definition hunks reverted. One Behat run per cell (deterministic, as arm A in the campaign).
- **A-new** (control, post only): developers' step definitions after the change (the `post` tree as is). One run per cell.
- **C**: browser agents Luna (`gpt-6-luna`, Codex CLI 0.169.0), Terra (`gpt-5.6-terra`, Codex CLI 0.169.0), Haiku (`claude-haiku-5-5`,
  omp 18.20.2): same hand-off, pre-authentication, prompt, 60-tool-call limit, 300 s timeout, sandbox and verdict decoder
  (`adapters/moodle/arm-c.mjs` unchanged). **2 repetitions** per cell, as in the campaign.
- Every trial asserts that its scenario text equals the campaign's (pin) text. Arm B (LLM-updated step definitions) is not part of this stream.

Runner: `scripts/replay-run.mjs` (study ledger code, own ledger at `data/ledger/`). Trial key
`replay-d1/<B>.<S>/<pre|post>/<state>/<arm>/<model|none>/r<k>`. A trial is never re-run; an interrupted trial is retried only by the
ledger's own attempt mechanism and both attempts are kept.

## Run list and priorities (order is fixed; nothing is selected by outcome)

- **P1 healthy, pre and post** (B04, B07, B15 in B-order; per build: arm A, then Luna, Terra, Haiku):
  arm A: 8 A-old on pre + 8 A-old and 8 A-new on post = 24 Behat runs; arm C: 7 scenarios x 2 builds x 3 models x 2 reps = **84 agent runs**.
- **P2 faulty post** (same order): arm A: 8 pairs x (A-new, A-old) = 16 Behat runs. **Rule F (validity, fixed now):** a faulty pair is
  run for the agents only if A-new on the faulty post build fails at the fault's target step (the campaign's V1 reproduction criterion).
  Arm C: up to 7 pairs x 3 models x 2 reps = **42 agent runs**.
- **P3 stretch (environment deviation)**: B25, B28, B29 (and B27 for arm A), in B-order, only if P1 and P2 are complete by
  2026-11-27 18:00 UTC and the measured P1+P2 tokens plus the P3 estimate fit the cap. Needs a PHP 8.0 (or 7.4) webserver image instead
  of the campaign's PHP 8.3 image, and uses the historical scenario text where it differs from the pin. 1 repetition, healthy pre and post only.
  A change is dropped if its two builds do not pass a Behat smoke check within 90 minutes of work. Reported separately from P1/P2.
- **Cut rule if the budget or time runs short:** runs are executed in the order above; a run starts only if the stream's measured agent
  tokens + 1.5M reserve stay <= 80M (enforced in the runner) and before 2026-11-28 12:00 UTC. Whatever is complete at the stop
  is reported; within P1 the unit of completeness is a change (all its builds, arms, models and reps), in B-order.

## Estimate (from `results/counts-v1.1.4.txt` and `results/moodle-resources.txt`; `results/moodle-budget.txt` smoke means are higher, shown for reference)

Campaign per-run means (arm C, all states): Luna 304.9k tokens, 41.7 s; Terra 448.6k, 65.3 s; Haiku 603.7k, 50.4 s
(per 16-scenario suite 4.88M / 7.18M / 9.66M tokens, 12.7 / 19.9 / 15.3 min). Arm A Behat run: 16.5 s mean.
One scenario x 3 models x 1 rep = 1.357M tokens, 157 s.

| part | agent runs | tokens (campaign means) | tokens (budget smoke means 275k/516k/553k) | agent minutes | Behat minutes |
|---|---|---|---|---|---|
| P1 | 84 | 38.0M | 37.4M | 73 | 7 |
| P2 | <= 42 | <= 19.0M | <= 18.7M | <= 37 | 4 |
| P1+P2 | <= 126 | **<= 57.0M** | <= 56.1M | **<= 110** | 11 |
| P3 (if run) | 5 scen x 2 builds x 3 x 1 = 30 | 13.6M | | 26 | |

Plus about 1 min per golden build (6 builds), 2-3 min per worker switch (about 12 switches) and waits for the shared run lock
(`flock /tmp/mipro-next/run.lock`, one lock per build-and-arm job). Expected wall time for P1+P2: 3-4 h without lock waits. Both well
within the 80M-token cap and the 2026-11-28 12:00 UTC deadline, so P1 and P2 are run in full.

One technical smoke check (not a measured trial; separate ledger `data/smoke-ledger/`, reported with its tokens) runs one arm-A
Behat run and one Luna run on B15 pre (the pre-`public/` layout) to confirm the harness works on a non-pin build.

## Counting (paper definitions, `scripts/counts/common.py` and `moodle.py` rules)

Pass = runner's pass (Behat `passed`) or the agent's reported `pass`; `unresolved` counts as fail; setup errors that never reach the
agent are excluded and listed. Healthy build not passing = false alarm (for A-old on `post`: the expected break). Faulty build not
passing = catch; paired catch = healthy post run of the same scenario and repetition passes and the faulty run does not. Per arm and
model: passes / breaks or false alarms / unresolved on pre and post; catches and paired catches on faulty post.
Script: `scripts/count_replay.py` (written before the results are read).

---

## Amendment A1 (2026-11-26 21:55 UTC; owner and coordinator direction; written before any measured run of this stream)

The text above is the original plan and stays unchanged; its run order (P1, then P2) is kept and runs first.

1. **The 2021 changes join the main plan.** They are not a stretch goal any more (this replaces P3). After P1 and P2 of B04, B07, B15:
   **P4 healthy, pre and post** of B25, B27, B28, B29, then **P5 faulty post** where a seeded fault applies.
   B34 stays out: its scenarios (S153, S154) did not exist before the change.
2. **Second runtime for Moodle 4.0dev.** These four changes run on Moodle 4.0dev (2021), which needs PHP <= 8.0. The webserver image is
   `moodlehq/moodle-php-apache@sha256:2964e59ac5a24e9d7004d463e3082db660ced4926015d7032526157c8e05bb85` (tag 8.0, PHP 8.0.30;
   same image family and extension set as the campaign's PHP 8.3 image). The DB image is
   `postgres@sha256:4689940c683801b4ab839ab3b0a0a3555a5fe425371422310944e89eca7d8068` (tag 13, PostgreSQL 13.23). Selenium, the
   moodle-docker commit and composer stay as pinned in `docker/moodle/versions.json`. The study adapter's code is unchanged; the runner
   overrides only the image, PHP-version and DB-version fields of the adapter's `versions` object for these builds (recorded per trial).
   If the old Behat stack cannot run a scenario, the reason is recorded and nothing is substituted.
3. **Scenario text.** Where the text at the pre/post commits equals the pin's (B27.S131, B28.S134) the campaign-text assertion applies.
   Where it differs (B25.S125, B28.S137, B29.S138, B29.S139) the scenario **as it existed at the pre and post commits** is run (it is identical
   at pre and post; asserted per trial against `feasibility/scenario-presence.tsv`). These four are reported separately from the cases
   whose text equals the campaign's.
4. **Builds and arms (checked 2026-11-26):** pre = parent of the UI commit, post = UI commit, as before.
   - B25 (51149a78 / e0f584d6), B27 (24d09831 / 306a7788), B29 (30b8ad51 / e3690a39): combined commits; A-old at post = the change's
     step-definition hunks reverted (reverse-applies at post); A-new at post = the tree.
   - B28 (1464843a / 6cce0bf4): the UI commit leaves the step definitions as they were, the developers fixed them in a later commit
     (8662be1d). A-old = the tree at pre and post; A-new at post = the tree plus that later step-definition fix (`B28.test.diff`, applies at post).
   - Arm C: B25.S125, B28.S134, B28.S137, B29.S138, B29.S139 (B27.S131 has no leading data steps: arm A only, as in the campaign).
5. **P5 faults:** X020 (B25.S125) and X025 (B28.S134, B28.S137) apply at post (path prefix `public/` removed); X023 (B27) and X026 (B29) do not
   apply and are not run. Rule F applies unchanged; with historical text the target step is the step whose text equals the fault's target
   step text (none found = pair invalid, recorded).
6. **Repetitions and order in P4/P5:** 2 repetitions. All rep-1 cells first (B-order: B25, B27, B28, B29; per build: arm A, Luna, Terra,
   Haiku), then all rep-2 cells in the same order; P5 after P4 in the same way.
7. **Token cap raised from 80M to 95M** (coordinator decision, before any measured run). The runner's guard stops starting agent runs
   when measured tokens + 1.5M reserve would exceed 95M. The 2026-11-28 12:00 UTC cut-off is unchanged; at the cut-off the work stops at a clean point.

Estimate for A1 (campaign means, 1.357M tokens and 157 s per scenario x 3 models x 1 rep):
P4 arm C 5 scenarios x 2 builds x 3 models x 2 reps = 60 runs, 27.1M tokens, 52 min; arm A 6 A-old pre + 6 A-old post + 6 A-new post = 18 Behat runs.
P5 arm C <= 3 pairs x 3 x 2 = 18 runs, <= 8.1M; arm A 3 pairs x 2 = 6 Behat runs.
Total P1+P2+P4+P5 <= 92.2M tokens (campaign means), under the 95M cap. Plus 8 golden builds on the second runtime.

---

## Amendment A2 (2026-11-26 22:13 UTC; coordinator direction from the stream A trace audit; before any measured run of this stream)

1. **Flags (the harness is unchanged, for comparability with the campaign).** Every agent trial records `harnessFlags`:
   - `harness-setup-step-handed-to-agent`: the scenario has a data-setup step (the hand-off's own data-step patterns) after its first UI
     step, so the hand-off passes it to the agent as a UI step. Determined from the scenario text before the run. On the texts that run here
     this applies to B07.S028 and B07.S029 (`the following config values are set as admin:`), and not to B29's historical text (in the
     campaign, B29 ran the pin text, which has such steps; the 2021 text does not).
   - `tool-budget`: the agent's verdict is `unresolved` and it used more than 60 tool calls.
   The report gives B25 and B29 agent results separately from B04, B07 and B15 (they are already a separate group), and shows the
   flagged runs separately so they are not read as robustness failures. Outcomes are still counted by the unchanged rules.
2. **Cut order if the budget gets tight (replaces A1 item 6's rep-2 order for P4/P5):** after P4 rep 1 (all four changes, B-order),
   the remaining cells run in this order:
   (a) P4 rep 2 of B28; (b) P5 rep 1 of B28 then B25 (arm A first, rule F); (c) P5 rep 2 of B28; (d) P4 rep 2 of B25 and B29, then P5 rep 2 of B25.
   Group (d) runs last, so the token guard or the cut-off removes B25 and B29 rep-2 cells first.
