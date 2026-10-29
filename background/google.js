(function (root) {
  'use strict';
  const scopes = {
    drive: ['openid', 'email', 'https://www.googleapis.com/auth/drive.file'],
    calendar: ['openid', 'email', 'https://www.googleapis.com/auth/calendar.app.created',
      'https://www.googleapis.com/auth/calendar.calendarlist.readonly']
  };
  const identities = new Map();
  let expectedSub = null;
  const fail = (code, message) => Object.assign(new Error(message), { code });
  function configured() {
    const client = root.chrome?.runtime?.getManifest()?.oauth2?.client_id;
    return typeof client === 'string' && /^[\w.-]+\.apps\.googleusercontent\.com$/.test(client);
  }
  async function tokenFor(feature, interactive) {
    if (!scopes[feature]) throw fail('INVALID_FEATURE', 'Choose Drive or Calendar.');
    if (!configured()) throw fail('CONFIG_REQUIRED', 'Google setup is required. Open the bundled Google setup guide.');
    const result = await chrome.identity.getAuthToken({ interactive: Boolean(interactive), scopes: scopes[feature] });
    const token = typeof result === 'string' ? result : result?.token;
    if (!token) throw fail('RECONNECT_REQUIRED', 'Reconnect your Google account.');
    if (Array.isArray(result?.grantedScopes) && scopes[feature].some(scope => !result.grantedScopes.includes(scope))) {
      throw fail('SCOPE_REQUIRED', 'Google did not grant the permissions needed for this feature.');
    }
    return token;
  }
  async function identity(token) {
    if (identities.has(token)) return identities.get(token);
    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(25000)
    });
    if (!response.ok) throw Object.assign(fail('RECONNECT_REQUIRED', 'Could not verify the connected Google account.'), { status: response.status });
    const user = await response.json();
    if (!user.sub || !user.email) throw fail('RECONNECT_REQUIRED', 'Google did not return an account identity.');
    const account = { sub: String(user.sub), email: String(user.email) };
    identities.set(token, account);
    return account;
  }
  async function verifiedToken(feature, interactive = false) {
    let token = await tokenFor(feature, interactive);
    try { return { token, account: await identity(token) }; }
    catch (e) {
      if (e.status !== 401) throw e;
      await chrome.identity.removeCachedAuthToken({ token });
      identities.delete(token);
      token = await tokenFor(feature, false);
      return { token, account: await identity(token) };
    }
  }
  async function connectGoogle(feature, interactive = false) {
    const { account } = await verifiedToken(feature, interactive);
    expectedSub = account.sub;
    return { ...account, grantedScopes: scopes[feature] };
  }
  async function verifyAccount(sub, feature) {
    expectedSub = String(sub);
    const { account } = await verifiedToken(feature);
    if (account.sub !== expectedSub) throw fail('ACCOUNT_CHANGED', 'Google account changed. Reconnect before syncing.');
    return account;
  }
  async function googleFetch(path, options = {}, feature = 'drive') {
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) {
      throw fail('FORBIDDEN', 'Only supported Google API paths are allowed.');
    }
    const url = new URL(path, 'https://www.googleapis.com');
    if (url.origin !== 'https://www.googleapis.com' ||
        !/^\/(drive\/v3\/|upload\/drive\/v3\/|calendar\/v3\/)/.test(url.pathname)) {
      throw fail('FORBIDDEN', 'Unsupported Google API endpoint.');
    }
    const { retry = true, idempotent = false, ...request } = options;
    const method = (request.method || 'GET').toUpperCase();
    const canRetry = retry && (method !== 'POST' || idempotent);
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const { token, account } = await verifiedToken(feature);
      if (!expectedSub || account.sub !== expectedSub) throw fail('ACCOUNT_CHANGED', 'Reconnect the intended Google account.');
      const headers = new Headers(request.headers);
      headers.set('Authorization', 'Bearer ' + token);
      let response;
      try {
        response = await fetch(url.href, {
          ...request, headers, signal: request.signal || AbortSignal.timeout(25000), redirect: 'error'
        });
      } catch (e) {
        if (!canRetry || attempt >= 3 || request.signal?.aborted) throw e;
        await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt + Math.random() * 250));
        continue;
      }
      if (response.status === 401 && !refreshed) {
        await chrome.identity.removeCachedAuthToken({ token });
        identities.delete(token);
        refreshed = true;
        continue;
      }
      if (!canRetry || attempt >= 3 || ![429, 500, 502, 503, 504].includes(response.status)) return response;
      const retryAfter = response.headers.get('Retry-After');
      const wait = retryAfter
        ? (/^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now())
        : 1000 * 2 ** attempt + Math.random() * 250;
      if (wait > 59000) throw fail('RETRY_LATER', 'Google asked us to retry later. Use Sync now later.');
      await new Promise(resolve => setTimeout(resolve, Math.max(0, wait)));
    }
  }
  async function disconnectGoogle() {
    identities.clear();
    expectedSub = null;
    await chrome.identity.clearAllCachedAuthTokens();
  }
  const api = { configured, connectGoogle, verifyAccount, googleFetch, disconnectGoogle };
  root.UmSpecGoogle = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
