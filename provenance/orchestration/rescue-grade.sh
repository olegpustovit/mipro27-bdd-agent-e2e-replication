#!/usr/bin/env bash
# First and second automated reviewers for newly measured Case 1 traces.
set -euo pipefail
cd "$(dirname "$0")/../.."
campaign=${1:?Provide the terminal campaign id}
case "$campaign" in
  campaign-e-20261118-*|campaign-f-20261118-*|campaign-experiment4-haiku|campaign-experiment4-luna|campaign-experiment4-sonnet|campaign-experiment4-opus) ;;
  *) echo 'Expected a rescue campaign id' >&2; exit 64 ;;
esac
[[ "$campaign" =~ ^[a-zA-Z0-9_-]+$ ]] || exit 64
campaign_dir="${STUDY_DATA_DIR:-$HOME/.local/share/cucumber-study}/runs/$campaign"
[[ -s "$campaign_dir/trials.jsonl" && ! -e "$campaign_dir/adjudication.jsonl" ]] || exit 65
test ! -e "$campaign_dir/first-grader.events.jsonl" || exit 65
if [[ "$campaign" == campaign-experiment4-* ]]; then
  node --input-type=module - "$campaign_dir" <<'VERIFY'
import fs from 'node:fs';
import path from 'node:path';
import { recordDigest, sha256 } from './scripts/campaign-guard.mjs';
const dir = process.argv[2];
const manifest = fs.readFileSync(path.join(dir, '../experiment-4-comparison.json'));
const read = name => fs.readFileSync(path.join(dir, name), 'utf8').trim().split('\n').map(JSON.parse);
const journal = read('journal.jsonl'), rows = read('trials.jsonl');
const terminal = new Map(journal.filter(row => row.type === 'trial-finished').map(row => [row.trial.id, row]));
const done = journal.at(-1);
if (journal[0].inputs?.comparisonManifestSHA !== sha256(manifest) || terminal.size !== rows.length ||
    !(done.type === 'campaign-complete' && rows.length === 36 || done.type === 'campaign-stopped' && rows.length === 12 && done.reason?.startsWith('Model comparison stopped:')) ||
    new Set(rows.map(row => row.record.trialId)).size !== rows.length ||
    rows.some(row => terminal.get(row.record.trialId)?.recordSHA !== row.record.recordSHA ||
      recordDigest(row.record) !== row.record.recordSHA || terminal.get(row.record.trialId)?.result !== row.result)) {
  throw new Error('Comparison grading requires the shared pin and reconciled terminal records');
}
VERIFY
fi
repo_dir=$PWD
out_dir=$(mktemp -d "$campaign_dir/first-grader-work.XXXXXX")
trap 'status=$?; if (( status == 0 )); then rm -rf "$out_dir"; else printf "Grader work retained at %s\n" "$out_dir" >&2; fi' EXIT

# Same scoring rules and first grading model as the original campaigns.
sed -e "s|~/projects/cucumber-mcp-study|$repo_dir|g" \
    -e "s|\`scripts/mutations.mjs\`|\`$repo_dir/scripts/mutations.mjs\`|g" \
    -e "s|\`study/|\`$repo_dir/study/|g" \
    -e "s|~/.local/share/cucumber-study/runs/CAMPAIGN_ID|$campaign_dir|g" \
    -e "s|$campaign_dir/adjudication.jsonl|$out_dir/adjudication.jsonl|g" \
    -e "s|/tmp/cucumber-study-adjudication.md|$out_dir/summary.md|g" \
    provenance/orchestration/brief-adjudicate.md > "$out_dir/prompt.md"
codex exec --ignore-user-config --skip-git-repo-check --cd "$out_dir" --sandbox workspace-write \
    -m gpt-5.6-terra -c 'model_reasoning_effort="high"' \
    -c 'web_search="disabled"' --json - < "$out_dir/prompt.md" \
    > "$campaign_dir/first-grader.events.jsonl"
# Require stable original trial identities and exactly one valid class per trial.
node --input-type=module - "$campaign_dir" "$out_dir/adjudication.jsonl" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import { HEALTHY_CLASSES, FAULT_CLASSES } from './scripts/judge2/packet.mjs';
const [, , dir, file] = process.argv;
const read = name => fs.readFileSync(name, 'utf8').trim().split('\n').map(JSON.parse);
const expected = new Map(read(path.join(dir, 'trials.jsonl')).map(row => [row.record.trial.id, row]));
const grades = read(file);
const seen = new Set();
for (const grade of grades) {
  const trial = expected.get(grade.trialId);
  const classes = trial?.record.trial.kind === 'fault' ? FAULT_CLASSES : HEALTHY_CLASSES;
  if (!trial || seen.has(grade.trialId) || !classes.includes(grade.classification) ||
    (trial.result === 'infrastructure-invalid' && grade.classification !== 'invalid')) {
    throw new Error('Invalid or duplicate first grade for ' + grade.trialId);
  }
  seen.add(grade.trialId);
}
if (seen.size !== expected.size) throw new Error('First grading attempt is incomplete');
fs.copyFileSync(file, path.join(dir, 'adjudication.jsonl'), fs.constants.COPYFILE_EXCL);
NODE

# Sonnet grades each valid trace in isolation. Prior failed grades are retained.
node --input-type=module - "$campaign" "$campaign_dir" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import { main } from './scripts/judge2/run.mjs';
const [, , campaign, dir] = process.argv;
const packets = () => fs.readFileSync(path.join(dir, 'trials.jsonl'), 'utf8')
  .trim().split('\n').map(JSON.parse).filter(row => row.result === 'recorded')
  .map(entry => ({ campaign, trialId: entry.record.trial.id, entry }));
const result = main(['--run', 'rescue-20261118'], {
  packets,
  verdictsFile: path.join(dir, 'second-grader.jsonl'),
  errorsFile: path.join(dir, 'second-grader-errors.jsonl'),
});
console.log(JSON.stringify(result.summary));
NODE
