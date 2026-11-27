import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { renderStep } from '../../../adapters/moodle/gherkin.mjs';
import { seededCredentials } from '../../../adapters/moodle/handoff.mjs';
import { planHandoff } from './handoff.mjs';

const wording = JSON.parse(readFileSync(new URL('../../scenarios/moodle/agent-wording.json', import.meta.url), 'utf8'));

export function agentScenario(plan, id) {
  const { title, steps = {} } = wording[id] ?? {};
  if (title && title.original !== plan.scenario) throw new Error(`Stale agent title for ${id}`);
  const users = new Map(seededCredentials(plan.dataSteps).map(({ username, password }) => [username, password]));
  users.set('admin', 'admin'); // Moodle's built-in Behat fixture account.
  const accounts = new Set();
  const lines = plan.uiSteps.map((step, index) => {
    const login = /(?:^I log in as| logged in as) (?:"([^"]+)"|([\w-]+))$/.exec(step.text);
    if (login) accounts.add(login[1] ?? login[2]);
    const [first, ...rest] = renderStep(step).split('\n');
    const replacement = steps[index + 1];
    if (replacement && replacement.original !== first) throw new Error(`Stale agent wording for ${id} step ${index + 1}`);
    return [replacement?.revised ?? first, ...rest].map(line => '    ' + line).join('\n');
  });
  if (Object.keys(steps).some(number => Number(number) > lines.length)) throw new Error(`Stale agent step number for ${id}`);
  const credentials = [...accounts].map(username => {
    if (!users.has(username)) throw new Error(`Moodle fixture has no account for ${username}`);
    return `${JSON.stringify(username)} (password ${JSON.stringify(users.get(username))})`;
  });
  return [
    `Feature: ${plan.feature}`,
    ...(credentials.length ? [`  Accounts for this scenario: ${credentials.join(', ')}.`] : []),
    '',
    `  Scenario: ${title?.revised ?? plan.scenario}`,
    ...lines,
    '',
  ].join('\n');
}

// The prebuilt bench app provides the matching scenario's generator state.
export async function writeAgentScenario(item, out) {
  const [id, suffix] = item.scenario.replace(/\.feature$/, '').split('.');
  const version = /^(B\d+)(?:-(pre|post))?$/.exec(item.version);
  const change = item.change ?? version?.[1];
  const phase = item.phase ?? version?.[2] ?? suffix;
  if (!version || change !== version[1] || !['pre', 'post'].includes(phase) ||
      (suffix && suffix !== phase) || (version[2] && version[2] !== phase)) {
    throw new Error('Invalid Moodle scenario build or phase');
  }
  const manifest = JSON.parse(readFileSync(new URL('../../apps/moodle/changes.json', import.meta.url), 'utf8'));
  const entry = manifest.changes.find(candidate => candidate.id === change)?.scenarios
    .find(candidate => candidate.id === id && candidate.decision === 'eligible');
  if (!entry) throw new Error('Moodle scenario is not eligible for an agent run');
  const text = readFileSync(new URL(`../../${entry[phase].scenarioTextPath}`, import.meta.url), 'utf8');
  const file = join(out, 'agent-scenario.feature');
  await writeFile(file, agentScenario(planHandoff(text, {}), id), { flag: 'wx', mode: 0o600 });
  return file;
}
