# P4b scenario review

Reviewer: fresh session, 2026-11-27, branch `pretask/P4b` at `0157cdf`. Scenarios were not edited.

## Scope

- **Payment app, original 12:** from `study/scenarios.feature`. social-like and social-comment come from `bench/scenarios/pay/social-*.feature`, the P4 versions without the hidden ID. The two feed scenarios still live only in `study/scenarios.feature`.
- **Payment app, hold-outs:** `bench/scenarios/pay/hold-out/hold-01..08.feature`, with `notes.md` and `bench/stepdefs/pay/v0/hold-out-targets.json`.
- **Moodle:** every scenario that `bench/apps/moodle/changes.json` marks `eligible` for B15, B01, B04, B05 and B07: 19 scenario units, 16 different texts. The pre and post extracts are byte-identical for all of them. B07/S025 is `coded-only` and is never given to the agent, so it is listed but not reviewed for the agent.
- **Hand-off:** `bench/runner/moodle/handoff.mjs`, `adapters/moodle/handoff.mjs`, `bench/apps/moodle/scenario-setup.mjs`, `bench/prompt/template.md`, `bench/prompt/glossary.md` and `bench/agent/run`.

The facts below were checked against RWA `0729f68` (`data/database.json`, `src/`) and against the runner code. The checks were run with throwaway scripts outside the repo.

## Severity

- **High:** the agent is asked to do setup, or cannot do or see what the step needs. A correct agent can fail, or the run is not the planned test.
- **Medium:** a reasonable reader can take the step two ways, or the step names something that is not on screen. A careful agent can usually work around it, but false alarms are plausible.
- **Low:** wording or bookkeeping. Unlikely to change an outcome.

## Harness findings (apply to several Moodle scenarios)

| ID | Sev | Check | Finding | Proposed fix |
|---|---|---|---|---|
| H1 | High | 3 | `bench/runner/moodle/handoff.mjs` decides what setup does with `isDataStep`, which only matches `the following "…" exist(s)` and config steps. `quiz "Quiz 1" contains the following questions:` does not match, so the runner gives it to the agent as a UI step in all six B05 scenarios (S042–S047). `changes.json` and `scenario-setup.mjs` treat it as setup, so the two disagree. A script that compares the runner's UI steps with `changes.json` `handoff.ui` matches for every eligible phase except these 12 (6 scenarios × pre/post). | Add `^quiz "[^"]+" contains the following (questions\|sections):?$` to `DATA_STEP` in `adapters/moodle/handoff.mjs`. Add a test that runs `planHandoff` on every eligible extract and checks that its UI steps equal `changes.json` `handoff.ui`. |
| H2 | High | 1 | Agents are never told the passwords. Steps say `I log in as "teacher1"`, `… logged in as student1` or `I log in as "admin"`. The frozen `template.md` has no accounts slot (`{{url}}`, `{{scenario}}`, `{{glossary}}`, `{{answer_format}}` only), and `seededCredentials` never lists `admin`. The older `adapters/moodle/prompt.mjs` listed accounts and pre-authenticated only the first log-in. S040, S041 and S046 switch users partway through, so even pre-authentication would not cover them. | When the runner prepares the agent-facing file, add an unnumbered Background line that names every account the UI steps use and its password: Behat users use password = username, plus the admin password. This is the form the practice scenario already uses (`I sign in using the practice account … and password …`). |
| H3 | High | 3 | Nothing builds the agent-facing Moodle file from the hand-off yet. `bench/agent/run`'s default path `scenarios/moodle/<version>/<scenario>.feature` cannot name `S042.pre.feature`, because the segment regex rejects `.`. The extracts keep their Background data steps (`the following "users" exist`, …), and `template.md` tells the agent to "Complete any Background setup". If an extract is passed as `BENCH_SCENARIO_FILE`, the agent is asked to create users, courses and quizzes. | The runner writes `BENCH_SCENARIO_FILE` from `prepareForAgent(...).uiSteps`, with the H2 account Background, and never from the extracts. Add a test that no prepared file contains a `DATA_STEP` line and that agent step N maps back to `behatStepIndex`. |
| H4 | (umbrella) | 1 | Behat locator words that a user does not see: CSS classes (`.notifywarning`, `.numberofquestions`, `.last-add-menu`), field ids and names (`item_qtype_description`, `submitbutton`, `id_submitbutton`, `menuquestionsperpage`), the `region-main` id and the page type `"mod_quiz > Edit"`. `prompt.mjs` used to explain these selector words; the frozen template and glossary do not. The Medium cases, where the step is a check or the only way to act, are counted per scenario as M1–M6 below. **L6 (Low):** `"mod_quiz > Edit"` in S042–S047 reads well enough as the quiz's Questions page. | Keep the developers' text for the coded run. For the agent, publish one fixed paraphrase per affected step with the same step count and order, stored and hashed next to the prepared file. For example: `".notifywarning" "css_element"` → "the warning notice", `"submitbutton"` → "Add", `"id_submitbutton"` → "Save changes", `"menuquestionsperpage"` → "Questions per page". The glossary is frozen (P8), so do not change it. |

