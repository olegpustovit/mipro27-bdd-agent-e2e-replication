# Change 2 — "Review before you send" release (interface only; builds on change 1)

App: Cypress Real World App, commit `0729f68` **with change 1 applied**.
Paths are relative to `src/`. Line numbers refer to commit `0729f68`; where an edit changes an element that change 1 introduced or altered, that is stated.

## Constraints that apply to every edit

The constraints are the same as in change 1. Behavior does not change: the same API calls, routes, xstate events, validation, and data, and every user goal can still be reached with the same result. Only labels, hooks, structure and placement, and flow details change. Anything not listed here stays as change 1 left it.

## Breakage-type key

The codes are the same as in `change-1.md`: **L-ATTR**, **L-STRUCT**, **NL-FLOW**, **NL-SEL**. All citations are to WATERFALL (Hammoudi, Rothermel, Stocco, FSE 2016, pp. 751–762). See `inputs.md` for the exact passages.

**Change 2 mix (9 edits):** L-ATTR 3, L-STRUCT 3, NL-FLOW 2, NL-SEL 1. Locator share: 67%.
**Both changes together (19 edits):** locator 14 (74%; L-ATTR 8, L-STRUCT 6), non-locator 5 (26%; NL-FLOW 4, NL-SEL 1). This matches WATERFALL's 73.62% locator share (§1 p. 751). The split within each group is my own judgment, because the detailed taxonomy (ICST 2016) could not be read.

---

## Edits

### 2.1 Bank account "Delete" renamed to "Remove" (builds on 1.9)
- **File:** `components/BankAccountItem.tsx`, including the dialog added in 1.9
- **Element:** the trigger button and the dialog's confirm button and title
- **Before (after change 1):** trigger `data-test="bankaccount-delete"` with label `Delete`; dialog title `Delete this bank account?`; confirm `data-test="bankaccount-delete-confirm"` with label `Delete`
- **After:** trigger `data-test="bankaccount-remove"` with label `Remove`; dialog title `Remove this bank account?`; confirm `data-test="bankaccount-remove-confirm"` with label `Remove`. `bankaccount-delete-dialog`, `bankaccount-delete-cancel`, the `(Deleted)` suffix in the list, and the `deleteBankAccount({ id })` call are unchanged.
- **Breakage type:** L-ATTR
- **Citation:** WATERFALL §3 p. 753 (attribute locator renamed twice across versions, `Name` → `NewerName` → `NewestName`, the same pattern as this second rename); §4.2 pp. 753–754, Fig. 4.

### 2.2 Transaction type picked with a toggle, then one "Continue" button (builds on 1.3 and 1.5)
- **File:** `components/TransactionCreateStepTwo.tsx`
- **Element:** the `<ButtonGroup>` inside `transaction-create-actions` from 1.5
- **Before (after change 1):** two submit buttons, `Pay` (`transaction-create-pay-button`) and `Request` (`transaction-create-request-button`). Clicking either one sets the type **and** submits.
- **After:** an exclusive `<ToggleButtonGroup data-test="transaction-create-type" exclusive>` holds two `<ToggleButton>`s with the **same hooks and labels** (`transaction-create-pay-button` "Pay", `transaction-create-request-button` "Request"). They are `type="button"`, so clicking one only selects the type (`setTransactionType`). No type is selected at first. Below the group is one submit button, `<Button type="submit" data-test="transaction-create-continue">Continue</Button>`, which is disabled until the form is valid **and** a type is selected. The transaction type values (`"payment"` / `"request"`) and the payload are unchanged.
- **Breakage type:** NL-SEL. The old locators still resolve, but the type is now chosen from a selection control rather than through separate action buttons, so a recorded "click Pay" no longer submits and the test stops at the next step.
- **Citation:** WATERFALL §1 p. 751 ("altering the selections in a drop-down list can cause such tests to break"); fn. 1 p. 751 (breakage definition).

### 2.3 Review dialog before a payment or request is sent (builds on 2.2)
- **File:** `components/TransactionCreateStepTwo.tsx`
- **Element:** the Formik `onSubmit` of `transaction-create-form`
- **Before:** `onSubmit` calls `createTransaction({ transactionType, ...values })` and shows the success snackbar right away
- **After:** `onSubmit` opens `<Dialog data-test="transaction-review-dialog">` with title `Confirm payment` or `Confirm request`, and body `Pay {amount} to {receiver first and last name} for "{description}"?` (or `Request {amount} from …`). The actions are `<Button data-test="transaction-review-back">Back</Button>`, which closes the dialog and keeps the form values, and `<Button data-test="transaction-review-confirm" variant="contained">Confirm</Button>`. Confirm runs the **unchanged** original submit code (reset the type, `createTransaction`, and the "Transaction Submitted!" snackbar). Step three is unchanged.
- **Breakage type:** NL-FLOW
- **Citation:** WATERFALL §1 p. 751 fn. 1; §5.3 p. 756 ("breakages due to causes not involving locators"); §6.2 p. 760.

