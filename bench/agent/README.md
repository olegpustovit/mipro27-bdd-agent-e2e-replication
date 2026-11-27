# Codex agent adapter

Run the adapter after starting a fresh, seeded app for the selected item. Use a new output directory per attempt.

```sh
BENCH_APP_URL=http://localhost:3000/ \
  bench/agent/run --item item.json --out attempt
```

- The item’s `arm` selects Luna at medium effort, Terra at medium effort, or Sol at high effort. P1 owns the installed-version and image checks. The host smoke uses Codex CLI 0.169.0, Playwright MCP 0.0.84, Chromium, and noninteractive `sudo bwrap`.
- For payment, `BENCH_SCENARIO_FILE` can point to a prepared feature. The default selects a dedicated payment feature or the matching tagged scenario in `study/scenarios.feature`. The adapter creates the pending fixture for hold-06 and hold-07 through `BENCH_PAY_API_URL` (default `http://localhost:3001`) on the fresh seed.
- For Moodle, the adapter expects matching scenario setup on the app. It prepares `BENCH_SCENARIO_FILE` as `agent-scenario.feature` in the attempt directory, with an unnumbered accounts line and the handoff’s UI steps. The agent wording is included in the recorded scenario hash. Background stays unnumbered.
- The P8 template uses `{{url}}`, `{{scenario}}`, `{{glossary}}`, and `{{answer_format}}`. The adapter renders the numbered steps and supplies the JSON answer instructions. The local fixture has a fallback template until P8 lands.
- The adapter creates a fresh local Chromium context by default. `BENCH_BROWSER_WS` can select a Playwright browser server for the P2a browser container. Its network policy must allow only the app. The host smoke also restricts Chromium’s outgoing requests through a local proxy. P2a owns container-level egress for the agent and browser.
- The existing Codex login at `${CODEX_HOME:-$HOME/.codex}/auth.json` is mounted read-only into the isolated Codex process. The browser receives the application URL and uses a fresh context.
- The watchdog starts when the Codex process launches. The 80th attempted Playwright call stops the process before dispatching that request. Eight consecutive identical calls with identical observations count as a loop. Token counts are those reported in Codex’s completed-turn event. A killed or interrupted turn may lack usage telemetry, in which case the counts are zero.
- `answer.json` is the fleet result. `run.json` contains model, effort, and prompt and scenario hashes. `prompt.md`, `codex.jsonl`, and `browser.jsonl` contain the rendered prompt, Codex events, and browser requests and observations. Infrastructure errors return a nonzero exit code so the runner can apply the ledger’s validity rules.
- `codex.stderr` retains Codex diagnostics. The adapter redacts credential signatures in stderr and Codex JSON events. A provider refusal writes `control.json` with `stop: "provider refusal"`, a category (`auth`, `credits`, or `rate limit`), and a short reason. The adapter exits nonzero and records `valid: false` in `answer.json`. The runner quarantines the attempt and stops new launches.
- Answers use `status`, `failed_step`, and `reason`. A failure names a 1-based step number or an unambiguous step text. An explicit unresolved answer retains the reason and uses the fleet cause `no_readable_answer`.

To reparse a saved answer, use `bench/agent/parse --scenario scenario.feature --answer response.txt`. Omit `--answer` to read stdin.

```sh
make -C bench -f mk/P3c.mk p3c-test
make -C bench -f mk/P3c.mk p3c-smoke
```

The smoke target runs the Luna fixture against a local HTML page. The test target checks the parser, watchdog, MCP call cap, malformed responses, and browser restrictions without provider calls. Run `node bench/agent/fixtures/provider-smoke.mjs` on a configured host to check refusal handling through the adapter entry point with a fake Codex CLI.
