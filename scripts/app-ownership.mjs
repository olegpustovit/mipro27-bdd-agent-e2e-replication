import { openSync, closeSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ledgerPaths } from './ledger/paths.mjs';

// Locks live in the study data dir (never /tmp, which is cleared).
export const fixtureLockPath = `${ledgerPaths().locks}/cucumber-mcp-study-exclusive.lock`;
export const appLockPath = `${ledgerPaths().locks}/cucumber-mcp-study-app.lock`;

// Startup participates in the same exclusive boundary as scenario execution.
// A separate lifetime claim prevents a second wrapper from reinitializing an
// already running app. Abrupt process death intentionally leaves both claims.
export function claimAppStartup({ fixturePath = fixtureLockPath, ownerPath = appLockPath } = {}) {
  mkdirSync(dirname(fixturePath), { recursive: true, mode: 0o700 }); mkdirSync(dirname(ownerPath), { recursive: true, mode: 0o700 });
  const fixtureFD = openSync(fixturePath, 'wx');
  let ownerFD;
  try { ownerFD = openSync(ownerPath, 'wx'); }
  catch (error) { closeSync(fixtureFD); unlinkSync(fixturePath); throw error; }
  let starting = true, owned = true;
  return {
    ready() { if (starting) { closeSync(fixtureFD); unlinkSync(fixturePath); starting = false; } },
    closed() {
      // Call only after every owned child has emitted close, never on dispatch
      // of a kill signal. Otherwise another app could start during teardown.
      this.ready();
      if (owned) { closeSync(ownerFD); unlinkSync(ownerPath); owned = false; }
    },
  };
}
