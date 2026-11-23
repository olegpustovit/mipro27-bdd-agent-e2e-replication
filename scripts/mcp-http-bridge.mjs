import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
// Only a transport: every request is handled by the unchanged restricted proxy.
export async function createBrowserBridge({ env, proxyPath }) {
 const child=spawn(process.execPath,[proxyPath],{env,stdio:['pipe','pipe','pipe']});
 let serial=0, stderr=''; const pending=new Map();
 child.stderr.on('data',d=>{stderr+=d;if(stderr.length>1000000)child.kill('SIGKILL')});
 createInterface({input:child.stdout}).on('line',line=>{const m=JSON.parse(line);const p=pending.get(m.id);if(p){pending.delete(m.id);m.id=p.id;p.res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(m));}});
 const closed=new Promise(resolve=>child.once('close',(code,signal)=>{for(const p of pending.values())p.res.writeHead(503).end();pending.clear();resolve({code,signal,stderr});}));
 const server=createServer(async(req,res)=>{if(req.method!=='POST'){res.writeHead(req.method==='DELETE'?200:405).end();return;}let raw='';for await(const b of req){raw+=b;if(raw.length>2000000){res.writeHead(413).end();return;}}try{const m=JSON.parse(raw);if(m.id===undefined){child.stdin.write(JSON.stringify(m)+'\n');res.writeHead(202).end();return;}const id=++serial;pending.set(id,{id:m.id,res});m.id=id;child.stdin.write(JSON.stringify(m)+'\n');}catch{res.writeHead(400).end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 return {endpoint:`http://127.0.0.1:${server.address().port}/mcp`, close:async()=>{child.stdin.end();const timer=setTimeout(()=>child.kill('SIGKILL'),10000);const result=await closed;clearTimeout(timer);server.closeAllConnections();await new Promise(r=>server.close(r));return result;}};
}
