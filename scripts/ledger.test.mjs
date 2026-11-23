// Run-ledger acceptance tests. No model calls: a fake driver and a fake job script stand in. Uses real systemd-run
// when a user manager is reachable; set STUDY_TEST_LAUNCHER=spawn to skip it (the spawn launcher is always tested).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { systemdAvailable, foldTasks } from './ledger/tasks.mjs';
import { readLines } from './ledger/jsonl.mjs';
import { foldTrials } from './ledger/trials.mjs';
import { pidAlive } from './ledger/process.mjs';
import { reapTagged, findTagged, REAP_ENV } from './ledger/reap.mjs';

const study = fileURLToPath(new URL('./study.mjs', import.meta.url));
const job = fileURLToPath(new URL('./ledger/fixtures/fake-job.mjs', import.meta.url));
const driverModule = fileURLToPath(new URL('./ledger/fixtures/fake-driver.mjs', import.meta.url));
const browserJob = fileURLToPath(new URL('./test-fixtures/browser-job.mjs', import.meta.url));
const stress = fileURLToPath(new URL('./ledger/fixtures/append-stress.mjs', import.meta.url));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sysd = process.env.STUDY_TEST_LAUNCHER !== 'spawn' && (() => { process.env.STUDY_LAUNCHER = ''; delete process.env.STUDY_LAUNCHER; return systemdAvailable(); })();
const launchers = sysd ? ['systemd', 'spawn'] : ['spawn'];

