import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { selectHumanSample, writeHumanSample } from './human-sample.mjs';
import { trialRows } from './lib/campaign-data.mjs';
test('review queue preserves the 40-entry stratified sample and is reproducible', () => {
  const sample=selectHumanSample(); assert.deepEqual(sample,selectHumanSample()); assert.equal(sample.length,65);assert.equal(new Set(sample.map(t=>t.campaign+':'+t.trialId)).size,65);
  assert.deepEqual(Array.from({length:10},(_,i)=>sample.filter(t=>t.stratum===i+1).length),[15,1,3,4,3,2,4,3,3,2]);
  const maintained=sample.filter(t=>t.stratum===10).map(t=>trialRows(t.campaign).find(r=>r.trialId===t.trialId));assert.deepEqual(maintained.map(t=>t.classification),['supported_detection','action_failure']);assert.ok(maintained.every(t=>t.arm==='maintained'));
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'human-sample-'));try {const file=path.join(temp,'sample.json');writeHumanSample(file);assert.throws(()=>writeHumanSample(file),{code:'EEXIST'});writeHumanSample(file,{force:true});assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),sample);}finally{fs.rmSync(temp,{recursive:true,force:true});}
});
