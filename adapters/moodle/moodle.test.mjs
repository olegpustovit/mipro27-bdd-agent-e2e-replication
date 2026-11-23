import test from 'node:test';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseFeature, findScenario, effectiveSteps, renderStep } from './gherkin.mjs';
import { isDataStep, splitSteps, seededCredentials, dataFeatureText, planHandoff } from './handoff.mjs';
import { analyzeFeature, classifySelector, summarize } from './reachability.mjs';
import { createRepairPolicy, classifyPath, LIMITS } from './repair-policy.mjs';
import { decodeStepVerdict } from './verdict.mjs';
import { parseResult } from './behat-runner.mjs';
import { acquireLock } from './lock.mjs';
import { validateCall } from './browser-policy.mjs';
import { buildMoodlePrompt } from './prompt.mjs';
import { readModelCatalog, findSetpriv } from '../../scripts/codex-boundary.mjs';
import { portsFor, resolveMoodleCommit } from './config.mjs';

const FEATURE = `@core @javascript
Feature: Edit
  Background:
    Given the following "users" exist:
      | username | firstname |
      | teacher1 | Teacher |
    And the following "courses" exist:
      | fullname | shortname |
      | Course 1 | C1 |

  @javascript
  Scenario: Rename
    When I log in as "teacher1"
    And I am on "Course 1" course homepage
    Then I should not see "Old" in the ".course-content" "css_element"
    And I click on "Edit" "link" in the "[data-value='x']" "css_element"
    And I should see "New" in the "//div[contains(normalize-space(.), 'Hi')]" "xpath_element"

  Scenario Outline: Outline
    Given the following "config values" exist:
      | name | value |
    When I log in as "<user>"
    Then I should see "<text>"
    Examples:
      | user | text |
      | a | b |
      | c | d |
`;

test('gherkin: background, tables and outline expansion', () => {
  const f = parseFeature(FEATURE), sc = findScenario(f, { name: 'Rename' });
  const steps = effectiveSteps(f, sc);
  assert.equal(steps.length, 7); assert.equal(steps[0].background, true); assert.deepEqual(steps[0].table[1], ['teacher1', 'Teacher']);
  assert.equal(steps[2].index, 2);
  const out = f.scenarios.find(s => s.kind === 'outline');
  assert.equal(effectiveSteps(f, out)[3].text, 'I log in as "a"');
  assert.equal(effectiveSteps(f, out, { exampleLine: out.examples[0].rows[1].line })[3].text, 'I log in as "c"');
  assert.match(renderStep(steps[0]), /\| username \| firstname \|/);
});

test('handoff: only the leading generator steps are data steps; the rest goes to the agent', () => {
  assert(isDataStep('the following "users" exist:')); assert(isDataStep('the following "activity" exists:')); assert(isDataStep('the following config values are set as admin:'));
  assert(!isDataStep('I log in as "teacher1"')); assert(!isDataStep('I should see "the following"'));
  const plan = planHandoff(FEATURE, { name: 'Rename' });
  assert.equal(plan.dataSteps.length, 2); assert.equal(plan.uiSteps.length, 5); assert.equal(plan.uiSteps[0].index, 2);
  assert.deepEqual(plan.credentials, [{ username: 'teacher1', password: 'teacher1' }]);
  const again = parseFeature(dataFeatureText(plan.dataSteps));
  assert.equal(effectiveSteps(again, again.scenarios[0]).length, 2);
  // a data step after a UI step stays with the UI steps (order is preserved)
  const { dataSteps, uiSteps } = splitSteps([{ keyword: 'When', text: 'I log in as "x"' }, { keyword: 'And', text: 'the following "users" exist:' }]);
  assert.equal(dataSteps.length, 0); assert.equal(uiSteps.length, 2);
});

test('reachability: flags selectors an agent cannot see', () => {
  assert.equal(classifySelector('css_element', '.course-content'), 'dom-only');
  assert.equal(classifySelector('css_element', "[data-value='x']"), 'dom-only');
  assert.equal(classifySelector('css_element', "[aria-label='Close']"), 'visible');
  assert.equal(classifySelector('xpath_element', "//div[contains(normalize-space(.), 'Hi')]"), 'visible');
  assert.equal(classifySelector('xpath_element', "//div[@id='a']"), 'dom-only');
  assert.equal(classifySelector('xpath_element', "//div[@class='x' and contains(., 'Hi')]"), 'mixed');
  const rows = analyzeFeature(FEATURE, 'x.feature'), rename = rows.find(r => r.scenario === 'Rename');
  assert.equal(rename.selectorSteps, 3); assert.equal(rename.flaggedSteps, 2);
  assert.equal(summarize(rows).scenariosWithFlagged, 1);
  assert(!rename.uses.some(u => u.background));   // table values are not selectors
});

