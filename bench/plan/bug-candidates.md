# Real bug candidates

Payment scope is the 12 tagged scenarios in `study/scenarios.feature` at the
upstream baseline `0729f68ac220f7cda4ad09c5693dba11d7c532c6`. P4d supplied the eight
hold-outs below and P7c supplies the Moodle scenario and tested revision inventory.
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

## Payment hold-outs

The eight P4d scenarios are in `bench/scenarios/pay/hold-out`. Step numbers
come from `bench/stepdefs/pay/v0/hold-out-targets.json`. These are planned
first failing assertions. Independent confirmation belongs to the patch stage.

```sh
bench/plan/bug-candidates.py rwa ../rwa-0729f68 0729f68 'notification|dismiss|onboard|sign.up|confirm.password|phone|search|reject|accept|filter' --path src --path backend
```

The upstream history and issue scan yielded no reversible product fix or
fitting upstream defect for these targets. Notifications issue [#1332](https://github.com/cypress-io/cypress-realworld-app/issues/1332)
concerns test flakiness. [#153](https://github.com/cypress-io/cypress-realworld-app/issues/153),
[#34][34], [#36](https://github.com/cypress-io/cypress-realworld-app/issues/36),
[#15](https://github.com/cypress-io/cypress-realworld-app/issues/15) and
[#117](https://github.com/cypress-io/cypress-realworld-app/issues/117) specify features.
[#1106][1106] concerns a backend connection failure during sign-in,
[#585](https://github.com/cypress-io/cypress-realworld-app/issues/585) concerns the
Cypress command log, and [#759][759] describes a test/search discrepancy where
first-name search already works.

| Scenario | Selection | Report title and failure quote | Payment component and planned change | Symptom at targeted step |
| --- | --- | --- | --- | --- |
| hold-01 | re-created-from-report | [nextcloud/server #1356](https://github.com/nextcloud/server/issues/1356), Can't dismiss “send usage report” notification. “Clicking any button fails to dismiss the notification.” | Notification dismissal. Accept the Dismiss click and keep the selected row in the notifications list. | Step 5 — Then the notification "Kristian Bradtke liked a transaction." is no longer listed |
| hold-02 | re-created-from-report | [Expensify/App #65169](https://github.com/Expensify/App/issues/65169), After selecting “11-50” employees “How would you like to get started” is not shown. “page is not displayed, user is redirected to the OD Home page” | New-user onboarding. Keep registration and first sign-in working and route to home without opening the onboarding dialog. | Step 4 — Then the "Get Started with Real World App" dialog is shown |
| hold-03 | re-created-from-report | [Data-Boom/SOEN490 #206](https://github.com/Data-Boom/SOEN490/issues/206), Sign up confirm password does not check for the same password. “there is no validation that the passwords are the same.” | Sign-up form validation. Suppress the inline confirmation mismatch message after blur. Keep submission validation in place. | Step 4 — Then the message "Password does not match" is shown under Confirm Password |
| hold-04 | re-created-from-report | [Expensify/App #33294](https://github.com/Expensify/App/issues/33294), Web - Profile - Legal name not saved/no validation if language specific characters used. “the Legal name is briefly shown but disappears” | Profile save. Acknowledge the phone edit successfully and retain the old phone value in storage so reload restores it. | Step 7 — Then the Phone Number field shows "555-123-4567" |
| hold-05 | re-created-from-report | [woocommerce/woocommerce #26587](https://github.com/woocommerce/woocommerce/issues/26587), Imported Customers Cannot Be Searched for by First and Last Name When Creating a Manual Order. “Imported customers are not searchable by first and last name when creating a manual order.” | Transaction recipient picker. Leave the initial people list intact, then omit first-name matches from the filtered results. | Step 5 — Then the first person in the list is "Ruthie Prosacco" |
| hold-06 | re-created-from-report | [frappe/payments #204](https://github.com/frappe/payments/issues/204), Payment Request lacks `on_payment_authorized()` handler for Stripe success flow, causing successful Stripe payments to remain in `Requested` state. “still leave the ERPNext `Payment Request` in status `Requested`.” | Payment-request details. Complete acceptance while leaving the detail title on the pre-acceptance Requested wording. | Step 6 — Then the transaction reads "Lia Rosenbaum charged Ted Parisian" |
| hold-07 | re-created-from-report | [Expensify/App #87095](https://github.com/Expensify/App/issues/87095), Concierge AI Re-Adds Rejected Expenses and Resubmits Reports, Causing Infinite Reject Loop. “Resubmits reports automatically in some cases” | Payment-request rejection. Complete the rejection click, then restore the pending presentation so the same request again shows Accept and Reject. | Step 6 — Then the "Accept Request" and "Reject Request" buttons are no longer shown |
| hold-08 | re-created-from-report | [jameskokoska/Cashew #633](https://github.com/jameskokoska/Cashew/issues/633), Incorrect operation of the transaction filter with non-primary currencies. “the program displays transactions based on the account currency instead of the priority currency” | Personal feed amount filter. Keep the chosen chip and lower bound intact, but apply the upper bound in the wrong amount units so larger transactions remain visible. | Step 6 — And every listed transaction shows an amount between $10.00 and $20.00 |

External searches covered notification dismissal, missing onboarding, missing
password confirmation feedback, lost profile edits, name-based recipient search,
stale payment request status after acceptance, reopened requests after rejection,
and incorrect amount filters. The external reports use different inputs or
triggers under the amended rule. For hold-04 the affected profile field in the
source is legal name. For hold-05 the source uses an imported customer and a full
name. For hold-07 the source reopens a rejected expense via automatic resubmission.
For hold-03, additional searches for signup confirmation mismatch and missing
validation feedback found no fitting report in a well-known open-source web
app. The Data-Boom course-project issue remains the direct match.
[DevGuard #2117](https://github.com/l3montree-dev/devguard/issues/2117) reports
a false mismatch message for identical passwords.
For hold-08 the source compares amounts in the wrong currency. The planned change
compares the upper bound in the wrong units.

## Moodle

P7c identifies 19 eligible scenario-at-change units across five changes.
The same scenario ID can appear at more than one change. Each unit is keyed
by change and scenario ID. Step numbers exclude Background and count all
scenario steps, including fixture steps and continuations. I matched the listed
step in both paired extracts.

| Change | Tested pre revision | Tested post revision |
| --- | --- | --- |
| B15 | `d65e24a62c0dc3995f9b88eed0d3a4153bb1a290` | `88dbf8a0d99c4798504eb226b4490d05c908ed8e` |
| B01 | `20bb0b2429535deecd811520a6820ee108b67821` | `a468a463289306de83672c3cfba902ff31f484fc` |
| B04 | `746815af497517c350cff2753bfb386a99cd1d33` | `6200c31f94c9216f32902e263620f545250ad9ab` |
| B05 | `51e3ffd811dd6b3378ad8c27eefe24091054b35a` | `c46ecf938abf04959896431eb63105504ee9e37f` |
| B07 | `c87bae8d3979b9e2f131e7d237dd42c2f49d6810` | `9105de4c3336e35798be4bffb37d1a410bd8f8c2` |

| Scenario at change | Selection | Report title and failure quote | Moodle component and planned change | Symptom at targeted step |
| --- | --- | --- | --- | --- |
| B15/S091 | re-created-from-report | [MDL-26023](https://moodle.atlassian.net/browse/MDL-26023), Blocks: myprofile block does not display for enrolled student on course page. “the block was not being displayed” | Logged-in-user block. Let the add action complete but suppress the block when the dashboard renders for the logged-in user. | Step 5 — Then I should see "Teacher One" in the "Logged in user" "block" |
| B15/S093 | re-created-from-report | [Google for WooCommerce #3713](https://github.com/woocommerce/google-listings-and-ads/issues/3713), WPCOM REST API authorization can never be granted when Jetpack is already connected: no UI path, auth_url unusable. “no authorization prompt” | Accessibility review block. Add and render the block for an unregistered site while suppressing the registration prompt. | Step 5 — And I should see "Your accessibility toolkit needs to be registered." |
| B15/S094 | re-created-from-report | [Google for WooCommerce #3713](https://github.com/woocommerce/google-listings-and-ads/issues/3713), WPCOM REST API authorization can never be granted when Jetpack is already connected: no UI path, auth_url unusable. “No admin notice appears anywhere in wp-admin.” | Activity results block. Add and render the unconfigured block with JavaScript disabled while suppressing its configuration instructions. | Step 2 — Then I should see "Please configure this block and select which activity it should display results from." in the "Activity results" "block" |
| B01/S027 | re-created-from-report | [PrestaShop ps_banner #78](https://github.com/PrestaShop/ps_banner/issues/78), Uploading a banner for one language silently deletes the banner image for all other languages (root cause of #69). “display no banner at all” | Search results banner. Suppress the enabled, nonblank warning while allowing the search to return normally. | Step 3 — Then I should see "The search currently only finds frog-related content" in the ".notifywarning" "css_element" |
| B01/S028 | re-created-from-report | [WooCommerce #55447](https://github.com/woocommerce/woocommerce/issues/55447), “This is a demo store for testing purposes — no orders shall be fulfilled.” is always shown independently from changing the website visibility option. “message is still shown” | Search results banner. Render the configured warning text even when its display setting is disabled. | Step 3 — Then I should not see "The search currently only finds frog-related content" |
| B01/S029 | re-created-from-report | [Discourse Meta #408667](https://meta.discourse.org/t/empty-banner-box/408667), Empty banner box. “an empty banner box at the top of my page” | Search results banner. Render the empty warning container when the display setting is enabled and the banner text is blank. | Step 3 — Then ".notifywarning" "css_element" should not exist |
| B04/S036 | re-created-from-report | [MDL-71455](https://moodle.atlassian.net/browse/MDL-71455), Restored course with completion conditions not shown yet 'Show completion conditions' set to Yes. “completion conditions are not shown” | Course activity completion display. Suppress the completion conditions on the course page even when the course flag is enabled. | Step 3 — Then "Test choice manual" should have the "Mark as done" completion condition |
| B04/S037 | re-created-from-report | [MDL-76187](https://moodle.atlassian.net/browse/MDL-76187), Manual completion button can show when it should not. “has the Manual completion button present” | Course-page manual completion. Hide automatic conditions as configured, but continue to show the manual completion control for the manual Choice when the course setting is off. | Step 10 — And the manual completion button for "Test choice manual" should not exist |
| B04/S040 | re-created-from-report | [MDL-76187](https://moodle.atlassian.net/browse/MDL-76187), Manual completion button can show when it should not. “has the Manual completion button present” | Course-page manual completion. Show the manual assignment control in the student's course view with conditions disabled, after the teacher's settings and visibility checks succeed. | Step 9 — Then the manual completion button for "Music history" should not exist |
| B04/S041 | re-created-from-report | [MDL-80262](https://moodle.atlassian.net/browse/MDL-80262), Activity Completion Buttons are Incorrect for some Activities. “the "To Do" status is showing instead of showing "Done."” | Manual activity completion status. Let the student toggle completion while leaving the activity-page button on its prior label. | Step 7 — And the manual completion button of "Music history" is displayed as "Done" |
| B05/S042 | re-created-from-report | [MDL-63194](https://moodle.atlassian.net/browse/MDL-63194), Moving questions from section to section in quiz does not work. “the question is still at its former position” | Quiz structure editor. Preserve the within-page reorder, then acknowledge the first cross-page move while retaining Question A on page 1. | Step 11 — And I should see "Question A" on quiz page "2" |
| B05/S043 | re-created-from-report | [MDL-47959](https://moodle.atlassian.net/browse/MDL-47959), Number of questions not updated dynamically in new quiz edit page. “Doesn't update the number of questions in the quiz when a question gets deleted.” | Quiz questions summary. Delete the question and update marks while leaving the displayed question count at three. | Step 15 — And I should see "Questions: 2" |
| B05/S044 | re-created-from-report | [MDL-25374](https://moodle.atlassian.net/browse/MDL-25374), Repaginate button doesn't work. “the repaginate button doesn't do anything when you click it.” | Quiz repagination. Open and submit the Repaginate dialog but retain the previous page assignments. | Step 87 — And I should see "Question2 text" on quiz page "2" |
| B05/S045 | re-created-from-report | [MDL-63194](https://moodle.atlassian.net/browse/MDL-63194), Moving questions from section to section in quiz does not work. “the question is still at its former position” | Quiz structure editor. Acknowledge moving Question6 across a page boundary while retaining the original page assignment. | Step 7 — And I should see "Question6 text" on quiz page "1" |
| B05/S046 | re-created-from-report | [MDL-62404](https://moodle.atlassian.net/browse/MDL-62404), Quiz "add page break" button works inconsistently on Clean theme. “when the quiz is previewed it doesn't seem to have actually worked.” | Quiz preview pagination. Accept both page-break actions but ignore the first break when persisting the layout used by preview. Keep the later break so Next page remains actionable. | Step 9 — And I should see "Question4 text" |
| B05/S047 | re-created-from-report | [MDL-52040](https://moodle.atlassian.net/browse/MDL-52040), Error adding new quiz page section heading to first section (page). “Clicking the "Add section header" on first quiz page” | Quiz section-heading menu. Expose the new-section option on the first page, where the scenario expects the option to be hidden. | Step 7 — Then "a new section heading" "link" in the "Page 1" "list_item" should not be visible |
| B07/S027 | re-created-from-report | [PrestaShop ps_banner #78](https://github.com/PrestaShop/ps_banner/issues/78), Uploading a banner for one language silently deletes the banner image for all other languages (root cause of #69). “display no banner at all” | Search results banner. Suppress the enabled, nonblank warning while allowing the search to return normally. | Step 3 — Then I should see "The search currently only finds frog-related content" in the ".notifywarning" "css_element" |
| B07/S028 | re-created-from-report | [WooCommerce #55447](https://github.com/woocommerce/woocommerce/issues/55447), “This is a demo store for testing purposes — no orders shall be fulfilled.” is always shown independently from changing the website visibility option. “message is still shown” | Search results banner. Render the configured warning text even when its display setting is disabled. | Step 3 — Then I should not see "The search currently only finds frog-related content" |
| B07/S029 | re-created-from-report | [Discourse Meta #408667](https://meta.discourse.org/t/empty-banner-box/408667), Empty banner box. “an empty banner box at the top of my page” | Search results banner. Render the empty warning container when the display setting is enabled and the banner text is blank. | Step 3 — Then ".notifywarning" "css_element" should not exist |

Tracker searches used project `MDL`, issue type `Bug`, and the following
summary or text terms: `searchbanner`, `searchbannerenable`, global search,
search warning, completion conditions, manual completion, logged-in user
block, activity results block, accessibility toolkit, move question, question
count, repaginate, page break, and section heading. The public Jira issue API
returned the summaries and descriptions when browser browsing of Jira failed.

The available local Moodle checkout is shallow. I also searched Moodle's
GitHub commit index and the integration diffs linked by the tracker. I checked
the B05 snapshots with `git apply --reverse --check` on matching upstream
source paths. The candidate diffs for [the quiz count fix](https://github.com/colchambers/moodle/compare/MDL-47368...MDL-47959)
and [the older question-move fix](https://github.com/moodle/moodle/commit/72b8806abca06cfe60ff3fa08dba9dfb6e714505)
did not apply to either revision. The old Repaginate JavaScript file is absent
at both tested revisions. [The preview invalidation fix](https://github.com/moodle/moodle/commit/78c1a0a3e500c8428b8228f515ab05e44459a012)
could be reversed at both revisions, but it invalidates existing previews.
S046 starts a fresh preview and has no prior preview to invalidate.
The completion visibility fix linked from MDL-71455 updates backup and
restore behavior. S036 builds its course directly.

The Moodle selections re-create reported effects using the scenario fixtures.
For B05/S042 and B05/S045, the source moves between sections and sees the stale
position upon reload. The current quiz editor checks the resulting position
as part of the edit workflow and crosses page boundaries. For B04/S041, the
source reports an incorrect completion status for quizzes or forums. This
mapping reproduces the stale status label for a manual assignment toggle.
S091 maps a missing block on a course page to a missing instance of the same
block on the dashboard.

The eight units without a fitting upstream report use the dated Moodle
fallback. The external search covered missing configured banners, notices
shown despite disabled display, empty warning containers, and missing plugin
setup prompts. B01 and B07 share the same three search-banner expectations.
The PrestaShop report uses a localized image, the WooCommerce report uses a
store-visibility toggle, and the Discourse report uses a blank localized
header. For B15 the Google for WooCommerce report supplies the missing
setup-prompt effect for two separate block conditions. The earlier Moodle
tracker candidates remain in the review below.

| Unit or units | Moodle tracker candidates reviewed |
| --- | --- |
| B15/S093 | [MDL-71821](https://moodle.atlassian.net/browse/MDL-71821) concerns disappearing activation keys in a registered installation. This fixture starts unregistered. |
| B15/S094 | [MDL-51905](https://moodle.atlassian.net/browse/MDL-51905) concerns default activity selection when a block is added from a module. [MDL-45429](https://moodle.atlassian.net/browse/MDL-45429) concerns a different block showing an unwanted configuration prompt to students. |
| B01/S027 and B07/S027 | [MDL-79784](https://moodle.atlassian.net/browse/MDL-79784) concerns mobile web-service text formatting, and [MDL-59496](https://moodle.atlassian.net/browse/MDL-59496) concerns the separate site-registration warning on the administration page. |
| B01/S028 and B07/S028 | [MDL-25491](https://moodle.atlassian.net/browse/MDL-25491) concerns stale radio-button state for an external-converter setting. [MDL-74781](https://moodle.atlassian.net/browse/MDL-74781) concerns a repeated page heading. |
| B01/S029 and B07/S029 | [MDL-79784](https://moodle.atlassian.net/browse/MDL-79784) concerns formatting of configured mobile banner text. No matching report established a warning for an enabled but blank browser banner. |

Reusable search:
```sh
bench/plan/bug-candidates.py moodle /path/to/moodle <tested-revision> 'MDL-[0-9]+.*(quiz|repaginat|completion|search|block)' --issue-query 'issuetype = Bug AND summary ~ "repaginate"'
```

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
