import { spawn } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));

function scenarioFile(scenario) {
  for (const directory of ['bench/scenarios/pay', 'bench/scenarios/pay/hold-out']) {
    const path = `${directory}/${scenario}.feature`;
    if (existsSync(join(root, path))) return path;
  }
  return 'study/scenarios.feature';
}

function resultOf(messages, code, scenario) {
  const envelopes = messages.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const single = key => {
    const matches = envelopes.flatMap(envelope => envelope[key] ? [envelope[key]] : []);
    if (matches.length !== 1) throw new Error(`Expected one Cucumber ${key} for ${scenario}, found ${matches.length}`);
    return matches[0];
  };
  const testCase = single('testCase');
  const pickle = envelopes.find(envelope => envelope.pickle?.id === testCase.pickleId)?.pickle;
  if (!pickle) throw new Error('Cucumber did not identify the executed scenario');
  const { feature } = single('gherkinDocument');
  const entry = feature.children.find(({ scenario }) => scenario?.id === pickle.astNodeIds[0])?.scenario;
  const results = new Map(envelopes.flatMap(({ testStepFinished: step }) =>
    step ? [[step.testStepId, step.testStepResult]] : []));
  const bad = testCase.testSteps.find(step => !['PASSED', 'SKIPPED'].includes(results.get(step.id)?.status));
  if (!bad && code === 0) return { status: 'pass', message: 'Cucumber passed' };
  if (!bad) throw new Error('Cucumber exited unsuccessfully without a step result');
  const ast = pickle.steps.find(step => step.id === bad.pickleStepId)?.astNodeIds[0];
  const index = entry.steps.findIndex(step => step.id === ast);
  const outcome = results.get(bad.id);
  const status = outcome?.status;
  if (outcome?.message?.includes('STUDY_PRIVATE_CAPTURE:')) {
    throw new Error('Cucumber private browser observer failed');
  }
  if (!status) throw new Error('Cucumber did not finish executing the scenario');
  if (index < 0 && !bad.pickleStepId) throw new Error('Cucumber hook failed');
  if (status === 'UNDEFINED' || status === 'AMBIGUOUS') {
    throw new Error(`Cucumber step ${index + 1} is ${status.toLowerCase()}`);
  }
  const step = entry.steps[index];
  return {
    status: 'fail',
    failed_step: step ? index + 1 : null,
    failed_step_text: step ? step.keyword + step.text : null,
    message: `Cucumber ${step ? 'scenario' : 'Background'} step: ${status.toLowerCase()}`,
  };
}

export function resolvePaymentSupport(item) {
  const file = scenarioFile(item.scenario);
  const previous = { v1: 'v0', v2: 'v1' };
  const definitionVersion = item.arm === 'sd-stale' ? previous[item.version] : item.version;
  if (!definitionVersion) throw new Error('No previous payment step definitions for this version');

  const suite = file.includes('/hold-out/') ? 'hold-out' : 'social';
  const directory = `bench/stepdefs/pay/${definitionVersion}`;
  const world = definitionVersion === 'v0' ? 'study/world.mjs' : `${directory}/world.mjs`;
  const support = `${directory}/${suite}.mjs`;
  for (const path of [world, support]) {
    if (!existsSync(join(root, path))) throw new Error(`Missing payment step definitions: ${path}`);
  }
  return { file, world, support };
}

export async function payment(item) {
  const { scenario, version } = item;
  const { file, world, support } = resolvePaymentSupport(item);

  const { origin } = await import('./pay-origin.mjs');
  const { freshBrowser } = await import('../../../scripts/fixture.mjs');
  const temp = mkdtempSync(join(tmpdir(), 'coded-pay-'));
  try {
    const browser = await freshBrowser({ observerVersion: version });
    try {
      const events = join(temp, 'cucumber.ndjson');
      const code = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [
          '--import', fileURLToPath(new URL('./pay-origin.mjs', import.meta.url)),
          'node_modules/@cucumber/cucumber/bin/cucumber.js',
          '--import', world,
          '--import', support,
          '--format', `message:${events}`, '--retry', '0', '--exit',
          ...(file === 'study/scenarios.feature' ? ['--tags', `@${scenario}`] : []), file,
        ], {
          cwd: root, stdio: 'ignore', timeout: 60_000, killSignal: 'SIGKILL',
          env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C.UTF-8', NO_COLOR: '1',
            BENCH_APP_URL: origin, BENCH_PAY_API_URL: process.env.BENCH_PAY_API_URL,
            STUDY_CDP_ENDPOINT: browser.endpoint },
        });
        child.once('error', reject);
        child.once('close', resolve);
      });
      if (code === null) throw new Error('Cucumber was terminated or exceeded its timeout');
      if (!existsSync(events)) throw new Error('Cucumber did not produce a result. Check support files and dependencies.');
      return resultOf(readFileSync(events, 'utf8'), code, scenario);
    } finally {
      await browser.close();
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
