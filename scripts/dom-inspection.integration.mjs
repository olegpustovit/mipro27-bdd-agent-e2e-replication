// Model-free shared-tool/privacy calibration. Output is evidence, not trials.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireLock, reset, freshBrowser, prepareUIAction } from './fixture.mjs';

const unlock = acquireLock(), results = [];
try {
  for (const arm of ['runtime', 'maintained']) {
    const directory = mkdtempSync(join(tmpdir(), 'dom-inspection-control-'));
    const socketPath = join(directory, 'observer.sock'), events = [], sockets = new Set();
    let browser, server, child, lines, exited;
    try {
      await reset(); browser = await freshBrowser();
      server = createServer(socket => {
        sockets.add(socket); socket.on('close', () => sockets.delete(socket));
        createInterface({ input: socket }).on('line', async line => {
          const event = JSON.parse(line); events.push(event);
          if (event.type !== 'host-request') return;
          try {
            if (event.method === 'prepare-ui-action') await prepareUIAction(browser.context);
            else assert.equal(event.method, 'proxy-complete');
            socket.write(JSON.stringify({ id: event.id, result: { recorded: true } }) + '\n');
          } catch (error) { socket.write(JSON.stringify({ id: event.id, error: error.message }) + '\n'); }
        });
      });
      await new Promise((resolve, reject) => server.listen(socketPath, resolve).once('error', reject));
      child = spawn(process.execPath, [fileURLToPath(new URL('./mcp-browser.mjs', import.meta.url))], {
        env: { ...process.env, STUDY_ARM: arm, STUDY_CASE_ID: 'auth-login', STUDY_CDP_ENDPOINT: browser.endpoint, STUDY_AUDIT_SOCKET: socketPath },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      exited = once(child, 'close');
      let stderr = ''; child.stderr.on('data', data => { stderr += data; });
      lines = createInterface({ input: child.stdout });
      let id = 0; const pending = new Map();
      lines.on('line', line => {
        const response = JSON.parse(line), request = pending.get(response.id);
        if (request) { pending.delete(response.id); clearTimeout(request.timer); request.resolve(response); }
      });
      child.on('close', () => { for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Proxy closed: ' + stderr)); } pending.clear(); });
      const call = (method, params) => new Promise((resolve, reject) => {
        const key = ++id, timer = setTimeout(() => { pending.delete(key); reject(new Error('Calibration request timed out')); }, 20000);
        pending.set(key, { resolve, reject, timer });
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: key, method, params }) + '\n');
      });
      const tool = (name, args = {}) => call('tools/call', { name, arguments: args });
      assert((await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'excluded-dom-control', version: '1' } })).result);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
      const tools = (await call('tools/list', {})).result.tools;
      assert(tools.some(t => t.name === 'browser_inspect')); assert(!tools.some(t => t.name === 'browser_evaluate'));
      assert.notEqual((await tool('browser_navigate', { url: 'http://localhost:3000/signin' })).result?.isError, true);
      const page = browser.context.pages().find(p => p.url() === 'http://localhost:3000/signin');
      await page.locator('[data-test="signin-submit"]').evaluate(button => {
        button.setAttribute('data-test', 'revised-signin-hook'); button.setAttribute('data-oracle', 'PRIVATE_ORACLE_SENTINEL');
        const hidden = document.createElement('span'); hidden.style.display = 'none'; hidden.textContent = 'PRIVATE_HIDDEN_SENTINEL'; button.appendChild(hidden);
      });
      const snapshot = await tool('browser_snapshot');
      const text = snapshot.result.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
      const target = text.match(/button "Sign In"[^\n]*\[ref=(e\d+)\]/i)?.[1];
      assert(target, 'No current Sign In reference in native snapshot: ' + text);
      const actionBoundaries = () => events.filter(e => e.type === 'host-request' && e.method === 'prepare-ui-action').length;
      const before = actionBoundaries();
      const response = await tool('browser_inspect', { target });
      assert.notEqual(response.result?.isError, true, JSON.stringify(response));
      const metadata = JSON.parse(response.result.content[0].text);
      assert.equal(metadata.element.attributes['data-test'], 'revised-signin-hook');
      assert(metadata.ancestors.length <= 3);
      assert(!JSON.stringify(response).includes('PRIVATE_'));
      assert.equal(actionBoundaries(), before, 'read-only inspection must not close the current Then window');
      await page.locator('[data-test="revised-signin-hook"]').evaluate(button => { button.style.opacity = '0'; button.title = 'PUBLIC_ATTRIBUTE_CONTENT'; });
      assert.equal(await page.locator('[data-test="revised-signin-hook"]').isVisible(), true);
      const transparent = await tool('browser_inspect', { target });
      assert.notEqual(transparent.result?.isError, true);
      assert.equal(JSON.parse(transparent.result.content[0].text).element.attributes.title, 'PUBLIC_ATTRIBUTE_CONTENT');
      const direct = await tool('browser_evaluate', { function: '() => window.__studyCaptureUI()' });
      assert.equal(direct.result.isError, true);
      const code = await tool('browser_inspect', { target, function: '() => window.__studyCaptureUI()' });
      assert.equal(code.result.isError, true);
      await page.locator('[data-test="revised-signin-hook"]').evaluate(button => button.style.visibility = 'hidden');
      const hidden = await tool('browser_inspect', { target });
      assert.equal(hidden.result.isError, true); assert(!JSON.stringify(hidden).includes('PRIVATE_'));
      child.stdin.end(); assert.equal((await exited)[0], 0, stderr);
      results.push({ arm, ok: true, metadata, commonToolSchema: tools.find(t => t.name === 'browser_inspect'),
        changedHookDiscoverable: true, privateAttributesAndHiddenTextWithheld: true, directJavaScriptRejected: true,
        inspectionCodeArgumentRejected: true, visibilityHiddenTargetRejected: true, opacityFollowsNativeLayoutVisibility: true,
        allowedAttributeContentsArePublicMetadata: true, readOnlyInspectionPreservesPhaseWindow: true });
    } finally {
      if (child && child.exitCode === null) { child.stdin.end(); const timer = setTimeout(() => child.kill('SIGKILL'), 3000); await exited; clearTimeout(timer); }
      lines?.close(); for (const socket of sockets) socket.destroy();
      if (server) await new Promise(resolve => server.close(resolve));
      await browser?.close(); rmSync(directory, { recursive: true, force: true });
    }
  }
  assert.deepEqual(results[0].commonToolSchema, results[1].commonToolSchema);
  console.log(JSON.stringify({ type: 'dom-inspection-calibration', excludedFromStudy: true, languageModelUsed: false, ok: true, results,
    limits: ['Synthetic UI-hook change, not a measured version transition.', 'All allowlisted attribute contents are public inspection data; private instrumentation must never encode state in them.', 'Visibility follows Playwright layout dimensions/display/visibility; opacity/occlusion are not judged.', 'Common tool setup and inspection calls must be included in cost reporting.'] }));
} finally { try { await reset(); } finally { unlock(); } }