test('repair policy: files, Gherkin read-only in every class, assertion weakening and budgets', () => {
  const ctx = 'public/search/tests/behat/behat_search.php';
  assert.equal(classifyPath(ctx).kind, 'context'); assert.equal(classifyPath('public/lib/behat/classes/partial_named_selector.php').kind, 'selector');
  assert.equal(classifyPath('public/lib/behat/behat_hooks.php').kind, 'infra'); assert.equal(classifyPath('public/lib/behat/classes/behat_core_generator.php').kind, 'infra');
  assert.equal(classifyPath('public/mod/quiz/classes/foo.php').kind, 'product-or-other'); assert.equal(classifyPath('../x.php').kind, 'outside');
  const p = createRepairPolicy({ breakClass: 'i', allowedFiles: [ctx] });
  assert.equal(p.checkEdit({ path: ctx }).ok, true);
  assert.equal(p.checkEdit({ path: 'public/search/tests/behat/x.feature' }).ok, false);
  assert.match(p.checkEdit({ path: 'public/mod/quiz/tests/behat/behat_mod_quiz.php' }).reason, /not used by the sampled/);
  assert.match(p.checkEdit({ path: ctx, before: 'throw new ExpectationException("a");', after: 'return;' }).reason, /weakening/);
  assert.equal(p.checkEdit({ path: ctx, before: 'throw new ExpectationException("a");', after: 'throw new ExpectationException("b");' }).ok, true);
  // Gherkin is read-only for class (ii) too: the developers' new .feature files are the scenario text of every arm; the old `gherkinEditable` escape hatch is gone.
  const q = createRepairPolicy({ breakClass: 'ii', allowedFiles: [ctx] });
  for (const f of ['public/a/tests/behat/a.feature', 'public/mod/data/tests/behat/data_presets.feature']) assert.match(q.checkEdit({ path: f, before: 'x', after: 'y' }).reason, /Gherkin is read-only for arm B in every break class/);
  assert.equal(q.checkEdit({ path: ctx }).ok, true);
  assert.throws(() => createRepairPolicy({ breakClass: 'ii', gherkinEditable: ['public/a/tests/behat/a.feature'] }), /Gherkin is read-only/);
  for (let i = 0; i < LIMITS.acceptedEdits; i++) q.acceptEdit();
  assert.match(q.checkEdit({ path: ctx }).reason, /budget/);
  for (let i = 0; i < LIMITS.scenarioRuns; i++) q.acceptRun();
  assert.equal(q.checkRun().ok, false); assert.throws(() => q.acceptRun());
  assert.throws(() => createRepairPolicy({ breakClass: 'x' }));
});

const STEPS = [{ text: 'I log in as "teacher1"' }, { text: 'I set the field "Edit title" to "x"' }, { text: 'I should see "x"' }];
test('verdict v2: step number and quoted text must agree; maps to the Behat index', () => {
  const ok = decodeStepVerdict('{"status":"fail","reason":"no field","failingStep":2,"failingStepText":"When I set the field \\"Edit title\\" to \\"x\\""}', STEPS, { offset: 4 });
  assert.equal(ok.failingStepVerified, true); assert.equal(ok.behatStepIndex, 5); assert.equal(ok.verdictParserVersion, 2);
  const wrong = decodeStepVerdict('{"status":"fail","reason":"r","failingStep":3,"failingStepText":"I log in as \\"teacher1\\""}', STEPS);
  assert.equal(wrong.failingStepVerified, false); assert.match(wrong.failingStepMismatch, /does not match/);
  assert.match(decodeStepVerdict('{"status":"fail","reason":"r","failingStep":9,"failingStepText":"x"}', STEPS).failingStepMismatch, /outside/);
  assert.match(decodeStepVerdict('{"status":"fail","reason":"r","failingStep":null,"failingStepText":null}', STEPS).verdictParseError, /1-based/);
  assert.match(decodeStepVerdict('{"status":"pass","reason":"r","failingStep":1,"failingStepText":"a"}', STEPS).verdictParseError, /pass cannot/);
  assert.match(decodeStepVerdict('{"status":"pass","reason":"r"}', STEPS).verdictParseError, /exactly/);
  const pass = decodeStepVerdict('```json\n{"status":"pass","reason":"all good","failingStep":null,"failingStepText":null}\n```', STEPS);
  assert.equal(pass.reportedStatus, 'pass'); assert.equal(pass.verdictFormat, 'single-fenced-json');
  assert.match(decodeStepVerdict('status: pass\n```json\n{"status":"fail","reason":"r","failingStep":1,"failingStepText":"I log in as \\"teacher1\\""}\n```', STEPS).verdictParseError, /Additional explicit verdict/);
  assert.equal(decodeStepVerdict('', STEPS).reportedStatus, 'unresolved');
});

test('behat runner: failing step index and status come from the step log', () => {
  const rec = { feature: '/f.feature', name: 'S', line: 3, tags: [], status: 'failed', ms: 10, steps: [
    { index: 0, status: 'passed' }, { index: 1, status: 'failed', error: 'boom' }, { index: 2, status: 'skipped' }] };
  const r = parseResult({ raw: JSON.stringify(rec) + '\n', exitCode: 1, wallMs: 5, target: 't' });
  assert.equal(r.status, 'failed'); assert.equal(r.failingStepIndex, 1);
  assert.equal(parseResult({ raw: JSON.stringify({ ...rec, status: 'passed', steps: [{ index: 0, status: 'passed' }] }), exitCode: 0, wallMs: 1 }).status, 'passed');
  assert.equal(parseResult({ raw: '', exitCode: 1, wallMs: 1 }).status, 'error');
});

