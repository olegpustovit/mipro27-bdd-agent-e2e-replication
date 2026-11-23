// Generator hand-off: run a scenario's data-setup steps through Moodle's Behat data generators, leave the
// seeded site live, and describe what the browser-agent arm may now do (UI steps only).
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFeature, findScenario, effectiveSteps, renderStep } from './gherkin.mjs';
import { parseResult } from './behat-runner.mjs';
const DATA_CONFIG = '/opt/study-behat/study-behat-data.yml';

// A step is data setup when Moodle's own generators/config API perform it (behat_data_generators, behat_config_manager).
export const DATA_STEP = [
  /^the following "[^"]+" (?:exists?|exist)\s*:?$/,
  /^the following config values are set as admin\s*:?$/,
  /^the following "[^"]+" (?:exists?|exist) in "[^"]+" "[^"]+"\s*:?$/,
];
export const isDataStep = text => DATA_STEP.some(re => re.test(text));

export function splitSteps(steps) {
  let k = 0; while (k < steps.length && isDataStep(steps[k].text) && ['Given', 'And', 'But', '*'].includes(steps[k].keyword)) k++;
  return { dataSteps: steps.slice(0, k), uiSteps: steps.slice(k) };
}
// Users created by the "users" generator log in with password = username (Moodle's Behat generator default).
export function seededCredentials(dataSteps) {
  const users = [];
  for (const s of dataSteps) {
    const m = /^the following "users" exist/.exec(s.text); if (!m || !s.table) continue;
    const [header, ...rows] = s.table, iu = header.indexOf('username'), ip = header.indexOf('password');
    for (const r of rows) if (iu >= 0 && r[iu]) users.push({ username: r[iu], password: ip >= 0 && r[ip] ? r[ip] : r[iu] });
  }
  return users;
}
export function dataFeatureText(dataSteps, title = 'study data setup') {
  return `Feature: ${title}\n\n  Scenario: seed\n${dataSteps.map(s => renderStep(s).split('\n').map(l => '    ' + l).join('\n')).join('\n')}\n`;
}
export function planHandoff(featureText, { line, name, exampleLine }) {
  const feature = parseFeature(featureText), scenario = findScenario(feature, { line, name });
  const steps = effectiveSteps(feature, scenario, { exampleLine });
  const { dataSteps, uiSteps } = splitSteps(steps);
  return { feature: feature.name, scenario: scenario.name, tags: scenario.tags, dataSteps, uiSteps, credentials: seededCredentials(dataSteps) };
}

// Runs the data steps at the adapter's current (reset) state. Returns what the agent arm receives.
export async function prepareForAgent(adapter, { feature, line, name, exampleLine, resetFirst = true, timeoutMs = 180000 }) {
  const text = readFileSync(join(adapter.dirs.src, feature), 'utf8');
  const plan = planHandoff(text, { line, name, exampleLine });
  if (!plan.dataSteps.length) throw new Error('Scenario has no leading data steps to run through generators');
  if (resetFirst) await adapter.reset();
  const id = randomBytes(6).toString("hex"), file = `/tmp/study-runs/study-data-${id}.feature`, log = `/tmp/study-steps-${id}.jsonl`;
  await adapter.exec('webserver', ["sh", "-c", `mkdir -p /tmp/study-runs && cat > ${file}`], { input: dataFeatureText(plan.dataSteps) });
  const began = performance.now();
  const r = await adapter.exec('webserver', ['timeout', '-s', 'KILL', String(Math.ceil(timeoutMs / 1000)), 'vendor/bin/behat', '--config', DATA_CONFIG, '--no-colors', '--format', 'moodle_progress', file],
    { cwd: '/var/www/html', env: { STUDY_STEP_LOG: log }, check: false, timeoutMs: timeoutMs + 30000 });
  const raw = (await adapter.exec('webserver', ['sh', '-c', `cat ${log} 2>/dev/null; rm -f ${log} ${file}`], { check: false })).stdout;
  const result = parseResult({ raw, exitCode: r.code, wallMs: Math.round(performance.now() - began), stdout: r.stdout, stderr: r.stderr, target: file });
  if (result.status !== 'passed') throw new Error(`Data steps failed through generators: ${JSON.stringify(result.scenarios[0]?.failingStep ?? result.stderrTail)}`);
  await adapter.ready();
  return {
    baseUrl: adapter.baseUrl, loginUrl: `${adapter.baseUrl}/login/index.php`, allowedOrigins: adapter.allowedOrigins,
    credentials: plan.credentials, dataMs: result.wallMs, dataSteps: plan.dataSteps.map(s => renderStep(s)),
    // Only the UI steps go to the agent; data steps are already applied on the live site.
    uiSteps: plan.uiSteps.map(x => ({ index: x.index, keyword: x.keyword, text: x.text, rendered: renderStep(x) })),
    gherkin: plan.uiSteps.map(renderStep).join('\n'), uiStepCount: plan.uiSteps.length, scenario: plan.scenario, feature: plan.feature,
    uiStepIndexOffset: plan.dataSteps.length,
  };
}
