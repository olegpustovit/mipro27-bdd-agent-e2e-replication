# All-pass gate

Install the repository's locked JavaScript dependencies with `npm ci`.
With the locked Node version and the local images from `bench/images`, run
`make -C bench gate` from the repository root. The scenario matrix invokes
`coded-run`, once per healthy scenario and version, on fresh containers
started by digest. `BENCH_GATE_JOBS` controls concurrency and defaults to 4.
The gate writes `bench/plan/gate.jsonl` atomically after the matrix completes.
Each version row includes the image pins, per-scenario verdicts, counts and
any M7 or L5 evidence. A coded assertion failure has status `fail` and a
launch or adapter failure has status `error` in the scenario record.

`check-gate --item ITEM_JSON` fails closed if the version's record is absent,
failed, duplicated, incomplete, or has different scenario IDs or image pins.
A bug item also needs passing healthy and bug records for its version in
`bench/plan/bug-checks.jsonl`. Run `make -C bench test-p6` to check that
`run-item` refuses a failed version before launching its coded adapter.

M7 uses the healthy B05 pre-change coded timings and counts browser-facing
scenario steps from the handoff. One tool call per UI step is a planning
estimate. Browser inspection and model latency can consume additional time
and calls. S091 (L5) uses a fresh healthy seed on each B15 commit and logs in
with the scenario user. The check records the landing path with JavaScript
disabled and enabled, corresponding to the non-JavaScript coded scenario
and the agent browser.

The pinned payment image serves its browser-facing API under `/api`.
The gate passes `BENCH_PAY_API_PREFIX=/api` to the coded adapter so the
hold-04 Save step watches the exact proxied PATCH endpoint and still checks
the response status before proceeding to the reload assertion.

For a controlled rerun of a failed version on the same pins, run
`BENCH_GATE_JOBS=1 bench/runner/run-gate --retry-version mdl/B05-pre`.
This reruns the entire version and saves the old results under
`priorAttempts` in that version's row. The command exits nonzero while
any version in the results is failed.
