import { createInterface } from 'node:readline';
import { parseAnswer, unresolved } from './answer.mjs';
import { codexCommand, providerRefusal, redactDiagnostic, redactEvent } from './codex.mjs';
import { openBrowser } from './browser.mjs';

export const timeLimitMs = 5 * 60 * 1000;
export const toolLimit = 80;

export async function runSession({
  prompt, steps, model, effort, app, url, trace, stderr = () => {},
  onInfrastructureFailure = () => {}, onProviderRefusal = () => {},
}, {
  prepare = codexCommand, browserFactory = openBrowser, schedule = setTimeout,
} = {}) {
  const started = performance.now();
  let raw = null;
  let cause = null;
  let infrastructureFailed = false;
  let refusal;
  let child;
  let timer;
  let killTimer;
  let command;
  let browser;
  let calls = 0;
  let lastCall;
  let repeated = 0;
  let tokens = { input: 0, cached: 0, output: 0 };
  function stop(reason) {
    if (cause) return;
    cause = reason;
    if (child?.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 2000);
    }
  }
  try {
    browser = await browserFactory({
      url, app,
      attemptTool(name, args) {
        if (cause) return false;
        if (calls >= toolLimit) {
          stop('budget_tools');
          return false;
        }
        calls++;
        trace('browser', { type: 'call', number: calls, name, args });
        return true;
      },
      observeTool(name, args, reply) {
        trace('browser', { type: 'result', name, args, reply });
        const signature = JSON.stringify([name, args, reply]);
        repeated = signature === lastCall ? repeated + 1 : 1;
        lastCall = signature;
        if (repeated >= 8) stop('loop');
      },
    });
    command = prepare({ model, effort, endpoint: browser.endpoint });
    child = command.start();
    child.stdin.on('error', () => {});
    const closed = new Promise(resolve => {
      child.once('error', () => { infrastructureFailed = true; });
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    timer = schedule(() => stop('budget_time'), timeLimitMs);
    let stderrRefusal;
    const drainStderr = async () => {
      if (!child.stderr) return;
      for await (const line of createInterface({ input: child.stderr })) {
        const diagnostic = redactDiagnostic(line);
        stderr(diagnostic);
        stderrRefusal ??= providerRefusal(diagnostic);
      }
    };
    // Drain both pipes while Codex runs so either stream can carry diagnostics.
    let stderrError;
    const stderrDrained = drainStderr().catch(error => { stderrError = error; });
    child.stdin.end(prompt);
    for await (const line of createInterface({ input: child.stdout })) {
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      if (typeof event?.type !== 'string') continue;
      event = redactEvent(event);
      const item = event.item;
      trace('codex', event);
      if (event.type === 'error' || event.type === 'turn.failed') {
        refusal = providerRefusal(JSON.stringify(event)) ?? refusal;
      }
      if (event.type === 'item.completed' && item?.type === 'agent_message') raw = item.text;
      if (event.type === 'turn.completed') {
        refusal = undefined;
        if (event.usage) tokens = { input: event.usage.input_tokens ?? 0, cached: event.usage.cached_input_tokens ?? 0,
          output: event.usage.output_tokens ?? 0 };
      }
    }
    const exit = await closed;
    await stderrDrained;
    if (stderrError) throw stderrError;
    trace('codex', { type: 'process.exit', ...exit });
    if (!cause && exit.code !== 0) refusal ??= stderrRefusal;
    if (!cause && exit.code !== 0) infrastructureFailed = true;
  } catch {
    infrastructureFailed = true;
    trace('codex', { type: 'adapter.failure' });
  } finally {
    clearTimeout(timer);
    clearTimeout(killTimer);
    if (child?.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    command?.cleanup();
    try { await browser?.close(); }
    catch {
      infrastructureFailed = true;
      trace('codex', { type: 'browser.cleanup_failure' });
    }
  }
  if (refusal) await onProviderRefusal(refusal);
  if (infrastructureFailed || refusal) onInfrastructureFailure();
  const verdict = refusal ? { ...unresolved(null, 'no_readable_answer', refusal.reason), valid: false }
    : cause ? unresolved(raw, cause) : infrastructureFailed
    ? unresolved(raw, 'no_readable_answer', 'Agent infrastructure failed') : parseAnswer(raw, steps);
  return { ...verdict, tokens, tool_calls: calls, minutes: (performance.now() - started) / 60000 };
}
