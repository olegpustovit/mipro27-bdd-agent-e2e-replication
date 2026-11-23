# Replication package: LLM browser agents or step definitions in behaviour-driven testing

Replication package for an exploratory comparison of two ways to keep Gherkin scenarios
executable: maintained step definitions, and an LLM browser agent that interprets the
unchanged scenario on every run. It holds the study code, every recorded execution and
automated grade, the derived reports, and scripts that recompute every count in the paper.

Version 1.1.0. Changes from v1.0.0 are listed under [Changes in v1.1.0](#changes-in-v110).
All results are exploratory; see `AGENTS.md` and `REPRODUCE.md` for the run status.

## Quick start: recompute the paper's counts

Requires [uv](https://docs.astral.sh/uv/). The scripts use the Python 3.14 standard library
only (`compression.zstd` reads the compressed trial files); uv installs Python 3.14 if needed.
No network access, no models, about 10 seconds.

```sh
uv run scripts/reproduce_counts.py
```

The script prints one table per study part and compares each value with the number stated
in the paper. A difference is printed as `MISMATCH`, listed on stderr, and the script exits
with status 1. Values are never adjusted to match. The output of this release is in
`results/counts-v1.1.0.txt`: all 117 stated values match; 15 rows are informational (no
stated value).

Each part can also be run alone: `uv run scripts/counts/<part>.py` with `payment`, `matched`,
`opus_reparse`, `moodle` or `cost`.

## Scoring rules used by the count scripts

Payment app (Cypress Real World App, main comparison; `scripts/counts/payment.py`)
- Step definitions: the runner's pass/fail (Cucumber exit code). Browser agents: the reported
  status, with `unresolved` counted as fail. No run is excluded; the two infrastructure-invalid
  step-definition runs are runner failures and count as false alarms.
- Catch: a faulty run that does not pass. False alarm: a healthy run that does not pass.
- Paired catch: the faulty run does not pass AND the healthy run of the same case, revision and
  repetition passes; when that repetition has no healthy run, repetition 1 is used.
- Social scenarios: `social-like` and `social-comment`.
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

Moodle (`scripts/counts/moodle.py`)
- Runs whose cause is the setup error "Scenario has no leading data steps..." are excluded
  (24 runs that never reached the agent). An `unresolved` verdict counts as fail.
- Same catch, false-alarm and paired-catch definitions per pair and repetition.
- Same-assertion cluster: change B04, whose edited step contains the target assertion;
  downstream: the other seven changes.

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
| `results/` | Derived reports. `counts-v1.1.0.txt` is the output of `scripts/reproduce_counts.py`. |
| `scripts/` | Study and analysis code (Node 24) and the count scripts (`reproduce_counts.py`, `counts/`). |
| `study/`, `adapters/`, `manifests/`, `docker/` | Scenarios, step definitions, plans, Moodle adapter, case manifests and patches, Moodle Behat configuration. |
| `provenance/` | How runs were launched and graded: adjudicator prompts and sessions, second-grader verdicts, orchestration scripts. |
| `ui/`, `deploy/`, `docs/` | Local trace console, its service file, and ledger contracts. |

Checksums: `RELEASE.SHA256SUMS` (every file), `experiment-4/EXECUTION.SHA256SUMS`,
`followups.SHA256SUMS`, `clock-recovery/SHA256SUMS`, `results/moodle.SHA256SUMS`, and
`data/SHA256SUMS` (decompressed campaign files). Verify with
`sha256sum --quiet -c RELEASE.SHA256SUMS`.

## Other analyses

The Node analyses that produced the derived reports (`npm run analyze`, the Moodle report,
the follow-up-comparison summary), the re-run procedure for each campaign and the local trace
console are described in `REPRODUCE.md`. They need Node 24 and `npm ci`.

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
