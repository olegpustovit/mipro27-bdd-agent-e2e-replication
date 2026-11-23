// Minimal Gherkin reader for Moodle Behat features (steps, tables, docstrings, Background, Scenario Outline).
// Not a general parser: it keeps what the study needs (step order, text, data tables, line numbers, tags).
const STEP = /^\s*(Given|When|Then|And|But|\*)\s+(.*\S)\s*$/;
const stripCell = c => c.trim().replace(/\\\|/g, '|');
export function parseFeature(text) {
  const lines = text.split(/\r?\n/);
  const feature = { name: '', tags: [], background: null, scenarios: [] };
  let current = null, pendingTags = [], last = null, docstring = null, examples = null;
  const open = (kind, name, line) => {
    const item = { kind, name, line, tags: [...feature.tags, ...pendingTags], steps: [], examples: [] }; pendingTags = [];
    if (kind === 'background') feature.background = item; else feature.scenarios.push(item);
    current = item; last = null; examples = null; return item;
  };
  lines.forEach((raw, i) => {
    const n = i + 1, line = raw.trim();
    if (docstring) {
      if (line === docstring.fence) { last.docString = docstring.lines.join('\n'); docstring = null; } else docstring.lines.push(raw);
      return;
    }
    if (!line || line.startsWith('#')) return;
    if (line.startsWith('@')) { pendingTags.push(...line.split(/\s+/).filter(t => t.startsWith('@')).map(t => t.slice(1))); return; }
    let m;
    if ((m = /^Feature:\s*(.*)$/.exec(line))) { feature.name = m[1]; feature.tags = pendingTags; pendingTags = []; return; }
    if (/^Background:/.test(line)) { open('background', '', n); return; }
    if ((m = /^(Scenario Outline|Scenario Template|Scenario):\s*(.*)$/.exec(line))) { open(m[1] === 'Scenario' ? 'scenario' : 'outline', m[2], n); return; }
    if (/^Examples?:/.test(line)) { examples = { line: n, tags: pendingTags, header: null, rows: [] }; pendingTags = []; current?.examples.push(examples); last = null; return; }
    if (line.startsWith('"""') || line.startsWith('```')) { docstring = { fence: line.slice(0, 3), lines: [] }; return; }
    if (line.startsWith('|')) {
      const cells = line.replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(stripCell);
      if (examples) { if (!examples.header) examples.header = cells; else examples.rows.push({ line: n, cells }); }
      else if (last) (last.table ||= []).push(cells);
      return;
    }
    if ((m = STEP.exec(line)) && current) { last = { keyword: m[1], text: m[2], line: n }; current.steps.push(last); return; }
  });
  return feature;
}
export function findScenario(feature, { line, name } = {}) {
  const hits = feature.scenarios.filter(s => (line === undefined || s.line === line) && (name === undefined || s.name === name));
  if (hits.length !== 1) throw new Error(`Expected one scenario for ${JSON.stringify({ line, name })}, found ${hits.length}`);
  return hits[0];
}
// Effective step list for one scenario: Background steps first. Outline rows are expanded when a row line is given.
export function effectiveSteps(feature, scenario, { exampleLine } = {}) {
  let steps = [...(feature.background?.steps ?? []).map(s => ({ ...s, background: true })), ...scenario.steps.map(s => ({ ...s, background: false }))];
  if (scenario.kind === 'outline') {
    const rows = scenario.examples.flatMap(e => e.rows.map(r => ({ ...r, header: e.header })));
    const row = exampleLine ? rows.find(r => r.line === exampleLine) : rows[0];
    if (!row) throw new Error('Outline needs an examples row');
    const sub = text => text.replace(/<([^>]+)>/g, (all, k) => { const i = row.header.indexOf(k); return i >= 0 ? row.cells[i] : all; });
    steps = steps.map(s => ({ ...s, text: sub(s.text), table: s.table?.map(r => r.map(sub)), docString: s.docString && sub(s.docString) }));
  }
  return steps.map((s, index) => ({ ...s, index }));
}
export function renderStep(s) {
  const out = [`${s.keyword} ${s.text}`];
  for (const row of s.table ?? []) out.push(`  | ${row.join(' | ')} |`);
  if (s.docString !== undefined) out.push('  """', ...s.docString.split('\n'), '  """');
  return out.join('\n');
}
