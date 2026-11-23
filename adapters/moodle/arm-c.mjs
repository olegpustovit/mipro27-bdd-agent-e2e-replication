// Arm C trial: a browser agent runs one scenario against the live site, through the restricted MCP proxy.
// Hand-off (identical for every state, model and repetition): data steps through Moodle's generators, then the harness
// logs in as the scenario's first "I log in as" user in the agent's browser (cookie session), so the agent never has to use the
// log-in form. Reason: Playwright MCP refs go stale on Moodle's log-in form (the page re-renders after the first snapshot),
// which made agents burn tool calls on the form rather than on the scenario. The agent is told that step is already done.
import { chromium } from 'playwright';
import { prepareForAgent } from './handoff.mjs';
import { openAgentSession } from './agent-session.mjs';
import { buildMoodlePrompt } from './prompt.mjs';
import { decodeStepVerdict } from './verdict.mjs';
import { runAgentProcess, isolationCheck } from './agent-run.mjs';

// Leading steps that start with a log-in: `I log in as "u"` (login only) and `I am on the "X" "type" page logged in as u` / `I am logged in as u`
// (login plus navigation: the agent still has to navigate).
const LOGIN = /^I log in as "([^"]+)"$/, LOGIN_AND_GO = /^I am on the .+ page logged in as "?([\w.-]+)"?$/, LOGGED_IN = /^I am logged in as "?([\w.-]+)"?$/;
export function loginOf(text) {
  let m;
  if ((m = LOGIN.exec(text))) return { user: m[1], navigates: false };
  if ((m = LOGIN_AND_GO.exec(text))) return { user: m[1], navigates: true };
  if ((m = LOGGED_IN.exec(text))) return { user: m[1], navigates: false };
  return null;
}
export async function preAuthenticate(session, handoff) {
  const first = handoff.uiSteps[0], login = first && loginOf(first.text), user = login?.user;
  if (!user) return { done: false, reason: 'scenario does not start with a log-in step' };
  const cred = handoff.credentials.find(c => c.username === user) ?? { username: user, password: user };
  const t0 = performance.now(), browser = await chromium.connectOverCDP(session.cdpEndpoint);
  try {
    const context = browser.contexts()[0], page = context.pages()[0] ?? await context.newPage();
    await page.goto(handoff.loginUrl, { waitUntil: 'domcontentloaded' });
    await page.fill('#username', cred.username); await page.fill('#password', cred.password);
    await Promise.all([page.waitForURL(u => !/\/login\//.test(u.pathname), { timeout: 30000 }), page.click('#loginbtn')]);
    await page.goto(`${handoff.baseUrl}/my/`, { waitUntil: 'domcontentloaded' });
    return { done: true, username: user, navigates: login.navigates, ms: Math.round(performance.now() - t0) };
  } finally { await browser.close().catch(() => {}); }   // closing a CDP connection leaves the browser and its cookies running
}

export async function runArmC({ adapter, feature, line, model, toolCalls = 60, timeoutMs = 300000, preauth = true }) {
  const t0 = performance.now();
  const handoff = await prepareForAgent(adapter, { feature, line });
  const session = await openAgentSession({ adapter, toolCalls });
  try {
    const auth = preauth ? await preAuthenticate(session, handoff) : { done: false, reason: 'disabled' };
    const prompt = buildMoodlePrompt({ handoff, steps: handoff.uiSteps, toolCalls, timeoutMs, preauth: auth.done ? { username: auth.username, navigates: auth.navigates } : null });
    const fixtureMs = Math.round(performance.now() - t0);
    const isolation = await isolationCheck(model);
    if (!isolation.ok) throw new Error(`Agent sandbox self-check failed: ${JSON.stringify(isolation)}`);   // never run an agent without the boundary
    const run = await runAgentProcess({ model, endpoint: session.endpoint, prompt, timeoutMs });
    const calls = session.ledger.filter(e => e.type === 'tool-call');
    const verdict = decodeStepVerdict(run.result, handoff.uiSteps, { offset: handoff.uiStepIndexOffset });
    const proxyExit = await session.close();
    return { arm: 'C', model, isolation, handoff: { dataMs: handoff.dataMs, uiStepCount: handoff.uiStepCount, uiStepIndexOffset: handoff.uiStepIndexOffset, scenario: handoff.scenario }, preauth: auth,
      status: verdict.reportedStatus, behatStepIndex: verdict.behatStepIndex, failingStepVerified: verdict.failingStepVerified, verdict,
      toolCalls: calls.length, tools: calls.map(c => `${c.name}${c.arguments?.url ? ' ' + c.arguments.url : ''}`), fatal: session.ledger.filter(e => e.type === 'fatal-infrastructure'), proxyExit: { code: proxyExit?.code, signal: proxyExit?.signal },
      process: { code: run.code, signal: run.signal, timedOut: run.timedOut, providerError: run.providerError, models: run.models, requestIds: run.requestIds, stderrTail: run.stderrTail },
      usage: run.usage, costUsd: run.costUsd, wall: { totalMs: Math.round(performance.now() - t0), modelMs: run.modelMs, fixtureMs }, agentMs: run.elapsedMs, rawEvents: run.rawEvents };
  } finally { await session.close().catch(() => {}); }
}
