import { base, cliVersion } from './index.mjs';
import { normalizeUsage } from '../ledger/metering.mjs';
import { prepareOmpBoundary, requestedModel, ompUsage } from '../codex-boundary.mjs';

export function createDriver({ model = requestedModel } = {}) {
  return base({
    name: 'omp', model,
    // The omp binary's own version (`omp --version` -> "omp/18.x.y"), not the bun runtime or the codex CLI.
    version: () => cliVersion('omp'),
    // omp does not expose its default system prompt without a run; the hash comes from systemPromptFromEvents.
    async systemPromptHash() { return null; },
    prepare: options => prepareOmpBoundary(options),
    usage(events) {
      const end = [...events].reverse().find(e => e.type === 'agent_end');
      if (!end) return normalizeUsage(null);
      const { usage } = ompUsage(end.messages || []);
      // omp reports cacheRead/cacheWrite per message; reasoning tokens are not broken out there.
      return normalizeUsage({ ...usage, reasoning_output_tokens: null });
    },
    systemPromptFromEvents(events) {
      for (const e of events) { const t = e.systemPrompt ?? e.system_prompt ?? e.messages?.find?.(m => m.role === 'system')?.content; if (typeof t === 'string' && t) return t; }
      return null;
    },
  });
}
