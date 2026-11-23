import { spawn } from 'node:child_process';
import { mkdtempSync, copyFileSync, writeFileSync, rmSync, symlinkSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateActions } from './repair-policy.mjs';
import { locators, validateLocators } from '../study/locators.mjs';
import { waitForOutput } from './subprocess.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
export const defaultActions = () => readFileSync(`${root}study/actions.mjs`, 'utf8');
export async function runBaseline({ caseId, endpoint, selectors = locators, actions = defaultActions(), timeoutMs = 60000, actionLimit = 80, signal: abortSignal }) {
  validateLocators(selectors); validateActions(actions);
  const cwd = mkdtempSync(join(tmpdir(), 'cucumber-retained-steps-'));
  try {
    for (const name of ['world.mjs', 'steps.mjs', 'locators.mjs', 'scenarios.feature']) copyFileSync(`${root}study/${name}`, `${cwd}/${name}`);
    writeFileSync(`${cwd}/actions.mjs`, actions); writeFileSync(`${cwd}/selectors.json`, JSON.stringify(selectors));
    mkdirSync(`${cwd}/artifacts`);
    writeFileSync(`${cwd}/package.json`, '{"type":"module"}'); symlinkSync(`${root}node_modules`, `${cwd}/node_modules`);
    // Relative globs are required: Node's permission model makes Cucumber's
    // absolute-path glob traversal silently return no features.
    const osFiles = ['/proc/sys/fs/binfmt_misc/WSLInterop', '/run/WSL', '/proc/version', '/etc/os-release', '/usr/lib/os-release'];
    const args = ['--permission', `--allow-fs-read=${cwd}`, `--allow-fs-write=${cwd}/artifacts`, `--allow-fs-read=${root}node_modules`, ...osFiles.map(path => `--allow-fs-read=${path}`), `${root}node_modules/@cucumber/cucumber/bin/cucumber.js`, '--import', 'world.mjs', '--import', 'steps.mjs', '--tags', `@${caseId}`, '--format', 'json', '--retry', '0', '--exit', 'scenarios.feature'];
    const env = { PATH: '/usr/bin:/bin', HOME: cwd, TMPDIR: `${cwd}/artifacts`, LANG: 'C.UTF-8', STUDY_CDP_ENDPOINT: endpoint, STUDY_LOCATORS: `${cwd}/selectors.json`, STUDY_ACTION_LIMIT: String(actionLimit), NO_COLOR: '1' };
    const started = performance.now();
    {
      const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '', killed = false;
      child.stdout.on('data', b => { stdout += b; if (stdout.length > 2000000) child.kill('SIGKILL'); });
      child.stderr.on('data', b => { stderr += b; if (stderr.length > 2000000) child.kill('SIGKILL'); });
      const abort = () => { killed = true; child.kill('SIGKILL'); };
      abortSignal?.addEventListener('abort', abort, { once: true });
      if (abortSignal?.aborted) abort();
      const timer = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, timeoutMs);
      const { code, signal } = await waitForOutput(child, { onExit: () => clearTimeout(timer) }).finally(() => { clearTimeout(timer); abortSignal?.removeEventListener('abort', abort); });
      const match = stdout.match(/"type":"baseline-actions","count":(\d+)/);
      let scenarios = [];
      try { const offset = stdout.indexOf('\n['); const report = JSON.parse(offset < 0 ? stdout : stdout.slice(offset + 1)); scenarios = report.flatMap(f => f.elements || []).filter(s => s.keyword === 'Scenario'); } catch {}
      const scenarioCount = scenarios.length;
      const assertionFailures = scenarios.flatMap(s => s.steps || []).filter(s => s.result?.status === 'failed' && /expect\(|AssertionError/.test(s.result.error_message || '')).map(s => ({ step: s.name, error: s.result.error_message }));
      const stepFailures = scenarios.flatMap(s => s.steps || []).filter(s => s.result?.status === 'failed').map(s => ({ step: s.name, keyword: s.keyword, error: s.result.error_message }));
      const scenarioCompleted = scenarioCount === 1 && scenarios[0].steps.every(s => s.result?.status === 'passed');
      const privateCaptureFailed = stdout.includes('STUDY_PRIVATE_CAPTURE:') || stderr.includes('STUDY_PRIVATE_CAPTURE:');
      return { code: scenarioCount === 1 ? code : 2, processCode: code, scenarioCount, scenarioCompleted, assertionFailures, stepFailures, privateCaptureFailed, signal, timedOut: killed, actions: match ? Number(match[1]) : null, elapsedMs: Math.round(performance.now() - started), stdout, stderr };
    }
  } finally { rmSync(cwd, { recursive: true, force: true }); }
}
