# P4d: blind scenarios (hold-01 to hold-08)

Source read: Cypress Real World App at `~/projects/mipro27-wt/rwa-0729f68` (commit 0729f68). I read `src/`, `backend/`, `data/database.json` (the same file as `database-seed.json`) and `.env`. I did not open `cypress/` or any existing scenarios, step definitions, prompts or run results.

The seeded password for every user is `s3cret` (`SEED_DEFAULT_USER_PASSWORD`). Users named here: Ted Parisian `Heath93`, Lia Rosenbaum `Judah_Dietrich50`, Kristian Bradtke `Arvilla_Hegmann`, Ruthie Prosacco `Reyes.Osinski`. The database is assumed to be reseeded before each scenario.

| File | Feature | Seeded data used | Targeted step |
|---|---|---|---|
| hold-01 | Notifications: dismiss | Ted's 8 unread seeded notifications, including the only "Kristian Bradtke liked a transaction." | `Then the notification "Kristian Bradtke liked a transaction." is no longer listed` |
| hold-02 | Sign up, then first sign-in | No seed data. The new user has no bank account, so the onboarding dialog opens. | `Then the "Get Started with Real World App" dialog is shown` |
| hold-03 | Sign-up validation: password confirmation | None | `Then the message "Password does not match" is shown under Confirm Password` |
| hold-04 | Phone number in My Account | Ted's seeded phone number is `398-225-9900` | `Then the Phone Number field shows "555-123-4567"` (after a reload) |
| hold-05 | People search in New transaction | Other users in seed order, without Ted: Kristian, Darrel, Ruthie, Lia. Kristian is listed first before any search. | `Then the first person in the list is "Ruthie Prosacco"` |
| hold-06 | Accept a payment request | Lia and Ted. Lia creates a new request in a Given step, so it is the newest item in Ted's "Mine" tab. | `Then the transaction reads "Lia Rosenbaum charged Ted Parisian"` |
| hold-07 | Reject a payment request | Same as hold-06, with $30.00 for "Pizza night" | `Then the "Accept Request" and "Reject Request" buttons are no longer shown` |
| hold-08 | Amount range filter | Ted's seeded transactions: 11 fall between $10.00 and $20.00 | `And every listed transaction shows an amount between $10.00 and $20.00` |

## Notes for whoever writes the step definitions

- **hold-01:** The "Dismiss" button is only shown at desktop width. At phone width it is a check-mark icon. The notification text comes from the code: a like notification shows the name of the person who liked the transaction.
- **hold-02:** After sign-up the app goes back to the Sign In page. The Given/When steps must sign in again.
- **hold-05:** Search is a Fuse.js fuzzy match (default threshold), so other people may still be listed. That is why the check is that Ruthie Prosacco is first, not that she is the only result. The current user is never listed.
- **hold-06/07:** In the code, the person who makes a request is the transaction's sender and the person asked to pay is its receiver. "Accept Request" and "Reject Request" are only shown to the receiver while the request is pending. Seeded pending requests to Ted are not in the first page of his "Mine" tab, so each scenario creates a new request. The Given step can use the UI or the API.
- **hold-07, app quirk:** The backend `updateTransactionById` moves money for *any* change to a request, including a rejection. Ted's balance therefore drops even when he rejects. That is why hold-07 does not check the balance. The extra check that the title still reads "requested" catches a reject that is wrongly saved as an accept.
- **hold-08:** Each slider step is $10. The handles go to positions 1 and 2, which sends amountMin=1000 and amountMax=2000 (in cents). The backend ignores the filter when amountMin is 0 (`!amountMin`), so a range that starts at $0 would not filter anything. That is why this scenario uses $10 to $20.
