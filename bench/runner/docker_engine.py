"""Use the local Docker Engine socket without launching a CLI for each probe."""

from dataclasses import dataclass
import http.client
import json
import os
import socket
import struct
from urllib.parse import quote, urlencode


@dataclass
class ExecResult:
    returncode: int
    stdout: str
    stderr: str


class DockerError(RuntimeError):
    def __init__(self, status, message):
        self.status = status
        super().__init__(f"Docker returned {status}: {message}")


class UnixConnection(http.client.HTTPConnection):
    def __init__(self, path, timeout):
        super().__init__("localhost", timeout=timeout)
        self.path = path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(self.path)


class DockerEngine:
    def __init__(self):
        endpoint = os.environ.get("DOCKER_HOST", "unix:///var/run/docker.sock")
        if not endpoint.startswith("unix://"):
            raise ValueError("The worker requires a local Docker Unix socket for namespace policy")
        self.path = endpoint.removeprefix("unix://")

    def request(self, method, path, body=None, *, timeout=30, stream=False):
        conn = UnixConnection(self.path, timeout)
        try:
            data = None if body is None else json.dumps(body)
            conn.request(method, path, body=data, headers={"Content-Type": "application/json"})
            response = conn.getresponse()
            raw = response.read()
            if response.status >= 400:
                raise DockerError(response.status, json.loads(raw)["message"])
            return raw if stream else (json.loads(raw) if raw else None)
        finally:
            conn.close()

    def network(self, name, subnet):
        return self.request("POST", "/networks/create", {
            "Name": name, "Driver": "bridge", "Internal": True,
            "Labels": {"mipro.p2": name}, "IPAM": {"Config": [{"Subnet": subnet}]},
        })

    def create(self, name, config):
        return self.request("POST", "/containers/create?" + urlencode({"name": name}), config)

    def inspect(self, name):
        return self.request("GET", f"/containers/{name}/json")

    def image(self, ref):
        return self.request("GET", f"/images/{quote(ref, safe='')}/json")["Id"]

    def start(self, name):
        self.request("POST", f"/containers/{name}/start")

    def detach(self, name, command):
        exec_id = self.request("POST", f"/containers/{name}/exec", {"Cmd": list(command)})["Id"]
        self.request("POST", f"/exec/{exec_id}/start", {"Detach": True})

    def execute(self, name, command, *, env=(), timeout=30, check=True):
        exec_id = self.request("POST", f"/containers/{name}/exec", {
            "Cmd": list(command), "Env": list(env),
            "AttachStdout": True, "AttachStderr": True,
        })["Id"]
        payload = self.request("POST", f"/exec/{exec_id}/start", {"Detach": False, "Tty": False},
                               timeout=timeout, stream=True)
        channels = {1: bytearray(), 2: bytearray()}
        cursor = 0
        while cursor < len(payload):
            stream, size = struct.unpack_from("!BxxxI", payload, cursor)
            cursor += 8
            if stream in channels:
                channels[stream].extend(payload[cursor:cursor + size])
            cursor += size
        status = self.request("GET", f"/exec/{exec_id}/json")["ExitCode"]
        result = ExecResult(status, *(channels[n].decode(errors="replace") for n in (1, 2)))
        if check and status != 0:
            raise RuntimeError(f"container command failed ({status}): {result.stderr.strip()}")
        return result

    def remove(self, kind, name):
        path = f"/containers/{name}?force=1&v=1" if kind == "container" else f"/networks/{name}"
        try:
            self.request("DELETE", path)
        except DockerError as error:
            if error.status != 404:
                raise
