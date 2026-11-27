# Stream A1 trace audit: coding rule

Status: post-hoc analysis (decided 2026-11-26, after all runs). It was written before any unit was coded. The
results were run as `exploratory-owner-directed` without a gate pass. This file holds no codes.

## What a unit is

`units.jsonl` holds one unit per counted browser-agent run whose own verdict was not `pass`. `build_units.py` builds it,
and it holds 386 units. Each count script scores `unresolved` as fail, so those runs are included.

- Faulty-build unit: a run on a build with a seeded fault that reported `fail` or `unresolved`. The paper counts it as a catch.
- Healthy-build unit: a run on a build without a fault that reported `fail` or `unresolved`. The paper counts it as a false alarm.

The coder codes each unit independently, from its recorded trace only.

## Evidence the coder may use

1. Primary evidence: the agent trace. This is what the agent did and saw: tool calls, tool results (page URL,
   accessibility snapshot, console and events) and agent messages up to its final verdict. Paths:
   - Payment app: `record.agent.ledger` and `record.agent.rawResponse` in the unit's `paths.trace`. The agent's
     messages are in `paths.log` for campaigns B to D.
   - Moodle: the event-stream blob in `paths.trace`.
2. Unit fields: scenario steps, fault change, target step and reported verdict.
3. Supporting evidence, only when the agent trace cannot settle a point, for example a truncated or missing
   snapshot. This is the raw observer UI samples (`record.witness.states` and `events`). Say so in the note.

The coder must not consult:
- automated grades: `adjudication.jsonl`, `second-grader.jsonl`, clock-recovery grades, and observer conclusions
  such as `record.observation.defectObserved`, `violatedPredicates` and check `status`;
- outcome classes in `results/` (caught, fail-near and the others);
- the other coder's file.

## Codes for faulty-build units

Each case's faulty behaviour is the visible effect of its fault change (`fault_change`). For the payment app:

| case | faulty behaviour a user can see |
|---|---|
| auth-login | valid credentials are rejected ("Username or password is invalid") and the page stays on sign-in |
| auth-logout | Logout does nothing; the user stays signed in and is not on /signin |
| profile-name | the saved first name is not "Study" (it reverts to the old name, after saving or after reload) |
| profile-email | the invalid email is accepted: no validation error and/or Save is enabled, or it is saved |
| bank-create | the new account is listed as "Altered Bank", not "Study Credit Union" |
| bank-delete | Delete has no effect; the bank is not marked "(Deleted)" |
| transfer-pay | the payment amount is $13.00, not $12.00 |
| transfer-request | the request is recorded as a payment ("paid"), not "requested" |
| social-like | Like has no effect; the count does not increase and/or Like is not disabled |
| social-comment | the stored comment reads "Altered comment", not "Study comment" |
| feed-personal | "Mine" opens /contacts or the Contacts feed |
| feed-friends | "Friends" opens /personal or the Personal feed |

For Moodle, the faulty behaviour is the effect named in the fault's `intent`, seen at or after the target step.
For example, X014: the manual completion button is enabled for a teacher when it should be disabled.

Choose exactly one code:

- **CORRECT**: the trace shows that the agent got to the targeted check (it carried out the actions that lead to
  it) and saw the faulty behaviour there or later, and its verdict rests on that behaviour. Two conditions:
  - a tool result shows the behaviour, and
  - the agent's verdict, or a message it wrote, refers to it.

  The step the agent labels may be the action step whose visible effect is the faulty behaviour, for example the
  sign-in step in auth-login. The step position is a separate mechanical field in `units.jsonl`
  (`reported_failing_step_number` against `target_step_numbers`), so a strict variant can be computed later. An
  `unresolved` verdict is CORRECT when it meets the same two conditions.
- **WRONG-REASON**: the run failed for something other than the fault, and the agent did not observe the faulty
  behaviour. Examples are a navigation error, a misread, a tool or time budget, a harness error, or a failure at a
  different step. The agent stopped before the faulty behaviour became visible, or its verdict cites only an
  unrelated cause. If the behaviour was on screen in a tool result but the verdict and messages never mention it,
  code WRONG-REASON and write "symptom visible, not cited" in the note.
- **UNCLEAR**: the evidence does not settle it. Examples:
  - the verdict cites the behaviour but no tool result shows it (snapshot missing or truncated), and the observer
    samples do not settle it either;
  - the verdict cites the behaviour together with an unrelated cause, and the trace cannot tell which one decided
    the verdict.

## Codes for healthy-build units

Code the proximal cause: the earliest event in the trace without which the run would have passed. When the
trace supports two causes equally, take the one the verdict cites.

- **AGENT-ERROR**: the app behaved as the scenario expects, but the agent failed. Examples:
  - it misread a page that showed the expected state;
  - it navigated or acted wrongly, for example the wrong control, a wrong field value or skipping an action;
  - it held an expectation the Gherkin text does not support;
  - it ran out of its tool or time budget mainly through its own wasted or repeated actions.
- **ENVIRONMENT**: a cause outside the agent and outside the app under test. Examples:
  - a harness or browser-tool error or block, a reset or seed-data failure, a network or provider error;
  - a timeout or budget exhaustion where the agent made steady, sensible progress and the time went to slow
    harness or tool responses, or the budget could not cover the scenario.
- **SCENARIO-AMBIGUOUS**: the Gherkin text, with the feature's own instructions, reasonably supports the agent's
  reading, and under that reading the observed (correct) app state fails. The coder must be able to quote the
  words that allow the agent's reading. An example is a step that needs information or a route the visible UI
  does not provide while the feature forbids the shortcut.
- **APP-BEHAVIOUR**: on a healthy build, the app really behaved differently from the scenario's expectation while
  the agent acted correctly. A tool result must show the deviating app output. Examples are flaky loading, a
  count that does not update, a real behaviour difference in Moodle, or a state left over within the run.

## Record format (`codes-coder<N>.jsonl`, one line per unit, every unit coded)

```json
{"unit_id": "...", "code": "CORRECT|WRONG-REASON|UNCLEAR|AGENT-ERROR|ENVIRONMENT|SCENARIO-AMBIGUOUS|APP-BEHAVIOUR",
 "evidence": "one-line quote from a tool result or agent message",
 "pointer": "where the quote is, e.g. ledger tool-result after call #7 / Moodle blob item_12 / rawResponse",
 "confidence": "high|medium|low", "note": "optional, short"}
```

Faulty units take only the first three codes. Healthy units take only the last four.
