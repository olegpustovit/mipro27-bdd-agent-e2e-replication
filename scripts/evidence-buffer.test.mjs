import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

test('ephemeral evidence transport preserves exact streams and requires ordered hash acknowledgements', { timeout: 20000 }, async () => {
  const helper = fileURLToPath(new URL('./evidence-buffer.mjs', import.meta.url));
  const input = 'synthetic transport fixture: α🙂\n'.repeat(75000);
  const source = "process.stdout.write('synthetic transport fixture: α🙂\\n'.repeat(75000)); process.stderr.write('synthetic diagnostic\\n');";
  const processHandle = spawn(process.execPath, [helper, '--', process.execPath, '-e', source], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, STUDY_EVIDENCE_BUFFER_BYTES: String(2 * 1024 * 1024) } });
  const exited = once(processHandle, 'exit');
  try {
    let ready = '';
    for await (const data of processHandle.stdout) { ready += data; if (ready.includes('\n')) break; }
    const url = JSON.parse(ready.trim()).url;
    const post = (route, body) => fetch(`${url}/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await post('close', {})).status, 409);
    const pieces = { stdout: [], stderr: [] };
    let chunks = 0;
    for (;;) {
      const response = await fetch(`${url}/chunk`);
      if (response.status === 204) {
        const status = await (await fetch(`${url}/status`)).json();
        if (status.result) { assert.equal(status.result.code, 0); break; }
        await new Promise(resolve => setTimeout(resolve, 5)); continue;
      }
      const item = await response.json(), body = Buffer.from(item.content_base64, 'base64');
      assert.equal((await (await fetch(`${url}/chunk/${item.sequence}`)).json()).sha256, item.sha256);
      assert.equal(body.length, item.bytes);
      assert.equal(createHash('sha256').update(body).digest('hex'), item.sha256);
      assert.equal((await post('ack', { sequence: item.sequence, sha256: 'wrong' })).status, 409);
      assert.equal((await (await fetch(`${url}/chunk`)).json()).sequence, item.sequence);
      pieces[item.stream].push(body); chunks++;
      assert.equal((await post('ack', { sequence: item.sequence, sha256: item.sha256 })).status, 200);
      assert.equal((await fetch(`${url}/chunk/${item.sequence}`)).status, 410);
    }
    assert(chunks > 2);
    assert.equal(Buffer.concat(pieces.stdout).toString('utf8'), input);
    assert.equal(Buffer.concat(pieces.stderr).toString('utf8'), 'synthetic diagnostic\n');
    const status = await (await fetch(`${url}/status`)).json();
    assert.equal(status.producedBytes, status.acknowledgedBytes);
    assert.equal(status.queuedBytes, 0);
    assert.equal((await post('close', {})).status, 200);
    assert.equal((await exited)[0], 0);
  } finally { if (processHandle.exitCode === null) processHandle.kill(); }
});
