// Recomputes the provisional rescue fact sheet from the frozen Moodle ledger
// and archived Cypress grades. Read-only by default. Pass --write to embed it
// in results/paper-numbers.txt after regenerating the original pilot report.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ledgerPaths } from '../../scripts/ledger/paths.mjs';
import { readLines } from '../../scripts/ledger/jsonl.mjs';
import { collectTrials, judgeAll, summarize } from '../../scripts/analysis/moodle.mjs';
import { loadManifest } from '../../adapters/moodle/manifest.mjs';
import { loadJudgments, compare } from '../../scripts/analysis/agreement.mjs';
import { followupResults } from './rescue-followups.mjs';

const plan = '6ac189f540b8';
const source = `study ledger trials.jsonl, frozen Moodle plan ${plan}`;
const script = 'provenance/orchestration/rescue-numbers.mjs';
const heading = '== Rescue plan facts (two cases, separate units) ==';
const facts = [heading];
const add = (id, value, ref = source) => facts.push(`${id} | ${value} | ${script} | ${ref}`);
const trialRows = collectTrials(readLines(ledgerPaths().trials), { plan });
const executions = trialRows.filter(t => t.kind === 'campaign');
const repairs = trialRows.filter(t => t.caseId.endsWith('.repair'));
if (executions.length !== 416 || repairs.length !== 48) throw new Error('Frozen Moodle ledger is incomplete');
const paired = judgeAll(executions, loadManifest());
add('moodle.executions', executions.length);
add('moodle.repairs', repairs.length);
add('moodle.repair.sample_pass', repairs.filter(t => t.body.allSamplePass === true).length);
const mean = values => {
  const found = values.filter(Number.isFinite);
  if (!found.length) throw new Error('Expected recorded usage');
  return found.reduce((sum, value) => sum + value, 0) / found.length;
};
const tokens = ({ body: { meter } }) =>
  Number.isFinite(meter?.inputTokens) && Number.isFinite(meter?.outputTokens)
    ? meter.inputTokens + meter.outputTokens : null;
const milliseconds = ({ body: { meter } }) => meter?.wall?.totalMs;
for (const row of summarize(paired)) {
  const key = `moodle.${row.arm}.${row.model}`;
  add(`${key}.caught`, `${row.caught}/${row.pairs}`);
  add(`${key}.healthy_fail`, `${row.healthyFail}/${row.healthyRuns}`);
  add(`${key}.invalid_pairs`, row['invalid-healthy'] + row['invalid-faulted']);
  add(`${key}.incomplete_pairs`, row.incomplete);
  if (row.arm === 'A') continue;
  const healthy = executions.filter(t => t.arm === row.arm && t.model === row.model && t.state === 'healthy');
  add(`${key}.derived_16_scenario_healthy_suite_minutes`, (16 * mean(healthy.map(milliseconds)) / 60_000).toFixed(2));
  if (row.arm !== 'C') continue;
  const metered = healthy.map(tokens).filter(Number.isFinite);
  const suite = 16 * mean(metered);
  add(`${key}.derived_16_scenario_healthy_suite_tokens`, Math.round(suite));
  add(`${key}.metering`, `${metered.length}/${healthy.length}`);
  const modelRepairs = repairs.filter(t => t.model === row.model);
  const repair = mean(modelRepairs.map(tokens));
  add(`moodle.repair.${row.model}.mean_tokens`, Math.round(repair));
  add(`moodle.repair.${row.model}.mean_minutes`, (mean(modelRepairs.map(milliseconds)) / 60_000).toFixed(2));
  add(`moodle.repair.${row.model}.mean_edits`, mean(modelRepairs.map(t => t.body.policyState?.acceptedEdits)).toFixed(2));
  add(`moodle.repair.${row.model}.mean_validation_runs`, mean(modelRepairs.map(t => t.body.policyState?.scenarioRuns)).toFixed(2));
  add(`moodle.repair.${row.model}.derived_one_break_cost_fraction_of_agent_suite`, (repair / suite).toFixed(4));
}
add('moodle.repair.all.mean_tokens', Math.round(mean(repairs.map(tokens))));
add('moodle.repair.all.mean_minutes', (mean(repairs.map(milliseconds)) / 60_000).toFixed(2));
const { rows } = loadJudgments();
const eligible = rows.filter(row => !row.campaign.startsWith('campaign-20261101-') || row.trialId.endsWith('/maintained'));
const comparison = compare(eligible.map(row => [row.judge1, row.judge2]));
add('cypress.final_tool.and_baseline.grader_agreement', `${comparison.agree}/${comparison.n}; kappa ${comparison.kappa.toFixed(3)}`,
  'data/campaigns/*/adjudication.jsonl; provenance/judge2/verdicts.jsonl');
for (const run of followupResults()) {
  if (run.missing || Object.values(run.stages).some(stage => stage.terra.ungraded || stage.sonnet.ungraded)) continue;
  const prefix = `cypress.followup.original_ledger.${run.model}`;
  const ref = `frozen ${run.model} follow-up journals and trials.jsonl; adjudication.jsonl and second-grader.jsonl`;
  add(`${prefix}.terminal`, `${run.terminal}/${run.planned}`, ref);
  add(`${prefix}.metered_tokens`, `${run.tokens} across ${run.metered}/${run.terminal} metered runs`, ref);
  for (const [id, stage] of Object.entries(run.stages)) {
    const denominator = stage.recorded + stage.infrastructureInvalid;
    add(`${prefix}.${id}.coverage`, `${stage.recorded}/${denominator} usable; ${stage.infrastructureInvalid} invalid`, ref);
    for (const grade of ['terra', 'sonnet']) {
      for (const [classification, count] of Object.entries(stage[grade])) {
        add(`${prefix}.${id}.${grade}.${classification}`, `${count}/${denominator}`, ref);
      }
    }
  }
}
const rendered = facts.join('\n') + '\n';
if (process.argv.includes('--write')) {
  const output = fileURLToPath(new URL('../../results/paper-numbers.txt', import.meta.url));
  const previous = readFileSync(output, 'utf8');
  writeFileSync(output, previous.split(heading)[0].trimEnd() + '\n\n' + rendered);
} else process.stdout.write(rendered);
