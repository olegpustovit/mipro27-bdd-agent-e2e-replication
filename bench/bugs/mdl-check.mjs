import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { MoodleAdapter } from '../../adapters/moodle/adapter.mjs';
import { run } from '../../adapters/moodle/shell.mjs';
import { ensureStateText } from '../../adapters/moodle/state-text.mjs';

const banner = 'The search currently only finds frog-related content; we hope to fix it soon.';
const fixture = readFileSync(new URL('./mdl-check-fixture.php', import.meta.url), 'utf8');
const visible = async (target, expected = true) => {
  if (expected) await target.waitFor({ state: 'visible' });
  else assert.equal(await target.isVisible(), false, `Unexpected visible element: ${target}`);
};
const pageFor = (page, number) => page.locator(`#page-${number}`);
const slotFor = (page, name) => page.locator('li.slot').filter({ hasText: name });
const completionButton = (page, name) => page.locator(`button[data-completion="manual"][data-activityname="${name}"]`);

async function assertQuizPage(page, question, number) {
  const row = slotFor(page, question);
  await visible(row);
  assert.equal(await row.evaluate(element => {
    let previous = element.previousElementSibling;
    while (previous && !previous.matches('li.page')) previous = previous.previousElementSibling;
    return previous?.id;
  }), `page-${number}`);
}

async function sesskey(page) {
  const scripts = await page.locator('script:not([src])').allTextContents();
  const match = scripts.map(script => /"sesskey"\s*:\s*"([A-Za-z0-9]+)"/.exec(script)).find(Boolean);
  assert.ok(match, 'The authenticated Moodle page has no session key');
  return match[1];
}

async function login(page, user) {
  await page.goto('/login/index.php');
  // Sign-in is setup for these checks. Submit the ordinary form with its
  // token and the browser's cookies atomically to avoid late autofill.
  await page.locator('form#login').evaluate((form, username) => {
    form.elements.username.value = username;
    form.elements.password.value = username;
    form.submit();
  }, user);
  await visible(page.locator('.usermenu'));
}

async function bannerCheck(page, scenario, bug, adapter) {
  await login(page, 'admin');
  await page.goto('/search/index.php?q=toads');
  const warning = page.locator('.notifywarning');
  await visible(page.locator('#page-search-index'));
  await visible(page.locator('#id_q'));
  const settings = await adapter.psql(
    "select name || '=' || value from b_config where name in ('searchbanner', 'searchbannerenable') order by name", 'moodle',
  );
  assert.equal(settings.stdout.trim(),
    `searchbanner=${scenario === 'S029' ? '' : banner}\nsearchbannerenable=${scenario === 'S028' ? 0 : 1}`);
  assert.equal(await warning.count(), Number(scenario === 'S027' ? !bug : bug));
  if (await warning.count()) {
    await visible(warning);
    const text = await warning.evaluate(element => {
      const contents = element.cloneNode(true);
      contents.querySelectorAll('button').forEach(button => button.remove());
      return contents.textContent.trim();
    });
    assert.equal(text, scenario === 'S029' ? '' : banner);
  }
}

