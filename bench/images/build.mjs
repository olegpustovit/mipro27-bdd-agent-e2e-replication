#!/usr/bin/env node
import { execFile, execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { dockerEngine } from './docker-engine.mjs';

const images = fileURLToPath(new URL('.', import.meta.url));
const bench = join(images, '..');
const lockPath = join(bench, 'env.lock.json');
const startupPath = join(bench, 'plan/startup.json');
const nodeImage = 'node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c';
const payCommit = '0729f68ac220f7cda4ad09c5693dba11d7c532c6';
const tag = name => `mipro27-p2a:${name}`;
const readJSON = path => JSON.parse(readFileSync(path, 'utf8'));
const command = (bin, args, options = {}) => execFileSync(bin, args, {
  cwd: bench, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'], ...options,
});
const docker = (...args) => command('docker', args, { encoding: 'utf8' }).trim();
const git = (...args) => command('git', args);
const run = promisify(execFile);
const dockerAsync = async (...args) =>
  (await run('docker', args, { encoding: 'utf8', timeout: 60_000 })).stdout.trim();
let engine;
const atomicJSON = (path, value) => {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temp, path);
};

async function build(name, dockerfile, context, options) {
  const args = ['build', '-t', tag(name), '-f', join(images, dockerfile), ...options, context];
  const child = spawn('docker', args, { stdio: 'inherit', env: { DOCKER_BUILDKIT: '0', ...process.env } });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() :
      reject(new Error(`docker build ${name} failed (${signal ?? code})`)));
  });
  const ref = tag(name);
  const digest = engine ? await engine.image(ref) : await dockerAsync('image', 'inspect', '--format', '{{.Id}}', ref);
  return { ref, digest };
}

async function waitHealthy(id, ref, start, timeoutMs = 90_000) {
  while (performance.now() - start < timeoutMs) {
    const state = engine ? await engine.state(id) :
      JSON.parse(await dockerAsync('inspect', '--format', '{{json .State}}', id));
    if (!state.Running || state.Health.Status === 'unhealthy') break;
    if (state.Health.Status === 'healthy') {
      const firstSuccess = state.Health.Log.find(check => check.ExitCode === 0);
      return Date.parse(firstSuccess.End) - Date.parse(state.StartedAt);
    }
    await delay(400);
  }
  command('docker', ['logs', '--tail', '50', id], { stdio: 'inherit' });
  throw new Error(`${ref} did not become healthy`);
}

async function smoke(pin, app) {
  const id = engine ? await engine.create(pin.digest) :
    await dockerAsync('create', '--label', 'org.mipro27.pretask=P2a', '--init',
      '--network', 'none', '--shm-size', '256m', pin.digest);
  const start = performance.now();
  try {
    if (engine) await engine.start(id);
    else await dockerAsync('start', id);
    const startupMs = await waitHealthy(id, pin.ref, start);
    const checksum = app ? createHash('sha256')
      .update((await run('docker', ['exec', id, 'cat', '/app/data/database.json'], { encoding: 'buffer', timeout: 30_000 })).stdout)
      .digest('hex') : null;
    if (pin.ref === tag('browser')) {
      await dockerAsync('exec', id, 'node', '-e', `(async () => {
        const { chromium } = require('playwright');
        const { wsEndpointPath } = await (await fetch('http://127.0.0.1:3000/json')).json();
        const browser = await chromium.connect('ws://127.0.0.1:3000' + wsEndpointPath);
        try {
          const page = await browser.newPage();
          await page.goto('data:text/html,<title>ready</title>');
          if (await page.title() !== 'ready') throw new Error('Chromium smoke failed');
        } finally { await browser.close(); }
      })().catch(error => { console.error(error); process.exit(1); })`);
    }
    return { startupMs, checksum };
  } finally {
    if (engine) await engine.remove(id);
    else await dockerAsync('rm', '-f', '-v', id);
  }
}

