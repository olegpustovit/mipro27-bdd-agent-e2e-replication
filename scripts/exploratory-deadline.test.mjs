import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { exploratoryConfig } from '../study/exploratory-plan.mjs';
import { cumulativeConfig } from '../study/cumulative-plan.mjs';
const runner = fileURLToPath(new URL('./exploratory-runner.mjs', import.meta.url));
const root = fileURLToPath(new URL('../', import.meta.url));

test('plan files carry no hard-coded deadline; a campaign must be given one', () => {
  assert.equal(exploratoryConfig.originalDeadline, undefined); assert.equal(cumulativeConfig.originalDeadline, undefined);
  const dir = mkdtempSync(join(tmpdir(), 'deadline-test-'));
  try {
    const env = { ...process.env, STUDY_DATA_DIR: dir }; delete env.STUDY_DEADLINE_UTC;
    const none = spawnSync(process.execPath, [runner, '--campaign-id', 'x'], { env, encoding: 'utf8' });
    assert.notEqual(none.status, 0); assert.match(none.stderr, /campaign deadline is required/);
    const bad = spawnSync(process.execPath, [runner, '--campaign-id', 'x', '--deadline', 'tomorrow'], { env, encoding: 'utf8' });
    assert.match(bad.stderr, /Invalid campaign deadline/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('no lock or log path under /tmp in study scripts', () => {
  const grep = spawnSync('grep', ['-rn', '--include=*.mjs', '/tmp/cucumber', 'scripts', 'study'], { cwd: root, encoding: 'utf8' });
  assert.equal(grep.stdout.split('\n').filter(l => l && !l.includes('exploratory-deadline.test')).length, 0, grep.stdout);
});
