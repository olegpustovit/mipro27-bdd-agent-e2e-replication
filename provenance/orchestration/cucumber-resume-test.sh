#!/bin/bash
# Excluded test: kill the runner hard mid-campaign, resume, check nothing is lost or rerun.
cd "$HOME/projects/cucumber-mcp-study" || exit 1
ID=excluded-resume-test-$(date +%H%M)
DIR=$HOME/.local/share/cucumber-study/runs/$ID
P=/tmp/cucumber-study-progress.log
rm -f "$P"
node scripts/exploratory-runner.mjs --campaign-id "$ID" > /tmp/resume-a.out 2>&1 &
PID=$!
until [ "$(grep -c ' recorded$' "$P" 2>/dev/null || echo 0)" -ge 2 ] && grep -q ' started$' <(tail -1 "$P"); do read -t 1 < <(tail -f /dev/null); kill -0 $PID 2>/dev/null || break; done
echo "before kill:"; cut -d' ' -f2- "$P"
pkill -9 -P $PID 2>/dev/null; kill -9 $PID 2>/dev/null; wait $PID 2>/dev/null
for p in $(pgrep -f '[c]odex exec|/[c]odex exec'); do sudo -n kill -9 "$p" 2>/dev/null; done
rm -f /tmp/cucumber-mcp-study-exclusive.lock
read -t 5 < <(tail -f /dev/null)
node scripts/exploratory-runner.mjs --resume "$ID" > /tmp/resume-b.out 2>&1 &
PID=$!
N=$(wc -l < "$P")
until [ "$(wc -l < "$P")" -ge $((N+4)) ]; do read -t 1 < <(tail -f /dev/null); kill -0 $PID 2>/dev/null || break; done
pkill -9 -P $PID 2>/dev/null; kill -9 $PID 2>/dev/null; wait $PID 2>/dev/null
for p in $(pgrep -f '[c]odex exec|/[c]odex exec'); do sudo -n kill -9 "$p" 2>/dev/null; done
rm -f /tmp/cucumber-mcp-study-exclusive.lock
echo "after resume:"; cut -d' ' -f2- "$P"
echo "--- repeated starts (must be none):"; grep ' started$' "$P" | cut -d' ' -f2 | sort | uniq -d
echo "--- journal types:"; jq -r '.type + " " + (.result // "") + " " + ((.reconciled // "")|tostring)' "$DIR/journal.jsonl" | sort | uniq -c
echo "--- errors:"; tail -3 /tmp/resume-a.out | cut -c1-200; tail -3 /tmp/resume-b.out | cut -c1-200
mkdir -p "$HOME/.local/share/cucumber-study/excluded"; mv "$DIR" "$HOME/.local/share/cucumber-study/excluded/"
cp "$P" "$HOME/.local/share/cucumber-study/excluded/$ID-progress.log"; rm -f "$P"
node scripts/reset.mjs >/dev/null 2>&1; echo reset_exit=$?

