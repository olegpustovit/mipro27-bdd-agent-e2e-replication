import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { versions } from '../../../adapters/moodle/config.mjs';

const [composerPath] = process.argv.slice(2);
if (!composerPath) throw new Error('Usage: node verify-platform.mjs /path/to/pinned/composer.phar');
const composer = realpathSync(composerPath);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(sha256(readFileSync(composer)), versions.composer.sha256, 'Composer checksum');
const constraints = JSON.parse(readFileSync(new URL('./runtime-incompatibilities.json', import.meta.url)));
const check = await Promise.all(Object.entries(constraints).map(async ([id, row]) => {
  const response = await fetch(`https://raw.githubusercontent.com/moodle/moodle/${row.commit}/${row.file}`, {
    signal: AbortSignal.timeout(30_000),
  });
  assert.ok(response.ok, `${id} lockfile HTTP status ${response.status}`);
  const lock = await response.text();
  assert.equal(sha256(lock), row.sha256, `${id} lockfile checksum`);
  const packages = JSON.parse(lock);
  const dep = [...packages.packages, ...packages['packages-dev']].find(item => item.name === row.package);
  assert.equal(dep.version, row.version, `${id} locked dependency version`);
  assert.equal(dep.require.php, row.requiresPhp, `${id} locked PHP dependency`);
  return [id, row.requiresPhp];
}));
const code = `
require "phar:///composer.phar/vendor/autoload.php";
echo PHP_VERSION, PHP_EOL;
foreach (json_decode(stream_get_contents(STDIN), true) as [$id, $constraint]) {
    if (Composer\\Semver\\Semver::satisfies(PHP_VERSION, $constraint)) {
        fwrite(STDERR, "$id is compatible with PHP " . PHP_VERSION . PHP_EOL);
        exit(1);
    }
}
`;
const docker = spawnSync('docker', ['run', '--rm', '-i', '--network', 'none',
  '-v', `${composer}:/composer.phar:ro`, '--entrypoint', 'php', versions.images.webserver, '-r', code],
{ input: JSON.stringify(check), encoding: 'utf8', timeout: 60_000 });
if (docker.error) throw docker.error;
assert.equal(docker.status, 0, docker.stderr);
assert.match(docker.stdout.trim(), /^8\.3\./);
console.log(`${check.length}/${check.length} pre-change Composer lockfiles block PHP ${docker.stdout.trim()}`);
