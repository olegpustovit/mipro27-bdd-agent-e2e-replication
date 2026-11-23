#!/bin/bash
C=/tmp/claude-501/-<home>-agents-researcher/60a06e62-f1e8-4a87-9d99-9000adbb9c32/scratchpad/codex
# Stop watchers and any worker still running. Patterns are bracketed; this file is not in their argv.
for p in $(pgrep -f 'codex/[w]atch.sh'); do [ "$p" != "$$" ] && kill "$p" 2>/dev/null; done
for p in $(pgrep -f '[-]m gpt-5.6-terra --skip-git-repo-check'); do [ "$p" != "$$" ] && kill "$p" 2>/dev/null; done
read -t 3 < <(tail -f /dev/null)
echo "workers left: $(pgrep -fc '[-]m gpt-5.6-terra --skip-git-repo-check')"
cd "$HOME/projects/cucumber-mcp-study" || exit 1
if ! grep -q 'Owner decision, 2026-11-01' AGENTS.md; then cat >> AGENTS.md <<'E'

Owner decision, 2026-11-01: run the measured campaign today in `exploratory-owner-directed` mode even though the
Evidence gate is STOP ("please complete finish experiment ... we are submitting today ... this is critical"). This is
an owner decision, not a gate pass. The gate verdict stays as recorded and must not be edited, forged or bypassed in
`verifyApproval`. Every result records `status: exploratory-owner-directed` and `gatePassExists: false`, and any report
of these results says they were run without a gate pass. All other rules in this file still apply. The normal
approved campaign path stays disabled.
E
fi
cat > "$C/brief-experiment-4.md" <<'E'
You are the relaunched worker, on gpt-5.6-terra. Your predecessor concluded it would not launch because the Evidence gate is STOP and the repo rule forbids a campaign before the gate. That conclusion is now out of date.

THE OWNER HAS DECIDED: run the measured campaign today in exploratory-owner-directed mode. See the owner decision at the end of ~/projects/cucumber-mcp-study/AGENTS.md and the verified owner-instruction facts on piece `mipro27-bdd-agent-e2e`. This is the owner's call on his own study. It is not a gate pass:
- Do not edit, forge or satisfy the gate verdict, gate policy or `verifyApproval`. Add a separate explicit mode beside the disabled approved path.
- Foundry's `next_action` will keep saying blocked, and that is correct. Do not treat it as a reason to stop, and do not try to submit the gate as passed.
- Every record carries `status: exploratory-owner-directed` and `gatePassExists: false`.
- Fix what would make results wrong. Name what stays open. Run.

Commit the uncommitted work in the tree first (Luna pins, boundary, `mcp-http-bridge`), after reading `git diff`.

Then follow, in order: /tmp/claude-501/-<home>-agents-researcher/60a06e62-f1e8-4a87-9d99-9000adbb9c32/scratchpad/codex/brief-experiment-3.md (models), brief-experiment-2.md (boundary, resume, tracking, analyses) and brief-experiment.md (integrity, frozen 120-execution design, outcomes, adjudication, saving, report), all in that same directory. Where an earlier brief or an earlier message says to stop for the gate, this one wins. The integrity rules do not change: no invented, edited, dropped or re-run results.

Keep moving: measured runs should start by about 12:00 UTC. Append to `/tmp/cucumber-study-status.log` at each major step, starting now with the line `worker restarted: owner-directed exploratory run authorized`. Status lines are read by the owner every minute: write one at every step, in plain words.
E
[ -s "$C/exp.jsonl" ] && mv "$C/exp.jsonl" "$C/exp3-$(date +%H%M).jsonl"
rm -f "$C/exp-final.txt" "$C/.exp.seen" "$C/.exp.stall"
cd "$HOME/agents/researcher" || exit 1
nohup bash -c "agentpack --yolo codex --no-daemon exec -m gpt-5.6-terra --skip-git-repo-check -C $HOME/projects/cucumber-mcp-study --add-dir /tmp --add-dir $HOME/.local/share/cucumber-study --json -o $C/exp-final.txt - < $C/brief-experiment-4.md" > "$C/exp.jsonl" 2> "$C/exp.err" &
disown
read -t 15 < <(tail -f /dev/null)
echo "worker bytes: $(wc -c < "$C/exp.jsonl"), running: $(pgrep -fc '[-]m gpt-5.6-terra --skip-git-repo-check')"

