// Three workers (w1..w3): start, then reset + run one scenario concurrently; sample RAM/CPU. Engineering smoke, not a trial.
// Usage: node adapters/moodle/parallel-demo.mjs [feature] [line]
import { MoodleAdapter } from './adapter.mjs';
import { runScenario } from './behat-runner.mjs';
import { run } from './shell.mjs';

const feature = process.argv[2] || 'public/course/tests/behat/activities_edit_name.feature', line = Number(process.argv[3] || 24);
const bind = process.env.STUDY_MOODLE_BIND || (await run('docker', ['network', 'inspect', 'bridge', '--format', '{{(index .IPAM.Config 0).Gateway}}'])).stdout.trim();
const workers = ['w1', 'w2', 'w3'].map(w => new MoodleAdapter({ worker: w, bind }));
const toMiB = s => { const m = /([\d.]+)\s*(KiB|MiB|GiB)/.exec(s); return m ? Number(m[1]) * { KiB: 1 / 1024, MiB: 1, GiB: 1024 }[m[2]] : 0; };
const samples = []; let sampling = true;
const sampler = (async () => { while (sampling) { const rows = await Promise.all(workers.map(async w => ({ worker: w.worker, rows: await w.stats() }))); samples.push(rows); await new Promise(r => setTimeout(r, 2000)); } })();
const out = { run: 'smoke-not-a-measured-trial', bind };
let t = performance.now();
out.start = await Promise.all(workers.map(w => w.start()));
out.startWallMs = Math.round(performance.now() - t);
// lock check: a second lease on a worker held by another adapter instance must fail
const holder = workers[0].lease('demo-holder'); let lockRefused = false;
try { new MoodleAdapter({ worker: 'w1', bind }).lease('second'); } catch { lockRefused = true; } holder();
out.lockRefusedWhileHeld = lockRefused;
t = performance.now();
out.cycle = await Promise.all(workers.map(async w => {
  const t0 = performance.now(), release = w.lease('demo');
  try { const reset = await w.reset(); const r = await runScenario(w, { feature, line }); return { worker: w.worker, resetMs: reset.ms, resetMatch: reset.match, scenarioStatus: r.status, scenarioWallMs: r.wallMs, steps: r.scenarios[0]?.steps.length, cycleMs: Math.round(performance.now() - t0) }; }
  finally { release(); }
}));
out.cycleWallMs = Math.round(performance.now() - t);
sampling = false; await sampler;
const peak = {};
for (const snap of samples) for (const { worker, rows } of snap) {
  const mem = rows.reduce((a, r) => a + toMiB(r.mem), 0), cpu = rows.reduce((a, r) => a + parseFloat(r.cpu), 0);
  const p = (peak[worker] ||= { memMiB: 0, cpuPct: 0 }); p.memMiB = Math.max(p.memMiB, Math.round(mem)); p.cpuPct = Math.max(p.cpuPct, Math.round(cpu));
}
out.peakPerWorker = peak;
out.idle = await Promise.all(workers.map(async w => ({ worker: w.worker, containers: await w.stats() })));
console.log(JSON.stringify(out, null, 1));
