export class UnsettledWorkError extends Error {
  constructor(message) { super(message); this.code = 'STUDY_UNQUIESCENT'; }
}
export class BudgetError extends Error {
  constructor(message) { super(message); this.code = 'STUDY_BUDGET'; }
}
export async function bounded(name, work, { deadline, signal, terminate = async () => {}, settleMs = 8000 } = {}) {
  if (!Number.isFinite(deadline)) throw new Error('An absolute operation deadline is required');
  const controller = new AbortController(); let timer, rejectAbort, termination;
  const aborted = new Promise((_, reject) => rejectAbort = reject);
  const abort = () => {
    if (controller.signal.aborted) return;
    controller.abort(); termination = Promise.resolve().then(terminate);
    termination.catch(() => {}); rejectAbort(new BudgetError(name + ' deadline/cancellation reached'));
  };
  signal?.addEventListener('abort', abort, { once: true });
  timer = setTimeout(abort, Math.max(0, deadline - Date.now()));
  const operation = Promise.resolve().then(() => { if (signal?.aborted || Date.now() >= deadline) abort(); controller.signal.throwIfAborted(); return work(controller.signal); });
  try { return await Promise.race([operation, aborted]); }
  catch (error) {
    if (!controller.signal.aborted) throw error;
    let grace;
    const settled = await Promise.race([Promise.allSettled([operation, termination]), new Promise(resolve => grace = setTimeout(() => resolve(null), settleMs))]);
    clearTimeout(grace);
    if (!settled) throw new UnsettledWorkError(name + ' did not quiesce after cancellation');
    if (settled[1]?.status === 'rejected' || settled[0]?.status === 'rejected' && settled[0].reason?.code === 'STUDY_UNQUIESCENT') throw new UnsettledWorkError(name + ' termination or nested settlement was not confirmed');
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