async function main() {
  const selection = process.argv[2] ?? 'all';
  if (process.argv.length > 3 || !['all', 'tools', 'pay', 'pay-healthy', 'moodle'].includes(selection)) {
    throw new Error('Usage: build.mjs [all|tools|pay|pay-healthy|moodle]');
  }

  const endpoint = !process.env.DOCKER_CONTEXT && process.env.DOCKER_HOST ||
    await dockerAsync('context', 'inspect', '--format', '{{.Endpoints.docker.Host}}');
  engine = dockerEngine(endpoint);
  const lock = readJSON(lockPath);
  const toolchain = readJSON(join(images, 'toolchain/package.json')).dependencies;
  for (const [field, packageName] of Object.entries({
    codexCli: '@openai/codex', playwrightMcp: '@playwright/mcp', playwright: 'playwright',
  })) {
    if (lock[field] !== toolchain[packageName]) throw new Error(`Toolchain does not match ${field}`);
  }
  if (!nodeImage.startsWith(`node:${lock.node}-`)) throw new Error('Node image does not match environment lock');

  const work = join(images, '.work');
  mkdirSync(work, { recursive: true });
  // Serialize writes to the two shared evidence files.
  const guard = join(work, 'build.lock');
  mkdirSync(guard);
  let context;
  try {
    context = mkdtempSync(join(work, 'build-'));
    const startup = existsSync(startupPath) ? readJSON(startupPath) : {};
    function save(name, pin, db, entry) {
      if (db) {
        lock.images.app[name] = pin;
        lock.images.db[name] = db;
      } else {
        lock.images[name] = pin;
      }
      startup[name] = { digest: pin.digest, ...entry };
      atomicJSON(startupPath, startup);
      atomicJSON(lockPath, lock);
      console.log(`${name} ${pin.digest} ready in ${entry.startupMs} ms${entry.seedSha256 ? `, matching seed ${entry.seedSha256}` : ''}`);
    }

    async function record(name, pin, app = false) {
      if (!app) {
        const { startupMs } = await smoke(pin, false);
        return save(name, pin, null, { startupMs });
      }
      const results = await Promise.allSettled([smoke(pin, true), smoke(pin, true)]);
      for (const result of results) {
        if (result.status === 'rejected') throw result.reason;
      }
      const [first, second] = results.map(result => result.value);
      if (first.checksum !== second.checksum) throw new Error(`Seed mismatch for ${name}`);
      // Lowdb is embedded in the payment app container.
      save(name, pin, pin, {
        startupMs: first.startupMs, seedSha256: first.checksum, secondStartupMs: second.startupMs,
      });
    }

    if (selection === 'moodle') {
      const { buildMoodle } = await import('./build-moodle.mjs');
      return await buildMoodle({ bench, context, readJSON, git, command, docker, build, waitHealthy, record: save });
    }

    const nodeArg = ['--build-arg', `NODE_IMAGE=${nodeImage}`];
    if (selection === 'tools' || selection === 'all') {
      for (const role of ['browser', 'agent']) {
        const pin = await build(role, 'tools.Dockerfile', join(images, 'toolchain'), [...nodeArg, '--target', role]);
        await record(role, pin);
      }
    }
    if (selection === 'tools') return;

    const upstream = join(images, '.pay-source');
    if (!existsSync(join(upstream, '.git'))) {
      git('clone', '--no-checkout', 'https://github.com/cypress-io/cypress-realworld-app.git', upstream);
    }
    const archive = git('-C', upstream, 'archive', payCommit);
    const deps = join(context, 'deps');
    mkdirSync(deps);
    command('tar', ['-x', '-C', deps, 'package.json', 'yarn.lock', '.yarnrc', 'patches'], { input: archive, stdio: ['pipe', 'inherit', 'inherit'] });
    const dependency = await build('pay-deps', 'pay-deps.Dockerfile', deps, nodeArg);
    const patchFiles = git('ls-tree', '--full-tree', '-r', '--name-only', 'HEAD', '--', 'bench/bugs')
      .toString().trim().split('\n').filter(path => /^bench\/bugs\/pay-[^/]+\/patch\.diff$/.test(path));
    if (selection !== 'pay-healthy' && patchFiles.length !== 20) {
      throw new Error(`Expected 20 committed payment patches, got ${patchFiles.length}`);
    }
    const variants = [null, ...(selection === 'pay-healthy' ? [] : patchFiles)];
    const jobs = Number(process.env.P2A_BUILD_JOBS ?? '4');
    if (!Number.isSafeInteger(jobs) || jobs < 1) throw new Error('P2A_BUILD_JOBS must be a positive integer');
    const versions = ['v0', 'v1', 'v2'];
    const matrix = versions.flatMap((version, index) => variants.map(patch => ({ version, index, patch })));
    async function buildPayment({ index, version, patch }) {
      const name = `pay-${version}-${patch ? patch.split('/')[2].slice(4) : 'healthy'}`;
      const fixture = join(context, name);
      const source = join(fixture, 'source');
      mkdirSync(source, { recursive: true });
      try {
        command('tar', ['-x', '-C', source], { input: archive, stdio: ['pipe', 'inherit', 'inherit'] });
        const patches = versions.slice(1, index + 1).map(v => `bench/apps/pay/${v}.patch`);
        if (patch) patches.push(patch);
        for (const file of patches) {
          const diff = git('show', `HEAD:${file}`);
          command('git', ['apply', '--no-index', '-'], { cwd: source, env: { ...process.env, GIT_CEILING_DIRECTORIES: fixture }, input: diff, stdio: ['pipe', 'inherit', 'inherit'] });
        }
        cpSync(join(images, 'prepare-pay.mjs'), join(fixture, 'prepare-pay.mjs'));
        const pin = await build(name, 'pay.Dockerfile', fixture, ['--build-arg', `PAY_DEPS=${dependency.ref}`]);
        await record(name, pin, true);
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    }
    for (let start = 0; start < matrix.length; start += jobs) {
      const results = await Promise.allSettled(matrix.slice(start, start + jobs).map(buildPayment));
      const failures = results.filter(result => result.status === 'rejected');
      if (failures.length) throw new Error(failures.map(result => result.reason.message).join('\n'));
    }
  } finally {
    if (context) rmSync(context, { recursive: true, force: true });
    rmSync(guard, { recursive: true });
  }
}

main().catch(error => {
  console.error(error.stderr?.trim() || error.message);
  process.exitCode = 1;
});
