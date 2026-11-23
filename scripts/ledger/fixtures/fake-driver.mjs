// Test-only driver: no CLI, no model.
export async function createDriver() {
  return {
    name: 'fake', model: 'fake-model',
    version: async () => process.env.STUDY_FAKE_CLI_VERSION || 'fake/1.0.0',
    systemPromptHash: async () => ({ hash: 'a'.repeat(64), source: 'fixture' }),
    prepare: () => { throw new Error('fake driver has no CLI'); },
    usage: events => ({ inputTokens: events[0]?.in ?? null, cacheReadTokens: null, cacheWriteTokens: null, outputTokens: events[0]?.out ?? null, reasoningTokens: null, inputIncludesCache: true }),
    systemPromptFromEvents: () => null,
  };
}
