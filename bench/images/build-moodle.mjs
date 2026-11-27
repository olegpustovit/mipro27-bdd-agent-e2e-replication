import { createHash, randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { MoodleAdapter } from '../../adapters/moodle/adapter.mjs';
import { versions } from '../../adapters/moodle/config.mjs';

export async function buildMoodle({ bench, context, readJSON, git, command, docker, build, waitHealthy, record }) {
  const changes = readJSON(join(bench, 'apps/moodle/changes.json')).changes
    .filter(change => change.decision === 'chosen');
  const home = process.env.P2A_MOODLE_CACHE || join(dirname(context), 'moodle');
  const cacheOnly = Boolean(process.env.P2A_MOODLE_CACHE) || process.env.P2A_MOODLE_CACHE_ONLY === '1';
  const skipped = [];

  for (const change of changes) {
    for (const phase of ['pre', 'post']) {
      const commit = change[phase];
      const name = `mdl-${change.id}-${phase}-healthy`.toLowerCase();
      const adapter = new MoodleAdapter({ moodleCommit: commit, home, bind: '127.0.0.1' });
      const metadata = join(adapter.goldenDir(), 'meta.json');
      if (!existsSync(metadata)) {
        if (cacheOnly) {
          skipped.push(name);
          continue;
        }
        if (docker('ps', '-a', '--filter', 'name=^moodle-w0-', '--format', '{{.Names}}')) {
          throw new Error('Moodle seed builder w0 is occupied. Use a completed cache or wait for w0.');
        }
        await adapter.bootstrap();
      }
      const seed = readJSON(metadata);
      const dump = join(adapter.goldenDir(), 'moodle.dump');
      const data = join(adapter.goldenDir(), 'behatdata.tar');
      const sourceRepo = adapter.dirs.base;
      if (seed.key !== adapter.goldenKey() || statSync(dump).size !== seed.sizes.dump ||
          statSync(data).size !== seed.sizes.tar || git('-C', sourceRepo, 'rev-parse', 'HEAD').toString().trim() !== commit) {
        throw new Error(`Moodle seed or source mismatch for ${name}`);
      }

      const pair = join(context, name);
      const dbContext = join(pair, 'db');
      const webContext = join(pair, 'web');
      const source = join(webContext, 'source');
      try {
        mkdirSync(dbContext, { recursive: true });
        mkdirSync(source, { recursive: true });
        cpSync(dump, join(dbContext, 'moodle.dump'));
        cpSync(data, join(webContext, 'behatdata.tar'));
        const archive = join(pair, 'source.tar');
        git('-C', sourceRepo, 'archive', '-o', archive, commit);
        command('tar', ['-xf', archive, '-C', source]);
        cpSync(join(sourceRepo, 'vendor'), join(source, 'vendor'), { recursive: true, verbatimSymlinks: true });
        const config = git('-C', adapter.dirs.dockerRepo, 'show', `${versions.moodleDocker.commit}:config.docker-template.php`);
        const configPath = join(source, 'config.php');
        writeFileSync(configPath, config);
        cpSync(join(bench, '../docker/moodle/behat'), join(webContext, 'study-behat'), { recursive: true });
        const docroot = existsSync(join(source, 'public/index.php')) ? '/var/www/html/public' : '/var/www/html';
        const dbPin = await build(`${name}-db`, 'moodle-db.Dockerfile', dbContext,
          ['--build-arg', `DB_IMAGE=${versions.images.db}`]);
        const appPin = await build(name, 'moodle.Dockerfile', webContext,
          ['--build-arg', `WEB_IMAGE=${versions.images.webserver}`, '--build-arg', `DOCROOT=${docroot}`]);
        const first = await smokeMoodle(appPin, dbPin, docker, waitHealthy);
        const second = await smokeMoodle(appPin, dbPin, docker, waitHealthy);
        if (first.seedSha256 !== second.seedSha256) throw new Error(`Moodle seed mismatch for ${name}`);
        record(name, appPin, dbPin, { ...first, secondStartupMs: second.startupMs });
      } finally {
        rmSync(pair, { recursive: true, force: true });
      }
    }
  }
  if (skipped.length) throw new Error(`Moodle seed cache missing ${skipped.join(', ')}`);
}

export async function smokeMoodle(app, db, docker, waitHealthy, subnet) {
  const name = `p2a-mdl-${randomUUID()}`;
  const network = await docker('network', 'create', '--internal', ...(subnet ? ['--subnet', subnet] : []), name);
  const containers = [];
  try {
    const dbID = await docker('create', '--network', network, '--network-alias', 'db', db.digest);
    containers.push(dbID);
    const webID = await docker('create', '--network', network, '--network-alias', 'webserver', app.digest);
    containers.push(webID);
    const start = performance.now();
    await docker('start', dbID);
    const dbStartupMs = await waitHealthy(dbID, db.ref, start, 90_000);
    // Sample before the first HTTP request creates sessions or warms caches.
    const dump = (await docker('exec', dbID, 'pg_dump', '-U', 'moodle', 'moodle'))
      .split('\n').filter(line => !/^\\(?:un)?restrict /.test(line)).join('\n');
    const seedSha256 = createHash('sha256').update(dump).digest('hex');
    const webStart = performance.now();
    await docker('start', webID);
    const webStartupMs = await waitHealthy(webID, app.ref, webStart, 90_000);
    return { startupMs: dbStartupMs + webStartupMs, dbStartupMs, webStartupMs, seedSha256 };
  } finally {
    for (const id of containers.reverse()) await docker('rm', '-f', '-v', id);
    await docker('network', 'rm', network);
  }
}
