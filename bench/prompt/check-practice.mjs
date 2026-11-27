import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AstBuilder, GherkinClassicTokenMatcher, Parser } from '@cucumber/gherkin';
import { IdGenerator } from '@cucumber/messages';

const bench = fileURLToPath(new URL('../', import.meta.url));
const study = join(bench, '../study/scenarios.feature');
const plan = JSON.parse(readFileSync(join(bench, 'plan/plan.json'), 'utf8'));
const parser = new Parser(new AstBuilder(IdGenerator.incrementing()), new GherkinClassicTokenMatcher());
const normalize = text => text.trim().replace(/\s+/g, ' ').toLowerCase();

function featureFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return featureFiles(path);
    return entry.name.endsWith('.feature') ? [path] : [];
  });
}

function scenarios(file) {
  const { feature } = parser.parse(readFileSync(file, 'utf8'));
  return (feature?.children ?? []).flatMap(child => child.rule?.children ?? [child])
    .flatMap(child => child.scenario ? [child.scenario] : []);
}

const names = new Set([
  ...plan.items.map(item => item.scenario),
  ...plan.pay.scenarios.flatMap(({ id, title }) => [id, title]),
  ...plan.mdl.changes.flatMap(change => change.scenarios.flat()),
].map(normalize));
const steps = new Set();
const signature = scenario => JSON.stringify(scenario.steps.map(step => normalize(step.text)));
const idOf = path => normalize(basename(path, '.feature'));

for (const file of [...featureFiles(join(bench, 'scenarios')), study]) {
  names.add(idOf(file));
  for (const scenario of scenarios(file)) {
    names.add(normalize(scenario.name));
    for (const tag of scenario.tags) names.add(normalize(tag.name.slice(1)));
    steps.add(signature(scenario));
  }
}

for (const [app, count] of [['pay', 2], ['mdl', 1]]) {
  const files = featureFiles(join(bench, 'prompt/practice', app));
  if (files.length !== count) throw new Error(`Expected ${count} ${app} practice files`);
}
const practice = featureFiles(join(bench, 'prompt/practice'));
if (practice.length !== 3) throw new Error('Expected exactly three practice files');
for (const file of practice) {
  const entries = scenarios(file);
  if (entries.length !== 1 || !entries[0].steps.length) {
    throw new Error(`Expected one practice scenario with steps in ${file}`);
  }
  const [scenario] = entries;
  const identifiers = [idOf(file), normalize(scenario.name),
    ...scenario.tags.map(tag => normalize(tag.name.slice(1)))];
  if (identifiers.some(id => names.has(id)) || steps.has(signature(scenario))) {
    throw new Error(`Scored scenario found in practice: ${file}`);
  }
}
console.log('No scored scenarios found in 3 practice files (2 payment, 1 Moodle).');
