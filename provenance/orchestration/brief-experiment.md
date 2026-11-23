You are finishing the measured experiment for Research Foundry piece `mipro27-bdd-agent-e2e`, in ~/projects/cucumber-mcp-study. Read that repo's AGENTS.md and README.md, ~/agents/researcher/AGENTS.md, then call `next_action` and `get_piece` on the piece. The working tree holds uncommitted work from the previous session (cumulative runner, ownership, guards); keep and commit it. Do not write any abstract or paper prose.

The owner needs real results TODAY: "please complete finish experiment ... we need abstract to be not planned ... (or at least we have something do it this is critical)". Now is about 10:30 UTC on 2026-11-01. All measured runs must finish by 18:00 UTC. Host: 7.7 GiB, no swap; one browser fixture at a time.

## Integrity rules (these outrank speed)
- Never invent, edit, drop or re-run a result to improve it. No retries or replaced cells. Preserve failures, timeouts, invalid and not-run cells in the denominators.
- Never repair an injected fault. Never weaken an assertion. Scenarios stay frozen.
- The agent under test must never see oracles, fault labels, baseline code, private mappings or earlier runs.
- Do not record a gate pass yourself, edit gate policy, or forge an approval. `verifyApproval` in scripts/campaign-guard.mjs must not be fooled. Add a separate, explicit exploratory mode that writes `"status":"exploratory-owner-directed"` and whether a gate pass exists into every result. The owner directed this run; Foundry records his instruction as a fact.
- Technical smoke runs are excluded from study data and labelled as such.
- Everything you record is what you observed. `NOT FOUND` and `unknown` are valid.

## Agent under test: Codex, not Claude
`scripts/agent-session.mjs` launches `claude -p`. Replace the model-driven parts (runtime arm and maintained-arm repair agent) with `codex exec`, so no Claude tokens are spent. Requirements:
- Clean configuration: `--ignore-user-config`, `--ignore-rules`, `--ephemeral`, `--skip-git-repo-check`, `--json`, an empty working directory, and an isolated CODEX_HOME that holds only auth. The study's restricted browser MCP proxy is the runtime agent's only tool source. Pin one exact model and reasoning effort for all runs, and verify the model from the event stream.
- The runtime agent must have NO shell, file or web tool. Find how to turn off Codex's shell, patch, web and other built-ins in 0.159.3 (`codex features list`, `-c`, `--disable`), and prove it with a model-free or excluded check that lists actual tools and shows a shell attempt is impossible. A `read-only` sandbox alone is not enough. If it cannot be locked down, say so at once in the report and stop; do not silently run an agent with a shell.
- Fresh conversation per scenario run, same bounded time limits, no retries.
- Capture wall time, tool calls and token counts from the Codex event stream. Do not invent dollar costs: compute an estimate only from an official price page you read now, with URL and date, else report tokens only.
- The maintained-arm repair agent is also Codex, may edit only the shared step action and locator files plus their inspection allowance, and has the bounded edits and suite runs already in `cumulativeConfig`. Repairs carry forward.
- Disclose the switch from Claude to Codex in the protocol. Earlier Claude pilots stay excluded historical setup.

## Frozen design, fitted to today
Save this to Foundry BEFORE the first measured trial, with code, config, contract, revision and evaluator hashes:
- 12 scenarios, 6 families, 12 defects, one application, UI revisions v0, v1, v2. Do not drop or swap scenarios or defects.
- Stage order: healthy-v0, fault-v0, maintenance-v1, healthy-v1, maintenance-v2, healthy-v2, fault-v2. One repetition per stage: 5 x 12 x 2 = 120 executions, arm order as in `cumulativeStages`' alternation. This replaces the proposed 216-trial design, because of the deadline; say so. One repetition means no stochastic-variance claim.
- Cut rule fixed in advance: stages run in that order, and if time runs out the remaining cells are recorded as not_run. Before the first measured trial you may estimate timing from excluded smoke runs and, if the plan cannot fit, cut whole stages from the end only, recording why. No change after the first measured trial.
- Frozen outcomes, per arm and stage, always with denominators: complete observable contract fulfilled (healthy); reported verdict; supported detections (fault), meaning the reported failure matches an observed violation after the correct qualifying action; false alarms; unsupported passes; action failures; timeouts; infrastructure invalid; execution wall time; tokens; repair time, edits, tool calls and suite runs per maintenance transition. Separate setup or harness costs. No labor-saving or lifecycle claims. Agent time is not human time.

## Blockers from the last gate
The Evidence plan STOP verdict (in `next_action`) lists attempt attribution, contract equivalence, ground-truth validity, maintenance stress, construction costs and freezing. Later commits address several. Check each against the actual code, repair what is still open, and run `npm test` plus the existing calibration and integration checks. Keep it proportionate: you have hours, so fix what would make results wrong, and name what stays open. The `next_action` report, artifacts `minimum-defensible-validation-design.json`, `phase-contract-adjudication-and-repairs.json`, `cumulative216-protocol-proposal.json`, and `prospective-scientific-cold-review.json` (see `get_piece` outputs, read with `fetch` id `workflow-output:mipro27-bdd-agent-e2e:<sha256>`) hold the reasoning.

## Fresh reviewer
Once the protocol is frozen and before measured runs, run one fresh `codex exec` reviewer, told to reject, that did none of this work, with the `gate-verdict` skill. Give it 15 minutes. Record its verdict exactly through the MCP. If it passes, use the normal path. If it stops or narrows: fix any finding that would make results wrong and is quick; then proceed under exploratory mode with its findings recorded beside the results.

## Adjudication after the runs
Deterministic evaluator first. Then one fresh `codex exec` adjudicator that did not run or repair anything reviews every failure report and every evaluator-versus-verdict disagreement against the recordings under frozen rules, blind to arm where feasible. Keep both results; never overwrite. The final numbers must state which they use.

## Starting
Do all preparation now. Do not start the measured campaign until `/tmp/foundry-flow-fix-done` exists or 11:30 UTC has passed, because a Foundry deploy may be using the host. Run the campaign detached (nohup or systemd-run with a memory limit) so it survives your session; append one line per finished trial to `/tmp/cucumber-study-progress.log` with time, id, arm and state only, and restart nothing automatically. If it stalls more than 15 minutes, investigate and record it; do not re-run completed cells.

## Saving
Commit code to the study repo `dev` and push. Save protocol, raw per-trial results, adjudication, analysis and provenance through the Foundry MCP (`add_subtasks` under the current node, then `submit_node` with outputs on a new subtask). Keep raw run data out of `~/agents/researcher`. Do not mark the Evidence gate passed.

## Final report
Write `/tmp/cucumber-study-report.md`, and save it to Foundry:
1. Exact results tables, each cell a count over a denominator, by arm and stage.
2. Status: gate verdict, exploratory or not, what changed from earlier plans, what is still open.
3. Model, versions, hashes, run window, not-run and invalid cells.
4. What the data can and cannot support, with no general claims.
Then finish. At each major step append a one-line status to `/tmp/cucumber-study-status.log`. If you must stop early, write the reason there and in the report; partial truthful results beat none.

