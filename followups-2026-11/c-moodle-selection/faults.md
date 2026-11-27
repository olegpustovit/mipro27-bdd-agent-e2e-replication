# Seeded faults in both applications: types and visibility (stream C, post-hoc coding)

The coding was done post hoc from the fault specifications and diffs: `scripts/mutations.mjs` for the payment app,
and the `seeded.intent` and `seeded.mutations` fields of `manifests/moodle.yaml` for Moodle. One coder applied it; there
is no second coder. `selection_counts.py` (sections F and G) holds the coded labels, checks that they cover exactly the
faults in the data, and recounts them.

## Type rule (written before classifying; apply in order, first match wins)
1. **NAV, wrong navigation:** the diff changes a route or link destination, so the user lands on the wrong page.
2. **VAL, validation removed or inverted:** the diff removes or inverts an input-validation check, so invalid input
   is accepted or valid input is rejected.
3. Otherwise, if the diff is in code that submits a user action or saves user data (sign-in, save, create, delete,
   like, comment, pay, reset, duplicate):
   - **NOSAVE, action has no effect / change not saved:** afterwards the state the action should change is as it was
     before, entirely or in the changed field. This covers handlers replaced by no-ops, dropped fields, calls removed
     while success is still reported, and an altered submission that the server rejects.
   - **WRONGDATA, wrong data submitted or saved:** the action takes effect, but with altered content (amount, type,
     name, record set or permission value).
4. Otherwise (the diff is in code that renders a page):
   - **GUARD, wrong show/allow condition:** the diff inverts or loosens a boolean condition that decides whether a UI
     element, message or action is shown or allowed (permission, ownership, state, threshold).
   - **DISPLAY, wrong value displayed:** the diff changes which value, template, count or ordering is rendered.

The Moodle fault author used a different, mechanism-based label set (`semantic_change`: wrong value 8, wrong condition
14, missing update 4 of the 26). It is reported for comparison, not used as the type.

## Table for the paper

| Type | Payment app (12 faults = 12 cases) | Moodle seeded, verified (24 of 26) | Moodle, faults in the 16 cases (10) | Moodle cases (16 / 14 run by agents) |
|---|---|---|---|---|
| Wrong navigation | 2 | 0 | 0 | 0 / 0 |
| Validation removed or inverted | 1 | 1 | 1 | 2 / 2 |
| Action has no effect / change not saved | 5 | 4 (+1 failed verification) | 0 | 0 / 0 |
| Wrong data submitted or saved | 4 | 2 | 0 | 0 / 0 |
| Wrong show/allow condition | 0 | 11 (+1 failed verification) | 7 | 12 / 11 |
| Wrong value displayed | 0 | 6 | 2 | 2 / 1 |
| Visible in the UI at the targeted check | 12/12 | – | 10/10 | 16/16 / 14/14 |

Read the table this way: the payment-app faults all act on navigation or on what a user action submits or saves. The 16 Moodle
cases act on what a page shows or allows: 12 wrong show/allow conditions, 2 wrong displayed values and 2 inverted validations.
None of them drops or corrupts a saved change. The 4 NOSAVE and 2 WRONGDATA Moodle faults that passed verification
targeted scenarios of changes that were not selected: X002, X008 and X009 aimed at B11/B12, which no longer bite;
X016, X017 and X024 aimed at B35/B38, whose cases were over the total of 16.

## Per-fault coding

