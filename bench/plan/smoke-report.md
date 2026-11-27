# P9 harness smoke report

2026-11-27. P9 used the normal dashboard batch entry point and production runner, pool, gate and adapters. All output went to separate directories under `bench/ledger-smoke/`. The selected smoke plan copied unchanged items from the frozen plan for Payment v1 bank-create and Moodle B15-post S091, repetition 1. Each app contributed one healthy and one bug item per approach. The shuffle seed was 9.

## Acceptance checks

| Check | Command | Result and key output |
| --- | --- | --- |
| Eight parallel workers sized by memory and time | `bench/runner/test-p2 --only capacity --workers 8` | Pass. `parallel=8 wall_ms=21121 peak_sum_mib=6364 mean_container_cpus=4.49`. Four Payment and four Moodle workers reached the barrier with the expected fixtures. All eight coded checks passed and cleaned up. In the full matrix, the first eight attempts started within 0.463 s. |
| Read-only login in the agent container | `bench/runner/test-p2 --only network` and `bench/runner/test-p2 --only luna` | Pass. `auth=readonly browser_mcp=started`, `luna_login_status_exit=0`, `luna_exit=0 turn_completed=True expected_answer=True`. The network check verified that the agent alone had the credential mount. |
| Environment lock and refusal on drift | `time make -C bench lock-check` and `make -C bench lock-check-test` | Pass. `lock-check: all environment pins match` in 10.627 s during concurrent checks. The regression suite passed 20/20, including modified digest pins and `promptSha256 mismatch, runner start marker absent`. |
| All-pass gate refuses a version with a failing gate | See commands below | Pass. The real gate returned 0 for the original B15-post gate and 1 for the same item with the copied gate's status changed to fail. Runner exited 2 with no worker launch or attempt and one alert in the local sink. |
| Full approach matrix | `make -C bench smoke` | Pass. `seed=9 selected=20 workers=8`. All 20 items completed on the first attempt, including 12 valid agent responses. |
| Ledger and dashboard | `make -C bench smoke` and `bench/sync/test-dashboard` | Pass. The matrix synced `20 items, 20 writes` to private artifact `cxt0a0x80fhf`. Ledger verification read 20 attempts and head `e2ac30c0fdd86b4a4aecffde2f486f974969e0f4dc2653a3b9a5581f9fe789cc`. Each DB outcome and attempt hash matched the ledger. The artifact was deleted after verification. The page CSS mapped all seven outcomes to their expected color rules. The dashboard fixture ran separately and reached `green pass and caught_target; detail lists attempts #1–#3`. It also passed the idle sync and 900-second schedule checks, then deleted its private artifact. |
| Invalid login stops the runner and sends exactly one Telegram alert | `make -C bench smoke-bad-login SMOKE_LOGIN_ARGS=--telegram` | Pass after integrating `2391c84`. One invalid auth attempt, one provider-refusal stop, and one successful Telegram delivery. |
| Secret scan on all smoke outputs | `bench/tools/secret-scan bench/ledger-smoke` | Pass for all smoke outputs, including the live alert check. `No credential signatures found`. |
| Slowness baselines | `make -C bench smoke` | Pass. The target recorded every attempt and wrote each arm's median valid-run minutes in the runner's `--smoke-times` format. See `bench/smoke/smoke-times.json`. |

### Credential exclusion in final app and browser images

From the repository root:

```sh
for key in pay-v1-healthy pay-v1-bank-create mdl-b15-post-healthy mdl-B15-S091; do
  APP_IMAGE=$(jq -er --arg key "$key" '.images.app[$key].digest' bench/env.lock.json) \
  BROWSER_IMAGE=$(jq -er '.images.browser.digest' bench/env.lock.json) \
  make -C bench p0-container-check || exit
done

APP_IMAGE=$(jq -er '.images.app["mdl-b15-post-healthy"].digest' bench/env.lock.json) \
BROWSER_IMAGE=$(jq -er '.images.selenium' docker/moodle/versions.json) \
make -C bench p0-container-check
```

Pass. Each invocation exited 0. Every app image, the Playwright browser image and the Selenium browser image printed `auth.json absent`.

### Failed gate

