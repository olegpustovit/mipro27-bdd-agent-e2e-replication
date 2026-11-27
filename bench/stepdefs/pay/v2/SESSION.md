# P5 change 2, session 1 (pretask/P5-c2-s1)

Updated the payment step definitions from v1 to v2. The app was upstream `0729f68ac220f7cda4ad09c5693dba11d7c532c6`
with `bench/apps/pay/v1.patch` (sha256 `9bd5e54b…2b83f72`) applied, then `bench/apps/pay/v2.patch` (sha256
`ba58e18b…f378a27`). This session ran Claude Opus 5.5 in Claude Code. No AI agents were in the loop, and there were no
measured study runs.

- **Start:** 2026-11-27T15:41:02Z
- **End:** 2026-11-27T15:50:15Z (last validation and diff-check; the commit followed)
- **Edits:** 8 logical edits (15 added and 8 removed lines in 3 files)
- **Suite runs:** 3 full runs of all 20 scenarios. Only run 3 used the edited definitions. Two partial smoke runs are listed for completeness.

| Run | Step definitions | Started (UTC) | Scenarios | Passed | Failing |
|---|---|---|---|---|---|
| 1 | unmodified v1 copies | 15:43:15 | 20 | 1/20 | 19, all infrastructure (see below) |
| smoke A | unmodified v1 copies | ~15:45:45 (ended 15:45:53) | 2 | 1/2 | auth-logout (genuine, 2.9) |
| 2 | unmodified v1 copies (baseline) | 15:45:58 | 20 | 10/20 | auth-logout, profile-name, profile-email, transfer-pay, transfer-request, hold-02, hold-03, hold-04, hold-06, hold-07 |
| smoke B | all 8 edits (targets edits 1 and 8) | ~15:48:25 (ended 15:48:35) | 2 (profile-name, hold-04) | 2/2 | none |
| 3 | the 8 edits below | 15:48:40 | 20 | **20/20** | none |

Run 1 is invalid as a baseline. My port rewrite first targeted `127.0.0.1:4340/4341`. The session cookie then went to
the `127.0.0.1` host, so every authenticated API call after login returned 401 and the onboarding dialog blocked the
page. Rewriting to `localhost:4340/4341` fixed this, because cookies are host-scoped and ignore the port. Run 2 is the
real baseline. Its failures match the spec: 2.9 (sign-out dialog), 2.7 (settings labels and Save), 2.2 and 2.3
(toggle, Continue and the review dialog) and 2.5 (sign-up hook and label). The v1 definitions already tolerated 2.1
(`deleteBank` accepts `Remove`), 2.4, 2.6 and 2.8.

## Edits

