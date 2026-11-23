# Reproducing the exploratory campaigns

This repository holds everything needed to (1) recompute every reported number from the recorded
data, and (2) re-run the four campaigns of 2026-11-01. Status of all results: `exploratory-owner-directed`,
`gatePassExists: false`; the Research Foundry Evidence gate was STOP when they ran (see `AGENTS.md`).

## 0. Recompute the paper's counts (Python, offline, about 10 s)

```sh
uv run scripts/reproduce_counts.py
```

Uses the Python 3.14 standard library only and compares every value with the paper; see
`README.md` for the scoring rules and `results/counts-v1.1.0.txt` for the expected output.

## 1. Recompute the results (exact, offline, about 30 s)

Requires Node 24 (built-in zstd). No network, no models.

```sh
npm run analyze        # node scripts/analyze-campaigns.mjs --verify
```

This decompresses `data/campaigns/*`, checks every file against `data/SHA256SUMS` (hashes of the
decompressed files as shipped; `data/SHA256SUMS.original` keeps the hashes of the files as written by
the runner on 2026-11-01, see section 6), and writes `results/<campaign>.analysis.txt` and
`results/<campaign>.derived.txt` using the analysis code that produced the reported numbers
(`provenance/orchestration/analyze.mjs`, `derived.mjs`, recovered unchanged). The committed `results/`
are the output of this command; `git diff --exit-code results/` after running it confirms reproduction.

| Campaign | Commit | Runtime model (CLI) | Executions | Notes |
|---|---|---|---|---|
| `campaign-20261101-04d8551` (A) | `04d8551` | `gpt-6-luna` medium (Codex CLI 0.159.3) | 216: 108 step code, 108 agent | 2 maintenance transitions by `gpt-6-luna`. 13 agent false alarms caused by `browser_reload` returning before data loaded (harness defect). |
| `campaign-b-20261101-02f4758` (B) | `02f4758` | `gpt-6-luna` medium | 108 agent | Post-hoc: reload waits for network idle (max 5 s). Step code frozen from A. |
| `campaign-c-20261101-f7857ea` (C) | `f7857ea` | `gpt-5.6-terra` medium | 108 agent | Post-hoc second model. |
| `campaign-d-20261101-2b2589f` (D) | `2b2589f` | `claude-haiku-5-5` medium thinking (omp 18.14.0) | 108 agent | Post-hoc, owner-suggested. CLI and its system prompt are confounded with the model. |

Each campaign's `journal.jsonl` starts with a `campaign-frozen` record holding SHA-256 pins of 88 source
files and the pinned upstream app files. Verified 2026-11-15: at each commit above, all 88 pins match
(`node scripts/verify-source-pins.mjs`).

Each adjudication is a separate LLM review, not code. Its exact prompt, model and full session are in
`provenance/adjudication/` (see section 3).

### Recompute the two-case rescue fact sheet

In the replication package, `moodle-ledger/` contains the frozen Moodle measurement ledger,
the referenced trace and repair blobs, and the Cypress follow-up journals and grades under
`runs/`. Verify the follow-up files with `sha256sum -c followups.SHA256SUMS`. Install the
locked Node dependencies with `npm ci`. The Moodle analysis reads the original scenario
definitions from the public Moodle checkout. If you do not already have that checkout, fetch
the exact commit in `docker/moodle/versions.json`:

```sh
export STUDY_MOODLE_HOME="$PWD/moodle-source"
commit_value=cfe123f26fc7071981fe949cb16cd5a08a8234f1
moodle_source="$STUDY_MOODLE_HOME/src/cfe123f26fc7"
git init "$moodle_source"
git -C "$moodle_source" fetch --depth 1 https://github.com/moodle/moodle.git "$commit_value"
git -C "$moodle_source" checkout --detach FETCH_HEAD
test "$(git -C "$moodle_source" rev-parse HEAD)" = "$commit_value"
```

From the package root:

```sh
export STUDY_DATA_DIR="$PWD/moodle-ledger"
npm run analyze
npm run analyze:moodle -- --plan 6ac189f540b8
node provenance/orchestration/rescue-followups.mjs
node provenance/orchestration/rescue-numbers.mjs --write
```

