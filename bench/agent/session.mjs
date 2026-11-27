import { createInterface } from 'node:readline';
import { parseAnswer, unresolved } from './answer.mjs';
import { codexCommand } from './codex.mjs';
import { openBrowser } from './browser.mjs';

export const timeLimitMs = 5 * 60 * 1000;
export const toolLimit = 80;

export async function runSession({ prompt, steps, model, effort, app, url, trace, onInfrastructureFailure = () => {} }, {
  prepare = codexCommand, browserFactory = openBrowser, schedule = setTimeout,
} = {}) {
  const started = performance.now();
  let raw = null;
  let cause = null;
  let infrastructureFailed = false;
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
        calls++;
        trace('browser', { type: 'call', number: calls, name, args });
        if (calls >= toolLimit) {
          stop('budget_tools');
          return false;
        }
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
    child.stdin.end(prompt);
    for await (const line of createInterface({ input: child.stdout })) {
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      const item = event.item;
      // Error payloads may carry provider diagnostics. Retain their event type.
      if (event.type === 'error' || event.type === 'turn.failed') {
        trace('codex', { type: event.type });
      } else {
        trace('codex', event);
      }
      if (event.type === 'item.completed' && item?.type === 'agent_message') raw = item.text;
      if (event.type === 'turn.completed' && event.usage) {
        tokens = { input: event.usage.input_tokens ?? 0, cached: event.usage.cached_input_tokens ?? 0,
          output: event.usage.output_tokens ?? 0 };
      }
    }
    const exit = await closed;
    trace('codex', { type: 'process.exit', ...exit });
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
  if (infrastructureFailed) onInfrastructureFailure();
  const verdict = cause ? unresolved(raw, cause) : infrastructureFailed
    ? unresolved(raw, 'no_readable_answer', 'Agent infrastructure failed') : parseAnswer(raw, steps);
  return { ...verdict, tokens, tool_calls: calls, minutes: (performance.now() - started) / 60000 };
}
