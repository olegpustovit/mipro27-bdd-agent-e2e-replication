import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { smokeMoodle } from './build-moodle.mjs';

export async function buildMoodleBugs({ bench, context, git, command, docker, build, waitHealthy, record, lock, startup, requested }) {
  const revision = git('rev-parse', 'HEAD').toString().trim();
  const committed = path => git('show', `${revision}:bench/${path}`);
  const changes = JSON.parse(committed('apps/moodle/changes.json')).changes;
  const posts = new Map(changes.filter(change => change.decision === 'chosen').map(change => [change.id, change.post]));
  const paths = git('ls-tree', '--full-tree', '-r', '--name-only', revision, '--', 'bench/bugs')
    .toString().trim().split('\n');
  const bugs = paths.map(path => /^bench\/bugs\/(mdl-(B\d+)-S\d+)\/patch\.diff$/.exec(path)).filter(Boolean);
  if (bugs.length !== 19) throw new Error(`Expected 19 committed Moodle patches, got ${bugs.length}`);
  const selected = requested.length ? bugs.filter(([, id]) => requested.includes(id)) : bugs;
  if (requested.length && selected.length !== requested.length) throw new Error('Expected distinct committed Moodle bug IDs');
  const jobs = Number(process.env.P2A_BUILD_JOBS ?? '2');
  const subnet = process.env.P2A_MOODLE_SMOKE_SUBNET;
  if (!Number.isSafeInteger(jobs) || jobs < 1) throw new Error('P2A_BUILD_JOBS must be a positive integer');
  if (subnet && jobs !== 1) throw new Error('Set P2A_BUILD_JOBS=1 to reuse one smoke-test subnet');

  for (let offset = 0; offset < selected.length; offset += jobs) {
    const results = await Promise.allSettled(selected.slice(offset, offset + jobs).map(buildBug));
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length) throw new Error(failures.map(result => result.reason.message).join('\n'));
  }

  async function buildBug([, id, change]) {
    const commit = posts.get(change);
    const folder = `bugs/${id}`;
    const appliesTo = JSON.parse(committed(`${folder}/applies-to.json`));
    if (!commit || appliesTo.length !== 1 || appliesTo[0] !== commit) {
      throw new Error(`${id} must target its selected post-change commit`);
    }
    const key = `mdl-${change.toLowerCase()}-post-healthy`;
    const app = lock.images.app[key];
    const db = lock.images.db[key];
    const seed = startup[key]?.seedSha256;
    if (!app || !db || !/^[a-f0-9]{64}$/.test(seed)) throw new Error(`Missing healthy pins or seed for ${key}`);
    const patch = committed(`${folder}/patch.diff`);
    const fixture = join(context, id);
    const overlay = join(fixture, 'overlay');
    mkdirSync(overlay, { recursive: true });
    try {
      const apply = (...flags) => command('git', ['apply', '--no-index', ...flags, '-'], {
        cwd: overlay, env: { ...process.env, GIT_CEILING_DIRECTORIES: fixture },
        input: patch, stdio: ['pipe', 'pipe', 'inherit'],
      });
      const files = apply('--numstat', '-z').toString().split('\0').filter(Boolean)
        .map(line => line.split('\t')[2]);
      if (!files.length || files.some(file => !file || !/^[a-zA-Z0-9_./-]+$/.test(file) ||
          file.startsWith('/') || file.split('/').includes('..'))) {
        throw new Error(`Unexpected patch paths for ${id}`);
      }
      // Take the unpatched files from the locked healthy image, which holds this commit's code.
      const source = await docker('create', app.digest);
      try {
        for (const file of files) {
          mkdirSync(dirname(join(overlay, file)), { recursive: true });
          await docker('cp', `${source}:/var/www/html/${file}`, join(overlay, file));
        }
      } finally {
        await docker('rm', '-f', source);
      }
      apply();
      if (files.some(file => !existsSync(join(overlay, file)))) {
        throw new Error(`Moodle image overlays require existing files for ${id}`);
      }
      if (await docker('image', 'inspect', '--format', '{{.Id}}', app.ref) !== app.digest) {
        throw new Error(`Healthy web image differs from the lock for ${key}`);
      }
      const pin = await build(id.toLowerCase(), 'moodle-bug.Dockerfile', fixture,
        ['--build-arg', `MOODLE_WEB=${app.ref}`]);
      const first = await smokeMoodle(pin, db, docker, waitHealthy, subnet);
      const second = await smokeMoodle(pin, db, docker, waitHealthy, subnet);
      if (first.seedSha256 !== seed || second.seedSha256 !== seed) {
        throw new Error(`Moodle seed differs from the healthy post-change seed for ${id}`);
      }
      record(id, pin, db, { ...first, secondStartupMs: second.startupMs });
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  }
}
