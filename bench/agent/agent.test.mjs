import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import { parseAnswer, scenarioSteps } from './answer.mjs';
import { models } from './codex.mjs';
import { runSession, timeLimitMs, toolLimit } from './session.mjs';

const reason = 'Observed the fixture.';
const steps = ['Given I open the app', 'When I click Show', 'Then Confirmation appears'];
const encode = (status, failed_step) => JSON.stringify({ status, failed_step, reason });

test('pass, fail by number, fail by step text, and explicit unresolved', () => {
  assert.equal(parseAnswer(encode('pass', null), steps).status, 'pass');
  assert.equal(parseAnswer(encode('fail', 1), steps).failed_step, 1);
  assert.equal(parseAnswer(encode('fail', 'Then I open the app'), [steps[0], 'Then I open the app']).failed_step, 2);
  for (const step of [3, steps[2], 'Confirmation appears']) {
    const answer = parseAnswer(encode('fail', step), steps);
    assert.equal(answer.status, 'fail');
    assert.equal(answer.failed_step, 3);
    assert.equal(answer.failed_step_text, steps[2]);
    assert.equal(answer.reason, reason);
    assert.equal(answer.unresolved_cause, null);
  }
  const fenced = '```json\n' + encode('pass', null) + '\n```';
  assert.equal(parseAnswer(fenced, steps).status, 'pass');
  assert.deepEqual(parseAnswer(encode('unresolved', null), steps), {
    status: 'unresolved', failed_step: null, failed_step_text: null, reason,
    raw: encode('unresolved', null), unresolved_cause: 'no_readable_answer',
  });
});

test('malformed, invalid, ambiguous, and extra answers remain unreadable', () => {
  const invalid = [
    null, '', 'It passed.', 'Result: ' + encode('pass', null), '{"status":"pass"}',
    encode('passed', null), encode('pass', 1), encode('fail', null), encode('fail', 0),
    encode('fail', 4), encode('fail', 1.5), encode('fail', '1'), encode('fail', 'Show'),
    encode('unresolved', 2), '{"status":"pass","failed_step":null,"reason":" "}',
    '{"status":"fail","status":"pass","failed_step":null,"reason":"x"}',
    '{"status":"pass","failed_step":null,"reason":"x","extra":true}',
  ];
  for (const raw of invalid) {
    const answer = parseAnswer(raw, steps);
    assert.equal(answer.status, 'unresolved', String(raw));
    assert.equal(answer.unresolved_cause, 'no_readable_answer');
    assert.equal(answer.raw, raw);
  }
  assert.equal(parseAnswer(encode('fail', steps[2]), [...steps, steps[2]]).unresolved_cause,
    'no_readable_answer');
});

test('step numbering excludes Background and retains And and But', () => {
  assert.deepEqual(scenarioSteps(`Feature: Check
  Background:
    Given I open the app
  Scenario: Example
    Given I open the app
    And I find Show
      """
      Then this is only data
      """
    But it is disabled
    Then Confirmation appears`), [steps[0], 'And I find Show', 'But it is disabled', steps[2]]);
});

const input = { prompt: 'fixture', steps, model: models.luna[0], effort: models.luna[1],
  app: 'fixture', url: 'http://127.0.0.1:1/', trace() {} };
function harness({ raw = null } = {}) {
  let callbacks;
  const dependencies = {
    async browserFactory(options) {
      callbacks = options;
      return { endpoint: 'http://unused', async close() {} };
    },
    prepare() {
      const fake = raw === null
        ? 'process.stdin.resume(); setInterval(() => {}, 10000);'
        : `process.stdin.resume();
          for (const event of ${JSON.stringify([
            { type: 'item.completed', item: { type: 'agent_message', text: raw } },
            { type: 'turn.completed', usage: { input_tokens: 17, cached_input_tokens: 11, output_tokens: 5 } },
          ])}) console.log(JSON.stringify(event));`;
      return { start: () => spawn(process.execPath, ['-e', fake]), cleanup() {} };
    },
  };
  return { dependencies, get browser() { return callbacks; } };
}

test('5-minute watchdog terminates Codex with budget_time', async () => {
  const { dependencies } = harness();
  dependencies.schedule = (callback, delay) => {
    assert.equal(delay, 300000);
    assert.equal(delay, timeLimitMs);
    return setTimeout(callback, 20);
  };
  const answer = await runSession(input, dependencies);
  assert.equal(answer.status, 'unresolved');
  assert.equal(answer.unresolved_cause, 'budget_time');
  assert.equal(answer.tool_calls, 0);
});

test('80th tool call terminates Codex with budget_tools', async () => {
  const fake = harness();
  const running = runSession(input, fake.dependencies);
  await setImmediate();
  assert.equal(toolLimit, 80);
  for (let index = 1; index < 80; index++) {
    assert.equal(fake.browser.attemptTool('browser_snapshot', {}), true);
  }
  assert.equal(fake.browser.attemptTool('browser_snapshot', {}), false);
  assert.equal(fake.browser.attemptTool('browser_snapshot', {}), false);
  const answer = await running;
  assert.equal(answer.status, 'unresolved');
  assert.equal(answer.unresolved_cause, 'budget_tools');
  assert.equal(answer.tool_calls, 80);
});

test('identical repeated actions and observations terminate Codex with loop', async () => {
  const fake = harness();
  const running = runSession(input, fake.dependencies);
  await setImmediate();
  for (let index = 0; index < 8; index++) {
    assert(fake.browser.attemptTool('browser_snapshot', {}));
    fake.browser.observeTool('browser_snapshot', {}, { result: 'unchanged' });
  }
  assert.equal((await running).unresolved_cause, 'loop');
});

test('malformed CLI response is recorded as no_readable_answer and retains token counts', async () => {
  const raw = 'It passed.';
  const answer = await runSession(input, harness({ raw }).dependencies);
  assert.equal(answer.status, 'unresolved');
  assert.equal(answer.unresolved_cause, 'no_readable_answer');
  assert.equal(answer.raw, raw);
  assert.deepEqual(answer.tokens, { input: 17, cached: 11, output: 5 });
});
