# Benchmark images

With Docker and the Node version pinned in the environment lock, run the build and verify the pins.

```sh
bench/images/build.mjs all
make -C bench lock-check
```

Use BuildKit when the Docker Buildx plugin is present by setting
`DOCKER_BUILDKIT=1`. The build defaults to four payment variants at a time.
Set `P2A_BUILD_JOBS` to adjust for host load. The `tools`, `pay`, and
`pay-healthy` arguments select smaller builds.

The payment matrix starts from the pinned Cypress Real World App commit.
Version and bug patches come from the benchmark checkout's committed tree.
The temporary build contexts contain the payment fixture, the selected source
changes, and build inputs. The images share the locked dependency layer.
Every variant runs `vite build` at image build time. Express serves the
production assets statically alongside the same-origin API on port 3000.
This avoids the Vite dev server's first-page module loading delays observed
in P5. Each image has its own seeded Lowdb JSON file. The setup API is on
127.0.0.1:3001 inside the payment container.

Payment keys are `pay-<version>-healthy` and `pay-<version>-<scenario>`.
The `app` and `db` lock entries for a payment key identify the same
image. Start one container for both roles. Run containers by `digest` after
checking the local tags with `make -C bench lock-check`.

The Chromium image runs a Playwright server on port 3000. Its `/json`
endpoint returns `wsEndpointPath`. Use the resulting WebSocket URL as
`BENCH_BROWSER_WS` on the private worker network. A separate agent
container provides the pinned Codex and Playwright MCP binaries. Mount the
host Codex `auth.json` read-only at `/home/node/.codex/auth.json` when
creating an agent for a run. The bind below grants read-only access.

```sh
--mount type=bind,src="$HOME/.codex/auth.json",dst=/home/node/.codex/auth.json,readonly
```

`bench/images/build.mjs moodle` uses the chosen rows of
`bench/apps/moodle/changes.json` and the adapter's pinned golden Behat seeds.
It builds a web image and a separate preloaded Postgres image for each
`mdl-<change>-<phase>-healthy` key, with the change ID in lowercase.
The web and database containers require the private network aliases
`webserver` and `db`. The database image is for isolated worker networks.
The build can reuse a read-only adapter cache supplied as `P2A_MOODLE_CACHE`.
In cache-only mode it builds the available variants and reports missing seeds. Reserve the adapter's `w0` seed builder when generating missing seeds.
Moodle mutation images can use the same per-commit database image and smoke
check once their committed overlays and any generated assets are available.

`bench/plan/startup.json` records health-check startup times measured on the
build host. Each app starts twice in fresh containers and the
build compares hashes of the payment JSON file or the Moodle logical dump.
The Moodle dump is taken before web startup and excludes PostgreSQL's random
dump delimiter tokens. Smoke checks do not execute a measured trial.
