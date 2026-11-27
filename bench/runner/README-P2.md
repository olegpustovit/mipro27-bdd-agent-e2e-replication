# Isolated workers

Install the repository's locked Node dependencies with `npm ci` at the repository root. The worker host needs Docker, and the account running the pool needs non-interactive `sudo` for `nsenter` and `nft` to configure the container network namespaces. No container has the Docker socket or network-administration capability.

`bench/runner/pool` accepts the same selection, seed, gate and ledger arguments as `run-item`. The normal entry points default to two workers. On the 20-CPU, 23 GiB host, two simultaneous payment smokes used 632–633 MiB per worker (sum of per-container cgroup peaks), started in 79–80 seconds and finished in 151–152 seconds with 14–15 seconds of teardown. A separate Moodle/Behat smoke peaked at 1,081 MiB, with 46 seconds of startup and 11 seconds of teardown. Two is the measured concurrency that completed both payment checks within the five-minute attempt budget. Use `--workers N` to change concurrency. A launch still needs the P3 preflight and the P0 gate. For example, a schedule can be inspected without running it.

```sh
bench/runner/pool --filter app=pay --filter rep=1 --seed 14 --list-order
make -C bench test-p2
```

Each attempt creates an internal bridge, an app and a browser. Workers allocate explicit /28 subnets from a dedicated `10.231.0.0/16` range and retry overlaps. This avoids Docker's default subnet pool, which was already exhausted on the worker host. Moodle also gets a seeded Postgres container. The worker resolves the app, database, Playwright browser and Codex images from `env.lock.json`. Moodle's coded adapter uses the Selenium browser pinned in `docker/moodle/versions.json` for its native Behat scenarios. A missing pin stops that attempt before Docker starts. The runner records selected image digests in the ledger and writes startup and teardown milliseconds in the attempt's `worker.json`. Startup covers provisioning and readiness. The P3 ledger measures the full attempt.

The browser namespace can initiate TCP only to its own app's HTTP port, plus loopback for local tooling. For coded payment runs a loopback relay retains the original secure localhost origin for the private UI observer. Moodle's Selenium accepts requests on port 4444 from its web container. Playwright accepts requests on port 3000 from its agent container.

The agent namespace can initiate TCP only to Playwright and the per-attempt CONNECT proxy on the internal network. The proxy is the only container on an external bridge. Its allowlist is `chatgpt.com:443`, `auth.openai.com:443` and `api.openai.com:443`. The agent gets a read-only, curated runtime directory and the read-only Codex login. Payment setup and Moodle generators run before the agent adapter when applicable. The app, browser, proxy and setup containers receive no Codex login.

The model-free tests use temporary output directories and skip the study ledger. They run three consecutive rounds at the default parallelism and check overlapping database writes, coded outcomes, connection allow and deny cases, and the disappearance of worker containers and networks after each run. A separate optional transport smoke requests one short Luna turn without browser actions.

```sh
bench/runner/test-p2 --only network
bench/runner/test-p2 --only moodle
bench/runner/test-p2 --only luna
```
