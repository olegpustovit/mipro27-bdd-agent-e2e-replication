import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataHome } from '../../adapters/moodle/config.mjs';
import { parseFeature } from '../../adapters/moodle/gherkin.mjs';
import { run } from '../../adapters/moodle/shell.mjs';

const bugs = fileURLToPath(new URL('./', import.meta.url));
const bench = join(bugs, '..');
const read = path => readFileSync(path, 'utf8');
const changes = new Map(JSON.parse(read(join(bench, 'apps/moodle/changes.json'))).changes.map(change => [change.id, change]));
const units = [...read(join(bench, 'plan/bug-candidates.md')).matchAll(/^\| (B\d+)\/(S\d+) \| re-created-from-report \|/gm)]
  .map(([, change, scenario]) => `mdl-${change}-${scenario}`).sort();
const folders = readdirSync(bugs).filter(name => /^mdl-B\d+-S\d+$/.test(name)).sort();
assert.equal(units.length, 19);
assert.deepEqual(folders, units);

const checkFiles = ['mdl-check.mjs', ...folders.map(folder => join(folder, 'check.mjs'))];
for (const path of checkFiles) {
  assert.doesNotMatch(read(join(bugs, path)), /(?:import|from|require)[^\n]*['"][^'"]*(?:stepdefs|agent)\//);
  await run(process.execPath, ['--check', join(bugs, path)]);
}

for (const folder of folders) {
  const [, change, scenario] = folder.split('-');
  const entry = changes.get(change);
  const path = join(bugs, folder);
  assert.deepEqual(readdirSync(path).sort(), ['applies-to.json', 'check.mjs', 'patch.diff', 'source.md', 'symptom.md']);
  assert.deepEqual(JSON.parse(read(join(path, 'applies-to.json'))), [entry.post]);
  const fixture = entry.scenarios.find(item => item.id === scenario).post.scenarioTextPath;
  const { steps } = parseFeature(read(join(bench, fixture))).scenarios[0];
  const [, number, text] = /Targeted step (\d+)\n\n> (.*)/.exec(read(join(path, 'symptom.md')));
  const step = steps[Number(number) - 1];
  assert.equal(text, `${step.keyword} ${step.text}`, folder);
  const cwd = join(dataHome(), 'src', entry.post.slice(0, 12));
  const head = await run('git', ['rev-parse', 'HEAD'], { cwd });
  assert.equal(head.stdout.trim(), entry.post);
  await run('git', ['apply', '--check', join(path, 'patch.diff')], { cwd });
  console.log(`PASS ${folder} applies at ${entry.post}, step ${number}`);
}
console.log(`PASS ${folders.length} Moodle bug folders and ${checkFiles.length} check modules`);
