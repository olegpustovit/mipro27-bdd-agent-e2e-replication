// Compare this harness's source and app pins with a recorded campaign's frozen inputs (journal line 1).
// Usage: node scripts/compare-pins.mjs <journal.jsonl> ...
import { readFileSync } from 'node:fs';
import { sourcePins, appPins } from '../harness/scripts/campaign-guard.mjs';
const src = sourcePins(), app = appPins();
for (const path of process.argv.slice(2)) {
  const inputs = JSON.parse(readFileSync(path, 'utf8').split('\n')[0]).inputs;
  const diff = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => a[k] !== b[k]);
  console.log(JSON.stringify({ journal: path.split('/').slice(-2).join('/'),
    appRevisionSame: inputs.appPins.revision === app.revision, appFilesDiffer: diff(inputs.appPins.files, app.files),
    sourceFilesDiffer: diff(inputs.sourcePins, src).length, sourceFiles: Object.keys(src).length,
    driver: inputs.driver ?? null, codex: inputs.codex }));
}
