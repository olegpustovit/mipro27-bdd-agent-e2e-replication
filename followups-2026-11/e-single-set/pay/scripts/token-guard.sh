#!/usr/bin/env bash
# Stream E-pay token guard (runs beside the launcher): once measured agent tokens exceed 70M, write logs/STOP (the
# launcher then starts no further campaign) and stop the running agent campaign right after its current trial has
# finished (SIGTERM when the journal's last line is trial-finished). Exits when the launcher has logged its last end.
here=$(cd "$(dirname "$0")/.." && pwd); cd "$here"
log=logs/campaigns.log
while :; do
  used=$(uv run --quiet scripts/token_total.py 2>/dev/null || echo 0)
  if [ "$used" -gt 70000000 ]; then
    [ -e logs/STOP ] || { touch logs/STOP; echo "$(date -u +%FT%TZ) token guard: $used > 70M, STOP written" >> "$log"; }
    pid=$(pgrep -f 'node scripts/run-single-pay.mjs --campaign-id campaign-h-20261127-single-(luna|terra|haiku)')
    if [ -n "$pid" ]; then
      id=$(tr '\0' ' ' < /proc/$pid/cmdline | sed -E 's/.*--campaign-id ([^ ]+).*/\1/')
      j=~/.local/share/cucumber-study/runs/$id/journal.jsonl
      if tail -n1 "$j" | grep -q '"trial-finished"'; then kill -TERM "$pid"; echo "$(date -u +%FT%TZ) token guard: SIGTERM $id after a finished trial" >> "$log"; fi
      sleep 1; continue
    fi
  fi
  grep -q 'end campaign-h-20261127-single-haiku\|skip ' "$log" 2>/dev/null && exit 0
  sleep 15
done
