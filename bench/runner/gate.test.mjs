import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { key, plan, root, suites } from './gate-data.mjs';

test('the real runner refuses a version with a failed gate before launching an adapter', () => {
  const temp = mkdtempSync(join(tmpdir(), 'p6-test-'));
  try {
    const item = plan.items.find(item => item.app === 'pay' && item.arm === 'sd-cur' && item.condition === 'healthy');
    const { items, ...identity } = suites.get(key(item));
    const row = { ...identity, status: 'pass', total: items.length, passed: items.length,
      scenarios: items.map(({ scenario }) => ({ scenario, status: 'pass' })) };
    const records = join(temp, 'gate.jsonl');
    const input = join(temp, 'item.json');
    const marker = join(temp, 'launched');
    const adapter = join(temp, 'coded');
    writeFileSync(input, JSON.stringify(item));
    writeFileSync(adapter, '#!/bin/sh\ntouch "$P6_TEST_MARKER"\n', { mode: 0o755 });
    const env = { ...process.env, BENCH_GATE_RECORDS: records, P6_TEST_MARKER: marker };
    const set = () => writeFileSync(records, JSON.stringify(row) + '\n');
    const check = () => spawnSync(root + 'bench/runner/check-gate', ['--item', input], { env, encoding: 'utf8' });

    set();
    assert.equal(check().status, 0);
    row.status = 'fail';
    row.passed--;
    row.scenarios[0].status = 'fail';
    set();
    assert.match(check().stderr, /All-pass gate did not pass/);
    const alerts = join(temp, 'alerts');
    const run = spawnSync(root + 'bench/runner/run-item', [
      '--item', item.id, '--lock-check', '/usr/bin/true', '--coded-run', adapter,
      '--min-memory-bytes', '0', '--min-disk-bytes', '0', '--ledger-dir', join(temp, 'ledger'),
      '--alert-sink', alerts,
    ], { env, encoding: 'utf8' });
    assert.equal(run.status, 2, run.stderr);
    assert.throws(() => readFileSync(marker), { code: 'ENOENT' });
    assert.match(readFileSync(alerts, 'utf8'), /failed gate/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
