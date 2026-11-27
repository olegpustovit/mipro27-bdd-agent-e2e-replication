"""One fresh Docker environment per P3 attempt."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack, contextmanager
from functools import cache
import ipaddress
import json
import os
from pathlib import Path
import re
from secrets import randbelow
import shutil
import subprocess
from tempfile import TemporaryDirectory
from time import monotonic, sleep
from uuid import uuid4

from docker_engine import DockerEngine, DockerError

BENCH = Path(__file__).resolve().parents[1]
ROOT = BENCH.parent
DEFAULT_WORKERS = 8
MIB = 1024 ** 2
AGENT_LIMIT_SECONDS = 900  # bench/agent/session.mjs
AGENT_HOST_MARGIN_SECONDS = 30
INFRASTRUCTURE_TIMEOUT_SECONDS = 300


class AgentTimeout(RuntimeError):
    """The host watchdog expired before the agent could report its result."""


def docker(*args, timeout=30, check=True, input=None):
    result = subprocess.run(["docker", *map(str, args)], text=True, input=input,
                            stdin=subprocess.DEVNULL if input is None else None,
                            capture_output=True, check=False, timeout=timeout)
    if check and result.returncode:
        raise RuntimeError(f"docker {args[0]} failed ({result.returncode}): {result.stderr.strip()}")
    return result


@cache
def public_ca_bundle():
    return subprocess.check_output(
        ["node", "-p", "require('node:tls').rootCertificates.join('\\n')"],
        text=True, timeout=10)



def pins_for(item, pins, agent):
    images = pins["images"]
    healthy = item["condition"] == "healthy"
    if not healthy and item["condition"] != "bug":
        raise ValueError("unknown condition")
    if item["app"] == "pay":
        key = f"pay-{item['version']}-{'healthy' if healthy else item['scenario']}"
        db_key = key
    elif item["app"] == "mdl":
        db_key = f"mdl-{item['version'].lower()}-healthy"
        key = db_key if healthy else item["bugId"]
        if key in images["db"]:
            db_key = key
    else:
        raise ValueError("unknown app")
    selected = {"app": images["app"][key], "db": images["db"][db_key],
                "browser": images["browser"], "agent": images["agent"] if agent else None}
    result = {}
    for role, pin in selected.items():
        digest = pin["digest"] if pin else None
        if digest and not re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
            raise ValueError(f"invalid {role} image digests")
        result[role] = digest
    return result


class Worker:
    def __init__(self, item, pins, agent=False):
        self.engine = DockerEngine()
        self.agent_run = agent
        self.item = item
        self.images = pins_for(item, pins, agent)
        if item["app"] == "mdl" and not agent:
            selenium = json.loads((ROOT / "docker/moodle/versions.json").read_text())["images"]["selenium"]
            self.images["browser"] = self.engine.image(selenium)
        self.name = f"p2-{uuid4().hex[:16]}"
        self.stack = ExitStack()
        self.startup_ms = None
        self.phases_ms = {}
        self.teardown_ms = None

    def __enter__(self):
        return self

    def __exit__(self, *_):
        started = monotonic()
        try:
            self.stack.close()
        finally:
            self.teardown_ms = round((monotonic() - started) * 1000)

    @contextmanager
    def phase(self, name):
        started = monotonic()
        try:
            yield
        finally:
            self.phases_ms[name] = round((monotonic() - started) * 1000)

    def container(self, role, image, ip, *, aliases=(), mounts=(), env=(), command=None,
                  cap_drop=(), shm=64, hosts=(), user=None, health=None, external=False):
        name = f"{self.name}-{role}"
        self.stack.callback(self.remove, "container", name)
        networks = {self.name: {"IPAMConfig": {"IPv4Address": ip}, "Aliases": list(aliases)}}
        if external:
            networks["bridge"] = {"GwPriority": 1}
        config = {
            "Image": image, "Labels": {"mipro.p2": self.name},
            "NetworkingConfig": {"EndpointsConfig": networks},
            "HostConfig": {"NetworkMode": self.name, "SecurityOpt": ["no-new-privileges"],
                           "CapDrop": list(cap_drop), "ShmSize": shm * MIB,
                           "ExtraHosts": list(hosts), "Mounts": list(mounts)},
            "Env": list(env),
        }
        if command:
            config["Cmd"] = list(command)
        if user:
            config["User"] = user
        if health:
            config["Healthcheck"] = {
                "Test": ["CMD-SHELL", health], "Interval": 1000000000,
                "Timeout": 3000000000, "StartPeriod": 90000000000, "StartInterval": 250000000,
            }
        self.engine.create(name, config)
        self.engine.start(name)
        return name

    @staticmethod
    def bind(source, target):
        return {"Type": "bind", "Source": str(source), "Target": target, "ReadOnly": True}

    def remove(self, kind, name):
        for attempt in range(3):
            try:
                self.engine.remove(kind, name)
                return
            except (DockerError, OSError):
                if attempt == 2:
                    raise
                sleep(0.25)

    @staticmethod
    def addr(name):
        output = docker("inspect", "-f", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}", name)
        return str(ipaddress.IPv4Address(output.stdout.strip()))

    def firewall(self, name, peers, inbound=None):
        pid = self.engine.inspect(name)["State"]["Pid"]
        if pid <= 1:
            raise RuntimeError("container has no network namespace")
        # Use host tooling before starting the browser or agent payload. The
        # containers never receive NET_ADMIN or access to the Docker socket.
        rules = ["table inet p2 {", "chain output {",
                 "type filter hook output priority filter; policy drop;",
                 "ct state established,related accept",
                 'oifname "lo" ip daddr 127.0.0.1 accept', 'oifname "lo" ip6 daddr ::1 accept']
        rules.extend(f"ip daddr {ipaddress.IPv4Address(ip)} tcp dport {int(port)} accept" for ip, port in peers)
        rules += ["}", "chain input {", "type filter hook input priority filter; policy drop;",
                  "ct state established,related accept", 'iifname "lo" ip daddr 127.0.0.1 accept', 'iifname "lo" ip6 daddr ::1 accept']
        if inbound:
            ip, port = inbound
            rules.append(f"ip saddr {ipaddress.IPv4Address(ip)} tcp dport {int(port)} accept")
        rules += ["}", "}"]
        subprocess.run(["sudo", "-n", "nsenter", "-t", str(pid), "-n", "nft", "-f", "-"],
                       input="\n".join(rules) + "\n", text=True, check=True, timeout=10)

    def healthy(self, *names):
        pending = set(names)
        deadline = monotonic() + 90
        while pending and monotonic() < deadline:
            for name in tuple(pending):
                state = self.engine.inspect(name)["State"]
                if not state["Running"]:
                    raise RuntimeError(f"{name} stopped before readiness")
                if state["Health"]["Status"] == "healthy":
                    pending.remove(name)
            if pending:
                sleep(0.15)
        if pending:
            raise RuntimeError(f"did not become healthy: {', '.join(sorted(pending))}")

    def local(self, executable, raw, *args, env=None):
        output = subprocess.run([executable, *map(str, args)], stdin=subprocess.DEVNULL,
                                capture_output=True, text=True, cwd=ROOT, env=env,
                                timeout=INFRASTRUCTURE_TIMEOUT_SECONDS)
        if output.returncode and not (raw / "coded.json").is_file():
            raise RuntimeError(f"{executable} failed (exit {output.returncode})")
        return output.returncode

    def allocate_subnet(self):
        self.stack.callback(self.remove, "network", self.name)
        for _ in range(12):
            slot = randbelow(4096)
            subnet = ipaddress.IPv4Network(f"10.231.{slot // 16}.{slot % 16 * 16}/28")
            try:
                self.engine.network(self.name, str(subnet))
                return subnet
            except DockerError as error:
                if "overlap" not in str(error).lower():
                    raise
        raise RuntimeError("could not allocate a worker subnet in 10.231.0.0/16")

    def start(self):
        started = monotonic()
        with self.phase("network"):
            subnet = self.allocate_subnet()
        self.app_ip, db_ip, browser_ip, agent_ip, proxy_ip = (str(subnet[n]) for n in range(2, 7))
        pay = self.item["app"] == "pay"
        coded_source = pay and not self.agent_run
        selenium = not pay and not self.agent_run
        host, port = ("payment.test", 3000) if pay else ("webserver", 80)
        self.url = f"http://{host}" + (f":{port}" if port != 80 else "")
        browser_options = {}
        self.browser_path = f"/{uuid4().hex}"
        browser_command = ("playwright", "run-server", "--host", "0.0.0.0", "--port", "3000",
                           "--path", self.browser_path)
        io_mounts = ()
        if not selenium:
            io = Path(self.stack.enter_context(TemporaryDirectory(prefix="p2-io-")))
            self.input, self.output = io / "input", io / "output"
            self.input.mkdir(mode=0o755)
            self.output.mkdir()
            # Only the isolated output directory is exposed for writes. The
            # coded browser runs as uid 0 without DAC override.
            self.output.chmod(0o777)
            io_mounts = (self.bind(self.input, "/p2input"),
                         {"Type": "bind", "Source": str(self.output), "Target": "/p2output"})

        if selenium:
            browser_command = ("/opt/bin/entry_point.sh",)
            browser_options = {
                "aliases": ("selenium",), "shm": 2048,
                "env": ("SE_START_VNC=false", "SE_START_NO_VNC=false", "SE_BROWSER_ARGS_NO_SANDBOX=--no-sandbox"),
                "health": "curl -fsS localhost:4444/status | grep -q '\"ready\": true'",
            }
        elif coded_source:
            relay = BENCH / "runner/payment-loopback.mjs"
            browser_command = ("node", "/opt/bench/payment-loopback.mjs", self.app_ip)
            browser_options = {
                "mounts": (*io_mounts, self.bind(ROOT, "/work"), self.bind(relay, "/opt/bench/payment-loopback.mjs")),
                "health": """node -e "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)})" """.strip(),
            }
            self.url = "http://localhost:3000"

        def browser():
            with self.phase("browser_container_policy_launch"):
                name = self.container("browser", self.images["browser"], browser_ip,
                                      hosts=(f"{host}:{self.app_ip}",), cap_drop=("ALL",),
                                      command=("sleep", "infinity"), **{"shm": 512, **browser_options})
                inbound = (self.app_ip, 4444) if selenium else ((agent_ip, 3000) if self.agent_run else None)
                self.firewall(name, [(self.app_ip, port)], inbound)
                self.engine.detach(name, browser_command)
                return name

        def app():
            with self.phase("app_container"):
                return self.container("app", self.images["app"], self.app_ip, aliases=(host,))

        def db():
            with self.phase("db_container"):
                return self.container("db", self.images["db"], db_ip, aliases=("db",))

        def agent():
            with self.phase("agent_container_policy"):
                owner = Path.home() / ".codex"
                stage = Path(self.stack.enter_context(TemporaryDirectory(prefix="p2-agent-")))
                stage.chmod(0o755)
                self.stage_agent(stage)
                # The slim agent image has Node's bundled roots but no system
                # CA file. Codex's native TLS client needs the PEM bundle.
                ca = stage / "public-ca.pem"
                ca.write_text(public_ca_bundle())
                name = self.container(
                    "agent", self.images["agent"], agent_ip, cap_drop=("ALL",),
                    user=f"{os.getuid()}:{os.getgid()}", hosts=(f"browser:{browser_ip}",),
                    mounts=(self.bind(owner / "auth.json", "/home/node/.codex/auth.json"),
                            self.bind(stage, "/opt/bench/work"),
                            self.bind(ca, "/etc/ssl/certs/ca-certificates.crt"), *io_mounts),
                    env=("SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt",))
                self.firewall(name, [(browser_ip, 3000), (proxy_ip, 3128)])
                return name

        def proxy():
            with self.phase("proxy_container"):
                return self.container(
                    "proxy", self.images["agent"], proxy_ip, external=True, cap_drop=("ALL",),
                    mounts=(self.bind(BENCH / "runner/openai-proxy.mjs", "/opt/bench/proxy.mjs"),),
                    command=("node", "/opt/bench/proxy.mjs", proxy_ip, agent_ip))

        with ThreadPoolExecutor(max_workers=5) as executor:
            jobs = {"app": executor.submit(app), "browser": executor.submit(browser)}
            if not pay:
                jobs["db"] = executor.submit(db)
            if self.agent_run:
                self.proxy = f"http://{proxy_ip}:3128"
                jobs.update(agent=executor.submit(agent), proxy=executor.submit(proxy))
            names = {role: future.result() for role, future in jobs.items()}
        self.app, self.browser = names["app"], names["browser"]
        self.db, self.agent = names.get("db"), names.get("agent")
        with self.phase("readiness"):
            self.healthy(self.app, self.browser, *(name for name in (self.db, self.agent) if name))
        self.startup_ms = round((monotonic() - started) * 1000)

    def stage_agent(self, stage):
        files = ["bench/agent/run", *[f"bench/agent/{name}.mjs" for name in
                 ("answer", "browser", "browser-egress", "codex", "session")],
                 *[f"scripts/{name}.mjs" for name in
                   ("browser-policy", "browser-reload", "ui-tool-result", "infrastructure", "codex-boundary")],
                 "bench/runner/coded/pay-setup.mjs", "bench/prompt/template.md", "bench/prompt/glossary.md"]
        if self.item["app"] == "pay":
            scenario = self.item["scenario"]
            if not re.fullmatch(r"[\w-]+", scenario):
                raise ValueError("invalid payment scenario")
            feature = next((p for p in (f"bench/scenarios/pay/{scenario}.feature",
                                         f"bench/scenarios/pay/hold-out/{scenario}.feature")
                            if (ROOT / p).is_file()), None)
            if feature:
                files.append(feature)
            else:
                # The adapter selects the tagged scenario from this file.
                files.append("study/scenarios.feature")
        for path in files:
            dest = stage / path
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / path, dest)
        # Parser dependencies come from the repository's npm lock. Playwright
        # and Codex resolve via the pinned image's parent node_modules.
        for package in ("acorn", "@cucumber/gherkin", "@cucumber/messages"):
            dest = stage / "node_modules" / package
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(ROOT / "node_modules" / package, dest)
        catalog = Path.home() / ".codex/models_cache.json"
        if catalog.is_file():
            shutil.copyfile(catalog, stage / "models_cache.json")

    def setup_payment(self):
        if self.item["scenario"] not in {"hold-06", "hold-07"}:
            return
        script = ROOT / "bench/runner/coded/pay-setup.mjs"
        name = f"{self.name}-setup"
        self.stack.callback(self.remove, "container", name)
        docker("run", "--rm", "--pull=never", "--name", name, "--cap-drop=ALL",
               "--label", f"mipro.p2={self.name}", "-e", "BENCH_PAY_API_URL=http://127.0.0.1:3001",
               "--network", f"container:{self.app}", "--mount",
               f"type=bind,src={script},dst=/opt/bench/pay-setup.mjs,readonly", self.images["browser"],
               "node", "--input-type=module", "-e",
               "import { setupPayment } from './pay-setup.mjs'; await setupPayment(process.argv[1])",
               self.item["scenario"], timeout=35)

    def run(self, raw):
        agent = self.agent_run
        env = [f"BENCH_APP_URL={self.url}"]
        pay = self.item["app"] == "pay"
        with self.phase("seeding"):
            if pay:
                self.setup_payment()
                env.append("BENCH_PAY_PREPARED=1")
            elif agent:
                self.local("node", raw, BENCH / "runner/moodle/prepare-pinned.mjs",
                           self.app, raw / "item.json", raw)
                shutil.copyfile(raw / "agent-scenario.feature", self.input / "scenario.feature")
                env.append("BENCH_SCENARIO_FILE=/p2input/scenario.feature")
        if not pay and not agent:
            with self.phase("adapter"):
                return self.local(str(BENCH / "runner/coded-run"), raw, "--item", raw / "item.json",
                                  "--out", raw, env={**os.environ, "BENCH_MOODLE_WEB": self.app})
        if agent:
            env.extend([f"BENCH_BROWSER_WS=ws://browser:3000{self.browser_path}",
                        "BENCH_AGENT_CONTAINER=1", f"HTTPS_PROXY={self.proxy}",
                        f"HTTP_PROXY={self.proxy}", "NO_PROXY=127.0.0.1,localhost,browser"])
            container, repo, executable = self.agent, "/opt/bench/work", "bench/agent/run"
        else:
            container, repo, executable = self.browser, "/work", "bench/runner/coded-run"
        shutil.copyfile(raw / "item.json", self.input / "item.json")
        timeout = (AGENT_LIMIT_SECONDS + AGENT_HOST_MARGIN_SECONDS
                   if agent else INFRASTRUCTURE_TIMEOUT_SECONDS)
        try:
            with self.phase("adapter"):
                flags = [flag for entry in env for flag in ("-e", entry)]
                result = docker("exec", *flags, "-w", repo, container, "node", executable,
                                "--item", "/p2input/item.json", "--out", "/p2output",
                                timeout=timeout, check=False)
        except subprocess.TimeoutExpired as error:
            # Killing the docker client does not necessarily stop the contained exec.
            self.remove("container", container)
            if agent:
                raise AgentTimeout(f"agent exceeded the {timeout:g}s host watchdog") from error
            raise
        finally:
            for output in self.output.iterdir():
                if not output.is_file() or output.is_symlink():
                    raise RuntimeError("adapter output must be a regular file")
                with output.open("rb") as source, (raw / output.name).open("xb") as dest:
                    shutil.copyfileobj(source, dest)
        return result.returncode
