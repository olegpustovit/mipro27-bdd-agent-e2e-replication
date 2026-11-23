Continue the experiment for piece `mipro27-bdd-agent-e2e` in ~/projects/cucumber-mcp-study. Read first: `/tmp/cucumber-study-report.md` (your predecessor's stop report), then the original brief at /tmp/claude-501/-<home>-agents-researcher/60a06e62-f1e8-4a87-9d99-9000adbb9c32/scratchpad/codex/brief-experiment.md. Its integrity rules, frozen design (120 executions), outcomes, fresh reviewer, adjudication, saving and final report all still apply, except as changed here. Now is about 10:40 UTC. Measured runs must finish by 18:00 UTC. The goal is real results today. Do not stop at the first obstacle: find a working honest route, and stop only if every route here fails.

## Isolation: this boundary is decided, implement it
The purpose of the boundary is that the agent under test cannot read oracles, fault labels, baseline code, private mappings or earlier runs, and can act on the application only through the study's browser tools. Implement it in two layers:
1. Codex tool layer, as in `scripts/codex-isolation-check.mjs`: the disabled features plus the catalog copy (`apply_patch_tool_type:null`, `tool_mode:direct`, `multi_agent_version:null`, `experimental_supported_tools:[]`). `list_mcp_resources`, `list_mcp_resource_templates`, `read_mcp_resource` and `tool_search` may remain only if the study MCP exposes no resources and they can reach nothing but the study tools. Verify and disclose that.
2. OS layer: run the runtime Codex process in `bwrap` (installed, 0.9.0) with the study repo, upstream checkout, run data, home directory and other private files absent from its filesystem view: an empty workspace, read-only system paths, and only an auth-bearing isolated CODEX_HOME. Reach the browser proxy over a loopback HTTP MCP endpoint, or another route that keeps the proxy process and its files outside the sandbox. Prove with an excluded check that from inside the sandbox the repo and oracle paths do not exist and a shell attempt fails.
The repair agent gets the same treatment but sees only the shared action and locator files plus browser inspection.

## Model provenance
If the CLI does not expose the response model, record the requested model, the CLI version and the token usage; set `modelVerified:false`; and disclose it as a limitation. Try `--ephemeral` off with an isolated session file, in case the rollout records the model. This is a disclosed limitation, not a blocker. Run one excluded real session to confirm it works and to measure time per scenario.

## Resumable and trackable: required before the first measured trial
The in-memory ledger is not enough, and a crash must not lose tests.
- Write each trial to a durable append-only JSONL file under `~/.local/share/cucumber-study/runs/<campaign-id>/`, flushed and fsynced when it finishes, with raw evidence beside it. Record a `started` line before a trial and a `finished` line after it.
- Add `--resume <campaign-id>`. It verifies source, config, contract, revision and evaluator hashes against the frozen manifest and refuses on any mismatch. A trial with `started` but no `finished` becomes `interrupted` with infrastructure-invalid state and is never re-run: integrity outranks completeness. Then it continues with the next not-yet-started cell.
- Maintained-arm state must survive: commit or hash-store the step code after every maintenance transition, and restore it from that on resume. Fixture state is reset per trial anyway; verify it on resume. Clean up stale locks and app processes safely by checking their owner.
- Run under `systemd-run --user` with a memory limit and no automatic restart, so it survives this session. Append one line per trial to `/tmp/cucumber-study-progress.log` (time, id, arm, state).
- After each completed stage, save that stage's raw records to Foundry through the MCP, so the data survives the host. If saving fails, note it and go on; the disk copy remains.
- Test this with an excluded kill-and-resume on 2 to 3 cells before the campaign, and record it. Excluded data never enters the campaign directory.
If your worker session ends while the campaign runs, the campaign must continue. Write the resume command and campaign id to `/tmp/cucumber-study-status.log`.

## Trackable for analysis: add these fields
Record enough that these can be computed afterward with no new runs. They are the study's substance:
- For each maintenance transition: which change kinds (label, control, navigation) broke which scenarios, and repair effort per change kind.
- Failure taxonomy per trial, for both arms: action failure, wrong reason, unsupported pass, false alarm, timeout, infrastructure.
- Per-scenario family outcomes.
- Everything needed for two derived analyses, labelled as derived estimates and never as observations: a break-even (given observed run cost and repair cost per transition, at what run count and change rate does each approach cost less, in tokens and time, with unknown construction cost as a stated sensitivity); and a replayed hybrid (scripted first, agent only when the script fails, computed by replaying this same data).
Put both analyses in the final report with their assumptions. Do not add cells or change the frozen design for them.

## Reviewer and timing
Freeze, run the fresh reject-review for at most 15 minutes, record it exactly, fix what would make results wrong, and proceed under exploratory-owner-directed if it stops. Do not wait for `/tmp/foundry-flow-fix-done` beyond 11:15 UTC. If smoke timing shows 120 cannot fit by 18:00 UTC, apply the frozen cut rule before the first measured trial.

If Codex truly cannot run a scenario through this boundary by 12:00 UTC, append `CODEX_BLOCKED <reason>` to `/tmp/cucumber-study-status.log` and finish, so the owner can decide. Do not switch to Claude yourself.

Commit to `dev` and push. No GitHub CI work. Write `/tmp/cucumber-study-report.md` as a new version when finished, keeping the old one as `/tmp/cucumber-study-report-1.md`. Stay until the campaign, adjudication and report are complete.

