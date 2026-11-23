// Per-trial cost metering. Anything not observed stays null: never 0, never estimated.
// Convention (same as scripts/study-facts.mjs): inputTokens is the TOTAL input the CLI reported and includes
// cache-read and cache-write tokens; they are broken out separately so no category is double-counted.
const count = n => Number.isSafeInteger(n) && n >= 0 ? n : null;
export function normalizeUsage(raw) {
  const u = raw && typeof raw === 'object' ? raw : {};
  return {
    inputTokens: count(u.input_tokens ?? u.inputTokens),
    cacheReadTokens: count(u.cached_input_tokens ?? u.cacheReadTokens),
    cacheWriteTokens: count(u.cache_write_input_tokens ?? u.cacheWriteTokens),
    outputTokens: count(u.output_tokens ?? u.outputTokens),
    reasoningTokens: count(u.reasoning_output_tokens ?? u.reasoning_tokens ?? u.reasoningTokens),
    inputIncludesCache: true,
  };
}
const ms = n => Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
// Wall time split. Each part is null when not measured; `unattributedMs` is only computed when the total and all
// three parts are known.
export function wallSplit({ totalMs, modelMs, browserMs, fixtureMs } = {}) {
  const parts = { totalMs: ms(totalMs), modelMs: ms(modelMs), browserMs: ms(browserMs), fixtureMs: ms(fixtureMs) };
  const known = [parts.modelMs, parts.browserMs, parts.fixtureMs];
  return { ...parts, unattributedMs: parts.totalMs !== null && known.every(v => v !== null) ? Math.max(0, parts.totalMs - known.reduce((a, b) => a + b, 0)) : null };
}
export const meter = ({ usage, wall, costUsd } = {}) => ({ ...normalizeUsage(usage), wall: wallSplit(wall), reportedCostUsd: Number.isFinite(costUsd) ? costUsd : null });
// Sum meters; a total is null as soon as one addend is null (observed partial sum and coverage are kept).
export function sumMeters(meters) {
  const keys = ['inputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens', 'reasoningTokens'];
  const out = { trials: meters.length };
  for (const k of keys) {
    const vals = meters.map(m => m?.[k] ?? null), seen = vals.filter(v => v !== null);
    out[k] = meters.length && seen.length === meters.length ? seen.reduce((a, b) => a + b, 0) : null;
    out[k + 'Observed'] = seen.length ? seen.reduce((a, b) => a + b, 0) : null;
    out[k + 'Coverage'] = `${seen.length}/${meters.length}`;
  }
  return out;
}
