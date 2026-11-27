import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { openBrowser } from './browser.mjs';

async function serve(handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

test('Playwright MCP exposes UI observations and denies cross-origin redirects', async t => {
  let escaped = 0;
  const other = await serve((req, res) => { escaped++; res.end('External'); });
  t.after(other.close);
  const app = await serve((req, res) => {
    if (req.url === '/leave') return res.writeHead(302, { location: other.url }).end();
    res.writeHead(200, { 'content-type': 'text/html' }).end('<h1>Adapter fixture</h1>');
  });
  t.after(app.close);
  let toolCalls = 0;
  const browser = await openBrowser({
    url: app.url, app: 'fixture', attemptTool: () => { toolCalls++; return true; }, observeTool() {},
  });
  t.after(browser.close);
  let id = 0;
  async function send(method, params, notification = false) {
    const res = await fetch(browser.endpoint, {
      method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: notification ? undefined : ++id, method, params }),
    });
    if (notification) return assert.equal(res.status, 202);
    assert.equal(res.status, 200);
    return res.json();
  }
  await send('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  await send('notifications/initialized', undefined, true);
  const { result } = await send('tools/list');
  assert(result.tools.some(tool => tool.name === 'browser_snapshot'));
  assert(!result.tools.some(tool => ['browser_evaluate', 'browser_run_code', 'browser_console_messages'].includes(tool.name)));
  const call = (name, args = {}) => send('tools/call', { name, arguments: args });
  assert((await call('browser_evaluate', { function: '() => 1' })).result.isError);
  assert((await call('browser_navigate', { url: other.url })).result.isError);
  await call('browser_navigate', { url: app.url });
  assert.match((await call('browser_snapshot')).result.content[0].text, /Adapter fixture/);
  await call('browser_navigate', { url: app.url + '/leave' });
  assert.equal(escaped, 0);
  assert.equal(toolCalls, 5);
});
