import { chromium } from 'playwright';
import { createServer } from 'node:net';
import { readFileSync, writeFileSync, openSync, closeSync, unlinkSync, mkdirSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname } from 'node:path';
import { ledgerPaths } from './ledger/paths.mjs';
import { pidAlive, pidStart } from './ledger/process.mjs';
import { appRoot } from './mutations.mjs';
import { createWitness, recordWitness, observationLedgerError } from './witness.mjs';
import { installUIObserver, observerMappings } from './ui-observer.mjs';
import { InfrastructureError } from './infrastructure.mjs';
import { UnsettledWorkError } from './deadlines.mjs';
export const database = () => JSON.parse(readFileSync(`${appRoot}data/database.json`, 'utf8'));
export const seed = () => JSON.parse(readFileSync(`${appRoot}data/database-seed.json`, 'utf8'));
let resetAcknowledged = false, unsafe = null;
const liveBrowsers = new Set();
export async function reset({ signal } = {}) {
  // The pinned route synchronously writes seed data before its 200 response.
  // Without that acknowledgement a dispatched request may still mutate state.
  try {
  signal?.throwIfAborted(); resetAcknowledged = false;
  const response = await fetch('http://127.0.0.1:3001/testData/seed', { method: 'POST', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Reset failed: HTTP ${response.status}`);
  if (JSON.stringify(database()) !== JSON.stringify(seed())) throw new Error('Reset did not reproduce the exact frozen synthetic seed');
  // The seed route reformats JSON. Preserve the upstream fixture's original
  // bytes without changing its data or lowdb's in-memory state.
  writeFileSync(`${appRoot}data/database.json`, readFileSync(`${appRoot}data/database-seed.json`));
  resetAcknowledged = true;
  } catch (error) { unsafe = 'Seed restoration was not acknowledged and verified: ' + error.message; throw new UnsettledWorkError(unsafe); }
}
async function freePort() { const s = createServer(); await new Promise((resolve, reject) => s.listen(0, '127.0.0.1', resolve).once('error', reject)); const port = s.address().port; await new Promise(resolve => s.close(resolve)); return port; }
export async function freshBrowser({ observerVersion = 'v0', observeUI = true, witnessLimits, signal, deadline = Date.now() + 20000 } = {}) {
  const observerMapping = observerMappings[observerVersion];
  if (!observerMapping) throw new Error('Unknown private observer version: ' + observerVersion);
  const port = await freePort();
  signal?.throwIfAborted();
  const server = await chromium.launchServer({ headless: true, timeout: Math.max(1, Math.min(10000, deadline - Date.now())), args: [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', '--no-sandbox'] });
  liveBrowsers.add(server);
  const terminate = async () => { try { await server.kill(); liveBrowsers.delete(server); } catch (error) { unsafe = 'Owned browser termination is uncertain'; throw error; } };
  const abort = () => { terminate().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
  const endpoint = `http://127.0.0.1:${port}`;
  let observer, owner;
  try {
  owner = await chromium.connect(server.wsEndpoint(), { timeout: Math.max(1, Math.min(10000, deadline - Date.now())) });
  observer = await chromium.connectOverCDP(endpoint, { timeout: Math.max(1, Math.min(10000, deadline - Date.now())) });
  const context = observer.contexts()[0];
  const witness = createWitness(witnessLimits);
  witness.observerVersion = observerVersion;
  witness.captureProtocol = 'ui-projection-v4';
  witness.observerEnabled = observeUI;
  const pageAttempts = new WeakMap();
  const registerPage = page => {
    if (pageAttempts.has(page)) return;
    const attemptId = witness.attemptId;
    pageAttempts.set(page, attemptId);
    page.on('load', () => recordWitness(witness, attemptId, { kind: 'load', path: new URL(page.url()).pathname }));
  };
  // Read-only observer of UI inputs and clicks. Passwords are excluded. It is
  // not a tool and supplies no hints or expected results to either testing arm.
  await context.exposeBinding('__studyUIWitness', (source, event) => {
    registerPage(source.page);
    recordWitness(witness, pageAttempts.get(source.page), event);
  });
  context.on('page', registerPage);
  context.pages().forEach(registerPage);
  await context.addInitScript(installUIObserver, { mapping: observerMapping, observerVersion, expectedPassword: 's3cret', sampleUI: observeUI });
  context.on('response', response => {
    const url = new URL(response.url());
    if (url.pathname === '/login' && response.request().method() === 'POST' && response.status() === 200) {
      const page = response.frame().page();
      registerPage(page);
      recordWitness(witness, pageAttempts.get(page), { kind: 'authenticated' });
    }
  });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (!['http://localhost:3000', 'http://localhost:3001'].includes(url.origin) && url.protocol !== 'data:') return route.abort();
    return route.continue();
  });
  return { endpoint, context, witness, observer, owner, browserVersion: owner.version(), processId: server.process().pid, terminate,
    get quiescenceFailed() { return Boolean(unsafe); },
    set quiescenceFailed(value) { if (value) unsafe = unsafe || 'Host work settlement is uncertain'; },
    async close() { try { await terminate(); } finally { signal?.removeEventListener('abort', abort); } } };
  } catch (error) {
    try { await terminate(); } finally { signal?.removeEventListener('abort', abort); }
    throw error;
  }
}
export async function clearBrowser(context, { clearCache = false } = {}) {
  for (const p of context.pages()) await p.close();
  await context.clearCookies();
  const page = await context.newPage();
  if (clearCache) {
    const session = await context.newCDPSession(page);
    try {
      await session.send('ServiceWorker.enable'); await session.send('ServiceWorker.stopAllWorkers');
      await session.send('Network.clearBrowserCache');
      for (const origin of ['http://localhost:3000', 'http://localhost:3001']) {
        await session.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' });
        const quota = await session.send('Storage.getUsageAndQuota', { origin });
        if (quota.usage !== 0) throw new InfrastructureError('Persistent browser storage remains after reset for ' + origin);
      }
    } finally { await session.detach(); }
  } else {
    await page.goto('http://localhost:3000/signin');
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  }
  await page.close();
}
export const defaultFixtureLock = () => `${ledgerPaths().locks}/cucumber-mcp-study-exclusive.lock`;
// The lock records its owner. A lock left by a dead owner on this host is taken over only when the caller says it is
// resuming a ledger-tracked run (takeoverDeadOwner); the run then re-verifies the seed and source pins before any trial.
export function acquireLock(path = defaultFixtureLock(), { takeoverDeadOwner = false } = {}) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  let fd;
  try { fd = openSync(path, 'wx'); }
  catch (error) {
    if (error.code !== 'EEXIST' || !takeoverDeadOwner) throw error;
    let owner; try { owner = JSON.parse(readFileSync(path, 'utf8')); } catch { throw error; }
    if (owner.host !== hostname() || pidAlive(owner.pid, owner.pidStart)) throw error;
    unlinkSync(path); fd = openSync(path, 'wx');
  }
  writeFileSync(fd, JSON.stringify({ pid: process.pid, pidStart: pidStart(process.pid), host: hostname(), at: new Date().toISOString() }));
  return () => {
    // All entrypoints share this guard, including excluded technical scripts.
    // Once uncertainty is latched, a later client reset cannot silently clear it.
    if (unsafe || !resetAcknowledged || liveBrowsers.size) throw new UnsettledWorkError('Fixture lock retained: ' + (unsafe || 'reset/browser quiescence not established'));
    closeSync(fd); unlinkSync(path);
  };
}

