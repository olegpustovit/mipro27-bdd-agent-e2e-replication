# Pre-tasks for plan-1 (frozen 2026-11-27)


## Infrastructure (all under `bench/` in the replication repository)

```
bench/
  Makefile                      one entry point: make lock-check, images, gate, smoke, run, sync, verify, counts
  env.lock.json                 every pinned version and digest (P1)
  plan/plan.json                frozen run items and their sha256 (P11)
  apps/pay/                     Cypress Real World App at 0729f68; versions v0, v1, v2 as patches (P4c)
  apps/moodle/changes.json      eligible Moodle changes with before and after commits (P7c)
  scenarios/pay/*.feature       20 payment scenarios (12 existing, 8 hold-out) (P4, P4d)
  scenarios/moodle/             scenario text per change and commit, old and new text (P7c)
  stepdefs/pay/v0|v1|v2/        up-to-date step definitions per version (P5)
  bugs/<bug-id>/                patch.diff, source.md, symptom.md, check.mjs, applies-to.json (P7b, P7d)
  prompt/                       template.md, glossary.md, practice/ scenarios never scored (P8)
  images/                       Dockerfiles: pay app per variant, Moodle per variant, browser, codex agent (P2a)
  runner/                       run-item CLI, worker pool, block shuffle, stop rules, alerts (P2, P3, P0)
  agent/                        Codex CLI adapter: prompt rendering, answer parsing, limits, token capture (P3c)
  scoring/                      cell list, scoring, intervals, counts script, worked-example tests (P3b)
  ledger/                       append-only attempts.jsonl and raw/<item>/<attempt>/ files (P3)
  sync/                         ledger to dashboard sync (P3d)
  tools/                        lock-check, secret-scan, diff-check, verify-ledger (P1, P0, P5, P3)
```

**Run record** (one JSON line per attempt in `ledger/attempts.jsonl`):
plan_id, plan_sha256, item_id, attempt, worker, started_at, finished_at, image digests (app, db, browser, agent),
tool versions, model, effort, prompt_sha256, scenario_sha256, bug_id, valid (true or false with reason),
coded result (passed, failing step, assertion message) or agent answer (status, failing step, reason, raw text),
unresolved cause, tokens (input, cached, output), minutes, tool calls, trace_sha256, raw_dir,
prev_record_sha256, record_sha256.

**Credentials:** the Codex login (`~/.codex/auth.json`) is mounted read-only into agent containers only.
Telegram uses TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID from `~/projects/researcher/.envrc`, read by the runner
on the host, never passed into containers. No secret is written to the ledger, raw files or logs.

**Network:** browser containers reach only their app; agent containers reach only the browser and the OpenAI
endpoints Codex needs.


## Wave 1

### P1. Pin the environment

- Built by: Codex fleet
- Needs: nothing

Create bench/ and env.lock.json with every pinned version, and a lock check the runner calls before any run.

Deliverables:
- bench/ skeleton and Makefile
- env.lock.json: image digests, Node, Playwright, Playwright MCP 0.0.84, Codex CLI 0.169.0, model IDs (gpt-6-luna, gpt-5.6-terra, gpt-6.2-sol) and reasoning effort, prompt sha256
- tools/lock-check

Accepted when:
- [x] make lock-check passes on a matching host
- [x] changing any pinned value or an image digest makes make lock-check fail with the differing field named
- [x] the runner refuses to start when lock-check fails (test)

### P0. Credentials and alerts

- Built by: Codex fleet
- Needs: P1

Mount the Codex login read-only into agent containers only. Build the Telegram notifier and a secret scanner.

Deliverables:
- runner/alerts: send(text) to TELEGRAM_CHAT_ID
- tools/secret-scan over ledger/, raw files and logs
- container mount config for ~/.codex/auth.json (read-only, agent containers only)

Accepted when:
- [x] a codex exec call with a one-word prompt succeeds inside an agent container
- [x] the owner receives a Telegram test message (API returns ok=true)
- [x] secret-scan finds a planted fake token in a test fixture and finds nothing in a real smoke run's outputs
- [x] auth.json is not present in app or browser containers (test)

### P0b. Source the good-enough levels

- Built by: Research session (not the fleet)
- Needs: nothing

Find published, read and cited figures for acceptable test-failure or flaky-test rates in practice. Set the catch-retention and false-alarm levels from them, or fall back to 80% and 10% labelled as our choice.

Deliverables:
- bench/plan/levels.md with the two levels, sources (URL, pages, read depth) and reasoning
- a Foundry fact with the sources

Accepted when:
- [x] every cited figure has a source that was opened and a page or section pointer
- [x] the levels are written before the freeze (P11)

### P4c. Blind interface-change specs

- Built by: Blind fresh session (not the fleet)
- Needs: nothing

