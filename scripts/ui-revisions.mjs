// Executable candidate UI evolution. Not a frozen protocol or launch approval.
// Business commands/data and the common Gherkin remain unchanged by revisions.
import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { cases } from '../study/manifest.mjs';
import { appRoot, faults, pristineSources, replaceChecked } from './mutations.mjs';

export const revisions = Object.freeze(['v0', 'v1', 'v2']);
const component = name => `src/components/${name}.tsx`;
// These values are not anticipated by the original retained synonym selectors.
const copyChanges = [
  [component('SignInForm'), '                Sign In\n', '                Continue\n'],
  [component('UserSettingsForm'), '                  Save\n', '                  Apply changes\n'],
  [component('BankAccountForm'), '                Save\n', '                Create account\n'],
  [component('TransactionCreateStepTwo'), '                    Pay\n', '                    Send money\n'],
  [component('TransactionCreateStepTwo'), '                    Request\n', '                    Request funds\n'],
  [component('TransactionNavTabs'), 'label="Mine"', 'label="My activity"'],
  [component('TransactionNavTabs'), 'label="Friends"', 'label="People I know"'],
];

export function prefixPublicHooks(source, path = 'component.tsx') {
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  if (tree.parseDiagnostics.length) throw new Error('Invalid source before UI hook revision: ' + path);
  const insertions = new Set();
  const literal = expression => {
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return expression;
    if (ts.isTemplateExpression(expression)) return expression.head;
    throw new Error('Unsupported public hook expression in ' + path);
  };
  const visit = node => {
    let value;
    if (ts.isJsxAttribute(node) && node.name.getText(tree) === 'data-test') {
      if (!node.initializer) throw new Error('Valueless public hook in ' + path);
      value = ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer;
    } else if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.name) && node.name.text === 'data-test') value = node.initializer;
    if (value) insertions.add(literal(value).getStart(tree) + 1);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  let changed = source;
  for (const offset of [...insertions].sort((a, b) => b - a)) changed = changed.slice(0, offset) + 'v1-' + changed.slice(offset);
  const parsed = ts.createSourceFile(path, changed, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  if (parsed.parseDiagnostics.length) throw new Error('Invalid source after UI hook revision: ' + path);
  return { source: changed, hookCount: insertions.size };
}

function accountMenu(source) {
  source = replaceChecked(source, '  Typography,\n', '  Typography,\n  Button,\n');
  source = replaceChecked(source, '  const theme = useTheme();', '  const theme = useTheme();\n  const [accountMenuOpen, setAccountMenuOpen] = React.useState(false);');
  source = replaceChecked(source,
    '          <List>{mainListItems(toggleDrawer, showTemporaryDrawer)}</List>',
    '          <Button data-test="account-menu-toggle" aria-expanded={accountMenuOpen} onClick={() => setAccountMenuOpen(open => !open)}>Account menu</Button>\n          {accountMenuOpen && <List>{mainListItems(toggleDrawer, showTemporaryDrawer)}</List>}');
  return replaceChecked(source, '          <List>{secondaryListItems(signOut)}</List>', '          {accountMenuOpen && <List>{secondaryListItems(signOut)}</List>}');
}

function deleteConfirmation(source, faulty) {
  const command = faulty ? 'void bankAccount.id;' : 'deleteBankAccount({ id: bankAccount.id });';
  source = replaceChecked(source, 'import { Grid, Typography, Button, ListItem }', 'import { Grid, Typography, Button, ListItem, Dialog, DialogTitle, DialogActions }');
  source = replaceChecked(source, '  return (\n', '  const [deleteOpen, setDeleteOpen] = React.useState(false);\n  return (\n    <>\n');
  source = replaceChecked(source, `                ${command}`, '                setDeleteOpen(true);');
  return replaceChecked(source, '    </ListItem>\n  );', `    </ListItem>
    <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} data-test="bank-delete-dialog">
      <DialogTitle>Delete {bankAccount.bankName}?</DialogTitle>
      <DialogActions>
        <Button onClick={() => setDeleteOpen(false)}>Cancel</Button>
        <Button data-test="bankaccount-delete-confirm" onClick={() => { ${command} setDeleteOpen(false); }}>Confirm deletion</Button>
      </DialogActions>
    </Dialog>
    </>
  );`);
}

export function revisionSources(caseId, revision, { fault = false, original = pristineSources() } = {}) {
  if (!cases.some(c => c.id === caseId) || !revisions.includes(revision) || typeof fault !== 'boolean') throw new Error('Unknown UI revision/case/fault');
  const result = { ...original }, changedHooks = {};
  // Compose the same declared defect before hook/structure transformations.
  // This preserves its command semantics, including the v2 confirmation path.
  if (fault) {
    const [path, before, after, count] = faults[caseId];
    result[path] = replaceChecked(result[path], before, after, count);
  }
  if (revision !== 'v0') {
    for (const [path, before, after] of copyChanges) result[path] = replaceChecked(result[path], before, after);
    if (revision === 'v2') {
      result[component('NavDrawer')] = accountMenu(result[component('NavDrawer')]);
      result[component('BankAccountItem')] = deleteConfirmation(result[component('BankAccountItem')], fault && caseId === 'bank-delete');
    }
    for (const path of Object.keys(result)) {
      const changed = prefixPublicHooks(result[path], path);
      result[path] = changed.source; changedHooks[path] = changed.hookCount;
    }
  }
  for (const path of Object.keys(result)) if (result[path] !== original[path]) {
    result[path] += `\n/*! study-build-${createHash('sha256').update(result[path]).digest('hex').slice(0, 20)} */\n`;
  }
  return { sources: result, changedHooks };
}

export function applyUIRevision(caseId, revision, options = {}) {
  const original = pristineSources(), { sources, changedHooks } = revisionSources(caseId, revision, { ...options, original });
  for (const path of Object.keys(original)) if (readFileSync(appRoot + path, 'utf8') !== original[path]) throw new Error('Undeclared fixture source edit: ' + path);
  for (const path of Object.keys(sources)) if (sources[path] !== original[path]) writeFileSync(appRoot + path, sources[path]);
  const restore = () => {
    for (const path of Object.keys(sources)) if (sources[path] !== original[path]) {
      if (readFileSync(appRoot + path, 'utf8') !== sources[path]) throw new Error('Fixture changed during UI revision: ' + path);
      writeFileSync(appRoot + path, original[path]);
    }
  };
  restore.changedHooks = changedHooks;
  restore.ready = async ({ signal, deadline = Date.now() + 15000 } = {}) => {
    deadline = Math.min(deadline, Date.now() + 15000);
    for (const path of Object.keys(sources)) {
      const marker = sources[path].match(/study-build-[a-f0-9]+/)?.[0];
      let ready = false;
      do {
        signal?.throwIfAborted();
        if (Date.now() >= deadline) throw new Error('UI readiness deadline reached');
        const response = await fetch(`http://localhost:3000/${path}?study=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(Math.max(1, Math.min(5000, deadline - Date.now())))]) });
        if (!response.ok) throw new Error('UI revision compilation failed: ' + path + ' HTTP' + response.status);
        const compiled = await response.text();
        if (marker ? compiled.includes(marker) : !/study-build-[a-f0-9]+/.test(compiled)) { ready = true; break; }
        await new Promise(resolve => setTimeout(resolve, 50));
      } while (Date.now() < deadline);
      if (!ready) throw new Error('Stale compiled UI revision: ' + path);
    }
  };
  return restore;
}
