// Verdict parser v2: a step-level verdict. The agent must name the failing step by its number in the list it was
// shown and quote that step; the harness maps it to the Behat step index so arms compare at the same granularity.
import { parseExpressionAt } from 'acorn';
export const verdictParserVersion = 2;
const statuses = new Set(['pass', 'fail', 'unresolved']);
const KEYS = ['failingStep', 'failingStepText', 'reason', 'status'];
export const normalizeStep = value => typeof value === 'string' ? value.trim().replace(/^\[\d+\]\s*/, '').replace(/^(?:Given|When|Then|And|But|\*)\s+/, '').replace(/\s+/g, ' ') : null;

function readObject(text) {
  const value = JSON.parse(text);
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Verdict must be a JSON object');
  const expression = parseExpressionAt(text, text.search(/\S/), { ecmaVersion: 2024 });
  const keys = expression.properties.map(p => p.key.value);
  if (new Set(keys).size !== keys.length) throw new Error('Duplicate verdict keys');
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(KEYS)) throw new Error('Verdict requires exactly status, reason, failingStep and failingStepText');
  if (!statuses.has(value.status)) throw new Error('Invalid verdict status');
  if (typeof value.reason !== 'string' || !value.reason.trim() || value.reason.length > 8000) throw new Error('Verdict reason must be a nonempty bounded string');
  const stepGiven = value.failingStep !== null || value.failingStepText !== null;
  if (value.status === 'pass' && stepGiven) throw new Error('A pass cannot name a failing step');
  if (value.status === 'fail') {
    if (!Number.isInteger(value.failingStep) || value.failingStep < 1) throw new Error('A fail must give failingStep as a 1-based integer step number');
    if (typeof value.failingStepText !== 'string' || !value.failingStepText.trim() || value.failingStepText.length > 2000) throw new Error('A fail must quote the failing step text');
  }
  if (value.status === 'unresolved' && stepGiven && !(Number.isInteger(value.failingStep) && typeof value.failingStepText === 'string')) throw new Error('failingStep and failingStepText go together');
  return value;
}
function singleFence(text) {
  let opened = null, closed = false; const body = [], outside = [];
  for (const line of text.split(/\r?\n/)) {
    const fence = line.match(/^[ \t]*(`{3,}|~{3,})([^\r\n]*)$/);
    if (fence) {
      if (!opened) { if (!/^\s*(?:json)?\s*$/i.test(fence[2])) throw new Error('Only a JSON or unlabelled fence is allowed'); opened = fence[1]; }
      else if (!closed && fence[1][0] === opened[0] && fence[1].length >= opened.length && !fence[2].trim()) closed = true;
      else throw new Error('Multiple or malformed fences');
    } else if (opened && !closed) body.push(line); else outside.push(line);
  }
  if (!opened || !closed) throw new Error('Expected whole JSON or exactly one closed JSON fence');
  const prose = outside.join('\n');
  if (/\b(?:status|verdict|result)["']?\s*[:=]\s*["']?(?:pass|fail|unresolved)\b/i.test(prose)) throw new Error('Additional explicit verdict outside JSON fence');
  const starts = [...prose.matchAll(/\{/g)].map(m => m.index);
  if (starts.length > 256) throw new Error('Too many JSON-like fragments outside verdict');
  for (const start of starts) {
    try { const node = parseExpressionAt(prose, start, { ecmaVersion: 2024 }); const v = JSON.parse(prose.slice(start, node.end)); if (v && typeof v === 'object' && Object.hasOwn(v, 'status')) throw new Error('additional-verdict-object'); }
    catch (error) { if (error.message === 'additional-verdict-object') throw new Error('Additional verdict object outside JSON fence'); }
  }
  return body.join('\n').trim();
}
// steps: the UI steps shown to the agent, in order, each {text}. offset: number of data/background steps run before them,
// so behatStepIndex is directly comparable with the Behat runner's failingStepIndex.
export function decodeStepVerdict(raw, steps = [], { offset = 0 } = {}) {
  const base = { verdictParserVersion, rawResponse: raw ?? null, reportedStatus: 'unresolved', failingStep: null, failingStepText: null, failingStepVerified: false, failingStepMismatch: null, behatStepIndex: null, verdictFormat: null, verdictParseError: null };
  try {
    if (typeof raw !== 'string' || !raw.trim() || raw.length > 65536) throw new Error('Verdict response must be a nonempty bounded string');
    const text = raw.trim(); let whole = false;
    try { JSON.parse(text); whole = true; } catch {}
    const object = readObject(whole ? text : singleFence(text));
    const out = { ...base, reportedStatus: object.status, verdictReason: object.reason, failingStep: object.failingStep, failingStepText: object.failingStepText, verdictFormat: whole ? 'whole-json' : 'single-fenced-json' };
    if (object.failingStep !== null) {
      const shown = steps[object.failingStep - 1];
      if (!shown) out.failingStepMismatch = `step ${object.failingStep} is outside 1..${steps.length}`;
      else if (normalizeStep(shown.text) !== normalizeStep(object.failingStepText)) out.failingStepMismatch = 'quoted text does not match the step with that number';
      else { out.failingStepVerified = true; out.behatStepIndex = offset + object.failingStep - 1; }
    }
    return out;
  } catch (error) { return { ...base, verdictParseError: error.message }; }
}
