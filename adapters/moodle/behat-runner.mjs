// Run one Behat scenario at the worker's current state and return per-step results.
import { randomBytes } from 'node:crypto';
import { run } from './shell.mjs';

export const STUDY_CONFIG = '/opt/study-behat/study-behat.yml';
// Features Moodle's generated Behat config leaves out (tag @_cross_browser) run under a child config that lists only them; no other scenario changes config.
export const CROSS_BROWSER_CONFIG = '/opt/study-behat/study-behat-cross-browser.yml';
export const CROSS_BROWSER_FEATURES = new Set(['public/course/tests/behat/section_visibility.feature']);
// feature: path under the Moodle root (e.g. public/course/tests/behat/x.feature); line: scenario (or example row) line.
export async function runScenario(adapter, { feature, line, timeoutMs = 300000, reset = false } = {}) {
  if (!feature || !/^[\w./-]+\.feature$/.test(feature)) throw new Error('feature must be a relative .feature path');
  if (line !== undefined && !Number.isInteger(line)) throw new Error('line must be an integer');
  if (reset) await adapter.reset();
  const id = randomBytes(6).toString('hex'), log = `/tmp/study-steps-${id}.jsonl`;
  const abs = `/var/www/html/${feature}`, target = line ? `${abs}:${line}` : abs;   // Behat resolves relative paths against the config dir
  const began = performance.now();
  const r = await adapter.exec('webserver', ['timeout', '-s', 'KILL', String(Math.ceil(timeoutMs / 1000)), 'vendor/bin/behat', '--config', CROSS_BROWSER_FEATURES.has(feature) ? CROSS_BROWSER_CONFIG : STUDY_CONFIG, '--no-colors', '--format', 'moodle_progress', target],
    { cwd: '/var/www/html', env: { STUDY_STEP_LOG: log }, check: false, timeoutMs: timeoutMs + 30000 });
  const wallMs = Math.round(performance.now() - began);
  const raw = (await adapter.exec('webserver', ['sh', '-c', `cat ${log} 2>/dev/null; rm -f ${log}`], { check: false })).stdout;
  return parseResult({ raw, exitCode: r.code, wallMs, stdout: r.stdout, stderr: r.stderr, target });
}

export function parseResult({ raw, exitCode, wallMs, stdout = '', stderr = '', target }) {
  const scenarios = raw.split('\n').filter(Boolean).map(l => JSON.parse(l)).map(s => {
    const failing = s.steps.find(st => st.status === 'failed' || st.status === 'undefined' || st.status === 'pending');
    return { ...s, failingStepIndex: failing ? failing.index : null, failingStep: failing ?? null };
  });
  const status = exitCode === 0 && scenarios.length > 0 && scenarios.every(s => s.status === 'passed') ? 'passed'
    : scenarios.some(s => s.status === 'failed') ? 'failed' : 'error';   // error: Behat did not run a scenario (config, timeout, crash)
  return { target, status, exitCode, wallMs, scenarios, failingStepIndex: scenarios.find(s => s.failingStepIndex !== null)?.failingStepIndex ?? null,
    stdoutTail: stdout.slice(-3000), stderrTail: stderr.slice(-1000) };
}
