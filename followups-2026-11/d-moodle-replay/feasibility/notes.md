# Feasibility notes (2026-11-26, written during the feasibility step)

Repo HEAD at start: 9c9eee2478ca761902f963fd7ccc791a57a4439b. Host rebooted at 21:45 UTC (/tmp cleared; brief and lock file were in /tmp).
Agent CLIs on host: codex-cli 0.169.0, omp 18.20.2 (the versions recorded in moodle-ledger/tasks.jsonl for the Moodle campaign).
Campaign plan 6ac189f540b8 (moodle-campaign-20261116), models gpt-6-luna, gpt-5.6-terra, claude-haiku-5-5, 2 reps, toolCalls 60, timeout 300 s.

## Commits (GitHub API, feasibility/commits.tsv)
| change | Moodle at parent | UI commit date | layout |
|---|---|---|---|
| B04 | 5.2dev (20260210) | 2026-02-10 | public/ |
| B07 | 5.3dev (20260624) | 2026-06-24 | public/ |
| B15 | 5.1dev (20250523) | 2025-05-26 | pre-public (no public/) |
| B25 | 4.0dev+ (20211203) | 2021-12-04 | pre-public |
| B27 | 4.0dev (20210820) | 2021-08-25 | pre-public |
| B28 | 4.0dev (20210820) | 2021-08-24 (UI), test fix 8662be1d85 2021-08-25 | pre-public |
| B29 | 4.0dev (20210527) | 2021-06-03 | pre-public |
| B34 | 3.9dev (20191205) | 2019-12-12 | pre-public |

## Scenario text (feasibility/scenario-presence.tsv)
Same canonical text pre == post == pin: B04 (S036,S037,S041), B07 (S025,S028,S029), B15 (S091,S094), B27 (S131), B28.S134.
Different from the pin (historical text): B25.S125, B28.S137, B29.S138, B29.S139.
Absent at the change: B34.S153, B34.S154 (feature file define_marking_guide.feature did not exist in 2019).
Agents could not run B07.S025 and B27.S131 in the campaign (no leading data steps; setup exclusion).

## Environment
Campaign environment: PHP 8.3 image, Postgres 17, selenium/standalone-chrome (pinned digests), moodle-docker f0583ec.
Moodle 5.1-5.3dev supports PHP 8.3: B04, B07, B15 can use the pinned images.
Moodle 4.0dev supports PHP 7.3-8.0 and 3.9dev supports PHP 7.2-7.4: B25-B34 need other webserver images (and probably a
Selenium 3 image for the old Behat driver), i.e. a different environment from the campaign.
