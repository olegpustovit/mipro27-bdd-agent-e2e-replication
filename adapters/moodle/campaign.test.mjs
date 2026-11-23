import test from 'node:test';
import assert from 'node:assert/strict';
import { createMcpServer } from './mcp-server.mjs';
import { phpToJsRegex } from './repair.mjs';
import { buildMoodlePrompt } from './prompt.mjs';
import { summarizeEvents } from './agent-run.mjs';

test('mcp server: initialize, list, call, errors', async () => {
  const calls = [], s = await createMcpServer({ tools: [{ name: 'echo', description: 'd', inputSchema: { type: 'object' }, handler: async a => ({ got: a.x }) }, { name: 'boom', description: 'd', inputSchema: { type: 'object' }, handler: async () => { throw new Error('nope'); } }], onCall: c => calls.push(c) });
  const post = async body => { const r = await fetch(s.endpoint, { method: 'POST', body: JSON.stringify(body) }); return r.status === 202 ? null : r.json(); };
  try {
    assert.equal((await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } })).result.protocolVersion, '2025-03-26');
    assert.equal(await post({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
    assert.deepEqual((await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).result.tools.map(t => t.name), ['echo', 'boom']);
    assert.equal((await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo', arguments: { x: 7 } } })).result.content[0].text, '{"got":7}');
    const bad = (await post({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'boom' } })).result;
    assert.equal(bad.isError, true); assert.match(bad.content[0].text, /nope/);
    assert.equal(calls.length, 2);
  } finally { await s.close(); }
});
test('PCRE step annotations become JS regexes', () => {
  assert.ok(phpToJsRegex('^I search for "(?P<query>[^"]*)" using the header global search box$').test('I search for "frogs" using the header global search box'));
});
test('prompt marks an already open session only when pre-authenticated', () => {
  const handoff = { baseUrl: 'http://webserver', loginUrl: 'http://webserver/login/index.php', credentials: [{ username: 'admin', password: 'admin' }] };
  const steps = [{ keyword: 'Given', text: 'I log in as "admin"' }, { keyword: 'Then', text: 'I should see "x"' }];
  assert.match(buildMoodlePrompt({ handoff, steps, preauth: 'admin' }), /already done: the browser holds an open session for "admin"/);
  assert.doesNotMatch(buildMoodlePrompt({ handoff, steps }), /already done/);
});
test('omp events: final text, usage with cache counted once, model time', () => {
  const messages = [{ role: 'user' }, { role: 'assistant', model: 'm', duration: 1000, usage: { input: 10, cacheRead: 100, cacheWrite: 5, output: 7, cost: { total: 0.01 } }, content: [{ type: 'text', text: 'ok' }] }];
  const ompUsage = ms => ({ usage: { input_tokens: ms.reduce((n, m) => n + (m.usage?.input ?? 0) + (m.usage?.cacheRead ?? 0) + (m.usage?.cacheWrite ?? 0), 0), output_tokens: 7 }, cost: 0.01 });
  const r = summarizeEvents([{ type: 'agent_end', messages }], { ompUsage, ompFinal: () => ({ result: 'ok' }) });
  assert.equal(r.result, 'ok'); assert.equal(r.usage.input_tokens, 115); assert.equal(r.modelMs, 1000); assert.deepEqual([...r.models], ['m']);
});

import { loginOf } from './arm-c.mjs';
import { decodeStepVerdict } from './verdict.mjs';
test('pre-authentication recognises the log-in step forms', () => {
  assert.deepEqual(loginOf('I log in as "admin"'), { user: 'admin', navigates: false });
  assert.deepEqual(loginOf('I am on the "Test database name" "data activity" page logged in as teacher1'), { user: 'teacher1', navigates: true });
  assert.deepEqual(loginOf('I am on the "Test database name" "data activity" page logged in as "teacher1"'), { user: 'teacher1', navigates: true });
  assert.deepEqual(loginOf('I am logged in as admin'), { user: 'admin', navigates: false });
  assert.equal(loginOf('I press "Save"'), null);
  assert.match(buildMoodlePrompt({ handoff: { baseUrl: 'u', loginUrl: 'l', credentials: [] }, steps: [{ keyword: 'Given', text: 'x' }], preauth: { username: 't', navigates: true } }), /do the navigation this step names/);
});
test('verdict step text may carry the list number the agent saw', () => {
  const steps = [{ text: 'I log in as "a"' }, { text: 'I should see "x"' }];
  const v = decodeStepVerdict(JSON.stringify({ status: 'fail', reason: 'r', failingStep: 2, failingStepText: '[2] Then I should see "x"' }), steps, { offset: 3 });
  assert.equal(v.failingStepVerified, true); assert.equal(v.behatStepIndex, 4);
});

test('codex events summarize the same way (path ready; Codex is not logged in on this host)', () => {
  const r = summarizeEvents([{ type: 'item.completed', item: { type: 'agent_message', text: '{"status":"pass"}' } }, { type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 4, output_tokens: 2 } }], {});
  assert.equal(r.result, '{"status":"pass"}'); assert.equal(r.usage.input_tokens, 10);
});

