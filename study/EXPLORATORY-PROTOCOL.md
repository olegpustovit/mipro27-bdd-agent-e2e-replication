# Exploratory campaign protocol

Status: `exploratory-owner-directed`, `gatePassExists: false`. Foundry's Evidence gate for piece `mipro27-bdd-agent-e2e` is STOP. The owner directed this run on 2026-11-01. Any report of these results says they were run without a gate pass.

Frozen before the first measured trial. The code and configuration hashes are recorded in each campaign's `journal.jsonl`.

## Question

For one open-source payment demo and the same frozen Gherkin scenarios: what does replacing maintained Cucumber step code with a language-model browser agent gain and lose, in behavior carried out, supported fault detections, false alarms, run resources and repair effort, across a series of interface changes?

## Design

- Application: Cypress Real-World App at the pinned commit. 12 scenarios in 6 families, 12 seeded faults, UI revisions v0, v1, v2.
- Arms: `maintained` (Cucumber with shared actions and locators, repaired and carried forward) and `runtime` (fresh Codex agent per scenario run, no step code, no memory of other runs).
- Stages, in order: healthy-v0; fault-v0 repetitions 1 and 2; maintenance-v1; healthy-v1; maintenance-v2; healthy-v2 repetitions 1, 2, 3; fault-v2 repetitions 1 and 2. That is 9 x 12 x 2 = 216 executions, in the arm order from `cumulativeStages`.
- This restores the proposed 216-execution trajectory; a one-day cut to 120 was never used, because an excluded run showed about 13 to 32 seconds per agent scenario. Repetitions show verdict consistency for this model and application. They are not independent systems.
- Implementations freeze before each probe stage. Probe results and repairs never feed back. No repair during probes.
- Excluded: all earlier pilots, Claude sessions and test runs.

## Model and boundary

- Agent under test and repair agent: `gpt-6-luna`, effort `medium`, Codex CLI 0.159.3. Luna is a low-cost model; results say nothing about stronger models.
- Sandbox: `bwrap` with the repo, oracle, private mappings, run data and home directory absent. A catalog override removes shell, patch and collaboration tools. Native `list_mcp_resources`, `list_mcp_resource_templates` and `read_mcp_resource` remain and reach only the study proxy, which exposes no resources.
- Browser tools come through the restricted proxy over a loopback bridge, with the same `browser_reload` extension for both arms.
- The response model is read from the session rollout, and `modelVerified` records it.

## Outcomes

Reported per arm and stage, always as counts over denominators:

- Healthy stages: complete observable contract fulfilled; reported verdict; false alarms.
- Fault stages: supported detections; unsupported passes; wrong-reason failures.
- All stages: action failures; timeouts; infrastructure-invalid; wall time; tokens.
- Maintenance: repair time, accepted edits, tool calls and suite runs per transition, and which scenarios broke per transition. Tokens and agent time are not human time. Construction cost is unmeasured and is never imputed as zero.
- Consistency: verdict agreement across repetitions of the same scenario and stage.

## Adjudication rules, frozen

The deterministic evaluator runs first. It cannot itself confirm a detection. A fresh Codex reviewer on `gpt-5.6-terra`, which ran and repaired nothing, then reads each failure report and each evaluator-versus-verdict disagreement against the recordings, with arm labels removed where feasible. Both results are kept and neither overwrites the other.

- A failure report is a **supported detection** only if, on a fault stage, the recording shows the seeded fault's violation after the qualifying action and the reported failed assertion or reason corresponds to it. Stopping at the first observed violation is valid; later steps are then not required.
- A failure report on a healthy stage, or one with no matching violation, is a **false alarm**.
- A pass on a fault stage where the fault's trigger was reached is an **unsupported pass**. If the trigger was not reached, it is **no opportunity**, and stays in the denominator as such.
- Action failures, timeouts and infrastructure failures do not count as detections.
- A healthy pass without the full observable trajectory is reported separately from a fulfilled contract. Nothing here claims the agent internally checked every assertion.

