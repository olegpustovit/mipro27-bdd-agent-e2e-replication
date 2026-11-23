// Private, read-only UI instrumentation. It supplies no tools, expectations,
// action implementations or correctness feedback to either executing approach.
// Observer mappings are independent of the repairable execution locators.
const originalMapping = Object.freeze({
  identity: '[data-test="sidenav-username"]',
  fullName: '[data-test="sidenav-user-full-name"]',
  profileForm: '[data-test="user-settings-form"]',
  profileSave: '[data-test="user-settings-submit"]',
  profileSaveLabels: ['Save', 'Save changes'],
  bankDeleteDialogs: '[data-test="bank-delete-dialog"]',
  selectedRecipient: '.TransactionCreateStepTwo-paper h2',
  comments: '[data-test="comments-list"]',
  bankRows: '[data-test="bankaccount-list"] > li',
  transactionRows: '[data-test^="transaction-item-"]',
  userRows: '[data-test^="user-list-item-"]',
  commentRows: '[data-test^="comment-list-item-"]',
  likeCounts: '[data-test^="transaction-like-count-"]',
  likeButtons: '[data-test^="transaction-like-button-"]',
  feedHeaders: '.MuiListSubheader-root',
});
const revisedMapping = Object.freeze({ ...originalMapping,
  identity: '[data-test="v1-sidenav-username"]', fullName: '[data-test="v1-sidenav-user-full-name"]',
  profileForm: '[data-test="v1-user-settings-form"]', profileSave: '[data-test="v1-user-settings-submit"]',
  profileSaveLabels: ['Apply changes'], bankDeleteDialogs: '[data-test="v1-bank-delete-dialog"]',
  transactionRows: '[data-test^="transaction-item-"],[data-test^="v1-transaction-item-"]',
  likeCounts: '[data-test^="v1-transaction-like-count-"]', likeButtons: '[data-test^="v1-transaction-like-button-"]',
});
// Candidate mappings remain private and must be calibrated before measured use.
export const observerMappings = Object.freeze({ v0: originalMapping, v1: revisedMapping, v2: revisedMapping });

