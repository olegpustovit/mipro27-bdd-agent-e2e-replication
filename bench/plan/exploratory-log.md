# What the exploratory runs changed in the design

Written by the coordinator on 2026-11-27 from the run records. The exploratory runs are the 1 Nov 2026 campaigns
(replication releases up to v1.1.4) and the 26-27 Nov follow-ups (`followups-2026-11/a` to `d`). They shaped
plan-1 as follows. No result of those runs is reported as a result of this study.

| Design change in plan-1 | What the exploratory runs showed | Records |
|---|---|---|
| Feed scenarios name the transaction by visible details | Two scenarios named a transaction ID the interface never shows; agents could not find it (19 of 21 wrong-reason failures, 19 false alarms in the three-coder trace check) | followups-2026-11/a-trace-audit |
| Moodle setup runs every data step, wherever it occurs | A non-leading admin data step was handed to the agent, which had only a teacher account (12 false alarms on B29) | followups-2026-11/a-trace-audit |
| A required answer format; no readable answer means unresolved | One configuration wrapped its verdict in prose that the parser could not read (8 false alarms) | followups-2026-11/a-trace-audit |
| Step definitions updated until every scenario passes (Opus, 3 sessions) | The 1 Nov update after change 1 ended after 2 edits with 7 of 12 scenarios failing | results/counts-v1.1.4.txt, followups-2026-11/b-change1-faults |
| Moodle only as real-change replay; the 16 selected cases dropped | Cases were kept only if the developers' step definitions caught the bug, so their result held by construction | followups-2026-11/c-moodle-selection |
| 2021 Moodle changes out by the eligibility rule | Only one of four could run both approaches on the older runtime | followups-2026-11/d-moodle-replay |
| Same limits and prompt in both apps; all agents in Codex CLI | Limits, prompts and agent tools differed between apps and models | earlier campaign configs |
| Real bugs with an independent check; 8 hold-out scenarios | Seeded bugs were accepted only through the step definitions; the 12 scenarios were seen during exploration | plan reviews of 27 Nov |

## Coordinator records after the P10 review (2026-11-27)

- **Step definitions after P5.** The P4b scenario fixes changed scenario text (payment and request titles, the hold-06 and hold-07 setup moved to the API, the profile-email save step) after the P5 first-pass sessions. The v0, v1 and v2 step definitions were edited only where a binding's text changed. No check was removed or weakened, apart from the hold-06 and hold-07 setup checks, which the API fixture verification now covers. Merge commit 27405e7 records this.
- **P7 failed attempts.** bench/plan/bug-checks.jsonl keeps 68 failed rows from formal P7 runs that later passed. They came from environment failures under parallel load (Moodle readiness and seeding races during the first matrix runs). The admission rule uses the latest formal P7 result per bug, version and condition. All 139 final passes were rechecked against the pinned images (P10 review, m7).
- **Agent limits.** Owner decision: 250 tool calls and 15 minutes for every agent in both apps, raised from 80 calls and 5 minutes. The reason is that four Moodle quiz scenarios (S042, S043, S045, S046) need about 4 tool calls per user step. S044 stays excluded at the new limit.
