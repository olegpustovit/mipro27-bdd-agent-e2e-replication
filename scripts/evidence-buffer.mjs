import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';

// Ephemeral transport only: stdout/stderr remain in bounded process memory
// until a caller attaches them through Foundry MCP and acknowledges the hash.
// This process has no Foundry credentials and writes no evidence files.
const separator = process.argv.indexOf('--');
const command = separator >= 0 ? process.argv.slice(separator + 1) : [];
if (!command.length) throw new Error('Usage: node scripts/evidence-buffer.mjs -- command [args...]');
const pageBytes = 24 * 1024;
const highWater = Number(process.env.STUDY_EVIDENCE_BUFFER_BYTES || 16 * 1024 * 1024);
if (!Number.isSafeInteger(highWater) || highWater < 65536 || highWater > 32 * 1024 * 1024) throw new Error('Evidence buffer must be an integer from 64 KiB through 32 MiB');
const queue = [];
let queuedBytes = 0, sequence = 0, producedBytes = 0, acknowledgedBytes = 0;
let child = null, result = null, fault = null;
const prefix = `/${randomBytes(24).toString('hex')}`;
const hash = body => createHash('sha256').update(body).digest('hex');
const server = createServer(async (request, response) => {
  const reply = (status, body) => { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(body)); };
  const route = new URL(request.url, 'http://127.0.0.1').pathname;
  if (!route.startsWith(`${prefix}/`)) { reply(404, { error: 'not found' }); return; }
  if (request.method === 'GET' && route === `${prefix}/status`) {
    reply(200, { queuedChunks: queue.length, queuedBytes, producedBytes, acknowledgedBytes, firstSequence: queue[0]?.sequence ?? sequence, nextSequence: sequence, paused: queuedBytes >= highWater, result, fault }); return;
  }
  if (request.method === 'GET' && route === `${prefix}/chunk`) { reply(queue.length ? 200 : 204, queue[0] || {}); return; }
  if (request.method === 'GET' && route.startsWith(`${prefix}/chunk/`)) {
    const raw = route.slice(`${prefix}/chunk/`.length);
    if (!/^(0|[1-9][0-9]*)$/.test(raw) || !Number.isSafeInteger(Number(raw))) { reply(400, { error: 'invalid sequence' }); return; }
    const requested = Number(raw), item = queue.find(entry => entry.sequence === requested);
    if (item) reply(200, item);
    else if (requested >= sequence) reply(204, {});
    else reply(410, { error: 'sequence already acknowledged' });
    return;
  }
  if (request.method === 'POST' && route === `${prefix}/ack`) {
    let body = ''; for await (const part of request) { body += part; if (body.length > 256) { reply(413, { error: 'ack too large' }); return; } }
    let ack; try { ack = JSON.parse(body); } catch { reply(400, { error: 'invalid ack' }); return; }
    if (!queue.length || ack.sequence !== queue[0].sequence || ack.sha256 !== queue[0].sha256) { reply(409, { error: 'ack must match oldest chunk and its exact hash' }); return; }
    const item = queue.shift(); queuedBytes -= item.bytes; acknowledgedBytes += item.bytes;
    if (queuedBytes < highWater / 2) { child?.stdout.resume(); child?.stderr.resume(); }
    reply(200, { acknowledged: item.sequence }); return;
  }
  if (request.method === 'POST' && route === `${prefix}/close`) {
    if (!result || queue.length) { reply(409, { error: 'drain evidence and wait for child completion first' }); return; }
    reply(200, { closed: true }); server.close(); return;
  }
  reply(405, { error: 'unsupported request' });
});
await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
process.stdout.write(`${JSON.stringify({ type: 'evidence-buffer-ready', url: `http://127.0.0.1:${server.address().port}${prefix}` })}\n`);
child = spawn(command[0], command.slice(1), { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
function retain(stream, data) {
  // Base64 preserves exact stream bytes even when a multibyte UTF-8 sequence
  // crosses a process-pipe or page boundary. Reassemble before parsing NDJSON.
  for (let offset = 0; offset < data.length; offset += pageBytes) {
    const body = data.subarray(offset, offset + pageBytes);
    queue.push({ sequence: sequence++, stream, bytes: body.length, sha256: hash(body), content_base64: body.toString('base64') });
    queuedBytes += body.length; producedBytes += body.length;
  }
  if (queuedBytes >= highWater) { child.stdout.pause(); child.stderr.pause(); }
}
child.stdout.on('data', data => retain('stdout', data));
child.stderr.on('data', data => retain('stderr', data));
child.on('error', error => { fault = error.message; result = { code: null, signal: null, error: fault }; });
child.on('close', (code, signal) => { result = { code, signal, error: fault }; });