async function completionCheck(page, scenario, ids, bug, adapter) {
  const course = `/course/view.php?id=${ids.course}`;
  const assignment = `/mod/assign/view.php?id=${ids.cm}`;
  const verifyVisibilitySetting = async expected => {
    const state = await adapter.psql(
      `select showcompletionconditions from b_course where id=${ids.course}`, 'moodle',
    );
    assert.equal(state.stdout.trim(), String(expected));
  };
  if (scenario === 'S041') {
    await login(page, 'student1');
    await page.goto(assignment);
    const button = completionButton(page, 'Music history');
    assert.equal((await button.innerText()).trim(), 'Mark as done');
    await button.click();
    const updated = button.and(page.locator('[data-toggletype="manual:undo"]'));
    assert.equal((await updated.innerText()).trim(), bug ? 'Mark as done' : 'Done');
    const state = await adapter.psql(
      `select completionstate from b_course_modules_completion where coursemoduleid=${ids.cm} and userid=${ids.student}`, 'moodle',
    );
    assert.equal(state.stdout.trim(), '1');
    return;
  }

  await login(page, 'teacher1');
  if (scenario === 'S036') {
    await verifyVisibilitySetting(1);
    await page.goto(course);
    const item = page.locator(`#module-${ids.cm}`);
    await visible(item.getByText('Test choice manual', { exact: true }));
    const requirements = item.locator('[data-region="completionrequirements"]');
    if (!bug) {
      await requirements.getByRole('button').click();
      await visible(requirements.getByText('Mark as done', { exact: true }));
    } else {
      assert.equal(await requirements.count(), 0);
    }
    return;
  }

  await page.goto(`/course/edit.php?id=${ids.course}`);
  const visibility = page.locator('#id_showcompletionconditions');
  if (!(await visibility.isVisible())) {
    await page.locator('[aria-controls="id_completionhdrcontainer"]').click();
  }
  await visibility.selectOption('0');
  await page.getByRole('button', { name: 'Save and display' }).click();
  await page.waitForURL('**/course/view.php?*');
  await verifyVisibilitySetting(0);
  if (scenario === 'S037') {
    const automatic = page.locator(`#module-${ids.automaticcm}`);
    await visible(automatic.getByText('Test choice auto', { exact: true }));
    assert.equal(await automatic.locator('[data-region="completion-info"]').filter({
      hasText: 'Make a choice',
    }).count(), 0);
    const button = completionButton(page, 'Test choice manual');
    assert.equal(await button.count(), Number(bug));
    if (bug) {
      await visible(button);
      assert.equal(await button.isDisabled(), true);
    }
    return;
  }
  await visible(completionButton(page, 'Music history'), false);
  await page.goto(`/login/logout.php?sesskey=${await sesskey(page)}`);
  await login(page, 'student1');
  await page.goto(course);
  const activity = page.locator(`#region-main a[href$="${assignment}"]`);
  await visible(activity);
  assert.match(await activity.innerText(), /Music history/);
  const button = completionButton(page, 'Music history');
  assert.equal(await button.count(), Number(bug));
  if (bug) await visible(button);
  await page.goto(assignment);
  await visible(completionButton(page, 'Music history'));
}

async function blockCheck(page, scenario, ids, bug, adapter) {
  const [user, block, name, target] = {
    S091: ['teacher1', 'myprofile', 'Logged in user', 'Teacher One'],
    S093: ['admin', 'accessreview', 'Accessibility review', 'Your accessibility toolkit needs to be registered.'],
    S094: ['teacher1', 'activity_results', 'Activity results',
      'Please configure this block and select which activity it should display results from.'],
  }[scenario];
  await login(page, user);
  if (scenario === 'S091') await page.goto('/my/');
  else await page.goto(`/course/view.php?id=${ids.course}`);
  const url = new URL(page.url());
  url.searchParams.set('sesskey', await sesskey(page));
  url.searchParams.set('edit', 'on');
  await page.goto(url.href);
  const add = page.getByRole('button', { name: 'Add a block' }).or(page.getByRole('link', { name: 'Add a block' }));
  await (scenario === 'S091' ? page.locator('[data-blockregion=content][data-key=addblock]') : add).click();
  await page.locator(`a[data-blockname="${block}"]`).click();
  const region = page.locator(`[data-block="${block}"]`);
  await region.waitFor({ state: 'attached' });
  const instance = await region.getAttribute('data-instance-id');
  assert.match(instance, /^\d+$/);
  const stored = await adapter.psql(`select blockname from b_block_instances where id=${instance}`, 'moodle');
  assert.equal(stored.stdout.trim(), block);
  if (scenario !== 'S091' || !bug) await visible(region.getByText(name, { exact: true }));
  await visible(region.getByText(target, { exact: false }), !bug);
}

