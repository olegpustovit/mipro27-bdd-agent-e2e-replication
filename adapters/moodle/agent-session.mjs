// Browser-agent arm for Moodle: host Chromium (resolving the Behat origin to this worker), the study's restricted
// Playwright MCP proxy with the Moodle navigation policy, and the pinned Codex model. Used for smoke runs and by the runner.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { prepareBoundary, requestedModel } from '../../scripts/codex-boundary.mjs';
import { createBrowserBridge } from '../../scripts/mcp-http-bridge.mjs';
import { waitForOutput } from '../../scripts/subprocess.mjs';
import { buildMoodlePrompt } from './prompt.mjs';
import { decodeStepVerdict } from './verdict.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const freePort = async () => { const s = createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; };

// Host browser + restricted MCP proxy for one worker. endpoint is the MCP URL an agent (or a scripted driver) talks to.
export async function openAgentSession({ adapter, toolCalls = 40 }) {
  const port = await freePort();
  const browser = await chromium.launchServer({ headless: true, timeout: 20000, args: [...adapter.browserArgs(), `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', '--no-sandbox'] });
  const workspace = mkdtempSync(join(tmpdir(), 'moodle-agent-')), socketPath = join(workspace, 'audit.sock');
  const ledger = [], sockets = new Set();
  const server = createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
    createInterface({ input: socket }).on('line', line => {
      const event = JSON.parse(line);
      if (event.type !== 'host-request') { ledger.push(event); return; }
      // No app-specific observer for Moodle: acknowledge the proxy's boundary requests.
      if (event.method === 'report-infrastructure-failure') ledger.push({ type: 'fatal-infrastructure', error: event.arguments?.error });
      if (!socket.destroyed) socket.write(JSON.stringify({ id: event.id, result: { recorded: true } }) + '\n');
    });
  });
  await new Promise((resolve, reject) => server.listen(socketPath, resolve).once('error', reject));
  const bridge = await createBrowserBridge({ proxyPath: join(root, 'scripts/mcp-browser.mjs'), env: { ...process.env,
    STUDY_CDP_ENDPOINT: `http://127.0.0.1:${port}`, STUDY_ARM: 'runtime', STUDY_CASE_ID: 'moodle', STUDY_MAINTENANCE: '0', STUDY_AUDIT_SOCKET: socketPath, STUDY_TOOL_LIMIT: String(toolCalls),
    STUDY_POLICY_MODULE: join(root, 'adapters/moodle/browser-policy.mjs'), STUDY_ALLOWED_ORIGINS: adapter.allowedOrigins.join(';'), STUDY_APP_ORIGIN: adapter.baseUrl } });
  return { endpoint: bridge.endpoint, cdpEndpoint: `http://127.0.0.1:${port}`, ledger, async close() {
    const proxyExit = await bridge.close().catch(e => ({ error: e.message }));
    for (const sock of sockets) sock.destroy();
    await browser.close().catch(() => {}); server.close(); rmSync(workspace, { recursive: true, force: true });
    return proxyExit;
  } };
}

export async function runMoodleAgent({ adapter, handoff, timeoutMs = 300000, toolCalls = 40, label = 'smoke', emit = () => {} }) {
  const steps = handoff.uiSteps;
  const prompt = buildMoodlePrompt({ handoff, steps, toolCalls, timeoutMs });
  const session = await openAgentSession({ adapter, toolCalls }), ledger = session.ledger;
  const boundary = prepareBoundary({ endpoint: session.endpoint, prompt });
  const began = performance.now(); let child, timedOut = false, final = null, stderr = '';
  const kill = sig => { if (child?.pid) try { process.kill(-child.pid, sig); } catch {} };
  try {
    child = spawn(boundary.command, boundary.args, { cwd: boundary.directory, env: { PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => { try { const e = JSON.parse(line); emit(e);
      if (e.type === 'item.completed' && e.item?.type === 'agent_message') final = { ...(final || {}), result: e.item.text };
      if (e.type === 'turn.completed') final = { ...(final || {}), usage: e.usage }; } catch {} });
    child.stderr.on('data', d => { stderr += d; if (stderr.length > 1e6) kill('SIGKILL'); });
    const timer = setTimeout(() => { timedOut = true; kill('SIGTERM'); setTimeout(() => kill('SIGKILL'), 3000).unref(); }, timeoutMs);
    const { code, signal } = await waitForOutput(child, { lines, onExit: () => clearTimeout(timer), onDrainTimeout: () => kill('SIGKILL') }).finally(() => clearTimeout(timer));
    const proxyExit = await session.close();
    const calls = ledger.filter(e => e.type === 'tool-call');
    return { label, run: 'smoke-not-a-measured-trial', code, signal, timedOut, elapsedMs: Math.round(performance.now() - began), model: requestedModel,
      toolCalls: calls.length, tools: calls.map(c => `${c.name}${c.arguments?.url ? ' ' + c.arguments.url : ''}`),
      fatal: ledger.filter(e => e.type === 'fatal-infrastructure'), proxyExit,
      usage: final?.usage ?? null, ...decodeStepVerdict(final?.result, steps, { offset: handoff.uiStepIndexOffset }), stderrTail: stderr.slice(-500) };
  } finally { kill('SIGKILL'); boundary.cleanup(); await session.close().catch(() => {}); }
}
