# Replication package: LLM browser agents or step definitions in behaviour-driven testing

Replication package for an exploratory comparison of two ways to keep Gherkin scenarios
executable: maintained step definitions, and an LLM browser agent that interprets the
unchanged scenario on every run. It holds the study code, every recorded execution and
automated grade, the derived reports, and scripts that recompute every count in the paper.

Version 1.2.0. Changes are listed under [Changes in v1.2.0](#changes-in-v120), [Changes in v1.1.4](#changes-in-v114), [Changes in v1.1.3](#changes-in-v113), [Changes in v1.1.2](#changes-in-v112), [Changes in v1.1.1](#changes-in-v111) and [Changes in v1.1.0](#changes-in-v110).
All results are exploratory; see `AGENTS.md` and `REPRODUCE.md` for the run status.

Since v1.2.0 the paper's numbers come from one consistent set of runs, the **single set**
(streams B, D and E in [Follow-up work, November 2026](#follow-up-work-november-2026)): one host,
replication harness 9c9eee2, Codex CLI 0.169.0 and omp 18.20.2, run 26-27 Nov 2026. The campaigns of
1-18 Nov 2026 stay in the package unchanged as the **earlier campaign**: payment-app campaigns A-D
(1 Nov), the Moodle campaign (16 Nov), the follow-up comparison in `experiment-4/` and the payment-app
follow-ups E (Sol) and F (Opus via omp) in `moodle-ledger/runs/` (18 Nov). The single set is post hoc.

## Quick start: recompute the paper's counts

Requires [uv](https://docs.astral.sh/uv/). The scripts use the Python 3.14 standard library
only (`compression.zstd` reads the compressed trial files); uv installs Python 3.14 if needed.
No network access, no models, about 10 seconds.

```sh
uv run scripts/reproduce_counts.py
```

The script checks the earlier campaign. It prints one table per study part and compares each
value with the number that the earlier paper version (release v1.1.4) stated. A difference is printed as `MISMATCH`, listed on stderr, and the script exits
with status 1. Values are never adjusted to match. The output of this release is in
`results/counts-v1.1.4.txt`: all 191 stated values match; 14 rows are informational (no
stated value).

Each part can also be run alone: `uv run scripts/counts/<part>.py` with `payment`, `matched`,
`opus_reparse`, `followups`, `moodle`, `verified`, `maintenance`, or `cost`.

Their output has not changed since v1.1.4.

The single set has its own count script and release check (Python 3.14 standard library, offline):

```sh
uv run scripts/counts/single_set.py         # writes results/counts-single-set.txt and .json
uv run scripts/reproduce_single_set.py      # compares with results/paper-numbers-single-set.txt
```

`single_set.py` recomputes every single-set value from the recorded runs with the paper's rules
(reusing `payment.py`, `verified.py` and the stream count scripts). It checks each value against the
output of the stream script that first reported it, and checks that the single-set campaigns share
host, harness commit, tool versions and verdict parser. It exits with status 1 on any difference.
`reproduce_single_set.py` compares the values the paper states, listed in
`results/paper-numbers-single-set.txt`, with the computed ones. It fails on a mismatch, on a missing
quantity, or on a value that cannot be computed.

## Scoring rules used by the count scripts

Payment app (Cypress Real World App, main comparison; `scripts/counts/payment.py`)
- Step definitions: the runner's pass/fail (Cucumber exit code). Browser agents: the reported
  status, with `unresolved` counted as fail. No run is excluded; the two infrastructure-invalid
  step-definition runs are runner failures and count as false alarms.
- Catch: a faulty run that does not pass. False alarm: a healthy run that does not pass.
- Paired catch: the faulty run does not pass AND the healthy run of the same case, revision and
  repetition passes; when that repetition has no healthy run, repetition 1 is used.
- Social scenarios: `social-like` and `social-comment`.
- Healthy runs that do not pass are counted by interface revision (v0, v1, v2).
  For each browser agent, the v1 breakdown also checks how many of these runs are social.
- "Stopped before the fault": faulty runs that the first grader classed `action_failure` or
  `no_opportunity` (`data/campaigns/*/adjudication.jsonl`).

Follow-up comparison, called the matched comparison in earlier versions (`scripts/counts/matched.py`, `scripts/counts/opus_reparse.py`)
- Same status rule; each faulty run is paired with the healthy run of the same case on the
  same interface revision. Tokens are input + output counters; minutes sum `record.elapsedMs`.
- "After re-read" replaces 12 Opus records by the records in
  `experiment-4/campaign-experiment4-opus-verdict-v2`. `opus_reparse.py` re-derives those 12
  records from the original raw responses: a response may end with one JSON verdict object
  after prose, with the same conflict checks (exactly one verdict object; status `pass`,
  `fail` or `unresolved`; no second explicit verdict in the prose).
  Applying verdict parser v2 to all 648 recorded responses changes the status of zero
  main-comparison responses.

Moodle (`scripts/counts/moodle.py`)
- Runs whose cause is the setup error "Scenario has no leading data steps..." are excluded
  (24 runs that never reached the agent). An `unresolved` verdict counts as fail.
- Same catch, false-alarm and paired-catch definitions per pair and repetition.
- Same-assertion cluster: change B04, whose edited step contains the target assertion;
  downstream: the other seven changes.

Verified catches (`scripts/counts/verified.py`)
- Payment app. Each case's target check is the single normalized `failedAssertion` shared by
  its maintained faulty runs. Normalization trims whitespace, strips a leading Gherkin keyword
  (`Given`, `When`, `Then`, `And`, or `But`), then trims and lower-cases the result.
  A verified catch requires status `fail` and a normalized `failedAssertion` matching that target.
  A verified paired catch also requires the healthy partner to pass under the pairing rule above.
  Unresolved faulty runs are excluded from the catch numerator. The breakdown outside
  the social scenarios excludes both social cases from the numerator and denominator.
- The payment-app social follow-up denominator covers main-comparison healthy runs of the two
  social scenarios on v0 and v2. The count includes every run that did not pass.
- Moodle. A verified paired catch is a per-pair `caught` outcome in `results/moodle-campaign.txt`.
  The report requires a healthy pass and a failure at the target step. Setup-excluded pairs are
  omitted from the arm C denominator. Arm A is also counted on the 14 scenario–fault pairs that
  arm C could run.

Step-definition maintenance (`scripts/counts/maintenance.py`)
- The campaign A journal records one `maintenance-finished` entry for each of v1 and v2.
  Session minutes come from `elapsedMs / 60000`. Accepted edits and validation runs come
  from `record.frozen`. The script checks `budgetExpired` and sums the input and output tokens
  from `record.agent.usage`. Totals use the unrounded duration and token counts.

Cost (`scripts/counts/cost.py`)
- Mean cost per execution (healthy and faulty) times the number of scenarios: 12 for the
  payment app (`record.elapsedMs`, input + output tokens; the step-definition mean includes the
  two infrastructure-invalid runs, which exited 1 and count as failed runs), 16 for Moodle (whole-trial wall time
  and input + output tokens from `results/moodle-resources.txt`, setup-invalid runs left out, as in
  the outcomes). Moodle developers' current
  definitions use the arm A wall mean; updated definitions the mean of the three arm B
  per-model wall means. Cache-read share = cached input tokens / input tokens.

## Contents

| Path | What it holds |
|---|---|
| `data/campaigns/` | Payment-app main comparison: campaign A (step definitions; its browser-agent runs were discarded for a reload defect) and runtime-only campaigns B, C, D. Trials and events are zstd-compressed JSONL. |
| `data/excluded/` | Pre-campaign resume test; not study data. |
| `experiment-4/` | Follow-up comparison: four configurations x 36 runs, both automated grade files, the manifest, the 12 re-read Opus verdicts (`campaign-experiment4-opus-verdict-v2`), and `source-pins/` with the prompt contract the comparison pinned. |
| `moodle-ledger/` | Moodle measurement ledger (`trials.jsonl`, `tasks.jsonl`, content-addressed `blobs/`) and the Cypress follow-up runs under `runs/`. |
| `clock-recovery/` | Re-evaluated follow-up traces and their grades. |
| `followups-2026-11/` | Follow-up work of November 2026 (streams A-E, all post hoc); see [Follow-up work, November 2026](#follow-up-work-november-2026). |
| `results/` | Derived reports. `counts-v1.1.4.txt` is the output of `scripts/reproduce_counts.py` (earlier campaign); `counts-single-set.txt` and `.json` are the output of `scripts/counts/single_set.py`; `paper-numbers-single-set.txt` lists the single-set values the paper states. |
| `scripts/` | Study and analysis code (Node 24) and the count scripts (`reproduce_counts.py`, `counts/`). |
| `study/`, `adapters/`, `manifests/`, `docker/` | Scenarios, step definitions, plans, Moodle adapter, case manifests and patches, Moodle Behat configuration. |
| `provenance/` | How runs were launched and graded: adjudicator prompts and sessions, second-grader verdicts, orchestration scripts. |
| `ui/`, `deploy/`, `docs/` | Local trace console, its service file, and ledger contracts. |

Checksums: `RELEASE.SHA256SUMS` (every file), `experiment-4/EXECUTION.SHA256SUMS`,
`followups.SHA256SUMS` (the 18 Nov follow-up runs in `moodle-ledger/runs/` and, since v1.2.0, every
file under `followups-2026-11/`), `clock-recovery/SHA256SUMS`, `results/moodle.SHA256SUMS`, and
`data/SHA256SUMS` (decompressed campaign files). The streams' own checksum files are described in
their READMEs. Verify with `sha256sum --quiet -c RELEASE.SHA256SUMS` and
`sha256sum --quiet -c followups.SHA256SUMS`.

## Follow-up work, November 2026

Folder `followups-2026-11/`. The shared rules for all streams are in `followups-2026-11/BRIEF.md`.
Every stream is **post hoc**: it was decided after the earlier campaign. Every new run has status
`exploratory-owner-directed` and `gatePassExists: false`: it was run on the owner's direction
without an Evidence gate pass (see `AGENTS.md`). No run was retried for a better outcome, and no run
was excluded without a stated reason. Each stream's README reports its limitations and what went wrong.

**Single set.** Streams B, D and E make up the single set from which the paper's numbers now come.
They ran on one host, replication harness 9c9eee2 (this repository at v1.1.4), Codex CLI 0.169.0
(`gpt-6-luna` and `gpt-5.6-terra`, medium effort), omp 18.20.2 (`claude-haiku-5-5`, medium thinking),
Node v24.22.1, Playwright 1.65.0-alpha-2026-10-30, @playwright/mcp 0.0.84 and bubblewrap 0.9.0,
on 26-27 Nov 2026. The host is x86_64 under WSL2; its name is replaced by `<host>` in the package.
The earlier campaign ran on another host, with Codex CLI 0.159.3 and omp 18.14.0.
Two points about stream D: its 2021 Moodle changes ran on a second Moodle runtime (PHP 8.0,
PostgreSQL 13), and its trial records do not record the CLI versions. The CLI versions for D come
from its plan and report, and `single_set.py` reports them as not found in the records.

Count scripts are run from the package root with `uv` and read only recorded data: no models, no network.
To re-run measured cells you need the harness at 9c9eee2 (tag v1.1.4) and the stream's launcher. The
outcomes of a re-run will differ (see `REPRODUCE.md`, section 2). The harness clones that the streams used
(`followups-2026-11/*/harness/`) are not shipped.

### A. Trace audit of the earlier campaign's browser-agent failures (`a-trace-audit/`)

- **What it is.** It asks whether the recorded trace supports each browser-agent failure that the
  earlier campaign's counts score: catches and false alarms, with `unresolved` counted as fail. There
  are 386 units, from payment-app campaigns B-D, the follow-up comparison, follow-ups E and F, and
  Moodle arm C. The coding rule (`coding-rule.md`) was written before any unit was coded.
- **Coders.** Coder 1 (the Claude agent that ran the stream) did not read any grader output.
  Codes from coders 1, 2 and 3 are in `codes-coder1.jsonl`, `codes-coder2.jsonl` and
  `coder3-work/codes-coder3.jsonl`, with their working files in `coder2-work/` and `coder3-work/`.
  Agreement and consensus are in `agreement/`.
- **Reproduce.**
  ```sh
  uv run followups-2026-11/a-trace-audit/build_units.py --moodle-src <Moodle checkout at cfe123f2>   # needs Node 24, npm ci
  uv run followups-2026-11/a-trace-audit/summarize.py               # = results-coder1.txt
  uv run followups-2026-11/a-trace-audit/agreement/agreement.py     # = agreement/agreement.txt
  uv run followups-2026-11/a-trace-audit/agreement/consensus.py     # = agreement/consensus.txt
  ```
  The builder asserts that the units reproduce the paper's catch and false-alarm counts.
- **Post hoc.** The whole audit. No runs, no model calls, no changes to data.

### B. Seeded faults after change 1 (`b-change1-faults/`; part of the single set)

- **What it is.** It runs the 12 payment-app faults on the change-1 (v1) interface, which had no
  faulty-build runs before. There are four campaigns (`campaign-g-20261126-v1faults-{coded,luna,terra,haiku}`)
  of 36 runs each, 144 in total. Each campaign has a fresh healthy-v1 run, then fault-v1-1 and fault-v1-2.
  The coded arm uses campaign A's frozen v1 step definitions; no update session was run.
  A static check and a model-free calibration confirm that every v1 faulty build breaks its target check.
- **Data and scripts.**
  - Data: `data/campaigns/` (trials and events zstd-compressed, journal), `data/calibration-v{0,1,2}.jsonl`
    and `data/fault-build-static-check.jsonl`. `data/SHA256SUMS` holds hashes of the decompressed files.
  - Runner, plan and launcher: `scripts/`.
  - Counts: `results/counts.txt` and `results/counts.json`.
- **Reproduce.** `uv run followups-2026-11/b-change1-faults/scripts/count_v1_faults.py`
  (rewrites `results/counts.*`; the output is identical to the shipped files).
- **Post hoc.** The whole stream, including the fresh healthy-v1 runs and the split of the coded arm
  by healthy-v1 outcome. In the single set, the fresh healthy-v1-1 run is the v1 pairing partner.
  Stream B's README also reports pairing with the earlier campaign's 1 Nov partner.

### C. Moodle case selection funnel and seeded faults (`c-moodle-selection/`)

- **What it is.** A count of how the 16 Moodle cases were selected from 47 mined interface changes,
  with the dropout and its reason at each stage (`funnel.md`). It also gives the types and visibility
  of the seeded faults in both applications (`faults.md`).
- **Data and scripts.** It reads only existing records: `manifests/moodle.yaml` and `results/moodle-*`.
  The script is `selection_counts.py`, with output in `selection-counts.txt`.
- **Reproduce.** `uv run followups-2026-11/c-moodle-selection/selection_counts.py`. It re-implements
  the case selection and stops if it does not reproduce the 16 campaign cases exactly.
- **Post hoc.** The whole analysis. The fault types were coded by one coder; there was no second coder.

### D. Replay of real Moodle interface changes (`d-moodle-replay/`; part of the single set)

- **What it is.** For seven of the eight selected Moodle changes, it builds the Moodle commits just
  before and just after the change. The developers' step definitions from before (A-old) and after
  (A-new) the change, and the three browser agents, then run on these builds, healthy and with the
  seeded faults. There are 256 measured trial records: 64 Behat and 192 agent runs. B34 could not
  be run, because its scenarios did not exist before the change. The plan and its amendments A1 and A2
  were written before any measured run (`plan.md`, with hashes in `data/plan.sha256-at-A*`).
  The report is `results/report.md`.
- **Data and scripts.**
  - Data: `data/ledger/` (trial ledger and agent event blobs), `data/smoke-ledger/` (technical smoke
    checks, not measured), `data/patches/` and `data/builds.jsonl`.
  - Also: `feasibility/` and `logs/`. Scripts are in `scripts/`.
  - Checksums: `SHA256SUMS`, and `data/patches/SHA256SUMS`, whose paths are relative to
    `d-moodle-replay/`.
- **Reproduce.** `uv run followups-2026-11/d-moodle-replay/scripts/count_replay.py`
  (= `results/counts-replay.txt`).
- **Post hoc.** The whole stream. The post-hoc diagnostic on B28's fix commit (`data/diagnostics.jsonl`)
  is not part of the counts. The stream's tokens exceeded the planned cap of 95M by 0.45M, because the
  smoke-check tokens were not counted by the guard (see the report).

### E. Single set of runs, with its trace audit (`e-single-set/`)

- **What it is.** The cells the single set still needed, run on stream B's setup. `plan.md` was fixed
  before any measured run.
  - Payment app (`pay/`): v0 and v2 healthy and faulty stages for the coded arm and the three agents.
    Four campaigns (`campaign-h-20261127-single-*`) of 96 runs each, 384 runs in total; the v1 cells are
    stream B's. The coded arm uses campaign A's frozen v0 and v2 step code.
  - Moodle (`moodle/`): the 16 Nov campaign's arms A and C on the same 16 cases. That is 200 trials:
    32 developer step-definition runs and 168 agent runs. Arm B (LLM-updated step definitions) was not run.
  - Trace audit (`trace-audit/`): stream A's question and unchanged coding rule, applied to the single
    set's browser-agent runs that its counts score as not passing (363 units: 244 payment, 119 Moodle).
    Three coders coded every unit independently: two Claude Code sessions with Claude Opus 5.5 and one
    Codex CLI session with gpt-6.2-sol, all at high effort (see `trace-audit/README.md`, "Coders"). Each worked
    in its own `coderN-work/` folder (codes in
    `coderN-work/codes-coderN.jsonl`, with its instructions in `CODER.md` and its working files).
    Pairwise agreement and the majority consensus are in `results/agreement-consensus.txt`, and
    `single_set.py` section 7 recounts them. The builder and coding aids are stream A's, with the
    changes diffed in `diffs/`.
- **Data and scripts.**
  - Payment app: `pay/data/campaigns/` (with `pay/data/SHA256SUMS`, hashes of the decompressed files).
  - Moodle: `moodle/data/ledger/` and `moodle/data/smoke-ledger/`.
  - Runners, launchers and count scripts are in each part's `scripts/`, with outputs in `results/`.
  - Trace audit: `trace-audit/units.jsonl` with `units.SHA256SUMS`.
- **Reproduce.**
  ```sh
  uv run followups-2026-11/e-single-set/pay/scripts/count_pay.py         # = pay/results/counts.*
  uv run followups-2026-11/e-single-set/moodle/scripts/count_moodle.py   # = moodle/results/counts.txt
  uv run followups-2026-11/e-single-set/trace-audit/build_units.py --moodle-expected 'Luna=25,23;Terra=26,7;Haiku=27,11'
  uv run followups-2026-11/e-single-set/trace-audit/summarize.py coder1-work/codes-coder1.jsonl   # path relative to trace-audit/; also coder2, coder3
  { uv run followups-2026-11/e-single-set/trace-audit/agreement/agreement.py
    uv run followups-2026-11/e-single-set/trace-audit/agreement/consensus.py; }   # = trace-audit/results/agreement-consensus.txt
  uv run scripts/counts/single_set.py         # all single-set values (streams B, D, E)
  uv run scripts/reproduce_single_set.py      # values the paper states
  ```
  The unit builder needs Node 24, `npm ci` and the Moodle checkout at `cfe123f2`. It asserts that the
  units equal the count scripts' catches and false alarms.
- **Post hoc.** The whole stream: the single set was decided after the earlier campaign, and so was
  the trace audit of it. The payment and Moodle cells ran without amendments to the plan.

## Other analyses

The Node analyses that produced the derived reports (`npm run analyze`, the Moodle report,
the follow-up-comparison summary), the re-run procedure for each campaign and the local trace
console are described in `REPRODUCE.md`. They need Node 24 and `npm ci`.

## Changes in v1.2.0

- New: `followups-2026-11/`, the follow-up work of November 2026 (streams A-E, all post hoc, run
  without a gate pass). See [Follow-up work, November 2026](#follow-up-work-november-2026).
- The paper's numbers now come from the single set: streams B, D and E. The campaigns of 1-18 Nov are
  kept unchanged as the earlier campaign, and `scripts/reproduce_counts.py` still checks them
  (191/191, output unchanged).
- New: `scripts/counts/single_set.py` and `scripts/reproduce_single_set.py`, with their output
  `results/counts-single-set.txt` and `.json`, and the list of stated values
  `results/paper-numbers-single-set.txt`.
- New: `scripts/redact_paths.py`. In the new files the home-directory prefix was replaced by `<home>`
  and the host name by `<host>`, also inside compressed files, as in v1.1.0. The provider account
  identifiers in the new Codex session headers were replaced by `<redacted>`, as was done in v1.1.0
  for the adjudicator sessions. The streams' checksum
  files were updated to match. Pre- and post-redaction hashes are listed in
  `provenance/redaction-v1.2.0.tsv`; see `REPRODUCE.md`, section 7.
- `.gitignore` excludes the streams' local harness clones and the ledgers' empty per-trial lock files.
- `followups.SHA256SUMS` now also covers `followups-2026-11/`.

## Changes in v1.1.4

- Added checks for payment-app verified paired catches outside the social scenarios,
  healthy runs that did not pass by revision, and step-definition maintenance sessions.
- Checked the replay size and that verdict parser v2 changes zero main-comparison responses.

## Changes in v1.1.3

- `scripts/counts/verified.py` checks verified and verified paired catches for the payment app,
  step-verified paired catches for Moodle, and the payment-app social follow-up denominators.

## Changes in v1.1.2

- New `scripts/counts/followups.py` checks the payment-app follow-up runs without the URL
  instruction that the paper now reports, under the paper's rules:
  - GPT-6.2 Sol (Codex CLI 0.169.0): 24/24 catches, 0/12 false alarms, 24/24 paired catches. Its
    first campaign (e23c7f6, 72 runs, "Pinned model absent") never reached the agent and is left out.
  - Claude Opus 5.5 through omp 18.20.2: 12/12 catches, 2/24 false alarms (both unresolved;
    1/24 after the verdict parser v2 re-read), 11/12 paired catches.
- No data and no previously stated number changed.

## Changes in v1.1.1

- `scripts/counts/moodle.py` also checks two counts the paper now states: the developers' current
  step definitions on the 14 pairs from 7 changes that the browser agents could run (14/14 catches,
  0/14 false alarms, 14/14 paired catches), and the unresolved agent runs that ended at the
  60-tool-call limit (13 of 21; read from `moodle-ledger/trials.jsonl`, a run at the limit records
  more than 60 calls).
- No data and no previously stated number changed.

## Changes in v1.1.0

- Licences added: `LICENSE` (MIT, code) and `LICENSE-DATA` (CC BY 4.0, data).
- Count scripts added (`scripts/reproduce_counts.py`, `scripts/counts/`) with their output.
- Added files that `REPRODUCE.md` referenced but v1.0.0 lacked: `AGENTS.md`,
  `provenance/adjudication/`, `provenance/README.md`, `docs/contracts/ledger.md`,
  `data/excluded/`, `deploy/console.smdctl.yml`.
- Added the verdict-parser version 2 records (`experiment-4/campaign-experiment4-opus-verdict-v2`,
  `moodle-ledger/runs/campaign-f-20261118-opus-verdict-v2`), the parser itself
  (`scripts/verdict.mjs` v2) and its replay script (`provenance/orchestration/prepare-verdict-recovery.mjs`).
- `results/moodle.SHA256SUMS` now names the plan-filtered and `-historical` Moodle reports with
  their own hashes (v1.0.0 listed the historical hashes under the plan-filtered names).
- The author's home-directory prefix and host name were replaced by `<home>` and `<host>` in
  every file, including inside compressed files; see `REPRODUCE.md` for the effect on checksums.

## Licence

- Code is licensed under the MIT licence (`LICENSE`): `scripts/`, `adapters/`, `study/*.mjs`,
  `provenance/orchestration/*.mjs` and `*.sh`, `docker/`, `deploy/`, `ui/`, `package.json`,
  `package-lock.json`.
- Everything else (recorded runs, grades, results, manifests, plans, scenario text written for
  this study, provenance records and documentation) is licensed under CC BY 4.0 (`LICENSE-DATA`).
- Third-party material keeps its licence. Moodle source excerpts (`manifests/moodle/patches/`,
  step-definition diffs in `moodle-ledger/blobs/`, scenario text quoted from Moodle feature
  files) remain under the GNU GPL v3 or later. The Cypress Real World App (MIT) is not included;
  `npm run bootstrap` fetches it at a pinned commit.
