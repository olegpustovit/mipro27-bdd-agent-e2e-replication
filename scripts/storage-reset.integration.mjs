import assert from 'node:assert/strict';
import { acquireLock, freshBrowser, clearBrowser, reset } from './fixture.mjs';
import { bounded } from './deadlines.mjs';
const unlock = acquireLock(); let browser;
try {
  await reset(); browser = await freshBrowser(); const pid = browser.processId;
  for (const origin of ['http://localhost:3000', 'http://localhost:3001']) {
    const page = await browser.context.newPage(); await page.goto(origin + (origin.endsWith('3000') ? '/signin' : '/'));
    await page.evaluate(async () => {
      localStorage.setItem('study-reset', 'present'); sessionStorage.setItem('study-reset', 'present'); document.cookie = 'study-reset=present; path=/';
      const cache = await caches.open('study-reset'); await cache.put('/study-reset-generated', new Response('present'));
      await new Promise((resolve, reject) => { const request = indexedDB.open('study-reset', 1); request.onupgradeneeded = () => request.result.createObjectStore('items'); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result, tx = db.transaction('items', 'readwrite'); tx.objectStore('items').put('present', 'key'); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error); }; });
    });
  }
  await bounded('all-origin storage reset', () => clearBrowser(browser.context, { clearCache: true }), { deadline: Date.now() + 15000, terminate: () => browser.terminate() });
  for (const origin of ['http://localhost:3000', 'http://localhost:3001']) {
    const page = await browser.context.newPage(); await page.goto(origin + (origin.endsWith('3000') ? '/signin' : '/'));
    const result = await page.evaluate(async () => ({ local: localStorage.getItem('study-reset'), session: sessionStorage.getItem('study-reset'), cookie: document.cookie.includes('study-reset'), caches: (await caches.keys()).includes('study-reset'), idb: (await indexedDB.databases()).some(d => d.name === 'study-reset') }));
    assert.deepEqual(result, { local: null, session: null, cookie: false, caches: false, idb: false }); await page.close();
  }
  const controller = new AbortController(); let other;
  other = await freshBrowser({ signal: controller.signal }); const cancelledPid = other.processId; controller.abort();
  await bounded('cancelled browser settlement', () => other.close(), { deadline: Date.now() + 5000, terminate: () => other.terminate() });
  assert.throws(() => process.kill(cancelledPid, 0), /ESRCH/);
  await browser.close(); browser = null; assert.throws(() => process.kill(pid, 0), /ESRCH/);
  console.log(JSON.stringify({ type: 'storage-reset-calibration', ok: true, origins: 2, cookiesLocalSessionIDBCacheCleared: true, browserServerTerminationVerified: true, excludedFromStudy: true, limitations: 'ServiceWorker stopAllWorkers command exercised; registered-worker reuse not separately seeded.' }));
} finally { try { await browser?.close(); await reset(); } finally { unlock(); } }
