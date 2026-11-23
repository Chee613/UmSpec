const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('../shared/sync-core.js');

test('replacement revisions keep one source identity and preserve course folders', async () => {
  const materials = require('../content/materials.js');
  const course = { id: 123, fullName: 'WIA1001 Computing', folderName: 'WIA1001_Computing' };
  const item = { url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=7', name: 'Notes', category: 'Lecture Slides' };
  const a = await materials.describeMaterial(course, item, {
    url: 'https://spectrum.um.edu.my/pluginfile.php/44/mod_resource/content/1/notes.pdf', kind: 'binary'
  }, 'semester');
  const b = await materials.describeMaterial(course, item, {
    url: 'https://spectrum.um.edu.my/pluginfile.php/44/mod_resource/content/2/notes.pdf', kind: 'binary'
  }, 'semester');
  assert.equal(a.sourceKey, b.sourceKey);
  assert.notEqual(a.sourceFingerprint, b.sourceFingerprint);
  assert.equal(a.name, 'notes.pdf');
  assert.equal(a.courseFolder, 'WIA1001_Computing');
  await assert.rejects(materials.describeMaterial(course, item, { url: 'https://evil.example/file.pdf', kind: 'binary' }, 'semester'));
});

test('exporter never turns an unreviewed AI date into a confirmed calendar event', async () => {
  const context = {
    console, URL, TextEncoder, TextDecoder, crypto, setTimeout, clearTimeout, AbortController,
    location: { origin: 'https://spectrum.um.edu.my', pathname: '/my/' },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { readyState: 'loading', addEventListener() {}, querySelector: () => null },
    UmSpecSync: core, UmSpecCalendarCore: require('../shared/calendar-core.js'), UmSpecCourseScan: require('../shared/course-scan.js')
  };
  context.window = context;
  vm.runInNewContext(fs.readFileSync('content/content.js', 'utf8'), context);
  assert.ok(context.UmSpecExporter);
  const ics = await context.UmSpecExporter.generateDeadlinesICS([{
    courseCode: 'WIA1001', courseName: 'Computing',
    assessments: [{ name: 'Assignment', dueWeek: 'Week 6', estimatedDate: '2026-11-15' }]
  }]);
  assert.equal(ics.includes('BEGIN:VEVENT'), false);
  assert.equal(context.UmSpecExporter.getContext(), null);
});

test('a stale Spectrum tab cannot authorise writes after the cookie account changes', async () => {
  const profileSelector = selector => selector.includes('.usermenu') || selector.includes('[data-region="usermenu"]');
  const context = {
    console, URL, TextEncoder, crypto, setTimeout, clearTimeout, AbortController, AbortSignal,
    location: { origin: 'https://spectrum.um.edu.my', pathname: '/my/' },
    localStorage: { getItem: () => null, setItem() {} },
    document: {
      readyState: 'loading', addEventListener() {},
      querySelector: selector => profileSelector(selector)
        ? { getAttribute: () => '/user/profile.php?id=42' }
        : selector.includes('logout.php') ? { href: 'https://spectrum.um.edu.my/login/logout.php?sesskey=old-session' } : null
    },
    fetch: async () => ({ ok: true, url: 'https://spectrum.um.edu.my/my/', text: async () => 'fresh-account' }),
    DOMParser: class {
      parseFromString() { return { querySelector: selector => profileSelector(selector)
        ? { getAttribute: () => '/user/profile.php?id=43' } : null }; }
    }
  };
  context.window = context;
  vm.runInNewContext(fs.readFileSync('content/content.js', 'utf8'), context);
  assert.equal(context.UmSpecExporter.getContext().userId, '42');
  await assert.rejects(context.UmSpecExporter.verifyContext(), { code: 'ACCOUNT_CHANGED' });
});

function identityFixture({ script = '', menuHref = null, otherHref = null, remote = {} } = {}) {
  const page = ({ script = '', menuHref = null, otherHref = null, login = false }) => ({
    readyState: 'loading', addEventListener() {}, scripts: [{ textContent: script }],
    querySelector(selector) {
      if (selector.includes('form#login') || selector.includes('input[name="password"]')) return login ? {} : null;
      if (selector.includes('logout.php')) return { href: 'https://spectrum.um.edu.my/login/logout.php?sesskey=session' };
      const generic = selector.split(',').some(part => /^\s*a\[/.test(part));
      const href = generic && otherHref || menuHref;
      return href ? { getAttribute: () => href } : null;
    }
  });
  const context = {
    console, URL, TextEncoder, crypto, setTimeout, clearTimeout, AbortController, AbortSignal,
    location: { origin: 'https://spectrum.um.edu.my', pathname: '/my/' },
    localStorage: { getItem: () => null, setItem() {} },
    document: page({ script, menuHref, otherHref }),
    fetch: async () => {
      if (remote.networkError) throw new Error('offline');
      return { ok: remote.ok !== false, url: remote.url || 'https://spectrum.um.edu.my/my/', text: async () => 'fresh-page' };
    },
    DOMParser: class { parseFromString() { return page(remote); } }
  };
  context.window = context;
  vm.runInNewContext(fs.readFileSync('content/content.js', 'utf8'), context);
  return context.UmSpecExporter;
}

test('inline JSON Spectrum configuration identifies the signed-in user in an isolated content script', async () => {
  const script = 'M . cfg = { "sesskey": "session", "userId": 42 }\n';
  const exporter = identityFixture({ script, remote: { script } });
  assert.equal(exporter.getContext()?.userId, '42');
  assert.equal((await exporter.verifyContext()).userId, '42');
  assert.equal(identityFixture({ script, otherHref: '/user/profile.php?id=99' }).getContext()?.userId, '42');
});

test('only a same-origin current-account profile link can identify the signed-in user', () => {
  assert.equal(identityFixture({ otherHref: '/user/profile.php?id=99' }).getContext(), null);
  assert.equal(identityFixture({ menuHref: 'https://other.example/user/profile.php?id=42' }).getContext(), null);
  assert.equal(identityFixture({ menuHref: '/user/profile.php?id=42', otherHref: '/user/profile.php?id=99' }).getContext()?.userId, '42');
});

test('fresh Spectrum verification rejects expired, failed and unrecognised responses', async t => {
  for (const [name, remote] of [
    ['HTTP error', { ok: false }], ['network error', { networkError: true }],
    ['login redirect', { url: 'https://spectrum.um.edu.my/login/index.php', menuHref: '/user/profile.php?id=42' }],
    ['login form', { login: true, menuHref: '/user/profile.php?id=42' }],
    ['cross-origin redirect', { url: 'https://other.example/my/', menuHref: '/user/profile.php?id=42' }],
    ['missing identity', {}], ['other-user profile', { otherHref: '/user/profile.php?id=99' }]
  ]) await t.test(name, async () => {
    const exporter = identityFixture({ menuHref: '/user/profile.php?id=42', remote });
    await assert.rejects(exporter.verifyContext(), error => error.code === 'LOGIN_REQUIRED' && /Spectrum/.test(error.message));
  });
});

test('a hung material page times out even when the sync passes its own cancel signal', async () => {
  const realTimeout = AbortSignal.timeout, realFetch = global.fetch;
  const timeouts = [];
  AbortSignal.timeout = delay => { timeouts.push(delay); return realTimeout.call(AbortSignal, 60000); };
  let received;
  global.fetch = async (url, options) => { received = options.signal; throw new Error('stop after capturing the signal'); };
  const { signal } = new AbortController();
  try {
    const materials = require('../content/materials.js');
    await assert.rejects(materials.resolveItemFiles({ url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=7', type: 'resource', name: 'Notes' }, signal), /stop after/);
    assert.deepEqual(timeouts, [25000]);
    assert.notEqual(received, signal, 'the fetch signal must combine cancel and timeout');
  } finally { AbortSignal.timeout = realTimeout; global.fetch = realFetch; }
});

test('submission tools stay links without being opened, and left-out items say why', async t => {
  const materials = require('../content/materials.js');
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; });
  let fetched = 0;
  globalThis.fetch = async () => { fetched++; throw new TypeError('Failed to fetch'); };
  const files = await materials.resolveItemFiles({ type: 'turnitintooltwo', name: 'Turnitin Assignment 2',
    url: 'https://spectrum.um.edu.my/mod/turnitintooltwo/view.php?id=5' });
  assert.deepEqual(files.map(file => file.kind), ['link']);
  assert.equal(fetched, 0);
  globalThis.fetch = async url => Object.defineProperty(new Response('', { status: 404 }), 'url', { value: url });
  const error = await materials.resolveItemFiles({ type: 'resource', name: 'Old slides', url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=9' }).catch(e => e);
  assert.deepEqual(materials.skippedItem({ name: 'Old\nslides' }, error), { name: 'Old slides', reason: 'broken link on Spectrum', permanent: true });
  assert.equal(materials.skippedItem({ name: 'Notes' }, new TypeError('Failed to fetch')).permanent, false);
});

test('a link whose address was pasted as "Join: https://…" keeps the real https address', async () => {
  const materials = require('../content/materials.js');
  const files = await materials.resolveItemFiles({ type: 'label', name: 'Teams class', isExternal: true,
    url: 'join: https://teams.microsoft.com/meet/123?p=abc' });
  assert.deepEqual(files.map(file => [file.kind, file.url]), [['link', 'https://teams.microsoft.com/meet/123?p=abc']]);
  await assert.rejects(materials.resolveItemFiles({ type: 'url', name: 'Old site', url: 'http://example.com/page' }), /Unsupported material URL/);
});
