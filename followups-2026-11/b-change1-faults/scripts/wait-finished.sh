#!/usr/bin/env bash
# Wait until campaign $1 has at least $2 trial-finished lines or the launcher logged its end.
j=~/.local/share/cucumber-study/runs/$1/journal.jsonl
log="$(dirname "$0")/../data/logs/campaigns.log"
while :; do
  n=0; [ -f "$j" ] && n=$(grep -c '"trial-finished"' "$j")
  grep -q "end $1" "$log" && break
  [ "$n" -ge "$2" ] && break
  sleep 20
done
echo "$(date -u +%FT%TZ) $1 finished=$n"
