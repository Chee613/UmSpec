const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('popup refresh waits for verified worker context and reports verification failures', async () => {
  let listener, verify, persist;
  const exporter = { getContext: () => null };
  const context = { console, URL, AbortSignal, AbortController,
    document: { getElementById: () => null, documentElement: {} },
    MutationObserver: class { observe() {} }, addEventListener() {},
    UmSpecExporter: exporter,
    chrome: { runtime: { id: 'umspec', onMessage: { addListener: callback => { listener = callback; } },
      sendMessage: () => new Promise(resolve => { persist = resolve; }) } }
  };
  vm.runInNewContext(fs.readFileSync('content/student-sync.js', 'utf8'), context);
  await new Promise(setImmediate);
  exporter.verifyContext = () => new Promise(resolve => { verify = resolve; });
  let response;
  assert.equal(listener({ type: 'UMSPEC_REFRESH_STATUS' }, { id: 'umspec' }, value => { response = value; }), true);
  assert.equal(response, undefined);
  verify({ userId: '42', origin: 'https://spectrum.um.edu.my' });
  await new Promise(setImmediate);
  assert.equal(response, undefined, 'verification alone must not acknowledge before SET_CONTEXT finishes');
  persist({ ok: true, data: { bindingHash: 'verified', settings: { mode: 'zip' } } });
  await new Promise(setImmediate);
  assert.equal(response.ok, true);
  exporter.verifyContext = async () => { throw Object.assign(new Error('Spectrum account changed. Refresh this tab.'), { code: 'ACCOUNT_CHANGED' }); };
  response = undefined;
  listener({ type: 'UMSPEC_REFRESH_STATUS' }, { id: 'umspec' }, value => { response = value; });
  await new Promise(setImmediate);
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'ACCOUNT_CHANGED');
  assert.match(response.error.message, /Refresh this tab/);
});
