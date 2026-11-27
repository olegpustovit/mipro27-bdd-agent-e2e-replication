# Real bug candidates

Payment scope is the 12 tagged scenarios in `study/scenarios.feature` at the
upstream baseline `0729f68ac220f7cda4ad09c5693dba11d7c532c6`. P4d supplies the
hold-outs and P7c supplies the Moodle scenario and tested revision inventory.
Each row records its selection status. Source review used upstream history and
issues, scenario text, and baseline product code.

## Payment

Enumerate open and closed GitHub issues and scan case-insensitive product history
across local refs with this command. Repeat with narrower patterns and
`--path` values as needed. The search yielded 188 issues and 139 commit rows in
the supplied clone. Candidates below are the workflow-related hits reviewed.

```sh
bench/plan/bug-candidates.py rwa ../rwa-0729f68 0729f68 'fix|bug|login|logout|bank|profile|settings|email|payment|request|transaction|like|comment|contacts|personal|feed' --path src --path backend
```

| Scenario | Selection | Candidates rejected and why |
| --- | --- | --- |
| auth-login | No upstream match | [#581][581] is a blank-field validation message after a background click. [#1106][1106] reports an unavailable backend following signup. [#986][986] concerns bypassing the UI sign-in. [f41733c][labels] changes accessible field labels, without establishing that the valid-credentials flow fails. |
| auth-logout | No upstream match | [#1592][1592] documents a direct API response status. The browser auth machine enters the unauthorized state on either response outcome and clears its local auth state. [#998][998] concerns Cognito, which the scenario does not use. [#231][231] reports cookie cleanup between logins rather than the asserted same-page reload symptom. The inverses of [39d7adf][logout] and [bf8f402][cookie] do not apply at the baseline. |
| profile-name | No upstream match | [#35][35] and [4881181][profile] introduce the settings workflow. Neither identifies a first-name save or reload defect. |
| profile-email | No upstream match | [#35][35] and [4881181][profile] introduce settings. [#759][759] concerns user search, outside settings validation. |
| bank-create | No upstream match | [b754e46][bankvalidation] changes the accepted account-number length from exactly nine to nine through twelve. The scenario uses nine. [#221][221] concerns a Cypress route stub. |
| bank-delete | No upstream match | [#85][85] defines the bank-account UI. [bfaffd4][graphql] migrates it to GraphQL and does not document a soft-delete regression. |
| transfer-pay | No upstream match | [#155][155] proposes input masking and gives no wrong-result example for a whole-dollar input. [17b7ab2][width] corrects list width. The inverse applies, but the documented clipping does not establish failure for this specific seeded row and desktop viewport. [#67][67] specifies the feature. |
| transfer-request | No upstream match | [#34][34] defines accepting or rejecting existing payment requests. [ea3b57c][notification] addresses request notifications, which the scenario does not assert. [17b7ab2][width] has the same amount-visibility evidence gap as transfer-pay. |
| social-like | No upstream match | [#403][403] reports a Firefox mobile test canceling the like request during immediate logout and failing a notification assertion. This scenario stays on the transaction and checks count and disabled state before reload. [#65][65] specifies the feature. |
| social-comment | No upstream match | [#66][66] and [201441d][comment] introduce commenting and give no evidence of missing or duplicate comments on reload. |
| feed-personal | No upstream match | [622f88e][dimensions] fixes invalid dimensions for the virtualized feed, but the inverse does not apply at the baseline, even with zero context. [#1555][1555] requests replacing the library and gives no matching feed failure. |
| feed-friends | No upstream match | [622f88e][dimensions] and [#1555][1555] have the same limitations as feed-personal. |
| Hold-out 01 | TODO (P4d) | Await scenario ID and text. |
| Hold-out 02 | TODO (P4d) | Await scenario ID and text. |
| Hold-out 03 | TODO (P4d) | Await scenario ID and text. |
| Hold-out 04 | TODO (P4d) | Await scenario ID and text. |
| Hold-out 05 | TODO (P4d) | Await scenario ID and text. |
| Hold-out 06 | TODO (P4d) | Await scenario ID and text. |
| Hold-out 07 | TODO (P4d) | Await scenario ID and text. |
| Hold-out 08 | TODO (P4d) | Await scenario ID and text. |

## External payment report review, 2026-11-27

The dated amendment permits these selections after the upstream search above.
All selected rows are labelled `re-created-from-report`. Each linked report
was opened and checked against the scenario at the baseline above. The two
feed scenarios are in `study/scenarios.feature`. The corresponding dedicated
files under `bench/scenarios/pay` are pending on this branch, which contains
only the two social feature files in that directory.

| Scenario | Selection | Report title and failure quote | Payment component and planned change | Symptom at targeted step |
| --- | --- | --- | --- | --- |
| auth-login | re-created-from-report | [Nextcloud #56165](https://github.com/nextcloud/server/issues/56165), [Bug]: Login loop after upgrade to 32.0.1. “Get redirected back to login page with no error” | Local sign-in in `authMachine.ts`. Return the correct-credentials submission to the signed-out sign-in view without an error message. | Step 4 — Then the authenticated home identifies "Heath93" |
| auth-logout | re-created-from-report | [Postiz #998](https://github.com/gitroomhq/postiz-app/issues/998), Logout redirects to internal page /launches instead of logging out. “the client-side code then immediately redirects the browser to the internal /launches page” | Post-logout client routing. After successful server logout, leave the browser on the authenticated home route, showing a stale home shell until reload. End the session and keep authorization checks in force. | Step 4 — Then the sign-in page and URL are visible |
| profile-name | re-created-from-report | [Expensify #33294](https://github.com/Expensify/App/issues/33294), Web - Profile - Legal name not saved/no validation if language specific characters used. “the Legal name is briefly shown but disappears, no validation errors.” | Profile form and saved profile. Preserve the typed first name in the current form after Save while discarding the first-name update, so the displayed account name retains the previous value. | Step 5 — And my displayed full name contains "Study" |
| profile-email | re-created-from-report | [freeCodeCamp #59701](https://github.com/freeCodeCamp/freeCodeCamp/issues/59701), Email Update Form Accepts Invalid or Non-Existent Email Domains. “the email is accepted even though it is clearly invalid” | Profile email validation. Accept the scenario's malformed input in the settings form, exposing no email-format error after the attempted save. | Step 4 — Then the profile form displays email error "Must contain a valid email address" |
| bank-create | re-created-from-report | [Dolibarr #14421](https://github.com/Dolibarr/dolibarr/issues/14421), Unable to edit or add internal user bank accounts. “new ones cannot be added” | Bank-account creation. Keep Create and Save functional, acknowledge submission and return to the list without storing the new account. | Step 4 — Then bank "Study Credit Union" is visible exactly once |
| bank-delete | re-created-from-report | [Dolibarr #14421](https://github.com/Dolibarr/dolibarr/issues/14421), Unable to edit or add internal user bank accounts. “they cannot be edited or deleted” | Bank-account deletion. Keep the Delete flow actionable and acknowledge completion without marking the record deleted. | Step 4 — Then bank "Waters, King and O'Reilly Bank" is visibly marked deleted |
| transfer-pay | re-created-from-report | [InvoicePlane #1226](https://github.com/InvoicePlane/InvoicePlane/issues/1226), Payment confirmation wrong amount. “An amount of 34 is changed to 3400.” | Recorded payment amount display in `TransactionAmount.tsx`. Apply the reported 100-fold scale error to the paid amount shown in the transaction row. | Step 7 — Then my personal feed contains one visible "Study payment" transaction for "$12.00" with "Kristian" as "paid" |
| transfer-request | re-created-from-report | [Expensify #104045](https://github.com/Expensify/App/issues/104045), Expense-IOU expense with 0.00 amount is created after replacing a failed scan receipt. “An IOU expense is shown with amount of 0.00.” | Money-request amount display. Keep the normal request confirmation and show $0.00 for the requested amount in the personal feed row. | Step 7 — Then my personal feed contains one visible "Study request" transaction for "$12.00" with "Kristian" as "requested" |
| social-like | re-created-from-report | [Forem #5459](https://github.com/forem/forem/issues/5459), Can't post comments. “refresh the page the likes are gone.” | Transaction detail reaction and persistence. Update the displayed count and button state on Like while dropping the write, so reload restores the pre-click state. | Step 10 (after the reload in step 9) — Then the displayed like count is one greater and Like is disabled |
| social-comment | re-created-from-report | [Forem #5459](https://github.com/forem/forem/issues/5459), Can't post comments. “try posting a comment. it doesnt.” | Transaction detail comment submission. Fail the comment service call so the submitted text never appears in the thread. | Step 6 — Then comment "Study comment" is visible in the transaction's comments |
| feed-personal | re-created-from-report | [Bluesky #7241](https://github.com/bluesky-social/social-app/issues/7241), Posts in user repo are not showing in profile or feeds. “not showing in their author feed” | Personal transaction feed. Omit the signed-in user's transactions from the personal feed response while retaining their records. | Step 4 — Then the "Personal" feed at "/personal" contains transactions |
| feed-friends | re-created-from-report | [Bluesky #1768](https://github.com/bluesky-social/social-app/issues/1768), Following feed is empty. “Your following feed is empty!” | Contacts transaction feed. Return an empty contacts feed for a user who has contact transactions. | Step 4 — Then the "Contacts" feed at "/contacts" contains transactions |

The Dolibarr and Forem reports each document two separate user actions. Each
action above gets its own independent change. InvoicePlane shows the amount
error after payment confirmation. The comparable checked surface here is the
post-confirmation feed row.

The coordinator review on 2026-11-27 allowed using the scenario’s inputs when
an external report describes the same failure in the same kind of component.
Expensify #33294 uses language-specific names. freeCodeCamp #59701 reports a
missing domain check at form submission, with downstream verification discussed
in the issue. Expensify #104045 reaches the incorrect IOU amount after a receipt
replacement. The payment recreations use the scenario’s name, malformed email,
and manually entered request amount, respectively. The three mappings reproduce
the reported visible outcomes using these different triggers.

Target steps are 1-based and include `And` lines. These are planned first failing
assertions from the feature text and UI action definitions. Independent checks
belong to the patch stage.

External searches paired the scenario action and failure with public tracker
terms:

| Scenario | Search terms and additional candidates rejected |
| --- | --- |
| auth-login | Correct credentials, login page, login loop. [pgAdmin #7404](https://github.com/pgadmin-org/pgadmin4/issues/7404) reports a CSRF error at the post-login page. |
| auth-logout | Logout redirects, logout button does nothing. [Firefly III #9827](https://github.com/firefly-iii/firefly-iii/issues/9827) requires an SSO logout destination. |
| profile-name | First name not saved, edit profile changes not saved, display name reverts. |
| profile-email | Edit profile invalid email accepted, email format validation, change email. |
| bank-create | Add bank account, cannot create account, form not saved. [Actual #4695](https://github.com/actualbudget/actual/issues/4695) requires GoCardless. [Expensify #35780](https://github.com/Expensify/App/issues/35780) loses edited beneficial-owner details during backtracking. [ERPNext #14877](https://github.com/frappe/erpnext/issues/14877) concerns automatic provisioning in a setup wizard. [Dolibarr #39146](https://github.com/Dolibarr/dolibarr/issues/39146) concerns payment-account associations across entities. |
| bank-delete | Delete bank account, remove bank account, close account, action does nothing. |
| transfer-pay | Payment wrong amount, payment confirmation wrong amount, transaction is saved incorrectly. [Firefly III #2412](https://github.com/firefly-iii/firefly-iii/issues/2412) concerns categorizing a transfer as income and uses different account and transaction types. |
| transfer-request | Manual money request not created, payment request wrong amount, wrong recipient. |
| social-like | Like disappears after refresh, favourite count, reaction count. |
| social-comment | Cannot post comment, comment disappears on refresh. |
| feed-personal | Personal feed missing posts, own posts missing from profile, personal feed tab. [Mastodon #34463](https://github.com/mastodon/mastodon/issues/34463) concerns a Featured tab with no featured content configured. |
| feed-friends | Following feed empty, friends feed blank, following feed tab. |

## Moodle

The plan provides provisional IDs for three changes. The upstream history links
confirm they concern completion controls, global search and block buttons.
Eligibility and the tested revisions come from P7c. Re-run per eligible scenario
using its own search terms and source paths.

```sh
bench/plan/bug-candidates.py moodle /path/to/moodle <tested-revision> 'MDL-[0-9]+.*(assign|grade)' --issue-query 'issuetype = Bug AND text ~ "gradebook"'
```

The [MDL-89461 tracker record][moodle-bug] and [its upstream fix][moodle-fix]
were a source-discovery probe. The defect concerns assignment access when
grading is disabled, so it was rejected for the provisional workflows.

| Scenario | Selection | Candidate review |
| --- | --- | --- |
| S036 | TODO (P7c) | [MDL-87662][b04] relocates the completion button. No qualifying defect established. |
| S037 | TODO (P7c) | [MDL-87662][b04] relocates the completion button. No qualifying defect established. |
| S041 | TODO (P7c) | [MDL-87662][b04] relocates the completion button. No qualifying defect established. |
| S025 | TODO (P7c) | [MDL-87834][b07] redesigns global search. No qualifying defect established. |
| S028 | TODO (P7c) | [MDL-87834][b07] redesigns global search. No qualifying defect established. |
| S029 | TODO (P7c) | [MDL-87834][b07] redesigns global search. No qualifying defect established. |
| S091 | TODO (P7c) | [MDL-85281][b15] restyles block controls. No qualifying defect established. |
| S094 | TODO (P7c) | [MDL-85281][b15] restyles block controls. No qualifying defect established. |
| Remaining Moodle scenarios | TODO (P7c) | Await eligible scenario inventory and tested revisions. |
[581]: https://github.com/cypress-io/cypress-realworld-app/issues/581
[1106]: https://github.com/cypress-io/cypress-realworld-app/issues/1106
[986]: https://github.com/cypress-io/cypress-realworld-app/issues/986
[1592]: https://github.com/cypress-io/cypress-realworld-app/issues/1592
[998]: https://github.com/cypress-io/cypress-realworld-app/issues/998
[231]: https://github.com/cypress-io/cypress-realworld-app/issues/231
[35]: https://github.com/cypress-io/cypress-realworld-app/issues/35
[759]: https://github.com/cypress-io/cypress-realworld-app/issues/759
[221]: https://github.com/cypress-io/cypress-realworld-app/issues/221
[85]: https://github.com/cypress-io/cypress-realworld-app/issues/85
[155]: https://github.com/cypress-io/cypress-realworld-app/issues/155
[67]: https://github.com/cypress-io/cypress-realworld-app/issues/67
[34]: https://github.com/cypress-io/cypress-realworld-app/issues/34
[403]: https://github.com/cypress-io/cypress-realworld-app/issues/403
[65]: https://github.com/cypress-io/cypress-realworld-app/issues/65
[66]: https://github.com/cypress-io/cypress-realworld-app/issues/66
[1555]: https://github.com/cypress-io/cypress-realworld-app/issues/1555
[labels]: https://github.com/cypress-io/cypress-realworld-app/commit/f41733c9e33b5c67cefca063fda8632cdf0350c1
[logout]: https://github.com/cypress-io/cypress-realworld-app/commit/39d7adfe433987716e1d36e38c2bd4a897e1e28e
[cookie]: https://github.com/cypress-io/cypress-realworld-app/commit/bf8f402178aea6b8c66c401ad7f226289fcd1430
[profile]: https://github.com/cypress-io/cypress-realworld-app/commit/488118184ab899ca72333991983c04f6df27daa2
[bankvalidation]: https://github.com/cypress-io/cypress-realworld-app/commit/b754e46259f4207409f7ff9af0c3b618c7bcfdf5
[graphql]: https://github.com/cypress-io/cypress-realworld-app/commit/bfaffd4f382c349df89347e811b0dcfcfbd70bb0
[width]: https://github.com/cypress-io/cypress-realworld-app/commit/17b7ab2d5902f7874036a60e523b625b77be46c2
[notification]: https://github.com/cypress-io/cypress-realworld-app/commit/ea3b57c1d43b8efdab9b313a7282890061a9120d
[comment]: https://github.com/cypress-io/cypress-realworld-app/commit/201441dfbf47a69a319c9d2fbb169d291e9157a4
[dimensions]: https://github.com/cypress-io/cypress-realworld-app/commit/622f88eaaf35d2d70da07fefc12df6601001e70e
[b04]: https://github.com/moodle/moodle/commit/6200c31f94c9216f32902e263620f545250ad9ab
[b07]: https://github.com/moodle/moodle/commit/9105de4c3336e35798be4bffb37d1a410bd8f8c2
[b15]: https://github.com/moodle/moodle/commit/88dbf8a0d99c4798504eb226b4490d05c908ed8e
[moodle-bug]: https://moodle.atlassian.net/browse/MDL-89461
[moodle-fix]: https://github.com/moodle/moodle/commit/45ad958b854dff0575c952ac4bcee333adde2f1e
