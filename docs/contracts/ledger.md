# Run ledger contract

Purpose: every experiment job and trial can be started, restarted and tracked with no double work.
Code: `scripts/study.mjs` (CLI), `scripts/ledger/*` (library), `scripts/drivers/*` (agent CLIs).
Tests: `scripts/ledger.test.mjs` (acceptance, real `systemd-run --user` when reachable, else spawn launcher;
`STUDY_TEST_LAUNCHER=spawn` skips systemd), `scripts/ledger-units.test.mjs`, `scripts/exploratory-deadline.test.mjs`.

## Data directory

`${STUDY_DATA_DIR:-~/.local/share/cucumber-study}`. Locks and logs live here, never in `/tmp`.

| Path | Content |
|---|---|
| `tasks.jsonl`, `tasks.lock` | task and plan ledger (append-only) |
| `trials.jsonl`, `trials.lock` | trial ledger (append-only) |
| `heartbeats/<key>.json` | latest heartbeat of the live attempt (atomically replaced every 15 s) |
| `logs/` | job stdout/stderr per attempt (`<key>.attempt-N.log`), runner progress/status logs |
| `locks/` | fixture and app ownership locks (`cucumber-mcp-study-exclusive.lock`, `...-app.lock`) |
| `blobs/` | per-trial content-addressed trace store |
| `runs/<campaign-id>/` | per-campaign journal, events, trials (unchanged layout) |

`STUDY_REPO_ROOT` overrides the repo root used for source pins (tests). `STUDY_HEARTBEAT_MS` (15000) and
`STUDY_DEAD_LEASE_MS` (120000) exist for tests. `STUDY_LAUNCHER=systemd|spawn` forces a launcher.

## Keys: one key = one piece of work forever

- plan: sha256 (hex) of the canonical JSON of `{manifest, sourcePins, models, cliVersions, promptHashes, drivers}`;
  `planShort` = first 12 hex chars.
- task: `<kind>:<scope>`, e.g. `campaign:moodle/luna`. Unit name `study-<sanitized key>-<8 hex of sha256(key)>`.
- trial: `<planShort>/<case>/<state>/<arm>/<model>/r<k>`.
- deliberate re-run: suffix `#2`, `#3`, ... plus a recorded reason (`--reason` for tasks, `rerunReason` for trials).
  A re-run is a new key; the original stays as it was.

## Locking

Writers serialize on util-linux `flock(1)`. A helper `flock -x <lock> sh -c 'echo L; exec cat'` holds the lock; closing its stdin
releases it, and the kernel releases it if the holder dies (kill -9, OOM). So there is no stale-lock detection to get wrong.
Check-then-append decisions (claim, freeze, trial-start) run inside one lock; every line is one `write()` on an `O_APPEND`
descriptor followed by `fsync()`. Linux only (needs `flock`). Cost: about 3 ms per locked append.

## Plan manifest (JSON) and freezing

```json
{ "plan": "moodle-2026", "models": ["gpt-6-luna"], "drivers": ["codex", "omp", {"module": "./x.mjs"}],
  "prompts": {"runtime": "study/prompt.md"}, "pinPatterns": ["scripts/*.mjs", "study/*.mjs"],
  "tasks": [{"key": "campaign:moodle/luna", "cmd": ["node", "scripts/job.mjs"], "cwd": "/abs/optional"}] }
```

`pinPatterns` default: `scripts/*.mjs study/*.mjs study/*.feature package.json package-lock.json` (git ls-files incl. untracked, not ignored).
`study plan freeze <manifest>` records `plan-frozen` (plan hash plus all inputs). It refuses if another hash is already frozen under
that plan name (a changed plan needs a new name). Re-freezing the same hash is a no-op (`already-frozen`). It prints one JSON line
for the orchestrator to mirror into Foundry (this repo never writes to Foundry):
`{"type":"plan-frozen","status":"frozen","plan":...,"hash":...,"short":...,"tasks":[...],"models":[...],"cliVersions":{...},...}`.

## Task ledger (`tasks.jsonl`)

One JSON object per line, field `type`:

