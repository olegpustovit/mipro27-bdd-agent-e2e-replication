import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataFeatureText, isDataStep, seededCredentials } from '../../../adapters/moodle/handoff.mjs';
import { effectiveSteps, findScenario, parseFeature, renderStep } from '../../../adapters/moodle/gherkin.mjs';
import { parseResult } from '../../../adapters/moodle/behat-runner.mjs';
import { decodeStepVerdict } from '../../../adapters/moodle/verdict.mjs';

const DATA_CONFIG = '/opt/study-behat/study-behat-data.yml';

function planHandoff(text, selection) {
  const feature = parseFeature(text);
  const scenario = findScenario(feature, selection);
  const steps = effectiveSteps(feature, scenario, selection);
  return {
    feature: feature.name,
    scenario: scenario.name,
    dataSteps: steps.filter(step => isDataStep(step.text)),
    uiSteps: steps.filter(step => !isDataStep(step.text)),
  };
}

export function decodeHandoffVerdict(raw, { uiSteps }) {
  const verdict = decodeStepVerdict(raw, uiSteps);
  if (verdict.failingStepVerified) {
    verdict.behatStepIndex = uiSteps[verdict.failingStep - 1].index;
  }
  return verdict;
}

export async function prepareForAgent(adapter, { feature, line, name, exampleLine, resetFirst = true, timeoutMs = 180000 }) {
  const text = readFileSync(join(adapter.dirs.src, feature), 'utf8');
  const plan = planHandoff(text, { line, name, exampleLine });
  if (resetFirst) await adapter.reset();
  const dataMs = plan.dataSteps.length ? await runSetup(adapter, plan.dataSteps, timeoutMs) : 0;
  await adapter.ready();
  return {
    baseUrl: adapter.baseUrl, loginUrl: `${adapter.baseUrl}/login/index.php`, allowedOrigins: adapter.allowedOrigins,
    credentials: seededCredentials(plan.dataSteps), dataMs,
    uiSteps: plan.uiSteps.map(step => ({ ...step, rendered: renderStep(step) })),
    scenario: plan.scenario, feature: plan.feature,
  };
}

async function runSetup(adapter, dataSteps, timeoutMs) {
  const id = randomBytes(6).toString('hex');
  const file = `/tmp/study-runs/study-data-${id}.feature`;
  const log = `/tmp/study-steps-${id}.jsonl`;
  await adapter.exec('webserver', ['sh', '-c', `mkdir -p /tmp/study-runs && cat > ${file}`], { input: dataFeatureText(dataSteps) });
  const began = performance.now();
  let execution, raw;
  try {
    execution = await adapter.exec('webserver', [
      'timeout', '-s', 'KILL', String(Math.ceil(timeoutMs / 1000)),
      'vendor/bin/behat', '--config', DATA_CONFIG, '--no-colors', '--format', 'moodle_progress', file,
    ], { cwd: '/var/www/html', env: { STUDY_STEP_LOG: log }, check: false, timeoutMs: timeoutMs + 30000 });
  } finally {
    ({ stdout: raw } = await adapter.exec('webserver', ['sh', '-c', `cat ${log} 2>/dev/null; rm -f ${log} ${file}`], { check: false }));
  }
  const result = parseResult({ raw, exitCode: execution.code, wallMs: Math.round(performance.now() - began), stdout: execution.stdout, stderr: execution.stderr, target: file });
  if (result.status !== 'passed') throw new Error(`Data steps failed through generators: ${JSON.stringify(result.scenarios[0]?.failingStep ?? result.stderrTail)}`);
  return result.wallMs;
}
