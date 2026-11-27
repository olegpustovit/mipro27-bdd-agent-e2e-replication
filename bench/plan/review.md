# P10 cold review of the plan-1 harness

Reviewer: fresh Claude Code session (Opus 5.5), 2026-11-27. Read-only review of `pretask/P10` at `30ea231`.
No measured runs were started. The scoring tests (`uv run scoring/tests/test_scoring.py`: OK, Wilson matched on
203 cases) and the agent adapter tests (`node --test bench/agent/agent.test.mjs`: 7/7) were run in a scratch copy
outside the worktree. Smoke evidence was read from `mipro27-wt/P9/bench/ledger-smoke/p9-rx3dkw5t`.

Calibration: modest MIPRO SSE empirical study. This review lists only problems that would make a reported number
wrong, make the comparison unfair, or misreport the design, plus a few that a venue reviewer would likely catch.

Severity: **blocking** means a reported number is wrong if runs start now. **Major** means a number or claim is
misreported or unfair unless fixed before freeze. **Minor** is cheap to fix and should be fixed or stated.

---

## Blocking

### B1. Moodle agents and step definitions number steps differently, but scoring uses one target step for both

- **Evidence.**
  - Coded Moodle runs number the failing step within the Scenario body. Background steps are excluded and data
    steps in the body are kept (`bench/runner/coded/moodle.mjs:109`).
  - The agent's scenario is rebuilt from `plan.uiSteps`. Background UI steps are included and data steps are removed
    (`bench/runner/moodle/agent-scenario.mjs:16`, numbered by `bench/agent/answer.mjs:75-78`).
  - Scoring compares the reported step number with a single target per `app/version/scenario`
    (`bench/scoring/score.py:52,59,69`). The README says the target is shared across all arms
    (`bench/scoring/README.md:58`).
  - Recomputing the agent numbering of each symptom step against `plan.json` targetStep gives a different number for
    7 of 18 Moodle units: B15/S091 (5→4), B15/S094 (2→4), B05/S042 (11→13), S043 (15→14), S045 (7→8), S046 (9→10)
    and S047 (7→5).
  - The P9 smoke shows it already happens. On `mdl.B15.S091.post.bug`, sd-new failed at step 5 and all three agents
    failed at step 4. All four failed on the same text, `Then I should see "Teacher One" in the "Logged in user"
    "block"`. Scored with target 5, every agent catch counts as "detected elsewhere".
- **Effect.** Moodle agent catch rate and catch retention are wrong for 7 of 18 units. The false-alarm rule
  `target_passed` (failure after the target) also uses the wrong number.
- **Fix.**
  - Store the target per numbering. Give each Moodle bug both the coded index and the agent index, or the exact
    target step text plus an arm-specific index.
  - Have `score.classify` use the index that matches the arm's kind.
  - Generate the targets mechanically from `symptom.md` and the same `planHandoff`/`agentScenario` code the runner
    uses (see M2).
  - Add a test that checks, for every bug, that coded and agent target texts are equal after the agent-wording
    replacements.

### B2. The agent's 5-minute limit can never fire: slow runs become invalid and are rerun

- **Evidence.**
  - `Worker` sets `deadline = monotonic() + 300` when the worker is created (`bench/runner/worker.py:83`). That is
    before container start, health checks, Moodle data setup (`prepare-pinned`) and the hold-06/07 fixture.
  - The agent `docker exec` gets `timeout = deadline - now` (`worker.py:384`).
  - The session's own 300 s `budget_time` timer starts only after the browser and Codex start
    (`bench/agent/session.mjs:6,65`).
  - Smoke wall time minus adapter time is about 0.1 to 0.5 min (`smoke-report.md`, Full matrix). So the host kill
    always comes first.
  - When it fires, `subprocess.run` raises `TimeoutExpired`. That is caught as `SubprocessError`
    (`bench/runner/run-item:183`) and recorded as invalid: "adapter unavailable or exceeded host timeout"
    (`run-item:231`).
  - The outputs in `/p2output` are never copied to `raw/` (`worker.py:385` runs after the exec), so the trace is lost.
