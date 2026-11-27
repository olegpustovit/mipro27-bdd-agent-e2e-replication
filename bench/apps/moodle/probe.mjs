#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MoodleAdapter } from '../../../adapters/moodle/adapter.mjs';
import { parseResult, runScenario } from '../../../adapters/moodle/behat-runner.mjs';
import { effectiveSteps, parseFeature } from '../../../adapters/moodle/gherkin.mjs';
import { setupPlan } from './scenario-setup.mjs';

const args = process.argv.slice(2);
const previous = new Map();
if (args[0] === '--coded-evidence') {
  for (const line of readFileSync(args[1], 'utf8').trim().split('\n')) {
    const row = JSON.parse(line);
    previous.set(row.id, row);
  }
  args.splice(0, 2);
}
const [worker, ...ids] = args;
if (!worker || !ids.length || !process.env.STUDY_MOODLE_HOME) {
  throw new Error('Set STUDY_MOODLE_HOME to a private adapter directory and pass a worker and change IDs');
}
const pool = JSON.parse(readFileSync(new URL('./mining-output.json', import.meta.url)));
const extract = error => String(error.message).split('\n').filter(Boolean).slice(-15).join('\n').slice(-2500);
async function prepareFixture(adapter, plan) {
  await adapter.reset();
  if (plan.setup.length) {
    const suffix = randomBytes(6).toString('hex');
    const file = `/tmp/study-runs/p7c-${suffix}.feature`;
    const log = `/tmp/study-steps-${suffix}.jsonl`;
    const body = plan.setup.flatMap(step => step.split('\n').map(line => '    ' + line));
    const input = ['Feature: P7c fixture', '', '  Scenario: Setup', ...body, ''].join('\n');
    try {
      await adapter.exec('webserver', ['sh', '-c', `mkdir -p /tmp/study-runs && cat > ${file}`], { input });
      const run = await adapter.exec('webserver', ['timeout', '-s', 'KILL', '90', 'vendor/bin/behat',
        '--config', '/opt/study-behat/study-behat-data.yml', '--no-colors', '--format', 'moodle_progress', file],
      { cwd: '/var/www/html', env: { STUDY_STEP_LOG: log }, check: false, timeoutMs: 120000 });
      const raw = (await adapter.exec('webserver', ['cat', log], { check: false })).stdout;
      const result = parseResult({ raw, exitCode: run.code, stdout: run.stdout, stderr: run.stderr, target: file });
      if (result.status !== 'passed') {
        const reason = result.scenarios[0]?.failingStep?.error || result.stderrTail || result.stdoutTail;
        throw new Error(`Fixture Behat ${result.status}: ${reason}`);
      }
    } finally {
      await adapter.exec('webserver', ['rm', '-f', file, log], { check: false });
    }
  }
  await adapter.ready();
}

for (const id of ids) {
  const change = pool.find(row => row.id === id);
  if (!change) throw new Error(`Unknown change ${id}`);
  const results = { id, builds: {}, scenarios: {} };
  for (const phase of ['pre', 'post']) {
    const commit = change[phase];
    const adapter = new MoodleAdapter({ worker, moodleCommit: commit });
    try {
      await adapter.start();
      results.builds[phase] = { commit, status: 'ready', runtime: adapter.state.runtime };
      for (const candidate of change.scenarios) {
        const row = (results.scenarios[candidate.id] ??= {});
        row[phase] = {};
        try {
          const feature = ['public/', ''].map(prefix => prefix + candidate.feature).find(path => {
            try { readFileSync(join(adapter.dirs.src, path)); return true; }
            catch (error) { if (error.code !== 'ENOENT') throw error; return false; }
          });
          if (!feature) throw new Error('Feature file is absent at this commit');
          const source = readFileSync(join(adapter.dirs.src, feature), 'utf8');
          const parsed = parseFeature(source);
          const scenario = parsed.scenarios.find(item => item.name === candidate.name);
          if (!scenario) throw new Error('Scenario title is absent at this commit');
          if (scenario.kind !== 'scenario') throw new Error('Expected a plain scenario');
          const { line } = scenario;
          const check = row[phase] = {
            feature, line, name: scenario.name, featureTitle: parsed.name,
            featureTags: parsed.tags, scenarioTags: scenario.tags.slice(parsed.tags.length),
          };
          check.steps = effectiveSteps(parsed, scenario).map(({ keyword, text, table, docString, background }) =>
            ({ keyword, text, table, docString, background }));
          if (phase === 'pre') {
            const reuse = previous.get(id);
            const saved = reuse?.scenarios[candidate.id]?.pre;
            if (reuse?.builds.pre?.commit === commit && saved?.feature === feature && saved.line === line &&
              saved.name === scenario.name && saved.coded === 'passed') {
              check.coded = saved.coded;
            } else {
              const coded = await runScenario(adapter, { feature, line, reset: true, timeoutMs: 300000 });
              check.coded = coded.scenarios.length === 1 && coded.scenarios[0].name === scenario.name
                ? coded.status : 'unexpected Behat result';
              if (check.coded !== 'passed') {
                check.reason = coded.scenarios[0]?.failingStep?.text || coded.stderrTail || coded.stdoutTail;
                continue;
              }
            }
          }
          const plan = setupPlan(feature, parsed, scenario);
          await prepareFixture(adapter, plan);
          check.setup = 'passed';
          check.handoff = plan;
        } catch (error) {
          row[phase].reason = extract(error);
        }
      }
    } catch (error) {
      results.builds[phase] = { commit, status: 'failed', reason: extract(error) };
    } finally {
      await adapter.stop({ remove: true });
    }
  }
  console.log(JSON.stringify(results));
}
