import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { environmentFingerprint } from './environment.mjs';
import { appPins, sha256 } from './campaign-guard.mjs';
import { claimAppStartup } from './app-ownership.mjs';
const app = fileURLToPath(new URL('../upstream/cypress-realworld-app/', import.meta.url));
if (!readFileSync(`${app}backend/app.ts`, 'utf8').includes('app.listen(Number(port), "127.0.0.1");')) {
  throw new Error('Run bootstrap before starting the application');
}
// Database seeding belongs to acknowledged scenario reset, under its lease.
// Startup must never overwrite the mutable database of another running app.
const ownership = claimAppStartup();
let startupEnvironment, startupApp;
try { startupEnvironment = await environmentFingerprint(); startupApp = appPins(); }
catch (error) { ownership.closed(); throw error; }
const wrapperSHA = sha256(readFileSync(fileURLToPath(import.meta.url))), prefix = '/' + randomBytes(24).toString('hex');
const env = { ...process.env, NODE_ENV: 'development', PORT: '3000', VITE_BACKEND_PORT: '3001' };
const children = [
  spawn(`${app}node_modules/.bin/vite`, ['--host', '127.0.0.1', '--strictPort'], { cwd: app, env, stdio: 'inherit' }),
  spawn(`${app}node_modules/.bin/ts-node`, ['-P', 'tsconfig.tsnode.json', '--files', 'backend/app.ts'], { cwd: app, env, stdio: 'inherit' }),
];
const commandHash = pid => { try { return sha256(readFileSync(`/proc/${pid}/cmdline`)); } catch { return null; } };
let commands;
const provenance = createServer((request, response) => {
  if (request.url !== prefix) { response.writeHead(404).end(); return; }
  if (!commands) { response.writeHead(503).end(); return; }
  const processes = children.map((child, index) => ({ pid: child.pid, alive: child.exitCode === null && child.signalCode === null,
    commandUnchanged: commands[index] !== null && commands[index] === commandHash(child.pid) }));
  response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ wrapperPID: process.pid, wrapperSHA, startupEnvironment, startupApp, children: processes }));
});
await new Promise((resolve, reject) => provenance.listen(0, '127.0.0.1', resolve).once('error', reject));
let stopping = false;
let closedChildren = 0;
function stop(code) {
  if (stopping) return;
  stopping = true;
  provenance.close();
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
  setTimeout(() => { for (const child of children) child.kill('SIGKILL'); }, 5000).unref();
}
for (const child of children) {
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', code => { if (!stopping) stop(code || 1); });
  child.on('close', () => { if (++closedChildren === children.length) ownership.closed(); });
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
try {
  const deadline = Date.now() + 30000;
  for (const url of ['http://127.0.0.1:3000/', 'http://127.0.0.1:3001/health']) {
    while (true) {
      if (stopping) throw new Error('Application startup stopped');
      try { const response = await fetch(url, { signal: AbortSignal.timeout(1000) }); if (response.status < 500) break; } catch {}
      if (Date.now() >= deadline) throw new Error('Application readiness exceeded 30000ms');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  if (children.some(child => child.exitCode !== null || child.signalCode !== null)) throw new Error('Owned application child exited during startup');
  // Child wrappers can exec and change cmdline while starting. Pin the ready processes.
  commands = children.map(child => commandHash(child.pid));
  if (commands.some(hash => !hash)) throw new Error('Cannot pin ready application child command');
  ownership.ready();
  console.log(JSON.stringify({ type: 'fixture-provenance-ready', url: `http://127.0.0.1:${provenance.address().port}${prefix}`, startupEnvironment, startupApp }));
} catch (error) { console.error(error.message); stop(1); }
