import assert from 'node:assert/strict';
import { runSession } from '../agent/session.mjs';
import { models } from '../agent/codex.mjs';

const [model, effort] = models.luna;
let completed = false;
const result = await runSession({
  model, effort, prompt: 'Hello', steps: [], app: 'pay', url: 'http://127.0.0.1:1/',
  trace(channel, event) {
    if (channel === 'codex' && event.type === 'turn.completed') completed = true;
  },
});
assert(completed && result.raw && result.tokens.output > 0, 'Codex did not complete the one-word prompt');
console.log('Codex completed the one-word prompt in the agent sandbox');
