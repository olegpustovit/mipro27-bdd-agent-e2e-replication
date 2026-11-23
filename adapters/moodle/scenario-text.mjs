// The scenario text every arm runs. Arms A, B and C must run the SAME scenario text on a pair (the developers' feature files at the pin, in every break class), so the target
// step index means the same step for every arm. `scenarioTextSha` hashes the canonical text of one scenario (name, tags, Background and scenario steps with tables/doc strings,
// outline examples); `assertPinScenarioText` compares the worker's tree (in whatever state the trial runs) with the clean pin (`git show HEAD:<feature>` in the source tree).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFeature, renderStep } from './gherkin.mjs';
import { run } from './shell.mjs';

export function scenarioText(featureText, name) {
  const f = parseFeature(featureText), hits = f.scenarios.filter(s => s.name === name);
  if (hits.length !== 1) throw new Error(`Scenario "${name}": ${hits.length} matches`);
  const s = hits[0], out = [`Feature: ${f.name}`, `Scenario(${s.kind}): ${s.name} @${s.tags.join(' @')}`];
  for (const st of f.background?.steps ?? []) out.push(`B ${renderStep(st)}`);
  for (const st of s.steps) out.push(`S ${renderStep(st)}`);
  for (const e of s.examples) out.push(`E ${(e.header ?? []).join('|')}`, ...e.rows.map(r => `E ${r.cells.join('|')}`));
  return out.join('\n');
}
export const scenarioTextSha = (featureText, name) => createHash('sha256').update(scenarioText(featureText, name)).digest('hex');
// `loc` = locateScenario(...) of the trial's state (feature path under the Moodle root, name). Throws when the tree's scenario text differs from the pin's.
export async function assertPinScenarioText(srcDir, loc) {
  const here = scenarioTextSha(readFileSync(join(srcDir, loc.feature), 'utf8'), loc.name);
  const pinText = (await run('git', ['show', `HEAD:${loc.feature}`], { cwd: srcDir })).stdout, pin = scenarioTextSha(pinText, loc.name);
  if (here !== pin) throw new Error(`Scenario text of ${loc.id ?? loc.name} differs from the pin's (${here.slice(0, 12)} vs ${pin.slice(0, 12)}): every arm must run the developers' Gherkin`);
  return here;
}
