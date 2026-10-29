const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('../shared/sync-core.js');

test('replacement revisions keep one source identity and preserve course folders', async () => {
  const materials = require('../content/materials.js');
  const course = { id: 123, fullName: 'WIA1001 Computing', folderName: 'WIA1001_Computing' };
  const item = { url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=7', name: 'Notes', category: '1.Lecture Slide' };
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
    UmSpecSync: core, UmSpecCalendarCore: require('../shared/calendar-core.js')
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