| # | File | Spec | Change |
|---|---|---|---|
| 1 | locators.mjs | 2.7 | `firstName`: `placeholder=First Name` → `label=First name *` (MUI appends ` *` to a required field's label) |
| 2 | locators.mjs | 2.7 | `email`: `placeholder=Email` → `label=Email address *` |
| 3 | actions.mjs | 2.9 | `signOut`: after clicking `signOut`, click `Sign out` in the confirmation dialog |
| 4 | actions.mjs | 2.2 | `transfer`: after clicking the Pay or Request toggle (same locator as before), click `Continue` |
| 5 | actions.mjs | 2.3 | `transfer`: then click `Confirm` in the review dialog |
| 6 | hold-out.mjs | 2.5, 2.7 | `button()` helper: map the scenario names to the new labels (`Sign Up` → `Create account`, `Save` → `Save changes`). Matching stays exact by role and name. |
| 7 | hold-out.mjs | 2.5 | Confirm-password hook `signup-confirmPassword` → `signup-confirm-password` (3 `signupField` arguments and 1 CSS selector) |
| 8 | hold-out.mjs | 2.7 | `phone`: `getByPlaceholder('Phone Number')` → `getByLabel('Phone number *')`, exact |

`steps.mjs`, `social.mjs` and `world.mjs` are unchanged copies of v1. No assertion, step binding or scenario was
removed, skipped or weakened. Every `expect` and `assert` is unchanged in kind and target:
- the PATCH `/users/:id` response check after Save still runs;
- `the "Sign Up" button is disabled` still requires the submit button to be visible and disabled;
- the step-three heading checks for transfers are unchanged.

Edits 4 and 5 still send the type the scenario names. Run 3's feed checks confirm it: the payment row reads `paid` and
the request row reads `requested`.

## diff-check

Command: `bench/tools/diff-check bench/stepdefs/pay/v1 bench/stepdefs/pay/v2` → **exit 1**. The flags are below.

| File | Result |
|---|---|
| locators.mjs | PASS (edits 1, 2 are registry values) |
| steps.mjs, social.mjs, world.mjs | PASS (unchanged) |
| actions.mjs | exit 1: AST changed outside supported locator values (edits 3, 4, 5) |
| hold-out.mjs | exit 1: AST changed outside supported locator values (edits 6, 7, 8) |

No flag reports a removed or changed assertion or step binding. I applied each hold-out.mjs edit alone to a v1 copy in
/tmp and diff-checked it:
- the CSS part of edit 7 passes;
- the `signupField` arguments of edit 7 are flagged;
- edits 6 and 8 are flagged.

Why the interface requires each flagged change:
- **Edit 3 (2.9, NL-FLOW).** Sign out now opens a dialog, and only its `Sign out` confirm sends LOGOUT. No locator value can add a click.
- **Edit 4 (2.2, NL-SEL).** Pay and Request are now `type="button"` toggles that only select the type. The single `Continue` submit is a separate control that must be clicked.
- **Edit 5 (2.3, NL-FLOW).** Submitting now opens the review dialog, and only `Confirm` creates the transaction.
- **Edit 6 (2.5, 2.7, L-ATTR).** The scenarios keep the names `Sign Up` and `Save`, but the buttons are now `Create account` and `Save changes`. `button()` takes the name from the step argument rather than a locator string, so the rename has to be mapped in code. The alternative of loosening the match to a regex or substring would weaken the exact-name check.
- **Edit 7, `signupField` arguments (2.5, L-ATTR).** The hook rename passes through a template-literal helper (`[data-test="signup-${name}"] input`), which diff-check does not treat as a locator call.
- **Edit 8 (2.7, L-ATTR).** The phone field no longer has a placeholder. A placeholder locator cannot find it, so the call changes to `getByLabel`.

## How it was run

- **App.** `npm ci --ignore-scripts` and `npm run bootstrap` in this worktree. Then `git apply` of `v1.patch` and
  `v2.patch` in `upstream/cypress-realworld-app` (not committed).
  - Frontend: Vite on 127.0.0.1:4340 (`--strictPort`) with the default `VITE_BACKEND_PORT=3001`.
  - API: `ts-node --files backend/app.ts` on 127.0.0.1:4341 (`VITE_BACKEND_PORT=4341`) with `PORT=3000`, which sets the CORS origin.
- **Port mapping.** The step definitions, the fixture and the observer hard-code `localhost:3000/3001`.
  - On the fixture browser's context, a Playwright `context.route` rewrites `localhost:3000` → `localhost:4340` and `localhost:3001` → `localhost:4341` with `route.continue({ url })`. Other origins fall through to the fixture's own allow-list route.
  - Nothing listened on 3000/3001. The API log shows the logins, GraphQL calls and 4 `POST /transactions` reaching :4341.
- **Runner.** A scratch, model-free runner (`/tmp/p5c2s1/run.mjs`, not committed) mirrors `bench/runner/coded/pay.mjs`. For each scenario it:
  - reseeded through `POST :4341/testData/seed` and checked the result against `database-seed.json`;
  - opened `freshBrowser({ observerVersion: 'v0' })`, as in the v1 session;
  - ran `cucumber.js --import v2/world.mjs --import v2/<social|hold-out>.mjs --retry 0`.
- **Why not `coded-run` directly.** With `BENCH_APP_URL=http://localhost:4340`, `pay-origin.mjs` rewrites
  `localhost:3000` only in `study/*`, `scripts/fixture.mjs` and `v*/hold-out.mjs`. It does not cover `v*/steps.mjs` or
  `v*/actions.mjs`, and it does not cover the API origin, which the fixture's route allow-list still pins to `:3001`.
- **Scenarios.** The 10 non-feed study scenarios ran by tag from `study/scenarios.feature`. The rest were
  `bench/scenarios/pay/social-{like,comment}.feature` and `bench/scenarios/pay/hold-out/hold-0{1..8}.feature`.

## Coordinator review (2026-11-27)

Session 1 was the first session to finish with 20 of 20 scenarios passing on healthy v2. Its code was fixed as the v2
step definitions at that point, before the other change-2 sessions were looked at.

diff-check found no removed or changed assertion and no removed step binding. The flagged edits are all ones the
new interface requires:
- actions.mjs: confirm the sign-out dialog (2.9), click Continue after the Pay/Request toggle (2.2), and Confirm in
  the review dialog (2.3);
- hold-out.mjs: map the scenario button names to renamed labels with exact matching (2.5, 2.7), and the renamed
  confirm-password hook (2.5);
- the phone field is found by its label because its placeholder was removed (2.7).

Run 1 was invalid: the session cookie went to the wrong host because of the session's own port rewrite. Accepted.
