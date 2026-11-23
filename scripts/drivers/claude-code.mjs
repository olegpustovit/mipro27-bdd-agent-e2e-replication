import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { base, cliVersion } from './index.mjs';
import { findSetpriv, requestedModel } from '../codex-boundary.mjs';
import { normalizeUsage } from '../ledger/metering.mjs';

export function claudeResult(event) {
  if (event.type !== 'result') return null;
  const u = event.usage;
  return {
    result: event.result,
    usage: u ? {
      input_tokens: u.input_tokens == null ? null : u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
      cached_input_tokens: u.cache_read_input_tokens ?? null,
      cache_write_input_tokens: u.cache_creation_input_tokens ?? null,
      output_tokens: u.output_tokens ?? null,
    } : null,
    total_cost_usd: event.total_cost_usd ?? null,
    modelUsage: event.modelUsage ?? null,
    providerError: event.is_error || event.subtype !== 'success' ? event.subtype || 'Claude Code error' : null,
  };
}

export function createDriver({ model = requestedModel } = {}) {
  return base({
    name: 'claude-code', model,
    version: () => cliVersion('claude'),
    async systemPromptHash() { return null; },
    systemPromptFromEvents() { return null; },
    usage(events) {
      const result = events.findLast(event => event.type === 'result');
      return normalizeUsage(result ? claudeResult(result).usage : null);
    },
    prepare({ endpoint, prompt, check = false }) {
      const executable = execFileSync('which', ['claude'], { encoding: 'utf8' }).trim();
      const setpriv = findSetpriv();
      const directory = mkdtempSync(join(tmpdir(), 'study-claude-os-'));
      const home = join(directory, 'home');
      const cleanup = () => rmSync(directory, { recursive: true, force: true });
      try {
        mkdirSync(join(home, '.claude'), { recursive: true, mode: 0o700 });
        if (!check) copyFileSync(join(homedir(), '.claude', '.credentials.json'), join(home, '.claude', '.credentials.json'));
        writeFileSync(join(home, 'mcp.json'), JSON.stringify({ mcpServers: { study: { type: 'http', url: endpoint } } }), { mode: 0o600 });
        const args = ['-n', 'bwrap', '--unshare-pid', '--unshare-ipc', '--unshare-uts',
          '--die-with-parent', '--new-session', '--proc', '/proc', '--dev', '/dev',
          '--perms', '0755', '--dir', '/etc', '--perms', '1777', '--tmpfs', '/tmp',
          '--perms', '0755', '--dir', '/workspace', '--chdir', '/workspace',
          '--bind', home, '/agent', '--ro-bind', executable, '/claude'];
        for (const path of ['/usr', '/lib', '/lib64', '/nix', '/etc/ssl', '/etc/resolv.conf', '/etc/hosts', '/etc/nsswitch.conf']) {
          if (existsSync(path)) args.push('--ro-bind', path, path);
        }
        args.push('--clearenv', '--setenv', 'HOME', '/agent', '--setenv', 'CLAUDE_CONFIG_DIR', '/agent/.claude',
          '--setenv', 'PATH', '/usr/bin', '--setenv', 'CLAUDE_CODE_DISABLE_AUTO_MEMORY', '1',
          '--setenv', 'DISABLE_AUTOUPDATER', '1', setpriv, '--reuid=' + process.getuid(),
          '--regid=' + process.getgid(), '--clear-groups', '--bounding-set=-all', '--no-new-privs');
        if (check) args.push('/usr/bin/sh', '-c', `test ! -e '${homedir()}' && test ! -e /etc/claude-code && echo PRIVATE_PATHS_ABSENT`);
        else args.push('/claude', '-p', '--model', model, '--output-format', 'stream-json', '--verbose',
          '--strict-mcp-config', '--mcp-config', '/agent/mcp.json', '--tools', '',
          '--allowedTools', 'mcp__study__*', '--setting-sources', '', '--disable-slash-commands',
          '--no-session-persistence', '--permission-mode', 'dontAsk', '--', prompt);
        return { command: 'sudo', args, directory, home, cleanup };
      } catch (error) { cleanup(); throw error; }
    },
  });
}
