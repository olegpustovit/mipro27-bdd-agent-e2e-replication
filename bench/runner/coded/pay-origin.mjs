// Keep the legacy support code shared with its original harness. Scope the
// origin substitution to the support and browser fixture files it uses.
import { registerHooks } from 'node:module';

const origin = new URL(process.env.BENCH_APP_URL).origin;
const root = new URL('../../../', import.meta.url);
const legacy = new Set([
  'study/actions.mjs', 'study/steps.mjs', 'study/world.mjs',
  'scripts/fixture.mjs',
  ...['v0', 'v1', 'v2'].map(version => `bench/stepdefs/pay/${version}/hold-out.mjs`),
].map(path => new URL(path, root).href));

if (origin !== 'http://localhost:3000') {
  registerHooks({
    load(url, context, nextLoad) {
      const result = nextLoad(url, context);
      if (!legacy.has(url)) return result;
      return {
        ...result,
        source: result.source.toString().replaceAll('http://localhost:3000', origin),
      };
    },
  });
}
