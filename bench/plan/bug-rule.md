# Real bug selection rule

Apply this rule independently to each scenario using the frozen scenario text,
the tested revision, upstream product history, and public upstream reports.
Exclude all study run results, arm implementations, and prior seeded faults.

1. Search upstream product commits and the upstream issue tracker using
   scenario actions, visible expectations, and product paths. Record the query,
   tested revision, candidate source, and decision for each scenario.
2. A candidate must describe a real product defect in the same workflow and
   predict a failure of a specific browser-visible expectation under the
   scenario's actual inputs and prerequisites. Exclude tooling, test-only
   changes, unrelated symptoms, and security vulnerabilities.
3. Prefer a documented upstream product fix whose inverse applies cleanly to
   the tested revision and restores the documented symptom. Label it
   `reverted-fix`. Check applicability without changing the tested checkout.
4. Otherwise use a specific issue with enough evidence to recover the same
   symptom in the tested workflow. Cite its tracker ID and URL and label it
   `re-created-from-report`. A merely adjacent issue does not qualify.
5. Within either tier prefer the closest match to the scenario inputs and
   expected symptom, then the earliest affected expectation in file order,
   then the most recent upstream source date, then the lexical source URL.
   Record a reason for every rejected candidate. Record an explicit TODO if
   no candidate qualifies or the scenario or tested revision is pending.

## Owner-approved amendment, 2026-11-27

For the payment app, step 2 may use a specific real bug report from another
open-source web application's public tracker. The report must describe the same
failure in the same kind of component. Apply the existing eligibility checks
and preference for a reversible fix from the payment app's own history. Cite
the external report by ID or URL and label the selection
`re-created-from-report`. Moodle candidates still come only from Moodle's own
history and tracker.

## Coordinator-approved Moodle amendment, 2026-11-27

When Moodle's own history and tracker yield no fitting report, step 2 may
use a specific bug report from another well-known open-source web application's
public tracker. The report must describe the same failure in the same kind of
component. Cite its ID or URL and label the selection `re-created-from-report`.
Moodle's own history and tracker retain priority.
