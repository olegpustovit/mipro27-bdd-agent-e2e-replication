import test from 'node:test';
import assert from 'node:assert/strict';
import { openSync, closeSync, existsSync, mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { claimAppStartup } from './app-ownership.mjs';

test('startup respects an active or intentionally retained fixture claim', () => {
  const dir = mkdtempSync(join(tmpdir(), 'app-ownership-'));
  const fixturePath = join(dir, 'fixture'), ownerPath = join(dir, 'owner');
  const fd = openSync(fixturePath, 'wx');
  try {
    assert.throws(() => claimAppStartup({ fixturePath, ownerPath }), { code: 'EEXIST' });
    assert(existsSync(fixturePath)); assert(!existsSync(ownerPath));
  } finally { closeSync(fd); rmSync(dir, { recursive: true, force: true }); }
});

test('app claim survives readiness and duplicate startup cannot claim the fixture', () => {
  const dir = mkdtempSync(join(tmpdir(), 'app-ownership-'));
  const paths = { fixturePath: join(dir, 'fixture'), ownerPath: join(dir, 'owner') };
  const claim = claimAppStartup(paths);
  try {
    assert(existsSync(paths.fixturePath)); assert(existsSync(paths.ownerPath));
    claim.ready();
    assert(!existsSync(paths.fixturePath)); assert(existsSync(paths.ownerPath));
    assert.throws(() => claimAppStartup(paths), { code: 'EEXIST' });
    assert(!existsSync(paths.fixturePath)); assert(existsSync(paths.ownerPath));
    const trialFD = openSync(paths.fixturePath, 'wx'); closeSync(trialFD); unlinkSync(paths.fixturePath);
    claim.closed(); claim.closed();
    assert(!existsSync(paths.fixturePath)); assert(!existsSync(paths.ownerPath));
    const next = claimAppStartup(paths); next.closed();
  } finally { claim.closed(); rmSync(dir, { recursive: true, force: true }); }
});
