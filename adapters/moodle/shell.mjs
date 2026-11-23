import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';

// Run a command; resolves {code, stdout, stderr}. Rejects on nonzero exit unless check:false.
export function run(command, args = [], { env, cwd, input, check = true, timeoutMs = 600000, stdoutFile, onLine, hash, filterLine } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: env ? { ...process.env, ...env } : process.env, cwd, stdio: [input !== undefined || input === null ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false, buffer = '';
    const sink = stdoutFile ? createWriteStream(stdoutFile) : null;
    const digest = hash ? createHash('sha256') : null;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', chunk => {
      if (sink) sink.write(chunk);
      else if (digest) {
        buffer += chunk;
        const lines = buffer.split('\n'); buffer = lines.pop();
        for (const line of lines) if (!filterLine || filterLine(line)) digest.update(line + '\n');
      } else { stdout += chunk; if (onLine) { buffer += chunk; const lines = buffer.split('\n'); buffer = lines.pop(); lines.forEach(onLine); } }
    });
    child.stderr.on('data', chunk => { stderr += chunk; if (stderr.length > 2e6) stderr = stderr.slice(-1e6); });
    child.on('error', reject);
    child.on('close', async (code, signal) => {
      clearTimeout(timer);
      if (digest && buffer && (!filterLine || filterLine(buffer))) digest.update(buffer);
      if (sink) await new Promise(r => sink.end(r));
      const result = { code, signal, stdout, stderr, timedOut, sha256: digest?.digest('hex') };
      if (check && (code !== 0 || timedOut)) reject(new Error(`${command} ${args.slice(0, 6).join(' ')} failed (code=${code}${timedOut ? ', timeout' : ''}): ${(stderr || stdout).slice(-1500)}`));
      else resolve(result);
    });
    if (input !== undefined && input !== null) child.stdin.end(input); else if (input === null) child.stdin.end();
  });
}
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function until(label, probe, { timeoutMs = 120000, everyMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs; let last;
  while (Date.now() < deadline) { try { const v = await probe(); if (v) return v; } catch (e) { last = e; } await sleep(everyMs); }
  throw new Error(`Timed out waiting for ${label}${last ? ': ' + last.message : ''}`);
}
