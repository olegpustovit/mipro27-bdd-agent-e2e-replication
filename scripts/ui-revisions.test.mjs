import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { cases } from '../study/manifest.mjs';
import { pristineSources } from './mutations.mjs';
import { prefixPublicHooks, revisionSources } from './ui-revisions.mjs';
import { revisionCalibrationBindings } from './revision-calibration.mjs';

test('hook revision changes JSX and inputProps literals/templates without rewriting commands or input names', () => {
  const source = 'const x = <input name="amount" data-test={"amount"} inputProps={{"data-test": `field-${id}`}} onClick={() => send(amount)} />;';
  const result = prefixPublicHooks(source);
  assert.equal(result.hookCount, 2);
  assert(result.source.includes('data-test={"v1-amount"}'));
  assert(result.source.includes('`v1-field-${id}`'));
  assert(result.source.includes('name="amount"')); assert(result.source.includes('send(amount)'));
  assert.throws(() => prefixPublicHooks('const x = <input data-test={arbitraryFunction()} />;'), /Unsupported/);
});

test('all12declared defects compose with each syntactically valid candidate revision', () => {
  const original = pristineSources(), before = JSON.stringify(original);
  for (const revision of ['v0', 'v1', 'v2']) for (const item of cases) for (const fault of [false, true]) {
    const { sources, changedHooks } = revisionSources(item.id, revision, { fault, original });
    for (const [path, text] of Object.entries(sources)) assert.equal(ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX).parseDiagnostics.length, 0, revision + ':' + item.id + ':' + path);
    if (revision !== 'v0') assert(Object.values(changedHooks).reduce((a, b) => a + b, 0) > 30);
    if (revision === 'v2') {
      const bank = sources['src/components/BankAccountItem.tsx'];
      assert(bank.includes('Confirm deletion')); assert(bank.includes('setDeleteOpen(true)'));
      assert.equal(bank.split('deleteBankAccount({ id: bankAccount.id });').length - 1, fault && item.id === 'bank-delete' ? 0 : 1);
      assert(sources['src/components/NavDrawer.tsx'].includes('accountMenuOpen &&'));
    }
  }
  assert.equal(JSON.stringify(original), before);
});

test('authorized retained action grammar can express menu and scoped confirmation repairs without new locator keys', () => {
  const original = revisionCalibrationBindings('v0'), changed = revisionCalibrationBindings('v2');
  assert.deepEqual(Object.keys(changed.selectors), Object.keys(original.selectors));
  assert(changed.actions.includes("getByRole('button', { name: 'Account menu'"));
  assert(changed.actions.includes("getByRole('dialog').getByRole('button', { name: 'Confirm deletion'"));
  assert(!changed.selectors.mine.includes('/personal')); assert(!changed.selectors.friends.includes('/contacts'));
});
