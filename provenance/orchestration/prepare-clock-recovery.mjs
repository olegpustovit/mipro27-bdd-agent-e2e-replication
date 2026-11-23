// Derive grading records from the exact clock rejection. Never edits original runs.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ledgerPaths } from '../../scripts/ledger/paths.mjs';
import { recordDigest, sha256 } from '../../scripts/campaign-guard.mjs';
import { evaluateCalibration } from '../../scripts/scenario-evaluation.mjs';
import { observationLedgerError } from '../../scripts/witness.mjs';
import { buildPacket } from '../../scripts/judge2/packet.mjs';

const sources = new Map([
  ['campaign-e-20261118-continuation', 16],
  ['campaign-f-20261118-opus', 20],
]);
const root = join(ledgerPaths().dir, 'runs');
const feature = readFileSync(new URL('../../study/scenarios.feature', import.meta.url), 'utf8');
const readJsonl = file => readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);

for (const [sourceCampaign, expected] of sources) {
  const dir = join(root, sourceCampaign);
  const journal = readJsonl(join(dir, 'journal.jsonl'));
  if (journal[0].type !== 'campaign-frozen' || journal.at(-1).type !== 'campaign-complete') throw new Error('Source campaign is not terminal: ' + sourceCampaign);
  const { sourcePins } = journal[0].inputs;
  const finished = new Map(journal.filter(row => row.type === 'trial-finished').map(row => [row.trial.id, row]));
  const campaign = sourceCampaign + '-clock-recovery';
  const rows = readJsonl(join(dir, 'trials.jsonl')).flatMap(row => {
    const original = row.record;
    if (original.error !== 'Private document clocks contradict acknowledged navigation order') return [];
    const terminal = finished.get(original.trialId);
    if (row.result !== 'infrastructure-invalid' || terminal?.result !== row.result ||
        terminal.recordSHA !== original.recordSHA || recordDigest(original) !== original.recordSHA ||
        original.quiescent !== true || !original.agent?.privateAuditComplete) throw new Error('Unverified original record: ' + original.trialId);
    const previous = original.witness;
    const tail = previous.events.at(-1);
    if (previous.finalObservation || tail?.kind !== 'ui-state' ||
        previous.events.findLast(event => event.kind === 'navigation')?.documentId !== tail.documentId) {
      throw new Error('Cannot derive final sample: ' + original.trialId);
    }
    const boundary = { documentId: tail.documentId, throughSequence: tail.browserSequence };
    const error = observationLedgerError(previous, { ...boundary, state: { documentId: boundary.documentId } });
    if (error) throw new Error(original.trialId + ': ' + error);
    const witness = { ...previous, finalObservation: boundary };
    const observation = evaluateCalibration({ caseId: original.trial.caseId, revision: original.trial.revision, sourcePins, witness }, feature);
    const record = { ...original, error: null, witness, observation, recovery: {
      sourceCampaign, sourceRecordSHA: original.recordSHA, sourceError: original.error,
      finalBoundary: 'inferred-from-terminal-ui-state-after-successful-capture', terminalHostSequence: tail.sequence,
    } };
    record.recordSHA = recordDigest(record);
    return [{ ...row, result: 'recorded', record }];
  });
  if (rows.length !== expected || new Set(rows.map(row => row.record.trialId)).size !== expected) throw new Error('Unexpected number of recovery candidates: ' + campaign);
  const jsonl = rows.map(row => JSON.stringify(row)).join('\n') + '\n';
  const graderPacketCharacters = rows.reduce((total, row) => total + buildPacket(campaign, row).text.length, 0);
  if (process.argv.includes('--write')) {
    const destination = join(root, campaign);
    mkdirSync(destination, { mode: 0o700 });
    writeFileSync(join(destination, 'trials.jsonl'), jsonl, { flag: 'wx', mode: 0o600 });
  }
  console.log(JSON.stringify({ campaign, trials: rows.length, graderPacketCharacters, digest: sha256(jsonl), written: process.argv.includes('--write') }));
}
