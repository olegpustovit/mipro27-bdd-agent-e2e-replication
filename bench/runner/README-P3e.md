# Coded adapter

`bench/runner/run-item` invokes `bench/runner/coded-run` by default for coded
arms. To exercise the adapter without running the study, pass a single plan
item as JSON.

```sh
BENCH_APP_URL=http://localhost:3000 bench/runner/coded-run --item pay.json --out /tmp/pay-coded
bench/runner/coded-run --item moodle.json --out /tmp/moodle-coded
```

The adapter writes `coded.json`. Exit 0 means the scenario passed, exit 1
means the scenario failed, and exit 2 means the adapter could not obtain a
scenario verdict. The ledger quarantines exit 2. Step numbers include
continuations such as And and But and exclude Background. A Background
failure has null step fields.

For payment, start and seed the selected build before invoking the adapter.
Each invocation starts a fresh browser. Use a separate app and reset its data
between items, including when running with multiple workers. For hold-06 and
hold-07 the adapter creates the pending request through `BENCH_PAY_API_URL`
(default `http://localhost:3001`) before Cucumber starts. For the old local
fixture, the browser allows the app origin and the API at
`http://localhost:3001`. For the local v0 acceptance smoke, start the app
with `npm run app` and run `make -C bench p3e-smoke-pay`. The smoke restores
the synthetic seed between scenarios and after the last run. It also uses a
separate empty sign-in page to verify step 2 failure reporting.

For a v1 smoke, apply `bench/apps/pay/v1.patch` to the bootstrapped fixture
at `0729f68` and start its frontend and API on free ports. Set `PORT` and
`VITE_BACKEND_PORT` to those respective port numbers when starting the
fixture, then run the smoke from the repository root.

```sh
BENCH_APP_URL="http://localhost:$app_port" BENCH_PAY_API_URL="http://localhost:$api_port" \
  node bench/runner/coded/smoke-pay.mjs --version v1
```

`BENCH_PAY_API_URL` defaults to `http://localhost:3001` and controls the
browser's API allowlist and the smoke's seed reset endpoint.

The maintained payment arm uses the app version's definitions. The stale
arm uses the preceding version's definitions. Each version uses
`social.mjs` for the original suite and `hold-out.mjs` for hold-outs, as in
v0's calibration. Missing files are infrastructure errors.

The Moodle adapter reconstructs the replay build using the pinned commit and
runtime, and uses worker `w89` by default. Set `BENCH_MOODLE_WORKER` to use a
different dedicated Moodle worker. The worker lease prevents simultaneous
use of the same fixture. The old post-change arm applies the replay's
old-step patch. Bug items require the matching `bench/bugs/<bugId>/patch.diff`.
