"""Canonical attempt records and raw artifact integrity."""
import fcntl
import hashlib
import json
import os
import re
from collections import defaultdict
from contextlib import contextmanager
from pathlib import Path

ZERO = "0" * 64
ITEM_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]*")


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
                      allow_nan=False).encode("utf-8")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def file_digest(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def raw_digest(directory):
    if directory.is_symlink() or not directory.is_dir():
        raise ValueError(f"invalid raw directory {directory}")
    manifest = {}
    for path in sorted(directory.rglob("*")):
        if path.is_symlink() or not (path.is_file() or path.is_dir()):
            raise ValueError(f"unsupported raw artifact {path}")
        manifest[path.relative_to(directory).as_posix()] = (
            None if path.is_dir() else file_digest(path)
        )
    return digest(canonical(manifest))


@contextmanager
def locked(directory, *, exclusive=False):
    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH)
        yield
    finally:
        os.close(fd)


class Ledger:
    def __init__(self, directory):
        self.directory = directory
        self.path = directory / "attempts.jsonl"
        self.history = defaultdict(list)
        self.head = ZERO
        self.count = 0
        if self.path.is_symlink():
            raise ValueError("ledger is a symlink")
        with self.path.open("rb") as source:
            for number, line in enumerate(source, 1):
                try:
                    self.verify_line(line)
                except (ValueError, KeyError, TypeError, AttributeError, OSError) as error:
                    raise ValueError(f"ledger line {number}: {error}") from error

        self.verify_raw_inventory()

    def verify_raw_inventory(self):
        root = self.directory / "raw"
        if root.is_symlink():
            raise ValueError("raw root is a symlink")
        if not root.exists():
            return
        for item in root.iterdir():
            if item.name == ".gitkeep" and item.is_file() and not item.is_symlink():
                continue
            if item.is_symlink() or not item.is_dir():
                raise ValueError(f"unexpected raw artifact {item.name}")
            expected = {str(row["attempt"]) for row in self.history.get(item.name, [])}
            if {entry.name for entry in item.iterdir()} != expected:
                raise ValueError(f"raw attempt inventory differs from ledger for {item.name}")

    def verify_line(self, line):
        record = json.loads(line)
        if line != canonical(record) + b"\n":
            raise ValueError("record bytes are not canonical")
        claimed = record.pop("record_sha256")
        if record["prev_record_sha256"] != self.head or digest(canonical(record)) != claimed:
            raise ValueError("record hash or previous hash mismatch")
        item = record["item_id"]
        if not isinstance(item, str) or not ITEM_ID.fullmatch(item):
            raise ValueError("invalid item ID")
        attempt = len(self.history[item]) + 1
        expected = Path("raw") / item / str(attempt)
        if type(record["attempt"]) is not int or record["attempt"] != attempt or record["raw_dir"] != expected.as_posix():
            raise ValueError("unexpected attempt number or raw path")
        if any((self.directory / parent).is_symlink() for parent in expected.parents):
            raise ValueError("symlink in raw path")
        if raw_digest(self.directory / expected) != record["trace_sha256"]:
            raise ValueError(f"raw artifact hash mismatch for {expected}")
        record["record_sha256"] = claimed
        self.remember(record)

    def remember(self, record):
        self.head = record["record_sha256"]
        self.history[record["item_id"]].append(record)
        self.count += 1

    def allocate(self, item):
        attempt = len(self.history[item]) + 1
        relative = Path("raw") / item / str(attempt)
        destination = self.directory / relative
        if any((self.directory / parent).is_symlink() for parent in relative.parents):
            raise ValueError("symlink in raw path")
        destination.mkdir(parents=True, exist_ok=False)
        return attempt, destination

    def append(self, record, raw):
        record.update(raw_dir=raw.relative_to(self.directory).as_posix(),
                      trace_sha256=raw_digest(raw), prev_record_sha256=self.head)
        record["record_sha256"] = digest(canonical(record))
        with self.path.open("ab") as output:
            output.write(canonical(record) + b"\n")
            output.flush()
            os.fsync(output.fileno())
        self.remember(record)