- **Effect.**
  - A run that should be "unresolved: out of time" (a fail under plan section 6) is instead quarantined and rerun,
    up to 3 times. That gives the agent fresh draws, which plan section 5 forbids ("no run is repeated to get a
    different answer").
  - Two such runs in a row on one arm trip the "two invalid in a row" stop.
  - The long B05 scenarios (S042 has 56 agent steps) are the likeliest to hit this.
  - Coded Moodle runs are unaffected (Behat 120 s), so the error is one-sided.
- **Fix.**
  - Start the adapter deadline after seeding, and make it the session limit plus a cleanup margin (for example
    300 s + 30 s).
  - Or make the host timeout a separate, larger infrastructure guard. Copy `/p2output` in a `finally` block even
    after a timeout.
  - Add a worker-level test with a fake agent that sleeps past 300 s. It should produce a valid record with
    `unresolved_cause: budget_time` and a trace.

---

## Major

### M1. The false-alarm headline and verdict leave out unresolved healthy runs

- **Evidence.**
  - Plan section 6: unresolved "counts as a fail, reported separately". Section 1: false alarms are "the share of
    runs without a bug that failed".
  - `healthy_metrics` counts only explicit `false_alarm` (`bench/scoring/score.py`, `healthy_metrics`). The verdict
    uses `{mode}_false_alarms` (`bench/scoring/report.py:108`).
  - The README states this choice (`bench/scoring/README.md:28`). Unresolved runs only enter the separate
    `non_green` figures.
- **Effect.** An agent that times out or loops on healthy runs gets a lower false-alarm rate and a more favourable
  verdict. This is directional, and it is likeliest on the long Moodle B05 scenarios.
- **Fix.** Count unresolved healthy runs as false alarms in the headline and verdict (today's `non_green`), and
  report the unresolved share separately. If the explicit-only figure is kept, label it secondary.

### M2. Target steps come from a hand-supplied metadata file at report time

- **Evidence.**
  - `report.py` reads targets only from `--metadata` (`report.py:55`). Cells without a target are silently moved to
    "missing confirmed target" (`score.py`, `read_cells`).
  - The README says to "include a target only after the independent check confirms it". This is a manual step.
  - No committed file holds the targets. The frozen ones live in `plan.json` (`targetStep`) and `symptom.md`.
- **Effect.** A post-hoc, unpublished input decides caught versus detected-elsewhere for every bug cell. It can be
  wrong (see B1) or chosen after results are seen. It is also outside the release that P11 publishes.
- **Fix.**
  - Generate the targets in `scoring/` from `plan.json` and `bugs/*/symptom.md`, with per-arm numbering (B1).
    Filter them by the latest passing P7 check in `bug-checks.jsonl`, as `check-gate` already does.
  - Commit the result with its sha256 in the P11 release. Keep `--metadata` only for levels, rates and cost inputs.

### M3. Rerunning a filter re-runs items that already have a valid result, and the ledger cannot undo that

- **Evidence.** Valid items are skipped only with `--resume` (`bench/runner/run-item:346`). `make run` passes only
  `$(RUN_ARGS)` (`bench/mk/P3.mk`). After any stop alert, the natural "rerun the same filter" adds a second valid
  attempt for every finished item.
- **Effect.**
  - Scoring then raises "multiple valid attempts" (`score.py`, `read_cells`). The append-only ledger cannot be
    repaired, so counts cannot run without a scoring change made after the data exists.
  - If scoring instead picked one attempt, it would be choosing among answers, which plan section 5 forbids.
- **Fix.** Make "skip items with a valid attempt" the default for runs against the frozen plan. Allow repeats only
  with an explicit flag that refuses `plan.json`'s sha256 (smoke and P3 tests only). Add a test.

### M4. The "real bugs" claims no longer match the selected bugs

- **Evidence.**
  - All 38 planned bugs are `re-created-from-report`, and none is a reverted fix (`bugs/*/source.md`,
    `bug-candidates.md`).
  - All 20 payment bugs and 8 of 18 Moodle bugs re-create reports from *other* products: Nextcloud, Dolibarr,
    Expensify, Forem, WooCommerce, Discourse, a course project (Data-Boom/SOEN490), and others. This is allowed by
    the two dated amendments (`bug-rule.md`, owner-approved for payment, coordinator-approved for Moodle).
  - Nine reports are each used for two or more bugs. Examples: Dolibarr #14421 for bank-create and bank-delete, and Forem
    #5459 for social-like and social-comment.
  - PLAN.html still says reports come from "Moodle tracker or the app's GitHub issues" (`PLAN.html:57`). It also says
    "Only the first kind [reverted fixes] is called a real bug in the paper" (`PLAN.html:68`), which leaves zero
    real bugs. Yet section 1, section 12's novelty list and the threats still say "real bugs".
  - The 20 payment `source.md` files lack the required label line (the Moodle ones have it).
  - The bug designs were written to fail at the targeted step ("planned first failing assertions from the feature
    text and UI action definitions", `bug-candidates.md`). So up-to-date step definitions catch them nearly by
    construction. Plan section 6 says real bugs "chosen independently of them can slip past their checks"; that
    claim does not hold.
- **Effect.** Misreported design. A reviewer will see bugs re-created from Nextcloud or WooCommerce reports being
  called "real bugs in Moodle and the payment app".
- **Fix.** Before freeze, update PLAN.html and the paper wording:
  - Call the bugs "re-created from public bug reports". Give counts: 10 from Moodle's own tracker, 28 from other
    open-source products, 0 reverted fixes.
  - Drop "real bugs" from the novelty list.
  - State that each bug was built to break the scenario's targeted step, so the up-to-date step definitions' catch
    rate is not evidence about real-bug detection. Catch retention, which is relative to them, is unaffected.
  - Add the `re-created-from-report` label to the payment `source.md` files. Note the coordinator (not the owner)
    approved the Moodle amendment.

### M5. The Moodle unit count and the S044 exclusion are not recorded consistently

- **Evidence.**
  - S044 is excluded only in commit `36487c1`'s message ("136 user steps > 80-call limit, rule fixed before runs").
    No dated rule text exists in `plan/`. `apps/moodle/changes.json` still marks S044 `eligible`, with
    `eligibleScenarioCount: 19` and `shortfall: 1`.
  - `scenario-review.md` M7 left S044 "for the coordinator to decide". Its screen assumed one call per UI step. The
    smoke shows 16 tool calls for S091's 4 agent steps, so S042 (56 agent steps), S046 (30), S045 (24) and S043 (23)
    will probably also exhaust 80 calls. The rule removes S044 but keeps scenarios the same estimate says will fail.
  - The 18 plan units contain S027, S028 and S029 twice (B01 and B07, adjacent commits). B01-S027 and B07-S027
    re-create the same PrestaShop report. That leaves 15 distinct scenarios.
  - The Moodle verdict threshold counts units (`report.py:109`). B07/S025 (coded-only) is not in `plan.json`,
    although PLAN.html section 11 still counts it.
- **Effect.** The paper's Moodle "N scenarios" will be overstated if it reports 18. The Wilson intervals treat
  duplicated scenarios as independent. The S044 exclusion looks post hoc.
- **Fix.**
  - Add a dated amendment to `plan/` with the exact exclusion rule and the evidence it used. Apply it to every
    scenario.
  - Update `changes.json` for S044 and the counts: 18 scenario-change units, 15 distinct scenarios, shortfall
    against 20.
  - Report Moodle as 15 distinct scenarios in 18 units, and say S027–S029 appear at two changes.
  - Pre-state that B05 agent results will be shown with unresolved runs by cause.

### M6. Records do not pin the code that ran: no scenario hash, template-only prompt hash, live working tree

- **Evidence.**
  - The agent writes `run.json` with `prompt_sha256` and `scenario_sha256` (`bench/agent/run:89`). The runner reads
    only `provenance.json` (`run-item:221`).
  - So every record has `scenario_sha256: null` (`run-item:205`). Its `prompt_sha256` is the env-lock template pin
    (`run-item:204`), not the rendered prompt. This was confirmed in the P9 smoke ledger.
  - Coded payment runs read step definitions and scenarios from the live repository through a bind mount
    (`worker.py:243`, `self.bind(ROOT, "/work")`). Agent stages are copied from the live tree (`stage_agent`).
  - Nothing checks that the tree is clean or at the frozen commit, and no record stores the harness commit.
    `lock-check` covers images and tool pins only.
- **Effect.** An edit to a step definition, scenario or adapter during a multi-day campaign would change the
  treatment silently and could not be detected. The plan's record format (`PRETASKS.md`, Run record) is not met.
- **Fix.**
  - Have `agent/run` and `coded-run` write `provenance.json` with the scenario and rendered-prompt sha256.
  - Make `lock-check` refuse a dirty `bench/`, `study/`, `adapters/` or `scripts/` tree. Record `git rev-parse HEAD`
    in each record and check it against the P11 release commit.

---

## Minor

### m1. Attempts stopped by an alert count toward the 4-attempt cap

Provider-refusal attempts are invalid records (`run-item`, `control.json` branch), and `invalid_tail` counts them
(`run-item:348`). An item hit by refusals across 4 resumes is reported "missing". Plan section 9 says runs stopped
by an alert "are never dropped". **Fix:** exclude `invalid_reason in CONTROL_STOPS` from `invalid_tail`.

### m2. The slow-run stop is off unless `--smoke-times` is passed

`StopRules` uses baselines only from `--smoke-times`, and `make run` does not pass it (`bench/mk/P3.mk`). **Fix:**
default to `bench/smoke/smoke-times.json` for frozen-plan runs.

### m3. An interrupted runner leaves raw directories that block the ledger from loading

`Ledger.allocate` creates `raw/<item>/<n>` before the record exists (`bench/runner/ledger.py:117`). On SIGTERM or a
crash, no record is appended. The next start then fails the inventory check (`ledger.py:81`), and the only recovery
is deleting files from the "immutable" store. **Fix:** in `work()`'s `finally`, append an invalid "interrupted"
record for every allocated attempt.

### m4. The hold-out results are not in the counts script

Plan section 3 reports "all 20 and the 8 hold-out scenarios alone", and section 12 says every number comes from
counts. `report.py` groups only by app and arm. **Fix:** add a hold-out subset (scenario IDs `hold-*`) for catch
rate, retention and false alarms.

### m5. The tool-call limit is 79 executed calls

`if (calls >= toolLimit) { stop; return false }` refuses the 80th call (`bench/agent/session.mjs:44`). The test
codifies this. **Fix:** allow 80 calls (`calls > toolLimit`), or describe the limit as "the 80th call ends the run".

### m6. Step-definition edits made after the first pass are recorded only in a merge message

Merge `27405e7` changed the step definitions of all three versions after the P5 first pass. The commit message is
the only record.
- Edits:
  - the transfer feed check went from recipient plus verb to the exact description text;
  - `invalidEmail` no longer clicks Save;
  - the hold-06 setup binding was removed.
- They match the P4b scenario-text edits and were applied identically to `study/` (v0), v1 and v2.
- `SESSION.md` and `p5-sessions.log` still describe the committed code as the first-pass output.

**Fix:** add a dated section to both `SESSION.md` files listing these edits with diff-check output. State in the
paper that the scenario-text fixes were mirrored by the coordinator, not by the Opus sessions, and are outside the
measured update cost.

### m7. The bug-check log has 68 failing formal-P7 rows that later pass with no recorded reason

The failures (`bug-checks.jsonl`, 16:24–16:44) later pass with the same image and patch digests. The check code
changed in between (`102e529`, `b8b1e15`). `check-gate` admits on the latest pass. I verified that the latest
passing rows match every pinned image in `env.lock.json` (139/139). **Fix:** add a dated note that the early
failures were check-harness errors, and record the check script's sha256 in future rows.

### m8. Coded Moodle runs and agents take different UI paths

Coded Behat runs these scenarios without JavaScript, while the agent browser runs it. S094's agent title drops
"with Javascript disabled", and S091 is affected too (`scenario-review.md` M8, L5). **Fix:** list the affected
scenarios in Threats as a known difference.

### m9. The plan texts are out of date in published places

- PLAN.html section 11 still gives 3 changes, 8 scenarios and 120/189 runs. `plan.json` has 5 changes, 18 units and
  270/486 runs.
- `plan.json` `pay.versions` says v2 "adds a confirmation dialog for deleting a bank account". Spec 1.9 puts it in
  change 1, and change 1 also adds the reject-request dialog (1.10).
- The run record's `image_digests.db` for payment repeats the app digest, although payment has no db container.

**Fix:** regenerate the descriptions and run counts from `plan.json` at P11, and record `db: null` for payment.

---

## Checked and found sound

- **Same app variants.** Payment bug images rebuild v0/v1/v2 plus one committed patch (`images/build.mjs`). Moodle
  bug images overlay the patch on the healthy web image and use the same seed checksum (`build-moodle-bugs.mjs`).
  The latest passing P7 rows match every pinned digest.
- **Same agent setup.** The three agents share one template, the glossary, Codex 0.169.0 flags, tools (shell, web
  search, patch and plan tools disabled; MCP `study` only) and limits. Only model and effort differ, as planned.
- **Isolation.** The agent's egress goes through a CONNECT proxy allowing only `chatgpt.com`, `auth.openai.com` and
  `api.openai.com`. The browser container is firewalled to the app only. `auth.json` is mounted read-only into the
  agent container only. The prompt contains no bug, condition or step-definition information.
  - `/p2input/item.json`, which names the condition and bug, is mounted in the agent container. With Codex's shell
    and file tools disabled, the model cannot read it.
  - Hardening: pass only the fields the adapter needs.
- **First-pass step definitions.** v1 = session 2 (`c1bc41e`) and v2 = session 1 (`4cfee78`), plus the mirrored
  edits in m6. Specs (15:18) were committed before the prompt freeze (15:31) and before P5 started (15:33). The
  hold-outs were blind (inputs: app source only).
- **Ledger and scoring.**
  - The ledger is hash-chained and covers raw files. Retries apply only to invalid attempts, and the cap is 4.
    Provider refusal writes `control.json` and stops new launches; the smoke confirmed a Telegram alert.
  - Wilson intervals, "reliable" (2 of 3 caught and the target passing in 2 of 3 healthy runs), and the
    missing/excluded cell lists match plan section 6.
- **Dated records.** The bug rule (`8088d4b`, 15:09) precedes the first choice. Both amendments are dated and
  precede the choices that use them. The gate passes 13/13 versions.

ready to freeze: no
