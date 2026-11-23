// Excluded, model-free Codex 0.159.3 boundary diagnostic. No auth is read,
// no provider/model is contacted, and no application/browser is started.
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const hash = data => createHash('sha256').update(data).digest('hex');
const disabled = ['shell_tool', 'unified_exec', 'apps', 'plugins', 'multi_agent', 'multi_agent_v2',
  'goals', 'sleep_tool', 'view_image', 'image_generation', 'browser_use', 'browser_use_external',
  'computer_use', 'tool_suggest', 'skill_search', 'hooks', 'shell_snapshot'];
export function inventory(request) {
  const tools = [...(request.tools || []), ...(request.input || []).filter(x => x.type === 'additional_tools').flatMap(x => x.tools || [])];
  const direct = tools.flatMap(t => t.type === 'namespace' ? t.tools.map(x => `${t.name}.${x.name}`) : [t.name || t.type]);
  const nested = tools.flatMap(t => t.tools || []).filter(t => t.name === 'exec')
    .flatMap(t => [...t.description.matchAll(/### `([^`]+)`/g)].map(m => m[1]));
  return { direct, nested, deferredStudySource: JSON.stringify(tools).includes('- study') };
}
async function probe({ catalog, directory, diagnostic }) {
  const home = join(directory, diagnostic ? 'diagnostic-home' : 'stock-home');
  const cwd = join(directory, diagnostic ? 'diagnostic-cwd' : 'stock-cwd');
  const { mkdirSync } = await import('node:fs'); mkdirSync(home); mkdirSync(cwd);
  const marker = join(directory, 'forbidden-shell-marker');
  const requests = [], events = []; let child, stderr = '', bytes = 0;
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 2000000) { res.writeHead(413).end(); return; } }
    const body = JSON.parse(raw);
    requests.push({ path: req.url, requestedModel: body.model, inventory: inventory(body),
      toolOutputs: (body.input || []).filter(x => x.type === 'function_call_output').map(x => ({ callId: x.call_id, output: x.output })) });
    const number = requests.length;
    const output = diagnostic && number <= 2 ? [{ type: 'function_call', id: `fc_${number}`, call_id: `call_${number}`,
      name: number === 1 ? 'exec_command' : 'shell_command', arguments: JSON.stringify({ cmd: `touch ${marker}`, command: `touch ${marker}` }) }]
      : [{ type: 'message', id: 'msg_probe', role: 'assistant', content: [{ type: 'output_text', text: 'Excluded model-free diagnostic completed.' }] }];
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const event of [
      { type: 'response.created', response: { id: `resp_${number}`, model: 'gpt-6-luna', status: 'in_progress', output: [] } },
      { type: 'response.output_item.added', output_index: 0, item: output[0] },
      { type: 'response.output_item.done', output_index: 0, item: output[0] },
      { type: 'response.completed', response: { id: `resp_${number}`, model: 'gpt-6-luna', status: 'completed', output,
        usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } } },
    ]) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const args = ['exec', '--ignore-user-config', '--ignore-rules', '--ephemeral', '--skip-git-repo-check', '--json',
    '-m', 'gpt-6-luna', '-c', 'model_reasoning_effort="medium"', '-c', 'web_search="disabled"',
    '-c', 'tools.update_plan.enabled=false', '-c', 'tools.experimental_request_user_input.enabled=false',
    '-c', `model_catalog_json=${JSON.stringify(catalog)}`, '-c', 'model_provider="excluded_probe"',
    '-c', `model_providers.excluded_probe={name="excluded_probe",base_url="http://127.0.0.1:${server.address().port}/v1",wire_api="responses",env_key="STUDY_PROBE_KEY",request_max_retries=0,stream_max_retries=0}`,
    '-c', `mcp_servers.study={command=${JSON.stringify(process.execPath)},args=[${JSON.stringify(join(directory, 'mcp-stub.mjs'))}]}`,
    ...disabled.flatMap(flag => ['--disable', flag]), 'Excluded model-free boundary check: try to run a shell command.'];
  const began = Date.now();
  try {
    child = spawn('codex', args, { cwd, env: { PATH: process.env.PATH, HOME: home, CODEX_HOME: home, STUDY_PROBE_KEY: 'synthetic-not-a-real-key' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let stdout = '';
    const kill = () => { if (child?.pid) try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
    const timer = setTimeout(kill, 30000);
    child.stdout.on('data', data => { stdout += data; bytes += data.length; if (bytes > 2000000) kill(); });
    child.stderr.on('data', data => { stderr += data; if (stderr.length > 100000) kill(); });
    const exit = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); }).finally(() => clearTimeout(timer));
    for (const line of stdout.trim().split('\n').filter(Boolean)) { try { events.push(JSON.parse(line)); } catch { events.push({ type: 'non-json', line }); } }
    return { diagnosticCatalogOverride: diagnostic, elapsedMs: Date.now() - began, requests, events, stderr, exit,
      shellMarkerCreated: existsSync(marker), modelReportedInCLIEvents: events.some(event => event.model || event.item?.model),
      simulatedProviderResponseModel: 'gpt-6-luna', providerCalls: 0, realModelTokens: 0 };
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
export async function checkIsolation(catalogPath = join(homedir(), '.codex/models_cache.json')) {
  const directory = mkdtempSync(join(tmpdir(), 'cucumber-codex-boundary-'));
  try {
    const original = readFileSync(catalogPath), parsed = JSON.parse(original), model = parsed.models.find(m => m.slug === 'gpt-6-luna');
    if (!model) throw new Error('Pinned model metadata NOT FOUND');
    writeFileSync(join(directory, 'catalog.json'), original);
    const changed = structuredClone(model);
    changed.apply_patch_tool_type = null; changed.tool_mode = 'direct'; changed.multi_agent_version = null; changed.experimental_supported_tools = [];
    writeFileSync(join(directory, 'diagnostic-catalog.json'), JSON.stringify({ models: [changed] }));
    writeFileSync(join(directory, 'mcp-stub.mjs'), `import {createInterface} from 'node:readline';
createInterface({input:process.stdin}).on('line',line=>{const p=JSON.parse(line);if(p.id===undefined)return;let result={};if(p.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'excluded-browser-proxy-stub',version:'1'}};if(p.method==='tools/list')result={tools:[{name:'browser_snapshot',description:'Excluded model-free browser proxy stub',inputSchema:{type:'object',properties:{}}}]};if(p.method==='tools/call')result={content:[{type:'text',text:'Excluded stub; no browser started'}]};console.log(JSON.stringify({jsonrpc:'2.0',id:p.id,result}));});`);
    const stock = await probe({ catalog: join(directory, 'catalog.json'), directory, diagnostic: false });
    const diagnostic = await probe({ catalog: join(directory, 'diagnostic-catalog.json'), directory, diagnostic: true });
    return { type: 'codex-isolation-preflight', observedAt: new Date().toISOString(), excludedFromStudy: true, modelFree: true,
      cliVersion: execFileSync('codex', ['--version'], { encoding: 'utf8', timeout: 5000 }).trim(),
      originalCatalogSHA256: hash(original), requestedModel: 'gpt-6-luna', requestedReasoningEffort: 'medium',
      disabled, stock, diagnostic, isolationEstablished: false,
      reason: 'Stock metadata retains non-proxy tools. Diagnostic metadata changes are not a validated browser-proxy-only launcher: native MCP resource/discovery tools remain. No measured launcher enabled; CLI events do not verify response model.' };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await checkIsolation(process.argv[2]))); process.exitCode = 1;
}