These commands use recorded evidence and make no model calls. The measured Moodle report
reproduces from the frozen plan. The smoke and resource reports regenerated with the plan
filter cover only that plan. In the release, the `-historical.txt` resource and smoke reports
cover the broader local ledger. The release also preserves the original 540-trial
Cypress agreement report as `results/judge-agreement-original-cypress.txt`. The
regenerated agreement report includes the follow-ups and identifies missing grades. The fact sheet separates Cypress and Moodle
units and includes Cypress follow-up grades only when all planned cells and grading are accounted for.

## 2. Re-run a campaign (new measurements; outcomes will differ)

LLM agents are not deterministic, and hosted models change or are retired. A re-run reproduces the
procedure, not the exact verdicts. Every re-run must use a new campaign id and be reported as a new run.

Environment used (host `main`): Ubuntu 24.04.4 LTS, aarch64, Node v24.22.1, bubblewrap 0.9.0,
Codex CLI 0.159.3, omp 18.14.0 (campaign D only), Playwright 1.65.0-alpha-2026-10-30 (from
`package-lock.json`), Cypress Real-World App at upstream commit `0729f68ac220f7cda4ad09c5693dba11d7c532c6`.

```sh
git checkout <commit from the table>
npm ci
npm run bootstrap          # clones and pins the upstream app, applies the loopback patch
npm run app                # keep running (ports 3000, 3001, loopback only)
npm test                   # unit tests must pass

# Campaign A (both arms, 216 executions)
ID=campaign-$(date -u +%Y%m%d)-$(git rev-parse --short HEAD)
# The deadline is campaign configuration (the 2026-11-01 value is kept only as provenance in study/campaign-config.mjs).
systemd-run --user --unit=cucumber-campaign --working-directory="$PWD" -p MemoryMax=4500M \
  --setenv=PATH="$PATH" --setenv=HOME="$HOME" node scripts/exploratory-runner.mjs --campaign-id "$ID" --deadline <ISO UTC>

# Campaigns B, C, D (runtime arm only, against campaign A's frozen step code)
A=<your campaign A id>
systemd-run --user --unit=cucumber-campaign-b --working-directory="$PWD" -p MemoryMax=4500M \
  --setenv=PATH="$PATH" --setenv=HOME="$HOME" --setenv=STUDY_RUNTIME_RERUN_FROM=$A \
  [--setenv=STUDY_MODEL=gpt-5.6-terra | --setenv=STUDY_MODEL=claude-haiku-5-5] \
  node scripts/exploratory-runner.mjs --campaign-id "$ID"

# Resume after an interruption (refuses if any frozen hash differs; a trial left without trial-finished re-runs as attempt 2)
node scripts/exploratory-runner.mjs --resume "$ID"

# Preferred for new runs: start/resume/track through the run ledger, see docs/contracts/ledger.md
npm run study -- plan freeze <manifest.json>
npm run study -- task start campaign:<scope> --plan <name> -- node scripts/exploratory-runner.mjs --campaign-id "$ID" --deadline <ISO UTC>
npm run study -- task status
```

Run data is written to `~/.local/share/cucumber-study/runs/<id>/`. To add a run to this repository,
copy it in the layout of `data/campaigns/` (compress `trials.jsonl` and `events.jsonl` with
`zstd -19`, rename `progress.log` to `progress.txt`) and append its hashes to `data/SHA256SUMS`.

The exact commands used on 2026-11-01 were to be collected in
`provenance/orchestration/launch-and-patch-commands.log`. That file was not preserved and is not in
this package; the launch scripts in `provenance/orchestration/` are the remaining record.

## 3. Re-run the adjudication

The adjudicator was a fresh Codex session, `gpt-5.6-terra` at **high** reasoning effort, Codex CLI 0.159.3,
started with:

```sh
agentpack --yolo codex --no-daemon exec -m gpt-5.6-terra -c 'model_reasoning_effort="high"' \
  --skip-git-repo-check -C ~/projects/cucumber-mcp-study --add-dir /tmp \
  --add-dir ~/.local/share/cucumber-study --json - < provenance/adjudication/<campaign>.prompt.md
```

The template is `provenance/orchestration/brief-adjudicate.md`; the exact prompt each campaign received
is `provenance/adjudication/<campaign>.prompt.md`, and the full session (every command it ran and every
file it wrote) is `<campaign>.codex-rollout.jsonl.zst`. In the sessions, the two provider account
identifiers in the session header are replaced by `<redacted>`. A new adjudication is a new judgment and must be
reported beside, not instead of, the committed one.

