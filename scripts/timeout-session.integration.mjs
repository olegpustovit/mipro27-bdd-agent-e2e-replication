// Model-free lifecycle calibration of the actual runner and browser proxy.
// Requires the pinned app. The temporary CLI stub calls no language model.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { manifest } from '../study/manifest.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = mkdtempSync(join(tmpdir(), 'excluded-cli-transport-stub-'));
let evidence;
const stub = `#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
if(process.argv.includes('--version')){console.log('${manifest.cliVersion} transport-calibration-stub');process.exit(0);}
const args=process.argv.slice(2), config=JSON.parse(args[args.indexOf('--mcp-config')+1]).mcpServers.study;
const proxy=spawn(config.command,config.args,{env:{...process.env,...config.env},stdio:['pipe','pipe','inherit']});
process.on('SIGTERM',()=>{}); // Wait for the real proxy's shutdown report.
console.log(JSON.stringify({type:'transport-calibration-stub',stubPid:process.pid,message:{model:'transport-calibration-stub'}}));
createInterface({input:proxy.stdout}).on('line',line=>{
 const response=JSON.parse(line);
 if(response.id===1){
  if(!response.result){console.error(line);process.exit(2);}
  proxy.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\\n');
  proxy.stdin.write(JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'browser_navigate',arguments:{url:'http://localhost:3000/signin'}}})+'\\n');
 }
 if(response.id===2)proxy.stdin.write(JSON.stringify({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'browser_wait_for',arguments:{time:30}}})+'\\n');
});
proxy.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'excluded-timeout-stub',version:'1'}}})+'\\n');
proxy.on('close',()=>process.exit(0));
`;
try {
  writeFileSync(join(directory, 'claude'), stub, { mode: 0o700, flag: 'wx' });
  const child = spawn(process.execPath, ['scripts/runner.mjs', '--session-check'], {
    cwd: root, env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, STUDY_SESSION_TIMEOUT_MS: '5000' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  const events = stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  evidence = { stdout, stderr, code };
  assert.equal(code, 0, stderr);
  assert.equal(events.some(e => e.type === 'trial-error'), false);
  const trial = events.find(e => e.type === 'trial-end');
  assert.equal(trial?.excludedFromStudy, true);
  assert.equal(trial?.timedOut, true);
  assert.equal(trial?.correctPass, false); assert.equal(trial?.detectionCandidate, false);
  const deadline = events.findIndex(e => e.type === 'agent-deadline');
  const called = events.findIndex(e => e.type === 'tool-event' && e.event.type === 'tool-call' && e.event.name === 'browser_wait_for');
  assert(called >= 0 && deadline > called, 'timeout must interrupt an actual active browser tool');
  assert.equal(events.slice(0, deadline).some(e => e.type === 'tool-event' && e.event.type === 'tool-result' && e.event.id === 3), false);
  assert(trial.ledger.some(e => e.type === 'fatal-infrastructure' && e.receivedAt >= events[deadline].at), 'shutdown fatal report must reach actual parent');
  const stubPid = events.find(e => e.type === 'agent-event' && e.event.type === 'transport-calibration-stub').event.stubPid;
  const remaining = execFileSync('ps', ['-eo', 'pid=,pgid='], { encoding: 'utf8' }).trim().split('\n').map(line => line.trim().split(/\s+/).map(Number)).filter(([, group]) => group === stubPid);
  assert.deepEqual(remaining, [], 'owned process group must be gone before runner finishes');
  console.log(JSON.stringify({ type: 'timeout-session-calibration', excludedFromStudy: true, languageModelUsed: false, ok: true, activeBrowserToolInterrupted: true, shutdownFatalRetained: true, timeoutPreserved: true, noPassOrDetection: true, ownedProcessGroupGone: true, rawSha256: createHash('sha256').update(stdout).digest('hex'), rawNdjson: stdout, stderr }));
} catch (error) {
  console.log(JSON.stringify({ type: 'timeout-session-calibration', excludedFromStudy: true, languageModelUsed: false, ok: false, error: error.stack, rawNdjson: evidence?.stdout, stderr: evidence?.stderr }));
  process.exitCode = 1;
} finally { rmSync(directory, { recursive: true, force: true }); }
