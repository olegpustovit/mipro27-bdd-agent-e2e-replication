# P5 change 1, session 2 (pretask/P5-c1-s2)

Updated the payment step definitions from v0 to v1 (`bench/apps/pay/v1.patch`, sha256
`9bd5e54b…2b83f72`, on upstream `0729f68ac220f7cda4ad09c5693dba11d7c532c6`). This session ran Claude Opus 5.5
in Claude Code, with no AI agents in the loop and no measured study runs.

- **Start:** 2026-11-27T15:33:12Z
- **End:** 2026-11-27T15:39:37Z (last validation and diff-check; the commit followed)
- **Edits:** 6 (5 changed lines in 4 files)
- **Suite runs:** 2 (all 20 scenarios each time)

| Run | Step definitions | Started (UTC) | Passed | Failing |
|---|---|---|---|---|
| 1 | unmodified v0 copies (baseline) | 15:36:52 | 15/20 | bank-delete, transfer-pay, transfer-request, hold-06, hold-07 |
| 2 | the 6 edits below | 15:38:30 | **20/20** | none |

## Edits

| # | File | Spec | Change |
|---|---|---|---|
| 1 | locators.mjs | 1.4 | `amount`: `placeholder=Amount` → `placeholder=Amount ($)` |
| 2 | locators.mjs | 1.4 | `note`: `placeholder=Add a note` → `placeholder=What's it for?` |
| 3 | actions.mjs | 1.9 | `deleteBank`: after clicking Delete in the row, click the same `deleteBank` locator inside the confirmation dialog |
| 4 | hold-out.mjs | 1.10 | `Ted clicks {string}`: after clicking `Reject Request`, click `Reject` in the confirmation dialog |
| 5 | social.mjs | none | Import `./steps.mjs` (v1) instead of `../../../../study/steps.mjs` (v0) |
| 6 | hold-out.mjs | none | Import `./actions.mjs` (v1) instead of `../../../../study/actions.mjs` (v0) |

`steps.mjs` and `world.mjs` are unchanged copies. The v0 registry already accepted the other v1 changes:
- 1.1 (`Log In`) and 1.7 (`Account settings`) via its alternation regexes;
- 1.2 via labels rather than hooks;
- 1.3 and 1.5 via role and name rather than hook or position;
- 1.6 and 1.8 via role and name rather than position.

No assertion, step binding or scenario was removed, skipped or weakened.

## diff-check

Command: `bench/tools/diff-check <v0> <v1>`, run per file and on a directory. The v0 directory held copies of
`study/{steps,locators,actions,world}.mjs` and `bench/stepdefs/pay/v0/{social,hold-out}.mjs`.

| File | Result |
|---|---|
| steps.mjs | PASS |
| locators.mjs | PASS |
| world.mjs | PASS |
| actions.mjs | exit 1: AST changed outside supported locator values (edit 3) |
| hold-out.mjs | exit 1: AST changed outside supported locator values (edits 4, 6) |
| social.mjs | exit 1: AST changed outside supported locator values (edit 5) |

No file reports a "removed or changed assertion" or a "removed or changed step binding". Every flag is a
review flag (P6tool.md: exit 1 means "a difference was flagged for review").

Edits 3 and 4 answer the new confirmation dialogs, which are NL-FLOW edits. Every old locator still resolves,
but the flow needs one more click. No change to a locator value can add a click, so diff-check cannot pass for
change 1 without either a flow edit or a way around the checker. I did not work around the checker.

Edits 5 and 6 make the v1 set self-contained. Without them, `social.mjs` and `hold-out.mjs` would load the v0
study modules. That would still pass on v1, because neither file uses `deleteBank`, so dropping them is an
option that removes the social.mjs flag. The two NL-FLOW flags stay either way.

## How it was run

- **App.** `npm ci` and `npm run bootstrap` in this worktree, then `git apply bench/apps/pay/v1.patch` in
  `upstream/cypress-realworld-app` (not committed). Vite ran on 127.0.0.1:4320 with `VITE_BACKEND_PORT=3001`.
  The API (`ts-node backend/app.ts`) ran on 127.0.0.1:4321 with `PORT=3000`, which sets the CORS origin.
- **Port mapping.** The step definitions, the fixture and the private observer all hard-code
  `localhost:3000/3001`. A Playwright `context.route` on the fixture browser therefore rewrote
  `localhost:3000` → `:4320` and `localhost:3001` → `:4321` with `route.continue({ url })`, which the page cannot
  see. Nothing listened on 3000/3001. The API's request log confirmed that traffic reached :4321.
- **Runner.** The runner was model-free, following `bench/stepdefs/pay/v0/calibrate*.mjs` (P4.mk / P4d.mk). For
  each scenario it reseeded through `POST :4321/testData/seed` (checking the result against
  `database-seed.json`), opened `freshBrowser({ observerVersion: 'v0' })`, and ran
  `cucumber.js --import v1/world.mjs --import v1/<steps|social|hold-out>.mjs --retry 0`.
- **Scenarios.** The 10 non-feed study scenarios ran by tag from `study/scenarios.feature`. The rest were
  `bench/scenarios/pay/social-{like,comment}.feature` and `bench/scenarios/pay/hold-out/hold-0{1..8}.feature`.