## 4. Known limits of this record

- The adjudicator ran without a sandbox (`--yolo`). Its instruction not to read other campaigns was not
  technically enforced. Its sessions show what it read.
- The adjudicator also wrote a short summary to `/tmp/cucumber-study-adjudication*.md`. Those files were
  lost when `/tmp` was cleared. Their content can be recovered from the committed sessions, and every count
  in them is recomputed by `npm run analyze`.
- The agent's verdicts, raw responses and tool ledgers are in `trials.jsonl`. The agents' own CLI
  session files were not kept: each ran in a sandbox with a temporary home directory.
- The orchestration scripts in `provenance/orchestration/` were recovered from the orchestrating Claude
  Code session log on 2026-11-15. They are byte-for-byte what was written then, except that the
  author's home-directory prefix is replaced by `<home>` (section 6), including hard-coded
  `/tmp/claude-501/...` paths that no longer exist. They are kept as a record, not as a supported entry point.
- `data/excluded/` is an excluded pre-campaign resume test. It is not study data.
- Unmeasured: the cost of writing the step definitions in the first place.

## 5. Local experiment console

```sh
npm run console
# Open http://localhost:7878 on this machine.
# From another machine, forward the VM's loopback port:
ssh -N -L 7878:127.0.0.1:7878 main
# Then open http://localhost:7878 on that machine.
```

The listener is always `127.0.0.1` (default port 7878; `CONSOLE_PORT` may change the port).
The application has no public listener. An owner-only Tailscale proxy can forward to the
local port. Anyone with access to the loopback port or its SSH forward can browse and save answers.
Answers use rater `local-owner`; this label is not a verified personal identity.

Overview, Trials and Trace read committed campaigns and additional live run directories.
Every recorded trial has its complete saved tool ledger; expandable results are not truncated.
The server never runs experiments, models, the study application, Start or Resume.
The only server write is append-only `data/human-adjudication.jsonl` (created on the first
saved answer; not shipped, because no human grades were collected). Corrections append a
new answer; latest answer per rater/trial counts. Never replace that history.

The optional human review queue uses the committed `data/human-sample.json`. No human
grades enter the paper's analysis. The queue hides the automated grades and explicit arm
labels until an answer is saved. Trace shape can
still suggest the arm; this is not a claim of enforced arm blinding. Browsing Trials first
can reveal labels. The sample is descriptive, not a random estimate of population accuracy.
Run `node scripts/human-sample.mjs` only to create a missing sample; overwriting requires
explicit `--force`. Do not silently select a new sample after looking at its answers.

`npm run analyze` additionally writes `results/facts.txt`: corrected breakage (12/12, 8/12),
repair budgets, and with/without-social results. The local console can separately report
optional human agreement. Original `.analysis.txt` and
`.derived.txt` files remain exact historical reproductions; their initial-suite lines are
known wrong. The frozen B–D journals retain the unfiltered 216-execution plan even though
each runtime-only rerun recorded 108; the console labels that denominator discrepancy.
The immediate healthy stages after repairs are 5/12 and 12/12; later v2 repetitions include
one infrastructure-invalid execution and are not silently counted as correct passes.

For a persistent local service on host `main`: `smdctl run -f deploy/console.smdctl.yml`
(replace `<home>` in that file with your home directory).
Stop it with `smdctl stop cucumber-console` before using `npm run console` on the same port.

The review page shows the test's own report and the observer's recorded checkpoints. A
reviewer can mark any checkpoint as passed, failed, unreached, or uncertain. The reviewer
saves one overall run grade to reveal both automated grades.

The corrected supplement also contains campaign-specific resource tables: per-run elapsed totals
across all results, recorded-result mean/median with its denominator, and input/cached-input/
uncached-input/output token counters. Missing measurements are named; the maintained execution
arm has no model-usage ledger and its repairs are reported separately. These counters are not
billed charges and exclude unmeasured construction, adapter/prompt/harness engineering and
human labor. Codex/omp runtime CLI pins are taken from the reproduction record above.

Resource table conventions (v2): absent/null token counters stay unknown. Complete totals become
null when any required input/output measurement is missing, while observed partial sums and
coverage are retained. Cache-read and cache-write counters have separate coverage. Input minus
cache-read is `nonCacheReadInput`, not one billing category; omp input includes cache writes.
The table separates new input from cache writes only where all needed counters were recorded.
Repair sessions have the same coverage/category reporting and never turn missing usage into zero.

