import { parseExpressionAt } from 'acorn';
import { AstBuilder, GherkinClassicTokenMatcher, Parser } from '@cucumber/gherkin';
import { IdGenerator } from '@cucumber/messages';

export const answerFormat = `Return exactly one JSON object with keys status, failed_step, and reason.
For a pass, use "status":"pass" and "failed_step":null.
For a failure, use "status":"fail" and give the first failing numbered step as an integer or its exact text.
If you cannot determine the result, use "status":"unresolved" and "failed_step":null.
In every case, give a nonempty reason based on what you observed.`;

export function unresolved(raw, cause, reason = null) {
  return { status: 'unresolved', failed_step: null, failed_step_text: null,
    reason, raw, unresolved_cause: cause };
}

export function parseAnswer(raw, steps) {
  const unreadable = () => unresolved(raw, 'no_readable_answer');
  if (typeof raw !== 'string' || raw.length > 65536) return unreadable();
  const text = raw.trim().replace(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i, '$1').trim();
  try {
    const value = JSON.parse(text);
    const node = parseExpressionAt(text, 0, { ecmaVersion: 2024 });
    if (node.type !== 'ObjectExpression' || node.properties.length !== 3 ||
        Object.keys(value).sort().join() !== 'failed_step,reason,status') return unreadable();
    const { status, failed_step: step, reason } = value;
    if (typeof reason !== 'string' || !reason.trim()) return unreadable();
    if (status === 'unresolved' && step === null) return unresolved(raw, 'no_readable_answer', reason);
    let number = null;
    if (status === 'fail') {
      if (Number.isInteger(step)) number = step;
      else if (typeof step === 'string') {
        const clean = text => text.trim().replace(/\s+/g, ' ');
        const match = normalizer => steps.flatMap((text, index) =>
          normalizer(text) === normalizer(step) ? [index + 1] : []);
        const exact = match(clean);
        const matches = exact.length ? exact : match(withoutKeyword);
        if (matches.length === 1) [number] = matches;
      }
      if (number === null || number < 1 || number > steps.length) return unreadable();
    } else if (status !== 'pass' || step !== null) return unreadable();
    return { status, failed_step: number, failed_step_text: steps[number - 1] ?? null,
      reason, raw, unresolved_cause: null };
  } catch {
    return unreadable();
  }
}

const withoutKeyword = text => text.trim().replace(/^(Given|When|Then|And|But|\*)\s+/i, '').replace(/\s+/g, ' ');

export function scenarioDetails(source) {
  const hasFeature = /^\s*Feature:/m.test(source);
  const prefix = hasFeature ? [] : /^\s*Scenario(?: Outline)?:/m.test(source)
    ? ['Feature: Prepared scenario'] : ['Feature: Prepared scenario', 'Scenario: Prepared steps'];
  const parser = new Parser(new AstBuilder(IdGenerator.incrementing()), new GherkinClassicTokenMatcher());
  const { feature } = parser.parse([...prefix, source].join('\n'));
  const scenarios = (feature?.children ?? []).flatMap(child =>
    child.rule?.children.map(entry => entry.scenario).filter(Boolean) ??
    (child.scenario ? [child.scenario] : []));
  if (scenarios.length !== 1) throw new Error('Expected exactly one prepared scenario');
  const lines = source.split(/\r?\n/);
  const stepLines = scenarios[0].steps.map(step => step.location.line - prefix.length - 1);
  const numbering = new Map(stepLines.map((line, index) => [line, index + 1]));
  return {
    steps: stepLines.map(line => lines[line].trim()),
    numbered: lines.map((line, index) => numbering.has(index) ?
      line.replace(/^(\s*)/, '$1' + numbering.get(index) + '. ') : line).join('\n'),
  };
}

export const scenarioSteps = source => scenarioDetails(source).steps;