```sh
root=$(mktemp -d "$PWD/bench/ledger-smoke/p9-gate-XXXXXX")
jq '.items[]|select(.id=="mdl.B15.S091.post.healthy.sd-old.r1")' bench/plan/plan.json > "$root/item.json"
bench/runner/check-gate --item "$root/item.json"
jq -c 'if .app=="mdl" and .version=="B15-post" then .status="fail" else . end' \
  bench/plan/gate.jsonl > "$root/failing-gate.jsonl"
BENCH_GATE_RECORDS="$root/failing-gate.jsonl" bench/runner/check-gate --item "$root/item.json"
BENCH_GATE_RECORDS="$root/failing-gate.jsonl" bench/runner/run-item \
  --item mdl.B15.S091.post.healthy.sd-old.r1 --ledger-dir "$root/runner" --alert-sink "$root/alerts.jsonl"
echo "runner exit=$?"
test ! -s "$root/runner/attempts.jsonl"
wc -l "$root/alerts.jsonl"
```

```text
All-pass gate did not pass for mdl/B15-post
seed=0 selected=1 workers=8
P3 runner stopped at mdl.B15.S091.post.healthy.sd-old.r1: failed gate.
paused with 0 selected items pending
runner exit=2
1 .../alerts.jsonl
```

## Initial attempts

Before P1's bulk image inspection fix (`13bd0e1`), the runner hit its 30-second lock preflight timeout with no worker launches. After integrating P1, the first batch found a smoke-wrapper permission error. Two coded attempts reported `EACCES: permission denied, open '/p2input/item.json'` and the runner paused as designed. The smoke wrapper now keeps its ledger directory private and starts the runner with an umask of `022` so production worker bind mounts are readable. The partial ledger contains 13 attempts and verified with head `e1d3bb2ce9152580702dde00f02b039c767522d325606e38e860728064b00c1a`. Its disposable dashboard synced 12 items and was deleted.

## Full matrix

The raw ledger is `bench/ledger-smoke/p9-rx3dkw5t/`. Minutes are adapter and total worker wall time, respectively. Token input includes cached input. Coded items do not report tokens.

| Item | Worker | Outcome | Step | Minutes | Wall minutes | Input | Cached | Output |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| mdl.B15.S091.post.bug.luna.r1 | 5 | fail | 4 | 0.723 | 1.037 | 244016 | 209792 | 559 |
| mdl.B15.S091.post.bug.sd-new.r1 | 7 | fail | 5 | 0.214 | 0.306 | – | – | – |
| mdl.B15.S091.post.bug.sd-old.r1 | 4 | fail | 4 | 0.288 | 0.396 | – | – | – |
| mdl.B15.S091.post.bug.sol.r1 | 3 | fail | 4 | 0.706 | 1.019 | 182177 | 149376 | 487 |
| mdl.B15.S091.post.bug.terra.r1 | 8 | fail | 4 | 0.772 | 1.080 | 155974 | 134912 | 621 |
| mdl.B15.S091.post.healthy.luna.r1 | 7 | pass | – | 0.584 | 1.141 | 194230 | 164992 | 537 |
| mdl.B15.S091.post.healthy.sd-new.r1 | 6 | pass | – | 0.215 | 0.310 | – | – | – |
| mdl.B15.S091.post.healthy.sd-old.r1 | 1 | fail | 4 | 0.270 | 0.370 | – | – | – |
| mdl.B15.S091.post.healthy.sol.r1 | 2 | pass | – | 0.696 | 1.004 | 181706 | 154496 | 456 |
| mdl.B15.S091.post.healthy.terra.r1 | 6 | pass | – | 0.639 | 1.191 | 142728 | 116992 | 578 |
| pay.v1.bank-create.bug.luna.r1 | 2 | fail | 4 | 0.426 | 0.553 | 111544 | 99328 | 476 |
| pay.v1.bank-create.bug.sd-cur.r1 | 4 | fail | 4 | 0.121 | 0.222 | – | – | – |
| pay.v1.bank-create.bug.sd-stale.r1 | 1 | fail | 4 | 0.141 | 0.333 | – | – | – |
| pay.v1.bank-create.bug.sol.r1 | 1 | fail | 4 | 0.657 | 0.764 | 138741 | 124800 | 449 |
| pay.v1.bank-create.bug.terra.r1 | 5 | fail | 4 | 0.605 | 0.715 | 129230 | 109824 | 694 |
| pay.v1.bank-create.healthy.luna.r1 | 8 | pass | – | 0.503 | 0.610 | 124355 | 105728 | 620 |
| pay.v1.bank-create.healthy.sd-cur.r1 | 3 | pass | – | 0.045 | 0.137 | – | – | – |
| pay.v1.bank-create.healthy.sd-stale.r1 | 1 | pass | – | 0.046 | 0.177 | – | – | – |
| pay.v1.bank-create.healthy.sol.r1 | 4 | pass | – | 0.510 | 0.693 | 136734 | 123008 | 455 |
| pay.v1.bank-create.healthy.terra.r1 | 3 | pass | – | 0.592 | 0.695 | 141025 | 120832 | 747 |

