// Host adapter integration check. Uses the normal bwrap entry point with a fake CLI.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const path = value => fileURLToPath(new URL(value, import.meta.url));
const root = await mkdtemp(join(tmpdir(), 'p3c-provider-test-'));
const executable = join(root, 'codex');
const syntheticToken = 'fixture-opaque-token-value';
const cases = [
  ['HTTP 401', 'auth', { type: 'error', message: 'HTTP 401' }],
  ['HTTP 403', 'auth', { type: 'turn.failed', error: { status_code: 403 } }],
  ['expired login', 'auth', null, 'Your login has expired'],
  ['invalid credentials', 'auth', { type: 'error', message: 'Invalid credentials' }],
  ['HTTP 402', 'credits', null, 'unexpected status 402'],
  ['quota', 'credits', { type: 'error', message: 'insufficient_quota' }],
  ['credits', 'credits', null, 'You are out of credits'],
  ['HTTP 429', 'rate limit', { type: 'error', message: 'HTTP 429' }],
  ['rate limit', 'rate limit', null, 'rate limit exceeded'],
  ['ordinary CLI error', null, { type: 'error', message: 'MCP connection timed out' }],
  ['scenario failure', null],
  ['recovered retry', null, { type: 'error', message: 'HTTP 429, retrying' }],
];

try {
  await writeFile(join(root, 'auth.json'), '{}', { mode: 0o600 });
  for (const [index, [name, category, event, diagnostic]] of cases.entries()) {
    const answered = ['scenario failure', 'recovered retry'].includes(name);
    const events = event ? [{ ...event, access_token: syntheticToken }] : [];
    if (answered) events.push(
      { type: 'item.completed', item: { type: 'agent_message',
        text: JSON.stringify({ status: 'fail', failed_step: 1, reason: 'The UI displayed a rate limit' }) } },
      { type: 'turn.completed', usage: { input_tokens: 17, output_tokens: 5 } },
    );
    const lines = events.map(value => `printf '%s\\n' '${JSON.stringify(value)}'`);
    lines.push(`printf '%s\\n' '${diagnostic ?? 'Codex diagnostic'} access_token=${syntheticToken}' >&2`);
    await writeFile(executable, ['#!/usr/bin/dash', ...lines, `exit ${answered ? 0 : 1}`, ''].join('\n'),
      { mode: 0o700 });
    const out = join(root, String(index));
    const run = spawnSync(path('../run'), ['--item', path('./item.json'), '--out', out], {
      env: { ...process.env, PATH: `${root}:${process.env.PATH}`, CODEX_HOME: root,
        BENCH_APP_URL: 'http://127.0.0.1:1/', BENCH_SCENARIO_FILE: path('./scenario.feature') },
      timeout: 30000,
    });
    assert.ifError(run.error);
    assert.equal(run.status, answered ? 0 : 1, name);
    const answer = JSON.parse(await readFile(join(out, 'answer.json'), 'utf8'));
    if (category) {
      const control = JSON.parse(await readFile(join(out, 'control.json'), 'utf8'));
      assert.deepEqual([control.stop, control.category, answer.valid], ['provider refusal', category, false]);
      assert.equal(control.reason, answer.reason);
    } else {
      await assert.rejects(readFile(join(out, 'control.json')), { code: 'ENOENT' });
      assert.equal(answer.status, answered ? 'fail' : 'unresolved');
      if (answered) assert.deepEqual(answer.tokens, { input: 17, cached: 0, output: 5 });
    }
    const stderr = await readFile(join(out, 'codex.stderr'), 'utf8');
    const jsonl = await readFile(join(out, 'codex.jsonl'), 'utf8');
    assert(stderr.includes(diagnostic ?? 'Codex diagnostic'));
    assert(!stderr.includes(syntheticToken));
    assert(!jsonl.includes(syntheticToken));
    if (event) assert(jsonl.includes(JSON.stringify({ ...event, access_token: '[redacted]' })));
    console.log('PASS', name);
  }
} finally {
  await rm(root, { recursive: true });
}