A fresh session that sees only the published breakage types (WATERFALL and the studies it summarises) and the payment app's source at 0729f68 writes the specs for change 1 and change 2. It never sees scenarios, step definitions, agents, the prompt or any run.

Deliverables:
- bench/apps/pay/specs/change-1.md and change-2.md, each mapping every edit to a breakage type
- the session ID and the exact inputs it was given

Accepted when:
- [x] each spec keeps the app's behavior the same and changes only the interface
- [x] change 2 builds on change 1
- [x] the specs are committed before P5 and P8 start (git history)

### P4. Fix our two known test mistakes

- Built by: Codex fleet
- Needs: nothing

The payment feed scenarios name their transaction by what the screen shows (people, amount, note), never by a hidden ID. Moodle's setup runs every data step wherever it occurs, so the agent gets only steps a user performs.

Deliverables:
- updated scenarios/pay feed scenarios and their step definitions for v0
- runner support for non-leading Moodle data steps in setup

Accepted when:
- [x] model-free calibration passes for both feed scenarios on v0 (healthy passes)
- [x] a Moodle scenario with a non-leading admin data step gets that step done by setup, and the agent prompt contains only user steps (test)

### P4d. Write 8 hold-out scenarios

- Built by: Blind fresh session (not the fleet)
- Needs: nothing

A session that never saw earlier runs, agents or the prompt writes 8 new payment-app scenarios covering features the 12 do not. It names only what a user can see. Also write a short log of what the exploratory runs changed in the design (written by the coordinator from the records, not by the blind session).

Deliverables:
- scenarios/pay/hold-01..08.feature
- the blind session ID and its inputs
- bench/plan/exploratory-log.md

Accepted when:
- [x] 8 scenarios, each with Given/When/Then and a targeted check
- [x] no scenario overlaps the existing 12 in feature
- [x] the exploratory log lists each design change and the run records behind it

### P7b. Choose the real bugs

- Built by: Codex fleet
- Needs: nothing

Freeze the bug-selection rule, then apply it per scenario: prefer a real fix from the app's history that can be reverted at the tested commit; otherwise re-create a specific real bug report, cited by ID: for Moodle from its own tracker; for the payment app, whose own history has no fitting bug, from another open-source web application's public tracker with the same failure in the same kind of component (amendment of 27 Nov). The rule never looks at either approach.

Deliverables:
- bench/plan/bug-rule.md, committed before any bug is chosen
- a candidate log per scenario: candidates considered, chosen, rejected with reason

Accepted when:
- [x] every payment scenario (20) and every Moodle scenario has exactly one chosen bug with a source link
- [x] each bug is labelled reverted-fix or re-created-from-report
- [x] git history shows the rule committed before the first choice

### P7c. Choose the Moodle changes

- Built by: Codex fleet
- Needs: nothing

Publish the mining query and its output. Apply the frozen rule to the 21 mined changes in history order: eligible if both commits build into a working site on the current runtime (PHP 8.3, Postgres 17) with the scenario setup running, and at least one touched scenario passes with the developers' step definitions before the change and can be prepared for the agent. List scenarios whose text the developers edited.

Deliverables:
- bench/apps/moodle/mining-query and its output
- bench/apps/moodle/changes.json: chosen and rejected changes with reasons
- the list of edited scenarios (they get old-text agent runs)

Accepted when:
- [x] every one of the 21 changes has a recorded decision and reason
- [x] the rule uses no agent outcome
- [x] the Moodle scenario count is recorded against the target of 20

### P3c. Codex agent adapter

- Built by: Codex fleet
- Needs: P1

Run one scenario through Codex CLI with the pinned model and effort, Playwright MCP as the only tool, the rendered prompt, a 5-minute and 80-tool-call limit, and the fixed answer format.

Deliverables:
- agent/run: render prompt, invoke codex, enforce limits, capture tokens and tool calls
- agent/parse: read status, failing step and reason from the required answer format

Accepted when:
- [x] a run against a fixture app returns a parsed answer and token counts
- [x] hitting 5 minutes or 80 tool calls ends the run as unresolved with the cause
- [x] an answer without the required format is recorded as unresolved: no readable answer
- [x] parser unit tests cover every answer form, including step given by number or by text

### P3. Run-item runner and immutable ledger

- Built by: Codex fleet
- Needs: P1

run-item runs one plan item or a filtered group in shuffled block order with a recorded seed, appends a hash-chained record, keeps raw files, and applies the stop and retry rules.

Deliverables:
- runner/run-item CLI (--item, --filter, --workers, --seed)
- ledger/attempts.jsonl and raw/<item>/<attempt>/
- tools/verify-ledger
- stop rules wired to alerts: provider refusal, 2 invalid in a row, 3 slow runs in a row, failed gate, low memory or disk