### Agent outcomes from the earlier partial batch

| Item | Worker | Outcome | Step | Minutes | Wall minutes | Input | Cached | Output |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| mdl.B15.S091.post.bug.luna.r1 | 5 | pass | – | 0.502 | 0.846 | 194640 | 164864 | 478 |
| mdl.B15.S091.post.bug.sol.r1 | 3 | fail | 4 | 0.648 | 0.996 | 199216 | 164352 | 514 |
| mdl.B15.S091.post.bug.terra.r1 | 8 | fail | 4 | 0.643 | 1.000 | 156470 | 131072 | 604 |
| mdl.B15.S091.post.healthy.luna.r1 | 7 | pass | – | 0.542 | 0.876 | 193915 | 157952 | 486 |
| mdl.B15.S091.post.healthy.sol.r1 | 2 | pass | – | 0.644 | 1.000 | 196165 | 162816 | 466 |
| mdl.B15.S091.post.healthy.terra.r1 | 6 | pass | – | 0.694 | 1.025 | 158649 | 135936 | 711 |
| pay.v1.bank-create.healthy.sol.r1 | 4 | pass | – | 0.515 | 0.622 | 141098 | 126592 | 448 |

## Dashboard color verification

```sh
python3 - <<'PYCODE'
import runpy, subprocess
smoke = runpy.run_path('bench/smoke/run')
html = subprocess.check_output(['art', 'read', smoke['LIVE'], 'index.html'], text=True)
for outcome in smoke['COLORS']:
    smoke['check_color'](html, outcome)
    print(outcome, smoke['COLORS'][outcome])
PYCODE
```

```text
pass --ok
caught_target --ok
caught_other --warn
missed --bad
false_alarm --bad
unresolved --unres
invalid --inv
```

## Runner baselines

Use `--smoke-times bench/smoke/smoke-times.json` with the runner from the repository root. The median pools the four valid adapter durations for each agent approach across the two apps. Each step-definition approach has two valid durations in its app. The runner applies its existing twice-baseline threshold and three-run streak.

## Bad login and Telegram

The first dry run before `2391c84` classified the failed login as a generic infrastructure error and retried once. The fixed adapter records `control.json` with stop `provider refusal` and category `auth`. Both subsequent checks used a temporary home containing a synthetic key and a copy of the Codex model catalog. The live alert check linked to the host Telegram configuration for the notifier to read on delivery. The real Codex login file was never edited or copied.

```sh
make -C bench smoke-bad-login
make -C bench smoke-bad-login SMOKE_LOGIN_ARGS=--telegram
```

```text
seed=0 selected=1 workers=1
launch pay.v1.bank-create.healthy.luna.r1 attempt=1 worker=1
paused with 1 selected items pending
P3 runner stopped at pay.v1.bank-create.healthy.luna.r1: provider refusal. Next: restore provider access or quota.
One provider refusal stop and one sink alert
One provider refusal stop and one Telegram delivery
```

Each fixed run recorded one quarantined attempt and exited 2 at the runner. The wrapper exited 0. The production notifier requires the Telegram Bot API to return `ok: true`. The live smoke ledger verified one attempt with head `170cb31c76dba3bbeba16f7586d3e370459136d4dbf4a072510cf832ca9aa30f`.

| Bad-login run | Outcome | Adapter minutes | Wall minutes | Input / cached / output tokens |
| --- | --- | ---: | ---: | --- |
| Original dry run, attempt 1 | Invalid, infrastructure error | 0.302 | 0.367 | 0 / 0 / 0 |
| Original dry run, attempt 2 | Invalid, infrastructure error | 0.275 | 0.362 | 0 / 0 / 0 |
| Fixed dry run | Invalid, auth refusal | 0.279 | 0.341 | 0 / 0 / 0 |
| Fixed live alert run | Invalid, auth refusal | 0.286 | 0.349 | 0 / 0 / 0 |

## Final verification

- `bench/tools/secret-scan bench/ledger-smoke` printed `No credential signatures found`.
- `git diff --exit-code HEAD -- bench/ledger/attempts.jsonl` exited 0. The study ledger blob remained `e69de29bb2d1d6434b8b29ae775ad8c2e48c5391`.
- `node --test bench/agent/agent.test.mjs` passed 7/7 after the provider-refusal fix. `bench/runner/test-p3` passed, including `PASS slow stop: three launches and one alert` and `PASS provider stop: 1 launches and one alert`.
- The full matrix and timing baselines were collected after the lock-check fix, before the provider-refusal fix. The latter was exercised through the real isolated runner in both alert modes. The matrix used the production adapters throughout. Fixtures were used only for the supplemental lock, runner and dashboard regression tests.