### 2.4 Sign-in form regrouped; sign-up link moved to the top (builds on 1.1 and 1.2)
- **File:** `components/SignInForm.tsx` (lines 106–176)
- **Element:** form layout
- **Before:** the `<Form>` holds the two `TextField`s, the `FormControlLabel` (remember me), the submit button, and then a bottom `Grid container` with the `data-test="signup"` link
- **After:** the two fields and the remember-me checkbox are wrapped in `<Box component="fieldset" className="SignInForm-fields" border={0} p={0}>`. The `Grid container` with the `signup` link is removed. The link (same hook, text, and target) is now a `<Typography variant="body2">` placed **between the "Sign in" heading and the form**. The submit button stays the last child of the form.
- **Breakage type:** L-STRUCT
- **Citation:** WATERFALL §4.2 p. 754, Fig. 4 and Table 2 (a wrapper `<div>` added around login inputs breaks the XPath to the submit button); §1 p. 751 ("repositioning page elements").

### 2.5 Sign-up: confirm-password hook and submit label
- **File:** `components/SignUpForm.tsx` (lines 173, 187–190)
- **Element:** confirm-password `TextField`; submit button
- **Before:** `data-test="signup-confirmPassword"`; submit label `Sign Up`
- **After:** `data-test="signup-confirm-password"`; submit label `Create account`. `signup-submit`, `signup-title` (text "Sign Up"), and all other hooks are unchanged.
- **Breakage type:** L-ATTR
- **Citation:** WATERFALL §3 p. 753; §4.2 pp. 753–754, Fig. 4 (`name` and submit `value` changes).

### 2.6 Side drawer reordered: Notifications moved up, balance moved down (builds on 1.7)
- **File:** `components/NavDrawer.tsx` (lines 117–175, 254–296)
- **Element:** `mainListItems` order; balance block
- **Before:** menu order Home, Account settings, Bank Accounts, Notifications. The balance block (`sidenav-user-balance` + "Account Balance") sits above the menu lists.
- **After:** menu order Home, **Notifications**, Account settings, Bank Accounts. The balance block is moved **below** the secondary list (after Sign out), in its own `<Grid item>`. Hooks, labels, and routes are unchanged.
- **Breakage type:** L-STRUCT
- **Citation:** WATERFALL §1 p. 751; §4.2 p. 754, Table 2.

### 2.7 User settings: placeholders replaced by floating labels; save hook and label
- **File:** `components/UserSettingsForm.tsx` (lines 80, 97, 114, 131, 146–157)
- **Element:** the four `TextField`s and the submit button
- **Before:** `placeholder="First Name" | "Last Name" | "Email" | "Phone Number"` with no `label`; submit `data-test="user-settings-submit"`, label `Save`
- **After:** each field gets `label="First name" | "Last name" | "Email address" | "Phone number"` and **no** `placeholder` attribute. The input hooks (`user-settings-*-input`) and `id`s are unchanged. The submit becomes `data-test="user-settings-save"` with label `Save changes`.
- **Breakage type:** L-ATTR
- **Citation:** WATERFALL §4.2 pp. 753–754, Fig. 4 (`value`/`class`/`name` attribute changes); §3 p. 753.

### 2.8 Notification "Dismiss" moved into the list item's secondary-action slot
- **File:** `components/NotificationListItem.tsx` (lines 93–117)
- **Element:** `notification-mark-read-{id}` (both the xs icon variant and the desktop button variant)
- **Before:** a direct child of `<StyledListItem>`, after `<ListItemText>`
- **After:** passed through the ListItem's `secondaryAction` prop, so MUI renders it inside a separate `ListItemSecondaryAction` container rather than as a direct child of the list item. Hook, label (`Dismiss`), `aria-label`, and handler are unchanged.
- **Breakage type:** L-STRUCT
- **Citation:** WATERFALL §4.2 p. 754, Fig. 4 and Table 2 (new container element changes the hierarchical path).

### 2.9 Confirmation dialog before signing out (builds on 1.7)
- **File:** `components/NavDrawer.tsx` (`secondaryListItems`, lines 175–184; `NavDrawer`, lines 195–197)
- **Element:** `<ListItem data-test="sidenav-signout">Sign out</ListItem>`
- **Before (after change 1):** a click sends `LOGOUT` right away
- **After:** a click opens `<Dialog data-test="signout-dialog">` with title `Sign out of Real World App?`. The actions are `Cancel` (`data-test="signout-cancel"`, which closes the dialog) and `Sign out` (`data-test="signout-confirm"`, which sends the unchanged `LOGOUT`). The trigger keeps its hook and label. The onboarding dialog's `user-onboarding-logout` button is **not** changed.
- **Breakage type:** NL-FLOW
- **Citation:** WATERFALL §1 p. 751 fn. 1; §5.3 p. 756; §6.2 p. 760.

---

## Summary table

| # | File | Element | Builds on | Type |
|---|---|---|---|---|
| 2.1 | BankAccountItem.tsx | Delete → Remove (trigger + dialog) | 1.9 | L-ATTR |
| 2.2 | TransactionCreateStepTwo.tsx | toggle + Continue | 1.3, 1.5 | NL-SEL |
| 2.3 | TransactionCreateStepTwo.tsx | review dialog | 2.2 | NL-FLOW |
| 2.4 | SignInForm.tsx | fieldset wrapper, sign-up link moved | 1.1, 1.2 | L-STRUCT |
| 2.5 | SignUpForm.tsx | confirm-password hook, submit label | — | L-ATTR |
| 2.6 | NavDrawer.tsx | menu order, balance placement | 1.7 | L-STRUCT |
| 2.7 | UserSettingsForm.tsx | placeholders → labels, save hook/label | — | L-ATTR |
| 2.8 | NotificationListItem.tsx | Dismiss in secondary-action slot | — | L-STRUCT |
| 2.9 | NavDrawer.tsx | sign-out confirmation | 1.7 | NL-FLOW |
