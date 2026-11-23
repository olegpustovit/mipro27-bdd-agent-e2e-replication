// Agreement between reviewers on the 540 pilot trials: judge1 (committed adjudication.jsonl), judge2 (provenance/judge2/verdicts.jsonl),
// and the human check (data/human-adjudication.jsonl; latest answer per rater/trial).
import fs from 'node:fs';
import * as campaignStore from '../lib/campaign-data.mjs';
import { opaqueId } from '../judge2/packet.mjs';
import { root } from './pilot.mjs';

const readJsonl = f => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : [];
const followupLabels = new Map([
  ['campaign-e-20261118-e23c7f6', 'E'],
  ['campaign-e-20261118-continuation', 'E'],
  ['campaign-f-20261118-opus', 'F'],
]);
export function cohenKappa(pairs) {
  const n = pairs.length; if (!n) return null;
  const cats = [...new Set(pairs.flat())], po = pairs.filter(([a, b]) => a === b).length / n;
  const pe = cats.reduce((s, c) => s + (pairs.filter(p => p[0] === c).length / n) * (pairs.filter(p => p[1] === c).length / n), 0);
  return pe === 1 ? null : (po - pe) / (1 - pe);   // undefined when both raters use one identical class
}
// One-vs-rest kappa for a class: both raters' binary calls "is class c".
export const classKappa = (pairs, c) => cohenKappa(pairs.map(([a, b]) => [a === c, b === c]));
export function compare(pairs) {
  const classes = [...new Set(pairs.flat())].sort();
  return { n: pairs.length, agree: pairs.filter(([a, b]) => a === b).length, kappa: cohenKappa(pairs),
    matrix: Object.fromEntries(classes.map(reference => [reference, Object.fromEntries(classes.map(
      predicted => [predicted, pairs.filter(([a, b]) => a === reference && b === predicted).length],
    ))])),
    perClass: classes.map(c => ({ class: c, ref: pairs.filter(p => p[0] === c).length, agree: pairs.filter(p => p[0] === c && p[1] === c).length, otherRaterTotal: pairs.filter(p => p[1] === c).length, kappaOneVsRest: classKappa(pairs, c) })) };
}
export function loadSecondJudgments(verdictsFile = `${root}provenance/judge2/verdicts.jsonl`) {
  return new Map(readJsonl(verdictsFile).filter(v => v.ok !== false).map(v => [v.opaqueId, v]));
}
export function loadJudgments({ verdictsFile, humanFile = `${root}data/human-adjudication.jsonl`, includeFollowups = false, store = campaignStore } = {}) {
  const campaigns = store.listCampaigns({ includeLive: includeFollowups }).filter(c => !c.live || followupLabels.has(c.id));
  const rows = campaigns.flatMap(c => store.trialRows(c.id).map(r => ({
    campaign: c.id,
    label: followupLabels.get(c.id) ?? c.label,
    trialId: r.trialId,
    judge1: r.classification ?? (r.result === 'infrastructure-invalid' ? 'invalid' : null),
    key: opaqueId(c.id, r.trialId),
  })));
  const v2 = loadSecondJudgments(verdictsFile);
  const human = new Map(); for (const a of readJsonl(humanFile)) if ([1, 2].includes(a.schema) && a.rater) human.set(JSON.stringify([a.rater, a.campaign, a.trialId]), a);
  return { rows: rows.map(r => ({ ...r, judge2: v2.get(r.key)?.classification ?? null })), human: [...human.values()], total: rows.length };
}
export function agreement(opts) {
  const { rows, human, total } = loadJudgments(opts), byTrial = new Map(rows.map(r => [`${r.campaign}|${r.trialId}`, r]));
  const both = rows.filter(r => r.judge1 && r.judge2);
  const out = { total, judge2Judged: rows.filter(r => r.judge2).length, judge1VsJudge2: compare(both.map(r => [r.judge1, r.judge2])), human: { answers: human.length, raters: [...new Set(human.map(h => h.rater))].sort(), byRater: {} } };
  for (const rater of out.human.raters) {
    const mine = human.filter(h => h.rater === rater).map(h => ({ h, r: byTrial.get(`${h.campaign}|${h.trialId}`) })).filter(x => x.r);
    out.human.byRater[rater] = { n: mine.length, vsJudge1: compare(mine.filter(x => x.r.judge1).map(x => [x.h.classification, x.r.judge1])),
      vsJudge2: compare(mine.filter(x => x.r.judge2).map(x => [x.h.classification, x.r.judge2])),
      allThree: mine.filter(x => x.r.judge1 && x.r.judge2).filter(x => x.h.classification === x.r.judge1 && x.h.classification === x.r.judge2).length,
      allThreeN: mine.filter(x => x.r.judge1 && x.r.judge2).length };
    out.human.byRater[rater].byCampaign = Object.fromEntries([...new Set(rows.map(row => row.label))].map(label => {
      const checked = mine.filter(x => x.r.label === label);
      const campaign = rows.filter(x => x.label === label);
      const overrides = new Map(checked.map(x => [x.r.key, x.h.classification]));
      const counts = classes => {
        const totals = {};
        for (const value of classes) totals[value ?? 'ungraded'] = (totals[value ?? 'ungraded'] ?? 0) + 1;
        return totals;
      };
      return [label, {
        checked: checked.length,
        vsJudge1: compare(checked.filter(x => x.r.judge1).map(x => [x.h.classification, x.r.judge1])),
        vsJudge2: compare(checked.filter(x => x.r.judge2).map(x => [x.h.classification, x.r.judge2])),
        automated: counts(campaign.map(x => x.judge1)),
        withHumanOverrides: counts(campaign.map(x => overrides.get(x.key) ?? x.judge1)),
        checkedGrades: checked.map(({h, r}) => ({ campaign: r.campaign, trialId: r.trialId, human: h.classification, judge1: r.judge1, judge2: r.judge2 })),
      }];
    }));
  }
  return out;
}
const k = x => x === null ? 'null (undefined)' : x.toFixed(3);
export function renderAgreement(a) {
  const L = [`Reviewer agreement across ${a.total} recorded trial rows, including infrastructure-invalid rows. Reference class is the first-named rater. Kappa is Cohen's; per-class kappa is one-vs-rest. null = undefined.`, ''];
  const block = (title, c) => { L.push(title, `  n=${c.n} agree=${c.agree}/${c.n}${c.n ? ` (${(100 * c.agree / c.n).toFixed(1)}%)` : ''} kappa=${k(c.kappa)}`); for (const p of c.perClass) L.push(`  ${p.class}: ref ${p.ref}, both ${p.agree}/${p.ref}, other rater called it ${p.otherRaterTotal}, kappa(one-vs-rest)=${k(p.kappaOneVsRest)}`); };
  L.push(`judge2 coverage: ${a.judge2Judged}/${a.total} trials judged${a.judge2Judged < a.total ? ' (INCOMPLETE; agreement covers judged trials only and is not a population estimate)' : ''}`);
  if (a.judge2Judged) block('judge1 (reference) vs judge2', a.judge1VsJudge2); else L.push(`judge1 vs judge2: not run (0/${a.total})`);
  L.push('', `Human answers: ${a.human.answers}; the queue combines a stratified sample with disagreements and false alarms. Agreement is descriptive of checked runs.`);
  for (const [r, v] of Object.entries(a.human.byRater)) {
    block(`human ${r} (reference) vs judge1`, v.vsJudge1);
    if (a.judge2Judged) block(`human ${r} (reference) vs judge2`, v.vsJudge2);
    for (const [campaign, c] of Object.entries(v.byCampaign)) {
      L.push(`Campaign ${campaign}: ${c.checked} checked by ${r}`);
      block('Human vs judge1', c.vsJudge1);
      L.push(`Confusion matrix (human rows): ${JSON.stringify(c.vsJudge1.matrix)}`);
      block('Human vs judge2', c.vsJudge2);
      L.push(`Confusion matrix (human rows): ${JSON.stringify(c.vsJudge2.matrix)}`);
      L.push(`Automated: ${JSON.stringify(c.automated)}`, `Human overrides: ${JSON.stringify(c.withHumanOverrides)}`);
      for (const grade of c.checkedGrades) {
        L.push(`  ${grade.campaign}/${grade.trialId}: human ${grade.human}, judge1 ${grade.judge1 ?? 'ungraded'}, judge2 ${grade.judge2 ?? 'ungraded'}`);
      }
    }
  }
  return L.join('\n') + '\n';
}
