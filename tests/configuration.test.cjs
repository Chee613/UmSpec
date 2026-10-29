const test = require('node:test');
const assert = require('node:assert/strict');
test('OAuth configuration installs only a public client ID and minimum feature scopes', () => {
  const { configureManifest } = require('../scripts/configure_google_oauth.cjs');
  const original = { manifest_version: 3, permissions: ['storage'] };
  const result = configureManifest(original, '123-public.apps.googleusercontent.com');
  assert.equal(original.oauth2, undefined);
  assert.equal(result.oauth2.client_id, '123-public.apps.googleusercontent.com');
  assert.ok(result.oauth2.scopes.includes('https://www.googleapis.com/auth/drive.file'));
  assert.ok(!result.oauth2.scopes.includes('https://www.googleapis.com/auth/drive'));
  assert.ok(!JSON.stringify(result).includes('client_secret'));
  assert.throws(() => configureManifest(original, 'not-a-google-client'));
});
