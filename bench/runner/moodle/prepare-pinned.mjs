import { readFile } from 'node:fs/promises';
import { planAgentScenario, writeAgentScenario } from './agent-scenario.mjs';
import { runSetup } from './handoff.mjs';
import { pinnedMoodle } from './pinned.mjs';

const [web, itemPath, out] = process.argv.slice(2);
const item = JSON.parse(await readFile(itemPath, 'utf8'));
const { plan } = planAgentScenario(item);
if (plan.dataSteps.length) await runSetup(pinnedMoodle(web), plan.dataSteps, 90_000);
await writeAgentScenario(item, out);
