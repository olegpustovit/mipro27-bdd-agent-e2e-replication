import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { inspectVisibleElement, inspectionArguments, inspectionToolResult } from './browser-inspect.mjs';
import { validateCall } from './browser-policy.mjs';

test('inspection accepts only a current element reference, with no actor-supplied code or selectors', () => {
  assert.equal(validateCall('browser_inspect', { target: 'e42' }), null);
  for (const args of [{}, { target: '#private' }, { target: 'e1', function: '() => window.__oracle' }, { target: 'e1', attributes: ['value'] }]) assert(validateCall('browser_inspect', args));
  assert.equal(inspectionArguments('e42').function, inspectVisibleElement.toString());
});

test('fixed inspection reads only bounded attributes and three visible ancestors', () => {
  const element = parent => ({ nodeType: 1, tagName: 'BUTTON', parentElement: parent,
    getBoundingClientRect: () => ({ width: 100, height: 20 }),
    getAttribute: key => ({ 'data-test': 'revised-hook', class: 'x'.repeat(900), value: 'PRIVATE_VALUE', 'data-oracle': 'PRIVATE_STATE' })[key] ?? null,
  });
  let target = null;
  for (let i = 0; i < 6; i++) target = element(target);
  const result = runInNewContext('(' + inspectVisibleElement.toString() + ')(target)', { target, getComputedStyle: () => ({ visibility: 'visible', display: 'block' }) });
  assert.equal(result.ancestors.length, 3);
  assert.equal(result.element.attributes['data-test'], 'revised-hook');
  assert.equal(result.element.attributes.class.length, 256);
  assert(!JSON.stringify(result).includes('PRIVATE'));
  assert.throws(() => runInNewContext('(' + inspectVisibleElement.toString() + ')(target)', { target, getComputedStyle: () => ({ visibility: 'hidden', display: 'block' }) }), /visible/);
});

test('allowlisted attribute contents are public metadata and opacity follows Playwright layout visibility', () => {
  const target = { nodeType: 1, tagName: 'BUTTON', parentElement: null,
    getBoundingClientRect: () => ({ width: 100, height: 20 }),
    getAttribute: name => name === 'title' ? 'PUBLIC_ATTRIBUTE_CONTENT' : null };
  const result = runInNewContext('(' + inspectVisibleElement.toString() + ')(target)', {
    target, getComputedStyle: () => ({ visibility: 'visible', display: 'block', opacity: '0' }),
  });
  assert.equal(result.element.attributes.title, 'PUBLIC_ATTRIBUTE_CONTENT');
});

test('actor receives only validated inspection fields, never native diagnostics or private extras', () => {
  const value = { schema: 'visible-dom-attributes-v1', element: { tag: 'button', attributes: { 'data-test': 'new-hook', value: 'SECRET', 'data-oracle': 'SECRET' }, privateState: 'SECRET' }, ancestors: [], privateState: 'SECRET' };
  const native = { content: [{ type: 'text', text: '### Result\n' + JSON.stringify(value) + '\n### Page\nPRIVATE_SNAPSHOT' }], structuredContent: { secret: 'SECRET' }, _meta: { secret: 'SECRET' } };
  const response = inspectionToolResult(native);
  assert.deepEqual(JSON.parse(response.content[0].text), { schema: value.schema, element: { tag: 'button', attributes: { 'data-test': 'new-hook' } }, ancestors: [] });
  for (const bad of [null, { isError: true, content: [{ type: 'text', text: 'SECRET_STACK' }] }, { content: [{ type: 'text', text: '### Result\ninvalid SECRET' }] }]) {
    const result = inspectionToolResult(bad); assert.equal(result.isError, true); assert(!JSON.stringify(result).includes('SECRET'));
  }
});
