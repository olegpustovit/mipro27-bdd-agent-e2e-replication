#!/bin/bash
# One status line per minute. Also keeps a dashboard file the owner can watch directly.
C=/tmp/claude-501/-<home>-agents-researcher/60a06e62-f1e8-4a87-9d99-9000adbb9c32/scratchpad/codex
D=/tmp/cucumber-study-dashboard.txt
while true; do
  done_n=0; [ -f /tmp/cucumber-study-progress.log ] && done_n=$(grep -c . /tmp/cucumber-study-progress.log)
  last=$( [ -f /tmp/cucumber-study-progress.log ] && tail -1 /tmp/cucumber-study-progress.log | cut -c1-70 )
  alive=$(pgrep -fc '[-]m gpt-5.6-terra --skip-git-repo-check')
  quiet=$(( $(date +%s) - $(stat -c %Y "$C/exp.jsonl" 2>/dev/null || echo 0) ))
  st=$(tail -1 /tmp/cucumber-study-status.log 2>/dev/null | cut -c1-150)
  msg=$(jq -r 'select(.type=="item.completed" and .item.type=="agent_message")|.item.text' "$C/exp.jsonl" 2>/dev/null | tail -1 | tr '\n' ' ' | cut -c1-170)
  flag=""; [ "$alive" -eq 0 ] && flag=" WORKER_NOT_RUNNING"; [ "$quiet" -gt 900 ] && flag="$flag QUIET_${quiet}s"
  grep -q CODEX_BLOCKED /tmp/cucumber-study-status.log 2>/dev/null && flag="$flag CODEX_BLOCKED"
  line="$(date -u +%H:%M) runs $done_n/120${last:+ last: $last} | $st | $msg$flag"
  echo "$line"
  { echo "Updated $(date -u +%H:%M:%S) UTC"; echo "Runs lines logged: $done_n of 120"; echo "Last run: ${last:-none}"; echo "Worker running: $alive  Quiet: ${quiet}s  $flag"; echo; echo "Status log:"; tail -8 /tmp/cucumber-study-status.log 2>/dev/null | cut -c1-200; echo; echo "Worker says: $msg"; } > "$D.tmp" && mv "$D.tmp" "$D"
  read -t 60 < <(tail -f /dev/null)
done

