# Dashboard sync

Start each runner batch through the dashboard wrapper to publish completed attempts
every 15 minutes during the batch and once when the runner exits, including
controlled stops. The wrapper forwards the runner's selection and other options
after `--batch`. Pass the plan and ledger paths before that flag.

```sh
make -C bench dashboard-batch \
  SYNC_ARGS='--artifact ARTIFACT_ID --metadata PATH_TO_SCORING_METADATA' \
  RUN_ARGS='--filter app=pay --workers 2 --resume'
```

For a standalone refresh or retry, call
`bench/sync/dashboard --artifact ARTIFACT_ID` (or `make -C bench dashboard-sync`)
with the same plan, ledger and metadata. The default plan and ledger are
`bench/plan/plan.json` and `bench/ledger/`. Use one authoritative ledger per
dashboard and supply the same confirmed P3b target metadata to every invocation.

Unattempted items appear as planned through the dashboard's existing default.
The runner ledger records finished attempts, so this sync does not infer active
runs. Each attempted item displays the latest attempt and retains all attempts in
ledger order. Tokens use the P3b total, including cached input once. A failing bug
attempt without a confirmed target displays as unresolved until the P3b metadata
is available. Resync after supplying it to classify those failures.

Sync validates the ledger hash chain and plan provenance before writing. The
periodic snapshot consumes complete lines while the runner holds its batch lock.
Identical document bodies are skipped, preserving document versions and timestamps.
Runner exit codes are preserved when final sync succeeds. A final sync failure
returns an error and can be retried independently of the study run.

Run `bench/sync/test-dashboard` to exercise the P3 runner with fixture adapters
and the production dashboard renderer with data returned from a private,
temporary copy of the artifact. The test deletes its artifact on exit.
