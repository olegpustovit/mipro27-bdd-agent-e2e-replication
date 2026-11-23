#!/bin/bash
set -u
cd "$HOME/projects/research-foundry" || exit 1
[ -z "$(git status --porcelain)" ] || { echo "dirty tree"; git status --short | head; exit 1; }
sed -i 's/^version = "0.4.0"/version = "0.4.1"/' plugin/agentpack.toml
sed -i 's/"version": "0.4.0"/"version": "0.4.1"/' plugin/.claude-plugin/plugin.json
sed -i 's/0\.4\.0/0.4.1/g' backend/cmd/foundry/plugin_release_test.go
git add plugin/agentpack.toml plugin/.claude-plugin/plugin.json backend/cmd/foundry/plugin_release_test.go
git commit -q -m "Plugin 0.4.1: require abstracts to state their difference from competitors." && git push -q origin dev
make deploy > /tmp/foundry-deploy-041.log 2>&1; echo "deploy_exit=$?"
tail -1 /tmp/foundry-deploy-041.log | cut -c1-160
make plugin-release VERSION=0.4.1 2>&1 | tail -1 | cut -c1-200; echo "release_exit=${PIPESTATUS[0]}"
cd "$HOME/agents/researcher" || exit 1
sed -i 's#"github.com/olegpustovit/research-foundry/plugin" = "v0.4.0"#"github.com/olegpustovit/research-foundry/plugin" = "v0.4.1"#' agentpack.toml
timeout 120 agentpack lock --update github.com/olegpustovit/research-foundry/plugin 2>&1 | tail -1 | cut -c1-150
grep -n "research-foundry/tree" pack.lock | cut -c1-100

