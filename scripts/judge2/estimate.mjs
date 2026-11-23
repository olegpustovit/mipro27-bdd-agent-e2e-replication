// Estimates the full judge2 run from the verdicts recorded so far (tokens per prompt character, cost, time per trial).
// Usage: node scripts/judge2/estimate.mjs
import { readJsonl, VERDICTS, SYSTEM_PROMPT } from './run.mjs';
import { allPackets, buildPacket } from './packet.mjs';
export function estimate(verdicts = readJsonl(VERDICTS)) {
  const packets = new Map(allPackets().map(p => { const packet = buildPacket(p.campaign, p.entry); return [packet.opaqueId, { ...p, packet }]; }));
  const sample = verdicts.filter(v => packets.has(v.opaqueId) && v.usage && v.usage.input !== null);
  if (!sample.length) return null;
  const chars = v => SYSTEM_PROMPT.length + packets.get(v.opaqueId).packet.text.length + 120;
  const inTok = v => v.usage.input + v.usage.cacheRead + v.usage.cacheWrite;
  const ratio = sample.reduce((n, v) => n + inTok(v), 0) / sample.reduce((n, v) => n + chars(v), 0);
  const allChars = [...packets.values()].reduce((n, p) => n + chars({ opaqueId: p.packet.opaqueId }), 0);
  const outMean = sample.reduce((n, v) => n + v.usage.output, 0) / sample.length;
  const n = packets.size;
  return { sampleTrials: sample.length, tokensPerChar: ratio, totalTrials: n, estInputTokens: Math.round(allChars * ratio), estOutputTokens: Math.round(outMean * n),
    estCostUsd: sample.every(v => v.costUsd != null) ? Number((sample.reduce((a, v) => a + v.costUsd, 0) / sample.reduce((a, v) => a + chars(v), 0) * allChars + 0).toFixed(2)) : null,
    estSerialMinutes: Number((sample.reduce((a, v) => a + v.durationMs, 0) / sample.reduce((a, v) => a + chars(v), 0) * allChars / 60000).toFixed(1)),
    caveat: 'Linear extrapolation from a non-random 3-trial smoke; input includes cache writes; output varies with trial.' };
}
if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(estimate(), null, 1));
