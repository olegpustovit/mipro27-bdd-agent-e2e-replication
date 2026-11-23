// Second, independent LLM judge for the 540 pilot trials. One fresh headless `claude -p` call per trial.
// Usage: node scripts/judge2/run.mjs [--limit N] [--ids id1,id2] [--dry-run] [--out file] [--timeout-ms 300000]
//   Default: judge every trial with no verdict yet, in opaque-id order. Resumable: already judged trials are skipped.
// Output: append-only provenance/judge2/verdicts.jsonl (one line per successful judgment),
//         provenance/judge2/errors.jsonl (failed attempts; never counted as verdicts).
// Isolation actually achieved (no bwrap on this host): fresh empty temp cwd per call, all built-in tools disabled
// (--tools ""), no MCP (--strict-mcp-config, none given), no settings/CLAUDE.md (--setting-sources ""), no skills/commands,
// no session persistence, custom system prompt. The only channel is the packet text on stdin. It is NOT a filesystem sandbox:
// the process runs as the owner and has the owner's credentials; isolation rests on the model having no tool to use.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { allPackets, buildPacket, FAULT_CLASSES, HEALTHY_CLASSES } from './packet.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
export const VERDICTS = path.join(root, 'provenance/judge2/verdicts.jsonl');
export const ERRORS = path.join(root, 'provenance/judge2/errors.jsonl');
export const PROMPT_VERSION = 'judge2-prompt-v1';
export const SYSTEM_PROMPT = `You are an independent adjudicator in a software-testing experiment. You see exactly one trial. You know nothing about how it was executed beyond the packet, and you must not guess how other trials went. You have no tools; answer only from the packet.

Decide from the evidence. The observer's flags (valid, defectObserved, ...) and the executing system's own verdict are inputs, not the answer. Be strict and fair. Apply the same standard however the trial was executed.

Classes on a HEALTHY stage (no defect present):
- true_pass: reported pass, and the trace/observer evidence shows the required behaviour.
- unsupported_healthy_pass: reported pass, but the evidence does not show the required behaviour.
- false_alarm: reported failure although no defect is present and the application behaved as required.
- action_failure: the steps could not be performed (wrong locator, control not found, tool error, timeout), including a locator failing after an interface change.
- unresolved: no verdict could be reached from the evidence.
- invalid: infrastructure-invalid trial.

Classes on a FAULT stage (the seeded defect is present):
- supported_detection: the evidence shows this defect's violation after the qualifying action, and the reported failure corresponds to it. Stopping at the first observed violation is valid.
- wrong_reason: reported failure, but not because of this defect.
- unsupported_pass: reported pass although the trigger was reached.
- no_opportunity: passed or stopped without reaching the trigger.
- action_failure, unresolved, invalid: as above.

Cite the single most decisive trace step as an integer from the packet's "[step N]" markers (null only if the trace has no steps or none is decisive). The reason is one or two sentences with concrete observed values.`;
const sha = s => createHash('sha256').update(s).digest('hex');
const schemaFor = classes => ({ type: 'object', additionalProperties: false, required: ['classification', 'reason', 'cited_step', 'confidence'], properties: {
  classification: { type: 'string', enum: classes }, reason: { type: 'string' }, cited_step: { type: ['integer', 'null'] }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] } } });
export const readJsonl = f => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : [];
export const cliVersion = () => spawnSync('claude', ['--version'], { encoding: 'utf8' }).stdout.trim();

