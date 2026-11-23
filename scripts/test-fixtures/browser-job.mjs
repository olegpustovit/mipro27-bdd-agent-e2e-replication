// Test-only job: starts a detached "browser" (its own session and process group, like Playwright's Chromium) and then dies or hangs.
// STUDY_FAKE_BROWSER_MODE: kill-job (attempt 1 SIGKILLs itself, the browser stays behind) | hang (attempt 1 waits forever) | (default) exit 0.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const attempt = Number(process.env.STUDY_TASK_ATTEMPT || 1), mode = process.env.STUDY_FAKE_BROWSER_MODE || '';
const browser = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
browser.unref();
writeFileSync(`${process.env.STUDY_FAKE_BROWSER_PIDFILE}.${attempt}`, String(browser.pid));
if (attempt === 1 && mode === 'kill-job') process.kill(process.pid, 'SIGKILL');
if (attempt === 1 && mode === 'hang') await new Promise(() => setInterval(() => {}, 1000));
