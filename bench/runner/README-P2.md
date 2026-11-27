# Isolated workers

Install the repository's locked Node dependencies with `npm ci` at the repository root. Workers use the local Docker Engine Unix socket and need non-interactive `sudo` for `nsenter` and `nft`. The Docker socket and network-administration capabilities stay on the host.

`bench/runner/pool` accepts the same selection, seed, gate and ledger arguments as `run-item`. Both entry points default to eight workers. Use `--workers N` to change concurrency. The P3 preflight and P0 gate apply to study runs.

```sh
bench/runner/pool --filter app=pay --filter rep=1 --seed 14 --list-order
make -C bench test-p2
```

Each attempt creates a fresh app and browser on an internal bridge. Moodle also gets a fresh seeded Postgres container. Workers allocate explicit /28 subnets from `10.231.0.0/16` and retry overlaps. They use the local Engine API to create pinned containers, start independent roles concurrently, and poll readiness. There are zero per-attempt image pulls or builds. Moodle's native coded adapter uses the Selenium digest in `docker/moodle/versions.json`. Selected image digests go in the ledger. Startup, cleanup, and individual phase times go in `worker.json`.

The browser namespace can initiate TCP to its app's HTTP port and use loopback for local tooling. A loopback relay preserves the secure localhost origin for the coded payment observer. For native Moodle, Selenium accepts connections on port 4444 from the web container. For the agent, Playwright accepts connections on port 3000 from that attempt's agent container.

The agent can initiate TCP to Playwright and to the per-attempt CONNECT proxy. The proxy connects to `chatgpt.com:443`, `auth.openai.com:443` and `api.openai.com:443`. The ChatGPT-account smoke used `chatgpt.com`. The agent gets the curated runtime and Codex login read-only. The slim image uses Node's public CA roots as a read-only system trust bundle for Codex TLS. Trusted payment setup and Moodle generators run before the relevant adapter. All other containers run without the Codex login.

## Worker-host measurements

The startup profile below covers payment on the 20-CPU, 23 GiB host. The old path ran Docker CLI calls serially. The Engine path overlaps container phases, so their durations can overlap. Readiness is the time spent waiting after provisioning.

| Phase | Coded hold-06, old → Engine | Agent, old → Engine |
| --- | ---: | ---: |
| Network creation | 1.801 → 0.014 s | 1.441 → 0.016 s |
| App container | 5.982 → 0.146 s | 4.773 → 0.245 s |
| Browser container, policy and launch | 8.358 → 0.214 s | 9.849 → 0.305 s |
| Agent container and policy | — | 9.556 → 0.239 s |
| Proxy container | — | 13.318 → 0.270 s |
| Readiness wait and polling | 2.617 → 2.268 s | 4.526 → 2.121 s |
| **Total startup** | **18.776 → 2.496 s** | **43.527 → 2.443 s** |
| Run-specific fixture seeding | 2.244 → 1.663 s | 0 → 0 s for auth-login |
| Teardown | 5.408 → 0.542 s | 7.788 → 0.896 s |

Six mixed workers completed in 17.39 seconds with a summed container peak of 4,731 MiB and mean container CPU use of 3.45 cores. Eight completed in 21.57 seconds with 6,422 MiB and 4.52 cores. Eight provided higher throughput and kept all eight mixed starts within 4.26 seconds. Across three additional eight-worker rounds, all 24 coded payment runs passed and removed their containers and networks.

The 2,478-item plan includes 600 coded payment, 285 coded Moodle and 1,593 agent items. With eight occupied slots, measured coded averages of 9.3 and 21.3 seconds, and an assumed 60-second agent session plus eight seconds of provisioning, setup and teardown, the queue projects to about **4.2 hours**. Assumed agent sessions of 30–120 seconds put the projection at 2.5–7.5 hours. The projection excludes provider delays, retries and pauses. Agent scenario durations still need study-host measurements.

## Technical checks

The model-free tests use temporary output directories and preserve the study ledger. The optional transport smoke requests a one-word Luna turn through the production Codex command, with browser MCP initialized and zero browser actions.

```sh
bench/runner/test-p2 --rounds 3
bench/runner/test-p2 --only capacity --workers 8
bench/runner/test-p2 --only fixtures
bench/runner/test-p2 --only network
bench/runner/test-p2 --only luna
```