### Payment app (Cypress RWA, 12 faults, `scripts/mutations.mjs`)
| Case | Mutation | Type | Targeted check (coded runner's failing assertion) | What the check sees |
|---|---|---|---|---|
| auth-login | sign-in submits a fixed wrong password | NOSAVE | the authenticated home identifies "Heath93" | page or URL |
| auth-logout | sign-out handler is a no-op | NOSAVE | the sign-in page and URL are visible | page or URL |
| profile-name | first name overwritten with the stored value | NOSAVE | my displayed full name contains "Study" | text |
| profile-email | e-mail format validation removed | VAL | profile form displays email error "Must contain a valid email address" | text |
| bank-create | bank name saved as "Altered Bank" | WRONGDATA | bank "Study Credit Union" is visible exactly once | text |
| bank-delete | delete call is a no-op | NOSAVE | bank "Waters, King and O'Reilly Bank" is visibly marked deleted | text |
| transfer-pay | amount + 1 saved | WRONGDATA | personal feed has one "Study payment" for "$12.00" … "paid" | text |
| transfer-request | request saved as a payment | WRONGDATA | personal feed has one "Study request" for "$12.00" … "requested" | text |
| social-like | like handler is a no-op | NOSAVE | like count is one greater and Like is disabled | number and control state |
| social-comment | comment saved as "Altered comment" | WRONGDATA | comment "Study comment" is visible in the comments | text |
| feed-personal | Mine tab links to /contacts | NAV | the "Personal" feed at "/personal" contains transactions | page or URL |
| feed-friends | Friends tab links to /personal | NAV | the "Contacts" feed at "/contacts" contains transactions | page or URL |

### Moodle (26 seeded faults; ✔ = in a selected case)
| Fault | Intent (manifest, shortened) | Type | Author label | Status |
|---|---|---|---|---|
| X001 | advanced search shows field name instead of description | DISPLAY | wrong value | accepted |
| X002 | resetting list template keeps custom header/footer | NOSAVE | missing update | accepted |
| X003 | ##otherfields## lists fields already in the template | GUARD | wrong condition | accepted |
| X004 | list view prints header where footer belongs | DISPLAY | wrong value | accepted |
| X005 | single view uses the list template | DISPLAY | wrong value | accepted |
| X006 | plugin presets get Edit/Delete (guard removed) | GUARD | wrong condition | **rejected**: PHP exception |
| X007 | presets: manage others' presets but not own | GUARD | wrong condition | accepted |
| X008 | editing a custom field does not update its name | NOSAVE | missing update | accepted |
| X009 | deleting a custom field reports success but keeps it | NOSAVE | missing update | accepted |
| X010 ✔ | search banner shown when switch OR text set (&& → \|\|) | GUARD | wrong condition | accepted |
| X011 ✔ | user autocomplete ignores the course, order changes | DISPLAY | wrong value | accepted |
| X012 | database entries: Actions menu on others' entries | GUARD | wrong condition | accepted |
| X013 | quiz question count off by one | DISPLAY | wrong value | accepted |
| X014 ✔ | completion: tracked/untracked users inverted, button enabled for teachers | GUARD | wrong condition | accepted |
| X015 | presets: Delete offered to users who cannot manage | GUARD | wrong condition | accepted |
| X016 | duplicating a framework copies the wrong competencies | WRONGDATA | wrong condition | accepted |
| X017 | framework update drops the short name | NOSAVE | missing update | accepted |
| X018 ✔ | marking guide: "criterion name can not be empty" fires for named criteria | VAL | wrong condition | accepted |
| X019 | role permissions: change to Prohibit not saved | NOSAVE | wrong condition | **rejected**: failed at another step |
| X020 ✔ | workshop: submission deletable unless >5 assessments (was >0) | GUARD | wrong value | accepted |
| X021 ✔ | activity results block: "please configure" shown when configured | GUARD | wrong condition | accepted |
| X022 ✔ | logged-in user block shows username instead of full name | DISPLAY | wrong value | accepted |
| X023 ✔ | browser sessions: "Current session" label on the other sessions | GUARD | wrong condition | accepted |
| X024 | role permissions: Prevent saved as Prohibit | WRONGDATA | wrong value | accepted |
| X025 ✔ | messaging: "can message even if blocked" flag inverted | GUARD | wrong condition | accepted |
| X026 ✔ | navigation: Content bank node for users without the capability | GUARD | wrong condition | accepted |

Borderline calls, so a reader can recode them: X003 (the inverted condition decides which fields a list shows) is
GUARD under rule 4, though its effect is a wrong list (DISPLAY). X020 (a threshold changed from >0 to >5) is GUARD
because the threshold decides whether a Delete button is offered. auth-login is NOSAVE because the server rejects the
altered submission and the user stays signed out.

## Visibility at the targeted check
Rule: a fault is visible at the targeted check when the difference the check asserts on is in the rendered page at that
step: text, element presence, control state, item order, or the page URL. For Moodle this is derived from the Behat
error of the frozen screening run at the target step (`screen_targets[].error`). For the payment app it is coded from
the scenario text and the mutation.

| App | Text or element present/absent/changed | Control state | Item order | Page or URL | Not visible |
|---|---|---|---|---|---|
| Payment (12 cases) | 7 | 1 (like count and disabled Like) | 0 | 4 | 0 |
| Moodle (16 cases) | 12 | 3 (X014: `disabled` attribute not set) | 1 (X011@S025) | 0 | 0 |
| Moodle, agent cases (14) | 11 | 3 | 0 | 0 | 0 |

Every targeted check in both apps asserts on something rendered. In no case was the fault visible only in the
database or the network. Two qualifications:
- The three B04/X014 checks depend on a `disabled` attribute. The button is present in both builds; only its state differs.
- B07.S029 asserts on a CSS class (`.notifywarning` should not exist). The banner it detects is also visible as text.

Some Moodle checks sit downstream of the fault's first visible effect. In X018@S154, the Behat error is only "Comment 1" text not found at step 12. That the guide could not be saved
earlier is inferred from the fault intent; no step before 12 failed. The target is still the first failing
step of the developers' run.
