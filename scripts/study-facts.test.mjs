import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { studyFacts, renderFacts, humanAgreement } from './study-facts.mjs';
import { listCampaigns, trialRows } from './lib/campaign-data.mjs';
test('corrected results match recorded judgments, preserving social asymmetry', () => {
  const facts = studyFacts();
  const numbers = s => [s.detections, s.faults, s.passes, s.healthy, s.falseAlarms];
  assert.deepEqual(facts.map(c => numbers(c.all)), [[43,48,38,60,13],[40,48,50,60,0],[40,48,50,60,0],[43,48,49,60,4]]);
  assert.deepEqual(facts.map(c => numbers(c.withoutSocial)), [[40,40,35,50,13],[40,40,49,50,0],[40,40,50,50,0],[39,40,44,50,4]]);
  assert.deepEqual(facts[0].repairs.map(r => [r.initialBroken.length,r.edits,r.suites,r.afterPasses,r.afterTotal]), [[12,2,3,5,12],[8,5,6,12,12]]);
  assert.equal(facts[0].maintained.detections,48);
  const empty=fs.mkdtempSync(path.join(os.tmpdir(),'facts-empty-'));
  try { assert.match(renderFacts({answerFile:path.join(empty,'absent.jsonl')}), /not started \(0\/40\)/); } finally { fs.rmSync(empty,{recursive:true,force:true}); }
});
test('agreement uses latest answer for each rater and trial, preserving disagreements', () => {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'human-agreement-'));
  try {
    const campaign=listCampaigns()[0].id, trial=trialRows(campaign)[0], sampleFile=path.join(temp,'sample.json'),answerFile=path.join(temp,'answers.jsonl');
    fs.writeFileSync(sampleFile,JSON.stringify([{campaign,trialId:trial.trialId,stratum:10}]));
    const a={schema:1,rater:'owner',campaign,trialId:trial.trialId,classification:'action_failure'};
    fs.writeFileSync(answerFile,JSON.stringify(a)+'\n');
    assert.match(humanAgreement({sampleFile,answerFile}),/human action_failure vs LLM true_pass/);
    fs.appendFileSync(answerFile,JSON.stringify({...a,classification:trial.classification})+'\n');
    const text=humanAgreement({sampleFile,answerFile}); assert.match(text,/overall: agree 1\/1/);assert.match(text,/stratum 10: agree 1\/1/);assert.doesNotMatch(text,/vs LLM/);
  } finally {fs.rmSync(temp,{recursive:true,force:true});}
});

test('resource accounting retains invalid-run costs and names missing measurements', async () => {
  const { resourceSummary } = await import('./study-facts.mjs');
  const make=(elapsedMs,result,usage)=>({result,record:{elapsedMs,agent:usage?{usage}:{}}});
  const rows=[make(10,'recorded',{input_tokens:10,cached_input_tokens:2,output_tokens:2}),make(20,'recorded',{input_tokens:20,cached_input_tokens:3,output_tokens:3}),make(100,'infrastructure-invalid',{input_tokens:30,cached_input_tokens:4,output_tokens:4}),make(undefined,'interrupted')];
  const r=resourceSummary(rows);
  assert.deepEqual(r.elapsed,{observed:3,missing:1,totalMs:130,recordedObserved:2,recordedMeanMs:15,recordedMedianMs:15});
  assert.equal(r.usage.input,null);assert.equal(r.usage.cachedInput,null);assert.equal(r.usage.nonCacheReadInput,null);assert.equal(r.usage.total,null);assert.equal(r.usage.inputObserved,3);assert.equal(r.usage.cacheReadObserved,3);assert.equal(r.usage.missing,1);assert.equal(r.usage.observedPairedTotal,69);
  const complete=resourceSummary(rows.slice(0,3)).usage;assert.equal(complete.input,60);assert.equal(complete.cachedInput,9);assert.equal(complete.nonCacheReadInput,51);assert.equal(complete.total,69);
  assert.equal(r.trials,4);assert.equal(r.recorded,2);assert.equal(resourceSummary([]).elapsed.recordedMeanMs,null);
  const real=studyFacts();
  assert.deepEqual(real.map(c=>c.resources.runtime.trials),[108,108,108,108]);
  assert.deepEqual(real.map(c=>c.resources.runtime.usage.total),[14487734,13949843,24288760,40418404]);
  assert.ok(real.every(c=>c.resources.runtime.usage.missing===0));
  assert.equal(real[0].resources.maintained.trials,108);
});

test('unknown cache counters and repair counters never become measured zero', async () => {
  const { usageSummary }=await import('./study-facts.mjs');
  for(const u of [{input_tokens:10,output_tokens:2},{input_tokens:10,cached_input_tokens:null,output_tokens:2},{input_tokens:10,cached_input_tokens:11,output_tokens:2}]){
    const r=usageSummary([u]);assert.equal(r.total,12);assert.equal(r.cachedInput,null);assert.equal(r.nonCacheReadInput,null);assert.equal(r.observed,0);assert.equal(r.cacheReadObserved,0);
  }
  assert.equal(usageSummary([undefined]).total,null);assert.equal(usageSummary([]).total,null);
  const omp=usageSummary([{input_tokens:20,cached_input_tokens:10,cache_write_input_tokens:4,output_tokens:3}]);
  assert.equal(omp.nonCacheReadInput,10);assert.equal(omp.cacheWriteInput,4);assert.equal(omp.newInputExcludingCacheWrites,6);
  for(const repair of studyFacts()[0].repairs){assert.equal(repair.usage.total,repair.tokens);assert.equal(repair.usage.missing,0);assert.ok(repair.usage.cachedInput>=0);}
});
