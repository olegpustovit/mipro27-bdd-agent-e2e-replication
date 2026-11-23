// Summarize measured follow-ups without treating incomplete grades as outcomes.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ledgerPaths } from '../../scripts/ledger/paths.mjs';
import { exploratoryTrials } from '../../study/exploratory-plan.mjs';

const root = join(ledgerPaths().dir, 'runs');
const read = (dir, file) => {
  try {
    return readFileSync(join(root, dir, file), 'utf8').split('\n').slice(0, -1)
      .filter(Boolean).map(JSON.parse);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
};

function summarize(model, planned, directories, selectedStages = null) {
  const expected = new Set(exploratoryTrials()
    .filter(t => t.arm === 'runtime' && (!selectedStages || selectedStages.includes(t.stage)))
    .map(t => t.id));
  if (expected.size !== planned) throw new Error(`Unexpected frozen allocation for ${model}`);
  const trials = new Set(), stages = {};
  let metered = 0, tokens = 0;
  for (const dir of directories) {
    const journal = read(dir, 'journal.jsonl');
    if (journal.length && journal[0].inputs?.driver?.model !== model) {
      throw new Error(`Unexpected frozen model for ${dir}`);
    }
    const records = read(dir, 'trials.jsonl');
    if (journal.at(-1)?.type === 'campaign-complete') {
      const outcomes = new Map(journal.filter(row => row.type === 'trial-finished').map(row => [row.trial.id, row.result]));
      if (records.length !== journal[0].inputs.config.executions || outcomes.size !== records.length ||
        records.some(row => outcomes.get(row.record.trial.id) !== row.result)) {
        throw new Error(`Completed ledger does not reconcile for ${dir}`);
      }
    }
    const grades = [
      ['terra', new Map(read(dir, 'adjudication.jsonl').map(r => [r.trialId, r.classification]))],
      ['sonnet', new Map(read(dir, 'second-grader.jsonl').filter(r => r.ok !== false).map(r => [r.trialId, r.classification]))],
    ];
    for (const { result, record } of records) {
      const { id, stage } = record.trial;
      if (!expected.has(id)) throw new Error(`Unplanned ${model} trial ${id}`);
      if (trials.has(id)) throw new Error(`Duplicate ${model} trial ${id}`);
      trials.add(id);
      const counts = stages[stage] ??= { recorded: 0, infrastructureInvalid: 0, terra: {}, sonnet: {} };
      if (!['recorded', 'infrastructure-invalid'].includes(result)) throw new Error(`Unknown terminal result ${result}`);
      counts[result === 'recorded' ? 'recorded' : 'infrastructureInvalid']++;
      const usage = record.agent?.usage;
      if (Number.isSafeInteger(usage?.input_tokens) && Number.isSafeInteger(usage?.output_tokens)) {
        metered++;
        tokens += usage.input_tokens + usage.output_tokens;
      }
      for (const [name, rows] of grades) {
        const classification = result === 'infrastructure-invalid' ? 'invalid' : rows.get(id) ?? 'ungraded';
        counts[name][classification] = (counts[name][classification] ?? 0) + 1;
      }
    }
  }
  if (trials.size > planned) throw new Error(`More trials than planned for ${model}`);
  return { model, planned, terminal: trials.size, missing: planned - trials.size, metered, tokens, stages };
}

export function followupResults() {
  return [
    summarize('gpt-6.2-sol', 108, ['campaign-e-20261118-e23c7f6', 'campaign-e-20261118-continuation']),
    summarize('claude-opus-5-5', 36, ['campaign-f-20261118-opus'], ['healthy-v0-1', 'healthy-v2-1', 'fault-v2-1']),
  ];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(followupResults(), null, 2));
}