export function judgeOne(packet, { timeoutMs = 300000, version = cliVersion() } = {}) {
  const user = `Classify this trial.\n\n${packet.text}\n\nAllowed classes: ${packet.classes.join(', ')}.`;
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'judge2-'));
  const t0 = Date.now();
  try {
    const r = spawnSync('claude', ['-p', '--model', 'sonnet', '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--disable-slash-commands', '--no-session-persistence', '--system-prompt', SYSTEM_PROMPT, '--json-schema', JSON.stringify(schemaFor(packet.classes))],
      { input: user, cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
    const base = { opaqueId: packet.opaqueId, promptSha256: sha(`${SYSTEM_PROMPT}\n---\n${user}`), promptVersion: PROMPT_VERSION, cliVersion: version, requestedModel: 'sonnet', durationMs: Date.now() - t0 };
    if (r.status !== 0) return { ok: false, ...base, error: `exit ${r.status} ${r.signal ?? ''} ${String(r.stderr).slice(0, 500)}` };
    let j; try { j = JSON.parse(r.stdout); } catch (e) { return { ok: false, ...base, error: `unparseable CLI output: ${r.stdout.slice(0, 300)}` }; }
    let out = j.structured_output;
    if (!out) { try { out = JSON.parse(j.result); } catch { /* handled below */ } }
    if (j.is_error || !out || !packet.classes.includes(out.classification)) return { ok: false, ...base, error: `no valid classification: ${String(j.result).slice(0, 300)}` };
    const model = Object.keys(j.modelUsage || {})[0] ?? null, u = j.usage || {};
    return { ok: true, ...base, model, classification: out.classification, reason: out.reason, citedStep: out.cited_step ?? null, confidence: out.confidence,
      citedStepValid: out.cited_step === null || (Number.isInteger(out.cited_step) && out.cited_step >= 1 && out.cited_step <= packet.steps),
      usage: { input: u.input_tokens ?? null, cacheRead: u.cache_read_input_tokens ?? null, cacheWrite: u.cache_creation_input_tokens ?? null, output: u.output_tokens ?? null }, costUsd: j.total_cost_usd ?? null, cliDurationMs: j.duration_ms ?? null, numTurns: j.num_turns ?? null };
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
}

export function main(argv = process.argv.slice(2), { verdictsFile = VERDICTS, errorsFile = ERRORS, judge = judgeOne, packets = allPackets } = {}) {
  const arg = n => { const i = argv.indexOf(`--${n}`); return i < 0 ? null : argv[i + 1]; };
  const limit = arg('limit') ? Number(arg('limit')) : Infinity, ids = arg('ids')?.split(','), dry = argv.includes('--dry-run');
  const done = new Set(readJsonl(verdictsFile).map(v => v.opaqueId));
  const all = packets().map(p => ({ ...p, packet: buildPacket(p.campaign, p.entry) })).sort((a, b) => a.packet.opaqueId.localeCompare(b.packet.opaqueId));
  const todo = all.filter(p => !done.has(p.packet.opaqueId) && (!ids || ids.includes(p.packet.opaqueId))).slice(0, limit);
  const summary = { total: all.length, alreadyJudged: done.size, selected: todo.length, judged: 0, failed: 0 };
  if (dry) { summary.estimatedPromptChars = todo.reduce((n, p) => n + SYSTEM_PROMPT.length + p.packet.text.length, 0); return { summary, ids: todo.map(p => p.packet.opaqueId) }; }
  fs.mkdirSync(path.dirname(verdictsFile), { recursive: true });
  const version = cliVersion(), results = [];
  for (const p of todo) {
    const v = judge(p.packet, { version, timeoutMs: Number(arg('timeout-ms')) || 300000 });
    const line = { schema: 1, run: arg('run') || null, at: new Date().toISOString(), campaign: p.campaign, trialId: p.trialId, ...v };
    if (v.ok) { fs.appendFileSync(verdictsFile, JSON.stringify(line) + '\n'); summary.judged++; } else { fs.appendFileSync(errorsFile, JSON.stringify(line) + '\n'); summary.failed++; }
    results.push(line);
  }
  return { summary, results };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) { const r = main(); console.log(JSON.stringify(r.summary)); for (const x of r.results ?? []) console.log(x.ok ? `${x.opaqueId} ${x.classification} (${x.confidence}) step ${x.citedStep}` : `${x.opaqueId} FAILED ${x.error}`); }
