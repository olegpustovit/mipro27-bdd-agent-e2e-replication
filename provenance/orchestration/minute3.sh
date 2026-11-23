#!/bin/bash
# One status line per minute for campaign B (108 runtime runs).
D=/tmp/cucumber-study-dashboard.txt
P=/tmp/cucumber-study-progress.log
while true; do
  finished=0; invalid=0; last=""
  if [ -f "$P" ]; then
    finished=$(grep -c -E ' (recorded|infrastructure-invalid)$' "$P"); invalid=$(grep -c ' infrastructure-invalid$' "$P"); last=$(tail -1 "$P" | cut -d' ' -f2- | cut -c1-60)
  fi
  active=$(systemctl --user is-active cucumber-campaign-b 2>/dev/null)
  flag=""; [ "$active" != "active" ] && flag=" SERVICE_$active"
  echo "$(date -u +%H:%M) campaign B runs $finished/108 invalid $invalid${last:+ | $last}$flag"
  { echo "Updated $(date -u +%H:%M:%S) UTC"; echo "Campaign B: $finished of 108 ($(( finished * 100 / 108 ))%)  invalid: $invalid  service: $active"; echo "Last: ${last:-none}"; echo; tail -6 /tmp/cucumber-study-status.log | cut -c1-200; } > "$D.tmp" && mv "$D.tmp" "$D"
  [ "$active" != "active" ] && [ "$finished" -gt 0 ] && exit 0
  read -t 60 < <(tail -f /dev/null)
done