// Force the final read-only sample and wait for its private event delivery.
export async function flushUIObservation(context, witness) {
  const pages = context.pages().filter(page => page.url().startsWith('http://localhost:3000/'));
  if (!pages.length) return null;
  if (pages.length !== 1) throw new InfrastructureError('Private observer requires exactly one application page');
  const result = await capturePage(pages[0]);
  if (witness) {
    witness.finalObservation = { documentId: result.state.documentId, throughSequence: result.throughSequence,
      metrics: result.metrics, observedAt: Date.now() };
    const error = observationLedgerError(witness, result);
    if (error) throw new InfrastructureError(error);
  }
  return result;
}
export async function prepareUIAction(context) {
  const pages = context.pages().filter(page => page.url().startsWith('http://localhost:3000/'));
  if (pages.length > 1) throw new InfrastructureError('Private action boundary requires one application page');
  return pages.length ? capturePage(pages[0], true) : null;
}
async function capturePage(page, markBarrier = false) {
  let timer;
  const result = await Promise.race([page.evaluate(async markBarrier => {
    if (typeof window.__studyCaptureUI !== 'function') return null;
    return window.__studyCaptureUI({ markBarrier });
  }, markBarrier), new Promise((_, reject) => { timer = setTimeout(() => reject(new InfrastructureError('Private page capture exceeded 3000ms')), 3000); })]).finally(() => clearTimeout(timer));
  if (!result || result.metrics.failure || result.metrics.failedEmits) throw new InfrastructureError('Private UI observation failed: ' + (result?.metrics.failure || 'missing observer or event delivery'));
  return result;
}
