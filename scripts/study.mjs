#!/usr/bin/env node
// Study run ledger CLI. See docs/contracts/ledger.md.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { ledgerPaths, ensureDirs } from './ledger/paths.mjs';
import { freezePlan, startTask, resumeTask, cancelTask, statusRows, formatStatus, execTask } from './ledger/tasks.mjs';

export function splitCommand(text) {
  const out = []; let cur = '', quote = null, has = false;
  for (const ch of text) {
    if (quote) { if (ch === quote) quote = null; else cur += ch; }
    else if (ch === '"' || ch === "'") { quote = ch; has = true; }
    else if (/\s/.test(ch)) { if (cur || has) out.push(cur); cur = ''; has = false; }
    else cur += ch;
  }
  if (quote) throw new Error('Unterminated quote in --cmd');
  if (cur || has) out.push(cur);
  return out;
}
function parse(argv) {
  const pos = [], flags = {}; let rest = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { rest = argv.slice(i + 1); break; }
    if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split(/=(.*)/s);
      if (['json'].includes(k)) flags[k] = true; else flags[k] = inline ?? argv[++i];
    } else pos.push(a);
  }
  return { pos, flags, rest };
}
const USAGE = `usage:
  study plan freeze <manifest.json>
  study task start <key> [--plan <name> --cmd "<command>" | -- <argv...>] [--reason <text>]
  study task resume <key>
  study task status [key] [--json]
  study task cancel <key> --reason <text>`;

export async function main(argv = process.argv.slice(2)) {
  const { pos, flags, rest } = parse(argv), [group, verb, arg] = pos;
  const paths = ensureDirs(ledgerPaths());
  if (group === 'plan' && verb === 'freeze' && arg) {
    const r = await freezePlan(resolve(arg), { paths });
    // One JSON line for the orchestrator to mirror into Foundry (this CLI does not write to Foundry).
    console.log(JSON.stringify({ type: 'plan-frozen', ...r, ledger: paths.tasks, frozenAt: new Date().toISOString() }));
    return 0;
  }
  if (group === 'task' && verb === 'start' && arg) {
    const cmd = rest?.length ? rest : flags.cmd ? splitCommand(flags.cmd) : null;
    const r = await startTask({ key: arg, plan: flags.plan, cmd, reason: flags.reason, paths });
    console.log(`started ${r.key} attempt ${r.attempt} as unit ${r.unit} (${r.launcher})`);
    return 0;
  }
  if (group === 'task' && verb === 'resume' && arg) {
    const r = await resumeTask({ key: arg, paths });
    console.log(`resumed ${r.key} attempt ${r.attempt} as unit ${r.unit} (${r.launcher})`);
    return 0;
  }
  if (group === 'task' && verb === 'status') {
    const rows = statusRows(paths, arg ?? null);
    if (arg && !rows.length) throw new Error(`Unknown task ${arg}`);
    console.log(flags.json ? JSON.stringify(rows, null, 2) : rows.length ? formatStatus(rows) : 'no tasks');
    return 0;
  }
  if (group === 'task' && verb === 'cancel' && arg) {
    const t = await cancelTask({ key: arg, reason: flags.reason, paths });
    console.log(`${t.key}: ${t.state}`);
    return 0;
  }
  if (group === 'task' && verb === 'exec' && arg) return execTask({ key: arg, attempt: Number(flags.attempt), paths });
  console.error(USAGE);
  return 64;
}
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => process.exit(code), error => { console.error(`study: ${error.message}`); process.exit(2); });
}
