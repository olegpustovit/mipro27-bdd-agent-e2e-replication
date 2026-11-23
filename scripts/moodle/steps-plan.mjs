#!/usr/bin/env node
// Model-free plan: run arm B's starting state `broken-steps:Bxx` (new UI + the developers' new .feature files + old step definitions) over every scenario a break was run in,
// for the breaks where that state differs from `broken:Bxx` (identical_to_broken false). No model is called.
//   node scripts/moodle/steps-plan.mjs --name moodle-v1-steps-r1 --workers w1,w2,w3  -> study/moodle/<name>-{spec,plan}.json
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadManifest } from '../../adapters/moodle/manifest.mjs';
import { repoRoot } from '../../adapters/moodle/config.mjs';
import { argOf } from './common.mjs';
import { v1Trials } from './v1-plan.mjs';

const name = argOf('name'), workers = argOf('workers', 'w1,w2,w3').split(','), manifest = loadManifest();
const spec = v1Trials(manifest).filter(t => t.state.startsWith('broken-steps:')).map(t => ({ scenario: t.scenario, state: t.state, round: 1 }));
writeFileSync(join(repoRoot, `study/moodle/${name}-spec.json`), JSON.stringify(spec, null, 1) + '\n');
const plan = { plan: name, models: [], drivers: [], prompts: {}, pinPatterns: ['adapters/moodle/adapter.mjs', 'adapters/moodle/behat-runner.mjs', 'adapters/moodle/gherkin.mjs', 'adapters/moodle/manifest.mjs', 'adapters/moodle/states.mjs', 'adapters/moodle/shell.mjs',
    'adapters/moodle/lock.mjs', 'adapters/moodle/config.mjs', 'docker/moodle/versions.json', 'docker/moodle/behat/*', 'manifests/moodle.yaml', 'manifests/moodle/patches/*', 'scripts/moodle/common.mjs', 'scripts/moodle/v1-plan.mjs', 'scripts/moodle/v1-run.mjs', 'scripts/ledger/*.mjs', `study/moodle/${name}-spec.json`],
  tasks: workers.map(w => ({ key: `v1:${name}/${w}`, cmd: ['node', 'scripts/moodle/v1-run.mjs', '--worker', w, '--workers', workers.join(','), '--spec', `study/moodle/${name}-spec.json`] })) };
writeFileSync(join(repoRoot, `study/moodle/${name}-plan.json`), JSON.stringify(plan, null, 1) + '\n');
console.log(`${name}: ${spec.length} trials over ${new Set(spec.map(t => t.state)).size} states, workers ${workers.join(',')}`);
