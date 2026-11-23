// Lossless transport representation; neither events nor semantic states change.
export function compactWitness(witness) {
  if (!witness) return witness;
  if (witness.encoding) throw new Error('Witness is already encoded');
  const index = new Map(), states = [];
  const events = witness.events.map(event => {
    if (!event.state) return event;
    const key = JSON.stringify(event.state);
    if (!index.has(key)) { index.set(key, states.length); states.push(event.state); }
    const { state, ...rest } = event;
    return { ...rest, stateRef: index.get(key) };
  });
  return { ...witness, encoding: 'state-dictionary-v1', states, events };
}
