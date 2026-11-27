import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
export const readRows = path => readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
export const plan = readJson(root + 'bench/plan/plan.json');
export const lock = readJson(root + 'bench/env.lock.json');
const { changes } = readJson(root + 'bench/apps/moodle/changes.json');
export const selenium = readJson(root + 'docker/moodle/versions.json').images.selenium;
export const key = ({ app, version }) => `${app}/${version}`;

export const suites = new Map();
for (const item of plan.items) {
  if (suites.has(key(item))) continue;
  const { app, version, change, phase } = item;
  const base = { app, version, condition: 'healthy', bugId: null, rep: 1 };
  let scenarios, commit;
  if (app === 'pay' && plan.pay.versions.some(entry => entry.id === version)) {
    base.arm = 'sd-cur';
    scenarios = plan.pay.scenarios;
    if (scenarios.length !== 20) throw new Error('Expected 20 payment gate scenarios');
  } else if (app === 'mdl') {
    const selected = changes.find(entry => entry.id === change && entry.decision === 'chosen');
    commit = selected?.[phase];
    if (!commit || version !== `${change}-${phase}`) throw new Error(`Invalid Moodle version ${version}`);
    Object.assign(base, { change, phase, arm: phase === 'pre' ? 'sd-old' : 'sd-new' });
    // The gate covers every scenario the version's suite runs, including ones excluded later from the run grid (S044).
    scenarios = selected.scenarios.filter(entry => ['eligible', 'coded-only', 'excluded-from-runs'].includes(entry.decision));
  } else {
    throw new Error(`Unknown gate version ${key(item)}`);
  }
  const image = `${app}-${version}-healthy`.toLowerCase();
  const images = { app: lock.images.app[image]?.digest, db: lock.images.db[image]?.digest,
    browser: app === 'pay' ? lock.images.browser.digest : selenium };
  const items = scenarios.map(({ id: scenario }) => ({
    ...base, scenario, id: `gate.${app}.${version}.${scenario}`,
  }));
  if (!items.length || new Set(items.map(entry => entry.scenario)).size !== items.length) {
    throw new Error(`Missing or duplicate gate scenarios for ${version}`);
  }
  suites.set(key(item), { app, version, commit, images, items });
}

for (const { id } of plan.pay.versions) {
  if (!suites.has(key({ app: 'pay', version: id }))) throw new Error(`Plan has no items for payment ${id}`);
}
for (const { id } of changes.filter(change => change.decision === 'chosen')) {
  for (const phase of ['pre', 'post']) {
    const version = `${id}-${phase}`;
    if (!suites.has(key({ app: 'mdl', version }))) throw new Error(`Plan has no items for Moodle ${version}`);
  }
}
