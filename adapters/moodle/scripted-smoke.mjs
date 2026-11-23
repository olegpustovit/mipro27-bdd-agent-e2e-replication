// Model-free smoke of the agent arm's plumbing: drives the same restricted MCP proxy a model would use.
// Proves: generator hand-off left the seeded site live, the browser resolves the Behat origin, login works through the
// UI, the seeded course is visible, and the navigation policy blocks test-control paths. Not a measured trial.
import { openAgentSession } from './agent-session.mjs';

export function mcpClient(endpoint) {
  let id = 0;
  const post = async body => { const r = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return r.status === 202 ? null : r.json(); };
  return {
    async init() { await post({ jsonrpc: '2.0', id: ++id, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'scripted-smoke', version: '1' } } }); await post({ jsonrpc: '2.0', method: 'notifications/initialized' }); },
    async call(name, args = {}) { const r = await post({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }); return { isError: Boolean(r.result?.isError || r.error), text: (r.result?.content ?? []).map(c => c.text ?? '').join('\n') || JSON.stringify(r.error ?? '') }; },
    async tools() { return (await post({ jsonrpc: '2.0', id: ++id, method: 'tools/list', params: {} })).result.tools.map(t => t.name); },
  };
}
const refOf = (snapshot, pattern) => { const m = new RegExp(`${pattern}[^\\n]*\\[ref=([a-z0-9]+)\\]`, 'i').exec(snapshot); return m?.[1]; };

export async function scriptedLoginSmoke(adapter, handoff, { course = 'Course 1' } = {}) {
  const session = await openAgentSession({ adapter, toolCalls: 30 }), out = { run: 'smoke-not-a-measured-trial', arm: 'scripted-driver', checks: {} };
  const t0 = performance.now();
  try {
    const raw = mcpClient(session.endpoint); await raw.init(); out.trace = [];
    const mcp = { ...raw, async call(name, args) { const r = await raw.call(name, args); out.trace.push(`${name} ${r.isError ? 'ERROR ' + r.text.replace(/\x1b\[[0-9;]*m/g, '').slice(0, 160).replace(/\n/g, ' ') : 'ok'}`); return r; } };
    out.tools = await mcp.tools();
    const cred = handoff.credentials[0];
    await mcp.call('browser_navigate', { url: handoff.loginUrl });
    // A model re-reads the page before each action and retries after a timeout (cold browser, Moodle re-rendering the form).
    const act = async (tool, pattern, extra = {}) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const snap = (await mcp.call('browser_snapshot')).text, target = refOf(snap, pattern);
        if (!target) return false;
        const r = await mcp.call(tool, { target, ...extra }); if (!r.isError) return true;
      }
      return false;
    };
    out.checks.loginFormFound = /textbox "Username/.test((await mcp.call('browser_snapshot')).text);
    await act('browser_type', 'textbox "Username', { text: cred.username });
    await act('browser_type', 'textbox "Password', { text: cred.password });
    await act('browser_click', 'button "Log in');
    await mcp.call('browser_wait_for', { text: 'Dashboard' });
    await mcp.call('browser_navigate', { url: `${handoff.baseUrl}/my/courses.php` });
    await mcp.call('browser_wait_for', { text: course });
    const courses = await mcp.call('browser_snapshot');
    out.checks.loggedIn = /Log out|User menu|Teacher/.test(courses.text) && !/Log in to the site/.test(courses.text);
    out.checks.seededCourseVisible = courses.text.includes(course);
    if (!out.checks.loggedIn || !out.checks.seededCourseVisible) out.snapshotHead = courses.text.slice(0, 1500);
    const blocked = await mcp.call('browser_navigate', { url: `${handoff.baseUrl}/admin/tool/behat/index.php` });
    out.checks.controlPathBlocked = blocked.isError;
    const offsite = await mcp.call('browser_navigate', { url: 'http://localhost:3000/' });
    out.checks.otherOriginBlocked = offsite.isError;
    out.ms = Math.round(performance.now() - t0); out.toolCalls = session.ledger.filter(e => e.type === 'tool-call').length;
    out.ok = Object.values(out.checks).every(Boolean);
  } finally { out.proxyExit = await session.close(); }
  return out;
}
