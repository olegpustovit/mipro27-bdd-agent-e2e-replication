// Generate the frozen target table on stdout. This does not execute a scenario.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGherkin, scenarioSteps, selectTaggedScenario } from '../agent/answer.mjs';
import { scenarioFile } from '../runner/coded/pay.mjs';
import { agentScenario, planAgentScenario } from '../runner/moodle/agent-scenario.mjs';

const root = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const plan = JSON.parse(read('bench/plan/plan.json'));
const gate = fileURLToPath(new URL('bench/runner/check-gate', root));

function numbering(item, step) {
  if (item.app === 'mdl') {
    const { plan: handoff, id } = planAgentScenario(item);
    const original = handoff.codedSteps[step - 1];
    if (!original) throw new Error('No coded step at the planned index');
    // The source step index survives data-step removal and agent wording edits.
    const agentIndex = handoff.uiSteps.findIndex(entry => entry.index === original.index);
    return {
      coded: { step, text: `${original.keyword} ${original.text}` },
      agent: { step: agentIndex + 1, text: scenarioSteps(agentScenario(handoff, id))[agentIndex] },
    };
  }
  const file = scenarioFile(item.scenario);
  const source = read(file);
  const shared = file === 'study/scenarios.feature';
  const { feature } = parseGherkin(source);
  const entries = feature.children.flatMap(({ scenario }) =>
    scenario && (!shared || scenario.tags.some(tag => tag.name === `@${item.scenario}`)) ? [scenario] : []);
  if (entries.length !== 1) throw new Error('Expected one coded payment scenario');
  const original = entries[0].steps[step - 1];
  return {
    coded: { step, text: original.keyword + original.text },
    agent: { step, text: scenarioSteps(shared ? selectTaggedScenario(source, item.scenario) : source)[step - 1] },
  };
}

function checkGate(item) {
  const directory = mkdtempSync(join(tmpdir(), 'scoring-target-'));
  try {
    const input = join(directory, 'item.json');
    writeFileSync(input, JSON.stringify(item));
    execFileSync(gate, ['--item', input], { stdio: ['ignore', 'ignore', 'inherit'] });
  } finally {
    rmSync(directory, { recursive: true });
  }
}

const targets = {};
for (const item of plan.items.filter(item => item.condition === 'bug')) {
  const { app, version, scenario, bugId } = item;
  const key = [app, version, scenario].join('/');
  if (targets[key]) {
    if (targets[key].bug_id !== bugId) throw new Error(`Conflicting bugs for ${key}`);
    continue;
  }
  // Reuse admission's latest formal P7 check for both conditions.
  checkGate(item);
  const specification = app === 'mdl' ? plan.mdl.bugs[bugId] :
    plan.pay.scenarios.find(entry => entry.bugId === bugId && entry.id === scenario);
  const symptom = read(`bench/bugs/${bugId}/symptom.md`);
  const [, step, text] = /^Targeted step ([1-9]\d*)\s*\n> (.+)$/m.exec(symptom) ?? [];
  if (!specification || specification.targetStep !== Number(step)) {
    throw new Error(`Plan and symptom disagree on the target step for ${key}`);
  }
  const target = numbering(item, Number(step));
  if (target.coded.text !== text || !target.agent.text ||
      (app === 'pay' && target.agent.text !== target.coded.text)) {
    throw new Error(`Scenario and symptom disagree on the target for ${key}`);
  }
  targets[key] = { bug_id: bugId, kind: 're-created-from-report', ...target };
}
console.log(JSON.stringify(Object.fromEntries(Object.entries(targets).sort()), null, 2));