| type | fields |
|---|---|
| `plan-frozen` | plan, hash, short, inputs, manifestPath |
| `task-planned` | key, base, plan, planHash, cmd (argv), cwd, reason?, rerunOf? |
| `task-claimed` | key, attempt, resume, lease {host, unit, startedAt, claimerPid} |
| `task-running` | key, attempt, pid, pidStart, host, unit |
| `task-done` / `task-failed` / `task-interrupted` | key, attempt, exit?, signal?, reason?, log, synthesized? |
| `task-cancel-requested` | key, attempt, reason |
| `task-launch-failed` | key, attempt, error (state returns to what it was before the claim) |

States: `planned -> claimed -> running -> done | failed | interrupted`. Only the current attempt's first terminal event counts.

Lease: host, pid of the in-unit wrapper (plus its /proc start time, so a reused pid is not mistaken for it), systemd unit, startedAt,
heartbeat file updated every 15 s. A lease is **dead** only when its pid is gone (or on another host) **and** the last sign of
life (heartbeat, else claim time) is older than 2 minutes. Otherwise it is alive.

## CLI

`npm run study -- <command>` (or the `study` bin).

- `study plan freeze <manifest>` as above.
- `study task start <key> [--plan <name> --cmd "<command>" | -- <argv...>] [--reason <text>]` verifies the plan hash against the frozen one
  (recomputed from the manifest, source pins, CLI versions, prompts), then claims the lease under the lock and launches
  `systemd-run --user --unit=<unit> --collect ... node scripts/study.mjs task exec <key> --attempt N`. Refuses when the task is done,
  has a live lease (prints an attach hint), the plan or pins differ from the frozen ones, the unit already exists, or the task is not
  `planned` (failed/interrupted tasks need `resume`; this is stricter than the brief and is what prevents a second from-scratch run).
  `#N` keys need `--reason` and an existing, not-live `#N-1`.
- `study task resume <key>`: allowed when state is `failed`/`interrupted`, or `claimed`/`running` with a dead lease (a synthesized
  `task-interrupted` is written first). Runs the same command with `--resume` appended and `STUDY_RESUME=1`. Refuses on live lease
  (attach hint; a gone pid with a fresh heartbeat still counts as alive until the 2 minutes pass), done, never-started, or changed plan/pins.
- `study task status [key] [--json]`: table of state (with `(lease DEAD)`), trials done/total, tokens in/out, last heartbeat, unit.
  Token cells show `?` when any trial's count is unknown.
- `study task cancel <key> --reason <text>`: records the request, stops the unit (`systemctl --user stop`, or SIGTERM in spawn mode),
  records `task-interrupted` with the reason.
- `study task exec <key> --attempt N` (internal): runs inside the unit. Records `task-running`, heartbeats, runs the job with env
  `STUDY_TASK_KEY, STUDY_TASK_ATTEMPT, STUDY_PLAN, STUDY_PLAN_HASH, STUDY_PLAN_SHORT, STUDY_RESUME, STUDY_DATA_DIR`, logs to
  `logs/`, then records `done` (exit 0), `failed` (non-zero or signal) or `interrupted` (cancel/SIGTERM). Exit 0 with fewer
  `trial-end`s than planned trials is recorded as `failed`, not `done`.

## Trial ledger (`trials.jsonl`)

| type | fields |
|---|---|
| `trials-planned` | task, seed, shuffleBlocks, order (trial keys) |
| `trial-start` | key, task, attempt, block, rerunReason?, host, pid, pidStart |
| `trial-end` | key, task, attempt, outcome (`recorded`, `error`, runner results), meter, ...job fields |
| `trial-interrupted` | key, task, attempt, reason |

Rules (library `scripts/ledger/trials.mjs`: `planTrials`, `startTrial`, `endTrial`, `reconcileEnded`, `runTrials`):
a trial with `trial-end` is done and never re-run (an errored trial is also ended: failures are kept, not retried);
`trial-start` without end from a dead process gets `trial-interrupted` and the trial re-runs as attempt n+1 (both attempts stay);
a start whose pid is alive refuses. Order: seeded randomized blocked order (blocks = e.g. case, shuffled; trials shuffled within a block),
the seed and the final order are recorded in `trials-planned` and reused on resume; a changed trial set is refused.