## Payment app: original 12

| Scenario | Result | Findings and proposed fixes |
|---|---|---|
| auth-login | ok | Target step 4 matches the planned bug. |
| auth-logout | ok | Target step 4. Reload at step 5 comes after the target, as intended. |
| profile-name | Low | **L1 (check 2):** "my displayed full name" — the side menu shows first name plus last initial ("Ted P", then "Study P"), not a full name. *Fix:* "the name shown in the side menu contains "Study"". |
| profile-email | Medium | **M12 (check 2):** "When I attempt to save invalid email" — with an invalid email, Save is disabled (`disabled={!isValid…}`), so a literal reader cannot attempt the save and may fail step 3 on the healthy app. Step 5 then expects Save to be disabled. *Fix:* "When I enter "invalid-email" in the Email field and leave the field". |
| bank-create | ok | |
| bank-delete | ok | The app shows "(Deleted)" after the name, so "visibly marked deleted" is checkable. |
| transfer-pay | Medium | **M9 (check 2):** `with "Kristian" as "paid"` can be read as "Kristian paid". The row reads "Ted Parisian paid Kristian Bradtke" with "-$12.00". *Fix:* `Then my personal feed contains one visible "Study payment" transaction reading "Ted Parisian paid Kristian Bradtke" for $12.00`. |
| transfer-request | Medium | **M10 (check 2):** same as M9 (`"Kristian" as "requested"`). The row reads "Ted Parisian requested Kristian Bradtke" with "+$12.00". Also, `"Request" "12" dollars to "Kristian Bradtke"` reads better as "request $12 from Kristian Bradtke". *Fix:* the same rewording as M9. |
| social-like (bench) | Low | Checked in the seed: (Ted, Lia, $204.68, note) names exactly one transaction (`1xfcAhNDZK4`; 30 transactions share the note, only one has that amount). Ted has not liked it, and it has no comments. **L2 (check 2):** "the feed transaction" does not name the feed. It is about row 8 of the Everyone feed's first page but row 34 of Mine, below the first page. *Fix:* "When I open, from the Everyone feed, the transaction where …". Target step 10 matches the planned bug. |
| social-comment (bench) | Low | **L3:** same as L2. Target step 6 matches. |
| social-like / social-comment in `study/scenarios.feature` | Low | **L4 (check 1):** the superseded versions with the hidden ID `1xfcAhNDZK4` are still in `study/scenarios.feature`. *Fix:* remove them or mark them superseded, and point scoring at the `bench/scenarios/pay` versions only. Also add the pending `bench/scenarios/pay/feed-*.feature` files named in `bug-candidates.md`. |
| feed-personal | ok | |
| feed-friends | ok | |

## Payment app: hold-outs

| Scenario | Result | Findings and proposed fixes |
|---|---|---|
| hold-01 | ok | The seed has exactly one "Kristian Bradtke liked a transaction." notification for Ted. "Dismiss" is a text button at the agent's 1280 px viewport. Target step 5. |
| hold-02 | ok | The dialog title "Get Started with Real World App" is in `UserOnboardingContainer.tsx`. Target step 4. |
| hold-03 | ok | The message "Password does not match" is in `SignUpForm.tsx`. Target step 4. |
| hold-04 | ok | The seeded phone is 398-225-9900. Target step 7 comes after the reload. |
| hold-05 | ok | Ruthie matches "Ruthie" only through her first name (username Reyes.Osinski, email Norma27@gmail.com), so the planned "omit first-name matches" bug can show at step 5. |
| hold-06 | High | **P1 (check 3):** `Given Lia Rosenbaum (…) has requested $25.00 from Ted Parisian for "Concert tickets"` is numbered step 1, so the agent must sign in as Lia, create the request and sign out before the real test starts. `notes.md` allows UI or API for this, which hands the choice to the agent. *Fix:* setup creates the request through the API before hand-off. Remove the step from the numbered steps and put the fact in the Feature description as already done ("Setup has already created a $25.00 request from Lia Rosenbaum to Ted Parisian for "Concert tickets"."). Don't put it in a Background: the template tells the agent to complete Background setup. Renumber `hold-out-targets.json` (6 → 5). |
| hold-07 | High | **P2 (check 3):** same as P1, with $30.00 for "Pizza night". Renumber the target (6 → 5). |
| hold-08 | Medium | **M11 (check 2):** Mine rows show signed amounts ("+$15.00", "-$15.00"), so a literal reader may judge a "-$15.00" row as not between $10.00 and $20.00 and raise a false alarm. *Fix:* "every listed transaction's amount, ignoring its + or − sign, is between $10.00 and $20.00". 11 seeded rows qualify and the page size is 10, so optionally say "after scrolling to the end of the list". |

