// Static structure of (break, fault) pairs: where the break bites, where the fault's target step is, whether the target step's step definition is among
// those the developers' fix changed (or, for arm B, among those a repair edited), what kind of assertion the target is, and whether its text repeats.
// Model-free and static: there is no runtime step-to-definition mapping in the harness (Behat results record the failing step, not its definition),
// so the mapping is the one mining/mine_breaks_v2.py `impact` uses: the docblock `@Given/@When/@Then /regex/` of the PHP function a patch hunk sits in,
// helper functions (no annotation) followed through same-file callers up to depth 3, and named-selector keys of selector classes. Cross-file helper
// callers are not followed. A step text is "in" a patch when one of the patterns of those definitions matches it.
const FUNC = /^\s*(?:(?:public|protected|private|static|final)\s+)*function\s+&?(\w+)\s*\(/;
const ANNOT = /@(?:Given|When|Then)\s+\/(.*)\/[a-z]*\s*$/;

export function phpFunctions(text) {
  const lines = text.split('\n'), starts = [];
  lines.forEach((l, i) => { const m = FUNC.exec(l); if (m) starts.push([i, m[1]]); });
  const funcs = {};
  starts.forEach(([i, name], k) => {
    const end = k + 1 < starts.length ? starts[k + 1][0] : lines.length, annots = [];
    for (let j = i - 1; j >= 0; j--) {
      const t = lines[j].trim();
      if (!(t.startsWith('*') || t.startsWith('/**') || t.startsWith('/*') || t.startsWith('*/') || !t)) break;
      const m = ANNOT.exec(t); if (m) annots.push(m[1]);
      if (t.startsWith('/**')) break;
    }
    funcs[name] = { start: i + 1, end, annots, body: lines.slice(i, end).join('\n') };
  });
  return { funcs, lines };
}
// PHP (PCRE) annotation pattern -> JS RegExp; null when it does not translate.
export function annotationRegex(php) {
  try { return new RegExp(php.replace(/\\\//g, '/').replace(/\(\?P</g, '(?<')); } catch { return null; }
}
// Hunk ranges on the `-` side of a patch, per file: [{ path, ranges: [[start, count]] }]. (For the broken-steps patch (pin -> old) the `-` side is the pin;
// for a repair patch the `-` side is the broken-steps tree the repair started from.)
export function patchHunks(patch) {
  const out = [];
  for (const blk of patch.split(/^diff --git /m).slice(1)) {
    const pm = /^a\/(\S+)/.exec(blk); if (!pm) continue;
    const ranges = [...blk.matchAll(/^@@ -(\d+)(?:,(\d+))? /gm)].map(m => [Number(m[1]), m[2] === undefined ? 1 : Number(m[2])]);
    out.push({ path: pm[1], ranges });
  }
  return out;
}
// impact(patch, textOf): textOf(path) = text of that file on the patch's `-` side (null when unavailable).
// Returns { patterns, selectors, funcs, files, unmapped } — patterns are the PHP annotation regexes of the changed step definitions (helpers followed to their annotated callers).
export function impact(patch, textOf) {
  const patterns = new Set(), selectors = new Set(), changed = new Set(), files = [];
  let unmapped = 0;
  for (const { path, ranges } of patchHunks(patch)) {
    files.push(path);
    const text = textOf(path); if (text == null) { unmapped += ranges.length; continue; }
    const { funcs, lines } = phpFunctions(text), isSelector = /selector/.test(path), hitHere = new Set();
    for (const [a, b] of ranges) {
      const lo = Math.max(a, 1), hi = lo + Math.max(b, 1);
      const hit = Object.entries(funcs).filter(([, f]) => f.start < hi && lo < f.end + 1).map(([n]) => n);
      let keyed = false;
      if (!hit.length && isSelector) for (let r = lo; r < hi; r++) for (let j = Math.min(r, lines.length) - 1; j >= 0; j--) { const mk = /^\s*'([a-z_ ]+)'\s*=>/.exec(lines[j]); if (mk) { selectors.add(mk[1]); keyed = true; break; } }
      if (!hit.length && !keyed) unmapped++;
      hit.forEach(n => { hitHere.add(n); changed.add(n); });
    }
    const seen = new Set(); let front = new Set([...hitHere]);
    for (let d = 0; d < 3; d++) {
      const next = new Set();
      for (const n of front) {
        if (seen.has(n)) continue; seen.add(n);
        if (funcs[n].annots.length) funcs[n].annots.forEach(p => patterns.add(p));
        else for (const [k, f] of Object.entries(funcs)) if (new RegExp('(?:->|::)' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\(').test(f.body)) next.add(k);
      }
      front = new Set([...next].filter(x => !seen.has(x)));
    }
  }
  return { patterns: [...patterns].sort(), selectors: [...selectors].sort(), funcs: [...changed].sort(), files, unmapped };
}
// How a step text relates to an impact: 'definition' (an annotation pattern of a changed definition matches), 'selector' (a changed named-selector key appears quoted in the step), or 'none'.
export function stepInImpact(text, im) {
  for (const p of im.patterns) { const rx = annotationRegex(p); if (rx && rx.test(text)) return 'definition'; }
  for (const s of im.selectors) if (text.includes(`"${s}"`)) return 'selector';
  return 'none';
}
// Visible-text or existence assertion: should (not) see / exist / appear (also "should appear after"), or "I (do not) see".
export const VISIBLE_OR_EXISTENCE = /\bshould (?:not )?(?:see|exist|appear)\b|^I (?:do not|don't) see\b/;
export const targetKind = text => VISIBLE_OR_EXISTENCE.test(String(text ?? '')) ? 'visible-or-existence' : 'other';
const norm = t => String(t ?? '').replace(/^(?:Given|When|Then|And|But|\*)\s+/, '').replace(/\s+/g, ' ').trim();
// steps: effective step list of the scenario ({ index, text }). Duplicate = the same normalised text at other indices.
export function duplicates(steps, targetIndex, targetText) {
  const t = norm(targetText ?? steps.find(s => s.index === targetIndex)?.text);
  return steps.filter(s => norm(s.text) === t).map(s => s.index);
}
// One row of the per-pair structure table.
export function structureRow({ pair, steps, biteIndex, biteText, im }) {
  const targetIndex = pair.target_step_index, atTarget = steps.find(s => s.index === targetIndex), text = pair.target_step_text ?? atTarget?.text ?? null;
  const dupIdx = duplicates(steps, targetIndex, text), rel = text == null ? 'none' : stepInImpact(text, im);
  return {
    break: pair.break, scenario: pair.scenario, fault: pair.fault, bite_index: biteIndex ?? null, bite_text: biteText ?? null, target_index: targetIndex ?? null, target_text: text,
    distance: biteIndex == null || targetIndex == null ? null : targetIndex - biteIndex, target_text_matches_index: atTarget ? norm(atTarget.text) === norm(text) : null,
    target_in_changed_step: rel !== 'none', changed_via: rel, position: rel !== 'none' ? 'target in a repaired step' : 'downstream', kind: targetKind(text),
    text_occurrences: dupIdx.length, duplicate_indices: dupIdx, ambiguous: dupIdx.length > 1,
  };
}
export function structureTotals(rows) {
  const n = f => rows.filter(f).length;
  return { pairs: rows.length, in_changed_step: n(r => r.target_in_changed_step), downstream: n(r => !r.target_in_changed_step), visible_or_existence: n(r => r.kind === 'visible-or-existence'), other_kind: n(r => r.kind === 'other'),
    duplicate_text: n(r => r.ambiguous), unique_text: n(r => !r.ambiguous), distance_zero: n(r => r.distance === 0), distance_positive: n(r => r.distance > 0), distance_negative: n(r => r.distance < 0), distance_sum: rows.reduce((a, r) => a + (r.distance ?? 0), 0) };
}

// ---- harness-facing part: reads the pinned source tree and the manifest ----
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseFeature, effectiveSteps } from '../../adapters/moodle/gherkin.mjs';
import { featurePath } from '../../adapters/moodle/manifest.mjs';
import { repoRoot } from '../../adapters/moodle/config.mjs';

export function scenarioSteps(manifest, scenarioId, srcDir) {
  const s = manifest.scenarioById.get(scenarioId), feature = parseFeature(readFileSync(join(srcDir, featurePath(s)), 'utf8')), sc = feature.scenarios.find(x => x.name === s.name);
  return effectiveSteps(feature, sc).map(x => ({ index: x.index, text: x.text, background: x.background }));
}
// Impact of a break's developer fix: the pin-side hunks of its broken-steps patch (the fix reversed; manifests/moodle/patches/Bxx.test.diff is the forward diff of the same hunks).
export function breakImpact(manifest, breakId, srcDir) {
  const b = manifest.breakById.get(breakId), file = b.patches?.broken_steps?.file ?? b.patches?.broken?.file, patch = readFileSync(join(repoRoot, file), 'utf8');
  return impact(patch, p => { try { return readFileSync(join(srcDir, p), 'utf8'); } catch { return null; } });
}
export function selectedStructure({ manifest, a, selected, srcDir }) {
  const imCache = new Map();
  return selected.map(p => {
    const im = imCache.get(p.break) ?? imCache.set(p.break, breakImpact(manifest, p.break, srcDir)).get(p.break);
    const brk = a.breaks.find(b => b.break === p.break)?.scenarios.find(s => s.scenario === p.scenario);
    return { ...structureRow({ pair: p, steps: scenarioSteps(manifest, p.scenario, srcDir), biteIndex: p.observed_break_failing_step, biteText: brk?.broken_failing_text, im }), bite: p.valid_strict ? 'strict' : 'core', patch_files: im.files };
  });
}
// UI commit date (committer date, UTC) from a local Moodle clone; null when the clone or commit is not available.
export function commitDate(sha, repo = process.env.MOODLE_REPO ?? join(process.env.HOME ?? '', 'projects/cms-work/moodle')) {
  try { return execFileSync('git', ['-C', repo, 'log', '-1', '--format=%cs', sha], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch { return null; }
}
const pad = (x, w) => String(x ?? '-').padEnd(w);
export function renderStructure(rows, totals, { manifest, a, dateOf = commitDate } = {}) {
  const L = [];
  L.push('PER-PAIR STRUCTURE of the selected pairs (static; Behat indices are 0-based over Background + scenario steps at the pin)');
  L.push('bite = step where the break bites in arm B\'s starting state; target = the fault\'s target step; distance = target - bite (selection rule v3 requires >= 0).');
  L.push('in changed step = the target step text matches the annotation of a step definition in the developers\' fix (hunks of Bxx.test.diff, taken on the pin side from Bxx.broken-steps.patch; helpers followed through same-file callers to depth 3, named-selector keys by quoted name) -> "target in a repaired step"; otherwise "downstream".');
  L.push('kind = visible-or-existence (should see / should not see / should exist / should not exist / should appear (after), I do not see) or other. dup = how often the target step text occurs in the scenario (1 = unique).');
  L.push(`${pad('#', 3)}${pad('break', 6)}${pad('scen', 6)}${pad('fault', 6)}${pad('bite', 7)}${pad('bite@', 6)}${pad('target@', 8)}${pad('dist', 5)}${pad('changed step', 18)}${pad('position', 26)}${pad('kind', 22)}${pad('dup', 5)}target step`);
  rows.forEach((r, i) => L.push(`${pad(i + 1, 3)}${pad(r.break, 6)}${pad(r.scenario, 6)}${pad(r.fault, 6)}${pad(r.bite, 7)}${pad(r.bite_index, 6)}${pad(r.target_index, 8)}${pad(r.distance, 5)}${pad(r.target_in_changed_step ? `yes (${r.changed_via})` : 'no', 18)}${pad(r.position, 26)}${pad(r.kind, 22)}${pad(r.text_occurrences + (r.ambiguous ? ' AMBIGUOUS' : ''), 5)}${r.target_text ?? ''}`));
  L.push(`TOTALS (${totals.pairs} pairs): target in a repaired step ${totals.in_changed_step}, downstream ${totals.downstream}; kind visible-or-existence ${totals.visible_or_existence}, other ${totals.other_kind}; target text unique ${totals.unique_text}, repeated in the scenario (ambiguous) ${totals.duplicate_text}; distance 0: ${totals.distance_zero}, > 0: ${totals.distance_positive}, < 0: ${totals.distance_negative}; sum of distances ${totals.distance_sum}.`);
  const byBreak = new Map(); for (const r of rows) (byBreak.get(r.break) ?? byBreak.set(r.break, []).get(r.break)).push(r);
  L.push(`By break (pairs / in a repaired step): ${[...byBreak].map(([b, l]) => `${b} ${l.length}/${l.filter(x => x.target_in_changed_step).length}`).join(', ')}`);
  const inStep = rows.filter(r => r.target_in_changed_step), faults = new Set(inStep.map(r => r.fault)), brks = new Set(inStep.map(r => r.break));
  L.push(`NOTE: the ${inStep.length} pairs with the target in a repaired step are ${inStep.map(r => `${r.break}.${r.fault}@${r.scenario}`).join(', ')}: ${brks.size} break(s) (${[...brks].join(', ')}), ${faults.size} fault(s) (${[...faults].join(', ')}), one repair per model and repetition. They are not independent pairs (one repair serves all of them) and are reported separately from the ${rows.length - inStep.length} downstream pairs.`);
  const amb = rows.filter(r => r.ambiguous);
  L.push('DUPLICATE TARGET TEXT AND THE EXACT RULE: the rule (stepClass in v1-report.mjs, atTarget in scripts/analysis/moodle-oracle.mjs, step_class in mining/record_candidates.py) is an OR: a failing step is "at" the target when it has the target\'s Behat index OR the same step text; there is no index-first order. The target index itself is resolved once per fault (resolveTarget: text hits sorted by distance to the nominal index, nearest wins, else the nominal index). A failure at another occurrence of a repeated target text would therefore also count as "at". The target index is the first failing step of the screening run, so an occurrence before it passed there; only a later occurrence can be confused with the target.');
  L.push(amb.length ? `AMBIGUOUS PAIRS (target text occurs more than once; flagged, not dropped): ${amb.map(r => `${r.break}.${r.fault}@${r.scenario} (indices ${r.duplicate_indices.join(', ')}; target ${r.target_index})`).join('; ')}` : 'AMBIGUOUS PAIRS: none (the target step text occurs once in every selected scenario).');
  const bad = rows.filter(r => r.target_text_matches_index === false);
  if (bad.length) L.push(`TARGET TEXT DOES NOT MATCH THE STEP AT ITS INDEX: ${bad.map(r => `${r.break}.${r.fault}@${r.scenario}`).join(', ')}`);
  L.push(`LIMIT: ${totals.visible_or_existence} of the ${totals.pairs} selected targets are visible-text or existence assertions; the other ${totals.other_kind} ${totals.other_kind === 1 ? 'is' : 'are'} not (${rows.filter(r => r.kind === 'other').map(r => `${r.break}.${r.fault}@${r.scenario}: "${r.target_text}"`).join('; ')}). Whether a repaired locator still finds the right element is therefore mostly tested through what the page shows, not through an interaction.`);
  if (manifest && a) {
    L.push('');
    L.push('UI COMMITS of the selected breaks (MDL id, commit, committer date, before state of the selected scenarios; "before" = old UI + old tests, a patch at the pin)');
    for (const [b, l] of byBreak) {
      const m = manifest.breakById.get(b), before = a.breaks.find(x => x.break === b)?.scenarios.filter(s => l.some(r => r.scenario === s.scenario)).map(s => `${s.scenario} ${s.before}`).join(', ');
      L.push(`${pad(b, 5)}${pad(m.mdl, 12)}${m.ui_commits.map(c => `${c.slice(0, 10)} ${dateOf(c) ?? 'date n/a'}`).join(', ')}; before: ${before}`);
    }
  }
  return L.join('\n') + '\n';
}

// ---- arm B repairs: which step definitions a repair session edited ----
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname } from 'node:path';
// Text of one file with a patch applied (git apply in a scratch directory, only that file); null when the file or the hunks are not there.
export function patchedText(baseText, relPath, patch) {
  if (baseText == null) return null;
  if (!patch?.trim()) return baseText;
  const dir = mkdtempSync(join(tmpdir(), 'moodle-patched-'));
  try {
    mkdirSync(dirname(join(dir, relPath)), { recursive: true }); writeFileSync(join(dir, relPath), baseText); writeFileSync(join(dir, 'p.patch'), patch);
    try { execFileSync('git', ['apply', `--include=${relPath}`, 'p.patch'], { cwd: dir, stdio: 'ignore' }); } catch { return null; }
    return readFileSync(join(dir, relPath), 'utf8');
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
// Impact of one repair session: its accepted edits ({ path, old_text, new_text }, in order) are located one by one in the running text of their file (startText(path) = the file in arm B's
// starting state, then each earlier edit applied), the line range of old_text is mapped to step definitions by `impact` on that same running text, and the edit is applied.
// Returns { files, funcs, patterns, selectors, unmapped, unlocated } (unlocated = edits whose old_text was not found; they are counted, never dropped silently).
export function repairImpact(edits, startText) {
  const running = new Map(), funcs = new Set(), patterns = new Set(), selectors = new Set(); let unmapped = 0, unlocated = 0;
  for (const e of edits ?? []) {
    if (!running.has(e.path)) running.set(e.path, startText(e.path));
    const text = running.get(e.path), at = text == null || !e.old_text ? -1 : text.indexOf(e.old_text);
    if (at < 0) { unlocated++; continue; }
    const start = text.slice(0, at).split('\n').length, count = e.old_text.split('\n').length;
    const im = impact(`diff --git a/${e.path} b/${e.path}\n@@ -${start},${count} +${start},${count} @@\n`, () => text);
    im.funcs.forEach(x => funcs.add(x)); im.patterns.forEach(x => patterns.add(x)); im.selectors.forEach(x => selectors.add(x)); unmapped += im.unmapped;
    running.set(e.path, text.slice(0, at) + (e.new_text ?? '') + text.slice(at + e.old_text.length));
  }
  return { files: [...new Set((edits ?? []).map(e => e.path))], funcs: [...funcs].sort(), patterns: [...patterns].sort(), selectors: [...selectors].sort(), unmapped, unlocated };
}
