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

- `tools/lock-check` must exit zero before any runs launch.
- The gate adapter defaults to `runner/check-gate --item ITEM_JSON`. It must exit
  zero only when the item's all-pass gate and any applicable bug check allow a
  launch. Use `--gate-check PATH` to select the executable.
- The agent and coded adapters use the fleet's `--item ITEM_JSON --out RAW_DIR`
  contract. They put their result and all retained artifacts in that directory.
  Use `control.json` with a `stop` value of `provider refusal`, `failed gate`,
  `low memory` or `low disk` for an explicit stop. Use `provenance.json` to
  report `image_digests` (app, db, browser, agent), `tool_versions`, `model`,
  `effort`, `prompt_sha256` and `scenario_sha256`. Adapters must exclude
  credentials from their files. The runner discards subprocess stdout and stderr.
- Pass `--smoke-times FILE` with a JSON mapping of arm IDs to smoke-test minutes
  to enable the slowness check for those arms. The host preflight defaults to
  1 GiB of available memory and 2 GiB of free ledger disk.
- Alerts go to the Telegram Bot API. The runner reads the two direct Telegram
  assignments from the host `.envrc` only when sending a live alert.
  `--alert-sink FILE` writes one JSON line per alert for dry-run testing.

Exit status 2 means the batch paused. After the fix, repeat the same selection
with `--resume` to skip items whose latest attempt is valid. Invalid streaks
used for stopping reset when the operator restarts. The per-item retry count
persists in the ledger. Exit status 3 means the batch finished with missing
items, each with one invalid attempt and three invalid retries. Without
`--resume`, rerunning a successful item creates a new attempt.

## Ledger and verification

`bench/tools/verify-ledger` checks the canonical JSON bytes, hash chain,
and raw inventory. Use `--ledger-dir PATH` on both CLIs for a separate ledger.
Each `raw_dir` is relative to the directory containing `attempts.jsonl`.
The `trace_sha256` covers a canonical manifest of relative paths and file
SHA-256 digests, including the structured results and retained traces.
The raw tree is ignored by default. Include it explicitly when taking
a replication snapshot.

A writer holds the ledger lock for the whole batch. If the runner is interrupted
between allocating a raw directory and writing its record, both CLIs flag the
unrecorded directory. Preserve the interrupted artifacts during manual recovery
before restarting.