## Derived analyses

Computed from the same records and labelled as derived estimates, never as observations: a break-even (tokens and time, at given run counts and change rates, with unknown construction cost as a stated sensitivity); and a replayed hybrid (script first, agent only when the script fails).

## Run rules

Cells are never retried, replaced or dropped. A trial interrupted by a crash is recorded as `interrupted`, infrastructure-invalid, and never re-run. An invalid trial stays in the denominator and the campaign continues. If time runs out, remaining cells are `not_run`. Resume refuses to continue if any frozen hash differs.

## Allowed claims

Observed outcomes for this application, these scenarios, these seeded faults, this constructed revision sequence and this model. No general effectiveness, cross-application, human-labor or complete lifecycle-cost claims.

## Changes from the fresh review, before the first measured trial

- `browser_inspect` shows hidden test hooks, so only the repair agent gets it. The runtime agent has page snapshots and UI actions only. This replaces the same-tool rule above.
- A runtime trial with an unverified model is infrastructure-invalid.
- Repairs may navigate only to the application root or sign-in page, so they cannot route around a visible control.
- Limits: a runtime run has 240 s and a scripted run 60 s. Reported beside any comparison.
- Repair budget per transition: 10 accepted edits and 12 suite runs, within the 45-minute limit. An excluded rehearsal reached 5 of 12 scenarios at the earlier 3 edits and 4 suites, which would have measured the budget and not the cost of a repair. The latest accepted candidate freezes when a limit ends, whether or not all scenarios pass.
- `baseline_repair` now accepts partial locator patches. It used to reject them, which falsely blocked repair.

## Campaign B: corrected reload tool, runtime arm only

Decided at 2026-11-01 12:35 UTC, after campaign A finished, and therefore post-hoc. Reading a campaign A trace showed that `browser_reload` returned its snapshot at `load`, before the page's data requests finished. The agent reported an empty bank list; the private observer shows the bank appeared. That is a harness defect, not a property of the approach.

- Change: `browser_reload` also waits for network idle, for at most 5 seconds. Nothing else changes.
- Campaign B repeats all 108 runtime executions, with the same stages, order, model and limits, against campaign A's frozen step code. The maintained arm is not repeated, because Cucumber's assertions wait for their elements.
- Campaign A stays recorded and reported unchanged. Any report gives both, and says B came after seeing A. The same adjudication rules apply, by a fresh adjudicator.
- This is not a free retry: every B run counts, whichever way it goes.

## Campaign C: a second model, runtime arm only

Decided after campaigns A and B, and therefore post-hoc. A reader would ask whether a stronger model changes the outcome. Campaign C repeats all 108 runtime executions of campaign B with `gpt-5.6-terra` at the same `medium` effort, the corrected reload tool, the same stages, order, limits and sandbox, against campaign A's frozen step code. The maintained arm is not repeated, and repairs stay on `gpt-6-luna`. Every run counts. A fresh adjudicator applies the same rules. This compares two models on one application and says nothing about models in general.

## Campaign D: a Claude model through omp, runtime arm only

Decided after campaigns A, B and C at the owner's suggestion, and therefore post-hoc. Campaign D repeats all 108 runtime executions with `claude-haiku-5-5` at `medium` thinking, reached through the omp CLI in a bubblewrap sandbox with built-in tools, skills, rules, context files, extensions and session storage off, so only the same study browser MCP server remains. Same stages, order, prompt, limits and proxy; campaign A's frozen step code; repairs not repeated. A smoke check before the campaign showed the only tool listed was the study tool, no shell or file read, and the provider's reported model matched. A different CLI, and a different system prompt that omp supplies, are confounded with the model; this says nothing about models in general. A model-provider error makes the trial infrastructure-invalid. Every run counts. A fresh adjudicator applies the same rules.
