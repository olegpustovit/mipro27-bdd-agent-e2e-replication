# Moodle case selection and dropout (stream C, post-hoc analysis, no runs)

Status: post-hoc analysis of existing records. The selection itself was decided before the measured campaign but after
60 model-driven smoke trials (`results/moodle-timeline.txt`); the measured campaign ran in `exploratory-owner-directed`
mode without a gate pass.

Regenerate every count: `uv run followups-2026-11/c-moodle-selection/selection_counts.py` (output in
`selection-counts.txt`). The script re-implements `selectPairs`/`orderOk` from `scripts/moodle/v1-report.mjs`, checks
that it reproduces exactly the 16 campaign cases, and stops on any mismatch.

Sources: `manifests/moodle.yaml` (breaks = mined interface changes, seeded faults X*, mined candidates C*, F*),
`results/moodle-v1-reproduction.{txt,jsonl}` (model-free runs of the developers' own Behat step definitions),
`results/moodle-campaign.txt` (measured campaign), `adapters/moodle/handoff.mjs`.

## Table for the paper

| Stage | Changes | Cases (scenario + fault) | Excluded at this stage (reason) |
|---|---|---|---|
| Mined past interface changes with a developer test fix | 47 | – | 18 not usable: 14 old step definitions passed every probed scenario, 2 no scenario uses the changed steps, 1 repaired step used by no scenario, 1 bites only another change's scenarios |
| Break at least one scenario in arm B's start state | 21 | 30 bitten scenarios in the 8 selected changes | 8 usable changes: no scenario failed |
| Have a valid case: seeded or mined fault makes the developers' tests fail exactly at the target step | 14 | 29 | 7 changes: no fault verified in their bitten scenarios (4 had no fault aimed at them, 3 only mined faults, all rejected) |
| Target step at or after the step the change breaks | 11 | 25 | 4 cases (all cases of B05, B30, B39) |
| Selected (≤3 per change, no repeated fault + scenario, 16 in total) | 8 | 16 (10 faults) | 3 cases repeat B07's fault + scenario (B01); 6 cases over the total of 16 (B34 ×2, B35 ×2, B38 ×2) |
| Run by the browser agents | 7 | 14 (8 faults) | 2 cases (B07.S025, B27.S131): the setup could not hand data steps to Moodle's generators (24 executions, no agent call) |

Arm A (developers' current step definitions) and arm B (updated step definitions) ran all 16 cases.

## Stage details

### 1. The 8 selected changes (B04, B07, B15, B25, B27, B28, B29, B34)
All are class (i) changes: the developers' fix edited step definitions only, not `.feature` files. Only B07 is "strict":
its scenarios passed in the reconstructed before state. For the other 7 the before state could not be built (the UI
hunks do not reverse-apply at the pin) or failed. So their "break" is the developers' old step definitions run against
the current UI. Five of the changes are from 2019 to 2021 (B25, B27, B28, B29, B34); B15 is from 2025 and B04 and B07 are from 2026
(`results/moodle-v1-reproduction.txt`, UI COMMITS).

Upstream exclusions, per change (from `selection-counts.txt`, section A):
- **Not usable (18):** B14, B18, B20–B24, B33, B36, B41, B42, B43, B45 and B46 did not bite: the start state passed in
  every probed scenario. B19 and B47 have no plain scenario using the changed step definitions. B02's repaired step
  is used by no scenario at the pin. B40 bites only B39's scenarios, so it is not a distinct change.
- **Usable but no scenario fails (8):** B03, B06, B08, plus the five class (ii) changes B09–B13. These five bit when the
  whole developer test half was reverted, but they no longer bite in arm B's start state (new UI + new `.feature` + old
  step definitions). As a result no class (ii) change reached selection.
- **Bite but no valid case (7):** B16, B17, B31 and B44 had no fault, mined or seeded, aimed at their bitten scenarios.
  B26 (18 candidates), B32 (61) and B37 (7) had only mined real-fix reverts, all rejected. **NOT FOUND:** why no seeded fault was
  written for these 7 changes; the manifest and the seeded-fault provenance record no reason.
- **Ordering criterion (amendment class-i-first-v3, 2026-11-16):** B05.X013@S043 (target 13 < bite 21),
  B30.C760@S141 (0 < 1), B30.C760@S144 (2 < 3) and B39.X025@S170 (8 < 12) were removed. These were the only valid cases of
  B05, B30 and B39. The two B30 cases were the only valid cases with a mined (real) fault.
- **Selection:** the 3 valid B01 cases repeat B07's (fault, scenario): B01 and B07 bite the same scenarios S024–S029, and
  strict B07 ranks first. The total of 16 was reached inside B34, leaving out B34 S155 and S156 and both cases of B35 and of B38.

### 2. Candidate scenarios in the 8 selected changes
| Change | Scenarios using the changed steps (static) | Probed model-free | Bitten (start state fails, pin passes) | Seeded faults aimed (verified/failed) | Mined candidates aimed (accepted / failed screening / revert does not apply / never screened) | Valid | Selected | Agent cases |
|---|---|---|---|---|---|---|---|---|
| B04 | 30 | 6 | 4 | X014 (1/0) | 0/26/33/57 | 3 | 3 | 3 |
| B07 | 14 | 6 | 6 | X010, X011 (2/0) | 0/28/26/1 | 3 | 3 | 2 |
| B15 | 119 | 4 | 3 | X021, X022 (2/0) | 0/1/0/0 | 2 | 2 | 2 |
| B25 | 19 | 4 | 4 | X020 (1/0) | 0/8/0/0 | 1 | 1 | 1 |
| B27 | 221 | 4 | 2 | X023 (1/0) | 0/0/0/0 | 1 | 1 | 0 |
| B28 | 12 | 4 | 4 | X025 (1/0) | 0/31/13/0 | 2 | 2 | 2 |
| B29 | 58 | 4 | 3 | X026 (1/0) | 0/0/0/0 | 2 | 2 | 2 |
| B34 | 27 | 4 | 4 | X018 (1/0) | 0/7/4/0 | 4 | 2 | 2 |
| **Total** | **500** | **36** | **30** | **10 (10/0)** | **235 distinct: 0/101/76/58** | **18** | **16** | **14** |

"Static" is the manifest's `affected_total`. "Probed" counts the `affected_scenarios` that were run. B04 and B07 also
ran 23 shared scenarios that do not use their steps; none of them bit. **NOT FOUND:** the rule that capped the
probed scenarios at 4 per wave-3 change. It lives in `mining/mine_breaks_v2.py`, which is not in the package. Of the 30
bitten scenarios, 16 became cases and 2 more (B34 S155, S156) were valid but over the cap. In the other 12, no fault
was verified at a target.

### 3. Faults
- **Seeded faults:** 26 written by an LLM subagent (claude-sonnet-5-5; `seeded_provenance` in the manifest). Each
  intent, mutation and expected failing step was frozen in the manifest before its first run. **24 passed verification
  and 2 failed:** X006 crashed the page (a PHP exception from an incomplete edit, aimed at S064) and was replaced by X015.
  X019 failed, but not at the declared step (S157 step 6), and was replaced by X024. Neither of the 2 was aimed at one of the 8 selected
  changes. All 10 seeded faults aimed at the 8 changes passed.
- **Mined real faults** (reverted bug-fix commits) were tried first: 902 candidates (C* and cross-runs). 2 were accepted
  (C007, C760). 340 left every probed scenario passing, 328 did not apply at the pin, 2 were rejected in screening for another
  reason, and 230 were never screened. 19 of the original 24 F* faults reproduced, but none formed a valid case (for example,
  B12.F01@S079 was lost when B12 stopped biting in the start state). Result: 27 of the 29 valid cases used seeded faults and 2 used a mined one (C760, removed by the
  ordering criterion). **All 16 cases use seeded faults.**

### 4. Did the selection rule require the coded tests to catch the fault? Yes.
A case is "valid" only when the developers' own Behat step definitions at the pin **pass on the healthy build and fail
on the faulted build exactly at the target step**. That pin is arm A's code. The target step itself is defined as the
**first failing step of that Behat screening run**, frozen before pairing, and an independent rerun had to fail at the
same step. A seeded fault whose faulted build failed elsewhere was rejected for that scenario. 16/16 selected cases meet this
(section D of `selection-counts.txt`). Arm A's measured 16/16 catches therefore restate a selection condition; they are
not independent evidence of detection. Where it is written:
- `scripts/moodle/v1-report.mjs:87-98` (selection rule comment: "Candidates are the VALID pairs: ... the fault reproduces
  there, and the faulted run fails at the target step"), `:99` (`SELECTION_RULE`), `:30` (one exact step rule for the gate
  and for scoring), `:41` (`reproduced` = faulted run failed and healthy run passed), `:67` and `:77` (`valid_*`).
- `results/moodle-v1-reproduction.txt:5` (step rule) and `:1153` (SELECTION RULE class-i-first-v3).
- `manifests/moodle.yaml:39879` (`seeded_provenance.wave3.rule`: "a scenario where the faulted build fails elsewhere is
  rejected for that scenario") and each fault's `screen_targets[].source` ("first failing step of the screening run ...
  frozen before break pairing").
- `docs/contracts/moodle-campaign.md` is cited by the code as holding the selection rule and its history. **NOT FOUND**
  in this package.

### 5. Dropout in the agent arm (16 → 14)
`adapters/moodle/handoff.mjs:46` runs a scenario's leading data steps (`the following "…" exist`, config values)
through Moodle's generators and gives the agent the UI steps only. It throws when the scenario has no leading data step.
S025 (B07, fault X011) starts with the Background step `Given solr is installed`, and S131 (B27, fault X023) starts with
`Given I log in as "admin"` (feature files at the pin). All 24 arm C executions of these two cases (2 cases × healthy/faulty ×
3 models × 2 repetitions) ended in about 4 ms without an agent call. They are excluded from arm C; arms A and B ran them.
With them went B27 (its only case) and faults X011 and X023, leaving 7 changes and 8 faults for the agents.
The selection did not check this precondition. It was found only in the measured campaign.

## Limitations
- Analysis only: the seeded-fault writer transcripts are not in the package (only hashes and paths), and neither is
  `mining/`. Stages that depend on them are marked NOT FOUND.
- The selection rule was written after 60 model-driven smoke trials. According to `results/moodle-timeline.txt`, 22 of them
  were on one selected case (X010@S028). The wave-3 fault writer had seen smoke results before writing X016–X026
  (manifest `seeded_provenance.wave3.audit`).
- The same agents that wrote the seeded faults also built and ran the screening harness that accepted them (manifest
  audit, `both_writers_ran_the_screening_harness: true`).
