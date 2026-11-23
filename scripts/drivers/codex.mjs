import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { base, cliVersion, hashText } from './index.mjs';
import { normalizeUsage } from '../ledger/metering.mjs';
import { prepareCodexBoundary, requestedModel, readModelCatalog } from '../codex-boundary.mjs';

export function createDriver({ model = requestedModel } = {}) {
  return base({
    name: 'codex', model,
    version: () => cliVersion('codex'),
    async systemPromptHash() {
      // Codex model catalog entries may carry their base instructions; absent -> unknown, never guessed.
      let catalog; try { catalog = readModelCatalog(); } catch { return null; }
      const entry = catalog.models?.find(m => m.slug === model);
      return typeof entry?.base_instructions === 'string' ? { hash: hashText(entry.base_instructions), source: 'codex model catalog base_instructions' } : null;
    },
    prepare: options => prepareCodexBoundary(options),
    usage(events) {
      const done = [...events].reverse().find(e => e.type === 'turn.completed' && e.usage);
      return normalizeUsage(done?.usage);
    },
    systemPromptFromEvents(events) {
      for (const e of events) { const p = e.payload ?? e; const t = p?.base_instructions?.text ?? p?.base_instructions; if (typeof t === 'string' && t) return t; }
      return null;
    },
  });
}
