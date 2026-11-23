// Model-free shared-interface calibration. Private reference repairs are sent
// only by this test client, never supplied to a measured agent.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireLock, freshBrowser, reset, prepareUIAction } from './fixture.mjs';
import { applyUIRevision } from './ui-revisions.mjs';
import { revisionCalibrationBindings } from './revision-calibration.mjs';
import { createMaintenanceState } from './maintenance.mjs';
import { runValidationSuite } from './cumulative-runner.mjs';
const unlock = acquireLock(), summaries = [], privateObservations = [];
const emit = event => {
  if (event.type === 'validation-case') privateObservations.push(event);
  process.stdout.write(JSON.stringify({ ...event, excludedFromStudy: true, languageModelUsed: false }) + '\n');
};
const state = createMaintenanceState({ emit });
try {
  for (const [revision, from] of [['v1', 'v0'], ['v2', 'v1']]) {
    const directory = mkdtempSync(join(tmpdir(), 'shared-maintenance-check-')), socketPath = join(directory, 'audit.sock');
    let browser, restore, server, child, lines, exited;
    const sockets = new Set();
    try {
      const before = state.begin(revision, from);
      if (revision === 'v2') assert.equal(before.sha256, summaries[0].frozenSHA);
      restore = applyUIRevision('auth-login', revision); await restore.ready(); await reset();
      browser = await freshBrowser({ observerVersion: revision, witnessLimits: { eventLimit: 40000, historyLimit: 120000 } });
      const deadline = Date.now() + 180000;
      server = createServer(socket => {
        sockets.add(socket); socket.on('close', () => sockets.delete(socket));
        createInterface({ input: socket }).on('line', async line => {
          const event = JSON.parse(line);
          if (event.type !== 'host-request') return;
          try {
            let result;
            if (event.method === 'prepare-ui-action') { await prepareUIAction(browser.context); result = { recorded: true }; }
            else if (event.method === 'maintenance-read') { const value = state.read(); result = { actions: value.actions, locators: value.selectors, limits: value.phase }; }
            else if (event.method === 'maintenance-repair') result = state.repair(event.arguments);
            else if (event.method === 'maintenance-validate') result = await runValidationSuite({ browser, state, emit, deadline });
            else if (event.method === 'proxy-complete') result = { recorded: true };
            else throw new Error('Unexpected private request: ' + event.method);
            socket.write(JSON.stringify({ id: event.id, result }) + '\n');
          } catch (error) { socket.write(JSON.stringify({ id: event.id, error: error.message }) + '\n'); }
        });
      });
      await new Promise((resolve, reject) => server.listen(socketPath, resolve).once('error', reject));
      child = spawn(process.execPath, [fileURLToPath(new URL('./mcp-browser.mjs', import.meta.url))], {
        env: { ...process.env, STUDY_ARM: 'runtime', STUDY_MAINTENANCE: '1', STUDY_CDP_ENDPOINT: browser.endpoint, STUDY_AUDIT_SOCKET: socketPath }, stdio: ['pipe', 'pipe', 'pipe'],
      });
      exited = once(child, 'close'); let stderr = '', id = 0; const pending = new Map();
      child.stderr.on('data', data => stderr += data);
      lines = createInterface({ input: child.stdout });
      lines.on('line', line => { const response = JSON.parse(line), p = pending.get(response.id); if (p) { pending.delete(response.id); clearTimeout(p.timer); p.resolve(response); } });
      child.on('close', () => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('Proxy closed: ' + stderr)); } pending.clear(); });
      const call = (method, params) => new Promise((resolve, reject) => {
        const key = ++id, timer = setTimeout(() => { pending.delete(key); reject(new Error('Shared tool call timed out')); }, 180000);
        pending.set(key, { resolve, reject, timer }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: key, method, params }) + '\n');
      });
      const tool = async (name, args = {}) => {
        const response = await call('tools/call', { name, arguments: args });
        assert.notEqual(response.result?.isError, true, JSON.stringify(response));
        return JSON.parse(response.result.content[0].text);
      };
      assert((await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'excluded-shared-maintenance', version: '1' } })).result);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
      const inventory = (await call('tools/list', {})).result.tools.map(t => t.name);
      assert(inventory.includes('baseline_validate')); assert(!inventory.includes('baseline_run'));
      const read = await tool('baseline_read'); assert.equal(read.actions, before.actions);
      const reference = revisionCalibrationBindings(revision);
      await tool('baseline_repair', { actions: reference.actions, locators: reference.selectors });
      const validated = await tool('baseline_validate');
      assert.equal(validated.complete, true); assert.equal(validated.cases.length, 12);
      assert(validated.cases.every(c => c.code === 0));
      const observations = privateObservations.filter(o => o.revision === revision && o.validation === validated.validation);
      assert.equal(observations.length, 12);
      assert(observations.every(o => o.observation.valid && o.observation.completionWitnessed && o.observation.checks.every(c => c.ok)));
      assert.equal(observations.reduce((n, o) => n + o.observation.checks.length, 0), 39);
      assert(!JSON.stringify(validated).includes('observerProtocol')); assert(!Object.hasOwn(validated, 'witness'));
      const snapshot = await call('tools/call', { name: 'browser_snapshot', arguments: {} });
      assert.notEqual(snapshot.result?.isError, true);
      assert(snapshot.result.content.some(c => c.type === 'text' && c.text.includes('Sign in')));
      const frozen = state.finish('excluded model-free interface calibration');
      const denied = await call('tools/call', { name: 'baseline_repair', arguments: { locators: read.locators } });
      assert.equal(denied.result.isError, true);
      child.stdin.end(); assert.equal((await exited)[0], 0, stderr);
      summaries.push({ revision, from, frozenSHA: frozen.implementation.sha256, cases: validated.cases.map(c => ({ caseId: c.caseId, code: c.code, actions: c.actions })),
        privateOracleAbsent: true, all39PrivatePredicatesWitnessed: true, snapshotAfterFullSuiteWorks: true, repairAfterFreezeRejected: true, totalActions: validated.cases.reduce((n, c) => n + c.actions, 0) });
    } finally {
      if (child && child.exitCode === null) { child.stdin.end(); const timer = setTimeout(() => child.kill('SIGKILL'), 3000); await exited; clearTimeout(timer); }
      lines?.close(); for (const socket of sockets) socket.destroy(); if (server) await new Promise(resolve => server.close(resolve));
      try { await browser?.close(); } finally { restore?.(); rmSync(directory, { recursive: true, force: true }); }
    }
  }
  assert(summaries.every(s => s.totalActions > 80), 'full suite must not inherit the old aggregate80action cap');
  emit({ type: 'shared-maintenance-proxy-calibration', ok: true, summaries, scope: 'Model-free capability/retention test, not measured agent repair.' });
} finally { try { await reset(); } finally { unlock(); } }
