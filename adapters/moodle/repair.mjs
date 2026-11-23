// Arm B: LLM repair of Behat step definitions after a UI break. One repair session = one (break, model, repetition).
// The repair agent works through three study-owned MCP tools (no shell, no file access of its own):
//   moodle_repair_read  read-only view: sampled scenarios (the developers' Gherkin, read-only), their results, the files it may edit
//   moodle_repair_edit  exact-text replacement in one allowed file (policy: repair-policy.mjs; the pilot maintenance budget of 10 accepted edits)
//   moodle_repair_run   reset the site and rerun the sampled scenarios (12 agent runs, the pilot's maintenance suites; the harness's initial run is not counted, as in the pilot)
// Starting state `broken-steps:Bxx`: new UI + the developers' NEW .feature files + OLD step definitions/selectors (Gherkin is never part of the repair patch).
// The output is a patch against the pin (old step definitions + the agent's edits, current UI and Gherkin) that arm B applies for every trial.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createMcpServer } from './mcp-server.mjs';
import { createRepairPolicy } from './repair-policy.mjs';
import { parseFeature, findScenario, effectiveSteps, renderStep } from './gherkin.mjs';
import { runScenario } from './behat-runner.mjs';
import { run } from './shell.mjs';
import { runAgentProcess, isolationCheck } from './agent-run.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
export const phpToJsRegex = body => new RegExp(body.replace(/\(\?P</g, '(?<'));   // PCRE named groups -> JS

// Step-definition files for a set of step texts: scan Behat context classes for the @Given/@When/@Then regexes.
export async function stepDefinitionFiles(srcDir, stepTexts) {
  const files = (await run('git', ['ls-files', '--', ':(glob)public/**/tests/behat/behat_*.php', 'public/lib/behat/*.php', 'public/lib/behat/classes/*.php'], { cwd: srcDir })).stdout.split('\n').filter(Boolean);
  const hits = new Set(), callees = new Set();
  for (const f of files) {
    const text = readFileSync(join(srcDir, f), 'utf8');
    for (const m of text.matchAll(/@(?:Given|When|Then)\s+\/(.+)\/[a-z]*\s*$/gm)) {
      let re; try { re = phpToJsRegex(m[1]); } catch { continue; }
      if (stepTexts.some(t => re.test(t))) { hits.add(f); for (const c of text.matchAll(/execute\(\s*['"](behat_\w+)::/g)) callees.add(c[1]); }
    }
  }
  const byClass = new Map(files.map(f => [/behat_\w+/.exec(f.split('/').pop())?.[0], f]));
  for (const c of callees) if (byClass.has(c)) hits.add(byClass.get(c));
  for (const sel of ['public/lib/behat/classes/partial_named_selector.php', 'public/lib/behat/classes/named_selector.php']) if (files.includes(sel)) hits.add(sel);
  return [...hits].sort();
}
const numbered = steps => steps.map((s, i) => `[${i}] ${renderStep(s).split('\n').join('\n     ')}`).join('\n');
const brief = r => ({ scenario: r.id, status: r.status, failingStepIndex: r.failingStepIndex, failingStep: r.failingStep && { index: r.failingStep.index, text: r.failingStep.text, error: String(r.failingStep.error ?? '').slice(0, 600) } });

export function repairPrompt({ breakInfo, limits }) {
  return `A UI change in Moodle broke acceptance tests that used to pass. The tests are Behat scenarios (Gherkin) executed through PHP step-definition classes and a named-selector registry. The product's UI is correct and must not be changed. Repair the test code so the scenarios pass again against the current UI and keep checking exactly what they checked before.
Rules: you can only use the three tools. Edit only the files that moodle_repair_read lists as editable (step-definition classes and the selector registry). The Gherkin feature files are the developers' and are read-only. Never weaken a check: do not remove assertions, expected values or failure paths, and do not make a step pass without doing what it says. Never work around a product defect. You have at most ${limits.acceptedEdits} accepted edits and ${limits.scenarioRuns} scenario runs of your own (the first run was made for you; its results are in moodle_repair_read).
Start with moodle_repair_read (no arguments) for the scenarios, their failing steps and the editable files; call it again with {"path": "...", "start": N, "end": M} to read a file region (numbered lines, at most 300 lines per call). Edit with moodle_repair_edit {"path","old_text","new_text"} (old_text must occur exactly once). Check with moodle_repair_run. Stop when the scenarios pass or the budget is used. Finish with one or two sentences saying what you changed. UI break class: ${breakInfo.class}.`;
}

export async function runRepair({ adapter, manifest, breakId, sample, model, timeoutMs = 600000 }) {
  const b = manifest.breakById.get(breakId), src = adapter.dirs.src, t0 = performance.now();
  const locs = sample.map(id => { const s = manifest.scenarioById.get(id), feature = s.feature.startsWith('public/') ? s.feature : `public/${s.feature}`, parsed = parseFeature(readFileSync(join(src, feature), 'utf8')), sc = findScenario(parsed, { name: s.name });
    return { id, feature, line: sc.line, steps: effectiveSteps(parsed, sc) }; });
  const allowed = await stepDefinitionFiles(src, locs.flatMap(l => l.steps.map(s => s.text)));
  const policy = createRepairPolicy({ breakClass: b.class, allowedFiles: allowed });
  const original = new Map(), edits = [], runsLog = [];   // path -> text before the first edit
  const runAll = async () => { const out = []; for (const l of locs) { const r = await runScenario(adapter, { feature: l.feature, line: l.line, reset: true }); const sc = r.scenarios[0]; out.push(brief({ id: l.id, status: r.status, failingStepIndex: r.failingStepIndex, failingStep: sc?.failingStep ?? null })); } return out; };
  const initial = await runAll(); runsLog.push({ n: 0, results: initial, by: 'harness' });   // not counted: the pilot's budget counts only the agent's own suite runs
  const fileFor = p => { if (!allowed.includes(p)) throw new Error(`${p} is not a listed file`); return join(src, p); };
  const tools = [
    { name: 'moodle_repair_read', description: 'Read-only: sampled scenarios, their latest results and the editable files; with a path, a numbered region of one listed file.',
      inputSchema: { type: 'object', properties: { path: { type: 'string' }, start: { type: 'integer', minimum: 1 }, end: { type: 'integer', minimum: 1 } }, additionalProperties: false },
      handler: async ({ path, start = 1, end }) => {
        if (!path) return { scenarios: locs.map(l => ({ id: l.id, feature: l.feature, steps: numbered(l.steps) })), results: runsLog.at(-1).results, editable: [...allowed.map(p => ({ path: p, bytes: readFileSync(join(src, p)).length }))], limits: { acceptedEditsLeft: policy.limits.acceptedEdits - policy.state.acceptedEdits, runsLeft: policy.limits.scenarioRuns - policy.state.scenarioRuns } };
        const lines = readFileSync(fileFor(path), 'utf8').split('\n'), to = Math.min(end ?? start + 299, start + 299, lines.length);
        return { path, totalLines: lines.length, text: lines.slice(start - 1, to).map((t, i) => `${start + i}: ${t}`).join('\n') };
      } },
    { name: 'moodle_repair_edit', description: 'Replace one exact text occurrence in one editable file. Counts against the accepted-edit budget only when accepted.',
      inputSchema: { type: 'object', properties: { path: { type: 'string' }, old_text: { type: 'string' }, new_text: { type: 'string' } }, required: ['path', 'old_text', 'new_text'], additionalProperties: false },
      handler: async ({ path, old_text, new_text }) => {
        const file = fileFor(path), before = readFileSync(file, 'utf8'), n = before.split(old_text).length - 1;
        if (!old_text || n !== 1) throw new Error(`old_text must occur exactly once (found ${n})`);
        const after = before.replace(old_text, () => new_text), check = policy.checkEdit({ path, before: original.get(path) ?? before, after });
        if (!check.ok) throw new Error(`Edit refused: ${check.reason}`);
        policy.acceptEdit(); if (!original.has(path)) original.set(path, before);
        writeFileSync(file, after); edits.push({ path, old_text, new_text, at: new Date().toISOString() });
        return { accepted: true, editsLeft: policy.limits.acceptedEdits - policy.state.acceptedEdits };
      } },
    { name: 'moodle_repair_run', description: 'Reset the site and rerun the sampled scenarios with the current edits.', inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      handler: async () => { const c = policy.checkRun(); if (!c.ok) throw new Error(c.reason); const n = policy.acceptRun(), results = await runAll(); runsLog.push({ n, results, by: 'agent' }); return { run: n, runsLeft: policy.limits.scenarioRuns - n, results }; } },
  ];
  const calls = [], server = await createMcpServer({ name: 'moodle-repair', tools, onCall: c => calls.push(c) });
  const isolation = await isolationCheck(model);
  if (!isolation.ok) throw new Error(`Agent sandbox self-check failed: ${JSON.stringify(isolation)}`);
  let agent;
  try { agent = await runAgentProcess({ model, endpoint: server.endpoint, prompt: repairPrompt({ breakInfo: b, limits: policy.limits }), timeoutMs }); }
  finally { await server.close(); }
  // Patch against the pin = every file the starting state changes plus every edited file, as the worker's tree now stands. It never contains a .feature file
  // (the starting state keeps the pin's Gherkin and the policy refuses Gherkin edits); asserted here so a violation cannot reach arm B.
  const touched = [...new Set([...(adapter.state.patch?.files ?? []), ...edits.map(e => e.path)])];
  const patch = touched.length ? (await run('git', ['diff', '--binary', '--full-index', 'HEAD', '--', ...touched], { cwd: src })).stdout : '';
  const gherkinTouched = touched.filter(f => f.endsWith('.feature'));
  if (gherkinTouched.length) throw new Error(`Repair patch touches Gherkin: ${gherkinTouched.join(', ')}`);
  const finalResults = runsLog.at(-1).results;
  return { isolation, patch, patchSha256: sha(patch), editedFiles: [...original.keys()], edits, allowedFiles: allowed, sample, runs: runsLog, calls, policyState: policy.state,
    allSamplePass: finalResults.every(r => r.status === 'passed'), agent: { code: agent.code, signal: agent.signal, timedOut: agent.timedOut, providerError: agent.providerError, models: agent.models, requestIds: agent.requestIds, final: agent.result, stderrTail: agent.stderrTail },
    usage: agent.usage, costUsd: agent.costUsd, wall: { totalMs: Math.round(performance.now() - t0), modelMs: agent.modelMs }, agentMs: agent.elapsedMs, rawEvents: agent.rawEvents };
}
