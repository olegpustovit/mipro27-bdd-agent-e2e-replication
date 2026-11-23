import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const app = `${root}upstream/cypress-realworld-app`;
const revision = '0729f68ac220f7cda4ad09c5693dba11d7c532c6';
function run(command, args, cwd = root, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}
if (!existsSync(`${app}/.git`)) {
  mkdirSync(`${root}upstream`, { recursive: true });
  run('git', ['clone', '--filter=blob:none', '--no-checkout', 'https://github.com/cypress-io/cypress-realworld-app.git', app]);
  run('git', ['checkout', revision], app);
}
const actual = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: app, encoding: 'utf8' });
if (actual.status !== 0 || actual.stdout.trim() !== revision) {
  throw new Error(`Fixture must be checked out at ${revision}; refusing to replace an existing checkout`);
}
if (!readFileSync(`${app}/LICENSE`, 'utf8').includes('MIT License')) throw new Error('Unexpected fixture licence');
const path = `${app}/backend/app.ts`;
let source = readFileSync(path, 'utf8');
if (!source.includes('app.listen(Number(port), "127.0.0.1");')) {
  const original = source.includes('app.listen(port);') ? 'app.listen(port);' : 'app.listen(port, "127.0.0.1");';
  if (!source.includes(original)) throw new Error('Upstream binding changed');
  writeFileSync(path, source.replace(original, 'app.listen(Number(port), "127.0.0.1");'));
}
run('npx', ['--yes', 'yarn@1.22.22', 'install', '--frozen-lockfile'], app, {
  ...process.env, CYPRESS_INSTALL_BINARY: '0', PUPPETEER_SKIP_DOWNLOAD: 'true',
  PUPPETEER_SKIP_CHROMIUM_DOWNLOAD: 'true', HUSKY: '0',
});
run('npx', ['--yes', 'yarn@1.22.22', 'predev:cognito:ci'], app);
console.log(`Fixture ready: ${revision}`);
