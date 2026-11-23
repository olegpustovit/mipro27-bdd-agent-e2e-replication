// Writes the new (additive) pilot result files. Called at the end of `npm run analyze`; never touches the original outputs.
import fs from 'node:fs';
import { root } from './pilot.mjs';
import { renderTables, renderResources, renderSuperseded, agreement, renderAgreement } from './report.mjs';
import { renderPaperNumbers } from './paper-numbers.mjs';
export function writeAll() {
  const files = { 'pilot-tables.txt': renderTables(), 'pilot-resources.txt': renderResources(), 'superseded-lines.txt': renderSuperseded(), 'judge-agreement.txt': renderAgreement(agreement({ includeFollowups: true })), 'paper-numbers.txt': renderPaperNumbers() };
  for (const [n, t] of Object.entries(files)) fs.writeFileSync(`${root}results/${n}`, t);
  return Object.keys(files);
}
import { fileURLToPath } from 'node:url';
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log('Wrote results/' + writeAll().join(', results/'));
