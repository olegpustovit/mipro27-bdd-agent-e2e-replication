// Agent prompt for the Moodle browser arm. Data setup is already applied; only UI steps are given, numbered.
export function buildMoodlePrompt({ handoff, steps, toolCalls = 80, timeoutMs = 600000, preauth = null }) {
  // preauth: the harness already opened a session for this user in the browser, so the leading log-in step is done (same for every run).
  const numbered = steps.map((s, i) => `[${i + 1}] ${s.rendered ?? `${s.keyword} ${s.text}`}${i === 0 && preauth ? `    (already done: the browser holds an open session for "${preauth.username ?? preauth}"; do not use the log-in page${preauth.navigates ? ', but do the navigation this step names' : ''})` : ''}`).join('\n');
  const logins = handoff.credentials.length ? handoff.credentials.map(c => `  username "${c.username}", password "${c.password}"`).join('\n') : '  (none seeded; use the log-in steps as written)';
  return `Execute this Moodle acceptance scenario through the browser UI at ${handoff.baseUrl} (log-in page: ${handoff.loginUrl}). The site may work or may contain a defect. Test data is already set up on the live site; do not create users, courses or other data through admin tools and do not modify the application, inspect source, network responses or private state, or write test code. Use at most ${toolCalls} tool calls and ${Math.floor(timeoutMs / 1000)} seconds.
Accounts that exist (a step such as 'I log in as "x"' means log in through the normal log-in page with that account):
${logins}
Selector phrases in steps such as "css_element", "xpath_element", "button", "link", "field" and "table_row" describe what the user sees: find the matching visible element on the page. Do not use browser features that reveal page source.
Perform the numbered steps in order. A Given/When/And action step fails if the action cannot be done in the UI. A Then/And assertion step fails if the page does not show what it states ("should see" / "should not see" / "should exist" / "should not exist"), checking the whole visible page unless the step names a region. Stop at the first failing step.
${numbered}
End with JSON only, exactly these four keys: {"status":"pass"|"fail"|"unresolved","reason":"observed evidence","failingStep":<1-based step number above, or null on pass>,"failingStepText":"<that step's text exactly as listed, or null on pass>"}. Use "unresolved" only when you could not decide (tool failure, budget exhausted); include the last step you reached in failingStep when you can.`;
}
