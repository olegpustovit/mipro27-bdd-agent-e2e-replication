import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildMoodlePrompt } from '../../../adapters/moodle/prompt.mjs';
import { renderStep } from '../../../adapters/moodle/gherkin.mjs';
import { scenarioDetails } from '../../agent/answer.mjs';
import { writeAgentScenario } from './agent-scenario.mjs';
import { decodeHandoffVerdict, isDataStep, planHandoff, prepareForAgent } from './handoff.mjs';

test('setup runs an admin data step after login and the prompt contains only user steps', async t => {
  const src = await mkdtemp(join(tmpdir(), 'p4-handoff-'));
  t.after(() => rm(src, { recursive: true, force: true }));
  const feature = 'search.feature';
  await writeFile(join(src, feature), `Feature: Search banner
  Scenario: Show an admin-configured banner
    Given I log in as "admin"
    When the following config values are set as admin:
      | searchbannerenable | 1 |
      | searchbanner | Search guidance |
    And I search for "toads" using the header global search box
    Then I should see "Search guidance"
`);
  const calls = [];
  let seed;
  const adapter = {
    dirs: { src },
    baseUrl: 'http://localhost',
    reset: async () => calls.push('reset'),
    ready: async () => calls.push('ready'),
    async exec(service, args, options) {
      assert.equal(service, 'webserver');
      if (options.input) {
        calls.push('write');
        seed = options.input;
      } else if (args.includes('vendor/bin/behat')) {
        calls.push('behat');
        assert.equal(seed, `Feature: study data setup

  Scenario: seed
    Given the following config values are set as admin:
      | searchbannerenable | 1 |
      | searchbanner | Search guidance |
`);
      } else {
        assert.match(args[2], /cat .*; rm -f /);
        calls.push('read and clean up');
        return { stdout: JSON.stringify({ status: 'passed', steps: [{ index: 0, status: 'passed' }] }) };
      }
      return { code: 0, stdout: '', stderr: '' };
    },
  };
  const handoff = await prepareForAgent(adapter, { feature });
  assert.deepEqual(calls, ['reset', 'write', 'behat', 'read and clean up', 'ready']);
  const prompt = buildMoodlePrompt({ handoff, steps: handoff.uiSteps });
  assert.deepEqual(prompt.split('\n').filter(line => /^\[\d+\]/.test(line)), [
    '[1] Given I log in as "admin"',
    '[2] And I search for "toads" using the header global search box',
    '[3] Then I should see "Search guidance"',
  ]);
  assert.doesNotMatch(prompt, /config values are set as admin|searchbannerenable/);
  const verdict = decodeHandoffVerdict(JSON.stringify({
    status: 'fail', reason: 'Search box did not open', failingStep: 2,
    failingStepText: 'I search for "toads" using the header global search box',
  }), handoff);
  assert.equal(verdict.failingStepVerified, true);
  assert.equal(verdict.behatStepIndex, 2);
});

test('every eligible extract preserves the manifest UI and writes only agent-visible steps', async t => {
  const out = await mkdtemp(join(tmpdir(), 'p4b-handoff-'));
  t.after(() => rm(out, { recursive: true, force: true }));
  const bench = new URL('../../', import.meta.url);
  const changes = JSON.parse(await readFile(new URL('apps/moodle/changes.json', bench)));
  const wording = JSON.parse(await readFile(new URL('scenarios/moodle/agent-wording.json', bench)));
  let checked = 0;
  for (const change of changes.changes) {
    for (const entry of change.scenarios.filter(scenario => scenario.decision === 'eligible')) {
      for (const phase of ['pre', 'post']) {
        const label = `${change.id}/${entry.id}.${phase}`;
        const { scenarioTextPath, handoff } = entry[phase];
        const original = await readFile(new URL(scenarioTextPath, bench), 'utf8');
        const plan = planHandoff(original, {});
        assert.deepEqual(plan.uiSteps.map(renderStep), handoff.ui, label);
        const path = await writeAgentScenario({ version: `${change.id}-${phase}`, scenario: `${entry.id}.${phase}.feature` }, out);
        const prepared = await readFile(path, 'utf8');
        await rm(path);
        const { steps, numbered } = scenarioDetails(prepared);
        const replacements = wording[entry.id]?.steps ?? {};
        assert.deepEqual(steps, handoff.ui.map((step, index) =>
          replacements[index + 1]?.revised ?? step.split('\n')[0]), label);
        for (const line of prepared.split('\n')) {
          assert.equal(isDataStep(line.trim().replace(/^(?:Given|When|Then|And|But|\*)\s+/, '')), false, label);
        }
        for (const [index, step] of plan.uiSteps.entries()) {
          const verdict = decodeHandoffVerdict(JSON.stringify({
            status: 'fail', reason: 'Test', failingStep: index + 1, failingStepText: step.text,
          }), plan);
          assert.equal(verdict.behatStepIndex, step.index, label);
        }
        assert.doesNotMatch(numbered, /^\s*\d+\. Accounts/m, label);
        if (['S040', 'S041', 'S046'].includes(entry.id)) {
          assert.match(numbered, /Accounts[^\n]*"teacher1" \(password "teacher1"\)[^\n]*"student1" \(password "student1"\)/, label);
        }
        if (entry.id === 'S094') assert.doesNotMatch(prepared, /with Javascript disabled/, label);
        checked++;
      }
    }
  }
  assert.equal(checked, changes.eligibleScenarioCount * 2);
  t.diagnostic(`Checked ${checked} eligible scenario phases`);
});