async function quizCheck(page, scenario, ids, bug, adapter) {
  await login(page, 'teacher1');
  const edit = `/mod/quiz/edit.php?cmid=${ids.cm}`;
  await page.goto(edit);
  await visible(pageFor(page, 1));

  async function slotId(name) {
    const id = await slotFor(page, name).getAttribute('id');
    assert.match(id, /^slot-\d+$/);
    return Number(id.slice(5));
  }

  async function slotPage(id) {
    const outcome = await adapter.psql(`select page from b_quiz_slots where id=${id}`, 'moodle');
    return Number(outcome.stdout.trim());
  }

  const quizEditResponse = response => response.url().includes('/mod/quiz/edit_rest.php') &&
    response.request().method() === 'POST';

  async function addBreak(question) {
    const [response] = await Promise.all([
      page.waitForResponse(quizEditResponse),
      slotFor(page, question).locator('[data-action="addpagebreak"]').click(),
    ]);
    assert.ok(response.ok());
    assert.ok((await response.json()).slots);
    await page.reload();
  }

  async function move(name, destination, reload = false) {
    await slotFor(page, name).locator('.editing_move').click();
    const moved = page.waitForResponse(quizEditResponse);
    const reloaded = reload ? page.waitForEvent('framenavigated', frame => frame === page.mainFrame()) : null;
    await page.getByRole('button', { name: destination, exact: true }).click();
    assert.equal((await moved).ok(), true);
    await reloaded;
  }

  if (scenario === 'S042' || scenario === 'S045') {
    const upwards = scenario === 'S045';
    const question = upwards ? 'Question6 text' : 'Question A';
    const id = await slotId(question);
    if (upwards) {
      await addBreak('Question3 text');
      await addBreak('Question7 text');
    } else {
      await move(question, 'After Question 2');
      assert.equal(await slotPage(id), 1);
    }
    const target = upwards ? 1 : 2;
    await move(question, upwards ? 'After Question 3' : 'After Page 2', bug);
    const actual = bug ? 3 - target : target;
    assert.equal(await slotPage(id), actual);
    await assertQuizPage(page, question, actual);
    return;
  }

  if (scenario === 'S043') {
    assert.match(await page.locator('.numberofquestions').innerText(), /Questions: 3/);
    const slot = slotFor(page, 'Question C');
    const id = await slotId('Question C');
    await slot.locator('[data-action="delete"]').click();
    await page.getByRole('button', { name: 'Yes', exact: true }).click();
    await slot.waitFor({ state: 'detached' });
    const stored = await adapter.psql(`select count(*) from b_quiz_slots where id=${id}`, 'moodle');
    assert.equal(stored.stdout.trim(), '0');
    assert.match(await page.locator('.mod-quiz-edit-content').innerText(), /Total of marks: 2\.00/);
    assert.match(await page.locator('.numberofquestions').innerText(), new RegExp(`Questions: ${bug ? 3 : 2}`));
    return;
  }

  if (scenario === 'S044') {
    const id = await slotId('Question2 text');
    await page.getByRole('button', { name: 'Repaginate', exact: true }).click();
    await page.locator('#menuquestionsperpage').selectOption('1');
    await Promise.all([
      page.waitForEvent('framenavigated', frame => frame === page.mainFrame()),
      page.getByRole('button', { name: 'Go', exact: true }).click(),
    ]);
    assert.equal(await slotPage(id), bug ? 1 : 2);
    await assertQuizPage(page, 'Question2 text', bug ? 1 : 2);
    return;
  }

  if (scenario === 'S046') {
    await addBreak('Question3 text');
    await addBreak('Question7 text');
    await move('Question1 text', 'After Question 9');
    await page.goto(`/mod/quiz/view.php?id=${ids.cm}`);
    await page.getByRole('button', { name: 'Preview quiz' }).click();
    await visible(page.getByText('Question2 text', { exact: true }));
    const attempt = Number(new URL(page.url()).searchParams.get('attempt'));
    assert(attempt > 0 && Number.isSafeInteger(attempt));
    const stored = await adapter.psql(`select layout from b_quiz_attempts where id=${attempt} and preview=1`, 'moodle');
    assert.equal(stored.stdout.trim().split(',').filter(slot => slot === '0').length, bug ? 2 : 3);
    await page.getByRole('button', { name: 'Next page' }).click();
    await visible(page.getByText('Question8 text', { exact: true }), bug);
    await visible(page.getByText('Question4 text', { exact: true }), !bug);
    return;
  }

  assert.equal(scenario, 'S047');
  const id = await slotId('TF1');
  await addBreak('TF1');
  assert.equal(await slotPage(id), 1);
  assert.equal(await slotPage(await slotId('TF2')), 2);
  const first = pageFor(page, 1);
  await first.locator('[data-toggle="dropdown"], [data-bs-toggle="dropdown"]').click();
  const heading = first.locator('a[data-action="addasection"]');
  assert.equal((await heading.textContent()).trim(), 'a new section heading');
  await visible(heading, bug);
}

