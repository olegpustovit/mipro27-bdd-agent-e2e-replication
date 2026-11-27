// Rewrite fixture origins only in the payment support and browser fixture.
import { registerHooks } from 'node:module';

const defaultApp = 'http://localhost:3000';
const defaultApi = 'http://localhost:3001';

function configuredOrigin(name, fallback) {
  const url = new URL(process.env[name] ?? fallback);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${name} must specify an HTTP(S) origin without credentials`);
  }
  return url.origin;
}

export const origin = configuredOrigin('BENCH_APP_URL', 'invalid:');
const apiOrigin = configuredOrigin('BENCH_PAY_API_URL', defaultApi);
const apiPrefix = process.env.BENCH_PAY_API_PREFIX ?? '';
if (!['', '/api'].includes(apiPrefix)) throw new Error('Unknown payment API prefix');
const root = new URL('../../../', import.meta.url);
const fixture = new URL('scripts/fixture.mjs', root).href;
const shared = new Set([
  'study/actions.mjs', 'study/steps.mjs', 'study/world.mjs', 'study/locators.mjs',
  'scripts/fixture.mjs', 'scripts/ui-observer.mjs',
].map(path => new URL(path, root).href));
const versionDirectory = new URL('bench/stepdefs/pay/', root).href;
const versionSupport = /^[\w-]+\/(?:actions|hold-out|locators|social|steps|world)\.mjs$/;

if (origin !== defaultApp || apiOrigin !== defaultApi || apiPrefix) {
  registerHooks({
    load(url, context, nextLoad) {
      const result = nextLoad(url, context);
      const versioned = url.startsWith(versionDirectory) &&
        versionSupport.test(url.slice(versionDirectory.length));
      if (!shared.has(url) && !versioned) return result;
      let source = result.source.toString().replace(/http:\/\/localhost:300[01]/g, match => {
        if (match === defaultApp) return origin;
        return url === fixture ? apiOrigin : match;
      });
      if (url === fixture && apiOrigin !== defaultApi) {
        source = source.replace('http://127.0.0.1:3001/testData/seed', apiOrigin + '/testData/seed');
      }
      // The pinned image mounts the same API router under /api. Keep the
      // hold-out binding's exact PATCH endpoint and HTTP success check.
      if (apiPrefix && versioned && url.endsWith('/hold-out.mjs')) {
        source = source.replace(String.raw`/^\/users\/[^/]+$/`, String.raw`/^\/api\/users\/[^/]+$/`);
      }
      return { ...result, source };
    },
  });
}
