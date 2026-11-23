// The full ledger is retained, but a scored observation contains one attempt.
// Page-bound attempt IDs prevent delayed events from an earlier page/run from
// satisfying the current run's action, authentication or reload obligations.
export function createWitness({ eventLimit = 2000, historyLimit = 12000 } = {}) {
  if (!Number.isInteger(eventLimit) || eventLimit < 2000 || eventLimit > 40000 || !Number.isInteger(historyLimit) || historyLimit < 12000 || historyLimit > 120000) throw new Error('Invalid private witness limits');
  return { attemptId: 0, phase: 'initial', signedIn: false, events: [], history: [], sequence: 0, truncated: false, eventLimit, historyLimit };
}
export function beginAttempt(witness, phase) {
  if (typeof phase !== 'string' || !phase) throw new Error('An attempt phase is required');
  witness.attemptId++;
  witness.phase = phase;
  witness.signedIn = false;
  witness.events = [];
  delete witness.finalObservation;
  return witness.attemptId;
}
export function recordWitness(witness, attemptId, event) {
  const entry = { ...event, attemptId, sequence: ++witness.sequence, observedAt: Date.now() };
  if (witness.history.length < (witness.historyLimit || 12000)) witness.history.push(entry); else witness.truncated = true;
  if (attemptId !== witness.attemptId) return false;
  if (event.kind === 'authenticated') witness.signedIn = true;
  if (event.kind === 'observer-error') witness.observerError = String(event.error || 'Private UI observation failed');
  if (witness.events.length < (witness.eventLimit || 2000)) witness.events.push(entry); else witness.truncated = true;
  return true;
}
export function snapshotWitness(witness) {
  return structuredClone({ attemptId: witness.attemptId, phase: witness.phase, signedIn: witness.signedIn, truncated: witness.truncated, observerVersion: witness.observerVersion, captureProtocol: witness.captureProtocol, observerEnabled: witness.observerEnabled, observerError: witness.observerError, finalObservation: witness.finalObservation, events: witness.events });
}

export function acknowledgedEvents(witness) {
  const final = witness.finalObservation;
  const error = observationLedgerError(witness, final && { ...final, state: { documentId: final.documentId } });
  if (error) throw new Error(error);
  const limits = new Map(witness.events.filter(e => e.kind === 'document-barrier').map(e => [e.documentId, e.throughSequence]));
  limits.set(final.documentId, final.throughSequence);
  const events = witness.events.filter(e => Number.isInteger(e.browserSequence) && e.browserSequence <= limits.get(e.documentId));
  const documentOrder = new Map([...new Set(events.map(e => e.documentId))].map((id, i) => [id, i]));
  return events
    .sort((a, b) => documentOrder.get(a.documentId) - documentOrder.get(b.documentId) || a.browserSequence - b.browserSequence);
}
export function findReloadAfter(events, triggerIndex, path) {
  const trigger = events[triggerIndex];
  if (triggerIndex < 0 || !trigger?.documentId) return null;
  return events.slice(triggerIndex + 1).find(event => event.kind === 'navigation' && event.navigationType === 'reload' && event.persisted === false && event.path === path && event.documentId && event.documentId !== trigger.documentId && !events.slice(0, triggerIndex + 1).some(earlier => earlier.documentId === event.documentId)) || null;
}

// Validate delivery, rather than treating a missing private sample as a product
// failure. Browser time and sequence are document-local. Order document blocks
// by their first host receipt, and do not compare renderer clocks across blocks.
export function observationLedgerError(witness, final) {
  if (witness.observerError) return witness.observerError;
  if (witness.truncated) return 'Private witness bound exceeded';
  if (!witness.observerEnabled) return 'Private UI sampling is disabled';
  if (!final?.state?.documentId || !Number.isInteger(final.throughSequence)) return 'Missing final private observation barrier';
  const docs = new Map();
  let previousHostSequence = -1;
  for (const event of witness.events) {
    if (!Number.isInteger(event.sequence) || event.sequence <= previousHostSequence) return 'Invalid private host event order';
    previousHostSequence = event.sequence;
    if (Number.isInteger(witness.attemptId) && event.attemptId !== witness.attemptId) return 'Foreign attempt in private observation';
    if (!event.documentId || !Number.isInteger(event.browserSequence)) continue;
    if (!docs.has(event.documentId)) docs.set(event.documentId, []);
    docs.get(event.documentId).push(event);
  }
  const current = final.state.documentId;
  if (!docs.has(current)) return 'Final private document was not delivered';
  for (const [id, events] of docs) {
    const boundary = id === current ? final : witness.events.findLast(e => e.kind === 'document-barrier' && e.documentId === id);
    if (!boundary) return 'Previous private document has no acknowledged navigation barrier';
    const ordered = events.filter(e => e.browserSequence <= boundary.throughSequence).sort((a, b) => a.browserSequence - b.browserSequence);
    for (let i = 0; i < ordered.length; i++) if (ordered[i].browserSequence !== i + 1) return 'Private event gap or duplicate in document ' + id;
    for (let i = 0; i < ordered.length; i++) {
      if (!Number.isFinite(ordered[i].browserTime) || ordered[i].browserTime < 0) return 'Invalid private browser timestamp';
      if (i && ordered[i].browserTime < ordered[i - 1].browserTime) return 'Private browser clock moved backwards';
    }
    if (ordered.at(-1)?.browserSequence !== boundary.throughSequence) return 'Acknowledged private sample was not delivered';
    if (boundary.metrics?.failure || boundary.metrics?.failedEmits) return 'Private document reported delivery failure';
    if (docs.size > 1 && ordered.some(event => event.kind === 'navigation' && event.persisted === true)) return 'Private document was restored from the back-forward cache';
    for (const event of ordered) if (event.metrics?.failure || event.metrics?.failedEmits) return 'Previous private document reported delivery failure';
  }
  const documents = [...docs.entries()];
  for (let i = 1; i < documents.length; i++) {
    const [previous] = documents[i - 1];
    const start = documents[i][1].find(event => event.browserSequence === 1);
    const barrier = witness.events.findLast(event => event.kind === 'document-barrier' && event.documentId === previous);
    if (!start || !barrier || barrier.sequence >= start.sequence) return 'Private navigation was not acknowledged before the next document';
  }
  return null;
}
