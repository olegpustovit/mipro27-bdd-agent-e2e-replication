import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeVerdict, normalizeAssertion, scenarioAssertions } from './verdict.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const pass = JSON.stringify({ status: 'pass', reason: 'The visible contract holds.', failedAssertion: null });
const failure = JSON.stringify({ status: 'fail', reason: 'The entered value was accepted.', failedAssertion: 'Then invalid input is rejected' });
test('assertion matching excludes And actions between pre-reload and post-reload checks', () => {
  const feature = '  @example\n  Scenario: phases\n    Given a page\n    Then a value is visible\n    And its count is one\n    When I open a feed\n    And I reload the current page\n    Then the value remains\n';
  assert.deepEqual(scenarioAssertions(feature, 'example'), ['a value is visible', 'its count is one', 'the value remains']);
  const actionFailure = JSON.stringify({ status: 'fail', reason: 'Reload failed', failedAssertion: 'And I reload the current page' });
  assert.equal(decodeVerdict(actionFailure, scenarioAssertions(feature, 'example')).failedAssertionVerified, false);
});
test('generic decoder accepts whole JSON and one fenced object with explanatory prose', () => {
  assert.equal(decodeVerdict(pass).reportedStatus, 'pass');
  for (const [open, close] of [['```json', '```'], ['```', '```'], ['~~~json', '~~~']]) {
    const raw = `Observed the visible result.\n${open}\n${failure}\n${close}\nNo further action.`;
    const decoded = decodeVerdict(raw, ['invalid input is rejected']);
    assert.equal(decoded.reportedStatus, 'fail'); assert.equal(decoded.failedAssertionVerified, true);
    assert.equal(decoded.failedAssertion, 'Then invalid input is rejected'); assert.equal(decoded.normalizedFailedAssertion, 'invalid input is rejected'); assert.equal(decoded.rawResponse, raw);
  }
  assert.equal(normalizeAssertion(' And a value stays saved '), 'a value stays saved');
});
test('version 2 accepts prose followed by one bare verdict object that ends the response', () => {
  const raw = `The scenario fails: the invalid email was saved.\n\n- Sign-in worked.\n\n${failure}`;
  const decoded = decodeVerdict(raw, ['invalid input is rejected']);
  assert.equal(decoded.reportedStatus, 'fail'); assert.equal(decoded.verdictFormat, 'trailing-json'); assert.equal(decoded.failedAssertionVerified, true);
  const nested = `Done.\n${JSON.stringify({ status: 'pass', reason: 'Saw {braces} in text.', failedAssertion: null })}`;
  assert.equal(decodeVerdict(nested).reportedStatus, 'pass');
  for (const bad of [`Verdict: fail\n${pass}`, `Result = pass\n${failure}`, `${pass}\nThen also\n${failure}`, `Prose ${pass} trailing words`, `Prose\n${pass.slice(0, -1)}`, `Prose\n{"status":"pass","reason":"x"}`]) {
    const d = decodeVerdict(bad, ['invalid input is rejected']); assert.equal(d.reportedStatus, 'unresolved', bad); assert(d.verdictParseError);
  }
});
test('multiple, conflicting, duplicate-key and malformed verdicts remain unresolved', () => {
  for (const raw of [
    `${pass}\n${failure}`, `\`\`\`json\n${pass}\n\`\`\`\n\`\`\`json\n${failure}\n\`\`\``,
    `${failure}\n\`\`\`json\n${pass}\n\`\`\``, `Verdict: fail\n\`\`\`json\n${pass}\n\`\`\``,
    '{"status":"pass","status":"fail","reason":"x","failedAssertion":null}',
    '{"status":"pass","\\u0073tatus":"fail","reason":"x","failedAssertion":null}',
    JSON.stringify({ status: 'PASS', reason: 'x', failedAssertion: null }),
    JSON.stringify({ status: 'pass', reason: '', failedAssertion: null }),
    JSON.stringify({ status: 'pass', reason: 'x', failedAssertion: 'a failed assertion' }),
    JSON.stringify({ status: 'pass', reason: 'x', failedAssertion: null, extra: true }),
    JSON.stringify({ status: 'pass', reason: 'x' }), 'not JSON', '```json\n{}', '[{}]', null,
  ]) { const decoded = decodeVerdict(raw, ['invalid input is rejected']); assert.equal(decoded.reportedStatus, 'unresolved', String(raw)); assert(decoded.verdictParseError); assert.equal(decoded.failedAssertionVerified, false); }
});
test('unknown or paraphrased assertions are retained but never verified', () => {
  const decoded = decodeVerdict(failure, ['another frozen assertion']);
  assert.equal(decoded.reportedStatus, 'fail'); assert.equal(decoded.failedAssertionVerified, false);
});
test('NDJSON replay changes decoding only and derives outcomes without browser/model execution', () => {
  const trial = { caseId: 'profile-email', condition: 'fault', repetition: 1, arm: 'runtime' };
  const raw = `Synthetic observation.\n\`\`\`json\n${JSON.stringify({ status: 'fail', reason: 'Synthetic invalid input was accepted.', failedAssertion: 'Then the profile form displays email error "Must contain a valid email address"' })}\n\`\`\``;
  const input = [
    { type: 'agent-event', ...trial, event: { type: 'result', result: raw } },
    { type: 'trial-end', ...trial, agent: { modelVerified: true }, reportedStatus: 'unresolved', assertionFailure: false, expectedHealthy: false, timedOut: false, oracle: { evaluable: true, triggerWitnessed: true, completionWitnessed: false, defectObserved: true } },
  ].map(event => JSON.stringify(event)).join('\n');
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./replay-verdicts.mjs', import.meta.url))], { input, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const replay = JSON.parse(result.stdout);
  assert.equal(replay.original.reportedStatus, 'unresolved'); assert.equal(replay.revised.reportedStatus, 'fail');
  assert.equal(replay.revised.detectionCandidate, true); assert.equal(replay.revised.requiresIndependentAdjudication, true);
  assert.equal(replay.decoded.rawResponse, raw); assert.equal(replay.observationsUnchanged, true); assert.equal(replay.modelsRerun, false);
});
