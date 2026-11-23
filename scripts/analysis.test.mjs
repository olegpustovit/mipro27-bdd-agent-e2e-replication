import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { opaqueId } from './judge2/packet.mjs';
import { pilotTables, breakage, resources, validationStartsByRevision } from './analysis/pilot.mjs';
import { cohenKappa, compare, agreement } from './analysis/agreement.mjs';
import { pilotNumbers, renderPaperNumbers } from './analysis/paper-numbers.mjs';
import { listCampaigns } from './lib/campaign-data.mjs';

const get = (label, arm, scope) => pilotTables().find(t => t.label === label && t.arm === arm && t.scope === scope);
const head = t => ({ det: `${t.fault.counts.supported_detection}/${t.fault.n}`, pass: `${t.healthy.counts.true_pass}/${t.healthy.n}`, fa: t.healthy.counts.false_alarm });
test('headline tables, all scenarios and without social', () => {
  const want = { A: [['43/48', '38/60', 13], ['40/40', '35/50', 13]], B: [['40/48', '50/60', 0], ['40/40', '49/50', 0]], C: [['40/48', '50/60', 0], ['40/40', '50/50', 0]], D: [['43/48', '49/60', 4], ['39/40', '44/50', 4]] };
  for (const [l, [all, ns]] of Object.entries(want)) {
    assert.deepEqual(Object.values(head(get(l, 'runtime', 'all'))), all); assert.deepEqual(Object.values(head(get(l, 'runtime', 'excluding-social'))), ns);
  }
  assert.equal(head(get('A', 'maintained', 'all')).det, '48/48');
  for (const t of pilotTables()) { assert.equal(t.fault.unclassified + t.healthy.unclassified, 0); assert.deepEqual(t.fault.unexpected, {}); }
});
test('outcome classes keep separate counts over one denominator', () => {
  const t = get('D', 'runtime', 'all');
  assert.equal(t.fault.counts.no_opportunity, 4); assert.equal(t.fault.n, 48);
  assert.equal(Object.values(t.fault.counts).reduce((a, b) => a + b, 0), t.fault.n);
  assert.equal(Object.values(t.healthy.counts).reduce((a, b) => a + b, 0), t.healthy.n);
});
test('breakage and repair budgets match three raw sources; self-report conflict is flagged', () => {
  const A = listCampaigns().find(c => c.label === 'A').id, [v1, v2] = breakage(A);
  assert.deepEqual([v1.broken, v1.journalEdits, v1.journalSuites, v1.afterPasses, v1.afterTotal], [12, 2, 3, 5, 12]);
  assert.deepEqual([v2.broken, v2.journalEdits, v2.journalSuites, v2.afterPasses, v2.afterTotal], [8, 5, 6, 12, 12]);
  assert.equal(v1.eventEdits, 2); assert.equal(v2.eventEdits, 5); assert.deepEqual(validationStartsByRevision(A), { v1: 3, v2: 6 });
  assert.equal(v1.selfReport.edits, 3); assert.equal(v1.selfReportConflict, true);
});
test('resources: unknown stays null, never zero', () => {
  const A = resources().find(r => r.label === 'A');
  assert.equal(A.arms.maintained.usage.total, null); assert.equal(A.arms.maintained.toolCalls, null);
  assert.equal(A.arms.runtime.usage.total, 14487734); assert.equal(A.repairs[0].usage.total, 307434);
  assert.ok(A.adjudication.tokens.total > 0);
});
test('Cohen kappa', () => {
  assert.equal(cohenKappa([['a', 'a'], ['b', 'b']]), 1);
  assert.equal(cohenKappa([['a', 'a'], ['a', 'b'], ['b', 'b'], ['b', 'b']]), 0.5);
  assert.equal(cohenKappa([['a', 'a'], ['a', 'a']]), null); assert.equal(cohenKappa([]), null);
  assert.equal(compare([['a', 'a'], ['a', 'b']]).perClass[0].agree, 1);
});
test('agreement handles missing judge2 and empty human files', () => {
  const a = agreement({ verdictsFile: '/nonexistent/v.jsonl', humanFile: '/nonexistent/h.jsonl' });
  assert.equal(a.judge2Judged, 0); assert.equal(a.human.answers, 0); assert.equal(a.total, 540); assert.equal(a.judge1VsJudge2.n, 0);
});
test('paper numbers: every abstract claim is confirmed and cross-checks against derived.txt', () => {
  const text = renderPaperNumbers();
  assert.match(text, /Abstract claims checked: 18; confirmed exactly: 18; differ: 0/);
  assert.match(text, /A yes, B yes, C yes, D yes/);
  assert.ok(pilotNumbers().every(r => r.script && r.source));
});

test('follow-up agreement combines both Sol ledgers and isolates human overrides', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'followup-agreement-'));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  const interruption = 'campaign-e-20261118-e23c7f6';
  const continuation = 'campaign-e-20261118-continuation';
  const opus = 'campaign-f-20261118-opus';
  const trialId = 'same-id';
  const store = {
    listCampaigns: () => [interruption, continuation, opus, 'unrelated-smoke']
      .map(id => ({ id, label: id, live: true })),
    trialRows: id => [{
      trialId,
      classification: id === interruption ? null : 'true_pass',
      result: id === interruption ? 'infrastructure-invalid' : 'recorded',
    }],
  };
  const verdictsFile = path.join(dir, 'second.jsonl');
  const humanFile = path.join(dir, 'human.jsonl');
  fs.writeFileSync(verdictsFile, JSON.stringify({
    opaqueId: opaqueId(continuation, trialId), classification: 'true_pass',
  }) + '\n');
  fs.writeFileSync(humanFile, JSON.stringify({
    schema: 2, rater: 'local-owner', campaign: continuation, trialId, classification: 'false_alarm',
  }) + '\n');
  const result = agreement({ store, verdictsFile, humanFile, includeFollowups: true });
  assert.equal(result.total, 3);
  assert.equal(result.judge2Judged, 1);
  const { E, F } = result.human.byRater['local-owner'].byCampaign;
  assert.deepEqual(E.automated, { invalid: 1, true_pass: 1 });
  assert.deepEqual(E.withHumanOverrides, { invalid: 1, false_alarm: 1 });
  assert.equal(E.vsJudge2.matrix.false_alarm.true_pass, 1);
  assert.equal(E.checkedGrades[0].campaign, continuation);
  assert.deepEqual(F.automated, F.withHumanOverrides);
});
