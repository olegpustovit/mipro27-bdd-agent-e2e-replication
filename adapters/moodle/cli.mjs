#!/usr/bin/env node
// Usage: node adapters/moodle/cli.mjs <command> [--worker w1] [--moodle-commit <sha>] [args]
import { MoodleAdapter } from './adapter.mjs';
import { run } from './shell.mjs';
import { runScenario } from './behat-runner.mjs';
import { prepareForAgent } from './handoff.mjs';
import { scriptedLoginSmoke } from './scripted-smoke.mjs';
const [command, ...rest] = process.argv.slice(2);
const opt = (name, fallback) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : fallback; };
const bind = process.env.STUDY_MOODLE_BIND || (await run('docker', ['network', 'inspect', 'bridge', '--format', '{{(index .IPAM.Config 0).Gateway}}'], { check: false })).stdout.trim() || '127.0.0.1';
const adapter = new MoodleAdapter({ worker: opt('worker', 'w1'), moodleCommit: opt('moodle-commit'), bind });
const positional = rest.filter((a, i) => !a.startsWith('--') && !String(rest[i - 1] ?? '').startsWith('--') );
const out = value => console.log(JSON.stringify(value, null, 2));
const commands = {
  bootstrap: () => adapter.bootstrap({ rebuildGolden: rest.includes('--rebuild-golden') }),
  start: () => adapter.start(),
  stop: () => adapter.stop({ remove: rest.includes('--remove') }),
  reset: () => adapter.reset(),
  verify: () => adapter.verifySeed({ live: rest.includes('--live') }),
  ready: async () => ({ ready: await adapter.ready({ quick: true }) }),
  apply: () => adapter.applyDiff(rest.find(a => !a.startsWith('--') && a !== opt('worker') && a !== opt('moodle-commit'))),
  revert: () => adapter.revertDiff(),
  // run <feature> [line]: reset, then run one scenario with per-step results (feature path relative to the Moodle root)
  run: () => runScenario(adapter, { feature: positional[0], line: positional[1] ? Number(positional[1]) : undefined, reset: !rest.includes('--no-reset') }),
  // handoff <feature> <line>: reset, run the data steps through generators, print what the agent arm receives
  handoff: () => prepareForAgent(adapter, { feature: positional[0], line: Number(positional[1]) }),
  // smoke <feature> <line>: handoff + model-free scripted login through the restricted MCP proxy
  smoke: async () => scriptedLoginSmoke(adapter, await prepareForAgent(adapter, { feature: positional[0], line: Number(positional[1]) })),
  stats: () => adapter.stats(),
  info: () => ({ baseUrl: adapter.baseUrl, hostUrl: adapter.hostUrl, allowedOrigins: adapter.allowedOrigins, browserArgs: adapter.browserArgs(), ports: adapter.ports, state: adapter.state }),
};
if (!commands[command]) { console.error('commands: ' + Object.keys(commands).join(' ')); process.exit(2); }
try { out(await commands[command]()); } catch (error) { console.error(error.message); process.exit(1); }
