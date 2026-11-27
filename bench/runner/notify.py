"""Host-only Telegram delivery."""
import json
import re
import shlex
import urllib.request
from pathlib import Path

VARIABLE = re.compile(r"\s*(?:export\s+)?(TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID)=(.*)")


def send(text, sink):
    if sink is not None:
        with sink.open("a", encoding="utf-8") as output:
            output.write(json.dumps({"text": text}) + "\n")
        return
    try:
        values = {}
        for line in (Path.home() / "projects/researcher/.envrc").read_text().splitlines():
            match = VARIABLE.fullmatch(line)
            if match:
                name, assignment = match.groups()
                value, = shlex.split(assignment, comments=True)
                values[name] = value
        token = values["TELEGRAM_BOT_TOKEN"]
        chat = values["TELEGRAM_CHAT_ID"]
        if not re.fullmatch(r"[0-9]+:[A-Za-z0-9_-]+", token):
            raise ValueError
        request = urllib.request.Request(
            f"https://api.telegram.org/bot{token}/sendMessage",
            data=json.dumps({"chat_id": chat, "text": text}).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=15) as response:
            if json.load(response).get("ok") is not True:
                raise ValueError
    except (KeyError, ValueError, OSError):
        raise RuntimeError("Telegram delivery failed; check the host credentials and connectivity") from None
