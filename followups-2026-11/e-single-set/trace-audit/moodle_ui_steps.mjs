// Post-hoc helper for stream A1 (trace audit). Prints, as JSON, the UI steps the Moodle browser agent received for
// each scenario id given on stdin (one JSON object {id, feature, name} per line), using the repo's own Gherkin
// parser and data/UI split (adapters/moodle/handoff.mjs). Reads the Moodle pin checkout given as argv[2]
// (git show HEAD:<feature>, the same text assertPinScenarioText checks). No network, no writes.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
// FOLLOWUP-E-TA: copy of followups-2026-11/a-trace-audit/moodle_ui_steps.mjs; only the import paths are one level deeper.
import { planHandoff } from '../../../adapters/moodle/handoff.mjs';
import { renderStep } from '../../../adapters/moodle/gherkin.mjs';

const src = process.argv[2];
const out = {};
for (const line of readFileSync(0, 'utf8').split('\n').filter(Boolean)) {
  const { id, feature, name } = JSON.parse(line);
  const path = feature.replace(/^(?!public\/)/, 'public/');
  const text = execFileSync('git', ['show', `HEAD:${path}`], { cwd: src, encoding: 'utf8' });
  const plan = planHandoff(text, { name });
  out[id] = {
    feature: path, scenario: plan.scenario, offset: plan.dataSteps.length,
    uiSteps: plan.uiSteps.map((s, i) => ({ ui: i + 1, behatIndex: s.index, text: renderStep(s) })),
  };
}
process.stdout.write(JSON.stringify(out));
