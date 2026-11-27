import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildMoodlePrompt } from '../../../adapters/moodle/prompt.mjs';
import { decodeHandoffVerdict, prepareForAgent } from './handoff.mjs';

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
    When the following config values are set as admin:
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
