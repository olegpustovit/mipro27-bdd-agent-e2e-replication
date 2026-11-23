import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zstdDecompressSync } from 'node:zlib';
import { dataDir as studyDataDir } from '../ledger/paths.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
export function createCampaignStore({ dataDir = path.join(repo, 'data/campaigns'), liveDir = path.join(studyDataDir(), 'runs') } = {}) {
  const cache = new Map();
  function listCampaigns({ includeLive = false } = {}) {
    const dirs = dir => fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).filter(x => x.isDirectory() && !x.isSymbolicLink()).map(x => x.name).sort() : [];
    const ids = dirs(dataDir);
    const label = id => /^campaign-20261101-/.test(id) ? 'A' : /^campaign-([bcd])-20261101-/.exec(id)?.[1].toUpperCase() || id;
    return [...ids.map(id => ({ id, label: label(id), live: false })), ...(includeLive ? dirs(liveDir).filter(id => !ids.includes(id)).map(id => ({ id, label: label(id), live: true })) : [])];
  }
  function loadCampaign(id) {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Unknown campaign');
    const entry = listCampaigns({ includeLive: true }).find(x => x.id === id);
    if (!entry) throw new Error('Unknown campaign');
    const dir = path.join(entry.live ? liveDir : dataDir, id);
    const names = ['journal.jsonl', 'adjudication.jsonl', 'trials.jsonl', 'trials.jsonl.zst'];
    const signature = names.map(name => {
      try { const s = fs.lstatSync(path.join(dir, name), { bigint: true }); if (!s.isFile() || s.isSymbolicLink()) throw new Error('Not a regular campaign file'); return `${s.mtimeNs}:${s.size}`; }
      catch (e) { if (e.code === 'ENOENT') return '-'; throw e; }
    }).join('|');
    if (cache.get(id)?.signature === signature) return cache.get(id).data;
    const read = name => {
      const file = path.join(dir, name);
      if (!fs.existsSync(file)) return [];
      let text = name.endsWith('.zst') ? zstdDecompressSync(fs.readFileSync(file)).toString() : fs.readFileSync(file, 'utf8');
      // Live writers may be between writes; never treat an unfinished final line as a trial.
      if (entry.live && !text.endsWith('\n')) text = text.slice(0, text.lastIndexOf('\n') + 1);
      return text.split('\n').filter(Boolean).map(JSON.parse);
    };
    const data = { ...entry, journal: read('journal.jsonl'), adjudication: read('adjudication.jsonl'), trials: read(fs.existsSync(path.join(dir, 'trials.jsonl')) ? 'trials.jsonl' : 'trials.jsonl.zst') };
    const seen = new Set();
    for (const trial of data.trials) { const key = trial.record?.trial?.id; if (!key || seen.has(key)) throw new Error('Missing or duplicate trial id'); seen.add(key); }
    cache.set(id, { signature, data });
    return data;
  }
  function trialRows(id) {
    const data = loadCampaign(id), verdicts = new Map(data.adjudication.map(x => [x.trialId, x]));
    return data.trials.map(({ record, result }) => {
      const t = record.trial, a = verdicts.get(t.id), usage = record.agent?.usage;
      return { trialId: t.id, stage: t.stage, kind: t.kind, revision: t.revision, repetition: t.repetition, caseId: t.caseId, arm: t.arm, reportedStatus: record.reportedStatus, elapsedMs: record.elapsedMs, tokens: (usage?.input_tokens || 0) + (usage?.output_tokens || 0), classification: a?.classification ?? null, evidence: a?.evidence ?? null, confidence: a?.confidence ?? null, result };
    });
  }
  function trialTrace(id, trialId) {
    const data = loadCampaign(id), row = data.trials.find(x => x.record.trial.id === trialId);
    if (!row) return null;
    const r = row.record, steps = [];
    for (const item of r.agent?.ledger || []) {
      if (item.type === 'tool-call') steps.push({ name: item.name, arguments: item.arguments, text: null, isError: false });
      if (item.type === 'tool-result') {
        const step = steps.findLast(x => x.text === null);
        if (step) { step.text = (item.result?.content || []).map(x => x.text || '').join('\n'); step.isError = Boolean(item.result?.isError); }
      }
    }
    return { header: { trialId, ...r.trial, reportedStatus: r.reportedStatus, failedAssertion: r.failedAssertion, rawResponse: r.agent?.rawResponse, elapsedMs: r.elapsedMs, result: row.result }, steps, checks: r.observation?.checks || [], baselineFailures: r.baseline?.stepFailures || [], adjudication: data.adjudication.find(x => x.trialId === trialId) ?? null };
  }
  function maintenance(id) {
    return loadCampaign(id).journal.filter(x => x.type === 'maintenance-finished').map(({ record: r }) => { const usage=r.agent?.usage ?? null; const known=[usage?.input_tokens,usage?.output_tokens].every(n=>Number.isSafeInteger(n)&&n>=0); return ({ from: r.from, revision: r.revision, elapsedMs: r.elapsedMs, edits: r.frozen?.edits, suites: r.frozen?.validations, initialCases: r.initialValidation?.cases || [], initialBroken: (r.initialValidation?.cases || []).filter(x => x.failures?.length > 0 || x.code !== 0), usage, tokens: known ? usage.input_tokens+usage.output_tokens : null, agentFinal: r.agent?.rawResponse }); });
  }
  return { listCampaigns, loadCampaign, trialRows, trialTrace, maintenance };
}
export const { listCampaigns, loadCampaign, trialRows, trialTrace, maintenance } = createCampaignStore();
