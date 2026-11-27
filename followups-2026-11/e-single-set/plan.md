# Stream E: one consistent set of runs (plan, fixed before any measured run)

Written 2026-11-27 ~02:00 UTC by the coordinating session, before any stream E measured run.
Status of every run: `exploratory-owner-directed`, `gatePassExists: false`. Decided after the original campaigns: **post hoc**.

## Owner decision this implements

Every number in the paper comes from one campaign: one host, one harness commit, one set of tool versions and models.
The setup is the one stream B used on 26 Nov (`b-change1-faults/README.md`, "Limitations"):

- host `<host>` (x86_64, WSL2); replication harness at **9c9eee2** (stream B used a local clone at that commit);
- Codex CLI **0.169.0** (Luna `gpt-6-luna`, Terra `gpt-5.6-terra`, medium effort); omp **18.20.2** (Haiku `claude-haiku-5-5`,
  medium thinking); Node v24.22.1, Playwright 1.65.0-alpha-2026-10-30, @playwright/mcp 0.0.84, bubblewrap 0.9.0;
- verdict parser: the one harness 9c9eee2 ships (parser v2), stated in one sentence in the paper;
- payment app at upstream 0729f68 with campaign A's pinned files; Moodle at the campaign pin (5.3.1, `cfe123f2`), PHP 8.3, Postgres 17;
- prompts, scenarios, limits (payment 240 s / 60 s / 80 tool calls; Moodle 300 s / 60 tool calls), sandbox, browser proxy and
  reload tool exactly as in the 1 Nov campaigns. Known defects are kept: the social scenarios name a transaction ID the UI hides,
  and Moodle B29's admin step is handed to the agent.
- The step-definition update is **not rerun**: coded arm uses campaign A's frozen v0, v1 and v2 step code
  (`STUDY_RUNTIME_RERUN_FROM=campaign-20261101-04d8551`), as stream B did for v1.

Stream D (`d-moodle-replay`) runs on the same host, harness 9c9eee2, Codex CLI 0.169.0, omp 18.20.2 and models
(its plan, "Arms"); to be confirmed from its per-trial records before counting. If confirmed, its runs belong to the set.

The 1 Nov campaigns (A-D payment, Moodle campaign) stay in the package as the earlier campaign.

## Cells that still need runs

### Payment app (12 scenarios/faults; stages as `study/cumulative-plan.mjs`, maintenance stages skipped)

| stage | per arm runs | status |
|---|---:|---|
| healthy-v0-1 | 12 | **to run** |
| fault-v0-1, fault-v0-2 | 24 | **to run** |
| healthy-v1-1 | 12 | done in stream B (fresh post-hoc check; becomes the pairing partner in the single set) |
| fault-v1-1, fault-v1-2 | 24 | done in stream B |
| healthy-v2-1, -2, -3 | 36 | **to run** |
| fault-v2-1, fault-v2-2 | 24 | **to run** |

To run per arm: 96. Arms: coded, Luna, Terra, Haiku. Total 384 runs (288 agent runs + 96 coded).
In the single set the v1 pairing partner is stream B's fresh healthy-v1-1 run (same campaign); the 1 Nov partner is the earlier campaign.

### Moodle (campaign pin build; same cases, hand-off and decoder as the 1 Nov Moodle campaign)

| arm | design | runs |
|---|---|---:|
| Luna, Terra, Haiku | 14 agent cases x {healthy, faulty} x 2 repetitions | 56 each, 168 total |
| coded (developers' step definitions) | 16 cases x {healthy, faulty} x 1 | 32 |

## Estimate (per-run costs from stream B, Moodle per-run means from `results/moodle-resources.txt`)

| part | agent tokens | trial minutes |
|---|---:|---:|
| payment Luna (96 runs; 4.01M/35 runs) | 11.0M | 61 |
| payment Terra (96; 8.70M/36) | 23.2M | 86 |
| payment Haiku (96; 8.63M/36) | 23.0M | 74 |
| payment coded (96) | 0 | 10 |
| Moodle Luna (56; 304.9k/run, 41.7 s) | 17.1M | 39 |
| Moodle Terra (56; 448.6k, 65.3 s) | 25.1M | 61 |
| Moodle Haiku (56; 603.7k, 50.4 s) | 33.8M | 47 |
| Moodle coded (32; 16.5 s) | 0 | 9 |
| **total** | **133.2M** | **~387 (6.5 h) + app/site setup and lock waits** |

Token guard: stop starting agent runs if stream E's measured agent tokens + 2M reserve would exceed 150M.

## Order and rules

1. Payment app first (coded, Luna, Terra, Haiku; one campaign per arm, one after another), then Moodle (coded, Luna, Terra, Haiku).
2. Every measured campaign command is wrapped in `flock /tmp/mipro-next/run.lock` (create `/tmp/mipro-next` if missing).
   Stream D shares the lock.
3. Keep every run; never retry for a better outcome; infrastructure retries only via the harness's own mechanism, all attempts kept.
4. Durable state only in `followups-2026-11/e-single-set/` (data, logs, journals); nothing durable in /tmp.
5. Record versions per campaign (frozen inputs) and in `e-single-set/README.md`.
6. Deadline: all results by 2026-11-28 18:00 UTC. If short, stop at a clean point: whole stages per arm, in the order above.
