// Runtime images per replay build (plan.md amendment A1). 'pin' = docker/moodle/versions.json unchanged (campaign environment).
// 'm40' = Moodle 4.0dev builds: PHP 8.0 webserver and Postgres 13, pinned by digest; everything else as in versions.json.
// Only these fields of the adapter's shared `versions` object are overridden, before the adapter is constructed (goldenKey includes them).
import { join } from 'node:path';
export const RUNTIMES = {
  pin: null,
  m40: {
    php: '8.0', dbVersion: '13',
    webserver: 'moodlehq/moodle-php-apache@sha256:2964e59ac5a24e9d7004d463e3082db660ced4926015d7032526157c8e05bb85',
    db: 'postgres@sha256:4689940c683801b4ab839ab3b0a0a3555a5fe425371422310944e89eca7d8068',
  },
};
export const RUNTIME_OF = { B04: 'pin', B07: 'pin', B15: 'pin', B25: 'm40', B27: 'm40', B28: 'm40', B29: 'm40' };
export async function applyRuntime(repo, name) {
  const { versions } = await import(join(repo, 'adapters/moodle/config.mjs'));
  const r = RUNTIMES[name]; if (r === undefined) throw new Error(`unknown runtime ${name}`);
  if (r) { versions.php = r.php; versions.db = { ...versions.db, version: r.dbVersion }; versions.images = { ...versions.images, webserver: r.webserver, db: r.db }; }
  return { runtime: name, php: versions.php, db: versions.db, images: versions.images };
}