Accepted when:
- [x] running an item twice gives attempts 1 and 2; nothing is overwritten
- [x] verify-ledger passes on a real ledger and fails after any byte of an earlier record or trace is changed
- [x] an invalid attempt is quarantined and retried up to 3 times, then the item is reported missing
- [x] each stop condition, simulated, stops new launches and sends one Telegram message
- [x] the block order is reproducible from the seed

### P3b. Cell list and scoring code

- Built by: Codex fleet
- Needs: nothing

Generate the full cell list and implement scoring exactly as plan section 6: caught (failing step equals the targeted step), detected elsewhere, missed, false alarm, unresolved by cause, reliable catch (2 of 3 with the same step passing in 2 of 3 runs without the bug), catch rate, catch retention, false alarms, all-green suite chance, one-run and best-of-3 results, Wilson intervals, the gap measure, cost per suite and per caught bug, break-even.

Deliverables:
- scoring/cells.py and the committed cell list
- scoring/score.py and report.py
- scoring/tests/ with worked examples of every outcome and every edge case (empty denominators, missing cells, ties)
- scoring/counts: prints every paper number with the ledger hash it read

Accepted when:
- [x] all worked-example tests pass
- [x] Wilson intervals match a reference implementation on test values including 0 of n and n of n
- [x] counts on a synthetic ledger reproduce hand-computed values
- [x] missing or incomplete cells are excluded and listed, never silently dropped

### P6tool. Assertion diff check

- Built by: Codex fleet
- Needs: nothing

A tool that compares step definitions before and after an update and rejects any removed or weakened check.

Deliverables:
- tools/diff-check

Accepted when:
- [x] it flags a deleted expect, a loosened matcher and a removed step binding in test fixtures
- [x] it passes a pure locator rename

## Wave 2

### P4c2. Build v1 and v2 from the specs

- Built by: Codex fleet
- Needs: P4c

Implement change 1 and change 2 exactly as specified, as patches on the app.

Deliverables:
- bench/apps/pay/v1.patch and v2.patch
- a mapping from each spec item to its code change

Accepted when:
- [x] both patches apply cleanly in order to 0729f68
- [x] every spec item maps to a code change and no code change lacks a spec item
- [x] the app builds and starts for v0, v1 and v2

### P4b. Review every scenario

- Built by: Fresh reviewers (not the fleet)
- Needs: P4, P4d, P7c

A fresh reviewer checks every payment and Moodle scenario and its setup for things a user cannot see or do, ambiguous wording, setup steps handed to the agent, and checks that do not match the text.

Deliverables:
- bench/plan/scenario-review.md with findings and their fixes

Accepted when:
- [x] every finding is fixed or explained
- [x] no scenario has an open finding

### P7d. Commit the bugs in the harness

- Built by: Codex fleet
- Needs: P7b, P4c2

Commit each chosen bug as bugs/<bug-id>/ with its patch, source, symptom, independent check and versions.

Deliverables:
- bugs/<bug-id>/patch.diff, source.md, symptom.md (what goes wrong, at which step), check.mjs, applies-to.json

Accepted when:
- [x] each patch applies cleanly to every version in applies-to.json
- [x] symptom.md names the targeted scenario step
- [x] image builds read only these folders (P2a test)

### P2a. Prebuild every container variant

- Built by: Codex fleet
- Needs: P1, P4c2, P7d, P7c

One image per app variant: each payment version and each Moodle change commit, with no bug and with each bug, database already seeded. Plus the browser image and the Codex agent image.

Deliverables:
- images/ Dockerfiles and a build script
- digests written to env.lock.json
- startup time per variant in bench/plan/startup.json

Accepted when:
- [x] every variant in the plan has a pinned image
- [x] a fresh container of each variant is ready (health check passes) and its startup time is recorded
- [x] two containers of the same variant start with identical database state (checksum test)

### P2. Isolated parallel workers

- Built by: Codex fleet
- Needs: P2a, P0

One command starts N isolated workers. Each run gets fresh containers from the images, a private network, and Playwright MCP as the agent's only tool.

Deliverables:
- runner/pool: start N workers, assign items, tear down containers after each run
- network policy: browser reaches only its app; agent reaches only the browser and OpenAI endpoints

Accepted when:
- [x] N workers run side by side without sharing state (concurrent test writes in one worker never appear in another)
- [x] an agent container cannot reach the app's database or the internet beyond OpenAI (test)
- [x] no container survives its run

### P3e. Coded runner adapter

- Built by: Codex fleet
- Needs: P3, P4, P4d

Run one scenario with step definitions and record the result in the coded-run contract: Cucumber with bench/stepdefs/pay/<version>/ against a payment app variant, and Behat with the developers' step definitions against a Moodle commit. Added 27 Nov: no task owned this adapter.

Deliverables:
- bench/runner/coded-run --item <item.json> --out <dir> writing coded.json (status, failed_step, failed_step_text, message, minutes)
- 1-based step numbering matching the agent adapter

