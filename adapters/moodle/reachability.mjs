#!/usr/bin/env node
// Reachability check: which scenario steps address elements by css_element / xpath_element, and which of those
// selector values name things a UI-only agent cannot see (ids, classes, data-attributes, structure).
// Usage: node adapters/moodle/reachability.mjs [--json] <feature-file-or-dir>...
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseFeature, effectiveSteps } from './gherkin.mjs';

const SELECTOR = /"((?:[^"\\]|\\.)*)"\s+"(css_element|xpath_element)"/g;
// Visible to a snapshot-reading agent: text content and accessible name/label attributes.
const XPATH_VISIBLE = /text\(\)|normalize-space\(|contains\(\s*\.|@aria-label|@title|@alt|@placeholder|@value\b/;
const XPATH_DOM_ONLY = /@(?:id|class|data-[\w-]+|name|href|type|for|role|style|src)\b/;
const CSS_VISIBLE = /\[(?:aria-label|title|alt|placeholder)\b/;
const CSS_DOM_ONLY = /#[\w-]+|\.[\w-]+|\[(?:data-[\w-]+|id|class|name|href|type|for|role|value|src)\b|:nth|>|\+|~/;
export function classifySelector(type, value) {
  if (type === 'xpath_element') {
    const vis = XPATH_VISIBLE.test(value), dom = XPATH_DOM_ONLY.test(value);
    return vis && !dom ? 'visible' : vis && dom ? 'mixed' : dom ? 'dom-only' : 'structural';
  }
  const vis = CSS_VISIBLE.test(value), dom = CSS_DOM_ONLY.test(value);
  return vis && !dom ? 'visible' : vis && dom ? 'mixed' : dom ? 'dom-only' : 'structural';
}
export const FLAGGED = new Set(['dom-only', 'structural', 'mixed']);
export function analyzeFeature(text, file = '') {
  const feature = parseFeature(text), scenarios = [];
  for (const sc of feature.scenarios) {
    let steps; try { steps = effectiveSteps(feature, sc); } catch { steps = [...(feature.background?.steps ?? []), ...sc.steps]; }
    const uses = [];
    for (const s of steps) {
      // Data tables (Given the following ... exist) carry values, not selectors: only count selector phrases in step text.
      for (const m of s.text.matchAll(SELECTOR)) {
        const value = m[1].replace(/\\"/g, '"'), cls = classifySelector(m[2], value);
        uses.push({ stepIndex: s.index, line: s.line, background: Boolean(s.background), type: m[2], value, class: cls, flagged: FLAGGED.has(cls), step: s.text });
      }
    }
    scenarios.push({ feature: file, scenario: sc.name, line: sc.line, javascript: sc.tags.includes('javascript'), steps: steps.length, selectorSteps: new Set(uses.map(u => u.stepIndex)).size, flaggedSteps: new Set(uses.filter(u => u.flagged).map(u => u.stepIndex)).size, uses });
  }
  return scenarios;
}
function* walk(path) {
  if (statSync(path).isDirectory()) for (const e of readdirSync(path)) yield* walk(join(path, e)); else if (path.endsWith('.feature')) yield path;
}
export function analyzePaths(paths) { return paths.flatMap(p => [...walk(p)]).flatMap(f => analyzeFeature(readFileSync(f, 'utf8'), f)); }
export function summarize(rows) {
  const sum = key => rows.reduce((a, r) => a + r[key], 0);
  const byClass = {}; for (const r of rows) for (const u of r.uses) byClass[u.class] = (byClass[u.class] ?? 0) + 1;
  return { scenarios: rows.length, steps: sum('steps'), selectorSteps: sum('selectorSteps'), flaggedSteps: sum('flaggedSteps'), scenariosWithFlagged: rows.filter(r => r.flaggedSteps).length, selectorUsesByClass: byClass };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2), json = args.includes('--json'), paths = args.filter(a => !a.startsWith('--'));
  if (!paths.length) { console.error('usage: reachability.mjs [--json] <feature|dir>...'); process.exit(2); }
  const rows = analyzePaths(paths);
  if (json) console.log(JSON.stringify({ summary: summarize(rows), scenarios: rows }, null, 1));
  else {
    for (const r of rows) { console.log(`${r.feature}:${r.line} ${r.scenario}\n  steps=${r.steps} selector-steps=${r.selectorSteps} flagged=${r.flaggedSteps}`); for (const u of r.uses.filter(u => u.flagged)) console.log(`  [${u.class}] step ${u.stepIndex} ${u.type} ${u.value}`); }
    console.log(JSON.stringify(summarize(rows)));
  }
}
