// Check that each campaign's frozen source pins match the git commit named in its id.
// Usage: node scripts/verify-source-pins.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'data', 'campaigns');
let failed = false;
for (const id of fs.readdirSync(dataDir).sort()) {
  const commit = id.split('-').at(-1);
  const frozen = fs.readFileSync(path.join(dataDir, id, 'journal.jsonl'), 'utf8').split('\n')
    .filter(Boolean).map(l => JSON.parse(l)).find(l => l.type === 'campaign-frozen');
  if (!frozen) { console.log(`${id}: no campaign-frozen record`); failed = true; continue; }
  let match = 0; const bad = [];
  for (const [file, want] of Object.entries(frozen.inputs.sourcePins)) {
    let got;
    try { got = crypto.createHash('sha256').update(execFileSync('git', ['show', `${commit}:${file}`], { cwd: root, maxBuffer: 1 << 28 })).digest('hex'); }
    catch { got = 'missing'; }
    if (got === want) match++; else bad.push(`${file} (${got === 'missing' ? 'missing' : 'differs'})`);
  }
  console.log(`${id} @ ${commit}: ${match}/${match + bad.length} source pins match${bad.length ? '; ' + bad.join(', ') : ''}`);
  if (bad.length) failed = true;
}
process.exit(failed ? 1 : 0);
