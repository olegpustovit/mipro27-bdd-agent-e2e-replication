import { setupPayment } from '../../../runner/coded/pay-setup.mjs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { acquireLock, freshBrowser, reset } from '../../../../scripts/fixture.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const unlock = acquireLock();
try {
  for (const scenario of ['hold-01', 'hold-02', 'hold-03', 'hold-04', 'hold-05', 'hold-06', 'hold-07', 'hold-08']) {
    await reset();
    await setupPayment(scenario);
    const browser = await freshBrowser({ observerVersion: 'v0' });
    try {
      const code = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [
          'node_modules/@cucumber/cucumber/bin/cucumber.js',
          '--import', 'study/world.mjs',
          '--import', 'bench/stepdefs/pay/v0/hold-out.mjs',
          '--format', 'summary',
          '--retry', '0', '--exit',
          `bench/scenarios/pay/hold-out/${scenario}.feature`,
        ], {
          cwd: root,
          env: { PATH: process.env.PATH, LANG: 'C.UTF-8', NO_COLOR: '1', STUDY_CDP_ENDPOINT: browser.endpoint },
          stdio: ['ignore', 'inherit', 'inherit'],
          timeout: 60_000,
          killSignal: 'SIGKILL',
        });
        child.once('error', reject);
        child.once('close', resolve);
      });
      console.log(`healthy v0 ${scenario}: ${code === 0 ? 'pass' : 'fail'}`);
      if (code !== 0) process.exitCode = 1;
    } finally {
      await browser.close();
    }
  }
} finally {
  try { await reset(); } finally { unlock(); }
}
