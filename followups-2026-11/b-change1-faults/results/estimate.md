# Stream B: cost estimate before the measured runs (written 2026-11-26, before any measured trial)

Source: `results/counts-v1.1.4.txt`, section "Cost per suite: payment app (x12 scenarios)". These are mean costs per
execution × 12, over healthy and faulty runs of campaigns A (coded), B (Luna), C (Terra) and D (Haiku).

| Arm | Tokens per 12-run suite (M) | Minutes per suite |
|---|---:|---:|
| coded step definitions | 0 (no model) | 1.5 |
| Luna (`gpt-6-luna`, Codex) | 1.55 | 5.0 |
| Terra (`gpt-5.6-terra`, Codex) | 2.70 | 10.3 |
| Haiku (`claude-haiku-5-5`, omp) | 4.49 | 12.0 |

Design, same as the faulty stages on v0 and v2: 12 faults × 1 scenario each × 2 repetitions = 24 faulty runs per arm,
4 arms = 96 faulty runs = 2 suites per arm.

| Part | Agent tokens (M) | Minutes |
|---|---:|---:|
| faulty v1, Luna | 3.10 | 10.0 |
| faulty v1, Terra | 5.40 | 20.6 |
| faulty v1, Haiku | 8.98 | 24.0 |
| faulty v1, coded | 0 | 3.0 |
| **faulty v1, total** | **17.48** | **57.6** |
| post-hoc healthy-v1 environment check, 1 suite per arm | 8.74 | 28.8 |
| **all planned runs** | **26.22** | **86.4** |

17.48M (or 26.22M with the check) is below the 80M threshold, so the full design (both repetitions) runs directly,
without a one-repetition first pass.

The healthy-v1 check (12 runs per arm, 48 in total) was added after the original campaigns, so it is post-hoc. It shows
whether this host and the current tool versions reproduce the 2026-11-01 healthy-v1 outcomes. It is reported
separately and is not the pairing partner under the paper's rule (that stays the recorded 2026-11-01 healthy-v1-1 run).
