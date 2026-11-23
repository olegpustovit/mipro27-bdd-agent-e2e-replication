import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { allowedTools, validateCall as defaultValidateCall } from './browser-policy.mjs';
import { connect } from 'node:net';
import { baselineTools, createBaselineTools } from './baseline-tools.mjs';
import { isCleanProxyExit, InfrastructureError } from './infrastructure.mjs';
import { reloadTool, reloadApplicationPage } from './browser-reload.mjs';
import { uiToolResult, uiToolError } from './ui-tool-result.mjs';
import { inspectTool, inspectionArguments, inspectionToolResult } from './browser-inspect.mjs';
import { maintenanceTools, createMaintenanceTools } from './maintenance.mjs';

// The model receives only this proxy's tool list. No study manifest, source or
// oracle is exposed as a resource. Browser restrictions also apply server-side.
const root = fileURLToPath(new URL('../', import.meta.url));
// App hook: another application supplies its own navigation policy and origins (default: the Cypress RWA fixture).
const validateCall = process.env.STUDY_POLICY_MODULE ? (await import(process.env.STUDY_POLICY_MODULE)).validateCall : defaultValidateCall;
const workspace = mkdtempSync(join(tmpdir(), 'cucumber-mcp-browser-'));
const auditSocket = process.env.STUDY_AUDIT_SOCKET ? connect(process.env.STUDY_AUDIT_SOCKET) : null;
auditSocket?.on('error', error => { console.error(`Study audit connection failed: ${error.message}`); child.kill(); });
const audit = value => auditSocket?.write(`${JSON.stringify(value)}\n`);
let hostSequence = 0;
const hostPending = new Map();
if (auditSocket) createInterface({ input: auditSocket }).on('line', line => {
  const response = JSON.parse(line);
  const pending = hostPending.get(response.id);
  if (!pending) return;
  hostPending.delete(response.id);
  clearTimeout(pending.timer);
  if (response.error) pending.reject(response.fatal ? new InfrastructureError('Shared host infrastructure failed') : new Error(response.error)); else pending.resolve(response.result);
});
const requestHost = (method, args) => new Promise((resolve, reject) => {
  if (!auditSocket) { reject(new Error('Independent observer connection is unavailable')); return; }
  const id = ++hostSequence;
  const timeout = method === 'maintenance-validate' ? 2700000 : 15000;
  const timer = setTimeout(() => { hostPending.delete(id); audit({ type: 'host-cancel', id }); reject(new InfrastructureError('Independent observer acknowledgement timed out')); }, timeout);
  hostPending.set(id, { resolve, reject, timer });
  audit({ type: 'host-request', id, method, arguments: args });
});
const sharedMaintenance = process.env.STUDY_MAINTENANCE === '1';
const retainedTools = sharedMaintenance ? maintenanceTools : baselineTools;
const baseline = sharedMaintenance ? createMaintenanceTools(requestHost) : process.env.STUDY_ARM === 'maintained' ? createBaselineTools({ caseId: process.env.STUDY_CASE_ID, endpoint: process.env.STUDY_CDP_ENDPOINT, initialActions: Number(process.env.STUDY_INITIAL_ACTIONS || 0), audit, requestHost }) : null;
const child = spawn(`${root}node_modules/.bin/playwright-mcp`, [
  ...(process.env.STUDY_CDP_ENDPOINT ? ['--cdp-endpoint', process.env.STUDY_CDP_ENDPOINT] : ['--headless', '--isolated', '--executable-path', chromium.executablePath(), '--no-sandbox']),
  '--no-webmcp', '--ignore-roots', '--codegen', 'none',
  '--image-responses', 'omit', '--viewport-size', '1280x720',
  '--allowed-origins', process.env.STUDY_ALLOWED_ORIGINS || 'http://localhost:3000;http://localhost:3001',
  '--timeout-action', '5000', '--timeout-navigation', '15000',
], { cwd: workspace, stdio: ['pipe', 'pipe', 'inherit'] });
const requests = new Map();
let upstreamClosed = false;
let terminalError;
const reportFatal = async error => {
  if (terminalError) return;
  terminalError = error;
  process.exitCode = 1;
  if (auditSocket) {
    try { await requestHost('report-infrastructure-failure', { error: error.message }); }
    catch (reportError) { console.error(`Fatal infrastructure reporting failed: ${reportError.message}`); }
  }
};
const send = value => process.stdout.write(`${JSON.stringify(value)}\n`);
const input = createInterface({ input: process.stdin });
const output = createInterface({ input: child.stdout });
let calls = 0;
const callLimit = Number(process.env.STUDY_TOOL_LIMIT || 80);
let queue = Promise.resolve();
input.on('line', line => { queue = queue.then(async () => {
  try {
    const message = JSON.parse(line);
    const requestedTool = message.method === 'tools/call' ? message.params?.name : undefined;
    if (upstreamClosed || terminalError) {
      if (message.id !== undefined) send({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'Study browser proxy is terminated' } });
      return;
    }
    if (message.method === 'resources/read') {
      send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Resources are not exposed to the testing agent' } });
      return;
    }
    if (message.method === 'tools/call') {
      const name = message.params?.name, args = message.params?.arguments;
      const isBaseline = baseline && retainedTools.some(tool => tool.name === name);
      const error = isBaseline ? null : validateCall(name, args);
      calls++;
      audit({ type: 'tool-call', count: calls, name, arguments: args });
      if (name === 'browser_inspect' && !sharedMaintenance) {
        send({ jsonrpc: '2.0', id: message.id, result: { isError: true, content: [{ type: 'text', text: 'Unknown tool: browser_inspect' }] } });
        return;
      }
      if (error || calls > callLimit) {
        send({ jsonrpc: '2.0', id: message.id, result: { isError: true, content: [{ type: 'text', text: error || `Action cap reached (${callLimit} tool calls).` }] } });
        return;
      }
      if (isBaseline) {
        try { send({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: JSON.stringify(await baseline(name, args)) }] } }); }
        catch (error) {
          if (error.code === 'STUDY_INFRASTRUCTURE') { await reportFatal(error); child.kill(); return; }
          audit({ type: 'baseline-tool-error', name, error: error.message }); send({ jsonrpc: '2.0', id: message.id, result: { isError: true, content: [{ type: 'text', text: error.message }] } });
        }
        return;
      }
      if (!['browser_snapshot', 'browser_wait_for', 'browser_inspect'].includes(name)) {
        try { await requestHost('prepare-ui-action', {}); }
        catch (error) { await reportFatal(error); child.kill(); return; }
      }
      if (name === 'browser_reload') {
        try { await reloadApplicationPage(process.env.STUDY_CDP_ENDPOINT); }
        catch (error) {
          if (error.code === 'STUDY_INFRASTRUCTURE') { await reportFatal(error); child.kill(); return; }
          const result = { isError: true, content: [{ type: 'text', text: error.message }] };
          audit({ type: 'tool-result', id: message.id, result });
          send({ jsonrpc: '2.0', id: message.id, result }); return;
        }
        // Reuse the native MCP snapshot rather than introducing a second
        // execution-facing observation implementation.
        message.params = { name: 'browser_snapshot', arguments: {} };
        line = JSON.stringify(message);
      }
      if (name === 'browser_inspect') {
        message.params = { name: 'browser_evaluate', arguments: inspectionArguments(args.target) };
        line = JSON.stringify(message);
      }
    }
    let completion;
    if (message.method && message.id !== undefined) {
      const pending = { method: message.method, toolName: requestedTool };
      if (message.method === 'tools/call') completion = new Promise((resolve, reject) => Object.assign(pending, { resolve, reject }));
      requests.set(JSON.stringify(message.id), pending);
    }
    child.stdin.write(`${line}\n`);
    // Serializing stdin writes is insufficient: a browser action can still be
    // running when a local baseline_run clears its browser and resets the app.
    // Hold the queue until the upstream tool's response (including errors).
    if (completion) await completion;
  } catch (error) { console.error(`MCP proxy input error: ${error.message}`); process.exitCode = 1; child.kill(); }
}); });
output.on('line', line => {
  try {
    const message = JSON.parse(line);
    const key = JSON.stringify(message.id);
    const pending = requests.get(key);
    const method = pending?.method;
    if (message.id !== undefined && !message.method) requests.delete(key);
    if (method === 'tools/list' && message.result?.tools) message.result.tools = [...message.result.tools.filter(tool => allowedTools.has(tool.name)), reloadTool, ...(sharedMaintenance ? [inspectTool] : []), ...(baseline ? retainedTools : [])];
    if (method === 'resources/list') message.result = { resources: [] };
    if (method === 'resources/templates/list') message.result = { resourceTemplates: [] };
    if (method === 'tools/call') {
      const rawResult = message.result, rawError = message.error;
      message.result = pending?.toolName === 'browser_inspect' ? inspectionToolResult(rawResult) : uiToolResult(rawResult);
      message.error = uiToolError(rawError);
      audit({ type: 'tool-result', id: message.id, rawResult, rawError, result: message.result, error: message.error });
    }
    send(message);
    if (message.id !== undefined && !message.method) pending?.resolve?.();
  } catch (error) { console.error(`MCP proxy output error: ${error.message}`); process.exitCode = 1; child.kill(); }
});
input.on('close', () => { queue.finally(() => child.stdin.end()); });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('close', async (code, signal) => {
  const unexpected = !isCleanProxyExit({ code, signal, inputClosed: Boolean(input.closed), pendingRequests: requests.size });
  upstreamClosed = true;
  for (const pending of requests.values()) pending.reject?.(new Error('Browser tool process closed before replying'));
  requests.clear();
  for (const pending of hostPending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Browser tool process closed')); }
  hostPending.clear();
  if (unexpected) await reportFatal(new Error(`Browser tool process closed unexpectedly: code=${code}, signal=${signal}`));
  if (auditSocket && !terminalError) {
    try { await requestHost('proxy-complete', { calls, fatal: false }); }
    catch (error) { console.error(`Private terminal acknowledgement failed: ${error.message}`); process.exitCode = 1; }
  }
  process.exitCode = code || process.exitCode || 0;
  input.close(); auditSocket?.end(); rmSync(workspace, { recursive: true, force: true });
});
// A normal client shutdown can signal the proxy. Finish its queue and close
// upstream stdin cleanly; a signalled upstream exit itself is always fatal.
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => input.close());
