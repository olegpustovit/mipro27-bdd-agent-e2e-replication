// Re-decode final agent responses with verdict parser v2. Never edits original runs.
// Parser v1 accepted only whole JSON or one fenced JSON object; v2 also accepts prose
// followed by one bare verdict object that ends the response (scripts/verdict.mjs).
// Only records whose decoded status changes are written, for regrading by both graders.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ledgerPaths } from '../../scripts/ledger/paths.mjs';
import { recordDigest, sha256 } from '../../scripts/campaign-guard.mjs';
import { decodeVerdict, scenarioAssertions, verdictParserVersion } from '../../scripts/verdict.mjs';
import { buildPacket } from '../../scripts/judge2/packet.mjs';

if (verdictParserVersion !== 2) throw new Error('Expected verdict parser v2');
// Every recorded runtime response was replayed with v2; only these sources change.
const sources = new Map([
  ['campaign-experiment4-opus', 12],
  ['campaign-f-20261118-opus-clock-recovery', 1],
]);
const root = join(ledgerPaths().dir, 'runs');
const feature = readFileSync(new URL('../../study/scenarios.feature', import.meta.url), 'utf8');
const readJsonl = file => readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);

for (const [sourceCampaign, expected] of sources) {
  const dir = join(root, sourceCampaign);
  if (existsSync(join(dir, 'journal.jsonl'))) {
    const journal = readJsonl(join(dir, 'journal.jsonl'));
    if (journal[0].type !== 'campaign-frozen' || journal.at(-1).type !== 'campaign-complete') throw new Error('Source campaign is not terminal: ' + sourceCampaign);
  }
  const campaign = sourceCampaign.replace(/-clock-recovery$/, '') + '-verdict-v2';
  const rows = readJsonl(join(dir, 'trials.jsonl')).flatMap(row => {
    const original = row.record, agent = original?.agent;
    if (row.type !== 'trial' || row.result !== 'recorded' || typeof agent?.rawResponse !== 'string') return [];
    if (recordDigest(original) !== original.recordSHA) throw new Error('Unverified original record: ' + original.trialId);
    const decoded = decodeVerdict(agent.rawResponse, scenarioAssertions(feature, original.trial.caseId));
    if (decoded.reportedStatus === agent.reportedStatus) return [];
    if (agent.reportedStatus !== 'unresolved' || agent.verdictFormat !== null || decoded.verdictFormat !== 'trailing-json') {
      throw new Error('Unexpected verdict change: ' + original.trialId);
    }
    const record = {
      ...original,
      agent: { ...agent, ...decoded },
      reportedStatus: decoded.reportedStatus,
      failedAssertion: decoded.failedAssertion,
      verdictRecovery: {
        sourceCampaign, sourceRecordSHA: original.recordSHA,
        fromParserVersion: agent.verdictParserVersion, toParserVersion: verdictParserVersion,
        sourceStatus: agent.reportedStatus, sourceParseError: agent.verdictParseError,
        responseUnchanged: true, modelsRerun: false,
      },
    };
    record.recordSHA = recordDigest(record);
    return [{ ...row, record }];
  });
  if (rows.length !== expected || new Set(rows.map(row => row.record.trialId)).size !== expected) throw new Error('Unexpected number of verdict changes: ' + campaign + ' ' + rows.length);
  const jsonl = rows.map(row => JSON.stringify(row)).join('\n') + '\n';
  const graderPacketCharacters = rows.reduce((total, row) => total + buildPacket(campaign, row).text.length, 0);
  if (process.argv.includes('--write')) {
    const destination = join(root, campaign);
    mkdirSync(destination, { mode: 0o700 });
    writeFileSync(join(destination, 'trials.jsonl'), jsonl, { flag: 'wx', mode: 0o600 });
  }
  console.log(JSON.stringify({ campaign, trials: rows.length, statuses: rows.map(row => row.record.reportedStatus), graderPacketCharacters, digest: sha256(jsonl), written: process.argv.includes('--write') }));
}
