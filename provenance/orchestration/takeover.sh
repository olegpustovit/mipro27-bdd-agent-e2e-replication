#!/bin/bash
for p in $(pgrep -f '[-]m gpt-5.6-terra --skip-git-repo-check'); do kill "$p" 2>/dev/null; done
read -t 3 < <(tail -f /dev/null)
echo "workers left: $(pgrep -fc '[-]m gpt-5.6-terra --skip-git-repo-check')"
echo "$(date -u +%FT%TZ) Claude took over setup directly at owner's request; Codex setup worker stopped; Luna agents still run the experiments" >> /tmp/cucumber-study-status.log
cd "$HOME/projects/cucumber-mcp-study" || exit 1
git status --short | cut -c1-70
git log -4 --format='%h %s' | cut -c1-90
git diff --stat HEAD | tail -12 | cut -c1-80
echo '--- boundary'; cat scripts/codex-boundary.mjs | cut -c1-200
echo '--- bridge'; wc -l scripts/mcp-http-bridge.mjs
echo '--- agent-session'; cat scripts/agent-session.mjs | cut -c1-260
echo '--- smoke'; ls -la --time-style=+%H:%M /tmp/cucumber-codex-smoke.* /tmp/cucumber-luna-isolation.json | cut -c28-
cut -c1-800 /tmp/cucumber-codex-smoke.mjs | head -40
tail -c 700 /tmp/cucumber-codex-smoke.stderr
jq -r 'select(.type=="item.completed")|"\(.item.type) \((.item.server//"") ) \((.item.tool//.item.text//"")|tostring|.[0:100])"' /tmp/cucumber-codex-smoke.jsonl 2>/dev/null | tail -12
jq -c 'select(.type=="turn.completed")|.usage' /tmp/cucumber-codex-smoke.jsonl 2>/dev/null | tail -1
echo '--- app'; systemctl --user list-units --no-pager 2>/dev/null | grep -i -E 'cucumber|fixture|study' | cut -c1-110; curl -s -m 3 -o /dev/null -w 'ui %{http_code}\n' http://127.0.0.1:3000; curl -s -m 3 -o /dev/null -w 'api %{http_code}\n' http://127.0.0.1:3001/

