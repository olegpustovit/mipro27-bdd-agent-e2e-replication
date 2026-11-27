# P4c inputs — exactly what the blind specifier read

Date: 2026-11-27. Nothing outside the items below was opened.

## 1. App source — `~/projects/mipro27-wt/rwa-0729f68` (commit `0729f68`)

- **Top-level listing** of the repo root, `src/`, `src/components/`, and `src/containers/` (file names only).
- **Grep** over `src/components/*.tsx` and `src/containers/*.tsx` for `data-test`, `label=`, and `placeholder=`. Lines from `*.cy.tsx` files were filtered out of the output.
- **Read in full or in large part** (render/JSX bodies; for SignInForm, the whole file):
  - `src/components/SignInForm.tsx` (full)
  - `src/components/SignUpForm.tsx` (render part)
  - `src/components/TransactionCreateStepOne.tsx`, `TransactionCreateStepTwo.tsx`, `TransactionCreateStepThree.tsx` (full output, render bodies read)
  - `src/components/NavBar.tsx`, `NavDrawer.tsx`, `TransactionNavTabs.tsx`
  - `src/components/TransactionDetail.tsx`, `TransactionTitle.tsx`
  - `src/components/BankAccountForm.tsx`, `BankAccountItem.tsx`; `src/containers/BankAccountsContainer.tsx`
  - `src/components/UserSettingsForm.tsx`, `NotificationListItem.tsx`, `CommentForm.tsx`, `UserListSearchForm.tsx`
  - `src/containers/UserOnboardingContainer.tsx` (render part)
- **Route grep only:** `path=` lines in `src/containers/*.tsx`.
- **Not opened:** `cypress/` (any part), `src/__tests__/`, any `*.cy.tsx` component test, `backend/`, `data/`, `scripts/`, the README, and all config files.

## 2. Literature

| Source | URL | Access | Read depth |
|---|---|---|---|
| Hammoudi, Rothermel, Stocco. *WATERFALL: An Incremental Approach for Repairing Record-Replay Tests of Web Applications.* FSE 2016, pp. 751–762, DOI 10.1145/2950290.2950294 (author's version) | https://tsigalko18.github.io/assets/pdf/2016-Hammoudi-FSE.pdf | Open (author copy) | Converted to text with pypdf. Read closely: §1 (p. 751, including fn. 1–2), §2.1–2.2 (p. 752), §3 (pp. 752–753), §4.1–4.2 with Fig. 4 and Tables 1–2 (pp. 753–754), §5.1 (p. 755), §5.3 (p. 756), §6.2 (p. 760), §7 Related Work (pp. 760–761), and refs [13], [16], [25], [36]. **Skimmed by keyword only:** §5.2, §5.4–5.5 results tables, §6.1, §6.3. |
| Hammoudi, Rothermel, Tonella. *Why do Record/Replay Tests of Web Applications Break?* ICST 2016, pp. 180–190, DOI 10.1109/ICST.2016.16. This is ref. [13] in WATERFALL and the taxonomy it summarises. | No open copy found | **Not read** | No open PDF of the ICST paper turned up in search. The open-access master's thesis version (Hammoudi, UNL 2016) is listed at https://digitalcommons.unl.edu/computerscidiss/100. Its PDF (https://digitalcommons.unl.edu/cgi/viewcontent.cgi?article=1116&context=computerscidiss) and the core.ac.uk mirror (https://core.ac.uk/download/77933635.pdf) both returned a Cloudflare bot challenge or HTTP 403. FBK CRIS (https://cris.fbk.eu/handle/11582/305719) did the same. I did not try to get around the challenges. Only the record page's metadata (title, author, year) was seen, through a fetch summary. |

**Search-result snippets seen but not used as sources:** researchr.org and bibtex.github.io citation records, and a search-engine mention of A. Colyer's blog summary of the ICST paper. I did not open the blog, and nothing in the specs relies on it.

## 3. What the specs therefore rely on

- **Quantitative anchor:** only WATERFALL §1 p. 751, which says 73.62% of 1065 breakages (453 versions, 8 apps) were locator-related. The specs aim for 74% locator / 26% non-locator edits (14 of 19).
- **Locator subtypes:** WATERFALL §3 p. 753 and §4.2 pp. 753–754 (Fig. 4, Table 2). These show attribute-value changes (`name`, `class`, `value`, including a submit button's label) and a structural change (an added `<div>` that changes the XPath).
- **Non-locator causes:** WATERFALL §1 p. 751 ("repositioning page elements or altering the selections in a drop-down list"; fn. 1 definition of breakage), §5.3 p. 756 ("breakages due to causes not involving locators"), and §6.2 p. 760.
- **Limitation:** WATERFALL does not give the sub-breakdown (attribute vs. structure locators, or the individual non-locator categories). The within-group proportions in the specs are my own judgment, not taken from the literature. If the ICST 2016 paper or the thesis can be obtained, the within-group mix should be checked against its taxonomy table.

## 4. Working files

The downloaded PDF and its text extraction are kept in `~/projects/mipro27-wt/P4c-out/_lit/` (`waterfall.pdf`, `waterfall.txt`). That folder also holds two failed-download stubs (`t.bin`, `cris.html`, both Cloudflare challenge HTML). A temporary venv at `/tmp/p4cvenv` was used only for pypdf.
