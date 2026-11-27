import { spawn, execFileSync } from 'node:child_process';
import { existsSync, realpathSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { disabled, findSetpriv, readModelCatalog } from '../../scripts/codex-boundary.mjs';

export const models = Object.freeze({
  luna: ['gpt-6-luna', 'medium'],
  terra: ['gpt-5.6-terra', 'medium'],
  sol: ['gpt-6.2-sol', 'high'],
});

export function codexCommand({ model, effort, endpoint }) {
  const auth = join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'auth.json');
  const executable = execFileSync('which', ['codex'], { encoding: 'utf8' }).trim();
  const container = process.env.BENCH_AGENT_CONTAINER === '1';
  if (container && !existsSync('/.dockerenv')) throw new Error('Expected a Docker worker');
  const catalog = readModelCatalog(container ? { cachePath: '/opt/bench/work/models_cache.json' } : undefined);
  const entry = catalog.models.find(item => item.slug === model);
  if (!entry) throw new Error('Pinned model absent from Codex catalog');
  const directory = mkdtempSync(join(tmpdir(), 'bench-p3c-'));
  const cleanup = () => rmSync(directory, { recursive: true, force: true });
  try {
    const path = realpathSync(executable);
    writeFileSync(join(directory, 'catalog.json'), JSON.stringify({ models: [{
      ...entry, apply_patch_tool_type: null, tool_mode: 'direct', multi_agent_version: null,
      experimental_supported_tools: [], supports_search_tool: false,
    }] }));
    const codexArgs = ['exec', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check',
      '--ephemeral', '--json', '-m', model, '-c', `model_reasoning_effort="${effort}"`,
      '-c', 'web_search="disabled"', '-c', 'tools.update_plan.enabled=false',
      '-c', 'tools.experimental_request_user_input.enabled=false',
      '-c', `model_catalog_json="${container ? directory : '/agent'}/catalog.json"`,
      '-c', `mcp_servers.study={url=${JSON.stringify(endpoint)},required=true,default_tools_approval_mode="approve"}`,
      ...disabled.flatMap(feature => ['--disable', feature]), '-'];
    if (container) {
      return { start: () => spawn(executable, codexArgs, {
        cwd: directory, stdio: ['pipe', 'pipe', 'ignore'],
        env: Object.fromEntries(['PATH', 'HOME', 'CODEX_HOME', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'SSL_CERT_FILE']
          .map(key => [key, process.env[key]])),
      }), cleanup };
    }
    const args = ['-n', 'bwrap', '--unshare-pid', '--unshare-ipc', '--unshare-uts',
      '--die-with-parent', '--new-session', '--perms', '0755', '--dir', '/etc'];
    for (const path of ['/usr', '/lib', '/lib64', '/nix', '/etc/ssl', '/etc/resolv.conf', '/etc/hosts', '/etc/nsswitch.conf']) {
      if (existsSync(path)) args.push('--ro-bind', path, path);
    }
    args.push('--proc', '/proc', '--dev', '/dev', '--perms', '1777', '--tmpfs', '/tmp',
      '--perms', '0755', '--dir', '/workspace', '--chdir', '/workspace',
      '--bind', directory, '/agent', '--ro-bind', auth, '/agent/auth.json', '--ro-bind', path, '/codex',
      '--clearenv', '--setenv', 'HOME', '/agent', '--setenv', 'CODEX_HOME', '/agent', '--setenv', 'PATH', '/usr/bin',
      findSetpriv(), '--reuid=' + process.getuid(), '--regid=' + process.getgid(),
      '--clear-groups', '--bounding-set=-all', '--no-new-privs',
      '/codex', ...codexArgs);
    return { start: () => spawn('sudo', args, { stdio: ['pipe', 'pipe', 'ignore'] }), cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}
