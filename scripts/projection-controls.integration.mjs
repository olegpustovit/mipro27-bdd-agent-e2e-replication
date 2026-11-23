// Synthetic DOM controls for the private recorder, excluded from study trials.
import assert from 'node:assert/strict';
import { acquireLock, reset, freshBrowser, flushUIObservation } from './fixture.mjs';
const unlock = acquireLock(); let browser;
const checks = [];
const check = (name, actual, expected) => { assert.deepEqual(actual, expected, name); checks.push({ name, actual, expected, ok: true }); };
try {
  await reset(); browser = await freshBrowser();
  const page = await browser.context.newPage(); await page.goto('http://localhost:3000/signin');
  await page.evaluate(() => {
    document.getElementById('root').style.display = 'none';
    const section = document.createElement('section'); section.id = 'projection-fixture';
    section.innerHTML = `
      <div data-test="sidenav-username">@OtherUser</div><div data-test="sidenav-username">@Heath93</div>
      <form id="unrelated-email"><input name="email" value="unrelated@example.com"></form>
      <form data-test="user-settings-form" id="probe-profile">
        <input name="email" value="invalid-email">
        <input name="amount" value="12" disabled><input name="amount" value="99" type="hidden">
        <button data-test="user-settings-submit" id="probe-save" aria-label="Save">Save</button>
        <button type="submit" disabled>Unrelated submit</button>
        <p>Must contain a valid email address</p>
      </form>
      <input name="firstName" value="Study" form="probe-profile">
      <ul data-test="comments-list" id="probe-comments">
        <li><span>Study comment</span></li><li id="second-comment">Study <b>comment</b></li>
        <li style="display:none"><span>Study comment</span></li>
      </ul><p>Study comment</p><script type="application/json">Study comment</script>`;
    document.body.appendChild(section);
  });
  const snapshot = async () => (await flushUIObservation(browser.context, browser.witness)).state;
  let state = await snapshot();
  check('both identity candidates survive wrong-first DOM order', state.identityCandidates.filter(i => i.visible).map(i => i.text), ['@OtherUser', '@Heath93']);
  check('implicit-type Save exists', state.profileSave.filter(s => s.visible).length, 1);
  check('profile email projection ignores an earlier unrelated email input', state.email.value, 'invalid-email');
  check('profile email is bound to the unique form and actual control', [state.email.formUID, state.email.controlUID], [state.profileContext.formUID, state.profileContext.fields.email.uid]);
  check('externally associated profile field is projected', state.firstName.value, 'Study');
  check('unrelated disabled submit cannot disable the mapped Save', state.profileSave.find(s => s.visible).disabled, await page.locator('#probe-save').isDisabled());
  check('error needs no aria-describedby association', state.exactTexts['Must contain a valid email address'].filter(t => t.visible && t.inProfileForm).length, 1);
  check('global exact text agrees with native visible-text query', state.exactTexts['Study comment'].filter(t => t.visible).length,
    await page.getByText('Study comment', { exact: true }).filter({ visible: true }).count());
  check('scoped nested exact comments agree with native query', state.exactTexts['Study comment'].filter(t => t.visible && t.inComments).length,
    await page.locator('#probe-comments').getByText('Study comment', { exact: true }).filter({ visible: true }).count());
  await page.locator('#probe-profile').evaluate(form => form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true })));
  await snapshot();
  const submit = browser.witness.events.findLast(e => e.kind === 'submit' && e.formId === 'user-settings-form');
  check('submit observation declares UI-value rather than request-payload scope', submit.fieldsScope, 'visible-form-associated-UI-values-at-submit-not-request-payload');
  check('externally associated controls survive submit observation', submit.fields.find(f => f.name === 'firstName').value, 'Study');
  check('disabled displayed input is identified without claiming it was submitted', submit.fields.filter(f => f.name === 'amount').map(f => [f.value, f.disabled]), [['12', true]]);
  check('native successful controls differ from displayed values by design', await page.locator('#probe-profile').evaluate(form => new FormData(form).getAll('amount')), ['99']);
  await page.locator('#second-comment').evaluate(element => element.style.visibility = 'hidden');
  state = await snapshot();
  check('hidden nested comment is excluded', state.exactTexts['Study comment'].filter(t => t.visible && t.inComments).length, 1);
  await page.locator('#probe-save').evaluate(element => element.setAttribute('aria-disabled', 'true'));
  state = await snapshot();
  check('ARIA-disabled Save agrees with native disabled query', state.profileSave.find(s => s.visible).disabled, await page.locator('#probe-save').isDisabled());
  await page.locator('#probe-save').evaluate(element => {
    element.removeAttribute('aria-disabled');
    const fieldset = document.createElement('fieldset'); fieldset.disabled = true;
    element.before(fieldset); fieldset.appendChild(element);
  });
  state = await snapshot();
  check('fieldset-disabled Save agrees with native disabled query', state.profileSave.find(s => s.visible).disabled, await page.locator('#probe-save').isDisabled());
  await page.locator('#probe-save').evaluate(element => element.parentElement.style.display = 'none');
  state = await snapshot();
  check('hidden Save is not replaced by unrelated disabled submit', state.profileSave.filter(s => s.visible).length, 0);
  await page.evaluate(() => {
    const duplicate = document.createElement('form'); duplicate.id = 'other-profile'; duplicate.setAttribute('data-test', 'user-settings-form');
    duplicate.innerHTML = '<input name="email" value="invalid-email"><p>Must contain a valid email address</p><button data-test="user-settings-submit" disabled>Save</button>';
    document.getElementById('projection-fixture').appendChild(duplicate);
  });
  state = await snapshot();
  check('multiple visible mapped profile forms are explicitly ambiguous', state.profileContext.formCount, 2);
  check('ambiguous form mapping has no selected form identity', state.profileContext.formUID, null);
  await page.evaluate(() => {
    document.getElementById('other-profile').remove();
    const email = document.createElement('input'); email.name = 'email'; email.value = 'second@example.com';
    document.getElementById('probe-profile').appendChild(email);
  });
  state = await snapshot();
  check('duplicate visible email controls are explicitly ambiguous', state.profileContext.fields.email.count, 2);
  check('ambiguous email control has no selected identity', state.profileContext.fields.email.uid, null);
  console.log(JSON.stringify({ type: 'projection-controls', excludedFromStudy: true, languageModelUsed: false, ok: true, checks,
    limits: ['Synthetic DOM parity controls, not measured application trials.', 'Additional UI-version mappings and shadow-root scope parity are not established.'] }));
} finally { await browser?.close(); try { await reset(); } finally { unlock(); } }
