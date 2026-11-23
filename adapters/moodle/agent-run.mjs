// Run one sandboxed agent CLI process (omp for claude-* models, codex otherwise) against an MCP endpoint and return what it said,
// what it cost and how long it took. Used by the browser arm (C) and the arm-B repair agent. The model is fixed per process because
// scripts/codex-boundary.mjs reads STUDY_MODEL at import: set it before the first call (see `useModel`).
import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { collectRequestIds } from '../../scripts/drivers/index.mjs';
import { waitForOutput } from '../../scripts/subprocess.mjs';

let boundary;
export async function useModel(model) {
  // Codex path: the sandbox copies ~/.codex/auth.json; fail early and clearly when Codex is not logged in.
  if (driverFor(model) === 'codex' && !existsSync(join(homedir(), '.codex/auth.json'))) throw new Error(`Codex is not logged in on this host (~/.codex/auth.json missing); run \`codex login\` before using ${model}`);
  if (boundary) { if (boundary.requestedModel !== model) throw new Error(`Process already bound to ${boundary.requestedModel}; one model per process`); return boundary; }
  process.env.STUDY_MODEL = model;
  boundary = await import('../../scripts/codex-boundary.mjs');
  if (boundary.requestedModel !== model) throw new Error(`Boundary pinned ${boundary.requestedModel}, wanted ${model}`);
  return boundary;
}
export const driverFor = model => model.startsWith('claude-') ? 'omp' : 'codex';

// Parse the CLI's JSON event lines into { result, usage, costUsd, providerError, models, modelMs }.
export function summarizeEvents(events, boundaryMod) {
  const out = { result: null, usage: null, costUsd: null, providerError: null, models: new Set(), modelMs: null, assistantMessages: 0 };
  for (const e of events) {
    if (e.message?.model) out.models.add(e.message.model);
    if (e.type === 'item.completed' && e.item?.type === 'agent_message') out.result = e.item.text;                 // codex
    if (e.type === 'turn.completed' && e.usage) out.usage = e.usage;
    if (e.type === 'agent_end') {                                                                                   // omp
      const messages = e.messages || [], { usage, cost } = boundaryMod.ompUsage(messages), end = boundaryMod.ompFinal(messages);
      out.usage = usage; out.costUsd = cost; out.result = end.result ?? null; out.providerError = end.error ?? null;
      const assistants = messages.filter(m => m.role === 'assistant'); out.assistantMessages = assistants.length;
      for (const m of assistants) if (m.model) out.models.add(m.model);
      const durations = assistants.map(m => m.duration).filter(Number.isFinite); out.modelMs = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0)) : null;
    }
  }
  return out;
}

export async function runAgentProcess({ model, endpoint, prompt, timeoutMs, cwd }) {
  const b = await useModel(model), prepared = b.prepareBoundary({ endpoint, prompt });
  const began = performance.now(), events = [], raw = []; let child, timedOut = false, stderr = '', bytes = 0;
  const kill = sig => { if (child?.pid) try { process.kill(-child.pid, sig); } catch {} };
  try {
    child = spawn(prepared.command, prepared.args, { cwd: cwd ?? prepared.directory, env: { PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => { bytes += line.length; if (bytes > 20e6) { kill('SIGKILL'); return; } raw.push(line); try { events.push(JSON.parse(line)); } catch {} });
    child.stderr.on('data', d => { stderr += d; if (stderr.length > 1e6) kill('SIGKILL'); });
    const timer = setTimeout(() => { timedOut = true; kill('SIGTERM'); setTimeout(() => kill('SIGKILL'), 3000).unref(); }, timeoutMs);
    const { code, signal } = await waitForOutput(child, { lines, onExit: () => clearTimeout(timer), onDrainTimeout: () => kill('SIGKILL') }).finally(() => clearTimeout(timer));
    const sum = summarizeEvents(events, b);
    return { code, signal, timedOut, elapsedMs: Math.round(performance.now() - began), model, driver: driverFor(model), ...sum, models: [...sum.models], requestIds: collectRequestIds(events), stderrTail: stderr.slice(-800), rawEvents: raw.join('\n') };
  } finally { kill('SIGKILL'); prepared.cleanup(); }
}

// Isolation self-check, once per process: the same bwrap invocation with a command that fails if the owner's home, the repository or the
// study data directory is visible. Returns what the sandbox actually enforced, so every agent trial can carry it.
let isolation;
export async function isolationCheck(model) {
  if (isolation) return isolation;
  const b = await useModel(model), p = b.prepareBoundary({ endpoint: 'http://127.0.0.1:1/mcp', prompt: 'x', check: true });
  try { const out = execFileSync(p.command, p.args, { encoding: 'utf8', timeout: 30000 }).trim(); isolation = { ok: /PRIVATE_PATHS_ABSENT/.test(out), output: out.slice(-200), mechanism: 'sudo -n bwrap (unshare pid/ipc/uts, ro /usr /lib /nix, tmpfs /tmp, setpriv: no new privs, empty bounding set, HOME=/agent in a temp dir, cleared env)', network: 'host network namespace shared (needed for the MCP endpoint on loopback and the model API)' }; }
  catch (e) { isolation = { ok: false, error: String(e.stderr || e.message).slice(0, 300) }; }
  finally { p.cleanup(); }
  return isolation;
}