function harness(launcher) {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-test-')), data = join(dir, 'data'), repo = join(dir, 'repo');
  mkdirSync(join(repo, 'src'), { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repo });
  writeFileSync(join(repo, 'src/a.mjs'), 'export const a = 1;\n');
  const manifest = join(repo, 'manifest.json');
  writeFileSync(manifest, JSON.stringify({ plan: 'p1', models: ['fake-model'], drivers: [{ module: driverModule }], pinPatterns: ['src/*.mjs'] }));
  const env = { ...process.env, STUDY_DATA_DIR: data, STUDY_REPO_ROOT: repo, STUDY_LAUNCHER: launcher, STUDY_HEARTBEAT_MS: '200', STUDY_DEAD_LEASE_MS: '1500',
    STUDY_FAKE_RUNLOG: join(dir, 'runs.log'), STUDY_FAKE_PIDFILE: join(dir, 'job.pid') };
  const cli = (args, extra = {}) => new Promise(resolve => {
    const c = spawn(process.execPath, [study, ...args], { env: { ...env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = ''; c.stdout.on('data', d => out += d); c.stderr.on('data', d => err += d);
    c.on('close', code => resolve({ code, out, err }));
  });
  const h = {
    dir, data, repo, env, cli,
    events: () => readLines(join(data, 'tasks.jsonl')),
    trials: () => readLines(join(data, 'trials.jsonl')),
    task: key => foldTasks(h.events()).tasks.get(key),
    async status(key) { return JSON.parse((await cli(['task', 'status', key, '--json'])).out)[0]; },
    async waitState(key, states, ms = 25000) {
      const until = Date.now() + ms;
      while (Date.now() < until) { const t = h.task(key); if (t && states.includes(t.state)) return t; await sleep(100); }
      throw new Error(`timeout waiting for ${key} in ${states}; now ${h.task(key)?.state}`);
    },
    runs: () => existsSync(env.STUDY_FAKE_RUNLOG) ? readFileSync(env.STUDY_FAKE_RUNLOG, 'utf8').trim().split('\n').filter(Boolean).map(l => l.split(' ').map(Number)) : [],
    freeze: () => cli(['plan', 'freeze', manifest]),
    start: (key, extra = {}, tail = []) => cli(['task', 'start', key, '--plan', 'p1', '--', process.execPath, job, ...tail], extra),
    hardKill(key) {
      const t = h.task(key);
      if (launcher === 'systemd') spawnSync('systemctl', ['--user', 'kill', '--signal=SIGKILL', `${t.lease.unit}.service`]);
      else process.kill(-t.lease.pid, 'SIGKILL');
    },
    async cleanup() { for (const t of foldTasks(h.events()).tasks.values()) if (['claimed', 'running'].includes(t.state)) await cli(['task', 'cancel', t.key, '--reason', 'test cleanup']); rmSync(dir, { recursive: true, force: true }); },
  };
  return h;
}

for (const launcher of launchers) {
  test(`[${launcher}] 1 start twice: second refused, one unit`, async () => {
    const h = harness(launcher);
    try {
      assert.equal((await h.freeze()).code, 0);
      const a = await h.start('campaign:t/one', {}, []);
      assert.equal(a.code, 0, a.err);
      const b = await h.start('campaign:t/one', { STUDY_FAKE_TRIAL_MS: '1000' });
      assert.equal(b.code, 2); assert.match(b.err, /live lease|done|attach/);
      assert.equal(h.events().filter(e => e.type === 'task-claimed').length, 1);
      await h.waitState('campaign:t/one', ['done']);
      if (launcher === 'systemd') { const units = execFileSync('systemctl', ['--user', 'list-units', '--all', '--plain', '--no-legend', 'study-campaign-t-one*'], { encoding: 'utf8' }); assert.equal(units.trim().split('\n').filter(Boolean).length <= 1, true); }
    } finally { await h.cleanup(); }
  });

  test(`[${launcher}] 2 two concurrent starts: exactly one wins`, async () => {
    const h = harness(launcher);
    try {
      await h.freeze();
      const rs = await Promise.all([1, 2].map(() => h.start('campaign:t/two', { STUDY_FAKE_TRIAL_MS: '300' })));
      assert.deepEqual(rs.map(r => r.code).sort(), [0, 2], JSON.stringify(rs));
      assert.equal(h.events().filter(e => e.type === 'task-claimed').length, 1);
      await h.waitState('campaign:t/two', ['done']);
      assert.deepEqual(h.runs().map(r => r[0]), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    } finally { await h.cleanup(); }
  });

  test(`[${launcher}] 3 kill -9 at trial 5/10 then resume: 1-4 not rerun, 5 interrupted + attempt 2, 6-10 once, 10 completed`, async () => {
    const h = harness(launcher), key = 'campaign:t/three';
    try {
      await h.freeze();
      assert.equal((await h.start(key, { STUDY_FAKE_KILL_AT: '5' })).code, 0);
      await h.waitState(key, ['failed']);
      assert.equal(h.trials().filter(e => e.type === 'trial-end').length, 4);
      const r = await h.cli(['task', 'resume', key]); assert.equal(r.code, 0, r.err);
      const t = await h.waitState(key, ['done']);
      assert.equal(t.attempt, 2);
      const runs = h.runs();
      assert.deepEqual(runs.filter(([i]) => i <= 4), [[1, 1], [2, 1], [3, 1], [4, 1]]);
      assert.deepEqual(runs.filter(([i]) => i === 5), [[5, 1], [5, 2]]);
      assert.deepEqual(runs.filter(([i]) => i > 5).map(r => r[0]), [6, 7, 8, 9, 10]);
      const { trials } = foldTrials(h.trials());
      const five = [...trials.values()].find(x => x.key.includes('/case5/'));
      assert.equal(five.attempts.length, 2); assert.ok(five.attempts[0].interrupted); assert.ok(five.attempts[1].end);
      assert.equal([...trials.values()].filter(x => x.end).length, 10);
      assert.equal(h.trials().filter(e => e.type === 'trial-interrupted').length, 1);
    } finally { await h.cleanup(); }
  });

  test(`[${launcher}] 4 resume while the lease is alive: refused with attach hint`, async () => {
    const h = harness(launcher), key = 'campaign:t/four';
    try {
      await h.freeze();
      assert.equal((await h.start(key, { STUDY_FAKE_HANG_AT: '2' })).code, 0);
      await h.waitState(key, ['running']);
      const r = await h.cli(['task', 'resume', key]);
      assert.equal(r.code, 2); assert.match(r.err, /lease is alive/); assert.match(r.err, /attach/);
      assert.equal(h.events().filter(e => e.type === 'task-claimed').length, 1);
    } finally { await h.cleanup(); }
  });

  test(`[${launcher}] 5 plan/code change after freeze: start and resume refused`, async () => {
    const h = harness(launcher), key = 'campaign:t/five';
    try {
      await h.freeze();
      assert.equal((await h.start(key, { STUDY_FAKE_KILL_AT: '5' })).code, 0);
      await h.waitState(key, ['failed']);
      writeFileSync(join(h.repo, 'src/a.mjs'), 'export const a = 2;\n');
      const r = await h.cli(['task', 'resume', key]);
      assert.equal(r.code, 2); assert.match(r.err, /changed since freeze.*src\/a\.mjs/);
      const s = await h.start('campaign:t/five-b'); assert.equal(s.code, 2); assert.match(s.err, /changed since freeze/);
      assert.equal(h.task(key).attempt, 1);
      const f = await h.freeze(); assert.equal(f.code, 2); assert.match(f.err, /already frozen with a different hash/);
      writeFileSync(join(h.repo, 'src/a.mjs'), 'export const a = 1;\n');
      assert.equal((await h.cli(['task', 'resume', key])).code, 0);
      await h.waitState(key, ['done']);
    } finally { await h.cleanup(); }
  });

  test(`[${launcher}] 6 start on done: refused; #2 needs a reason`, async () => {
    const h = harness(launcher), key = 'campaign:t/six';
    try {
      await h.freeze();
      assert.equal((await h.start(key)).code, 0);
      await h.waitState(key, ['done']);
      const r = await h.start(key); assert.equal(r.code, 2); assert.match(r.err, /is done/);
      assert.equal((await h.cli(['task', 'resume', key])).code, 2);
      const noReason = await h.start(key + '#2'); assert.equal(noReason.code, 2); assert.match(noReason.err, /--reason/);
      const withReason = await h.cli(['task', 'start', key + '#2', '--plan', 'p1', '--reason', 'model outage corrupted run', '--', process.execPath, job]);
      assert.equal(withReason.code, 0, withReason.err);
      assert.equal(h.task(key + '#2').reason, 'model outage corrupted run'); assert.equal(h.task(key + '#2').rerunOf, key);
      await h.waitState(key + '#2', ['done']);
    } finally { await h.cleanup(); }
  });

  test(`[${launcher}] 7 stale lease (dead pid, old heartbeat): status shows dead, resume works`, async () => {
    const h = harness(launcher), key = 'campaign:t/seven';
    try {
      await h.freeze();
      assert.equal((await h.start(key, { STUDY_FAKE_HANG_AT: '3' })).code, 0);
      await h.waitState(key, ['running']);
      while (h.trials().filter(e => e.type === 'trial-end').length < 2) await sleep(50);
      h.hardKill(key); // wrapper and job die without recording anything
      await sleep(300);
      let s = await h.status(key);
      assert.equal(s.state, 'running'); assert.equal(s.lease, 'alive'); // pid gone, heartbeat still fresh: not yet dead
      assert.match((await h.cli(['task', 'resume', key])).err, /lease is alive/);
      await sleep(1700);
      s = await h.status(key);
      assert.equal(s.lease, 'DEAD');
      const r = await h.cli(['task', 'resume', key]); assert.equal(r.code, 0, r.err);
      await h.waitState(key, ['done']);
      assert.ok(h.events().some(e => e.type === 'task-interrupted' && e.synthesized));
      assert.equal(foldTrials(h.trials()).trials.size, 10);
    } finally { await h.cleanup(); }
  });


  // Playwright starts Chromium detached, so a SIGKILLed job leaves the browser behind. The ledger tags every job with STUDY_REAP_TAG and reaps by tag.
  const pidfile = h => join(h.dir, 'browser.pid'), browserPid = (h, attempt) => Number(readFileSync(`${pidfile(h)}.${attempt}`, 'utf8'));
  const startBrowserJob = (h, key, mode) => h.cli(['task', 'start', key, '--plan', 'p1', '--', process.execPath, browserJob], { STUDY_FAKE_BROWSER_PIDFILE: pidfile(h), STUDY_FAKE_BROWSER_MODE: mode });
  test(`[${launcher}] job SIGKILLed: the detached browser it started is reaped before the failure is recorded`, async () => {
    const h = harness(launcher), key = 'campaign:t/browser-job-kill';
    try {
      await h.freeze();
      assert.equal((await startBrowserJob(h, key, 'kill-job')).code, 0);
      await h.waitState(key, ['failed']);
      const pid = browserPid(h, 1);
      assert.equal(pidAlive(pid), false, 'orphaned browser still running after the job was SIGKILLed');
      const failed = h.events().find(e => e.type === 'task-failed' && e.key === key);
      assert.match(failed.reason, /killed by SIGKILL/); assert.ok(failed.reaped?.length >= 1, 'the failure event records what was reaped');
    } finally { await h.cleanup(); }
  });

  test(`[${launcher}] wrapper and job SIGKILLed (lease dies): resume reaps the orphaned browser before the next attempt`, async () => {
    const h = harness(launcher), key = 'campaign:t/browser-resume';
    try {
      await h.freeze();
      assert.equal((await startBrowserJob(h, key, 'hang')).code, 0);
      await h.waitState(key, ['running']);
      while (!existsSync(`${pidfile(h)}.1`)) await sleep(50);
      const first = browserPid(h, 1); await sleep(200);
      h.hardKill(key);
      await sleep(1800);   // lease older than STUDY_DEAD_LEASE_MS
      if (launcher === 'spawn') assert.equal(pidAlive(first), true, 'precondition: the browser outlives a SIGKILLed process group');
      const r = await h.cli(['task', 'resume', key], { STUDY_FAKE_BROWSER_PIDFILE: pidfile(h), STUDY_FAKE_BROWSER_MODE: 'hang' }); assert.equal(r.code, 0, r.err);
      await h.waitState(key, ['done']);
      assert.equal(pidAlive(first), false, 'the first attempt\'s browser survived the resume');
      assert.equal(pidAlive(browserPid(h, 2)), false, 'the second attempt\'s browser outlived its job');
    } finally { await h.cleanup(); }
  });

  test(`[${launcher}] cancel records interrupted with the reason; status table`, async () => {
    const h = harness(launcher), key = 'campaign:t/cancel';
    try {
      await h.freeze();
      await h.start(key, { STUDY_FAKE_HANG_AT: '2' });
      await h.waitState(key, ['running']);
      const c = await h.cli(['task', 'cancel', key, '--reason', 'owner stop']); assert.equal(c.code, 0, c.err);
      const t = h.task(key); assert.equal(t.state, 'interrupted'); assert.match(t.terminal.reason, /owner stop/);
      const table = (await h.cli(['task', 'status'])).out; assert.match(table, /campaign:t\/cancel\s+interrupted\s+\d\/10/);
      assert.equal((await h.cli(['task', 'resume', key])).code, 0);
      await h.waitState(key, ['running', 'done']);
    } finally { await h.cleanup(); }
  });
}

test('8 concurrent append stress: 8 procs x 500 lines, all valid JSON, none lost', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-stress-')), file = join(dir, 'x.jsonl'), lock = join(dir, 'x.lock');
  try {
    await Promise.all(Array.from({ length: 8 }, (_, id) => new Promise((resolve, reject) => {
      const c = spawn(process.execPath, [stress, file, lock, '500', String(id)], { stdio: 'inherit' });
      c.on('close', code => code === 0 ? resolve() : reject(new Error('stress proc failed')));
    })));
    const raw = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    assert.equal(raw.length, 4000);
    const rows = raw.map(l => JSON.parse(l));
    for (let id = 0; id < 8; id++) assert.deepEqual(rows.filter(r => r.proc === id).map(r => r.i), Array.from({ length: 500 }, (_, i) => i));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('flock is released when the holder is killed -9', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-lock-')), lock = join(dir, 'l.lock');
  try {
    const holder = spawn(process.execPath, ['-e', `import('${new URL('./ledger/lock.mjs', import.meta.url).href}').then(async m => { await m.acquire(${JSON.stringify(lock)}); console.log('held'); setInterval(()=>{},1000); })`], { stdio: ['ignore', 'pipe', 'inherit'] });
    await new Promise(r => holder.stdout.once('data', r));
    holder.kill('SIGKILL');
    const { acquire } = await import('./ledger/lock.mjs');
    const release = await acquire(lock, { timeoutMs: 5000 }); await release();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('reapTagged kills tagged processes in other sessions, spares untagged ones and the caller', async () => {
  const tag = `reap-unit-${process.pid}`, mk = env => spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore', env });
  const tagged = mk({ ...process.env, [REAP_ENV]: tag }), other = mk({ ...process.env, [REAP_ENV]: tag + '-other' }), plain = mk({ ...process.env });
  tagged.unref(); other.unref(); plain.unref();
  try {
    await sleep(300);
    assert.deepEqual(findTagged(tag).map(p => p.pid), [tagged.pid]);
    const r = await reapTagged(tag, { graceMs: 2000 });
    assert.equal(r.found, 1); assert.equal(r.survivors, 0);
    assert.equal(pidAlive(tagged.pid), false); assert.equal(pidAlive(other.pid), true); assert.equal(pidAlive(plain.pid), true);
    assert.deepEqual(await reapTagged(tag), { found: 0, killed: [], survivors: 0 });
  } finally { for (const c of [tagged, other, plain]) try { process.kill(c.pid, 'SIGKILL'); } catch {} }
});
