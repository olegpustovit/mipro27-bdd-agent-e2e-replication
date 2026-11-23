import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listCampaigns, loadCampaign, trialRows, trialTrace, maintenance, createCampaignStore } from './lib/campaign-data.mjs';

test('all committed campaigns have unique adjudicated trials and exact counts', () => {
  const campaigns = listCampaigns();
  assert.equal(campaigns.length, 4);
  for (const c of campaigns) { const rows = trialRows(c.id); assert.equal(rows.length, c.label === 'A' ? 216 : 108); assert.equal(new Set(rows.map(x => x.trialId)).size, rows.length); assert.ok(rows.every(x => x.classification)); assert.strictEqual(loadCampaign(c.id), loadCampaign(c.id)); }
});
test('real traces preserve paired tool evidence and real maintenance breakage', () => {
  const campaigns = listCampaigns();
  const trace = trialTrace(campaigns.find(x => x.label === 'B').id, 'healthy-v0-1/social-like/runtime');
  assert.equal(trace.steps.length, 12);
  assert.ok(trace.steps.some(x => JSON.stringify(x.arguments).includes('1xfcAhNDZK4')));
  assert.ok(trace.steps.every(x => x.text !== null));
  assert.equal(trialTrace(campaigns[0].id, 'missing'), null);
  assert.deepEqual(maintenance(campaigns[0].id).map(x => [x.from, x.revision, x.initialBroken.length, x.edits, x.suites]), [['v0', 'v1', 12, 2, 3], ['v1', 'v2', 8, 5, 6]]);
  assert.throws(() => loadCampaign('../escape'), /Unknown/);
});
test('live data is optional, deduplicated, cached and refreshed after writes', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-loader-'));
  try {
    const dataDir = path.join(temp, 'data'), liveDir = path.join(temp, 'live');
    fs.mkdirSync(path.join(dataDir, 'same'), { recursive: true }); fs.mkdirSync(path.join(liveDir, 'same'), { recursive: true }); fs.mkdirSync(path.join(liveDir, 'new'), { recursive: true });
    const store = createCampaignStore({ dataDir, liveDir });
    assert.equal(store.listCampaigns().length, 1); assert.equal(store.listCampaigns({ includeLive: true }).length, 2);
    const before = store.loadCampaign('new');
    fs.writeFileSync(path.join(liveDir, 'journal.jsonl'), '');
    const file = path.join(liveDir, 'new/journal.jsonl'); fs.writeFileSync(file, '{"type":"trial-started"}\n{"type":');
    assert.equal(store.loadCampaign('new').journal.length, 1); assert.notStrictEqual(store.loadCampaign('new'), before);
    fs.appendFileSync(file, '"trial-finished"}\n'); assert.equal(store.loadCampaign('new').journal.length, 2);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('maintenance keeps missing input or output tokens unknown', () => {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'repair-usage-'));
  try {
    const dataDir=path.join(temp,'data');fs.mkdirSync(path.join(dataDir,'repair'),{recursive:true});
    fs.writeFileSync(path.join(dataDir,'repair/journal.jsonl'),[{revision:'v1'},{revision:'v2',agent:{usage:{input_tokens:10}}},{revision:'v3',agent:{usage:{input_tokens:10,output_tokens:2}}}].map(record=>JSON.stringify({type:'maintenance-finished',record})).join('\n')+'\n');
    const store=createCampaignStore({dataDir,liveDir:path.join(temp,'none')});
    assert.deepEqual(store.maintenance('repair').map(r=>r.tokens),[null,null,12]);
    assert.equal(store.maintenance('repair')[0].usage,null);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
