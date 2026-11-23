import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ledgerPaths } from '../../scripts/ledger/paths.mjs';
import { recordDigest, sha256 } from '../../scripts/campaign-guard.mjs';
import { FAULT_CLASSES, HEALTHY_CLASSES, opaqueId } from '../../scripts/judge2/packet.mjs';

const args = process.argv.slice(2);
const factsMode = args.includes('--facts');
const runs = args.find(arg => arg !== '--facts') ?? join(ledgerPaths().dir, 'runs');
const facts = [];
let sharedTrialOrder;
const manifest = readFileSync(join(runs, 'experiment-4-comparison.json'));
const seal = sha256(manifest);
const { pins } = JSON.parse(manifest);
const read = (dir, file) => {
  const path = join(dir, file);
  return existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
};
const counts = values => Object.fromEntries(Object.entries(Object.groupBy(values, x => x)).map(([key, rows]) => [key, rows.length]));
const sum = (rows, getter) => {
  const known = rows.map(getter).filter(Number.isFinite);
  return { metered: known.length, sum: known.length ? known.reduce((a, b) => a + b, 0) : null };
};

for (const { campaign, model, driver } of pins.arms) {
  const dir = join(runs, campaign);
  const journal = read(dir, 'journal.jsonl');
  if (!journal.length) {
    if (factsMode) throw new Error('Campaign unavailable: ' + campaign);
    console.log(JSON.stringify({ campaign, model, driver, planned: 36, status: 'unlaunched' }));
    continue;
  }
  if (journal[0].inputs.comparisonManifestSHA !== seal) throw new Error('Unexpected seal: ' + campaign);
  const finished = new Map(journal.filter(row => row.type === 'trial-finished').map(row => [row.trial.id, row]));
  const rows = read(dir, 'trials.jsonl').filter(row => finished.has(row.record.trialId));
  if (rows.length !== finished.size || new Set(rows.map(row => row.record.trialId)).size !== rows.length ||
      rows.some(({ record, result }) => finished.get(record.trialId).recordSHA !== record.recordSHA ||
      finished.get(record.trialId).result !== result || recordDigest(record) !== record.recordSHA)) {
    throw new Error('Trial journal reconciliation failed: ' + campaign);
  }
  const expected = new Map(rows.map(row => [row.record.trialId, row]));
  const validClass = ({ trialId, classification }) => {
    const row = expected.get(trialId);
    if (!row) return false;
    if (row.result !== 'recorded') return classification === 'invalid';
    return (row.record.trial.kind === 'fault' ? FAULT_CLASSES : HEALTHY_CLASSES).includes(classification);
  };
  const terraGrades = read(dir, 'adjudication.jsonl');
  const sonnetGrades = read(dir, 'second-grader.jsonl');
  const first = new Map(terraGrades.map(row => [row.trialId, row.classification]));
  const second = new Map(sonnetGrades.map(row => [row.opaqueId, row.classification]));
  if (first.size !== terraGrades.length || second.size !== sonnetGrades.length ||
      terraGrades.some(row => !validClass(row)) ||
      sonnetGrades.some(row => row.campaign !== campaign || expected.get(row.trialId)?.result !== 'recorded' ||
        row.opaqueId !== opaqueId(campaign, row.trialId) || !row.ok || !validClass(row))) {
    throw new Error('Grade rows do not reconcile to recorded trials: ' + campaign);
  }
  // Verdict parser v2 re-decoded some final responses (prepare-verdict-recovery.mjs).
  // Those trials were regraded by both graders; their new grades replace the originals.
  const recoveryCampaign = campaign + '-verdict-v2';
  const recoveryDir = join(runs, recoveryCampaign);
  let verdictRecovered = 0;
  if (existsSync(join(recoveryDir, 'trials.jsonl'))) {
    const recovered = read(recoveryDir, 'trials.jsonl');
    const recoveredFirst = new Map(read(recoveryDir, 'adjudication.jsonl').map(row => [row.trialId, row.classification]));
    const recoveredSecond = new Map(read(recoveryDir, 'second-grader.jsonl').filter(row => row.ok)
      .map(row => [row.trialId, row]));
    for (const { record } of recovered) {
      const original = expected.get(record.trialId);
      const sonnet = recoveredSecond.get(record.trialId);
      if (!original || original.result !== 'recorded' || record.verdictRecovery?.sourceRecordSHA !== original.record.recordSHA ||
          recordDigest(record) !== record.recordSHA || !recoveredFirst.has(record.trialId) || !sonnet ||
          sonnet.opaqueId !== opaqueId(recoveryCampaign, record.trialId) ||
          !validClass({ trialId: record.trialId, classification: recoveredFirst.get(record.trialId) }) ||
          !validClass({ trialId: record.trialId, classification: sonnet.classification })) {
        throw new Error('Verdict recovery does not reconcile: ' + record.trialId);
      }
      first.set(record.trialId, recoveredFirst.get(record.trialId));
      second.set(opaqueId(campaign, record.trialId), sonnet.classification);
      verdictRecovered++;
    }
  }
  const graded = rows.filter(row => row.result === 'recorded').map(({ record }) => ({
    stage: record.trial.stage,
    terra: first.get(record.trialId) ?? 'ungraded',
    sonnet: second.get(opaqueId(campaign, record.trialId)) ?? 'ungraded',
  }));
  const stages = Object.fromEntries(Object.entries(Object.groupBy(graded, row => row.stage)).map(([stage, rows]) => [
    stage, { terra: counts(rows.map(row => row.terra)), sonnet: counts(rows.map(row => row.sonnet)) },
  ]));
  const comparable = graded.filter(row => row.terra !== 'ungraded' && row.sonnet !== 'ungraded');
  const result = { campaign, model, driver, planned: 36, status: journal.at(-1).type,
    trialOrderSHA: sha256(rows.map(row => row.record.trialId).join('\n') + '\n'),
    completed: rows.length, recorded: graded.length, invalid: rows.length - graded.length, stages,
    agree: comparable.filter(row => row.terra === row.sonnet).length, compared: comparable.length,
    inputTokens: sum(rows, row => row.record.agent?.meter?.inputTokens),
    outputTokens: sum(rows, row => row.record.agent?.meter?.outputTokens),
    reportedCostUsd: sum(rows, row => row.record.agent?.meter?.reportedCostUsd),
    wallMs: sum(rows, row => row.record.elapsedMs),
    sonnetGradeCostUsd: sum(sonnetGrades, row => row.costUsd),
  };
  if (!factsMode) {
    console.log(JSON.stringify(result));
    continue;
  }
  if (result.status !== 'campaign-complete' || result.completed !== result.planned || result.compared !== result.recorded) {
    throw new Error('Comparison data are incomplete: ' + campaign);
  }
  sharedTrialOrder ??= result.trialOrderSHA;
  if (result.trialOrderSHA !== sharedTrialOrder) throw new Error('Campaign used a different trial order: ' + campaign);
  const add = (key, value) => facts.push(
    `cypress.comparison.${model}.${key} | ${value} | provenance/orchestration/summarize-experiment-4.mjs | ${campaign} frozen trial and grade ledgers`
  );
  add('driver', driver);
  add('usable', `${result.recorded}/${result.completed}`);
  add('infrastructure_invalid', result.invalid);
  add('grader_agreement', `${result.agree}/${result.compared}`);
  if (verdictRecovered) add('verdict_parser_v2_regraded', verdictRecovered);
  for (const key of ['inputTokens', 'outputTokens', 'wallMs', 'reportedCostUsd', 'sonnetGradeCostUsd']) {
    const { sum: value, metered } = result[key];
    add(key, value === null ? 'Not reported' : `${Number(value.toFixed(9))} across ${metered}/${result.completed} runs`);
  }
  for (const [stage, grades] of Object.entries(stages)) {
    for (const [grader, outcomes] of Object.entries(grades)) {
      for (const [outcome, count] of Object.entries(outcomes)) add(`${stage}.${grader}.${outcome}`, count);
    }
  }
}
if (factsMode) console.log('Cypress matched 36-case runtime comparison\n' + facts.join('\n'));
