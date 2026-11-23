import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { blockedOrder, runTrials, foldTrials } from './ledger/trials.mjs';
import { ledgerPaths, ensureDirs } from './ledger/paths.mjs';
import { readLines, appendSync } from './ledger/jsonl.mjs';
import { meter, wallSplit, sumMeters, normalizeUsage } from './ledger/metering.mjs';
import { createBlobStore } from './ledger/blobstore.mjs';
import { trialKey, parseTaskKey, unitName } from './ledger/keys.mjs';
import { collectRequestIds } from './drivers/index.mjs';
import { createDriver as ompDriver } from './drivers/omp.mjs';
import { createDriver as codexDriver } from './drivers/codex.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'ledger-unit-'));
const specs = n => Array.from({ length: n }, (_, i) => ({ key: `abc/c${i % 4}/healthy/${i % 2 ? 'runtime' : 'maintained'}/m/r${1 + Math.floor(i / 4)}`, block: `c${i % 4}` }));

test('keys: task, trial and unit names', () => {
  assert.equal(parseTaskKey('campaign:moodle/luna').base, 'campaign:moodle/luna');
  assert.equal(parseTaskKey('campaign:moodle/luna#2').rerun, 2);
  assert.throws(() => parseTaskKey('campaign:moodle/luna#1'));
  assert.throws(() => parseTaskKey('nokind'));
  assert.equal(trialKey({ plan: 'abc123', caseId: 'auth-login', state: 'v0', arm: 'runtime', model: 'gpt-6-luna', repetition: 2 }), 'abc123/auth-login/v0/runtime/gpt-6-luna/r2');
  assert.notEqual(unitName('campaign:a/b'), unitName('campaign:a-b'));
  assert.match(unitName('campaign:moodle/luna'), /^study-campaign-moodle-luna-[0-9a-f]{8}$/);
});

test('blocked order is seeded, stable, and a permutation that keeps blocks contiguous', () => {
  const s = specs(16), a = blockedOrder(s, { seed: 'S1' }), b = blockedOrder(s, { seed: 'S1' }), c = blockedOrder(s, { seed: 'S2' });
  assert.deepEqual(a.map(t => t.key), b.map(t => t.key));
  assert.notDeepEqual(a.map(t => t.key), c.map(t => t.key));
  assert.deepEqual(a.map(t => t.key).sort(), s.map(t => t.key).sort());
  const blocks = a.map(t => t.block), runs = blocks.filter((x, i) => x !== blocks[i - 1]);
  assert.equal(runs.length, new Set(blocks).size);
});

