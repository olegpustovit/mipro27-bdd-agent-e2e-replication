import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const bugs = fileURLToPath(new URL('.', import.meta.url));
const ledger = new URL('../plan/bug-checks.jsonl', import.meta.url);
const json = (relative) => JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8'));
const { images } = json('../env.lock.json');
const folders = readdirSync(bugs, { withFileTypes: true })
  .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
const docker = async (...args) => (await exec('docker', args, { timeout: 120_000 })).stdout.trim();

async function lint() {
  const paths = ['pay-check.mjs', 'mdl-check.mjs', ...folders.map(id => id + '/check.mjs')];
  for (const path of paths) {
    const url = new URL(path, import.meta.url);
    const source = readFileSync(url, 'utf8');
    assert.doesNotMatch(source, /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"][^'"]*(?:stepdefs|agent)\//, path);
    await exec(process.execPath, ['--check', fileURLToPath(url)]);
  }
  console.log(`PASS ${paths.length} independent check modules`);
}

async function verify(pin, label) {
  assert(pin, `Missing image pin for ${label}`);
  assert.equal(await docker('image', 'inspect', '--format', '{{.Id}}', pin.digest),
    pin.digest, label);
}

async function waitHealthy(container) {
  for (let i = 0; i < 90; i++) {
    const [running, status] = (await docker('inspect', '--format',
      '{{.State.Running}} {{.State.Health.Status}}', container)).split(' ');
    assert.equal(running, 'true', `Container ${container} stopped before it was healthy`);
    if (status === 'healthy') return;
    assert.notEqual(status, 'unhealthy', `Container ${container} failed its health check`);
    await delay(1000);
  }
  throw new Error('App container did not become healthy within 90 seconds');
}

async function payment({ bug, version, mode, pin }) {
  const name = `p7-${randomUUID()}`;
  const app = name + '-app';
  const browser = name + '-browser';
  try {
    await docker('run', '--pull=never', '-d', '--name', app, '--network', 'none', pin.digest);
    await waitHealthy(app);
    return await docker('run', '--pull=never', '--rm', '--name', browser, '--init',
      '--shm-size', '256m', '--network', `container:${app}`, '-v', `${bugs}:/opt/bench/bugs:ro`,
      images.browser.digest, 'node', `bugs/${bug}/check.mjs`, mode, version,
      'http://127.0.0.1:3000', 'http://127.0.0.1:3000/api');
  } finally {
    await Promise.allSettled([docker('rm', '-fv', browser), docker('rm', '-fv', app)]);
  }
}

