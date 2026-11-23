export class InfrastructureError extends Error {
  constructor(message, options) { super(message, options); this.name = 'InfrastructureError'; this.code = 'STUDY_INFRASTRUCTURE'; }
}
export function assertNoInfrastructureFailure(ledger, { timeoutAt = null } = {}) {
  // The deadline is the primary outcome once it fires. Later shutdown reports
  // stay in the audit, but cannot turn that execution timeout into a new cause.
  const failure = ledger.find(event => event.type === 'fatal-infrastructure' && !(timeoutAt !== null && Number.isFinite(event.receivedAt) && event.receivedAt >= timeoutAt));
  if (failure) throw new InfrastructureError(failure.error);
}
export function isCleanProxyExit({ code, signal, inputClosed, pendingRequests }) {
  return code === 0 && signal === null && inputClosed && pendingRequests === 0;
}
export async function requireAuditCompletion(sessions, { timeoutMs = 2000 } = {}) {
  if (sessions.length !== 1) throw new InfrastructureError(`Expected one private observer session, received ${sessions.length}`);
  let timer;
  try {
    await Promise.race([
      sessions[0].closed,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new InfrastructureError('Private observer channel did not finish')), timeoutMs); }),
    ]);
    if (!sessions[0].completed || sessions[0].error) throw new InfrastructureError(sessions[0].error || 'Private observer terminal acknowledgement is missing');
  } finally { clearTimeout(timer); }
}
