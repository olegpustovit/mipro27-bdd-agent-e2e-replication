import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { agreement, loadJudgments } from '../../scripts/analysis/agreement.mjs';

test('latest human answer changes only its campaign and retains both judge comparisons', t => {
  const trial = loadJudgments().rows.find(row => row.campaign.startsWith('campaign-b-') &&
    row.judge1 === 'true_pass' && row.judge2 === 'true_pass');
  assert.ok(trial);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rescue-override-'));
  t.after(() => fs.rmSync(directory, { recursive: true }));
  const humanFile = path.join(directory, 'answers.jsonl');
  const base = { schema: 2, rater: 'local-owner', campaign: trial.campaign, trialId: trial.trialId };
  fs.writeFileSync(humanFile, [
    { ...base, classification: 'invalid' },
    { ...base, classification: 'false_alarm' },
  ].map(row => JSON.stringify(row)).join('\n') + '\n');
  const result = agreement({ humanFile });
  const owner = result.human.byRater['local-owner'];
  assert.equal(result.human.answers, 1);
  assert.equal(owner.byCampaign.B.checked, 1);
  for (const grade of [owner.vsJudge1, owner.vsJudge2]) {
    assert.equal(grade.n, 1);
    assert.equal(grade.agree, 0);
    assert.equal(grade.matrix.false_alarm.true_pass, 1);
  }
  const { automated, withHumanOverrides } = owner.byCampaign.B;
  assert.equal(withHumanOverrides.true_pass, automated.true_pass - 1);
  assert.equal(withHumanOverrides.false_alarm, (automated.false_alarm ?? 0) + 1);
  assert.deepEqual(owner.byCampaign.C.withHumanOverrides, owner.byCampaign.C.automated);
});
