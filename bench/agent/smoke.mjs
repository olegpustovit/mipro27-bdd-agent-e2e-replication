import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const path = value => fileURLToPath(new URL(value, import.meta.url));
const page = await readFile(path('./fixtures/page.html'));
const server = createServer((req, res) => {
  if (req.url === '/') res.writeHead(200, { 'content-type': 'text/html' }).end(page);
  else res.writeHead(404).end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const out = await mkdtemp(join(tmpdir(), 'p3c-smoke-'));
console.log('Trace directory', out);
try {
  const child = spawn(path('./run'), ['--item', path('./fixtures/item.json'), '--out', out], {
    env: { ...process.env, BENCH_APP_URL: `http://127.0.0.1:${server.address().port}/`,
      BENCH_SCENARIO_FILE: path('./fixtures/scenario.feature') },
    stdio: 'inherit',
  });
  const code = await new Promise(resolve => child.once('exit', resolve));
  const answer = JSON.parse(await readFile(join(out, 'answer.json'), 'utf8'));
  console.log(JSON.stringify(answer));
  assert.equal(code, 0);
  assert.equal(answer.status, 'pass');
  assert(answer.tokens.input > 0 && answer.tokens.output > 0);
  assert(answer.tool_calls >= 2);
} finally {
  server.close();
}
