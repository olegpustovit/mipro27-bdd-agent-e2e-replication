import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const bench = fileURLToPath(new URL('../', import.meta.url));

function run(command, ...args) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 60_000 });
  if (result.error) throw result.error;
  return result;
}

test('P1 environment lock', async t => {
  const fixture = mkdtempSync(join(tmpdir(), 'p1-lock-check-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const workspace = join(fixture, 'bench');
  mkdirSync(workspace);
  for (const path of ['Makefile', 'mk', 'plan', 'tools']) {
    cpSync(join(bench, path), join(workspace, path), { recursive: true });
  }
  symlinkSync(join(bench, '../node_modules'), join(fixture, 'node_modules'), 'dir');

  const prompt = join(workspace, 'prompt');
  mkdirSync(prompt);
  writeFileSync(join(prompt, 'template.md'), 'Fixture template.\n');
  writeFileSync(join(prompt, 'glossary.md'), 'Fixture glossary.\n');

  const lock = JSON.parse(readFileSync(join(bench, 'env.lock.json'), 'utf8'));
  const hash = run(join(workspace, 'tools/lock-check'), '--print-prompt-sha256');
  assert.equal(hash.status, 0, hash.stderr);
  lock.promptSha256 = hash.stdout.trim();

  const ref = 'node:22-bookworm-slim';
  const image = run('docker', 'image', 'inspect', '--format', '{{.Id}}', ref);
  assert.equal(image.status, 0, image.stderr);
  const pin = { ref, digest: image.stdout.trim() };
  lock.images = { app: { fixture: pin }, db: { fixture: pin }, browser: pin, agent: pin };

  const writeLock = value => writeFileSync(join(workspace, 'env.lock.json'), JSON.stringify(value));
  const makeCheck = () => run('make', '-C', workspace, 'lock-check');
  writeLock(lock);

  await t.test('make lock-check passes on a matching host', t => {
    const result = makeCheck();
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes('lock-check: all environment pins match'));
    t.diagnostic(result.stdout.split('\n').find(line => line.startsWith('lock-check:')));
  });

  await t.test('all changed pins are rejected and named', async t => {
    const fields = [
      'node', 'playwright', 'playwrightMcp', 'codexCli',
      ...Object.keys(lock.models).flatMap(arm => [`models.${arm}.id`, `models.${arm}.effort`]),
      'promptSha256', 'images.app.fixture.digest', 'images.db.fixture.digest',
      'images.browser.digest', 'images.agent.digest', 'images.browser.ref',
    ];
    for (const field of fields) {
      await t.test(field, t => {
        const mismatch = JSON.parse(JSON.stringify(lock));
        const parts = field.split('.');
        const key = parts.pop();
        const parent = parts.reduce((value, part) => value[part], mismatch);
        parent[key] = field === 'promptSha256' ? '0'.repeat(64)
          : key === 'digest' ? `sha256:${'0'.repeat(64)}`
            : 'mismatching-value';
        writeLock(mismatch);
        const result = makeCheck();
        const diagnostic = `lock-check: ${field}:`;
        assert.equal(result.status, 2);
        assert.ok(result.stderr.includes(diagnostic), result.stderr);
        t.diagnostic(result.stderr.split('\n').find(line => line.startsWith(diagnostic)));
      });
    }
  });

  await t.test('runner guard refuses to start when the prompt has drifted', t => {
    writeLock(lock);
    const marker = join(fixture, 'runner-started');
    const launch = () => run(join(workspace, 'tools/with-lock'), 'touch', marker);
    const matching = launch();
    assert.equal(matching.status, 0, matching.stderr);
    assert.ok(existsSync(marker));
    rmSync(marker);

    writeFileSync(join(prompt, 'glossary.md'), 'Changed fixture glossary.\n');
    const result = launch();
    assert.equal(result.status, 1, result.stderr);
    assert.ok(result.stderr.includes('lock-check: promptSha256:'), result.stderr);
    assert.equal(existsSync(marker), false);
    t.diagnostic('lock-check: promptSha256 mismatch, runner start marker absent');
  });
});