import { isRunnablePair } from '../../scripts/moodle/common.mjs';
import { loadManifest as loadManifestForPairs, stateSpec, patchFile } from './manifest.mjs';
import { scenarioText, scenarioTextSha } from './scenario-text.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { selectPairs, selectionCounts, SELECTION_RULE, orderOk, startState, EXACT, stepClass } from '../../scripts/moodle/v1-report.mjs';
import { judge, atTarget } from '../../scripts/analysis/moodle-oracle.mjs';
const REPORT = new URL('../../results/moodle-v1-reproduction.jsonl', import.meta.url).pathname;
const records = () => readFileSync(REPORT, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const filesOfPatch = text => [...text.matchAll(/^diff --git a\/(\S+) b\/(\S+)/gm)].map(m => m[2]);
test('campaign pairs: a pair is runnable only when the V1 report lists it as valid (exact step rule)', () => {
  const m = loadManifestForPairs(), valid = records().filter(r => r.type === 'pair' && (r.valid_strict || r.valid_core));
  assert.ok(valid.length > 0);
  for (const r of valid) assert.equal(isRunnablePair(m, { break: r.break, fault: r.fault, scenario: r.scenario }), true);
  assert.equal(isRunnablePair(m, { break: 'B12', fault: 'X001', scenario: 'S001' }), false);   // not a valid scenario for that pair
  assert.equal(isRunnablePair(m, { break: 'B12', fault: 'X999', scenario: 'S076' }), false);
  // B12 + F01 @ S079 is manifest-linked but fails at step 25, target 24: not valid, not runnable (a manifest link alone is no longer enough)
  assert.equal(isRunnablePair(m, { break: 'B12', fault: 'F01', scenario: 'S079' }), false);
  assert.ok(!valid.some(r => r.fault === 'F01' && r.scenario === 'S079'));
});
test('one step rule: valid pairs and campaign scoring both use tolerance 0 (same Behat index or same step text)', () => {
  assert.equal(EXACT(stepClass(25, 24, 'a', 'b')), false);   // near: within 2 steps, not exact
  assert.equal(EXACT(stepClass(24, 24, 'a', 'b')), true);
  assert.equal(EXACT(stepClass(30, 24, 'same text', 'same text')), true);
  const body = (status, idx, text) => ({ arm: 'A', status, failingStepIndex: idx, failingStep: idx == null ? null : { text } });
  const j = (idx, t) => judge({ healthy: body('passed'), faulted: body('failed', idx, t), target: { step_index: 24, step_text: 'target' } });
  assert.equal(j(24, 'x').outcome, 'caught'); assert.equal(j(25, 'x').outcome, 'fail-near'); assert.equal(j(25, 'target').outcome, 'caught');
  assert.equal(atTarget({ located: true, stepIndex: 25, stepText: 'x' }, { step_index: 24, step_text: 'target' }), false);
  for (const r of records().filter(r => r.type === 'pair' && (r.valid_strict || r.valid_core))) assert.equal(r.fault_step_vs_target, 'at', `${r.break}+${r.fault}@${r.scenario}`);
});
test('arm B starts from the developers\' Gherkin: no state arms B uses touches a .feature file, and the same scenario text reaches every arm', () => {
  const m = loadManifestForPairs();
  for (const b of m.breaks) {
    const sp = stateSpec(m, `broken-steps:${b.id}`), text = readFileSync(patchFile(b.patches.broken_steps), 'utf8');
    assert.equal(createHash('sha256').update(text).digest('hex'), b.patches.broken_steps.sha256);
    if (b.test_half_split.empty) { assert.equal(sp.patch, null); assert.equal(text, ''); } else assert.equal(sp.patch.sha256, b.patches.broken_steps.sha256);
    if (b.id !== 'B08') assert.deepEqual(b.test_half_split.feature_files.length > 0, b.class === 'ii', `${b.id}: class i has no .feature hunk in its test half, class ii has`);
    assert.deepEqual(filesOfPatch(text).filter(f => f.endsWith('.feature')), [], `${b.id} broken-steps patch must not touch Gherkin`);
    assert.equal(b.test_half_split.identical_to_broken, b.patches.broken_steps.sha256 === b.patches.broken.sha256);
    assert.equal(startState(b), b.test_half_split.identical_to_broken && b.test_half_split.start_rows !== 'broken-steps' ? `broken:${b.id}` : `broken-steps:${b.id}`);
  }
  assert.deepEqual(m.breaks.filter(b => b.class === 'i' && b.test_half_split.feature_files.length).map(b => b.id), ['B08']);   // recorded exception: B08 (class i) has a .feature hunk in its test half
  // every pair of the report: the states arms A, B and C run (healthy, broken-steps:B, fault:F) leave the pair's feature file untouched
  for (const r of records().filter(r => r.type === 'pair' && (r.valid_strict || r.valid_core))) {
    const feature = m.scenarioById.get(r.scenario).feature.replace(/^(?!public\/)/, 'public/');
    for (const st of [`broken-steps:${r.break}`, `fault:${r.fault}`]) { const sp = stateSpec(m, st); if (sp.patch) assert.ok(!filesOfPatch(readFileSync(patchFile(sp.patch), 'utf8')).includes(feature), `${st} touches ${feature}`); }
  }
});
test('scenario text hash: stable under unrelated edits, changes with a step, tag, background or example', () => {
  const f = '@javascript\nFeature: F\n  Background:\n    Given the following "users" exist:\n      | username |\n      | u1 |\n  Scenario: A\n    When I press "Save"\n    Then I should see "x"\n  Scenario: B\n    When I press "Other"\n';
  const a = scenarioTextSha(f, 'A');
  assert.equal(scenarioTextSha(f.replace('Other', 'Another'), 'A'), a);   // another scenario changed
  assert.notEqual(scenarioTextSha(f.replace('"x"', '"y"'), 'A'), a);
  assert.notEqual(scenarioTextSha(f.replace('| u1 |', '| u2 |'), 'A'), a);
  assert.match(scenarioText(f, 'A'), /S Then I should see "x"/);
  assert.throws(() => scenarioText(f, 'Missing'), /0 matches/);
});
test('selection rule: class i first (3 per break, no shared fault+scenario), then class ii (2 per break), total 16', () => {
  const mk = (b, f, s, strict = true, cls = null) => ({ break: b, fault: f, scenario: s, valid_strict: strict, valid_core: true, origin: 'seeded' });
  const breaks = [{ break: 'B1', class: 'i', reproduced_strict: true }, { break: 'B2', class: 'i', reproduced_strict: false }, { break: 'B3', class: 'ii', reproduced_strict: true }, { break: 'B4', class: 'ii', reproduced_strict: true }];
  const pairs = [mk('B1', 'X1', 'S1'), mk('B1', 'X1', 'S2'), mk('B1', 'X2', 'S3'), mk('B1', 'X3', 'S4'), mk('B2', 'X1', 'S1', false), mk('B2', 'X9', 'S9', false),
    ...['S10', 'S11', 'S12'].map(s => mk('B3', 'X5', s)), ...['S20', 'S21', 'S22'].map(s => mk('B4', 'X6', s))];
  const { selected } = selectPairs({ pairs, breaks });
  const k = p => `${p.break}.${p.fault}@${p.scenario}`;
  assert.deepEqual(selected.filter(p => breaks.find(b => b.break === p.break).class === 'i').map(k), ['B1.X1@S1', 'B1.X2@S3', 'B1.X3@S4', 'B2.X9@S9']);   // B1: distinct faults first, 3 max; B2's X1@S1 is B1's
  assert.equal(new Set(selected.map(p => `${p.fault}@${p.scenario}`)).size, selected.length);
  assert.deepEqual(selected.filter(p => breaks.find(b => b.break === p.break).class === 'ii').map(k), ['B3.X5@S10', 'B4.X6@S20', 'B3.X5@S11', 'B4.X6@S21']);   // 2 per break, rank rounds
  assert.equal(SELECTION_RULE.total, 16);
  const many = Array.from({ length: 12 }, (_, i) => mk(`C${i}`, 'X1', `S${i}`)), manyB = many.map((p, i) => ({ break: p.break, class: i < 6 ? 'i' : 'ii', reproduced_strict: true }));
  assert.ok(selectPairs({ pairs: [...many, ...many.map(p => ({ ...p, fault: 'X2' })), ...many.map(p => ({ ...p, fault: 'X3' }))], breaks: manyB }).selected.length <= 16);
  assert.deepEqual(selectionCounts(selected, breaks).byClass, [['class i', 4], ['class ii', 4]]);
});
test('ordering criterion (class-i-first-v3): a fault whose target step is before the step where the break bites is never selected', () => {
  const mk = (b, f, s, t, bite) => ({ break: b, fault: f, scenario: s, valid_strict: false, valid_core: true, origin: 'seeded', target_step_index: t, observed_break_failing_step: bite });
  const breaks = [{ break: 'B1', class: 'i', reproduced_strict: false }];
  assert.equal(orderOk(mk('B1', 'X1', 'S1', 5, 5)), true); assert.equal(orderOk(mk('B1', 'X1', 'S1', 6, 5)), true); assert.equal(orderOk(mk('B1', 'X1', 'S1', 0, 1)), false);
  const r = selectPairs({ pairs: [mk('B1', 'X1', 'S1', 0, 1), mk('B1', 'X2', 'S2', 3, 3)], breaks });
  assert.deepEqual(r.selected.map(p => p.fault), ['X2']); assert.deepEqual(r.orderExcluded.map(p => p.fault), ['X1']); assert.equal(SELECTION_RULE.id, 'class-i-first-v3');
});
test('the V1 report selection is the rule applied to the recorded rows', () => {
  const rec = records(), pairs = rec.filter(r => r.type === 'pair'), breaks = rec.filter(r => r.type === 'break');
  const { selected } = selectPairs({ pairs, breaks });
  assert.ok(selected.length > 0 && selected.length <= SELECTION_RULE.total);
  assert.equal(new Set(selected.map(p => `${p.fault}@${p.scenario}`)).size, selected.length);
  const perBreak = new Map(); for (const p of selected) perBreak.set(p.break, (perBreak.get(p.break) ?? 0) + 1);
  for (const [b, n] of perBreak) assert.ok(n <= (breaks.find(x => x.break === b).class === 'i' ? 3 : 2), b);
  assert.ok(!selected.some(p => p.fault === 'F01' && p.scenario === 'S079'));
});

test('every selected pair resolves a fault target in its scenario (seeded candidates keep other scenarios as screen_targets)', async () => {
  const { loadManifest, faultTarget } = await import('./manifest.mjs'), { selectedPairs } = await import('../../scripts/moodle/v1-report.mjs'), m = loadManifest(), pairs = selectedPairs();
  assert.ok(pairs.length > 0);
  for (const p of pairs) { const t = faultTarget(m, p.fault, p.scenario); assert.equal(t.scenario, p.scenario); assert.ok(t.step_text && Number.isInteger(t.step_index), `${p.fault}@${p.scenario}`); }
  assert.throws(() => faultTarget(m, 'X014', 'S040'), /no target in S040/);   // S040 passed with the fault: not a target
});
