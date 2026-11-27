import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireLock, reset } from '../../../scripts/fixture.mjs';

const plan = JSON.parse(readFileSync(new URL('../../plan/plan.json', import.meta.url)));
const scenarios = new Map(plan.items.filter(item =>
  item.app === 'pay' && item.version === 'v0' && item.arm === 'sd-cur' && item.condition === 'healthy'
).map(item => [item.scenario, item]));
const adapter = fileURLToPath(new URL('../coded-run', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'coded-smoke-'));
const url = 'http://localhost:3000';

async function run(item, origin, label = item.scenario) {
  const file = join(temp, `${label}.json`);
  const out = join(temp, label);
  writeFileSync(file, JSON.stringify(item));
  const child = spawn(adapter, ['--item', file, '--out', out], {
    env: { ...process.env, BENCH_APP_URL: origin }, stdio: 'ignore',
    timeout: 90_000, killSignal: 'SIGKILL',
  });
  const [code] = await once(child, 'close');
  return { code, result: JSON.parse(readFileSync(join(out, 'coded.json'), 'utf8')) };
}

try {
  const unlock = acquireLock();
  let failures = 0;
  try {
    for (const item of scenarios.values()) {
      await reset();
      const { code, result } = await run(item, url);
      console.log(item.scenario, JSON.stringify(result));
      if (code !== 0 || result.status !== 'pass') failures++;
    }
  } finally {
    try { await reset(); } finally { unlock(); }
  }
  console.log(`${scenarios.size - failures}/${scenarios.size} payment scenarios passed`);
  // A separate fixture opens at step 1, then fails the heading check at step 2.
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><title>Empty sign-in fixture</title>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const { code, result } = await run(scenarios.get('auth-login'),
      `http://127.0.0.1:${server.address().port}`, 'forced');
    console.log('forced failure', JSON.stringify(result));
    assert.equal(code, 1);
    assert.equal(result.status, 'fail');
    assert.equal(result.failed_step, 2);
    assert.equal(result.failed_step_text, 'Then the sign-in heading is visible');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
  assert.equal(failures, 0);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
