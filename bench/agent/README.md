# Codex agent adapter

Run the adapter after starting a fresh, seeded app for the selected item. Use a new output directory per attempt.

```sh
BENCH_APP_URL=http://localhost:3000/ \
  bench/agent/run --item item.json --out attempt
```

- The item’s `arm` selects Luna at medium effort, Terra at medium effort, or Sol at high effort. P1 owns the installed-version and image checks. The host smoke uses Codex CLI 0.169.0, Playwright MCP 0.0.84, Chromium, and noninteractive `sudo bwrap`.
- `BENCH_SCENARIO_FILE` can point to the single prepared, browser-facing scenario selected by the runner. By default the adapter looks for `bench/scenarios/pay/<scenario>.feature` or `bench/scenarios/moodle/<version>/<scenario>.feature`. The runner prepares any administrative setup before handing the scenario to the adapter. Scenario Background stays visible and unnumbered.
- The P8 template uses `{{url}}`, `{{scenario}}`, `{{glossary}}`, and `{{answer_format}}`. The adapter renders the numbered steps and supplies the JSON answer instructions. The local fixture has a fallback template until P8 lands.
- The adapter creates a fresh local Chromium context by default. `BENCH_BROWSER_WS` can select a Playwright browser server for the P2a browser container. Its network policy must allow only the app. The host smoke also restricts Chromium’s outgoing requests through a local proxy. P2a owns container-level egress for the agent and browser.
- The existing Codex login at `${CODEX_HOME:-$HOME/.codex}/auth.json` is mounted read-only into the isolated Codex process. The browser receives the application URL and uses a fresh context.
- The watchdog starts when the Codex process launches. The 80th attempted Playwright call stops the process before dispatching that request. Eight consecutive identical calls with identical observations count as a loop. Token counts are those reported in Codex’s completed-turn event. A killed or interrupted turn may lack usage telemetry, in which case the counts are zero.
- `answer.json` is the fleet result. `run.json` contains model, effort, and prompt and scenario hashes. `prompt.md`, `codex.jsonl`, and `browser.jsonl` contain the rendered prompt, Codex events, and browser requests and observations. Infrastructure errors return a nonzero exit code so the runner can apply the ledger’s validity rules.
- Answers use `status`, `failed_step`, and `reason`. A failure names a 1-based step number or an unambiguous step text. An explicit unresolved answer retains the reason and uses the fleet cause `no_readable_answer`.

To reparse a saved answer, use `bench/agent/parse --scenario scenario.feature --answer response.txt`. Omit `--answer` to read stdin.

```sh
make -C bench -f mk/P3c.mk p3c-test
make -C bench -f mk/P3c.mk p3c-smoke
```

The smoke target runs the Luna fixture against a local HTML page. The test target checks the parser, watchdog, MCP call cap, malformed responses, and browser restrictions without provider calls.
