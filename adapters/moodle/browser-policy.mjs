// Navigation policy for the Moodle browser-agent arm (loaded by scripts/mcp-browser.mjs via STUDY_POLICY_MODULE).
// Same tool surface as the pilot; navigation stays on the Behat site origin and off test-control and debug endpoints.
import { allowedTools } from '../../scripts/browser-policy.mjs';
export const MOODLE_ORIGIN = 'http://webserver';
export const DENIED_PATHS = [
  /^\/admin\/tool\/(?:behat|generator|phpunit|dbtransfer|installaddon)(?:\/|$)/i,
  /^\/admin\/(?:phpinfo|environment|cli|tool\/task\/schedule_task)(?:\.php|\/|$)/i,
  /^\/_\//,                                     // moodle-docker faildumps / mock endpoints
  /^\/(?:webservice|lib\/ajax\/service-nologin|lib\/ajax\/service)(?:\.php|\/|$)/i,   // direct API calls, not UI
  /^\/\.(?:git|env)/i, /\/(?:config|config-dist)\.php$/i, /^\/vendor\//,
];
export function validateCall(name, args = {}) {
  if (!allowedTools.has(name)) return 'This study permits browser UI tools only; code execution, filesystem and direct network tools are unavailable.';
  if (!args || typeof args !== 'object' || Array.isArray(args)) return 'Browser tool arguments must be an object.';
  if (args.filename !== undefined || args.path !== undefined) return 'File output is disabled; return observations through MCP.';
  if (name === 'browser_reload' && Object.keys(args).length) return 'Reload takes no arguments.';
  if (name === 'browser_inspect') return 'Unknown tool: browser_inspect';
  if (name === 'browser_navigate') {
    let url;
    try { url = new URL(args.url); } catch { return 'A valid application URL is required.'; }
    if (url.origin !== MOODLE_ORIGIN || url.username || url.password) return `Navigate only within ${MOODLE_ORIGIN}.`;
    if (DENIED_PATHS.some(re => re.test(url.pathname))) return 'Test-control, debug and direct API paths are unavailable to the testing agent.';
  }
  return null;
}