Accepted when:
- [x] on payment v0 without bugs, every scenario reports pass
- [x] a scenario with a forced failure reports the right failing step number and text
- [x] a Moodle scenario runs through Behat at a given commit and reports pass or its failing step
- [x] the runner (P3) invokes it in place of the stub

### P3d. Dashboard sync

- Built by: Codex fleet
- Needs: P3

Push ledger results to the dashboard database every 15 minutes and at the end of each batch: per item, latest outcome and the list of attempts.

Deliverables:
- sync/: writes res-<app>-<arm>/<item-id> documents with status, outcome, failing step, tokens, minutes and attempts
- pre-task status writes to pretasks/<id>

Accepted when:
- [x] after a smoke run, the dashboard squares show the right colors and the detail panel lists every attempt
- [x] sync is idempotent: running it twice changes nothing

### P8. Freeze the prompt

- Built by: Codex fleet
- Needs: P3c

Write the shared template and glossary, tune them only on practice scenarios that are never scored (2 payment, 1 Moodle, outside the plan), then freeze with a hash.

Deliverables:
- prompt/template.md, glossary.md, practice/
- the prompt sha256 in env.lock.json

Accepted when:
- [x] no scored scenario appears in practice/ (check)
- [x] the hash in env.lock.json matches the files

## Wave 3

### P7. Independent bug check

- Built by: Codex fleet
- Needs: P7d, P2a

For each bug, check.mjs reads the app's state (database or API) or page directly, without step definitions or agents, and confirms the bug happens and is visible at the targeted step, while the same version without the bug is correct.

Deliverables:
- check results per bug and version in bench/plan/bug-checks.jsonl

Accepted when:
- [x] every bug passes on every version where it runs
- [x] every bug-free version passes the same check's correctness half
- [x] where a check is an absence (for example buttons no longer shown), it also confirms the underlying state (for example the request is rejected in the database), so an open dialog cannot make it pass
- [x] check.mjs imports nothing from stepdefs/ or agent/ (lint test)

### P5. Update the payment step definitions

- Built by: Claude Opus 5.5 in Claude Code (not the fleet)
- Needs: P4c2, P4, P4d, P6tool

Claude Opus 5.5 in Claude Code updates the step definitions v0 to v1, then v1 to v2, each in 3 separate sessions. The first session that passes provides the committed code, fixed before the others are looked at. Locators may change, and actions the new interface requires (such as confirming an added dialog) may be added; no check may be removed or weakened. Every change diff-check flags is reviewed by the coordinator and recorded (rule clarified 27 Nov).

Deliverables:
- stepdefs/pay/v1 and v2, committed
- per session: tokens, minutes and dollars from Claude Code's records
- the diff-check report per update

Accepted when:
- [x] all 20 scenarios pass on v1 and v2 without bugs
- [x] the diff check finds no removed or weakened assertion
- [x] all 3 sessions' costs are recorded, passing or not

### P6. All-pass gate

- Built by: Codex fleet
- Needs: P5, P2a

On every version without a bug, the up-to-date step definitions pass every scenario: payment v0, v1 and v2, and for Moodle the before-change code at the earlier commit and the after-change code at the later one.

Deliverables:
- runner gate command and its records

Accepted when:
- [x] the gate passes on every version
- [x] the runner refuses items on a version whose gate failed (test)

## Wave 4

### P9. Harness smoke check

- Built by: Codex fleet
- Needs: P2, P3, P3b, P3c, P3d, P6, P7, P8

End to end before measured runs; smoke runs are not counted.

Deliverables:
- make smoke and its report

Accepted when:
- [x] N workers start in parallel and the worker count is set from measured memory and time
- [x] one item per approach and app runs end to end and appears in the ledger and on the dashboard
- [x] a deliberately bad Codex login stops the runner and sends the Telegram alert
- [x] secret-scan of all smoke outputs finds nothing
- [x] per-run times per approach are recorded for the slowness rule

### P10. Cold review

- Built by: Fresh reviewers (not the fleet)
- Needs: P9

Fresh reviewers check the built harness against this plan, calibrated to accepted MIPRO SSE papers.

Deliverables:
- bench/plan/review.md

Accepted when:
- [x] every substantive finding is fixed

## Wave 5

### P11. Freeze and publish the plan

- Built by: Codex fleet
- Needs: P10, P0b

Regenerate plan.json with each scenario's real bug and the eligible Moodle changes, then publish it as plan-1 in a public timestamped release before the first measured run.

Deliverables:
- plan/plan.json with its sha256
- a public release of the replication repository containing the plan, cell list, scoring code and bug folders

Accepted when:
- [x] the release exists and its plan sha256 matches the runner's
- [x] the dashboard shows plan-1 as frozen
- [x] make run refuses a plan whose sha256 differs from the release
