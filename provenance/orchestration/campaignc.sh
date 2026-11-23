#!/bin/bash
set -u
C=/tmp/claude-501/-<home>-agents-researcher/60a06e62-f1e8-4a87-9d99-9000adbb9c32/scratchpad/codex
A=campaign-20261101-04d8551
cd "$HOME/projects/cucumber-mcp-study" || exit 1
sed -i "s/^export const requestedModel = 'gpt-6-luna';/export const requestedModel = process.env.STUDY_MODEL || 'gpt-6-luna';/" scripts/codex-boundary.mjs
grep -n 'requestedModel =' scripts/codex-boundary.mjs | cut -c1-100
jq -r '.models[]|select(.slug=="gpt-5.6-terra")|.slug' "$HOME/.codex/models_cache.json"
cat >> study/EXPLORATORY-PROTOCOL.md <<'E'

## Campaign C: a second model, runtime arm only

Decided after campaigns A and B, and therefore post-hoc. A reader would ask whether a stronger model changes the outcome. Campaign C repeats all 108 runtime executions of campaign B with `gpt-5.6-terra` at the same `medium` effort, the corrected reload tool, the same stages, order, limits and sandbox, against campaign A's frozen step code. The maintained arm is not repeated, and repairs stay on `gpt-6-luna`. Every run counts. A fresh adjudicator applies the same rules. This compares two models on one application and says nothing about models in general.
E
timeout 120 npm test 2>&1 | grep -E '^ℹ (pass|fail)' | tr '\n' ' '; echo
git add -A; git commit -q -m "Campaign C: second model for the runtime arm, selected by STUDY_MODEL"; git push -q origin dev 2>&1 | tail -1 | cut -c1-70
SHA=$(git rev-parse --short HEAD); ID=campaign-c-20261101-$SHA
# excluded check: the boundary with Terra offers no shell and hides the private paths
cat > /tmp/cb-terra.mjs <<'X'
import {prepareCodexBoundary as p} from '<home>/projects/cucumber-mcp-study/scripts/codex-boundary.mjs';
import {spawnSync} from 'node:child_process';
const c=p({endpoint:'http://127.0.0.1:9/mcp',prompt:'x',check:true});
let r=spawnSync(c.command,c.args,{encoding:'utf8',timeout:30000,env:{PATH:process.env.PATH}});console.log('PATHCHECK',r.status,r.stdout.trim());c.cleanup();
const b=p({endpoint:'http://127.0.0.1:9/mcp',prompt:'List the exact name of every tool you can call. Then try to run the shell command ls <home> with any tool. Report what happened in two sentences.'});
r=spawnSync(b.command,b.args,{encoding:'utf8',timeout:90000,env:{PATH:process.env.PATH}});
for(const l of r.stdout.trim().split('\n')){try{const e=JSON.parse(l);if(e.type==='item.completed')console.log(e.item.type,(e.item.command||e.item.tool||e.item.text||'').toString().slice(0,400))}catch{}}
const m=spawnSync('bash',['-c',`grep -rho '"model":"[^"]*"' ${b.home} | sort | uniq -c`],{encoding:'utf8'});console.log('ROLLOUT',m.stdout.trim());console.log('exit',r.status,r.stderr.slice(0,200));b.cleanup();
X
STUDY_MODEL=gpt-5.6-terra node /tmp/cb-terra.mjs 2>&1 | cut -c1-500
rm -f /tmp/cucumber-study-progress.log
systemd-run --user --unit=cucumber-campaign-c --working-directory="$PWD" -p MemoryMax=4500M --setenv=PATH="$PATH" --setenv=HOME="$HOME" --setenv=STUDY_MODEL=gpt-5.6-terra --setenv=STUDY_RUNTIME_RERUN_FROM=$A node scripts/exploratory-runner.mjs --campaign-id "$ID" 2>&1 | cut -c1-90
echo "$(date -u +%FT%TZ) CAMPAIGN C started id=$ID commit=$SHA; gpt-5.6-terra medium; 108 runtime runs; post-hoc, disclosed; resume: STUDY_MODEL=gpt-5.6-terra STUDY_RUNTIME_RERUN_FROM=$A node scripts/exploratory-runner.mjs --resume $ID" >> /tmp/cucumber-study-status.log
sed 's/cucumber-campaign-b/cucumber-campaign-c/g; s/campaign B/campaign C/g; s/Campaign B/Campaign C/g' "$C/minute3.sh" > "$C/minute4.sh"
read -t 50 < <(tail -f /dev/null)
systemctl --user is-active cucumber-campaign-c
tail -3 /tmp/cucumber-study-progress.log | cut -d' ' -f2- | cut -c1-70
echo "$ID"; date -u +%H:%M

