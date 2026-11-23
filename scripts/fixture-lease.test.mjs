import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireLock, reset } from './fixture.mjs';
test('every fixture caller retains its lock after unacknowledged reset, even if it calls unlock in finally', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fixture-lease-test-')), path = join(directory, 'lock');
  const originalFetch = globalThis.fetch, unlock = acquireLock(path); let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('synthetic acknowledgement loss; no HTTP dispatched'); };
  try {
    await assert.rejects(reset(), error => error.code === 'STUDY_UNQUIESCENT');
    assert.throws(unlock, error => error.code === 'STUDY_UNQUIESCENT'); assert(existsSync(path));
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    // This is an isolated test lock; its synthetic reset sent no request.
    rmSync(directory, { recursive: true, force: true });
  }
});
