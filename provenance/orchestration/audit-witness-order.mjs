// Offline audit of the frozen Cypress campaigns. Never modifies their ledgers.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import { ledgerPaths } from '../../scripts/ledger/paths.mjs';
import { observationLedgerError } from '../../scripts/witness.mjs';

const archived = new URL('../../data/campaigns/', import.meta.url);
const live = join(ledgerPaths().dir, 'runs');
const factsMode = process.argv.includes('--facts');
if (factsMode) console.log('Cypress post-hoc clock-order validity audit');
const clockError = 'Private document clocks contradict acknowledged navigation order';
const files = [
  ...readdirSync(archived).map(id => [id, zstdDecompressSync(readFileSync(new URL(id + '/trials.jsonl.zst', archived)))]),
  ...readdirSync(live).filter(id => /^campaign-[ef]-/.test(id) && !id.endsWith('-clock-recovery'))
    .map(id => [id, readFileSync(join(live, id, 'trials.jsonl'))]),
];

for (const [campaign, raw] of files) {
  const summary = { campaign, previouslyRecorded: 0, previouslyInvalid: 0,
    recordedBoundaryPass: 0, otherInvalid: 0, clockRejected: 0, inferredBoundaryPass: 0, remainingErrors: [] };
  for (const { result, record } of raw.toString().trim().split('\n').map(JSON.parse)) {
    if (result === 'recorded') summary.previouslyRecorded++;
    else summary.previouslyInvalid++;
    const witness = record.witness;
    const final = witness?.finalObservation;
    if (final) {
      const error = observationLedgerError(witness, { ...final, state: { documentId: final.documentId } });
      if (error) summary.remainingErrors.push({ trial: record.trialId, error });
      else summary.recordedBoundaryPass++;
    } else if (record.error === clockError) {
      summary.clockRejected++;
      // The old error was raised only after a successful forced capture and
      // full delivery validation. The old runner omitted that capture receipt.
      // Test its last recorded sample provisionally; do not synthesize a receipt.
      const last = witness.events.at(-1);
      const error = last?.kind === 'ui-state' ?
        observationLedgerError(witness, { state: { documentId: last.documentId }, throughSequence: last.browserSequence }) :
        'No terminal UI sample';
      if (error) summary.remainingErrors.push({ trial: record.trialId, error });
      else summary.inferredBoundaryPass++;
    } else if (result === 'recorded') {
      summary.remainingErrors.push({ trial: record.trialId, error: 'Recorded run missing final observation' });
    } else {
      summary.otherInvalid++;
    }
  }
  if (!factsMode) {
    console.log(JSON.stringify(summary));
    continue;
  }
  if (summary.remainingErrors.length) throw new Error('Unresolved evidence-order checks in ' + campaign);
  const total = summary.previouslyRecorded + summary.previouslyInvalid;
  const usable = summary.previouslyRecorded + summary.inferredBoundaryPass;
  console.log(`cypress.clock_recovery.${campaign}.usable | ${summary.previouslyRecorded}/${total} originally, ${usable}/${total} after re-evaluation | provenance/orchestration/audit-witness-order.mjs | frozen campaign trials`);
}
