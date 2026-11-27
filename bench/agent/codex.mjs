import { stripVTControlCharacters } from 'node:util';
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
        cwd: directory, stdio: ['pipe', 'pipe', 'pipe'],
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
    return { start: () => spawn('sudo', args, { stdio: ['pipe', 'pipe', 'pipe'] }), cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

// Keep these signatures aligned with bench/tools/secret-scan.
const credentialField = /^(?:access_token|refresh_token|id_token|TELEGRAM_BOT_TOKEN|OPENAI_API_KEY|api_key|authorization|account_id)$/i;
const signatures = [
  /(?<![0-9])[0-9]{6,}:[A-Za-z0-9_-]{30,}/g,
  /sk-[A-Za-z0-9_-]{20,}/g,
  /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /\bBearer\s+[A-Za-z0-9_./+=:-]+/gi,
];
const fieldValue = /((?:access_token|refresh_token|id_token|TELEGRAM_BOT_TOKEN|OPENAI_API_KEY|api_key|authorization|account_id)(?:\\?["'])?\s*[:=]\s*(?:\\?["'])?)[A-Za-z0-9_./+=:-]+/gi;

export function redactDiagnostic(text) {
  text = stripVTControlCharacters(text);
  for (const signature of signatures) text = text.replace(signature, '[redacted]');
  return text.replace(fieldValue, '$1[redacted]');
}

export function redactEvent(event) {
  return JSON.parse(JSON.stringify(event, (key, value) => {
    if (credentialField.test(key)) return '[redacted]';
    return typeof value === 'string' ? redactDiagnostic(value) : value;
  }));
}

const refusalTypes = [
  ['auth', 'Codex provider authentication failed', '401|403',
    /\b(?:unauthorized|forbidden|unauthenticated|authentication_error|invalid_api_key|invalid_grant|token_expired|token_revoked|authentication required|failed to authenticate|failed to log in|requires authentication|not logged in|login required|please (?:log|sign) in)\b|\b(?:auth(?:entication|orization)?|log[ -]?in|(?:access|refresh) token)\b.{0,50}\b(?:invalid|expired|revoked|failed|failure|rejected|already used)\b|\b(?:invalid|expired|failed to refresh|failed to authenticate|failed to log in)\b.{0,30}\b(?:auth(?:entication)?|credentials|(?:access|refresh) token|log[ -]?in)\b/i],
  ['credits', 'Codex provider quota or credits exhausted', '402',
    /\b(?:insufficient[_ -](?:quota|credits|balance)|out of credits|no credits remaining|quota[_ -](?:exceeded|exhausted)|exceeded (?:your |the )?(?:current )?quota|payment required|usage[_ -]limit[_ -](?:reached|exceeded))\b/i],
  ['rate limit', 'Codex provider rate limit reached', '429',
    /\b(?:rate[_ -]limit(?:ed|[_ -]exceeded)?|too many requests)\b/i],
];

export function providerRefusal(text) {
  for (const [category, reason, codes, message] of refusalTypes) {
    const status = new RegExp(
      '\\b(?:HTTP(?:/\\d(?:\\.\\d)?)?|status(?:[ _-]?code)?|response code|code)[":= ]+(' + codes + ')\\b|^\\s*(' + codes + ')\\b', 'i');
    if (status.test(text) || message.test(text)) return { stop: 'provider refusal', category, reason };
  }
}
