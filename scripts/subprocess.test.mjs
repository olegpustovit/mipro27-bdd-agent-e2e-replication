import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createInterface } from 'node:readline';
import { waitForOutput } from './subprocess.mjs';

test('result decoding waits for trailing output after exit, including a final unterminated JSON line', async () => {
  const child = new EventEmitter();
  const stdout = new PassThrough();
  const lines = createInterface({ input: stdout });
  let result, exited = false, settled = false;
  lines.on('line', line => { result = JSON.parse(line); });
  const completion = waitForOutput(child, { lines, onExit: () => { exited = true; } }).then(status => { settled = true; return status; });
  child.emit('exit', 0, null);
  assert.equal(exited, true);
  await Promise.resolve();
  assert.equal(settled, false);
  stdout.end('{"type":"result","scenarioCount":1,"tokens":42}');
  child.emit('close', 0, null);
  assert.deepEqual(await completion, { code: 0, signal: null });
  assert.deepEqual(result, { type: 'result', scenarioCount: 1, tokens: 42 });
});

test('spawn failure is reported instead of waiting indefinitely for output', async () => {
  const child = new EventEmitter();
  const completion = waitForOutput(child);
  child.emit('error', new Error('spawn failed'));
  await assert.rejects(completion, /spawn failed/);
});

test('a descendant holding pipes after exit produces a bounded infrastructure error', async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  let expired = false;
  const completion = waitForOutput(child, { drainMs: 10, onDrainTimeout: () => { expired = true; } });
  child.emit('exit', 0, null);
  await assert.rejects(completion, /output did not drain/);
  assert.equal(expired, true);
  assert.equal(child.stdout.destroyed, true);
  assert.equal(child.stderr.destroyed, true);
});

test('the drain deadline still rejects after child close if readline has not finished', async () => {
  const child = new EventEmitter(); child.stdout = new PassThrough();
  const lines = createInterface({ input: child.stdout });
  const completion = waitForOutput(child, { lines, drainMs: 10 });
  child.emit('exit', 0, null); child.emit('close', 0, null);
  await assert.rejects(completion, error => error.code === 'STUDY_INFRASTRUCTURE');
});
