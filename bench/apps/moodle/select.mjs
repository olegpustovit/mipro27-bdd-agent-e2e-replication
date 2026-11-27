#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { renderStep } from '../../../adapters/moodle/gherkin.mjs';

const scenarioMode = process.argv[2];
if (scenarioMode && !['--write-scenarios', '--check-scenarios'].includes(scenarioMode)) {
  throw new Error('Usage: node select.mjs [--write-scenarios|--check-scenarios]');
}
const emitted = new Map();
const here = name => new URL(name, import.meta.url);
const json = name => JSON.parse(readFileSync(here(name)));
const pool = json('mining-output.json');
const incompatible = json('runtime-incompatibilities.json');
const evidence = new Map();
for (const line of readFileSync(here('probe-results.jsonl'), 'utf8').trim().split('\n')) {
  const row = JSON.parse(line);
  if (evidence.has(row.id)) throw new Error(`Duplicate technical evidence for ${row.id}`);
  evidence.set(row.id, row);
}
const fixed = json('../../plan/plan.json').mdl.changes;
const hasRuntime = (build, commit) => build?.status === 'ready' && build.commit === commit &&
  /^8\.3\./.test(build.runtime?.php) && /^17\./.test(build.runtime?.postgres);
const originalText = row => row.steps
  ? row.steps.map(step => ({ ...step, rendered: renderStep(step) }))
  : null;
const digest = data => createHash('sha256').update(JSON.stringify(data)).digest('hex');
const tags = items => (items?.length ? [items.map(tag => '@' + tag).join(' ')] : []);

const changes = pool.map(({ id, tracker, pre, post, firstUiCommittedAt, scenarios, editedFeatures }) => {
  const record = { id, tracker, pre, post, firstUiCommittedAt, editedFeatures, scenarios: [] };
  const constraint = incompatible[id];
  if (constraint) {
    if (constraint.commit !== pre || constraint.compatible !== false) {
      throw new Error(`Invalid platform evidence for ${id}`);
    }
    return {
      ...record,
      decision: 'rejected',
      reason: `PHP 8.3 cannot install the pre-change Behat dependencies. ${constraint.package} ${constraint.version} requires PHP ${constraint.requiresPhp}.`,
      platformEvidence: constraint,
    };
  }

  const proof = evidence.get(id);
  if (!proof) {
    return { ...record, decision: 'pending', reason: 'Missing pre/post runtime and scenario checks.' };
  }
  record.builds = proof.builds;
  if (!hasRuntime(proof.builds.pre, pre) || !hasRuntime(proof.builds.post, post)) {
    const failures = ['pre', 'post'].filter(phase => !hasRuntime(proof.builds[phase], record[phase]));
    return {
      ...record,
      decision: 'rejected',
      reason: `Working site and Behat seed failed the pinned runtime check for the ${failures.join(' and ')} commit(s).`,
    };
  }
  record.scenarios = scenarios.map(({ id: scenario, name }) => {
    const before = proof.scenarios[scenario]?.pre;
    const after = proof.scenarios[scenario]?.post;
    if (!before || !after) throw new Error(`Missing phase checks for ${id}.${scenario}`);
    const eligible = before.coded === 'passed' && before.setup === 'passed' && after.setup === 'passed';
    const codedOnly = !eligible && before.coded === 'passed' && Boolean(after.steps) &&
      fixed.some(change => change.id === id && change.scenarios.some(([key]) => key === scenario));
    const phase = row => {
      const text = originalText(row);
      return {
        feature: row.feature ?? null,
        line: row.line ?? null,
        textSha256: text ? digest([row.name, row.featureTags, row.scenarioTags, text]) : null,
        setup: row.setup ?? 'unverified',
        ...(row.reason ? { reason: row.reason } : {}),
      };
    };
    const row = {
      id: scenario, name, codedBefore: before.coded ?? 'unverified',
      decision: eligible ? 'eligible' : codedOnly ? 'coded-only' : 'excluded',
      pre: phase(before), post: phase(after),
    };
    if (eligible || codedOnly) {
      for (const [key, source] of [['pre', before], ['post', after]]) {
        const relative = `scenarios/moodle/${id}/${scenario}.${key}.feature`;
        row[key].scenarioTextPath = relative;
        const group = background => originalText(source).filter(step => step.background === background)
          .flatMap(step => step.rendered.split('\n').map(line => '    ' + line));
        const background = group(true);
        emitted.set(relative, [
          ...tags(source.featureTags), `Feature: ${source.featureTitle ?? source.feature}`, '',
          ...(background.length ? ['  Background:', ...background, ''] : []),
          ...tags(source.scenarioTags).map(tagLine => '  ' + tagLine),
          `  Scenario: ${source.name}`, ...group(false), '',
        ].join('\n'));
      }
    }
    if (eligible) {
      row.pre.handoff = before.handoff;
      row.post.handoff = after.handoff;
    }
    return row;
  });
  const count = record.scenarios.filter(row => row.decision === 'eligible').length;
  return {
    ...record,
    decision: count ? 'chosen' : 'rejected',
    reason: count
      ? `Both sites are ready and ${count} scenario(s) passed developers' Behat before the change and fixture preparation on both commits.`
      : 'No touched scenario passed developers’ Behat before the change and fixture preparation on both commits.',
  };
});

const chosen = changes.filter(change => change.decision === 'chosen');
const scenarioCount = chosen.flatMap(change => change.scenarios)
  .filter(row => row.decision === 'eligible').length;
const editedScenarios = chosen.flatMap(change => change.scenarios
  .filter(row => row.decision === 'eligible' && row.pre.textSha256 !== row.post.textSha256)
  .filter(row => change.editedFeatures.some(file =>
    [row.pre.feature, row.post.feature].some(feature => feature.replace(/^public\//, '') === file.replace(/^public\//, ''))))
  .map(row => ({ change: change.id, scenario: row.id, runOldTextOn: change.post })));

for (const [relative, text] of emitted) {
  const dest = here(`../../${relative}`);
  if (scenarioMode === '--write-scenarios') {
    mkdirSync(new URL('./', dest), { recursive: true });
    writeFileSync(dest, text);
  }
  if (scenarioMode === '--check-scenarios' && readFileSync(dest, 'utf8') !== text) {
    throw new Error(`Scenario extract differs: ${relative}`);
  }
}

console.log(JSON.stringify({
  targetScenarioCount: 20,
  eligibleScenarioCount: scenarioCount,
  shortfall: Math.max(0, 20 - scenarioCount),
  codedOnlyScenarioCount: chosen.flatMap(change => change.scenarios)
    .filter(row => row.decision === 'coded-only').length,
  chosenChangeCount: chosen.length,
  rejectedChangeCount: changes.filter(change => change.decision === 'rejected').length,
  pendingChangeCount: changes.filter(change => change.decision === 'pending').length,
  editedScenarios,
  changes,
}, null, 2));
