#!/bin/bash
C=/tmp/claude-501/-<home>-agents-researcher/60a06e62-f1e8-4a87-9d99-9000adbb9c32/scratchpad/codex
B=campaign-b-20261101-02f4758
D=$HOME/.local/share/cucumber-study/runs/$B
A=$HOME/.local/share/cucumber-study/runs/campaign-20261101-04d8551
sed "s/CAMPAIGN_ID/$B/g" "$C/brief-adjudicate.md" | sed 's#/tmp/cucumber-study-adjudication.md#/tmp/cucumber-study-adjudication-b.md#' > "$C/brief-adjb.md"
printf '\nThis is campaign B: 108 runtime-arm trials only, after `browser_reload` was corrected to wait for page data. You have not seen and must not read campaign A.\n' >> "$C/brief-adjb.md"
cd "$HOME/agents/researcher" || exit 1
nohup agentpack --yolo codex --no-daemon exec -m gpt-5.6-terra -c 'model_reasoning_effort="high"' --skip-git-repo-check -C "$HOME/projects/cucumber-mcp-study" --add-dir /tmp --add-dir "$HOME/.local/share/cucumber-study" --json -o "$C/adjb-final.txt" - < "$C/brief-adjb.md" > "$C/adjb.jsonl" 2> "$C/adjb.err" &
disown
echo "$(date -u +%FT%TZ) campaign B complete 108/108; independent adjudication running on Terra" >> /tmp/cucumber-study-status.log
mv /tmp/cucumber-study-progress.log "$D/progress.log"
node "$C/analyze.mjs" "$D" 2>&1 | cut -c1-300

