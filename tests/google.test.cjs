const test = require('node:test');
const assert = require('node:assert/strict');
const google = require('../background/google.js');
function environment(t) {
  const prior = { chrome: global.chrome, fetch: global.fetch, setTimeout: global.setTimeout };
  t.after(() => Object.assign(global, prior));
  global.chrome = {
    runtime: { getManifest: () => ({ oauth2: { client_id: '123-test.apps.googleusercontent.com' } }) },
    identity: { getAuthToken: async () => ({ token: 'google-test-token' }),
      removeCachedAuthToken: async () => {}, clearAllCachedAuthTokens: async () => {} }
  };
  global.setTimeout = callback => { callback(); return 0; };
}
test('transient transport failures retry safe reads but never replay an unsafe calendar create', async t => {
  environment(t);
  let reads = 0, creates = 0;
  global.fetch = async (url, options) => {
    if (new URL(url).pathname.includes('userinfo')) return Response.json({ sub: 'account', email: 'student@example.com' });
    if (options.method === 'POST') { creates++; throw new TypeError('connection lost'); }
    if (++reads === 1) throw new TypeError('connection lost');
    return Response.json({ files: [] });
  };
  await google.verifyAccount('account', 'drive');
  const result = await google.googleFetch('/drive/v3/files', {}, 'drive');
  assert.equal(result.status, 200);
  assert.equal(reads, 2);
  await assert.rejects(google.googleFetch('/calendar/v3/calendars', { method: 'POST' }, 'calendar'));
  assert.equal(creates, 1);
});
test('an excessively long provider retry delay returns an actionable error without blocking', async t => {
  environment(t);
  global.fetch = async url => new URL(url).pathname.includes('userinfo')
    ? Response.json({ sub: 'account', email: 'student@example.com' })
    : new Response('{}', { status: 429, headers: { 'Retry-After': '3600' } });
  await google.verifyAccount('account', 'drive');
  await assert.rejects(google.googleFetch('/drive/v3/files', {}, 'drive'), { code: 'RETRY_LATER' });
});
