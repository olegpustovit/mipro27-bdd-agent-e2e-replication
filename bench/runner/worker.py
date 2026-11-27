"""One fresh Docker environment per P3 attempt."""

from contextlib import ExitStack
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

BENCH = Path(__file__).resolve().parents[1]
ROOT = BENCH.parent
DEFAULT_WORKERS = 2
def docker(*args, timeout=30, check=True, input=None):
    result = subprocess.run(["docker", *map(str, args)], text=True, input=input,
                            stdin=subprocess.DEVNULL if input is None else None,
                            capture_output=True, check=False, timeout=timeout)
    if check and result.returncode:
        raise RuntimeError(f"docker {args[0]} failed ({result.returncode}): {result.stderr.strip()}")
    return result


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
        key = db_key if healthy else item["bugId"].lower()
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
        self.agent_run = agent
        self.item = item
        self.images = pins_for(item, pins, agent)
        if item["app"] == "mdl" and not agent:
            selenium = json.loads((ROOT / "docker/moodle/versions.json").read_text())["images"]["selenium"]
            self.images["browser"] = docker("image", "inspect", "-f", "{{.Id}}", selenium).stdout.strip()
        self.name = f"p2-{uuid4().hex[:16]}"
        self.stack = ExitStack()
        self.startup_ms = None
        self.teardown_ms = None
        self.deadline = monotonic() + 300

    def __enter__(self):
        return self

    def __exit__(self, *_):
        started = monotonic()
        try:
            self.stack.close()
        finally:
            self.teardown_ms = round((monotonic() - started) * 1000)

    def container(self, role, image, options=(), command=()):
        name = f"{self.name}-{role}"
        # Register cleanup first so a daemon reply lost after creation is safe.
        self.stack.callback(self.remove, "container", name)
        docker("create", "--pull=never", "--name", name, "--label", f"mipro.p2={self.name}",
               "--network", self.name, "--security-opt", "no-new-privileges", *options, image, *command)
        docker("start", name)
        return name

    @staticmethod
    def remove(kind, name):
        args = ("-f", "-v") if kind == "container" else ()
        for _ in range(3):
            result = docker(kind, "rm", *args, name, check=False)
            if not result.returncode or "No such" in result.stderr or "not found" in result.stderr:
                return
            sleep(0.25)
        raise RuntimeError(f"could not remove {kind} {name}: {result.stderr.strip()}")

    @staticmethod
    def addr(name):
        output = docker("inspect", "-f", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}", name)
        return str(ipaddress.IPv4Address(output.stdout.strip()))

    @staticmethod
    def firewall(name, peers, inbound=None):
        pid = int(docker("inspect", "-f", "{{.State.Pid}}", name).stdout)
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

    def healthy(self, name):
        deadline = min(self.deadline, monotonic() + 90)
        while monotonic() < deadline:
            state = json.loads(docker("inspect", "-f", "{{json .State}}", name).stdout)
            if not state["Running"]:
                break
            if state["Health"]["Status"] == "healthy":
                return
            sleep(0.25)
        raise RuntimeError(f"{name} did not become healthy")

    def local(self, executable, raw, *args, env=None):
        output = subprocess.run([executable, *map(str, args)], stdin=subprocess.DEVNULL,
                                capture_output=True, text=True, cwd=ROOT, env=env,
                                timeout=max(1, self.deadline - monotonic()))
        if output.returncode and not (raw / "coded.json").is_file():
            raise RuntimeError(f"{executable} failed (exit {output.returncode})")
        return output.returncode

    def start(self):
        started = monotonic()
        self.stack.callback(self.remove, "network", self.name)
        for _ in range(12):
            slot = randbelow(4096)
            subnet = f"10.231.{slot // 16}.{slot % 16 * 16}/28"
            result = docker("network", "create", "--internal", "--subnet", subnet,
                            "--label", f"mipro.p2={self.name}", self.name, check=False)
            if result.returncode == 0:
                break
            if "overlap" not in result.stderr.lower():
                raise RuntimeError(result.stderr.strip())
        else:
            raise RuntimeError("could not allocate a worker subnet in 10.231.0.0/16")
        pay = self.item["app"] == "pay"
        coded_source = pay and not self.agent_run
        if not pay:
            self.db = self.container("db", self.images["db"], ("--network-alias", "db"))
        host, port = ("payment.test", 3000) if pay else ("webserver", 80)
        self.app = self.container("app", self.images["app"], ("--network-alias", host))
        self.app_ip = self.addr(self.app)
        self.url = f"http://{host}" + (f":{port}" if port != 80 else "")
        mount = ("--mount", f"type=bind,src={ROOT},dst=/work,readonly") if coded_source else ()
        selenium = not pay and not self.images["agent"]
        browser_options = ("--network-alias", "selenium", "-e", "SE_START_VNC=false",
                           "-e", "SE_START_NO_VNC=false", "-e", "SE_BROWSER_ARGS_NO_SANDBOX=--no-sandbox") if selenium else ()
        if selenium:
            browser_options += ("--health-cmd", "curl -fsS localhost:4444/status | grep -q '\"ready\": true'",
                                "--health-interval", "1s", "--health-retries", "60")
        if coded_source:
            relay = BENCH / "runner/payment-loopback.mjs"
            browser_options += (
                "--mount", f"type=bind,src={relay},dst=/opt/bench/payment-loopback.mjs,readonly",
                "--health-cmd", "node -e \"fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)})\"",
                "--health-interval", "1s", "--health-retries", "60",
            )
            self.url = "http://localhost:3000"
        shm = "2g" if selenium else "512m"
        self.browser = self.container(
            "browser", self.images["browser"],
            ("--cap-drop=ALL", f"--shm-size={shm}", "--health-start-period", "90s", "--add-host", f"{host}:{self.app_ip}", *mount, *browser_options),
            ("sleep", "infinity"))
        browser_ip = self.addr(self.browser)
        agent_ip = None
        if self.images["agent"]:
            owner = Path.home() / ".codex"
            auth = owner / "auth.json"
            stage = Path(self.stack.enter_context(TemporaryDirectory(prefix="p2-agent-")))
            stage.chmod(0o755)
            self.stage_agent(stage)
            self.agent = self.container(
                "agent", self.images["agent"], (
                    "--cap-drop=ALL", "--user", f"{os.getuid()}:{os.getgid()}",
                    "--add-host", f"browser:{browser_ip}", "--mount",
                    f"type=bind,src={auth},dst=/home/node/.codex/auth.json,readonly",
                    "--mount", f"type=bind,src={stage},dst=/opt/bench/work,readonly"))
            agent_ip = self.addr(self.agent)
            proxy_code = BENCH / "runner/openai-proxy.mjs"
            relay = self.container("proxy", self.images["agent"], (
                "--cap-drop=ALL", "--mount", f"type=bind,src={proxy_code},dst=/opt/bench/proxy.mjs,readonly"))
            proxy_ip = self.addr(relay)
            docker("network", "connect", "bridge", relay)
            docker("exec", "-d", relay, "node", "/opt/bench/proxy.mjs", proxy_ip, agent_ip)
            self.proxy = f"http://{proxy_ip}:3128"
            self.firewall(self.agent, [(browser_ip, 3000), (proxy_ip, 3128)])
        inbound = (self.app_ip, 4444) if selenium else ((agent_ip, 3000) if agent_ip else None)
        self.firewall(self.browser, [(self.app_ip, port)], inbound)
        if selenium:
            browser_command = ("/opt/bin/entry_point.sh",)
        elif coded_source:
            browser_command = ("node", "/opt/bench/payment-loopback.mjs", self.app_ip)
        else:
            browser_command = ("playwright", "run-server", "--host", "0.0.0.0", "--port", "3000")
        docker("exec", "-d", self.browser, *browser_command)
        if not pay:
            self.healthy(self.db)
        self.healthy(self.app)
        self.healthy(self.browser)
        if agent_ip:
            self.healthy(self.agent)
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
        env = ["-e", f"BENCH_APP_URL={self.url}"]
        pay = self.item["app"] == "pay"
        if pay:
            self.setup_payment()
            env += ["-e", "BENCH_PAY_PREPARED=1"]
        elif not agent:
            return self.local(str(BENCH / "runner/coded-run"), raw, "--item", raw / "item.json",
                              "--out", raw, env={**os.environ, "BENCH_MOODLE_WEB": self.app})
        if agent:
            endpoint = json.loads(docker("exec", self.browser, "node", "-e",
                                         "fetch('http://127.0.0.1:3000/json').then(r=>r.text()).then(console.log)").stdout)
            env += ["-e", f"BENCH_BROWSER_WS=ws://browser:3000{endpoint['wsEndpointPath']}",
                    "-e", "BENCH_AGENT_CONTAINER=1", "-e", f"HTTPS_PROXY={self.proxy}",
                    "-e", f"HTTP_PROXY={self.proxy}", "-e", "NO_PROXY=127.0.0.1,localhost,browser"]
            container, repo, executable = self.agent, "/opt/bench/work", "bench/agent/run"
        else:
            container, repo, executable = self.browser, "/work", "bench/runner/coded-run"
        self.copy_in(raw / "item.json", container, "/tmp/item.json")
        if agent and not pay:
            self.local("node", raw, BENCH / "runner/moodle/prepare-pinned.mjs",
                       self.app, raw / "item.json", raw)
            self.copy_in(raw / "agent-scenario.feature", container, "/tmp/scenario.feature")
            docker("exec", "-u", "0", container, "chmod", "444", "/tmp/scenario.feature")
            env += ["-e", "BENCH_SCENARIO_FILE=/tmp/scenario.feature"]
        docker("exec", container, "mkdir", "-m", "700", "/tmp/out")
        result = docker("exec", *env, "-w", repo, container, "node", executable,
                        "--item", "/tmp/item.json", "--out", "/tmp/out",
                        timeout=max(1, self.deadline - monotonic()), check=False)
        docker("cp", f"{container}:/tmp/out/.", raw)
        return result.returncode

    @staticmethod
    def copy_in(src, container, dst):
        docker("cp", src, f"{container}:{dst}")
