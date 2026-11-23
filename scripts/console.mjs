import http from 'node:http';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as campaignStore from './lib/campaign-data.mjs';
import { opaqueId, scenarioText } from './judge2/packet.mjs';
import { loadSecondJudgments } from './analysis/agreement.mjs';
import { contracts } from '../study/contracts.mjs';
import { faults } from './mutations.mjs';
const root = new URL('../', import.meta.url);
const reviewMode = 'fault-visible-automated-grades-hidden';
const revisionDescriptions = {
  v0: 'Original interface.',
  v1: 'Control labels changed and public test hooks acquired the v1 prefix.',
  v2: 'The v1 changes remain. Account controls moved into a menu, and deleting a bank account requires confirmation.',
};
export const taxonomy = {
  healthy: ['true_pass', 'false_alarm', 'action_failure', 'unsupported_healthy_pass', 'unresolved', 'invalid'],
  fault: ['supported_detection', 'wrong_reason', 'unsupported_pass', 'no_opportunity', 'action_failure', 'unresolved', 'invalid'],
};
const fail = (status, message) => Object.assign(new Error(message), { status });
export function createConsole({ env = process.env, store = campaignStore, repo = root, log = line => console.error(line) } = {}) {
  if (env.CONSOLE_HOST && env.CONSOLE_HOST !== '127.0.0.1') throw new Error('Console host must be 127.0.0.1');
  const sampleFile = new URL('data/human-sample.json', repo), answerFile = new URL('data/human-adjudication.jsonl', repo);
  const sample = () => JSON.parse(fs.readFileSync(sampleFile, 'utf8'));
  const secondGrade = (id, trialId) => {
    const grade = loadSecondJudgments().get(opaqueId(id, trialId));
    return grade ? { classification: grade.classification, evidence: grade.reason, confidence: grade.confidence } : null;
  };
  const answers = rater => {
    const latest = new Map();
    if (fs.existsSync(answerFile)) for (const a of fs.readFileSync(answerFile, 'utf8').split('\n').filter(Boolean).map(JSON.parse)) if (a.rater === rater) latest.set(`${a.campaign}:${a.trialId}`, a);
    return latest;
  };
  const server = http.createServer(async (req, res) => {
    const reply = (status, body, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
      res.end(type === 'application/json' ? JSON.stringify(body) : body);
    };
    try {
      const url = new URL(req.url, 'http://localhost'), route = url.pathname;
      const host = new URL(`http://${req.headers.host || ''}`);
      if (!['localhost', '127.0.0.1', '[::1]'].includes(host.hostname)) throw fail(403, 'Use localhost or a loopback port forward');
      const rater = 'local-owner';
      const canWrite = true;
      if (req.method === 'GET') {
        if (route === '/') return reply(200, fs.readFileSync(new URL('ui/console.html', repo)), 'text/html; charset=utf-8');
        if (route === '/api/campaigns') return reply(200, store.listCampaigns({ includeLive: true }));
        if (route === '/api/overview') {
          const latest = answers(rater), selected = sample();
          const campaigns = store.listCampaigns({ includeLive: true }).map(c => {
            const data = store.loadCampaign(c.id), frozen = data.journal.find(x => x.type === 'campaign-frozen');
            return { ...c, planned: frozen?.inputs?.config?.executions ?? null, started: data.journal.filter(x => x.type === 'trial-started').length, finished: data.journal.filter(x => x.type === 'trial-finished').length, complete: data.journal.some(x => x.type === 'campaign-complete'), maintenance: store.maintenance(c.id) };
          });
          return reply(200, { campaigns, human: { done: selected.filter(x => latest.has(`${x.campaign}:${x.trialId}`)).length, total: selected.length, canWrite }, paperSteps: JSON.parse(fs.readFileSync(new URL('docs/paper-steps.json', repo), 'utf8')), paperSource: 'Research Foundry is the source of truth; paper steps here are a planning snapshot.' });
        }
        if (route === '/api/human/sample') {
          const latest = answers(rater);
          return reply(200, { canWrite, entries: sample().map(s => {
            const answer = latest.get(`${s.campaign}:${s.trialId}`);
            return { ...s, done: Boolean(answer), ...(answer ? { answer, adjudication: store.trialTrace(s.campaign, s.trialId)?.adjudication } : {}) };
          }) });
        }
        const match = /^\/api\/campaigns\/([^/]+)\/(rows|trace)$/.exec(route);
        if (match) {
          const id = decodeURIComponent(match[1]);
          if (!store.listCampaigns({ includeLive: true }).some(c => c.id === id)) throw fail(404, 'Unknown campaign');
          if (match[2] === 'rows') return reply(200, store.trialRows(id));
          const trialId = url.searchParams.get('trial'), trace = store.trialTrace(id, trialId);
          if (!trace) throw fail(404, 'Unknown trial');
          if (url.searchParams.get('blind') === '1') {
            if (!sample().some(s => s.campaign === id && s.trialId === trialId)) throw fail(400, 'Trial outside human sample');
            const { kind, stage, revision, caseId, elapsedMs } = trace.header;
            const answer = answers(rater).get(`${id}:${trialId}`);
            const fault = kind === 'fault' ? faults[caseId] : null;
            const context = {
              scenario: scenarioText(caseId),
              contract: contracts[caseId],
              revision: revisionDescriptions[revision],
              fault: fault ? { file: fault[0], before: fault[1], after: fault[2] } : null,
              reviewMode,
            };
            return reply(200, { header: { kind, stage, revision, caseId, elapsedMs }, context, execution: { reportedStatus: trace.header.reportedStatus, failedAssertion: trace.header.failedAssertion, rawResponse: trace.header.rawResponse }, steps: trace.steps, checks: trace.checks, baselineFailures: trace.baselineFailures, taxonomy: taxonomy[kind], ...(answer ? { answer, adjudication: trace.adjudication, secondAdjudication: secondGrade(id, trialId) } : {}) });
          }
          return reply(200, trace);
        }
        throw fail(404, 'Not found');
      }
      if (req.method !== 'POST' || route !== '/api/human') throw fail(405, 'Method not allowed');
      if (req.headers.origin) {
        let origin;
        try { origin = new URL(req.headers.origin); } catch { throw fail(403, 'Invalid origin'); }
        if (origin.host !== req.headers.host || !['http:', 'https:'].includes(origin.protocol)) throw fail(403, 'Cross-origin write refused');
      }
      if (!req.headers['content-type']?.startsWith('application/json')) throw fail(415, 'JSON required');
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 8192) throw fail(413, 'Request too large'); }
      let body;
      try { body = JSON.parse(raw); } catch { throw fail(400, 'Invalid JSON'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400, 'JSON object required');
      const { campaign, trialId, classification, confidence, note = '', checkpointAnswers = {} } = body;
      if (!sample().some(s => s.campaign === campaign && s.trialId === trialId)) throw fail(400, 'Trial outside human sample');
      const trace = store.trialTrace(campaign, trialId);
      if (!taxonomy[trace?.header.kind]?.includes(classification)) throw fail(400, 'Invalid classification for trial kind');
      if (!['sure', 'unsure'].includes(confidence)) throw fail(400, 'Choose sure or unsure');
      if (typeof note !== 'string' || note.length > 1000) throw fail(400, 'Note must be at most 1000 characters');
      const checkpointIds = new Set(trace.checks.map(check => check.id));
      const checkpointChoices = new Set(['met', 'unmet', 'not-reached', 'uncertain']);
      if (!checkpointAnswers || typeof checkpointAnswers !== 'object' || Array.isArray(checkpointAnswers) ||
          Object.entries(checkpointAnswers).some(([id, choice]) => !checkpointIds.has(id) || !checkpointChoices.has(choice))) {
        throw fail(400, 'Invalid checkpoint answer for this run');
      }
      const answer = { at: new Date().toISOString(), rater, campaign, trialId, classification, confidence, note, checkpointAnswers, reviewMode, schema: 2 };
      // The console's sole write: append a complete answer; corrections never replace history.
      fs.appendFileSync(answerFile, JSON.stringify(answer) + '\n', { mode: 0o600 });
      return reply(200, { answer, adjudication: trace.adjudication, secondAdjudication: secondGrade(campaign, trialId), agree: trace.adjudication ? classification === trace.adjudication.classification : null });
    } catch (e) { reply(e.status || 500, { error: e.status ? e.message : 'Console could not read or save data' }); }
    finally { log(`${req.method} ${new URL(req.url, 'http://localhost').pathname} ${res.statusCode}`); }
  });
  return server;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.CONSOLE_PORT || 7878);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid CONSOLE_PORT');
  createConsole().listen(port, '127.0.0.1', () => console.error(`Console listening at http://127.0.0.1:${port}`));
}
