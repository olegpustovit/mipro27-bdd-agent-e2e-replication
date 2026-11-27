#!/usr/bin/env node
// Feasibility check (no models, no Moodle run): is each campaign scenario present, with the same canonical text as at the pin,
// in the Moodle tree just before (UI parent) and just after (UI commit) its change? Reads feature files through the GitHub API (gh).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url)), repo = join(here, '../../..');
const { loadManifest } = await import(join(repo, 'adapters/moodle/manifest.mjs'));
const { scenarioTextSha, scenarioText } = await import(join(repo, 'adapters/moodle/scenario-text.mjs'));
const m = loadManifest(repo);
const commits = Object.fromEntries(readFileSync(join(here, '../feasibility/commits.tsv'), 'utf8').trim().split('\n').slice(1).map(l => { const [c, ui, parent, fix] = l.split('\t'); return [c, { ui, parent, fix }]; }));
const PIN = 'cfe123f26fc7071981fe949cb16cd5a08a8234f1';
const cases = { B04: ['S036', 'S037', 'S041'], B07: ['S025', 'S028', 'S029'], B15: ['S091', 'S094'], B25: ['S125'], B27: ['S131'], B28: ['S134', 'S137'], B29: ['S138', 'S139'], B34: ['S153', 'S154'] };
const cache = join(here, '../feasibility/features'); mkdirSync(cache, { recursive: true });
function fetch(path, ref) {
  const f = join(cache, `${ref.slice(0, 12)}__${path.replaceAll('/', '__')}`);
  if (existsSync(f)) { const t = readFileSync(f, 'utf8'); return t === '\u0000MISSING' ? null : t; }
  for (const p of [path, `public/${path}`]) {
    try { const t = execFileSync('gh', ['api', '-H', 'Accept: application/vnd.github.raw', `repos/moodle/moodle/contents/${p}?ref=${ref}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); writeFileSync(f, t); return t; } catch {}
  }
  writeFileSync(f, '\u0000MISSING'); return null;
}
const sha = (text, name) => { if (text == null) return 'no-file'; try { return scenarioTextSha(text, name).slice(0, 12); } catch (e) { return 'no-scenario'; } };
const rows = [];
for (const [b, scs] of Object.entries(cases)) for (const s of scs) {
  const sc = m.scenarioById.get(s), pin = sha(fetch(sc.feature, PIN), sc.name), pre = sha(fetch(sc.feature, commits[b].parent), sc.name), post = sha(fetch(sc.feature, commits[b].ui), sc.name);
  const fix = commits[b].fix !== commits[b].ui ? sha(fetch(sc.feature, commits[b].fix), sc.name) : '=post';
  rows.push({ change: b, scenario: s, pin, pre, post, fix, prePostSame: pre === post && !pre.startsWith('no-'), sameAsPin: post === pin });
}
console.log('change\tscenario\tpin\tpre\tpost\tfixcommit\tpre==post\tpost==pin');
for (const r of rows) console.log([r.change, r.scenario, r.pin, r.pre, r.post, r.fix, r.prePostSame, r.sameAsPin].join('\t'));
