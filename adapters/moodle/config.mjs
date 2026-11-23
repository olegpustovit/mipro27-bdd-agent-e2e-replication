// Paths, pins and port blocks for the Moodle adapter. All mutable state lives in one data directory.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
export const dockerDir = join(repoRoot, 'docker/moodle');
export const versions = JSON.parse(readFileSync(join(dockerDir, 'versions.json'), 'utf8'));
// Never /tmp: locks and snapshots must survive and must not collide with other users.
export const dataHome = () => process.env.STUDY_MOODLE_HOME || join(homedir(), '.local/share/cucumber-study/moodle');
export const sha40 = value => /^[0-9a-f]{40}$/.test(value);
export function resolveMoodleCommit(requested) {
  const commit = requested || process.env.STUDY_MOODLE_COMMIT || versions.moodle.defaultCommit;
  if (!sha40(commit)) throw new Error(`Moodle commit must be a full 40-hex sha, got: ${commit}`);
  return commit;
}
// Each worker gets a block of 10 consecutive host ports: base+0 web, +1 selenium VNC (off), +2 db (off).
export const PORT_BASE = 18100;
export const workerNumber = worker => { const m = /^w(\d+)$/.exec(worker); if (!m) throw new Error(`Worker name must look like w1, w2: ${worker}`); return Number(m[1]); };
export const portsFor = worker => { const base = PORT_BASE + 10 * workerNumber(worker); return { web: base, vnc: base + 1, db: base + 2, block: [base, base + 9] }; };
export const project = worker => `moodle-${worker}`;
// Moodle's Behat site always answers on this origin inside the compose network, and tests/agent must use it:
// moodle-docker pins behat_wwwroot, and Moodle redirects any other host to it.
export const BEHAT_HOST = 'webserver';
export const BEHAT_ORIGIN = `http://${BEHAT_HOST}`;
