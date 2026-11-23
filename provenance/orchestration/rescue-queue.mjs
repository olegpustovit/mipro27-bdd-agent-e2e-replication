// Extend the existing human queue using terminal follow-up runs and their grades.
// Keep the original queue intact so saved answers retain their trial identities.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { ledgerPaths } from '../../scripts/ledger/paths.mjs';
import { opaqueId } from '../../scripts/judge2/packet.mjs';

const queueFile = new URL('../../data/human-sample.json', import.meta.url);
const secondFile = new URL('../judge2/verdicts.jsonl', import.meta.url);
const queue = JSON.parse(fs.readFileSync(queueFile, 'utf8'));
const read = path => fs.existsSync(path) ? fs.readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const key = ({ campaign, trialId }) => `${campaign}:${trialId}`;
const seen = new Set(queue.map(key));
const second = new Map(read(secondFile).map(row => [row.opaqueId, row]));
const added = [];
const append = (row, stratum) => {
  if (seen.has(key(row))) return;
  const entry = { campaign: row.campaign, trialId: row.trialId, stratum };
  seen.add(key(entry));
  added.push(entry);
};
const hash = row => createHash('sha256').update(`mipro27-human-v1:${key(row)}`).digest('hex');
const priority = (row, classification) => row.terra === classification || row.sonnet === classification;

for (const campaign of ['campaign-e-20261118-continuation', 'campaign-f-20261118-opus']) {
  const dir = join(ledgerPaths().dir, 'runs', campaign);
  if (!read(join(dir, 'journal.jsonl')).some(row => ['campaign-complete', 'campaign-stopped'].includes(row.type))) continue;
  const grades = new Map(read(join(dir, 'adjudication.jsonl')).map(row => [row.trialId, row]));
  const additional = new Map(read(join(dir, 'second-grader.jsonl')).filter(row => row.ok !== false).map(row => [row.trialId, row]));
  const rows = read(join(dir, 'trials.jsonl')).filter(row => row.result === 'recorded').map(({ record }) => {
    const trialId = record.trial.id;
    const first = grades.get(trialId);
    const next = additional.get(trialId);
    if (next) second.set(opaqueId(campaign, trialId), next);
    return { campaign, trialId, terra: first?.classification, confidence: first?.confidence, sonnet: next?.classification,
      social: ['social-like', 'social-comment'].includes(record.trial.caseId) };
  });
  for (const row of rows) {
    if (row.terra && row.sonnet && row.terra !== row.sonnet) append(row, 11);
    if (priority(row, 'false_alarm')) append(row, 12);
  }
  if (!rows.every(row => row.terra && row.sonnet)) continue;
  // Use the original outcome and confidence strata, drawing one per available
  // stratum for each smaller follow-up. Preserve the original salted ordering.
  const strata = [
    [1, r => r.confidence === 'medium'],
    [3, r => r.terra === 'unsupported_healthy_pass'],
    [4, r => r.terra === 'no_opportunity'],
    [6, r => r.terra === 'action_failure' && !r.social],
    [7, r => r.terra === 'action_failure' && r.social],
    [8, r => r.terra === 'true_pass'],
    [9, r => r.terra === 'supported_detection'],
  ];
  for (const [stratum, accepts] of strata) {
    const eligible = rows.filter(accepts).sort((a, b) => hash(a).localeCompare(hash(b)));
    if (eligible.length && !eligible.some(row => seen.has(key(row)))) append(eligible[0], stratum);
  }
}

if (process.argv.includes('--write')) {
  const replace = (file, contents) => {
    const temp = new URL(file.href + `.${process.pid}.tmp`);
    fs.writeFileSync(temp, contents, { flag: 'wx' });
    fs.renameSync(temp, file);
  };
  if (second.size !== read(secondFile).length) {
    replace(secondFile, [...second.values()].map(row => JSON.stringify(row)).join('\n') + '\n');
  }
  if (added.length) replace(queueFile, JSON.stringify([...queue, ...added], null, 2) + '\n');
}
console.log(JSON.stringify({ original: queue.length, added: added.length, total: queue.length + added.length }));
