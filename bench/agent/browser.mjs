import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import mcp from '@playwright/mcp';
import { allowedTools, validateCall } from '../../scripts/browser-policy.mjs';
import { reloadTool } from '../../scripts/browser-reload.mjs';
import { openBrowserEgress, isPrivatePath } from './browser-egress.mjs';
import { uiToolError, uiToolResult } from '../../scripts/ui-tool-result.mjs';

const toolError = text => ({ isError: true, content: [{ type: 'text', text }] });

export async function openBrowser({ url, app, attemptTool, observeTool }) {
  const origin = new URL(url).origin;
  const remote = process.env.BENCH_BROWSER_WS;
  const scratch = await mkdtemp(join(tmpdir(), 'p3c-browser-'));
  const removeScratch = () => rm(scratch, { recursive: true, force: true });
  let egress;
  let browser;
  let server;
  try {
    egress = remote ? null : await openBrowserEgress(origin);
    browser = remote ? await chromium.connect(remote, { timeout: 15000 }) :
      await chromium.launch({ timeout: 15000, proxy: egress.config, args: ['--disable-quic'] });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 }, acceptDownloads: false, serviceWorkers: 'block',
    });
    function canNavigate(value) {
      let target;
      try { target = new URL(value); } catch { return false; }
      if (target.origin !== origin || target.username || target.password || isPrivatePath(target)) return false;
      return app !== 'pay' || !validateCall('browser_navigate', {
        url: 'http://localhost:3000' + target.pathname + target.search,
      });
    }
    await context.route(/./, route => {
      const request = route.request();
      const target = new URL(request.url());
      if (target.origin !== origin || isPrivatePath(target) ||
          (request.isNavigationRequest() && !canNavigate(target))) return route.abort();
      return route.continue();
    });
    await context.routeWebSocket(/./, ws => {
      if (new URL(ws.url().replace(/^ws/, 'http')).origin === origin) ws.connectToServer();
      else return ws.close();
    });

    const connection = await mcp.createConnection({
      webmcp: false, codegen: 'none', imageResponses: 'omit', snapshot: { mode: 'none' },
      outputDir: scratch, saveSession: false,
      network: { allowedOrigins: [origin] }, timeouts: { action: 5000, navigation: 15000 },
    }, async () => context);
    // The native server supplies schemas and runs tools. This transport projects
    // UI calls before dispatch and UI observations before returning them to Codex.
    const pending = new Map();
    let id = 0;
    const transport = {
      async start() {},
      async close() {
        for (const resolve of pending.values()) resolve({ error: { code: -32000 } });
        pending.clear();
      },
      async send(message) {
        const resolve = pending.get(message.id);
        pending.delete(message.id);
        resolve?.(message);
      },
    };
    await connection.connect(transport);
    function dispatch(message) {
      if (message.id === undefined) {
        transport.onmessage(message);
        return;
      }
      const requestId = ++id;
      return new Promise(resolve => {
        pending.set(requestId, resolve);
        transport.onmessage({ ...message, id: requestId });
      });
    }
    let queue = Promise.resolve();
    async function handle(message) {
      const { method, params } = message;
      if (method === 'tools/list') {
        const reply = await dispatch(message);
        if (reply.error) return { error: uiToolError(reply.error) };
        const tools = reply.result.tools.filter(tool => allowedTools.has(tool.name) && tool.name !== 'browser_inspect');
        if (!tools.some(tool => tool.name === reloadTool.name)) tools.push(reloadTool);
        return { result: { tools } };
      }
      if (method === 'tools/call') {
        const { name, arguments: args = {} } = params ?? {};
        if (!attemptTool(name, args)) return { result: toolError('Run budget exhausted.') };
        const call = queue.then(async () => {
          const denied = name === 'browser_inspect' ||
            validateCall(name, name === 'browser_navigate' ? { ...args, url: 'http://localhost:3000/' } : args) ||
            (name === 'browser_navigate' && !canNavigate(args.url));
          if (denied) return { result: toolError('Only application UI actions are permitted.') };
          let request = message;
          if (name === 'browser_reload') {
            const pages = context.pages().filter(page => canNavigate(page.url()));
            if (pages.length !== 1) return { result: toolError('Reload requires one application page.') };
            await pages[0].reload({ timeout: 15000 });
            await pages[0].waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
            request = { ...message, params: { name: 'browser_snapshot', arguments: {} } };
          }
          const reply = await dispatch(request);
          return reply.error ? { error: uiToolError(reply.error) } : { result: uiToolResult(reply.result) };
        }).catch(() => ({ result: toolError('Browser UI action failed.') }));
        queue = call.then(() => {});
        const reply = await call;
        observeTool(name, args, reply);
        return reply;
      }
      if (['initialize', 'notifications/initialized', 'ping'].includes(method)) {
        const reply = await dispatch(message);
        return reply && (reply.error ? { error: uiToolError(reply.error) } : { result: reply.result });
      }
      if (method === 'resources/list') return { result: { resources: [] } };
      if (method === 'resources/templates/list') return { result: { resourceTemplates: [] } };
      if (method === 'prompts/list') return { result: { prompts: [] } };
      return { error: { code: -32601, message: 'Method unavailable' } };
    }
    const path = '/' + randomUUID();
    server = createServer(async (req, res) => {
      if (req.url !== path) return res.writeHead(404).end();
      if (req.method === 'DELETE') return res.writeHead(200).end();
      if (req.method !== 'POST') return res.writeHead(405).end();
      try {
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 1024 * 1024) return res.writeHead(413).end();
        }
        const message = JSON.parse(body);
        if (message.jsonrpc !== '2.0' || (message.method === 'tools/call' && message.id === undefined)) {
          return res.writeHead(400).end();
        }
        const reply = await handle(message);
        if (message.id === undefined) return res.writeHead(202).end();
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, ...reply }));
      } catch {
        res.writeHead(400).end();
      }
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    return {
      endpoint: `http://127.0.0.1:${server.address().port}${path}`,
      async close() {
        server.closeAllConnections();
        try {
          await Promise.all([new Promise(resolve => server.close(resolve)), connection.close(), browser.close()]);
        } finally {
          await Promise.all([egress?.close(), removeScratch()]);
        }
      },
    };
  } catch (error) {
    server?.close();
    await Promise.allSettled([browser?.close(), egress?.close(), removeScratch()]);
    throw error;
  }
}