For even sample sizes, the new median averages the two middle elapsed values; recovered scripts
use the upper middle value. `record.elapsedMs` is the trial phase from setup/environment/UI/reset/
browser creation through execution, observer evaluation and cleanup/source restore, before the
trial-record emit. Maintenance elapsed includes setup, initial validation, agent/tool validation,
cleanup and source restore, before maintenance-record emit. Phase sums omit between-phase and
one-time bootstrap work and are not full campaign wall time or pure model inference latency.

### Recompute the matched Cypress runtime comparison

The replication package preserves the 36-cell manifest and the four campaigns under
`experiment-4/`. Each campaign contains its execution journal, trace records, and both
automated grade files. The manifest pins the common source commit
`a0edf26ea2210f7c288569c795b2f3b34368b5be`. Verify the package and derive the comparison
from its root:

```sh
sha256sum --quiet -c RELEASE.SHA256SUMS
(cd experiment-4 && sha256sum --quiet -c EXECUTION.SHA256SUMS)
node provenance/orchestration/summarize-experiment-4.mjs experiment-4
node provenance/orchestration/summarize-experiment-4.mjs --facts experiment-4
STUDY_DATA_DIR="$PWD/moodle-ledger" node provenance/orchestration/audit-witness-order.mjs --facts
```

The last command requires both grades for every usable run. Model and CLI are reported
together because the comparison uses omp, Codex, and Claude Code. Metered time is the
sum of trial elapsed times. Metered execution charges and second-grader charges are
reported separately.

In 12 Opus runs the final response ended with prose followed by a bare JSON verdict object.
Verdict parser version 1 recorded them as unresolved. `scripts/verdict.mjs` is now version 2,
which also accepts one verdict object ending the response, with the same conflict checks.
`provenance/orchestration/prepare-verdict-recovery.mjs` replayed every recorded response; only
12 matched-comparison Opus runs and one follow-up Opus run changed. Their re-decoded records,
regraded by both graders, are `experiment-4/campaign-experiment4-opus-verdict-v2/` and
`moodle-ledger/runs/campaign-f-20261118-opus-verdict-v2/`; the summary above uses them in place
of the originals. `uv run scripts/counts/opus_reparse.py` re-derives them independently.
The manifest pins `scripts/verdict.mjs` at version 1, the version that ran.

The matched comparison ran with a later `study/ui-contract.mjs` than campaigns A to D. The
package's `study/ui-contract.mjs` is the campaign A to D version; the version pinned by
`experiment-4/experiment-4-comparison.json` is `experiment-4/source-pins/study/ui-contract.mjs`.

The `clock-recovery/` directory preserves the re-evaluated Sol and earlier Opus traces
and their new grades alongside the original invalid records in the follow-up ledgers.
Run `(cd clock-recovery && sha256sum --quiet -c SHA256SUMS)` to verify the recovery
files. Its README identifies the inferred observation and the scope of the correction.

## 6. Path placeholders and checksums (v1.1.0)

Release v1.1.0 replaces the author's home-directory prefix with `<home>`, the same prefix in
munged session-directory names with `-<home>-`, the host name with `<host>`, and the user name
in one adjudicator session's file listings with `<user>`, in every file,
including inside the `.zst` files. Nothing else changed in the recorded data. Affected recorded
files: campaign A `trials`, `events`, `journal` and `adjudication`, `moodle-ledger/tasks.jsonl`
and `moodle-ledger/trials.jsonl`. Consequences:

- `data/SHA256SUMS` holds the hashes of the shipped decompressed files and is what
  `npm run analyze` checks. `data/SHA256SUMS.original` still holds the runner-written hashes; four
  campaign A files differ from them only by the placeholder. The unmodified bytes are in the
  v1.0.0 release archive.
- A `recordSHA` stored inside an affected record was computed over the original record, so a
  recomputed digest of such a record no longer matches it. Records in `experiment-4/`,
  `clock-recovery/`, `moodle-ledger/runs/` and campaigns B to D are unaffected.
- The sandbox self-checks in `scripts/codex-boundary.mjs` and `scripts/drivers/claude-code.mjs`
  test the running user's home directory (`os.homedir()`) instead of a literal path, so the
  matched-comparison source pins for those two files no longer match.

