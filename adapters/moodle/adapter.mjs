// Moodle app adapter: moodle-docker + Behat, resettable by exact DB and moodledata snapshot restore.
// Interface: see docs/contracts/adapter.md.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, createReadStream, renameSync, readdirSync } from 'node:fs';
import { createWriteStream } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { versions, dockerDir, dataHome, resolveMoodleCommit, portsFor, project, BEHAT_HOST, BEHAT_ORIGIN } from './config.mjs';
import { run, sleep, until } from './shell.mjs';
import { acquireLock } from './lock.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
const SCHEMA_FILES = /(^|\/)(db\/(install\.xml|upgrade\.php)|version\.php)$/;
const notRestrict = line => !/^\\(un)?restrict /.test(line);   // pg_dump >=17.6 prints a random token per run
const nowMs = () => Number(process.hrtime.bigint() / 1000000n);

export function bridgeGateway() { // explicit override only; CLI and start() otherwise detect it
  // Published ports must be reachable from the harness. On Docker-in-WSL setups loopback publishing is not
  // reachable from the harness network namespace, so default to the docker bridge gateway when STUDY_MOODLE_BIND is unset.
  return process.env.STUDY_MOODLE_BIND || null;
}

export class MoodleAdapter {
  constructor({ worker = 'w1', moodleCommit, home = dataHome(), bind } = {}) {
    this.worker = worker; this.home = home;
    this.commit = resolveMoodleCommit(moodleCommit);
    this.ports = portsFor(worker); this.project = project(worker);
    this.bind = bind || bridgeGateway();
    this.dirs = {
      dockerRepo: join(home, 'moodle-docker'), tools: join(home, 'tools'), golden: join(home, 'golden'),
      base: join(home, 'src', this.commit.slice(0, 12)),
      work: join(home, 'workers', worker), src: join(home, 'workers', worker, 'moodle'),
    };
    this.lockPath = join(this.dirs.work, 'lock');
    this.statePath = join(this.dirs.work, 'state.json');
    this.container = role => `${this.project}-${role}-1`;
    this.volume = name => `${this.project}_${name}`;
    this._release = null;
  }

  // ---- identity ---------------------------------------------------------------------------------------------------
  get baseUrl() { return BEHAT_ORIGIN; }                       // what the agent/browser navigates to
  get allowedOrigins() { return [BEHAT_ORIGIN]; }
  get hostUrl() { return `http://${this.bind}:${this.ports.web}`; } // where the harness reaches the same site
  // Chromium flags so a harness-side browser resolves the Behat origin to this worker's published port.
  browserArgs() { return [`--host-resolver-rules=MAP ${BEHAT_HOST} ${this.bind}:${this.ports.web}`]; }
  get state() { try { return JSON.parse(readFileSync(this.statePath, 'utf8')); } catch { return {}; } }
  #save(patch) { mkdirSync(this.dirs.work, { recursive: true }); writeFileSync(this.statePath, JSON.stringify({ ...this.state, ...patch }, null, 2)); }

  // ---- leases / locks -----------------------------------------------------------------------------------------------
  lease(owner = 'adapter') { if (this._release) throw new Error('Lease already held by this adapter instance'); this._release = acquireLock(this.lockPath, owner); return () => { this._release?.(); this._release = null; }; }
  async #locked(owner, fn) { if (this._release) return fn(); const release = this.lease(owner); try { return await fn(); } finally { release(); } }

