import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
// The owner selected the low-cost Luna tier for both study actors.  Keep this
// pin here rather than inheriting a user's Codex default.
export const requestedModel = process.env.STUDY_MODEL || 'gpt-6-luna';
export const requestedReasoningEffort = 'medium';
export const disabled = ['shell_tool','unified_exec','apps','plugins','multi_agent','multi_agent_v2','goals','sleep_tool','view_image','image_generation','browser_use','browser_use_external','computer_use','tool_suggest','skill_search','hooks','shell_snapshot'];
// The model catalog: Codex's own cache file when present, else `codex debug models` (newer Codex versions do not write ~/.codex/models_cache.json
// until an interactive session has run; the same catalog is what the CLI itself would load).
export function readModelCatalog({ cachePath = join(homedir(),'.codex/models_cache.json'), exec = () => execFileSync('codex',['debug','models'],{encoding:'utf8',maxBuffer:64e6,timeout:60000}) } = {}) {
  if (existsSync(cachePath)) return JSON.parse(readFileSync(cachePath,'utf8'));
  return JSON.parse(exec());
}
// setpriv: /usr/bin on most hosts, nix-provided on this one (then /nix and /lib64 are bound read-only, as for omp).
export const findSetpriv = () => existsSync('/usr/bin/setpriv') ? '/usr/bin/setpriv' : execFileSync('readlink',['-f',execFileSync('which',['setpriv'],{encoding:'utf8'}).trim()],{encoding:'utf8'}).trim();
export function prepareCodexBoundary({ endpoint, prompt, check = false }) {
  const directory = mkdtempSync(join(tmpdir(), 'study-codex-os-'));
  const home = join(directory,'home'); mkdirSync(home);
  copyFileSync(join(homedir(),'.codex/auth.json'), join(home,'auth.json'));
  const catalog = readModelCatalog();
  const model = catalog.models.find(m => m.slug === requestedModel); if (!model) throw Error('Pinned model absent');
  Object.assign(model,{apply_patch_tool_type:null,tool_mode:'direct',multi_agent_version:null,experimental_supported_tools:[],supports_search_tool:false});
  writeFileSync(join(home,'catalog.json'),JSON.stringify({models:[model]}));
  const executable = execFileSync('readlink',['-f',execFileSync('which',['codex'],{encoding:'utf8'}).trim()],{encoding:'utf8'}).trim();
  const args = ['-n','bwrap','--unshare-pid','--unshare-ipc','--unshare-uts','--die-with-parent','--new-session', '--ro-bind','/usr','/usr','--ro-bind','/lib','/lib',...(existsSync('/lib64') ? ['--ro-bind','/lib64','/lib64'] : []),...(existsSync('/nix') ? ['--ro-bind','/nix','/nix'] : []),'--proc','/proc','--dev','/dev','--perms','0755','--dir','/etc','--perms','1777','--tmpfs','/tmp','--perms','0755','--dir','/workspace','--chdir','/workspace','--bind',home,'/agent','--ro-bind',executable,'/codex'];
  for (const path of ['/etc/ssl','/etc/resolv.conf','/etc/hosts','/etc/nsswitch.conf']) if(existsSync(path)) args.push('--ro-bind',path,path);
  args.push('--clearenv','--setenv','HOME','/agent','--setenv','CODEX_HOME','/agent','--setenv','PATH','/usr/bin');
  args.push(findSetpriv(),'--reuid='+process.getuid(),'--regid='+process.getgid(),'--clear-groups','--bounding-set=-all','--no-new-privs');
  if(check) args.push('/usr/bin/sh','-c',['', '/projects/cms-int', '/projects/cucumber-mcp-study', '/projects/cucumber-mcp-study/scripts/oracle.mjs', '/.local/share/cucumber-study', '/.codex'].map(p => `test ! -e '${homedir()}${p}'`).join(' && ') + ' && echo PRIVATE_PATHS_ABSENT');
  else args.push('/codex','exec','--ignore-user-config','--ignore-rules','--skip-git-repo-check','--json','-m',requestedModel,'-c',`model_reasoning_effort="${requestedReasoningEffort}"`,'-c','web_search="disabled"','-c','tools.update_plan.enabled=false','-c','tools.experimental_request_user_input.enabled=false','-c','model_catalog_json="/agent/catalog.json"','-c',`mcp_servers.study={url=${JSON.stringify(endpoint)},default_tools_approval_mode="approve"}`,...disabled.flatMap(x=>['--disable',x]),prompt);
  return {command:'sudo', args, directory, home, cleanup:()=>rmSync(directory,{recursive:true,force:true})};
}
// Campaign D: a Claude model reached through the omp CLI, inside the same kind of OS sandbox as Codex.
// Built-in tools, skills, rules, context files, extensions and sessions are off; only the MCP server remains.
export const usesOmp = requestedModel.startsWith('claude-');
export function prepareOmpBoundary({ endpoint, prompt, check = false }) {
  const setpriv = existsSync('/usr/bin/setpriv') ? '/usr/bin/setpriv' : execFileSync('readlink',['-f',execFileSync('which',['setpriv'],{encoding:'utf8'}).trim()],{encoding:'utf8'}).trim();   // nix-provided on this host (/nix is bound read-only)
  const directory = mkdtempSync(join(tmpdir(), 'study-omp-os-'));
  const home = join(directory,'home'), workspace = join(directory,'workspace'); mkdirSync(join(home,'.omp/agent'),{recursive:true}); mkdirSync(workspace);
  copyFileSync(join(homedir(),'.omp/agent/agent.db'), join(home,'.omp/agent/agent.db'));
  if (existsSync(join(homedir(),'.omp/agent/.env'))) copyFileSync(join(homedir(),'.omp/agent/.env'), join(home,'.omp/agent/.env'));   // provider key lives here on this host
  writeFileSync(join(home,'.omp/agent/config.yml'),`setupVersion: 2\nmodelRoles:\n  default: anthropic/${requestedModel}\n`);
  writeFileSync(join(workspace,'.mcp.json'),JSON.stringify({mcpServers:{study:{type:'http',url:endpoint}}}));
  // omp is installed either as a bun-run package (global node_modules) or as a standalone compiled binary on PATH.
  const modules = join(homedir(),'.cache/.bun/install/global/node_modules'), packaged = existsSync(join(modules,'@oh-my-pi/pi-coding-agent/dist/cli.js'));
  const bun = packaged ? execFileSync('readlink',['-f',execFileSync('which',['bun'],{encoding:'utf8'}).trim()],{encoding:'utf8'}).trim() : null;
  const ompBinary = packaged ? null : execFileSync('readlink',['-f',execFileSync('which',['omp'],{encoding:'utf8'}).trim()],{encoding:'utf8'}).trim();
  if (!packaged && existsSync(join(homedir(),'.omp/natives'))) { mkdirSync(join(home,'.omp'),{recursive:true}); execFileSync('cp',['-a',join(homedir(),'.omp/natives'),join(home,'.omp/natives')]); }
  const args = ['-n','bwrap','--unshare-pid','--unshare-ipc','--unshare-uts','--die-with-parent','--new-session','--ro-bind','/usr','/usr','--ro-bind','/lib','/lib',...(existsSync('/lib64') ? ['--ro-bind','/lib64','/lib64'] : []),'--ro-bind','/nix','/nix','--proc','/proc','--dev','/dev','--perms','0755','--dir','/etc','--perms','1777','--tmpfs','/tmp','--bind',home,'/agent','--bind',workspace,'/workspace','--chdir','/workspace',...(packaged ? ['--ro-bind',bun,'/bun','--perms','0755','--dir','/omp','--ro-bind',modules,'/omp/node_modules'] : ['--ro-bind',ompBinary,'/omp'])];
  for (const path of ['/etc/ssl','/etc/resolv.conf','/etc/hosts','/etc/nsswitch.conf']) if(existsSync(path)) args.push('--ro-bind',path,path);
  args.push('--clearenv','--setenv','HOME','/agent','--setenv','PATH','/usr/bin',setpriv,'--reuid='+process.getuid(),'--regid='+process.getgid(),'--clear-groups','--bounding-set=-all','--no-new-privs');
  if(check) args.push('/usr/bin/sh','-c',`test ! -e '${homedir()}' && echo PRIVATE_PATHS_ABSENT`);
  else args.push(...(packaged ? ['/bun','/omp/node_modules/@oh-my-pi/pi-coding-agent/dist/cli.js'] : ['/omp']),'-p','--mode=json','--no-tools','--no-session','--no-skills','--no-rules','--no-context-files','--no-extensions','--no-title','--model',`anthropic/${requestedModel}`,'--thinking',requestedReasoningEffort,prompt);
  return {command:'sudo', args, directory, home, cleanup:()=>rmSync(directory,{recursive:true,force:true})};
}
export const prepareBoundary = options => usesOmp ? prepareOmpBoundary(options) : prepareCodexBoundary(options);
export function ompUsage(messages) {
  const usage={input_tokens:0,cached_input_tokens:0,cache_write_input_tokens:0,output_tokens:0}; let cost=0;
  for(const message of messages){ if(message.role!=='assistant'||!message.usage) continue; const u=message.usage;
    usage.input_tokens+=(u.input||0)+(u.cacheRead||0)+(u.cacheWrite||0); usage.cached_input_tokens+=u.cacheRead||0; usage.cache_write_input_tokens+=u.cacheWrite||0; usage.output_tokens+=u.output||0; cost+=u.cost?.total||0; }
  return {usage,cost};
}
export function ompFinal(messages) {
  const last=[...messages].reverse().find(m=>m.role==='assistant'); if(!last) return {error:'no assistant message'};
  if(last.stopReason==='error'||last.errorMessage) return {error:String(last.errorMessage||'model error').slice(0,300)};
  return {result:(last.content||[]).filter(p=>p.type==='text').map(p=>p.text).join('')};
}
