import { run } from '../../../adapters/moodle/shell.mjs';

export function pinnedMoodle(web) {
  if (!/^p2-[0-9a-f]{16}-app$/.test(web)) throw new Error('Invalid pinned Moodle container');
  return {
    async exec(role, args, { cwd, env = {}, ...options } = {}) {
      if (role !== 'webserver') throw new Error('Expected the pinned Moodle web container');
      const flags = [
        ...(options.input === undefined ? [] : ['-i']),
        ...(cwd ? ['-w', cwd] : []),
        ...Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]),
      ];
      const result = await run('docker', ['exec', ...flags, web, ...args], options);
      if (result.code && args.includes('vendor/bin/behat')) {
        // Keep the root error when the consumer takes the tail of a stack trace.
        result.stdout = result.stdout.split('\n').filter(line => !line.startsWith('* line ')).slice(0, 16).join('\n');
        result.stderr = result.stderr.split('\n').filter(line => !line.startsWith('* line ')).slice(0, 16).join('\n');
      }
      return result;
    },
  };
}
