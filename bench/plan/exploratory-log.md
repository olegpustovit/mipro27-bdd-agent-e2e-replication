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
