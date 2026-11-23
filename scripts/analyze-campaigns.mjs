// Rebuild every reported count and derived estimate from the committed campaign data.
// Usage: node scripts/analyze-campaigns.mjs [--verify]
//   --verify  also checks each decompressed file against data/SHA256SUMS.original
// Output: results/<campaign>.analysis.txt and results/<campaign>.derived.txt
// The analysis code is the code that produced the reported numbers on 2026-11-01
// (provenance/orchestration/analyze.mjs and derived.mjs, recovered unchanged).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'data', 'campaigns');
const outDir = path.join(root, 'results');
const verify = process.argv.includes('--verify');
const sums = new Map(fs.readFileSync(path.join(root, 'data', 'SHA256SUMS.original'), 'utf8')
  .split('\n').filter(Boolean).map(l => { const [h, f] = l.split(/\s+/); return [f, h]; }));

// Campaigns B, C and D re-ran only the runtime arm against campaign A's frozen step code.
const RUNTIME_RERUN_FROM = 'campaign-20261101-04d8551';

function materialize(id, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const src = path.join(dataDir, id);
  for (const name of fs.readdirSync(src)) {
    const from = path.join(src, name);
    let buf = fs.readFileSync(from), target = name;
    if (name.endsWith('.zst')) { buf = zlib.zstdDecompressSync(buf); target = name.slice(0, -4); }
    if (name === 'progress.txt') target = 'progress.log';
    fs.writeFileSync(path.join(dest, target), buf);
    if (verify) {
      const key = `runs/${id}/${target}`, want = sums.get(key);
      const got = crypto.createHash('sha256').update(buf).digest('hex');
      if (!want) throw new Error(`no checksum for ${key}`);
      if (want !== got) throw new Error(`checksum mismatch for ${key}`);
    }
  }
}

function run(script, dir, adjudication) {
  const r = spawnSync(process.execPath, [path.join(root, 'provenance', 'orchestration', script), dir, adjudication], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${script} failed for ${dir}: ${r.stderr}`);
  return r.stdout;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cucumber-study-analysis-'));
try {
  fs.mkdirSync(outDir, { recursive: true });
  const ids = fs.readdirSync(dataDir).sort();
  for (const id of ids) materialize(id, path.join(tmp, id));
  for (const id of ids) {
    const dir = path.join(tmp, id), adj = path.join(dir, 'adjudication.jsonl');
    fs.writeFileSync(path.join(outDir, `${id}.analysis.txt`), run('analyze.mjs', dir, adj));
    // Derived estimates need the step-code arm. For runtime-only reruns, pair with campaign A's
    // maintained trials and maintenance records, as was done on 2026-11-01.
    let derivedDir = dir;
    if (id !== RUNTIME_RERUN_FROM) {
      derivedDir = path.join(tmp, `${id}+maintained-from-A`);
      fs.mkdirSync(derivedDir);
      const a = path.join(tmp, RUNTIME_RERUN_FROM);
      const own = fs.readFileSync(path.join(dir, 'trials.jsonl'), 'utf8').trimEnd();
      const maintained = fs.readFileSync(path.join(a, 'trials.jsonl'), 'utf8').split('\n')
        .filter(l => l && JSON.parse(l).record.trial.arm === 'maintained').join('\n');
      fs.writeFileSync(path.join(derivedDir, 'trials.jsonl'), own + '\n' + maintained + '\n');
      const maint = fs.readFileSync(path.join(a, 'journal.jsonl'), 'utf8').split('\n')
        .filter(l => l && JSON.parse(l).type === 'maintenance-finished').join('\n');
      fs.writeFileSync(path.join(derivedDir, 'journal.jsonl'), maint + '\n');
    }
    fs.writeFileSync(path.join(outDir, `${id}.derived.txt`), run('derived.mjs', derivedDir, adj));
    console.log(`${id}: results/${id}.analysis.txt, results/${id}.derived.txt`);
  }
  if (verify) console.log(`Checksums: all ${ids.length} campaigns match data/SHA256SUMS.original`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

const { writeFacts } = await import('./study-facts.mjs');
writeFacts();
console.log('Corrected supplement: results/facts.txt');

// Additive pilot outputs (tables twice, resources, agreement, superseded lines, paper numbers). Original outputs above are untouched.
const { writeAll } = await import('./analysis/run.mjs');
console.log('Pilot paper outputs: results/' + writeAll().join(', results/'));
