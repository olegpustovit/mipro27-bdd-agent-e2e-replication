# Judge 2: independent second LLM reviewer

`scripts/judge2/run.mjs` classifies each of the 540 pilot trials with a fresh `claude -p --model sonnet` call (one trial per call).

- Packet (`scripts/judge2/packet.mjs`): scenario text, expected outcome, stage type (healthy/fault) and UI revision, the seeded
  defect source change (fault stages only), the execution trace as numbered `[step N]` items (agent tool calls and results, or failing
  scenario steps for the step-definition runs), the executing system's own report, and the private observer's evidence.
  Not included: arm label, trial id, stage id, campaign id, model name, the first reviewer's verdict, any other trial.
  Tool results are cut at 3000 characters each. The arm is still partly inferable from the trace shape (browser tool calls vs scenario step failures).
- Output per trial: `classification` (healthy or fault class set, same as the first reviewer), `reason`, `cited_step`, `confidence`.
- `verdicts.jsonl` is append-only, one line per successful judgment: opaque id, campaign, trial id, prompt SHA-256, prompt version, model id as
  reported by the CLI, CLI version, token usage (input / cache read / cache write / output), cost, duration. Failed attempts go to `errors.jsonl`
  and are not verdicts. Re-running skips every opaque id that already has a verdict.
- Isolation achieved: no bubblewrap on this host, so no filesystem sandbox. Each call runs in a fresh empty temp directory with all built-in
  tools disabled (`--tools ""`), no MCP servers (`--strict-mcp-config`), no settings or CLAUDE.md (`--setting-sources ""`), no skills or slash
  commands, no session persistence, and a custom system prompt. The only input is the packet on stdin; the structured-output channel
  (`--json-schema`) is the only tool the model can call. The process still runs as the owner with the owner's credentials, so isolation
  rests on the model having no tool to act with, not on the operating system.
- Smoke run (`--run smoke-3`): 3 trials chosen by hand to cover a step-definition action failure and two agent fault detections.
  They stay in `verdicts.jsonl` and count as judged in the full run.
- Full-run estimate: `node scripts/judge2/estimate.mjs` (linear extrapolation from the verdicts so far).