  // ---- docker helpers -----------------------------------------------------------------------------------------------
  #composeEnv() {
    return {
      MOODLE_DOCKER_WWWROOT: this.dirs.src, MOODLE_DOCKER_DB: versions.db.type, MOODLE_DOCKER_DB_VERSION: versions.db.version,
      MOODLE_DOCKER_PHP_VERSION: versions.php, MOODLE_DOCKER_BROWSER: versions.browser,
      MOODLE_DOCKER_WEB_PORT: `${this.bind}:${this.ports.web}`, COMPOSE_PROJECT_NAME: this.project,
      STUDY_IMG_WEB: versions.images.webserver, STUDY_IMG_DB: versions.images.db, STUDY_IMG_SELENIUM: versions.images.selenium,
      STUDY_BEHAT_EXT: join(dockerDir, 'behat'), STUDY_TOOLS: this.dirs.tools,
    };
  }
  compose(args, opts = {}) { return run(join(this.dirs.dockerRepo, 'bin/moodle-docker-compose'), ['-f', join(dockerDir, 'compose.override.yml'), ...args], { env: this.#composeEnv(), ...opts }); }
  exec(role, args, { user, cwd, env = {}, ...opts } = {}) {
    const flags = ['exec', ...(opts.input !== undefined ? ['-i'] : []), ...(user ? ['-u', user] : []), ...(cwd ? ['-w', cwd] : []), ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`])];
    return run('docker', [...flags, this.container(role), ...args], opts);
  }
  psql(sql, db = 'postgres') { return this.exec('db', ['psql', '-U', 'moodle', '-d', db, '-v', 'ON_ERROR_STOP=1', '-tAc', sql]); }
  // Throwaway container on the worker's volumes (webserver image, root, no network) for volume copy/hash.
  volumeRun(script, { mounts = {}, ...opts } = {}) {
    const flags = Object.entries(mounts).flatMap(([vol, path]) => ['-v', `${this.volume(vol)}:${path}`]);
    return run('docker', ['run', '--rm', '--network', 'none', '--user', 'root', '--entrypoint', 'sh', ...flags, ...(opts.input !== undefined ? ['-i'] : []), versions.images.webserver, '-c', script], opts);
  }

  // ---- bootstrap (shared by all workers of one Moodle commit) ---------------------------------------------------------
  goldenKey() { return `${this.commit.slice(0, 12)}-${sha(JSON.stringify([versions.moodleDocker, versions.images, versions.php, versions.db, versions.composer])).slice(0, 10)}`; }
  goldenDir() { return join(this.dirs.golden, this.goldenKey()); }
  async bootstrap({ rebuildGolden = false } = {}) {
    const log = (...a) => console.error('[bootstrap]', ...a);
    mkdirSync(this.dirs.tools, { recursive: true });
    // 1. moodle-docker at its pinned commit
    if (!existsSync(join(this.dirs.dockerRepo, '.git'))) await run('git', ['clone', '-q', versions.moodleDocker.repo, this.dirs.dockerRepo]);
    const head = (await run('git', ['rev-parse', 'HEAD'], { cwd: this.dirs.dockerRepo })).stdout.trim();
    if (head !== versions.moodleDocker.commit) { await run('git', ['fetch', '-q', 'origin'], { cwd: this.dirs.dockerRepo }); await run('git', ['checkout', '-q', versions.moodleDocker.commit], { cwd: this.dirs.dockerRepo }); }
    // 2. composer.phar, checksum-verified
    const phar = join(this.dirs.tools, 'composer.phar');
    const okPhar = () => existsSync(phar) && sha(readFileSync(phar)) === versions.composer.sha256;
    if (!okPhar()) { await run('curl', ['-fsSL', versions.composer.url, '-o', phar]); if (!okPhar()) throw new Error('composer.phar checksum mismatch'); }
    // 3. Moodle source at the commit (fetched by sha; GPL code is never copied into this repository)
    if (!existsSync(join(this.dirs.base, '.git'))) {
      mkdirSync(this.dirs.base, { recursive: true });
      await run('git', ['init', '-q'], { cwd: this.dirs.base });
      await run('git', ['remote', 'add', 'origin', versions.moodle.repo], { cwd: this.dirs.base });
      log('fetching moodle', this.commit);
      await run('git', ['fetch', '-q', '--depth', '1', 'origin', this.commit], { cwd: this.dirs.base });
      await run('git', ['checkout', '-q', this.commit], { cwd: this.dirs.base });
    }
    const moodleHead = (await run('git', ['rev-parse', 'HEAD'], { cwd: this.dirs.base })).stdout.trim();
    if (moodleHead !== this.commit) throw new Error(`Base Moodle checkout is ${moodleHead}, expected ${this.commit}`);
    copyFileSync(join(this.dirs.dockerRepo, 'config.docker-template.php'), join(this.dirs.base, 'config.php'));   // untracked, from the pinned moodle-docker
    for (const image of Object.values(versions.images)) await run('docker', ['pull', '-q', image]);
    // 4. golden seed: installed Behat site (init.php) captured as a DB dump + behatdata tarball
    if (rebuildGolden) rmSync(this.goldenDir(), { recursive: true, force: true });
    if (!existsSync(join(this.goldenDir(), 'meta.json'))) await this.#buildGolden(log);
    return this.versionRecord();
  }

  async #buildGolden(log) {
    const builder = new MoodleAdapter({ worker: 'w0', moodleCommit: this.commit, home: this.home, bind: this.bind });
    builder.dirs.src = this.dirs.base;               // build in place so vendor/ lands in the shared base
    const t0 = nowMs();
    await builder.compose(['down', '-v', '--remove-orphans'], { check: false });
    await builder.compose(['up', '-d', 'webserver', 'db']);
    try {
      await until('db', async () => (await builder.exec('db', ['pg_isready', '-U', 'moodle'], { check: false })).code === 0);
      log('composer install');
      const uid = `${process.getuid()}:${process.getgid()}`;
      if (!existsSync(join(this.dirs.base, 'vendor/autoload.php')))
        await builder.exec('webserver', ['php', '/opt/study-tools/composer.phar', 'install', '--no-interaction', '--prefer-dist'], { user: uid, cwd: '/var/www/html', env: { COMPOSER_HOME: '/tmp/composer', HOME: '/tmp' } });
      log('behat init (several minutes the first time)');
      const initStart = nowMs();
      const entry = existsSync(join(this.dirs.base, 'public/admin/tool/behat/cli/init.php')) ? 'public/admin/tool/behat/cli/init.php' : 'admin/tool/behat/cli/init.php';
      const init = await builder.exec('webserver', ['php', entry], { cwd: '/var/www/html', timeoutMs: 1800000 });
      const initMs = nowMs() - initStart;
      if (!/Acceptance tests environment enabled/.test(init.stdout)) throw new Error('Behat init did not report an enabled environment:\n' + init.stdout.slice(-800) + init.stderr.slice(-800));
      const dir = this.goldenDir(); mkdirSync(dir, { recursive: true });
      await run('docker', ['exec', builder.container('db'), 'pg_dump', '-U', 'moodle', '-Fc', 'moodle'], { stdoutFile: join(dir, 'moodle.dump') });
      await run('docker', ['exec', builder.container('webserver'), 'tar', '-C', '/var/www/behatdata', '-cf', '-', '.'], { stdoutFile: join(dir, 'behatdata.tar') });
      const sizes = { dump: readFileSync(join(dir, 'moodle.dump')).length, tar: readFileSync(join(dir, 'behatdata.tar')).length };
      writeFileSync(join(dir, 'meta.json'), JSON.stringify({ key: this.goldenKey(), builtAt: new Date().toISOString(), initMs, buildMs: nowMs() - t0, sizes, init: init.stdout.split('\n').slice(-6).join('\n'), versions: await builder.#runtimeVersions() }, null, 2));
    } finally { await builder.compose(['down', '-v', '--remove-orphans'], { check: false }); }
  }

  async #runtimeVersions() {
    const [php, pg, chrome, moodle] = await Promise.all([
      this.exec('webserver', ['php', '-r', 'echo PHP_VERSION;']).then(r => r.stdout.trim()),
      this.psql('show server_version').then(r => r.stdout.trim()).catch(() => null),
      run('docker', ['exec', this.container('selenium'), 'google-chrome', '--version'], { check: false }).then(r => r.stdout.trim() || null),
      this.exec('webserver', ['sh', '-c', "grep -h -m1 '^.release' /var/www/html/public/version.php /var/www/html/version.php 2>/dev/null | head -1"], { check: false }).then(r => r.stdout.trim()),
    ]);
    return { php, postgres: pg, chrome, moodleRelease: moodle };
  }
  versionRecord() {
    const meta = existsSync(join(this.goldenDir(), 'meta.json')) ? JSON.parse(readFileSync(join(this.goldenDir(), 'meta.json'), 'utf8')) : null;
    return { moodleCommit: this.commit, moodleDocker: versions.moodleDocker.commit, images: versions.images, phpMinor: versions.php, dbVersionMinor: versions.db.version, composer: versions.composer.sha256, goldenKey: this.goldenKey(), golden: meta };
  }

  // ---- worker lifecycle ---------------------------------------------------------------------------------------------
  async start({ ports, forceSeed = false } = {}) {
    return this.#locked('start', async () => {
      if (ports) this.ports = { ...this.ports, ...ports };
      if (!this.bind) this.bind = await this.#detectBind();
      await this.bootstrap();
      const t0 = nowMs(), phases = {};
      const lap = name => { phases[name] = nowMs() - t0 - Object.values(phases).reduce((a, b) => a + b, 0); };
      // worker's own copy of the source: patches apply here and never touch the shared base
      const stamp = join(this.dirs.work, 'src-commit');
      if (!existsSync(join(this.dirs.src, '.git')) || !existsSync(stamp) || readFileSync(stamp, 'utf8') !== this.commit) {
        await this.compose(['down', '-v', '--remove-orphans'], { check: false });
        rmSync(this.dirs.src, { recursive: true, force: true }); mkdirSync(this.dirs.work, { recursive: true });
        await run('cp', ['-a', '--reflink=auto', this.dirs.base, this.dirs.src]);
        writeFileSync(stamp, this.commit);
        this.#save({ patch: null }); forceSeed = true;
      }
      lap('source');
      await this.compose(['up', '-d', 'webserver', 'db', 'selenium']);
      await until('postgres', async () => (await this.exec('db', ['pg_isready', '-U', 'moodle'], { check: false })).code === 0);
      lap('compose-up');
      const seeded = (await this.psql("select 1 from pg_database where datname='moodle_seed'").catch(() => ({ stdout: '' }))).stdout.trim() === '1';
      if (!seeded || forceSeed || this.state.goldenKey !== this.goldenKey()) await this.#seedFromGolden(); else await this.#restoreAll({ startWeb: false });
      lap('seed');
      await this.exec('webserver', ['true'], { check: false });
      await this.#startWeb(); lap('web');
      this.#save({ started: new Date().toISOString(), ports: this.ports, bind: this.bind, moodleCommit: this.commit, runtime: await this.#runtimeVersions() });
      return { worker: this.worker, ms: nowMs() - t0, phases, baseUrl: this.baseUrl, hostUrl: this.hostUrl, seed: this.state.seed };
    });
  }
  async #detectBind() {
    const r = await run('docker', ['network', 'inspect', 'bridge', '--format', '{{(index .IPAM.Config 0).Gateway}}'], { check: false });
    return (process.env.STUDY_MOODLE_BIND || r.stdout.trim() || '127.0.0.1');
  }
  async stop({ remove = false } = {}) { return this.#locked('stop', async () => { await this.compose(remove ? ['down', '-v', '--remove-orphans'] : ['stop'], { check: false }); if (remove) rmSync(this.dirs.work, { recursive: true, force: true }); }); }

  async #seedFromGolden() {
    const dir = this.goldenDir();
    await this.#stopWeb();
    await this.psql('DROP DATABASE IF EXISTS moodle WITH (FORCE)'); await this.psql('DROP DATABASE IF EXISTS moodle_seed WITH (FORCE)');
    await this.psql('CREATE DATABASE moodle OWNER moodle');
    await run('docker', ['cp', join(dir, 'moodle.dump'), `${this.container('db')}:/tmp/moodle.dump`]);
    await this.exec('db', ['pg_restore', '-U', 'moodle', '-d', 'moodle', '--no-owner', '-j', '4', '/tmp/moodle.dump']);
    await this.volumeRun('find /d -mindepth 1 -delete', { mounts: { behatdata: '/d' } });
    await this.volumeRun('tar -x -C /d', { mounts: { behatdata: '/d' }, input: readFileSync(join(dir, 'behatdata.tar')) });
    // snapshot: DB as a template database, files as a sibling volume
    await this.psql('CREATE DATABASE moodle_seed TEMPLATE moodle OWNER moodle');
    await this.volumeRun('find /s -mindepth 1 -delete; cp -a /d/. /s/', { mounts: { behatdata: '/d', behatseed: '/s' } });
    const hashes = await this.#hashes();
    this.#save({ goldenKey: this.goldenKey(), seed: { ...hashes, at: new Date().toISOString() } });
  }

  // ---- state hashes -------------------------------------------------------------------------------------------------
  // strict: every byte of DB (pg_dump) and moodledata. semantic: ignores what merely serving a page rewrites
  // (session rows, file caches, session/temp dirs); used for live drift checks on a site that has served requests.
  async #hashes() {
    const vol = ['cache', 'localcache', 'sessions', 'temp', 'lock', 'trashdir'];
    const volatile = vol.map(d => `-not -path './behatrun/${d}' -not -path './behatrun/${d}/*'`).join(' ') + ' -not -name tablesupdatedbyscenario.json';
    const fileHash = filter => this.volumeRun(`cd /d && (find . ${filter} -printf '%y %P\\n' | LC_ALL=C sort; find . ${filter} -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum) | sha256sum | cut -d' ' -f1`, { mounts: { behatdata: '/d' } }).then(r => r.stdout.trim());
    const dbHash = (extra, filterLine = notRestrict) => run('docker', ['exec', this.container('db'), 'pg_dump', '-U', 'moodle', ...extra, 'moodle'], { hash: true, filterLine }).then(r => r.sha256);
    const [db, files, dbSemantic, filesSemantic] = await Promise.all([dbHash([]), fileHash(''), dbHash(['--exclude-table-data=b_sessions'], line => notRestrict(line) && !/setval\('public\.b_sessions_id_seq'/.test(line)), fileHash(volatile)]);
    return { db, files, dbSemantic, filesSemantic };
  }
  async #sourceHash() {
    const diff = (await run('git', ['diff', '--binary', 'HEAD'], { cwd: this.dirs.src })).stdout;
    return diff ? sha(diff) : 'clean';
  }

  // ---- web server control -------------------------------------------------------------------------------------------
  async #stopWeb() { await run('docker', ['stop', '-t', '1', this.container('webserver')], { check: false }); }
  async #startWeb() { await run('docker', ['start', this.container('webserver')]); await this.ready({ timeoutMs: 120000 }); }
  ready({ timeoutMs = 60000, quick = false } = {}) {
    // Plain HTTP with the Host header the Behat site insists on.
    const probe = () => new Promise((resolve, reject) => {
      const req = request({ host: this.bind, port: this.ports.web, path: '/login/index.php', headers: { host: BEHAT_HOST }, timeout: 15000 }, res => {
        let body = ''; res.on('data', c => { body += c; }); res.on('end', () => (res.statusCode === 200 && /Log in/.test(body)) ? resolve(true) : reject(new Error(`HTTP ${res.statusCode}`)));
      });
      req.on('error', reject); req.on('timeout', () => req.destroy(new Error('timeout'))); req.end();
    });
    return quick ? probe().then(() => true, () => false) : until('Moodle login page', probe, { timeoutMs, everyMs: 300 });
  }

  // ---- exact reset --------------------------------------------------------------------------------------------------
  // Quiesce web, restore DB from the seed template and moodledata from the seed volume, verify both by hash.
  async #restoreAll({ startWeb = true, verify = true } = {}) {
    const t0 = nowMs(), phases = {};
    await this.#stopWeb(); phases.stop = nowMs() - t0;
    let t = nowMs();
    await this.psql('DROP DATABASE IF EXISTS moodle WITH (FORCE)'); await this.psql('CREATE DATABASE moodle TEMPLATE moodle_seed OWNER moodle');
    phases.db = nowMs() - t; t = nowMs();
    await this.volumeRun('find /d -mindepth 1 -delete; cp -a /s/. /d/', { mounts: { behatdata: '/d', behatseed: '/s' } });
    phases.files = nowMs() - t; t = nowMs();
    let match = null, hashes = null;
    if (verify) { hashes = await this.#hashes(); const seed = this.state.seed; match = Boolean(seed) && hashes.db === seed.db && hashes.files === seed.files; phases.verify = nowMs() - t; }
    t = nowMs();
    if (startWeb) { await this.#startWeb(); phases.web = nowMs() - t; }
    return { phases, hashes, match };
  }
  async reset({ verify = true } = {}) {
    return this.#locked('reset', async () => {
      const t0 = nowMs();
      const r = await this.#restoreAll({ verify });
      const out = { worker: this.worker, ms: nowMs() - t0, ...r };
      this.#save({ lastReset: { at: new Date().toISOString(), ms: out.ms, match: out.match, phases: out.phases } });
      if (verify && !out.match) throw new Error(`Reset verification failed: ${JSON.stringify(out.hashes)} vs seed ${JSON.stringify(this.state.seed)}`);
      return out;
    });
  }
  // Compare the current state to the seed. live:true quiesces the web server, rehashes, restarts it.
  // (Page views write sessions and caches, so a live check is only meaningful right after reset or when the site is untouched.)
  async verifySeed({ live = false } = {}) {
    const seed = this.state.seed; if (!seed) throw new Error('No seed recorded; start() first');
    const source = await this.#sourceHash();
    if (!live) { const r = this.state.lastReset; return { ok: Boolean(r?.match), source, seed, lastReset: r ?? null, live: false }; }
    return this.#locked('verify', async () => {
      await this.#stopWeb(); const hashes = await this.#hashes(); await this.#startWeb();
      return { ok: hashes.dbSemantic === seed.dbSemantic && hashes.filesSemantic === seed.filesSemantic, strictOk: hashes.db === seed.db && hashes.files === seed.files, hashes, seed, source, live: true };
    });
  }

  // ---- source patches (fault injection: reverting a bug-fix commit is just a patch) ------------------------------------
  async applyDiff(patch, { allowSchema = false } = {}) {
    return this.#locked('applyDiff', async () => {
      const text = patch.includes('\n') || patch.startsWith('diff ') ? patch : readFileSync(patch, 'utf8');
      if (this.state.patch) throw new Error('A diff is already applied; revertDiff() first');
      if ((await this.#sourceHash()) !== 'clean') throw new Error('Worker source tree is not clean');
      const files = [...text.matchAll(/^diff --git a\/(\S+) b\/(\S+)/gm)].map(m => m[2]);
      if (!files.length) throw new Error('Patch has no "diff --git" headers');
      const schema = files.filter(f => SCHEMA_FILES.test(f));
      if (schema.length && !allowSchema) throw new Error(`Patch touches schema/version files (golden DB would not match): ${schema.join(', ')}`);
      const file = join(this.dirs.work, `patch-${sha(text).slice(0, 12)}.diff`); writeFileSync(file, text);
      await run('git', ['apply', '--check', '--whitespace=nowarn', file], { cwd: this.dirs.src });
      await run('git', ['apply', '--whitespace=nowarn', file], { cwd: this.dirs.src });
      this.#save({ patch: { sha: sha(text), file, files } });
      const assets = await this.rebuildAssets(files);
      await this.#restartWebIfUp();
      return { sha: sha(text), files, source: await this.#sourceHash(), assets };
    });
  }
  async revertDiff() {
    return this.#locked('revertDiff', async () => {
      const p = this.state.patch; if (!p) return { reverted: false, source: await this.#sourceHash() };
      // Generated files rebuilt after apply are not in the patch, so restore the whole tracked tree from git instead of -R.
      const t0 = nowMs();
      await run('git', ['checkout', '-q', 'HEAD', '--', '.'], { cwd: this.dirs.src }); await run('git', ['clean', '-fdq'], { cwd: this.dirs.src });
      const source = await this.#sourceHash();
      if (source !== 'clean') throw new Error('Source tree not clean after revert');
      this.#save({ patch: null });
      const assets = { restoredFromGit: true, ms: nowMs() - t0 };
      await this.#restartWebIfUp();
      assets.purge = await this.purgeCaches();
      return { reverted: true, source, assets };
    });
  }
  // Generated files are not in the patches (the mining excludes them), so rebuild what the touched sources produce, in a pinned
  // Node container (node_modules is installed once in the shared base and mounted read-only):
  //   amd/src/**.js         -> grunt amd --root=<plugin>        (build/*.min.js)
  //   js/esm/** (.ts/.tsx)  -> grunt esm                        (esm build)
  //   theme/boost/**/*.scss -> grunt sass                       (precompiled boost style/moodle.css; also compiled at runtime from SCSS)
  // Any patch (apply or revert) is followed by purgeCaches(): theme/SCSS, mustache, lang and JS caches would otherwise serve the
  // old code to the first non-Behat page load (the agent arm), because only Behat's own scenario reset purges them.
  async rebuildAssets(files) {
    const t0 = nowMs();
    const roots = [...new Set(files.map(f => /^(.*?)\/amd\/src\//.exec(f)?.[1]).filter(Boolean))];
    const scss = files.filter(f => /\.scss$/.test(f)), theme = files.filter(f => /^public\/theme\//.test(f));
    const esm = files.some(f => /\/js\/esm\/src\//.test(f) || /\.tsx?$/.test(f) && /\/js\/esm\//.test(f));
    const boostScss = scss.some(f => /^public\/theme\/boost\/scss\//.test(f));
    const out = { roots, esm, sass: boostScss, scss, theme: theme.length > 0, ms: 0 };
    const uid = `${process.getuid()}:${process.getgid()}`, node = versions.tools.node;
    const grunt = (...args) => run('docker', ['run', '--rm', '-u', uid, '-e', 'HOME=/tmp', '-v', `${this.dirs.src}:/w`, '-v', `${this.dirs.base}/node_modules:/w/node_modules:ro`, '-w', '/w', node, 'npx', 'grunt', ...args], { timeoutMs: 900000 });
    if (roots.length || esm || boostScss) {
      if (!existsSync(join(this.dirs.base, 'node_modules/.bin/grunt'))) {
        out.npmCi = true;
        await run('docker', ['run', '--rm', '-u', uid, '-e', 'HOME=/tmp', '-v', `${this.dirs.base}:/w`, '-w', '/w', node, 'npm', 'ci', '--no-audit', '--no-fund', '--loglevel=error'], { timeoutMs: 1800000 });
      }
      for (const root of roots) await grunt('amd', `--root=${root}`);
      if (esm) await grunt('esm');
      if (boostScss) await grunt('sass');
    }
    out.ms = nowMs() - t0;
    out.purge = await this.purgeCaches(); return out;
  }
  // Purge all Moodle caches of the Behat site from the CLI (same call Behat's own reset makes). Needs the web container running.
  async purgeCaches() {
    const t0 = nowMs();
    const up = (await run('docker', ['inspect', '-f', '{{.State.Running}}', this.container('webserver')], { check: false })).stdout.trim() === 'true';
    if (!up) return { skipped: 'web container not running', ms: 0 };
    const r = await this.exec('webserver', ['php', '-r', 'define("BEHAT_UTIL", true); define("CLI_SCRIPT", true); define("NO_OUTPUT_BUFFERING", true); require("/var/www/html/config.php"); purge_all_caches(); echo "purged";'], { cwd: '/var/www/html', check: false });
    if (!/purged/.test(r.stdout)) throw new Error('Cache purge failed: ' + (r.stderr || r.stdout).slice(-500));
    return { ms: nowMs() - t0 };
  }
  async #restartWebIfUp() { // new PHP files must be picked up (opcache) and caches are purged by the next Behat reset
    const up = (await run('docker', ['inspect', '-f', '{{.State.Running}}', this.container('webserver')], { check: false })).stdout.trim() === 'true';
    if (up) { await run('docker', ['restart', '-t', '1', this.container('webserver')]); await this.ready(); }
  }

  // ---- resource accounting -------------------------------------------------------------------------------------------
  async stats() {
    const r = await run('docker', ['stats', '--no-stream', '--format', '{{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}', ...['webserver', 'db', 'selenium', 'mailpit'].map(x => this.container(x))], { check: false });
    return r.stdout.trim().split('\n').filter(Boolean).map(l => { const [name, mem, cpu] = l.split('\t'); return { name, mem: mem.split(' / ')[0], cpu }; });
  }
}
