# P3 runner

From the repository root, list the seeded order without launching a run.

```sh
bench/runner/run-item --filter app=pay --filter rep=1 --seed 14 --list-order
bench/runner/test-p3
```

Use one exact `--item ID` or one or more exact `--filter FIELD=VALUE` options.
Repetitions stay in numeric order. Within each repetition the seed shuffles blocks
of the same app, version, scenario and phase. It also shuffles arms and conditions
within each block. The ledger records the seed. With multiple workers, completion
order reflects actual completion times.

## Integrating the commands

- `tools/lock-check` must exit zero before any runs launch. The in-tree adapters
  require a clean Git worktree before each launch. The ledger stores the harness
  commit in `git_commit` and the runner refuses further launches if HEAD changes.
- The gate adapter defaults to `runner/check-gate --item ITEM_JSON`. It must exit
  zero only when the item's all-pass gate and any applicable bug check allow a
  launch. Use `--gate-check PATH` to select the executable.
- The agent and coded adapters use the fleet's `--item ITEM_JSON --out RAW_DIR`
  contract. They put their result and all retained artifacts in that directory.
  Use `control.json` with a `stop` value of `provider refusal`, `failed gate`,
  `low memory` or `low disk` for an explicit stop. Use `provenance.json` to
  report `image_digests` (app, db, browser, agent), `tool_versions`, `model`,
  `effort`, `prompt_sha256` and `scenario_sha256`. The agent's `run.json`
  is also accepted when `provenance.json` is absent. The agent hashes its
  scenario input and rendered prompt. The coded adapters hash the feature
  source they execute and have no prompt. Adapters must exclude credentials
  from their files. The runner discards subprocess stdout and stderr.
- Pass `--smoke-times FILE` with a JSON mapping of arm IDs to smoke-test minutes
  to enable the slowness check for those arms. `make -C bench run` passes
  `bench/smoke/smoke-times.json` by default. The host preflight defaults to
  1 GiB of available memory and 2 GiB of free ledger disk.
- Alerts go to the Telegram Bot API. The runner reads the two direct Telegram
  assignments from the host `.envrc` only when sending a live alert.
  `--alert-sink FILE` writes one JSON line per alert for dry-run testing.

Exit status 2 means the batch paused. Repeat the same selection after resolving
the stop. The runner skips items that already have a valid result, including
when using the compatibility flag `--resume`. Use `--rerun-valid` with a
fixture plan to retain repeated successful attempts. The campaign plan refuses
that flag. Invalid streaks used for stopping reset when the operator restarts.
Exit status 3 means the batch finished with missing items, each with one
invalid attempt and three invalid retries. Attempts interrupted by a control
stop stay in the ledger and are excluded from that cap.

The agent host watchdog starts after seeding and allows 330 seconds for the
300-second agent budget and cleanup. On host timeout, the runner retains the
partial trace and records an unresolved `budget_time` result with usage fields
left null. The watchdog verdict is saved in `host-timeout.json`.

## Ledger and verification

`bench/tools/verify-ledger` checks the canonical JSON bytes, hash chain,
and raw inventory. Use `--ledger-dir PATH` on both CLIs for a separate ledger.
Each `raw_dir` is relative to the directory containing `attempts.jsonl`.
The `trace_sha256` covers a canonical manifest of relative paths and file
SHA-256 digests, including the structured results and retained traces.
The generated ledger and raw tree are ignored by Git. Include them explicitly
when taking a replication snapshot.

A writer holds the ledger lock for the whole batch. On restart it verifies
recorded artifacts and moves unrecorded raw attempt directories to
`quarantine/` within the ledger, logging each move. Standalone verification
flags unrecorded artifacts until recovery runs.
