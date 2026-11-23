// Pure decoding/classification replay from original NDJSON on stdin. Does not
// launch browsers/models, write results, change observations, or replace trials.
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { decodeVerdict, scenarioAssertions, verdictParserVersion } from './verdict.mjs';
import { classify } from './outcomes.mjs';
const feature = readFileSync(new URL('../study/scenarios.feature', import.meta.url), 'utf8');
const featureHash = createHash('sha256').update(feature).digest('hex');
const key = event => `${event.caseId}/${event.condition}/${event.repetition}/${event.arm}`;
const results = new Map(), scripted = new Map(), seen = new Set();
let count = 0;
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  if (!line.trim()) continue;
  const event = JSON.parse(line);
  if (event.type === 'run-start' && event.featureHash !== featureHash) throw new Error('Replay feature hash differs from original run');
  if (event.type === 'baseline-initial') scripted.set(key(event), event);
  if (event.type === 'agent-event' && event.event?.type === 'result') {
    if (results.has(key(event))) throw new Error(`Duplicate final model result: ${key(event)}`);
    results.set(key(event), event.event.result);
  }
  if (event.type !== 'trial-end') continue;
  if (seen.has(key(event))) throw new Error(`Duplicate original trial-end: ${key(event)}`);
  seen.add(key(event));
  count++;
  const verdict = event.agent ? decodeVerdict(results.get(key(event)), scenarioAssertions(feature, event.caseId)) : null;
  const status = event.arm === 'runtime' ? verdict?.reportedStatus || 'unresolved' : event.reportedStatus;
  const lastScripted = [...(event.ledger || [])].reverse().find(item => item.type === 'baseline-run') || scripted.get(key(event));
  const assertionFailure = event.arm === 'runtime' ? Boolean(verdict?.failedAssertionVerified) : Boolean(event.assertionFailure);
  const revised = classify({ healthy: event.expectedHealthy, status, observation: event.oracle, modelVerified: !event.agent || event.agent.modelVerified, timedOut: event.timedOut, assertionFailure, scenarioCount: lastScripted?.scenarioCount ?? 1 });
  const output = { type: 'verdict-replay', excludedFromStudy: true, verdictParserVersion, featureHash, caseId: event.caseId, condition: event.condition, repetition: event.repetition, arm: event.arm, observationsUnchanged: true, modelsRerun: false, original: { reportedStatus: event.reportedStatus, assertionFailure: event.assertionFailure, blocked: event.blocked, correctPass: event.correctPass, unjustifiedPass: event.unjustifiedPass, detectionCandidate: event.detectionCandidate }, decoded: verdict, revised: { reportedStatus: status, assertionFailure, ...revised } };
  if (!process.stdout.write(`${JSON.stringify(output)}\n`)) await once(process.stdout, 'drain');
}
if (!count) throw new Error('No original trial-end records supplied');
