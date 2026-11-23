// Model-free technical calibration. Requires the pinned local app running.
// Evidence goes to stdout only; it is excluded from measured study outcomes.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { createInterface } from 'node:readline';
import { once, EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireLock, reset, freshBrowser, clearBrowser, prepareUIAction } from './fixture.mjs';
import { beginAttempt, snapshotWitness } from './witness.mjs';
import { oracle } from './oracle.mjs';
import { runBaseline } from './baseline.mjs';

const unlock = acquireLock();
const directory = mkdtempSync(join(tmpdir(), 'attempt-observer-calibration-'));
const socketPath = join(directory, 'observer.sock');
const observations = [];
const auditEvents = [];
const auditSignal = new EventEmitter();
let browser, child, input, server, exited;
try {
  await reset();
  browser = await freshBrowser();
  const observe = async () => {
    const witness = snapshotWitness(browser.witness);
    return { ...await oracle('profile-email', browser.context, witness), attemptId: witness.attemptId, phase: witness.phase, witness };
  };
  const initial = await runBaseline({ caseId: 'profile-email', endpoint: browser.endpoint });
  const initialObservation = await observe();
  assert.equal(initial.code, 0);
  assert.equal(initialObservation.valid, true);
  await clearBrowser(browser.context);
  beginAttempt(browser.witness, 'diagnosis');
  server = createServer(socket => {
    createInterface({ input: socket }).on('line', async line => {
      const event = JSON.parse(line);
      auditEvents.push(event);
      auditSignal.emit('event', event);
      if (event.type !== 'host-request') return;
      try {
        let result;
        if (event.method === 'begin-retained-attempt') result = { attemptId: beginAttempt(browser.witness, `retained-rerun-${event.arguments.attempt}`) };
        else if (event.method === 'prepare-ui-action') { await prepareUIAction(browser.context); result = { recorded: true }; }
        else if (event.method === 'observe-retained-attempt') result = await observe();
        else if (event.method === 'record-retained-result') { observations.push(event.arguments); result = { recorded: true }; }
        else if (event.method === 'report-infrastructure-failure') result = { recorded: true };
        else throw new Error('Unknown observer request');
        socket.write(`${JSON.stringify({ type: 'host-response', id: event.id, result })}\n`);
      } catch (error) { socket.write(`${JSON.stringify({ type: 'host-response', id: event.id, error: error.message })}\n`); }
    });
  });
  await new Promise((resolve, reject) => server.listen(socketPath, resolve).once('error', reject));
  child = spawn(process.execPath, [process.env.STUDY_CALIBRATION_PROXY_PATH || fileURLToPath(new URL('./mcp-browser.mjs', import.meta.url))], {
    env: { ...process.env, STUDY_ARM: 'maintained', STUDY_CASE_ID: 'profile-email', STUDY_CDP_ENDPOINT: browser.endpoint, STUDY_AUDIT_SOCKET: socketPath },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  exited = once(child, 'close');
  input = createInterface({ input: child.stdout });
  const requests = new Map();
  child.on('close', () => { for (const pending of requests.values()) { clearTimeout(pending.timer); pending.reject(new Error('Calibration proxy closed')); } requests.clear(); });
  let id = 0;
  input.on('line', line => {
    const response = JSON.parse(line), pending = requests.get(response.id);
    if (pending) { requests.delete(response.id); clearTimeout(pending.timer); pending.resolve(response); }
  });
  const call = (method, params) => new Promise((resolve, reject) => {
    const key = ++id;
    const timer = setTimeout(() => { requests.delete(key); reject(new Error(`Calibration request timed out: ${method}`)); }, 90000);
    requests.set(key, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: key, method, params })}\n`);
  });
  const tool = async (name, args = {}) => {
    const response = await call('tools/call', { name, arguments: args });
    assert.equal(response.result?.isError, undefined, JSON.stringify(response));
    return JSON.parse(response.result.content[0].text);
  };
  assert((await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'excluded-attempt-calibration', version: '1' } })).result);
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const original = await tool('baseline_read');
  const navigation = await call('tools/call', { name: 'browser_navigate', arguments: { url: 'http://localhost:3000/signin' } });
  assert.notEqual(navigation.result?.isError, true, JSON.stringify(navigation));
  const nativeNavigation = auditEvents.find(e => e.type === 'tool-result' && e.id === navigation.id);
  assert(nativeNavigation?.rawResult, 'raw native observation must remain private and retained');
  assert(!navigation.result.content.some(block => block.type === 'text' && /^- (?:Console:|HTTP status:|New console entries:)/m.test(block.text)), 'UI-only actor response exposed native diagnostics');
  const applicationPage = browser.context.pages().find(p => p.url() === 'http://localhost:3000/signin');
  const documentBefore = await applicationPage.evaluate(() => performance.timeOrigin);
  const reload = await call('tools/call', { name: 'browser_reload', arguments: {} });
  assert.notEqual(reload.result?.isError, true, JSON.stringify(reload));
  const documentAfter = await applicationPage.evaluate(() => ({ origin: performance.timeOrigin, type: performance.getEntriesByType('navigation')[0]?.type }));
  assert.notEqual(documentAfter.origin, documentBefore);
  assert.equal(documentAfter.type, 'reload');
  assert(browser.witness.events.some(e => e.kind === 'navigation' && e.navigationType === 'reload' && e.documentId));
  // Submit a real pending browser operation and a retained rerun together.
  // The rerun must not even dispatch its fixture/browser reset until the
  // upstream browser operation has replied, not merely received its stdin.
  const waiting = call('tools/call', { name: 'browser_wait_for', arguments: { time: 1 } });
  const rerun = tool('baseline_run');
  const [waitResponse, healthy] = await Promise.all([waiting, rerun]);
  const browserFinished = auditEvents.findIndex(e => e.type === 'tool-result' && e.id === waitResponse.id);
  const retainedDispatched = auditEvents.findIndex(e => e.type === 'tool-call' && e.name === 'baseline_run');
  assert(browserFinished >= 0 && retainedDispatched > browserFinished, 'retained reset overlapped an upstream browser tool call');
  assert.notEqual(waitResponse.result?.isError, true, JSON.stringify(waitResponse));
  assert.equal(healthy.code, 0);
  assert.equal(observations.length, 1);
  assert.equal(observations[0].oracle.valid, true);
  assert.equal(observations[0].oracle.attemptId, 2);
  assert.equal(Object.hasOwn(healthy, 'oracle'), false);
  assert.equal(Object.hasOwn(healthy, 'witness'), false);
  await tool('baseline_repair', { locators: { ...original.locators, signIn: 'role=button[name="No such sign-in control"]' } });
  const failed = await tool('baseline_run');
  assert.notEqual(failed.code, 0);
  assert.equal(observations.length, 2);
  const final = observations[1].oracle;
  assert.equal(final.attemptId, 3);
  assert.equal(final.triggerWitnessed, false);
  assert.equal(final.valid, false);
  assert.equal(final.witness.signedIn, false);
  assert.equal(final.witness.events.some(e => e.name === 'email' && e.value === 'invalid-email'), false);
  assert.equal(initialObservation.valid, true);
  assert.equal(observations[0].oracle.valid, true);
  assert(browser.witness.history.some(e => e.attemptId === 0 && e.name === 'email'));
  assert(browser.witness.history.some(e => e.attemptId === 2 && e.name === 'email'));
  // A browser-process failure must also prevent already queued local reruns.
  const upstreamPids = execFileSync('ps', ['-o', 'pid=', '--ppid', String(child.pid)], { encoding: 'utf8' }).trim().split(/\s+/).map(Number);
  assert.equal(upstreamPids.length, 1, 'expected one owned upstream browser-tool process');
  const retainedCallsBeforeCrash = auditEvents.filter(e => e.type === 'tool-call' && e.name === 'baseline_run').length;
  const browserCallStarted = new Promise(resolve => {
    const listener = event => { if (event.type === 'tool-call' && event.name === 'browser_wait_for' && event.arguments.time === 10) { auditSignal.off('event', listener); resolve(); } };
    auditSignal.on('event', listener);
  });
  const pendingWait = call('tools/call', { name: 'browser_wait_for', arguments: { time: 10 } });
  const queuedRerun = call('tools/call', { name: 'baseline_run', arguments: {} });
  const settledAfterCrash = Promise.allSettled([pendingWait, queuedRerun]);
  await browserCallStarted;
  process.kill(upstreamPids[0], 'SIGKILL');
  const [exitCode] = await exited;
  await settledAfterCrash;
  assert.equal(exitCode, 1);
  assert.equal(auditEvents.filter(e => e.type === 'tool-call' && e.name === 'baseline_run').length, retainedCallsBeforeCrash);
  assert.equal(auditEvents.filter(e => e.type === 'host-request' && e.method === 'report-infrastructure-failure').length, 1);
  assert.equal(observations.length, 2);
  console.log(JSON.stringify({ type: 'attempt-observer-calibration', excludedFromStudy: true, ok: true,
    initialAttempt: { id: initialObservation.attemptId, valid: initialObservation.valid },
    repairedAttempts: observations.map(r => ({ attempt: r.attempt, id: r.oracle.attemptId, exit: r.code, valid: r.oracle.valid, triggerWitnessed: r.oracle.triggerWitnessed })),
    earlierEventsRetainedInAudit: true, staleEventsExcludedFromFinalScore: true, privateObserverAbsentFromToolResponse: true,
    browserResponseBeforeRetainedDispatch: true,
    genericMCPReloadCommitsActualReloadDocument: true,
    unexpectedBrowserExitIsFatal: true, queuedRerunNotDispatchedAfterBrowserExit: true,
  }));
} finally {
  if (child && child.exitCode === null) { child.stdin.end(); const timer = setTimeout(() => child.kill('SIGKILL'), 3000); await exited; clearTimeout(timer); }
  input?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await browser?.close();
  try { await reset(); } finally { unlock(); rmSync(directory, { recursive: true, force: true }); }
}