async function checkCondition(id, pin, condition, adapter, browser) {
  const scenario = id.split('-').at(-1);
  const bug = condition === 'bug';
  const generated = await adapter.exec('webserver', ['php', '-f', '/dev/stdin', '--', scenario], { input: fixture });
  const ids = JSON.parse(generated.stdout);
  const page = await browser.newPage({
    baseURL: adapter.baseUrl, viewport: { width: 1440, height: 1000 },
    javaScriptEnabled: scenario !== 'S094',
  });
  try {
    page.setDefaultTimeout(30_000);
    if (['S027', 'S028', 'S029'].includes(scenario)) await bannerCheck(page, scenario, bug, adapter);
    else if (['S036', 'S037', 'S040', 'S041'].includes(scenario)) await completionCheck(page, scenario, ids, bug, adapter);
    else if (['S091', 'S093', 'S094'].includes(scenario)) await blockCheck(page, scenario, ids, bug, adapter);
    else await quizCheck(page, scenario, ids, bug, adapter);
    console.log(`PASS ${id} ${pin} ${condition}`);
  } finally {
    await page.close();
  }
}

function sanitize(error) {
  const message = error.message.split('\n').filter(line => !/<[^>]+>/.test(line)).slice(0, 12).join('\n')
    .replace(/sesskey(?:=|%3D)[A-Za-z0-9]+/gi, 'sesskey=[redacted]');
  return new Error(message);
}

export async function runCheck(id) {
  const [mode, commit, web, db, ws] = process.argv.slice(2);
  const dir = new URL(`./${id}/`, import.meta.url);
  const [pin] = JSON.parse(readFileSync(new URL('applies-to.json', dir), 'utf8'));
  assert(['healthy', 'bug', 'both'].includes(mode) && (!commit || commit === pin),
    `Usage: node check.mjs healthy|bug|both [${pin}]`);
  if (web || db || ws) {
    assert(web && db && ws && mode !== 'both');
    const browser = await chromium.connect(ws);
    const adapter = {
      baseUrl: 'http://webserver',
      exec: (_service, command, { input }) =>
        run('docker', ['exec', '-i', web, ...command], { input }),
      psql: (sql, database) =>
        run('docker', ['exec', db, 'psql', '-XAt', '-v', 'ON_ERROR_STOP=1', '-U', 'moodle', '-d', database, '-c', sql]),
    };
    try {
      await checkCondition(id, pin, mode, adapter, browser);
    } catch (error) {
      throw sanitize(error);
    } finally {
      await browser.close();
    }
    return;
  }
  const adapter = new MoodleAdapter({
    moodleCommit: pin, worker: process.env.BENCH_MOODLE_WORKER ?? 'w197',
  });
  const release = adapter.lease('bench independent Moodle bug check');
  let browser;
  let started = false;
  try {
    await adapter.start();
    started = true;
    const head = await run('git', ['rev-parse', 'HEAD'], { cwd: adapter.dirs.src });
    assert.equal(head.stdout.trim(), pin);
    browser = await chromium.launch({
      args: adapter.browserArgs(), executablePath: process.env.BENCH_MOODLE_CHROMIUM,
    });
    for (const condition of mode === 'both' ? ['healthy', 'bug'] : [mode]) {
      const bug = condition === 'bug';
      if (bug && mode === 'both') await adapter.reset();
      await ensureStateText(adapter, bug ? readFileSync(new URL('patch.diff', dir), 'utf8') : '');
      await checkCondition(id, pin, condition, adapter, browser);
    }
  } catch (error) {
    throw sanitize(error);
  } finally {
    try {
      await browser?.close();
    } finally {
      try {
        if (started) await adapter.revertDiff();
      } finally {
        try { if (started) await adapter.stop(); } finally { release(); }
      }
    }
  }
}
