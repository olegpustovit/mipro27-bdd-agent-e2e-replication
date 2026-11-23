#!/bin/bash
# One status line per minute, only about the real campaign. Also keeps a dashboard file.
D=/tmp/cucumber-study-dashboard.txt
P=/tmp/cucumber-study-progress.log
while true; do
  started=0; finished=0; invalid=0; last=""
  if [ -f "$P" ]; then
    started=$(grep -c ' started$' "$P"); finished=$(grep -c -E ' (recorded|infrastructure-invalid)$' "$P"); invalid=$(grep -c ' infrastructure-invalid$' "$P")
    last=$(tail -1 "$P" | cut -d' ' -f2- | cut -c1-60)
  fi
  running=$(pgrep -fc '[e]xploratory-runner.mjs')
  st=$(tail -1 /tmp/cucumber-study-status.log 2>/dev/null | cut -c1-140)
  flag=""
  if [ "$started" -gt 0 ] && [ "$running" -eq 0 ] && ! grep -q 'complete$' /tmp/cucumber-study-status.log; then flag=" CAMPAIGN_NOT_RUNNING"; fi
  if [ -f "$P" ] && [ "$running" -gt 0 ]; then age=$(( $(date +%s) - $(stat -c %Y "$P") )); [ "$age" -gt 600 ] && flag="$flag QUIET_${age}s"; fi
  line="$(date -u +%H:%M) runs $finished/216 invalid $invalid${last:+ | $last} | $st$flag"
  echo "$line"
  { echo "Updated $(date -u +%H:%M:%S) UTC"; echo "Runs finished: $finished of 216 ($(( finished * 100 / 216 ))%)  invalid: $invalid  runner alive: $running $flag"; echo "Last: ${last:-none}"; echo; echo "Status log:"; tail -8 /tmp/cucumber-study-status.log 2>/dev/null | cut -c1-200; } > "$D.tmp" && mv "$D.tmp" "$D"
  read -t 60 < <(tail -f /dev/null)
done

