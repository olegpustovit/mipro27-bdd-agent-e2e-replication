import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('actual proxy separates runtime tools from retained implementation repair and blocks Vite source routes', { timeout: 20000 }, async () => {
  for (const arm of ['runtime', 'maintained']) {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./mcp-browser.mjs', import.meta.url))], { env: { ...process.env, STUDY_ARM: arm, STUDY_CASE_ID: 'auth-login' }, stdio: ['pipe', 'pipe', 'pipe'] });
    const exited = once(child, 'exit');
    const input = createInterface({ input: child.stdout });
    const requests = new Map(); let id = 0, stderr = '';
    child.stderr.on('data', b => { stderr += b; });
    input.on('line', line => { const reply = JSON.parse(line); const pending = requests.get(reply.id); if (pending) { requests.delete(reply.id); pending(reply); } });
    const call = (method, params) => new Promise(resolve => { const key = ++id; requests.set(key, resolve); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: key, method, params })}\n`); });
    try {
      assert((await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'excluded-technical-test', version: '1' } })).result);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
      const names = (await call('tools/list', {})).result.tools.map(t => t.name);
      assert.equal(names.includes('baseline_read'), arm === 'maintained');
      for (const name of ['browser_evaluate', 'browser_run_code', 'browser_network_requests', 'browser_file_upload']) assert(!names.includes(name));
      const source = await call('tools/call', { name: 'browser_navigate', arguments: { url: 'http://localhost:3000/src/components/SignInForm.tsx' } });
      assert.equal(source.result.isError, true);
      const retained = await call('tools/call', { name: 'baseline_read', arguments: {} });
      if (arm === 'runtime') assert.equal(retained.result.isError, true);
      else { const read = JSON.parse(retained.result.content[0].text); assert(read.actions.includes('export async function')); assert(read.immutableAssertions.includes('Then(')); assert.deepEqual(Object.keys(read).sort(), ['actions', 'immutableAssertions', 'limits', 'locators']); }
    } finally {
      child.stdin.end();
      const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
      const [code] = await exited; clearTimeout(timer); input.close();
      assert.equal(code, 0, stderr);
    }
  }
});

test('actual proxy reports a fatal retained-rerun failure and never dispatches a queued rerun', { timeout: 20000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fatal-proxy-check-'));
  const socketPath = join(directory, 'observer.sock'), events = [], sockets = new Set();
  const server = createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    createInterface({ input: socket }).on('line', line => {
      const event = JSON.parse(line); events.push(event);
      if (event.type === 'host-request') socket.write(`${JSON.stringify({ id: event.id, result: { recorded: true } })}\n`);
    });
  });
  await new Promise((resolve, reject) => server.listen(socketPath, resolve).once('error', reject));
  const normal = spawn(process.execPath, [fileURLToPath(new URL('./mcp-browser.mjs', import.meta.url))], {
    env: { ...process.env, STUDY_ARM: 'maintained', STUDY_CASE_ID: 'auth-login', STUDY_AUDIT_SOCKET: socketPath }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const normalClosed = once(normal, 'close'), normalLines = createInterface({ input: normal.stdout });
  const normalInitialized = once(normalLines, 'line');
  normal.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'excluded-terminal-calibration', version: '1' } } })}\n`);
  assert(JSON.parse((await normalInitialized)[0]).result);
  normal.stdin.end();
  assert.equal((await normalClosed)[0], 0);
  assert.equal(events.filter(e => e.type === 'host-request' && e.method === 'proxy-complete').length, 1);
  normalLines.close(); events.length = 0;
  const child = spawn(process.execPath, [fileURLToPath(new URL('./mcp-browser.mjs', import.meta.url))], {
    env: { ...process.env, STUDY_ARM: 'maintained', STUDY_CASE_ID: 'auth-login', STUDY_CDP_ENDPOINT: 'http://127.0.0.1:1', STUDY_AUDIT_SOCKET: socketPath },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const exited = once(child, 'close');
  let stderr = '';
  child.stderr.on('data', b => { stderr += b; });
  const lines = createInterface({ input: child.stdout });
  try {
    const initialized = once(lines, 'line');
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'excluded-fatal-calibration', version: '1' } } })}\n`);
    assert(JSON.parse((await initialized)[0]).result);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    for (const id of [2, 3]) child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'baseline_run', arguments: {} } })}\n`);
    const [code] = await exited;
    assert.equal(code, 1, stderr);
    assert.equal(events.filter(e => e.type === 'tool-call' && e.name === 'baseline_run').length, 1);
    assert.equal(events.filter(e => e.type === 'host-request' && e.method === 'report-infrastructure-failure').length, 1);
    assert.equal(events.some(e => e.type === 'host-request' && e.method === 'begin-retained-attempt'), false);
    assert.equal(events.some(e => e.type === 'baseline-run'), false);
  } finally {
    child.kill('SIGKILL'); lines.close();
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});