test('runTrials: recorded order is reused on resume, ended trials never re-run, interrupted ones get attempt 2, errors are kept', async () => {
  const dir = tmp(), paths = ensureDirs(ledgerPaths(dir)), s = specs(8), ran = [];
  try {
    await runTrials({ taskKey: 'campaign:u/a', trials: s, seed: 'seed-1', paths, runOne: async t => { ran.push(t.key); if (ran.length === 3) throw new Error('model refused'); return { usage: { input_tokens: 5 } }; } });
    const first = readLines(paths.trials).find(e => e.type === 'trials-planned');
    assert.equal(first.seed, 'seed-1'); assert.deepEqual(ran, first.order);
    const end3 = readLines(paths.trials).filter(e => e.type === 'trial-end')[2];
    assert.equal(end3.outcome, 'error'); assert.match(end3.error, /refused/);
    // Simulate a crash: a start without an end for a fresh run.
    const dir2 = tmp(), p2 = ensureDirs(ledgerPaths(dir2)), done = [];
    await runTrials({ taskKey: 'campaign:u/b', trials: s, seed: 'x', paths: p2, runOne: async t => { done.push(t.key); } });
    const ev = readLines(p2.trials), planned = ev.find(e => e.type === 'trials-planned');
    // drop the last trial-end to look like a kill after trial-start
    const lastEnd = ev.map(e => e.type).lastIndexOf('trial-end');
    writeFileSync(p2.trials, ev.filter((_, i) => i !== lastEnd).map(e => JSON.stringify(e)).join('\n') + '\n');
    const again = [];
    const r = await runTrials({ taskKey: 'campaign:u/b', trials: s, seed: 'DIFFERENT', paths: p2, runOne: async (t, { attempt }) => { again.push([t.key, attempt]); } });
    assert.deepEqual(again, [[planned.order.at(-1), 2]]); assert.equal(r.recoveredInterrupted, 1); assert.equal(r.seed, 'x');
    const t = foldTrials(readLines(p2.trials)).trials.get(planned.order.at(-1));
    assert.equal(t.attempts.length, 2); assert.ok(t.attempts[0].interrupted && t.attempts[1].end);
    await assert.rejects(runTrials({ taskKey: 'campaign:u/b', trials: s.slice(1), paths: p2, runOne: async () => {} }), /differs from the recorded plan/);
    rmSync(dir2, { recursive: true, force: true });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('runTrials: refuses a #N trial without a reason', async () => {
  const dir = tmp();
  try { await assert.rejects(runTrials({ taskKey: 'campaign:u/c', trials: [{ key: 'a/b/c/d/e/r1#2' }], paths: ensureDirs(ledgerPaths(dir)), runOne: async () => {} }), /rerunReason/); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test('metering keeps unknown as null, never 0', () => {
  const m = meter({ usage: { input_tokens: 100, output_tokens: 7 }, wall: { totalMs: 1000, modelMs: 600 } });
  assert.equal(m.cacheReadTokens, null); assert.equal(m.cacheWriteTokens, null); assert.equal(m.reasoningTokens, null);
  assert.equal(m.wall.browserMs, null); assert.equal(m.wall.unattributedMs, null); assert.equal(m.reportedCostUsd, null);
  assert.equal(wallSplit({ totalMs: 10, modelMs: 4, browserMs: 3, fixtureMs: 1 }).unattributedMs, 2);
  assert.equal(normalizeUsage({ input_tokens: -1, output_tokens: 1.5 }).inputTokens, null);
  const sum = sumMeters([meter({ usage: { input_tokens: 10 } }), meter({ usage: {} })]);
  assert.equal(sum.inputTokens, null); assert.equal(sum.inputTokensObserved, 10); assert.equal(sum.inputTokensCoverage, '1/2');
  assert.equal(sumMeters([meter({ usage: { input_tokens: 10 } }), meter({ usage: { input_tokens: 5 } })]).inputTokens, 15);
});

test('blob store: content addressed, deduplicated, verified, per-trial manifest', async () => {
  const dir = tmp(), store = createBlobStore({ root: join(dir, 'blobs') });
  try {
    const key = 'abc/c1/v0/runtime/m/r1';
    const a = await store.attach(key, 'mcp-snapshot', 'snap-1.md', Buffer.from('hello'));
    const b = await store.attach('abc/c2/v0/runtime/m/r1', 'mcp-snapshot', 'snap-1.md', Buffer.from('hello'));
    assert.equal(a.sha256, b.sha256);
    writeFileSync(join(dir, 'trace.zip'), 'zipbytes');
    await store.attach(key, 'playwright-trace', 'trace.zip', { path: join(dir, 'trace.zip') });
    assert.deepEqual(store.manifest(key).entries.map(e => e.name), ['snap-1.md', 'trace.zip']);
    assert.equal(store.read(a.sha256).toString(), 'hello');
    assert.deepEqual(await store.verify(key), []);
    writeFileSync(store.objectPath(a.sha256), 'tampered');
    assert.equal((await store.verify(key)).length, 1);
    await assert.rejects(store.attach(key, 'bogus', 'x', Buffer.from('x')), /Unknown blob kind/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('drivers: omp version comes from `omp --version`; request ids are collected', async () => {
  const dir = tmp(); mkdirSync(join(dir, 'bin'));
  writeFileSync(join(dir, 'bin/omp'), '#!/bin/sh\necho "omp/18.20.2"\n'); chmodSync(join(dir, 'bin/omp'), 0o755);
  writeFileSync(join(dir, 'bin/codex'), '#!/bin/sh\necho "codex-cli 0.169.0"\n'); chmodSync(join(dir, 'bin/codex'), 0o755);
  const old = process.env.PATH; process.env.PATH = join(dir, 'bin') + ':' + old;
  try {
    const omp = ompDriver({ model: 'claude-haiku-5-5' }), codex = codexDriver({ model: 'gpt-6-luna' });
    assert.equal(await omp.version(), 'omp/18.20.2'); assert.equal(await codex.version(), 'codex-cli 0.169.0');
    const frozen = await omp.frozenInputs();
    assert.deepEqual({ ...frozen }, { driver: 'omp', cliVersion: 'omp/18.20.2', model: 'claude-haiku-5-5', systemPromptHash: null, systemPromptHashSource: 'unavailable' });
    assert.deepEqual(collectRequestIds([{ message: { responseId: 'r1' } }, { payload: { request_id: 'r2', nested: { requestId: 'r3' } } }, { id: 'ignored' }]), ['r1', 'r2', 'r3']);
    const u = omp.usage([{ type: 'agent_end', messages: [{ role: 'assistant', usage: { input: 10, cacheRead: 5, cacheWrite: 2, output: 3, cost: { total: 0.1 } } }] }]);
    assert.equal(u.inputTokens, 17); assert.equal(u.cacheReadTokens, 5); assert.equal(u.cacheWriteTokens, 2); assert.equal(u.outputTokens, 3); assert.equal(u.reasoningTokens, null);
    assert.equal(codex.usage([{ type: 'turn.completed', usage: { input_tokens: 9, cached_input_tokens: 4, output_tokens: 2 } }]).cacheWriteTokens, null);
  } finally { process.env.PATH = old; rmSync(dir, { recursive: true, force: true }); }
});
