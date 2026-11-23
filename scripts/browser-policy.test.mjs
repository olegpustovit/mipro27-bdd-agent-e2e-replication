import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCall } from './browser-policy.mjs';

test('runtime agent cannot use code, files, direct network or fixture controls', () => {
  for (const name of ['browser_evaluate', 'browser_run_code', 'browser_file_upload', 'browser_network_requests', 'browser_close']) assert.ok(validateCall(name));
  for (const url of ['file:///etc/passwd', 'http://localhost:3001/testData/users', 'http://example.com', 'http://localhost:3000/__oracle', 'http://u:p@localhost:3000/']) assert.ok(validateCall('browser_navigate', { url }));
  assert.equal(validateCall('browser_navigate', { url: 'http://localhost:3000/signin' }), null);
  assert.equal(validateCall('browser_fill_form', { fields: [] }), null);
  assert.ok(validateCall('browser_snapshot', { filename: '/tmp/capture.md' }));
  for (const path of ['/src/components/SignInForm.tsx', '/@fs/etc/passwd', '/.env', '/testData/seed', '/graphql', '/signin?file=source']) assert.ok(validateCall('browser_navigate', { url: `http://localhost:3000${path}` }));
  for (const path of ['/', '/personal', '/contacts', '/transaction/1xfcAhNDZK4', '/transaction/new', '/bankaccounts/new', '/user/settings']) assert.equal(validateCall('browser_navigate', { url: `http://localhost:3000${path}` }), null);
});
