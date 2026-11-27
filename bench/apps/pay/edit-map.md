# Payments app edit map

Apply `v1.patch` to upstream commit `0729f68ac220f7cda4ad09c5693dba11d7c532c6`, then apply `v2.patch` to the resulting tree. Paths are relative to the upstream app. Hunk numbers are the starting lines on the **old** side of each patch (`@@ -<line>`).

## v1.patch

| Edit | File | Hunk starts | Change |
| --- | --- | --- | --- |
| 1.1 | `src/components/SignInForm.tsx` | 158 | Change submit label to Log In. |
| 1.2 | `src/components/SignInForm.tsx` | 116, 132 | Rename username and password hooks. |
| 1.3 | `src/components/TransactionCreateStepTwo.tsx` | 167 | Rename Pay and Request hooks in the reordered row. |
| 1.4 | `src/components/TransactionCreateStepTwo.tsx` | 138, 159 | Change amount and note placeholders. |
| 1.5 | `src/components/TransactionCreateStepTwo.tsx` | 1, 86, 127, 167 | Group Pay and Request in that DOM order. Route implicit submission from text fields to Request per the coordinator resolution. |
| 1.6 | `src/components/NavBar.tsx` | 11, 160 | Wrap the bell and New in a Box, with the bell first. |
| 1.7 | `src/components/NavDrawer.tsx` | 141, 178 | Relabel Account settings and Sign out. |
| 1.8 | `src/containers/BankAccountsContainer.tsx` | 9, 74 | Replace the header grid with its title and put the outlined Create button below the list. |
| 1.9 | `src/components/BankAccountItem.tsx` | 1, 12, 27 | Open a confirmation dialog from Delete and move the deletion call to confirm. |
| 1.10 | `src/components/TransactionDetail.tsx` | 1, 9, 106, 207, 229 | Open a confirmation dialog from Reject Request and move the rejection call to confirm. |

## v2.patch

| Edit | File | Hunk starts | Change |
| --- | --- | --- | --- |
| 2.1 | `src/components/BankAccountItem.tsx` | 38, 51, 62 | Rename the Delete trigger, title, and confirm action to Remove. |
| 2.2 | `src/components/TransactionCreateStepTwo.tsx` | 7, 96, 125, 149, 193 | Use exclusive type selection and a guarded Continue button. Preserve implicit Request selection from the form’s text fields. |
| 2.3 | `src/components/TransactionCreateStepTwo.tsx` | 7, 96, 125, 193 | Review validated values and the selected type. Back retains the form and Confirm sends the transaction. |
| 2.4 | `src/components/SignInForm.tsx` | 9, 95, 106, 160 | Move sign-up above the form, group the fields and checkbox in a fieldset, and leave submit last. |
| 2.5 | `src/components/SignUpForm.tsx` | 170, 187 | Rename the confirm-password hook and the submit label. |
| 2.6 | `src/components/NavDrawer.tsx` | 135, 262, 279 | Put Notifications second and move the balance below Sign out. |
| 2.7 | `src/components/UserSettingsForm.tsx` | 77, 94, 111, 128, 150 | Replace placeholders with labels and rename the Save action and hook. |
| 2.8 | `src/components/NotificationListItem.tsx` | 90 | Move both Dismiss variants into the secondary-action slot. |
| 2.9 | `src/components/NavDrawer.tsx` | 1, 8, 15, 201, 279 | Open a confirmation dialog from Sign out and send LOGOUT on confirm. |

For the coordinator’s keyboard and button checks, start a disposable, seeded copy of each patched version. Set `P4C2_FIXTURE_PASSWORD` to the upstream example-user password and run the following against that copy with a local Chromium installation.

```sh
uv run bench/apps/pay/check-submission.py v1 http://localhost:3000 Heath93 --browser /path/to/chromium
uv run bench/apps/pay/check-submission.py v2 http://localhost:3000 Heath93 --browser /path/to/chromium
```

The check creates three transactions in each disposable database. It observes the successful API response and the completion step. For v2 it also checks that Back preserves the note and that the app sends the transaction only after Confirm.
