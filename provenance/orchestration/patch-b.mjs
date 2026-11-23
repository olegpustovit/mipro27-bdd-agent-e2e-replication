import fs from 'node:fs';
const sub = (f, a, b) => { const t = fs.readFileSync(f, 'utf8'); if (t.split(a).length !== 2) throw new Error('anchor ' + f + ': ' + a.slice(0, 60)); fs.writeFileSync(f, t.replace(a, () => b)); };
sub('scripts/browser-reload.mjs', "await pages[0].reload({ waitUntil: 'load', timeout: 15000 });",
  "await pages[0].reload({ waitUntil: 'load', timeout: 15000 });\n    // Campaign A returned its snapshot at `load`, before the page's data requests finished, so a page could look empty when it was not.\n    await pages[0].waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});");
const R = 'scripts/exploratory-runner.mjs';
sub(R, "  const lock = acquireLock(); const deadline",
  "  // Campaign B: runtime arm only, against campaign A's frozen step code. No maintenance session runs.\n  const rerunFrom = process.env.STUDY_RUNTIME_RERUN_FROM;\n  if (rerunFrom) for (const line of all(join(homedir(), '.local/share/cucumber-study/runs', rerunFrom, 'events.jsonl')).filter(e => e.type === 'maintenance-record' && e.frozen?.implementation)) if (!all(eventPath).some(e => e.type === 'maintenance-restored' && e.revision === line.revision)) state.restore(line.revision, line.from, line.frozen.implementation);\n  const lock = acquireLock(); const deadline");
sub(R, "      if (stage.kind === 'maintenance') {\n", "      if (stage.kind === 'maintenance' && rerunFrom) continue;\n      if (stage.kind === 'maintenance') {\n");
sub(R, "      for (const trial of stage.trials) {\n", "      for (const trial of stage.trials.filter(t => !rerunFrom || t.arm === 'runtime')) {\n");
fs.appendFileSync('study/EXPLORATORY-PROTOCOL.md', `
## Campaign B: corrected reload tool, runtime arm only

Decided at 2026-11-01 12:35 UTC, after campaign A finished, and therefore post-hoc. Reading a campaign A trace showed that \`browser_reload\` returned its snapshot at \`load\`, before the page's data requests finished. The agent reported an empty bank list; the private observer shows the bank appeared. That is a harness defect, not a property of the approach.

- Change: \`browser_reload\` also waits for network idle, for at most 5 seconds. Nothing else changes.
- Campaign B repeats all 108 runtime executions, with the same stages, order, model and limits, against campaign A's frozen step code. The maintained arm is not repeated, because Cucumber's assertions wait for their elements.
- Campaign A stays recorded and reported unchanged. Any report gives both, and says B came after seeing A. The same adjudication rules apply, by a fresh adjudicator.
- This is not a free retry: every B run counts, whichever way it goes.
`);

