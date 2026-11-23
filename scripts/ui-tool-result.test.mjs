import test from 'node:test';
import assert from 'node:assert/strict';
import { uiToolResult, uiToolError } from './ui-tool-result.mjs';

test('native diagnostics are withheld without erasing an identically worded visible UI snapshot', () => {
  const input = { content: [{ type: 'text', text: '### Page\n- Page URL: http://localhost:3000/\n- HTTP status: 500 Server Error\n- Console: 6 errors, 3 warnings\n### Snapshot\n```yaml\n- heading "HTTP status: 500"\n- Console: visible application text\n### Events\n- New console entries: visible application text\n```\n### Events\n- New console entries: private.log' }] };
  const filtered = uiToolResult(input).content[0].text;
  assert(!filtered.includes('private.log'));
  assert(!filtered.includes('6 errors'));
  assert(!filtered.includes('500 Server Error'));
  assert(filtered.includes('Page URL:'));
  assert(filtered.includes('Console: visible application text'));
  assert(filtered.includes('New console entries: visible application text'));
  assert(input.content[0].text.includes('private.log'), 'private source must remain intact');
});

test('structured native diagnostics and protocol error data cannot bypass UI content filtering', () => {
  const native = { structuredContent: { console: 'private diagnostic' }, _meta: { network: 'private' }, content: [{ type: 'text', text: '### Snapshot\nVisible page', _meta: { secret: 'private' } }] };
  assert.deepEqual(uiToolResult(native), { content: [{ type: 'text', text: '### Snapshot\nVisible page' }] });
  assert.deepEqual(uiToolError({ code: -32000, message: 'Internal backend stack', data: 'private response' }), { code: -32000, message: 'Browser UI tool request failed.' });
  assert(native.structuredContent.console, 'raw audit object must remain intact');
  assert(!JSON.stringify(uiToolResult({ structuredContent: { secret: 'private response' } })).includes('private response'));
});

test('visible download events, action errors and nontext blocks remain unchanged', () => {
  const result = { isError: true, content: [{ type: 'text', text: '### Error\nControl is not visible\n### Events\n- New console entries: private.log\n- Downloading file receipt.pdf ...' }, { type: 'image', data: 'unchanged', mimeType: 'image/png' }] };
  const clean = uiToolResult(result);
  assert(clean.isError);
  assert(clean.content[0].text.includes('Control is not visible'));
  assert(clean.content[0].text.includes('Downloading file receipt.pdf'));
  assert(!clean.content[0].text.includes('private.log'));
  assert.deepEqual(clean.content[1], result.content[1]);
});
