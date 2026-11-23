import { parseExpressionAt } from 'acorn';
export const verdictParserVersion = 1;
const statuses = new Set(['pass', 'fail', 'unresolved']);
export const normalizeAssertion = value => typeof value === 'string' ? value.trim().replace(/^(?:Then|And)\s+/, '') : null;
export function scenarioAssertions(feature, caseId) {
  const scenario = feature.split(/(?=  @)/).find(block => block.startsWith(`  @${caseId}\n`));
  if (!scenario) throw new Error(`Frozen scenario not found: ${caseId}`);
  let type;
  const assertions = [];
  for (const line of scenario.split('\n')) {
    const step = line.match(/^    (Given|When|Then|And|But) (.+)$/);
    if (!step) continue;
    if (!['And', 'But'].includes(step[1])) type = step[1];
    if (type === 'Then') assertions.push(step[2]);
  }
  return assertions;
}
function readObject(text) {
  const value = JSON.parse(text);
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Verdict must be a JSON object');
  const expression = parseExpressionAt(text, text.search(/\S/), { ecmaVersion: 2024 });
  const keys = expression.properties.map(property => property.key.value);
  if (new Set(keys).size !== keys.length) throw new Error('Duplicate verdict keys');
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(['failedAssertion', 'reason', 'status'])) throw new Error('Verdict requires exactly status, reason and failedAssertion');
  if (!statuses.has(value.status)) throw new Error('Invalid verdict status');
  if (typeof value.reason !== 'string' || !value.reason.trim() || value.reason.length > 8000) throw new Error('Verdict reason must be a nonempty bounded string');
  if (value.failedAssertion !== null && (typeof value.failedAssertion !== 'string' || !value.failedAssertion.trim() || value.failedAssertion.length > 2000)) throw new Error('failedAssertion must be a nonempty string or null');
  if (value.status === 'pass' && value.failedAssertion !== null) throw new Error('A pass cannot name a failed assertion');
  return value;
}
function singleFence(text) {
  const lines = text.split(/\r?\n/);
  let opened = null, closed = false, body = [], outside = [];
  for (const line of lines) {
    const fence = line.match(/^[ \t]*(`{3,}|~{3,})([^\r\n]*)$/);
    if (fence) {
      if (!opened) {
        if (!/^\s*(?:json)?\s*$/i.test(fence[2])) throw new Error('Only a JSON or unlabelled fence is allowed');
        opened = fence[1];
      } else if (!closed && fence[1][0] === opened[0] && fence[1].length >= opened.length && !fence[2].trim()) closed = true;
      else throw new Error('Multiple or malformed fences');
    } else if (opened && !closed) body.push(line);
    else outside.push(line);
  }
  if (!opened || !closed) throw new Error('Expected whole JSON or exactly one closed JSON fence');
  const prose = outside.join('\n');
  // Ambiguity checks are syntactic, not a model interpretation of prose.
  // Ordinary explanations such as "the scenario passes" remain acceptable;
  // another explicit status/verdict/result declaration does not.
  if (/\b(?:status|verdict|result)["']?\s*[:=]\s*["']?(?:pass|fail|unresolved)\b/i.test(prose)) throw new Error('Additional explicit verdict outside JSON fence');
  const starts = [...prose.matchAll(/\{/g)].map(match => match.index);
  if (starts.length > 256) throw new Error('Too many JSON-like fragments outside verdict');
  for (const start of starts) {
    try {
      const node = parseExpressionAt(prose, start, { ecmaVersion: 2024 });
      const value = JSON.parse(prose.slice(start, node.end));
      if (value && typeof value === 'object' && Object.hasOwn(value, 'status')) throw new Error('additional-verdict-object');
    } catch (error) { if (error.message === 'additional-verdict-object') throw new Error('Additional verdict object outside JSON fence'); }
  }
  return body.join('\n').trim();
}
export function decodeVerdict(raw, assertions = []) {
  const base = { verdictParserVersion, rawResponse: raw ?? null, reportedStatus: 'unresolved', failedAssertion: null, normalizedFailedAssertion: null, failedAssertionVerified: false, verdictFormat: null, verdictParseError: null };
  try {
    if (typeof raw !== 'string' || !raw.trim() || raw.length > 65536) throw new Error('Verdict response must be a nonempty bounded string');
    const text = raw.trim();
    let wholeJSON = false;
    try { JSON.parse(text); wholeJSON = true; } catch {}
    // A syntactically valid JSON value with a wrong schema must not be
    // salvaged by searching inside it for another answer.
    const object = readObject(wholeJSON ? text : singleFence(text));
    const format = wholeJSON ? 'whole-json' : 'single-fenced-json';
    const normalized = normalizeAssertion(object.failedAssertion);
    return { ...base, reportedStatus: object.status, verdictReason: object.reason, failedAssertion: object.failedAssertion, normalizedFailedAssertion: normalized, failedAssertionVerified: object.status === 'fail' && normalized !== null && assertions.includes(normalized), verdictFormat: format };
  } catch (error) { return { ...base, verdictParseError: error.message }; }
}
