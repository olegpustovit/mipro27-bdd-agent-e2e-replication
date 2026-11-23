// A process can exit before its pipe buffers and readline's last line drain.
// Use exit only for process-lifetime bookkeeping; consume results after close.
import { InfrastructureError } from './infrastructure.mjs';
export async function waitForOutput(child, { lines, onExit = () => {}, drainMs = 5000, onDrainTimeout = () => {} } = {}) {
  let timer;
  let rejectTimeout;
  const timeout = new Promise((_, reject) => { rejectTimeout = reject; });
  const drained = lines && !lines.closed ? new Promise(resolve => lines.once('close', resolve)) : Promise.resolve();
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      onExit(code, signal);
      // A descendant holding inherited pipes must not hang the campaign after
      // the execution timeout has been cleared. This is an infrastructure
      // failure, never a decoded pass/fail result or a replacement trial.
      timer = setTimeout(() => {
        rejectTimeout(new InfrastructureError('Subprocess output did not drain after exit'));
        onDrainTimeout();
        child.stdout?.destroy(); child.stderr?.destroy(); lines?.close();
      }, drainMs);
    });
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  try { const [status] = await Promise.race([Promise.all([closed, drained]), timeout]); return status; }
  finally { clearTimeout(timer); }
}
