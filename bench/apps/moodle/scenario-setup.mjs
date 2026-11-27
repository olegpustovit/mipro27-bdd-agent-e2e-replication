import { effectiveSteps, renderStep } from '../../../adapters/moodle/gherkin.mjs';
import { isDataStep } from '../../../adapters/moodle/handoff.mjs';

const isSearchBannerConfig = step =>
  step.text === 'the following config values are set as admin:' &&
  step.table?.length > 0 &&
  step.table.every(([name]) => ['searchbannerenable', 'searchbanner'].includes(name));

export function setupPlan(featurePath, parsed, scenario) {
  const steps = effectiveSteps(parsed, scenario);
  const quiz = /(^|\/)mod\/quiz\/tests\/behat\//.test(featurePath);
  const fixture = step => isDataStep(step.text) ||
    (quiz && /^quiz "[^"]+" contains the following (questions|sections):$/.test(step.text));
  let firstUi = 0;
  while (firstUi < steps.length && fixture(steps[firstUi])) firstUi++;
  const setup = steps.slice(0, firstUi);
  const ui = steps.slice(firstUi);
  const [login, config, search] = ui;
  // These fixture mutations precede the first quiz or search interaction.
  // Logging in as the fixture user has no effect on them.
  let hoisted = 0;
  if (login && /^I log in as "[^"]+"$/.test(login.text)) {
    if (quiz) {
      while (fixture(ui[1] ?? { text: '' })) {
        setup.push(ui.splice(1, 1)[0]);
        hoisted++;
      }
    } else if (featurePath.endsWith('/search_information.feature') &&
      config && isSearchBannerConfig(config) &&
      /^I search for ".+" using the header global search box$/.test(search?.text ?? '')) {
      setup.push(ui.splice(1, 1)[0]);
      hoisted++;
    }
  }

  const usesDefaultSeed = featurePath.endsWith('/accessibilitychecker.feature') &&
    scenario.name === 'Placeholder element will not be assessed by accessibility checker';
  if (!setup.length && !usesDefaultSeed) {
    if (ui.some(step => /^the "class" attribute of /.test(step.text))) {
      throw new Error('The default-seed scenario asserts a DOM class that is not user-visible');
    }
    throw new Error('No supported fixture handoff or verified default-seed recipe');
  }
  if (!ui.length || ui.some(fixture)) {
    throw new Error('Could not isolate all data-generator steps from the browser instructions');
  }
  return {
    hoist: hoisted > 0,
    setup: setup.map((step, i) => renderStep({ ...step, keyword: i ? 'And' : 'Given' })),
    ui: ui.map(renderStep),
  };
}
