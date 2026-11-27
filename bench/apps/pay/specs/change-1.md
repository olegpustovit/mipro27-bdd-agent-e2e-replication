# Change 1 — "Payments polish" release (interface only)

App: Cypress Real World App, commit `0729f68` (`~/projects/mipro27-wt/rwa-0729f68`).
Paths are relative to `src/`. Line numbers refer to commit `0729f68`.

## Constraints that apply to every edit

- **Same behavior.** No API call, route, xstate machine event, validation rule, or stored data changes. Each user goal (sign in, pay, request, reject a request, add or delete a bank account, sign out) can still be done, with the same result.
- **Only the interface changes:** visible labels and placeholders, `data-test` hooks, DOM structure and placement of controls, and flow details (added confirmation dialogs).
- Anything not listed here stays as it is. In particular, a `data-test` value that an edit doesn't mention stays the same.

## Breakage-type key (from the literature; details in `inputs.md`)

| Code | Breakage type | Source |
|---|---|---|
| **L-ATTR** | Locator breakage: an attribute the locator relies on changes value (id/name/class/`value`; here `data-test`, placeholder, and visible label text, which is the counterpart of the `value` label of a submit input) | WATERFALL §1 p. 751 (73.62% of 1065 breakages were locator-related); §3 p. 753 (`name = Name` → `name = NewerName`); §4.2 pp. 753–754, Fig. 4 (`name`, `class`, `value` changes on the login form, including the submit button's `value` label) |
| **L-STRUCT** | Locator breakage: the element's position in the DOM hierarchy or on the page changes (wrapper added, sibling order changed, control moved) | WATERFALL §1 p. 751 ("repositioning page elements"); §4.2 p. 754, Fig. 4 and Table 2 (added `<div>` turns XPath `//form/input[3]` into `//form/div/input[3]`) |
| **NL-FLOW** | Non-locator breakage: every locator still resolves, but the interaction sequence changes (for example, a new confirmation dialog must be answered), so a recorded test stops early | WATERFALL §1 p. 751 fn. 1 (definition of breakage: the test "halt[s] prematurely"); §5.3 p. 756 ("breakages due to causes not involving locators"); §6.2 p. 760 (some apps had "a substantially higher number of non-locator breakages") |
| **NL-SEL** | Non-locator breakage: the choices or selection control a user picks from are changed | WATERFALL §1 p. 751 ("altering the selections in a drop-down list can cause such tests to break"). Used only in change 2. |

**Proportion target.** WATERFALL reports that about 74% of breakages are locator-related and the rest are not (§1 p. 751). Across changes 1 and 2 there are 19 edits: 14 locator edits (74%) and 5 non-locator edits (26%). WATERFALL gives no split between attribute and structure locators, or between non-locator subtypes. The detailed taxonomy is in Hammoudi et al., ICST 2016 [13], which I could not open (see `inputs.md`). So the attribute/structure split below (8 / 6 overall) is my own judgment, not a figure from the literature.

**Change 1 mix (10 edits):** L-ATTR 5, L-STRUCT 3, NL-FLOW 2. Locator share: 80%.

---

## Edits

### 1.1 Sign-in submit button label
- **File:** `components/SignInForm.tsx` (lines 152–161)
- **Element:** submit `<Button data-test="signin-submit">`
- **Before:** visible text `Sign In`
- **After:** visible text `Log In`. The `data-test` is unchanged. The page heading `Sign in` (h1, line 94–96) is also unchanged.
- **Breakage type:** L-ATTR (label text used as a locator, the counterpart of the submit `value` attribute change in WATERFALL Fig. 4)
- **Citation:** WATERFALL §4.2 pp. 753–754, Fig. 4 (submit `value="submit_val"` → `value="submit"`); §1 p. 751.

### 1.2 Sign-in field test hooks
- **File:** `components/SignInForm.tsx` (lines 119, 135)
- **Element:** username and password `TextField`s
- **Before:** `data-test="signin-username"`, `data-test="signin-password"`
- **After:** `data-test="login-username"`, `data-test="login-password"`. The `id`s (`username`, `password`), labels, and the `signin-submit` / `signin-remember-me` hooks are unchanged.
- **Breakage type:** L-ATTR
- **Citation:** WATERFALL §3 p. 753 (attribute locator renamed `name = Name` → `name = NewerName`); §4.2 p. 754 (`name="UsernameField"` → `name="user"`).

### 1.3 Pay / Request button test hooks
- **File:** `components/TransactionCreateStepTwo.tsx` (lines 184, 198)
- **Element:** the two submit buttons of the payment form
- **Before:** `data-test="transaction-create-submit-request"`, `data-test="transaction-create-submit-payment"`
- **After:** `data-test="transaction-create-request-button"`, `data-test="transaction-create-pay-button"`. The labels `Request` and `Pay` are unchanged in this release.
- **Breakage type:** L-ATTR
- **Citation:** WATERFALL §3 p. 753; §4.2 pp. 753–754, Fig. 4.

### 1.4 Payment form placeholders
- **File:** `components/TransactionCreateStepTwo.tsx` (lines 141, 162)
- **Element:** amount and description inputs
- **Before:** `placeholder="Amount"`, `placeholder="Add a note"`
- **After:** `placeholder="Amount ($)"`, `placeholder="What's it for?"`. The `id`s, `data-test`s, and validation are unchanged.
- **Breakage type:** L-ATTR (placeholder attribute used as a locator)
- **Citation:** WATERFALL §4.2 pp. 753–754, Fig. 4 (attribute values `class`/`value` changed on text inputs).

### 1.5 Pay / Request buttons regrouped and reordered
- **File:** `components/TransactionCreateStepTwo.tsx` (lines 169–203)
- **Element:** the button row under the form fields
- **Before:** `<Grid container>` holding two `<Grid item>` wrappers, ordered **Request** then **Pay**
- **After:** one `<Box data-test="transaction-create-actions">` holding an MUI `<ButtonGroup variant="contained" fullWidth>`, ordered **Pay** then **Request**. The buttons are direct children of the ButtonGroup, with no per-button Grid wrapper. Labels, hooks from 1.3, `type="submit"`, the `onClick` that sets `transactionType`, and the disabled logic are unchanged.
- **Breakage type:** L-STRUCT (wrapper hierarchy changed and sibling order swapped, so positional or index locators point at the wrong button)
- **Citation:** WATERFALL §4.2 p. 754, Fig. 4 and Table 2 (`//form/input[3]` → `//form/div/input[3]`); §1 p. 751 ("repositioning page elements").

### 1.6 Top bar: notifications bell moved before "New"
- **File:** `components/NavBar.tsx` (lines 164–188)
- **Element:** `nav-top-new-transaction` button and `nav-top-notifications-link` icon button
- **Before:** both are direct children of `<Toolbar>`, in the order logo, **New**, bell
- **After:** both are wrapped in `<Box className="NavBar-actions" display="flex" gap={1}>`, in the order logo, bell, **New**. Hooks, labels, link targets, and the badge are unchanged.
- **Breakage type:** L-STRUCT
- **Citation:** WATERFALL §4.2 p. 754, Fig. 4 and Table 2; §1 p. 751.

### 1.7 Side drawer labels
- **File:** `components/NavDrawer.tsx` (lines 145, 181)
- **Element:** `ListItemText` of `sidenav-user-settings` and `sidenav-signout`
- **Before:** `My Account`, `Logout`
- **After:** `Account settings`, `Sign out`. The `data-test`s and routes are unchanged.
- **Breakage type:** L-ATTR (visible label used as a text locator)
- **Citation:** WATERFALL §4.2 pp. 753–754, Fig. 4 (label-bearing `value` attribute changed); §1 p. 751.

### 1.8 Bank accounts: "Create" button moved below the list
- **File:** `containers/BankAccountsContainer.tsx` (lines 77–101)
- **Element:** `<Button data-test="bankaccount-new">Create</Button>`
- **Before:** in the header `Grid container`, as the right-hand `Grid item` next to the "Bank Accounts" title, above `<BankAccountList>`
- **After:** the header row holds only the title (the Grid container is replaced by a plain `<Typography>`). The button is rendered **after** `<BankAccountList>`, inside `<Box mt={2}>`, as `variant="outlined" fullWidth`. The label `Create`, the hook, and the link to `/bankaccounts/new` are unchanged.
- **Breakage type:** L-STRUCT
- **Citation:** WATERFALL §1 p. 751 ("repositioning page elements"); §4.2 p. 754, Table 2.

### 1.9 Confirmation dialog before deleting a bank account
- **File:** `components/BankAccountItem.tsx` (lines 24–35)
- **Element:** `<Button data-test="bankaccount-delete">Delete</Button>`
- **Before:** a click calls `deleteBankAccount({ id })` right away
- **After:** a click opens an MUI `<Dialog data-test="bankaccount-delete-dialog">` with title `Delete this bank account?` and body `{bankName} will no longer be available for transfers.` The actions are `<Button data-test="bankaccount-delete-cancel">Cancel</Button>`, which closes the dialog and does nothing else, and `<Button data-test="bankaccount-delete-confirm" color="secondary">Delete</Button>`, which calls `deleteBankAccount({ id })` (the same call as before) and closes the dialog. The trigger button keeps its hook and label.
- **Breakage type:** NL-FLOW (all old locators resolve, but an old test that clicks Delete and then checks the list stops early because the deletion never happens)
- **Citation:** WATERFALL §1 p. 751 fn. 1; §5.3 p. 756 ("causes not involving locators"); §6.2 p. 760.

### 1.10 Confirmation dialog before rejecting a payment request
- **File:** `components/TransactionDetail.tsx` (lines 207–220)
- **Element:** `<Button data-test="transaction-reject-request-{id}">Reject Request</Button>`
- **Before:** a click calls `transactionUpdate({ id, requestStatus: rejected })` right away
- **After:** a click opens `<Dialog data-test="transaction-reject-dialog">` with title `Reject this request?` and body `{senderName} requested {amount} for "{description}".` The actions are `Cancel` (`data-test="transaction-reject-cancel"`) and `Reject` (`data-test="transaction-reject-confirm"`), which makes the unchanged `transactionUpdate` call. **Accept Request** stays one click. The trigger keeps its hook and label.
- **Breakage type:** NL-FLOW
- **Citation:** WATERFALL §1 p. 751 fn. 1; §5.3 p. 756; §6.2 p. 760.

---

## Summary table

| # | File | Element | Type |
|---|---|---|---|
| 1.1 | SignInForm.tsx | submit label | L-ATTR |
| 1.2 | SignInForm.tsx | username/password hooks | L-ATTR |
| 1.3 | TransactionCreateStepTwo.tsx | Pay/Request hooks | L-ATTR |
| 1.4 | TransactionCreateStepTwo.tsx | placeholders | L-ATTR |
| 1.5 | TransactionCreateStepTwo.tsx | button group + order | L-STRUCT |
| 1.6 | NavBar.tsx | bell/New order + wrapper | L-STRUCT |
| 1.7 | NavDrawer.tsx | drawer labels | L-ATTR |
| 1.8 | BankAccountsContainer.tsx | Create button placement | L-STRUCT |
| 1.9 | BankAccountItem.tsx | delete confirmation | NL-FLOW |
| 1.10 | TransactionDetail.tsx | reject confirmation | NL-FLOW |