// Serialized by Playwright into each document, before application scripts.
export function installUIObserver({ mapping, observerVersion, expectedPassword, sampleUI = true }) {
  if (location.origin !== 'http://localhost:3000') return;
  const documentId = crypto.randomUUID();
  let browserSequence = 0, scheduled = false, lastState = '', lastStateSequence = null, captureCount = 0, projectionCpuMs = 0, emitted = 0, failedEmits = 0, failure = null, validationTimer = null;
  const pending = new Map();
  let draining = false;
  const emit = event => {
    if (failure) return null;
    const entry = { ...event, documentId, browserSequence: ++browserSequence,
      browserTime: performance.timeOrigin + performance.now(), path: location.pathname };
    try {
      if (pending.size >= 64) throw new Error('Private event delivery saturated (64 pending)');
      if (JSON.stringify(entry).length > 128000) throw new Error('Private event exceeds 128000-character bound');
      let timer;
      const underlying = Promise.resolve(window.__studyUIWitness(entry));
      const delivery = Promise.race([underlying, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Private event delivery exceeded 10000ms')), 10000);
      })]).finally(() => clearTimeout(timer));
      pending.set(underlying, delivery);
      underlying.then(() => pending.delete(underlying), () => pending.delete(underlying));
      delivery.catch(error => { failedEmits++; failure = error.message; });
    } catch (error) { failedEmits++; failure = error.message; }
    return entry.browserSequence;
  };
  Object.defineProperty(window, '__studyDocumentId', { value: documentId });
  const text = element => (element?.textContent || '').replace(/\s+/g, ' ').trim();
  const visible = element => {
    if (!element) return false;
    const style = getComputedStyle(element);
    if (style.display === 'contents') return [...element.childNodes].some(child => {
      if (child.nodeType === Node.ELEMENT_NODE) return visible(child);
      if (child.nodeType !== Node.TEXT_NODE || style.visibility !== 'visible') return false;
      const range = document.createRange(); range.selectNodeContents(child);
      const rect = range.getBoundingClientRect(); return rect.width > 0 && rect.height > 0;
    });
    if (element.checkVisibility && !element.checkVisibility()) return false;
    if (style.visibility !== 'visible') return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const nodes = selector => [...document.querySelectorAll(selector)];
  const identities = new WeakMap(); let identitySequence = 0;
  const uid = element => {
    if (!element) return null;
    if (!identities.has(element)) identities.set(element, 'u' + ++identitySequence);
    return identities.get(element);
  };
  const profileContext = () => {
    const forms = nodes(mapping.profileForm).filter(visible), form = forms.length === 1 ? forms[0] : null;
    const fields = Object.fromEntries(['email', 'firstName'].map(name => {
      const matches = form ? [...form.elements].filter(element => element.name === name && visible(element)) : [];
      return [name, { count: matches.length, uid: matches.length === 1 ? uid(matches[0]) : null }];
    }));
    return { formCount: forms.length, formUID: uid(form), fields };
  };
  const describe = element => ({ text: text(element), visible: visible(element) });
  const one = selector => {
    const matches = nodes(selector), shown = matches.filter(visible);
    const element = shown[0] || matches[0];
    return { present: Boolean(element), matches: matches.length, visibleMatches: shown.length,
      ...describe(element) };
  };
  const input = name => {
    const profile = ['firstName', 'email'].includes(name);
    const matches = nodes('input,textarea,select').filter(element => element.name === name &&
      (!profile || element.form?.matches(mapping.profileForm)));
    const shown = matches.filter(visible), element = shown[0] || matches[0];
    const descriptions = (element?.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean)
      .map(id => describe(document.getElementById(id)));
    return { present: Boolean(element), matches: matches.length, visibleMatches: shown.length,
      value: element?.value ?? null, visible: visible(element), descriptions, controlUID: uid(element), formUID: uid(element?.form) };
  };
  const submitControl = fieldName => {
    const matches = nodes('input').filter(element => element.name === fieldName);
    const field = matches.find(visible) || matches[0];
    const controls = field?.form ? [...field.form.querySelectorAll('button[type="submit"],input[type="submit"]')] : [];
    return controls.map(element => ({ ...describe(element), disabled: Boolean(element.disabled) }));
  };
  const disabled = element => {
    if (element.disabled || element.matches(':disabled')) return true;
    for (let current = element; current; current = current.parentElement) {
      const value = current.getAttribute('aria-disabled');
      if (value === 'true' || value === 'false') return value === 'true';
    }
    return false;
  };
  const profileSave = () => nodes(mapping.profileSave).filter(element => element.closest(mapping.profileForm) &&
    mapping.profileSaveLabels.some(label => label.toLowerCase() === (element.getAttribute('aria-label') || text(element) || element.value || '').toLowerCase()))
    .map(element => ({ ...describe(element), disabled: disabled(element), formUID: uid(element.form || element.closest(mapping.profileForm)) }));
  const rows = selector => nodes(selector).map(element => ({ id: element.getAttribute('data-test'), ...describe(element) }));
  // Independently reproduce exact visible-text observations, without tying a
  // public text assertion to an aria-describedby association or comment row.
  // Like Playwright's text engine, choose the smallest matching element.
  const exactTexts = () => {
    const normalize = value => value.replace(/[\u200b\u00ad]/g, '').replace(/\s+/g, ' ').trim();
    const cache = new Map();
    const elementText = element => {
      if (cache.has(element)) return cache.get(element);
      let value = '';
      if (!['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(element.tagName) && !document.head?.contains(element)) {
        if (element.tagName === 'INPUT' && ['button', 'submit'].includes(element.type)) value = element.value;
        else {
          for (const child of element.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) value += child.nodeValue || '';
            else if (child.nodeType === Node.ELEMENT_NODE) value += elementText(child);
          }
          if (element.shadowRoot) value += elementText(element.shadowRoot);
        }
      }
      cache.set(element, value); return value;
    };
    const all = [];
    const collect = root => { for (const element of root.querySelectorAll('*')) { all.push(element); if (element.shadowRoot) collect(element.shadowRoot); } };
    collect(document);
    return Object.fromEntries(['Must contain a valid email address', 'Study comment'].map(target => [target, all.filter(element => {
      if (normalize(elementText(element)) !== target) return false;
      return ![...element.children, ...(element.shadowRoot?.children || [])].some(child => normalize(elementText(child)) === target);
    }).map(element => ({ ...describe(element), inProfileForm: Boolean(element.closest(mapping.profileForm)), formUID: uid(element.closest(mapping.profileForm)), inComments: Boolean(element.closest(mapping.comments)) }))]));
  };
  const capture = (force = false) => {
    if (!sampleUI || failure || (draining && !force)) return;
    const began = performance.now();
    try {
    const state = {
      schema: 1, observerVersion, documentId, path: location.pathname, readyState: document.readyState,
      identity: one(mapping.identity), identityCandidates: nodes(mapping.identity).map(describe), fullName: one(mapping.fullName),
      selectedRecipients: nodes(mapping.selectedRecipient).map(describe),
      profileContext: profileContext(),
      bankDeleteDialogs: nodes(mapping.bankDeleteDialogs).map(element => ({ ...describe(element), dialogUID: uid(element) })),
      firstName: input('firstName'), email: input('email'), username: input('username'),
      profileSave: profileSave(), bankSave: submitControl('bankName'),
      headings: nodes('h1,h2,h3,h4,h5,h6,[role="heading"]').map(element => ({ ...describe(element), level: Number(element.getAttribute('aria-level') || element.tagName.slice(1)) || null })),
      alerts: nodes('[role="alert"]').map(describe),
      exactTexts: exactTexts(),
      bankRows: rows(mapping.bankRows), transactionRows: rows(mapping.transactionRows),
      commentRows: rows(mapping.commentRows), feedHeaders: nodes(mapping.feedHeaders).map(describe),
      likeCounts: rows(mapping.likeCounts),
      likeButtons: nodes(mapping.likeButtons).map(element => ({ id: element.getAttribute('data-test'), ...describe(element), disabled: Boolean(element.disabled) })),
    };
    const serialized = JSON.stringify(state);
    if (serialized.length > 128000) throw new Error('UI state payload exceeds the declared 128000-character bound');
    captureCount++; projectionCpuMs += performance.now() - began;
    if (force || serialized !== lastState) { lastState = serialized; emitted++; lastStateSequence = emit({ kind: 'ui-state', state }); }
    else emit({ kind: 'ui-sample', stateSequence: lastStateSequence, projectionConfirmed: true });
    return state;
    } catch (error) { failure = error.message; emit({ kind: 'observer-error', error: failure }); return null; }
  };
  const schedule = () => {
    if (!scheduled && sampleUI && !draining) { scheduled = true; queueMicrotask(() => { scheduled = false; capture(); }); }
  };
  const fields = form => {
    if (!form) return null;
    return [...form.elements].filter(element => element.name && ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) && visible(element)).map(element => ({
      name: element.name, value: element.type === 'password' ? null : element.value,
      controlUID: uid(element), formUID: uid(element.form),
      disabled: disabled(element), readOnly: Boolean(element.readOnly), type: element.type,
      ...(element.type === 'password' ? { passwordMatchesExpected: element.value === expectedPassword } : {}),
    }));
  };
  const action = event => {
    try {
    const target = event.target.closest?.('button,a,input,textarea,select,form,[role="tab"],[role="button"]') || event.target.closest?.('[data-test]') ||
      (event.target.nodeType === 1 ? event.target : event.target.parentElement);
    if (!target) { emit({ kind: event.type, isTrusted: Boolean(event.isTrusted), unmappedTarget: true }); return; }
    capture(true);
    const form = target instanceof HTMLFormElement ? target : target.form || target.closest('form');
    const row = target.closest(mapping.bankRows + ',' + mapping.userRows);
    const dialog = target.closest(mapping.bankDeleteDialogs);
    const entry = { kind: event.type, key: event.key || null, tag: target.tagName,
      targetVisible: visible(target), targetDisabled: disabled(target), isTrusted: Boolean(event.isTrusted),
      name: target.name || '', testId: target.getAttribute('data-test') || '',
      text: text(target).slice(0, 500), value: ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) && target.type !== 'password' ? target.value : null,
      ...(target.type === 'password' ? { passwordMatchesExpected: target.value === expectedPassword } : {}),
      formId: form?.getAttribute('data-test') || null,
      formUID: uid(form), controlUID: uid(target), profileContext: profileContext(),
      dialogUID: uid(dialog),
      rowId: row?.getAttribute('data-test') || null, rowText: row ? text(row) : null, rowVisible: row ? visible(row) : null,
      ...(event.type === 'submit' ? { fields: fields(form), fieldsScope: 'visible-form-associated-UI-values-at-submit-not-request-payload', submitter: event.submitter ? { testId: event.submitter.getAttribute('data-test') || '', text: text(event.submitter) } : null } : {}),
    };
    emit(entry);
    // Preserve the old validation diagnostic while its replacement is built.
    // This is a distinct state event, not a delayed or reordered action event.
    if (target.name === 'email') { clearTimeout(validationTimer); validationTimer = setTimeout(() => {
      validationTimer = null;
      const matches = nodes('input').filter(element => element.name === 'email');
      const email = matches.find(visible) || matches[0];
      if (email?.value !== 'invalid-email') return;
      const save = email.form?.querySelector('button[type="submit"]');
      const error = (email.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean).map(id => document.getElementById(id));
      emit({ kind: 'validation', emailValidation: { value: email.value, saveDisabled: Boolean(save?.disabled),
        errorVisible: error.some(element => visible(element) && text(element) === 'Must contain a valid email address') } });
    }, 0); }
    if (sampleUI) queueMicrotask(() => capture(true));
    } catch (error) { failure = error.message; emit({ kind: 'observer-error', error: failure }); }
  };
  for (const type of ['input', 'click', 'focusout', 'submit']) document.addEventListener(type, action, true);
  if (sampleUI) {
    if (!window.navigation?.addEventListener) failure = 'Pinned browser lacks required read-only Navigation API observation';
    else window.navigation.addEventListener('navigate', event => emit({ kind: 'ui-navigation',
      fromPath: location.pathname, toPath: new URL(event.destination.url).pathname,
      navigationType: event.navigationType, sameDocument: event.destination.sameDocument,
      userInitiated: event.userInitiated }));
  }
  document.addEventListener('keydown', event => { if (event.key === 'Enter') action(event); }, true);
  window.addEventListener('pageshow', event => {
    draining = false;
    emit({ kind: 'navigation', navigationType: performance.getEntriesByType('navigation')[0]?.type || 'unknown', persisted: event.persisted });
    capture(true);
  });
  // CPU time covers successful UI projection/serialization only. It is not
  // total observer overhead: event delivery, scheduling and action recording
  // are excluded. Compare end-to-end timings separately before cost claims.
  const metrics = () => ({ captureCount, projectionCpuMs, emitted, failedEmits, failure,
    cpuScope: 'successful projection and serialization only', samplingMs: 200 });
  window.addEventListener('pagehide', () => {
    draining = true; clearTimeout(validationTimer); validationTimer = null;
    capture(true); emit({ kind: 'observer-metrics', metrics: metrics() });
  });
  Object.defineProperty(window, '__studyCaptureUI', { value: async ({ markBarrier = false } = {}) => {
    // Let already queued mutation microtasks and the coalesced validation timer
    // execute, then acknowledge all deliveries through the final forced sample.
    draining = true;
    try {
      await new Promise(resolve => setTimeout(resolve, 0));
      const state = capture(true);
      if (markBarrier) emit({ kind: 'document-barrier', metrics: metrics(), throughSequence: browserSequence + 1 });
      const throughSequence = browserSequence;
      // A fixed prefix, never a moving target: later events stay in the audit
      // and require a later acknowledged boundary before they can be scored.
      const prefix = [...pending.values()];
      await Promise.allSettled(prefix);
      return { state, throughSequence, metrics: metrics() };
    } finally { draining = false; }
  } });
  Object.defineProperty(window, '__studyObserverMetrics', { value: metrics });
  if (sampleUI) {
    new MutationObserver(schedule).observe(document, { childList: true, subtree: true, attributes: true, characterData: true });
    // Property-only input changes need not generate attribute mutations.
    setInterval(schedule, 200);
    schedule();
  }
}