`scripts/exploratory-runner.mjs` follows the same rules in its own `journal.jsonl` (`trial-started` with `attempt`, `trial-interrupted`,
`trial-finished`, `stage-order`) and mirrors to this ledger when `STUDY_TASK_KEY` is set. It takes the campaign deadline from
`--deadline <ISO UTC>` or `STUDY_DEADLINE_UTC`, records it (and the order seed and driver inputs) in `campaign-frozen`, and on resume uses
the recorded values. The plan files hold no deadline; `study/campaign-config.mjs` keeps the 2026-11-01 value only as provenance.
Campaigns frozen without `orderSeed` keep the plan order.

## Drivers (`scripts/drivers`)

One interface (`index.mjs`): `name`, `model`, `version()` (the CLI's own `--version`; for omp this is `omp --version`, e.g. `omp/18.20.2`),
`systemPromptHash()` -> `{hash, source}` or `null` when not readable before a run, `prepare({endpoint, prompt})` (sandboxed invocation),
`usage(events)` (canonical meter), `systemPromptFromEvents(events)`, `requestIds(events)`, `frozenInputs()` ->
`{driver, cliVersion, model, systemPromptHash, systemPromptHashSource}`. Built-ins `codex.mjs`, `omp.mjs`; a plan may name
`{"module": path}` exporting `createDriver()` (tests use a fake). Frozen inputs enter the plan hash; `agent-session.mjs` records
`driver` and `requestIds` per session. Unknown values are `null`/`[]`, never guessed.

## Metering (`trial-end.meter`)

`inputTokens` (total input as reported, including cache read and write), `cacheReadTokens`, `cacheWriteTokens`, `outputTokens`,
`reasoningTokens`, `inputIncludesCache: true`, `reportedCostUsd`, `wall {totalMs, modelMs, browserMs, fixtureMs, unattributedMs}`.
Anything not observed is `null`, never 0; `unattributedMs` is `null` unless the total and all three parts are known. Sums
(`sumMeters`) are `null` when any addend is unknown and keep `<k>Observed` and `<k>Coverage` (`seen/total`).
The exploratory runner fills total wall and, for agent trials, tokens/cost; model/browser/fixture split is not instrumented there yet (null).

## Trace store (`scripts/ledger/blobstore.mjs`)

`createBlobStore().attach(trialKey, kind, name, bytes | {path}, meta)`: kinds `playwright-trace`, `mcp-snapshot`, `cli-rollout`,
`screenshot`, `other`. Objects are stored once at `blobs/objects/<aa>/<sha256>` (written via temp file, fsync, rename);
`blobs/trials/<fileSafe(trialKey)>.json` holds `{trialKey, entries:[{name, kind, sha256, bytes, at, meta}]}`. `manifest(key)`, `read(sha)`,
`verify(key)` (re-hashes; returns damaged entries). The Moodle lane calls `attach` from its Playwright/MCP/CLI hooks; no hook is wired
into the Cucumber/Real-World-App runners here.

## Fixture lock

`acquireLock()` records `{pid, pidStart, host}` in the lock file. A lock left by a dead owner on this host is taken over only with
`{takeoverDeadOwner: true}`, which the exploratory runner passes on `--resume`; seed and source pins are re-verified before the next trial
by the existing guards. A normal acquire still fails on any existing lock.

## Orphan reaping (`scripts/ledger/reap.mjs`)

Playwright starts Chromium detached (own session and process group), so killing a job (or its process group) with SIGKILL leaves the
browser, its zygote and renderers running. The ledger therefore launches every job with `STUDY_REAP_TAG=<task key>` in its environment;
children inherit it whatever their process group, and `reapTagged(tag)` finds them through `/proc/<pid>/environ` (never itself or its
ancestors; zombies skipped), sends SIGTERM, waits up to 3 s, then SIGKILL. It runs
(a) in `task exec` after the job exits, for any reason, before the terminal event is recorded (the event lists `reaped` comm names and
`reapSurvivors`); (b) in `task resume`, after the lease was found dead and before the next attempt starts (covers a SIGKILLed wrapper, where
no process of the dead attempt could clean up; under systemd the unit's cgroup already goes with the unit, with the spawn launcher it does not);
(c) in `task cancel` after the stop. Tests: `scripts/ledger.test.mjs` (job SIGKILLed; wrapper and job SIGKILLed then resumed; `reapTagged` unit test).
