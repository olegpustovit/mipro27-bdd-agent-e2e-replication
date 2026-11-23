export const allowedTools = new Set([
  'browser_navigate', 'browser_navigate_back', 'browser_snapshot', 'browser_click',
  'browser_drag', 'browser_hover', 'browser_type', 'browser_press_key',
  'browser_select_option', 'browser_fill_form', 'browser_wait_for',
  'browser_handle_dialog',
  'browser_reload',
  'browser_inspect',
]);

export function validateCall(name, args = {}) {
  if (!allowedTools.has(name)) return 'This study permits browser UI tools only; code execution, filesystem and direct network tools are unavailable.';
  if (!args || typeof args !== 'object' || Array.isArray(args)) return 'Browser tool arguments must be an object.';
  if (args.filename !== undefined || args.path !== undefined) return 'File output is disabled; return observations through MCP.';
  if (name === 'browser_reload' && Object.keys(args).length) return 'Reload takes no arguments.';
  if (name === 'browser_inspect' && (Object.keys(args).length !== 1 || typeof args.target !== 'string' || !/^e[0-9]+$/.test(args.target))) return 'Inspect requires only one current visible element reference (target).';
  if (name === 'browser_navigate') {
    let url;
    try { url = new URL(args.url); } catch { return 'A valid application URL is required.'; }
    if (url.origin !== 'http://localhost:3000' || url.username || url.password) return 'Navigate only within http://localhost:3000.';
    if (/^\/(?:testData|__study|__oracle)(?:\/|$)/i.test(url.pathname)) return 'Fixture-control and oracle paths are unavailable to the testing agent.';
    if (!/^\/(?:signin|signup|public|personal|contacts|notifications|user\/settings|bankaccounts(?:\/new)?|transaction\/[A-Za-z0-9_-]+)?$/.test(url.pathname) || url.search) return 'Only application UI routes are permitted; source, development-server endpoints and direct API paths are unavailable.';
  }
  return null;
}