async function moodle({ bug, version, mode, pin, dbPin }) {
  const network = `p7-${randomUUID()}`;
  const app = network + '-app';
  const db = network + '-db';
  const browser = network + '-browser';
  const subnet = `10.247.${parseInt(network.slice(3, 5), 16)}.${parseInt(network.slice(5, 7), 16) & 248}/29`;
  await docker('network', 'create', '--internal', '--subnet', subnet, network);
  try {
    await docker('run', '--pull=never', '-d', '--name', db, '--network', network,
      '--network-alias', 'db', dbPin.digest);
    await waitHealthy(db);
    await docker('create', '--pull=never', '--name', app, '--network', network,
      '--network-alias', 'webserver', '-v', `${join(bugs, bug, 'patch.diff')}:/opt/p7.diff:ro`,
      pin.digest, 'bash', '-ec', mode === 'bug'
        ? 'git apply /opt/p7.diff && exec apache2-foreground'
        : 'exec apache2-foreground');
    await docker('start', app);
    await docker('run', '--pull=never', '-d', '--name', browser, '--init', '--shm-size', '256m',
      '--network', network, images.browser.digest);
    await Promise.all([waitHealthy(app), waitHealthy(browser)]);
    if (mode === 'bug') {
      await docker('exec', app, 'php', '-r',
        'define("BEHAT_UTIL", true); define("CLI_SCRIPT", true); require("/var/www/html/config.php"); purge_all_caches();');
    }
    const { wsEndpointPath } = JSON.parse(await docker('exec', browser, 'node', '-e',
      "fetch('http://127.0.0.1:3000/json').then(r => r.text()).then(console.log)"));
    assert.match(wsEndpointPath, /^\//);
    // The Docker daemon can be outside the runner's network namespace.
    // Forward the browser socket over docker exec without publishing it.
    return await withBrowserSocket(browser, async port =>
      (await exec(process.execPath, [join(bugs, bug, 'check.mjs'), mode, version,
        app, db, `ws://127.0.0.1:${port}${wsEndpointPath}`], { timeout: 180_000 })).stdout.trim());
  } finally {
    await Promise.allSettled([browser, app, db].map(name => docker('rm', '-fv', name)));
    await docker('network', 'rm', network);
  }
}

async function withBrowserSocket(browser, check) {
  const connections = new Set();
  const server = createServer(socket => {
    connections.add(socket);
    const relay = spawn('docker', ['exec', '-i', browser, 'node', '-e', [
      "const remote = require('node:net').connect(3000, '127.0.0.1');",
      "remote.on('error', () => process.exit(1));",
      'process.stdin.pipe(remote).pipe(process.stdout);',
    ].join('\n')], { stdio: ['pipe', 'pipe', 'ignore'] });
    relay.on('error', () => socket.destroy());
    relay.stdin.on('error', () => socket.destroy());
    relay.on('close', () => socket.destroy());
    socket.on('error', () => socket.destroy());
    socket.on('close', () => {
      connections.delete(socket);
      relay.kill();
    });
    socket.pipe(relay.stdin);
    relay.stdout.pipe(socket);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    return await check(server.address().port);
  } finally {
    for (const socket of connections) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  }
}

function matrix(app) {
  return folders.filter(id => id.startsWith(app === 'payment' ? 'pay-' : 'mdl-')).flatMap(bug =>
    json(`./${bug}/applies-to.json`).flatMap(version => ['healthy', 'bug'].map(mode => {
      if (app === 'moodle') {
        const key = `mdl-${bug.split('-')[1].toLowerCase()}-post-healthy`;
        const patch = new URL(`./${bug}/patch.diff`, import.meta.url);
        const patchSha256 = mode === 'bug' ? createHash('sha256').update(readFileSync(patch)).digest('hex') : null;
        return { app, bug, version, mode, pin: images.app[key], dbPin: images.db[key], patchSha256 };
      }
      const key = `pay-${version}-${mode === 'healthy' ? 'healthy' : bug.slice(4)}`;
      return { app, bug, version, mode, pin: images.app[key] };
    })));
}

const key = ({ bug, version, mode }) => `${bug} ${version} ${mode}`;

function latestResults() {
  const latest = new Map();
  for (const line of readFileSync(ledger, 'utf8').split('\n').filter(Boolean)) {
    const record = JSON.parse(line);
    if (record.run === 'formal-P7') latest.set(key(record), record);
  }
  return latest;
}

function passed(job, record) {
  return record?.status === 'pass' && record.imageDigest === job.pin?.digest &&
    record.dbImageDigest === job.dbPin?.digest && record.patchSha256 === job.patchSha256;
}

function summarize() {
  const latest = latestResults();
  const counts = new Map();
  let incomplete = false;
  for (const job of [...matrix('payment'), ...matrix('moodle')]) {
    const { app, bug, version, mode } = job;
    const change = app === 'moodle' ? `${bug.split('-')[1]}-post ` : '';
    const label = `${app} ${change}${version} ${mode}`;
    if (!counts.has(label)) counts.set(label, { pass: 0, total: 0 });
    const count = counts.get(label);
    count.total++;
    const record = latest.get(key(job));
    if (passed(job, record)) {
      count.pass++;
    } else {
      console.error(`INCOMPLETE ${key(job)} (${record?.status ?? 'missing'})`);
      incomplete = true;
    }
  }
  for (const [label, { pass, total }] of [...counts].sort()) console.log(`${label} ${pass}/${total}`);
  process.exitCode = Number(incomplete);
}

const selection = process.argv[2];
if (selection === 'lint') {
  await lint();
} else if (selection === 'summary') {
  summarize();
} else {
  assert(['payment', 'moodle'].includes(selection),
    'Usage: node formal-check.mjs lint|summary|payment|moodle [--resume] [bug ...]');
  await verify(images.browser, 'browser');
  const args = process.argv.slice(3);
  const subset = args.filter(arg => arg !== '--resume');
  const jobs = matrix(selection).filter(job => !subset.length || subset.includes(job.bug));
  assert(jobs.length);
  if (args.includes('--resume')) {
    const latest = latestResults();
    for (let index = jobs.length - 1; index >= 0; index--) {
      if (passed(jobs[index], latest.get(key(jobs[index])))) jobs.splice(index, 1);
    }
  }
  let failures = 0;
  const workers = Array.from({ length: Math.min(4, jobs.length) }, async () => {
    while (jobs.length) {
      const job = jobs.shift();
      const { bug, version, mode, pin } = job;
      const time = new Date().toISOString();
      let status = 'fail';
      try {
        await verify(pin, bug);
        if (job.dbPin) await verify(job.dbPin, bug + ' DB');
        const output = await (selection === 'payment' ? payment(job) : moodle(job));
        const pass = `PASS ${bug} ${version} ${mode}`;
        assert.equal(output.split('\n').at(-1), pass);
        console.log(pass);
        status = 'pass';
      } catch (error) {
        failures++;
        const diagnostic = (error.stderr || error.message).split('\n')
          .filter(line => !/<[^>]+>/.test(line)).slice(0, 9).join('\n');
        console.error(`FAIL ${bug} ${version} ${mode}\n${diagnostic}`);
      }
      appendFileSync(ledger, JSON.stringify({
        run: 'formal-P7', app: selection, bug, version, mode, status,
        imageDigest: pin?.digest ?? null, time,
        ...(job.dbPin && { dbImageDigest: job.dbPin.digest, patchSha256: job.patchSha256 }),
      }) + '\n');
    }
  });
  await Promise.all(workers);
  process.exitCode = Number(failures > 0);
}
