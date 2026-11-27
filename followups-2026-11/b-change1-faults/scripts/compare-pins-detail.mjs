// List pinned source files that exist in both a recorded campaign and this harness but differ in content.
import { readFileSync } from 'node:fs';
import { sourcePins } from '../harness/scripts/campaign-guard.mjs';
const src = sourcePins();
for (const path of process.argv.slice(2)) {
  const pins = JSON.parse(readFileSync(path, 'utf8').split('\n')[0]).inputs.sourcePins;
  const both = Object.keys(pins).filter(k => k in src);
  console.log(path.split('/').slice(-2)[0], 'pinned', Object.keys(pins).length, 'present-now', both.length,
    'missing-now', Object.keys(pins).filter(k => !(k in src)).join(',') || '-', '\n  changed:', both.filter(k => pins[k] !== src[k]).join(' '));
}
