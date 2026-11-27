# Moodle P7c selection

The selection follows the locked rule in [PLAN.html](../../plan/PLAN.html). The unit counted here is a scenario at a change. A scenario appearing at two different changes contributes two units. The 20-scenario target counts scenarios eligible for both approaches. The coded-only scenario already in the locked plan is shown separately.

## Mining provenance

The original break-screening scripts and archived outputs come from study revision `f24e1b02b11b290710b119eeae374bec1432c754`. The first screen used non-merge history since 2025-07-12 and linked UI changes to Behat repairs. The widened screen walked non-merge history reachable from Moodle pin `cfe123f26fc7071981fe949cb16cd5a08a8234f1`, screened Behat PHP edits, then checked reverse applicability and affected scenarios at the pin. Of 1,803 Behat PHP commits, 778 became candidates and 92 passed the static checks. [Original mining and outputs](upstream-mining/)

The published query joins the archived coded `type=break` rows with `reproduced_core=true` to the manifest and retains the scenarios with `core=true`. For a change spanning multiple commits, `pre` is the parent of the first linked UI commit and `post` is the developer test-fix commit, which contains the last linked UI commit. The 21 changes are sorted by the first UI commit's committer timestamp, using the commit SHA as the tie-breaker. Optional history verification reads the commit metadata and checks the exact feature paths in the linked commits. [Query](mining-query) · [Output](mining-output.json)

## Eligibility evidence

- The adapter installs development dependencies from the upstream Composer lockfile. The recorded constraints identify a sufficient blocker on each rejected pre-change commit. Composer Semver was run with PHP 8.3.36 in the pinned web image. Each entry identifies its upstream lockfile and checksum. [Runtime pins](../../../docker/moodle/versions.json) · [Runtime constraints](runtime-incompatibilities.json)
- The remaining candidates were checked on both exact commits. A build restores Moodle's Behat seed and serves the login page before it is recorded as ready. The probe runs the unchanged developers' Behat scenario before the change and checks fixture preparation on both commits. Its inputs are the archived coded break rows, the manifest, upstream history, and technical build, Behat and generator results. [Probe results](probe-results.jsonl)
- In the search information scenarios, the banner settings affect a search that happens after login. The probe moves that specific configuration step into the fixture before login. Quiz fixtures likewise run developer-supplied data steps for creating quiz records, including question placement and section headings, while the browser instructions retain the login and quiz editing steps. The setup-only Behat run verifies the prepared fixture. The coded run uses the original scenario. Solr-dependent scenarios have no supported leading handoff. [Setup plan](scenario-setup.mjs)
- Each selected phase records the native feature path and line for coded execution, paired text extracts for review, and prepared setup and UI instructions. The scenario extracts retain the Background and scenario steps. The upstream Moodle feature text is GPL-licensed. The `editedScenarios` array identifies old-text runs required by developer edits to linked feature files. [Decisions and counts](changes.json) · [Scenario text](../../scenarios/moodle/)

## Reproduce

From the repository root, run:

```sh
bench/apps/moodle/verify
bench/apps/moodle/mining-query --verify-history /path/to/moodle-clone
node bench/apps/moodle/verify-platform.mjs /path/to/pinned/composer.phar
```

To repeat the technical checks for the eight candidates beyond the Composer exclusions, use a private data directory and an unused Docker worker. The adapter uses worker `w0` to build uncached seeds, so run uncached probes sequentially and reserve `w0` while doing so.

```sh
STUDY_MOODLE_HOME="$PWD/bench/apps/moodle/.scratch/runtime" \
  node bench/apps/moodle/probe.mjs w84 B44 B17 B16 B15 B01 B04 B05 B07
```

To regenerate the decisions and paired extracts from the published evidence:

```sh
node bench/apps/moodle/select.mjs --write-scenarios > bench/apps/moodle/changes.json
```