## Moodle

Every Moodle scenario also depends on H2 and H3, and the B05 scenarios also on H1. The table lists only what is specific to each scenario. The pre and post texts are identical, so one review covers both phases.

| Change / scenario | Result | Findings and proposed fixes |
|---|---|---|
| B15 / S091 log-in user block on the Dashboard | Low | **L5 (check 2):** no step goes to the Dashboard. The run depends on where Moodle lands after log-in. The old arm-C path went to `/my/` explicitly, but under the frozen template the agent logs in itself. *Fix:* confirm on both commits that log-in lands on the Dashboard. If it does not, have setup set the default home page to Dashboard. The coded run is non-JS (no `@javascript`); the agent's browser runs JS. Record this as a known difference. |
| B15 / S093 accessibility review block | ok | Uses `admin` (H2). |
| B15 / S094 activity results block | Medium | **M8 (check 2):** the title says "with Javascript disabled", but the agent's browser runs JS. The agent may try to turn JS off, or doubt the scenario. The coded run takes the non-JS path (no `@javascript`) and the agent takes the JS path. *Fix:* drop that clause from the agent-facing title, and record that the two approaches use different UI paths for this scenario. |
| B01, B07 / S027 banner shown | Medium | **M1 (check 1, H4):** `in the ".notifywarning" "css_element"` is a CSS class. *Fix:* paraphrase as "in the warning notice on the search results page". Uses `admin` (H2). |
| B01, B07 / S028 banner disabled | Medium | **M2 (check 1, H4):** `".notifywarning" "css_element" should not exist`. *Fix:* paraphrase as "no warning notice is shown". |
| B01, B07 / S029 banner blank | Medium | **M3 (check 1, H4):** the only check is `".notifywarning" "css_element" should not exist`, so the whole verdict rests on a CSS class. *Fix:* as M2. |
| B04 / S036 | ok | |
| B04 / S037 | ok | Coded run is non-JS; agent runs JS (note only). |
| B04 / S040 | ok | Switches to `student1` partway through (H2). |
| B04 / S041 | ok | Switches to `student1` partway through (H2). |
| B05 / S042 move by click | Medium | H1. **M4 (check 1, H4):** `I set the field "item_qtype_description" to "1"`, `I press "submitbutton"` and `I press "id_submitbutton"` name hidden ids. On screen they are the "Description" question type, "Add" and "Save changes". *Fix:* paraphrase. **M7 (length):** see S044. |
| B05 / S043 delete | ok | H1 only (the quiz step sits after log-in, which `hoist` handled in `changes.json` but the runner does not). |
| B05 / S044 repaginate | Medium | H1. **M5 (check 1, H4):** `"menuquestionsperpage"` (on screen: "Questions per page"), `"region-main" "region"` (the main content) and `the "last" add to quiz menu` (the Add menu at the bottom). *Fix:* paraphrase. **M7:** 136 UI steps (S042 has 56) under the 80-call and 5-minute limits. A healthy run may end unresolved whatever the bug. *Fix:* treat P6's healthy gate as the decider. If healthy runs time out, exclude the scenario with that reason rather than editing it. |
| B05 / S045 | ok | H1 only. |
| B05 / S046 | ok | H1. Switches to `student1` partway through (H2). |
| B05 / S047 section heading option | Medium | H1. **M6 (check 1, H4):** `I click on ".numberofquestions" "css_element"` (a click on the "Questions: N" summary that only closes the menu) and `".last-add-menu" "css_element"` (the bottom Add menu). *Fix:* paraphrase as "close the open menu (click the Questions: N summary)" and "the Add menu at the bottom of the page". |
| B07 / S025 | n/a | `coded-only`; never given to the agent. |

**Check 5 for Moodle:** targeted steps cannot be reviewed yet. `bug-candidates.md` lists every Moodle scenario as `TODO (P7c)` with no bug or targeted step. Recheck when P7b/P7d record them.

## Counts

| Severity | Count | IDs |
|---|---|---|
| High | 5 | H1, H2, H3, P1 (hold-06), P2 (hold-07) |
| Medium | 12 | M1–M12 (M1–M6 share the H4 paraphrase fix) |
| Low | 6 | L1–L6 |

Scenarios with no finding: auth-login, auth-logout, bank-create, bank-delete, feed-personal, feed-friends, hold-01..05, S093*, S036*, S037*, S040*, S041*, S043*, S045*, S046*. (*Clean apart from the harness findings H1–H3, which must still be fixed before any Moodle run.)
