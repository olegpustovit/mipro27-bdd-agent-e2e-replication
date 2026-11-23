// Minimal MCP server over HTTP (JSON responses) for study-owned tools, e.g. the arm-B repair tools. Same transport shape as
// scripts/mcp-http-bridge.mjs: POST JSON-RPC, requests answered inline, notifications answered 202. Listens on loopback only.
import { createServer } from 'node:http';

export async function createMcpServer({ name = 'study', tools, onCall = () => {} }) {
  const byName = new Map(tools.map(t => [t.name, t]));
  const rpc = async m => {
    if (m.method === 'initialize') return { protocolVersion: m.params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} }, serverInfo: { name, version: '1' } };
    if (m.method === 'ping') return {};
    if (m.method === 'tools/list') return { tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) };
    if (m.method === 'tools/call') {
      const tool = byName.get(m.params?.name), began = performance.now();
      if (!tool) return { isError: true, content: [{ type: 'text', text: `Unknown tool ${m.params?.name}` }] };
      let out;
      try { const value = await tool.handler(m.params.arguments ?? {}); out = { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] }; }
      catch (e) { out = { isError: true, content: [{ type: 'text', text: String(e.message ?? e) }] }; }
      onCall({ tool: m.params.name, arguments: m.params.arguments ?? {}, isError: Boolean(out.isError), ms: Math.round(performance.now() - began), at: new Date().toISOString() });
      return out;
    }
    throw Object.assign(new Error(`Method not found: ${m.method}`), { code: -32601 });
  };
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(req.method === 'DELETE' ? 200 : 405).end(); return; }
    let raw = ''; for await (const b of req) { raw += b; if (raw.length > 2e6) { res.writeHead(413).end(); return; } }
    let m; try { m = JSON.parse(raw); } catch { res.writeHead(400).end(); return; }
    if (m.id === undefined) { res.writeHead(202).end(); return; }
    try { const result = await rpc(m); res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result })); }
    catch (e) { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: m.id, error: { code: e.code ?? -32603, message: e.message } })); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { endpoint: `http://127.0.0.1:${server.address().port}/mcp`, close: async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); } };
}
