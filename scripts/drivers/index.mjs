// Agent-CLI driver interface. Every driver exposes:
//   name                    'codex' | 'omp' | ...
//   model                   requested model id
//   async version()         the CLI's own version string (omp: `omp --version`)
//   async systemPromptHash()  { hash, source } for the system prompt when readable before a run, else null
//   prepare({endpoint, prompt, check})  -> { command, args, cleanup, home }  sandboxed invocation
//   usage(events)           canonical meter fields (scripts/ledger/metering.mjs), unknown = null
//   systemPromptFromEvents(events) -> string | null     prompt actually sent, when the CLI echoes it
//   requestIds(events)      provider request/response ids seen in the event stream ([] when none)
//   async frozenInputs()    { driver, cliVersion, model, systemPromptHash, systemPromptHashSource }
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const run = promisify(execFile);
export const hashText = text => createHash('sha256').update(text).digest('hex');
export async function cliVersion(command) {
  const { stdout, stderr } = await run(command, ['--version'], { timeout: 10000 });
  const text = (stdout || stderr).trim();
  if (!text) throw new Error(`${command} --version printed nothing`);
  return text;
}
const ID_KEYS = new Set(['request_id', 'requestId', 'response_id', 'responseId', 'x-request-id', 'x_request_id']);
export function collectRequestIds(events) {
  const ids = new Set();
  const walk = (v, depth) => {
    if (!v || typeof v !== 'object' || depth > 6) return;
    for (const [k, x] of Object.entries(v)) { if (ID_KEYS.has(k) && typeof x === 'string' && x) ids.add(x); else walk(x, depth + 1); }
  };
  for (const e of events) walk(e, 0);
  return [...ids];
}
export function base(driver) {
  return {
    requestIds: collectRequestIds,
    async frozenInputs() {
      const prompt = await driver.systemPromptHash();
      return { driver: driver.name, cliVersion: await driver.version(), model: driver.model, systemPromptHash: prompt?.hash ?? null, systemPromptHashSource: prompt?.source ?? 'unavailable' };
    },
    ...driver,
  };
}
export async function loadDriver(spec, baseDir = process.cwd()) {
  if (typeof spec === 'string') {
    if (spec === 'codex') return (await import('./codex.mjs')).createDriver();
    if (spec === 'claude-code') return (await import('./claude-code.mjs')).createDriver();
    if (spec === 'omp') return (await import('./omp.mjs')).createDriver();
    throw new Error(`Unknown driver ${spec}; built-in drivers are codex, omp, and claude-code (or give {"module": path})`);
  }
  if (spec?.module) {
    const path = isAbsolute(spec.module) ? spec.module : resolve(baseDir, spec.module);
    return base(await (await import(pathToFileURL(path).href)).createDriver(spec.options ?? {}));
  }
  throw new Error('Invalid driver spec');
}
// Pick the built-in driver for a model id: claude-* runs through omp, everything else through codex.
export const driverNameForModel = model => process.env.STUDY_DRIVER || (model.startsWith('claude-') ? 'omp' : 'codex');