test('worker lock: exclusive, under a given directory, stale locks reclaimed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lock-test-')), path = join(dir, 'w1', 'lock');
  try {
    const release = acquireLock(path, 'a');
    assert.throws(() => acquireLock(path, 'b'), /held by pid/);
    release(); acquireLock(path, 'c')();
    writeFileSync(path, JSON.stringify({ pid: 999999999, owner: 'dead', since: 'x' }));
    acquireLock(path, 'd')();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('browser policy: Behat origin only, no test-control paths', () => {
  assert.equal(validateCall('browser_navigate', { url: 'http://webserver/course/view.php?id=2' }), null);
  assert.match(validateCall('browser_navigate', { url: 'http://localhost:3000/' }), /only within/);
  assert.match(validateCall('browser_navigate', { url: 'http://webserver/admin/tool/behat/index.php' }), /unavailable/);
  assert.match(validateCall('browser_navigate', { url: 'http://webserver/lib/ajax/service.php' }), /unavailable/);
  assert.match(validateCall('browser_evaluate', {}), /UI tools only/);
  assert.match(validateCall('browser_click', { filename: 'x' }), /disabled/);
});

test('prompt numbers the UI steps and demands the v2 verdict keys', () => {
  const prompt = buildMoodlePrompt({ handoff: { baseUrl: 'http://webserver', loginUrl: 'http://webserver/login/index.php', credentials: [{ username: 'u', password: 'u' }] }, steps: STEPS.map((s, i) => ({ ...s, keyword: i ? 'And' : 'When' })) });
  assert.match(prompt, /\[1\] When I log in as "teacher1"/); assert.match(prompt, /failingStepText/); assert.match(prompt, /username "u", password "u"/);
});

test('config: port blocks and commit validation', () => {
  assert.equal(portsFor('w1').web, 18110); assert.notEqual(portsFor('w1').block[1], portsFor('w2').block[0]); assert(portsFor('w2').block[0] > portsFor('w1').block[1]);
  assert.throws(() => portsFor('worker1')); assert.throws(() => resolveMoodleCommit('main'));
  assert.equal(resolveMoodleCommit('a'.repeat(40)), 'a'.repeat(40));
});

test('Moodle browser policy lets the agent use every form-control tool of the standard Playwright MCP (select, fill, press, hover, drag, dialog)', () => {
  // Arm C fairness: a Moodle "jump" single-select needs click (focus) then browser_select_option; the proxy must not block either.
  assert.equal(validateCall('browser_select_option', { target: 'e106', values: ['Single view'] }), null);
  assert.equal(validateCall('browser_select_option', { element: 'View mode', target: 'f1e106', values: ['a', 'b'] }), null);
  for (const [name, args] of [['browser_click', { target: 'e1' }], ['browser_fill_form', { fields: [] }], ['browser_press_key', { key: 'Enter' }], ['browser_hover', { target: 'e1' }], ['browser_drag', { startElement: 'a', startTarget: 'e1', endElement: 'b', endTarget: 'e2' }], ['browser_handle_dialog', { accept: true }], ['browser_type', { target: 'e1', text: 'x' }], ['browser_wait_for', { time: 1 }]])
    assert.equal(validateCall(name, args), null, name);
});

test('Codex model catalog: the cache file when present, else `codex debug models` (Codex 0.169 writes no models_cache.json)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'catalog-')), cachePath = join(dir, 'models_cache.json');
  try {
    const viaExec = readModelCatalog({ cachePath, exec: () => JSON.stringify({ models: [{ slug: 'gpt-6-luna', base_instructions: 'x' }] }) });
    assert.equal(viaExec.models[0].slug, 'gpt-6-luna');
    writeFileSync(cachePath, JSON.stringify({ models: [{ slug: 'cached' }] }));
    assert.equal(readModelCatalog({ cachePath, exec: () => { throw new Error('must not run'); } }).models[0].slug, 'cached');
    assert.throws(() => readModelCatalog({ cachePath: join(dir, 'none.json'), exec: () => 'not json' }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Codex boundary resolves setpriv (nix-provided on this host) to an existing executable path', () => {
  assert.ok(existsSync(findSetpriv()));
});

test('repair budget is the pilot maintenance budget (10 edits, 12 suite runs), imported from study/exploratory-plan.mjs', async () => {
  const { exploratoryConfig } = await import('../../study/exploratory-plan.mjs');
  assert.deepEqual(LIMITS, { acceptedEdits: exploratoryConfig.maintenanceEdits, scenarioRuns: exploratoryConfig.maintenanceSuites });
  assert.deepEqual(LIMITS, { acceptedEdits: 10, scenarioRuns: 12 });
  const p = createRepairPolicy({ breakClass: 'i' });
  assert.deepEqual(p.state, { acceptedEdits: 0, scenarioRuns: 0 });   // the harness's initial run is not counted, as in the pilot
});
