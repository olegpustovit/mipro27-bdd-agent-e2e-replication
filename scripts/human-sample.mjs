import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { listCampaigns, trialRows } from './lib/campaign-data.mjs';
import { loadJudgments } from './analysis/agreement.mjs';
export function selectHumanSample() {
  const rows = listCampaigns().flatMap(c => trialRows(c.id).map(t => ({ ...t, campaign: c.id, label: c.label })));
  const social = t => ['social-like', 'social-comment'].includes(t.caseId);
  const runtime = t => t.arm === 'runtime';
  const strata = [
    [15, t => t.label === 'D' && t.confidence === 'medium'],
    [1, t => t.label === 'A' && runtime(t) && t.classification === 'unsupported_healthy_pass'],
    [3, t => t.label === 'C' && t.classification === 'unsupported_healthy_pass'],
    [4, t => t.label === 'D' && t.classification === 'no_opportunity'],
    [3, t => t.label === 'A' && runtime(t) && t.classification === 'false_alarm'],
    [2, t => ['A', 'B'].includes(t.label) && runtime(t) && t.classification === 'action_failure' && !social(t)],
    [4, t => ['B', 'C'].includes(t.label) && runtime(t) && t.classification === 'action_failure' && social(t)],
    [3, t => ['B', 'C', 'D'].includes(t.label) && runtime(t) && t.classification === 'true_pass' && (t.label !== 'D' || t.confidence === 'high')],
    [3, t => ['B', 'C'].includes(t.label) && runtime(t) && t.classification === 'supported_detection'],
  ];
  const hash = t => createHash('sha256').update(`mipro27-human-v1:${t.campaign}:${t.trialId}`).digest('hex');
  const result = [], used = new Set();
  function take(n, predicate, stratum) {
    const eligible = rows.filter(t => predicate(t) && !used.has(`${t.campaign}:${t.trialId}`)).sort((a, b) => hash(a).localeCompare(hash(b)));
    if (eligible.length < n) throw new Error(`Stratum ${stratum}: need ${n}, found ${eligible.length}`);
    for (const t of eligible.slice(0, n)) { used.add(`${t.campaign}:${t.trialId}`); result.push({ campaign: t.campaign, trialId: t.trialId, stratum }); }
  }
  strata.forEach(([n, predicate], i) => take(n, predicate, i + 1));
  for (const classification of ['supported_detection', 'action_failure']) take(1, t => t.label === 'A' && t.arm === 'maintained' && t.classification === classification, 10);
  const labels = new Map(listCampaigns().map(c => [c.id, c.label]));
  for (const { campaign, trialId, judge1, judge2 } of loadJudgments().rows) {
    const key = `${campaign}:${trialId}`;
    const disagreement = judge1 && judge2 && judge1 !== judge2;
    const falseAlarm = ['B', 'C', 'D', 'E', 'F'].includes(labels.get(campaign)) &&
      [judge1, judge2].includes('false_alarm');
    if ((!disagreement && !falseAlarm) || used.has(key)) continue;
    result.push({ campaign, trialId, stratum: disagreement ? 11 : 12 });
    used.add(key);
  }
  return result;
}
export function writeHumanSample(file = new URL('../data/human-sample.json', import.meta.url), { force = false } = {}) {
  const sample = selectHumanSample();
  fs.writeFileSync(file, JSON.stringify(sample, null, 2) + '\n', { flag: force ? 'w' : 'wx' });
  return sample;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const entries = writeHumanSample(undefined, { force: process.argv.includes('--force') });
  console.log(`Wrote ${entries.length} human-review queue entries`);
}
