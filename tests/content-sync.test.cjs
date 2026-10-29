const test = require('node:test');
const assert = require('node:assert/strict');
const sync = require('../content/student-sync.js');

test('six-month scan uses the Malaysia month across UTC boundaries', () => {
  assert.deepEqual(sync.calendarMonths('2026-12-31T18:00:00Z'), [
    { year: 2027, month: 1 }, { year: 2027, month: 2 }, { year: 2027, month: 3 },
    { year: 2027, month: 4 }, { year: 2027, month: 5 }, { year: 2027, month: 6 }
  ]);
});

test('feature cooldowns stay independent and manual runs bypass them', () => {
  const status = { settings: { mode: 'drive', autoSync: false, calendarEnabled: true, announcementScanning: true },
    syncTimes: { drive: { lastAttemptAt: 1 }, calendar: { lastAttemptAt: 950000 }, announcements: { lastAttemptAt: 1 } } };
  assert.equal(sync.shouldRunFeature('drive', status, true, 1000000), false);
  assert.equal(sync.shouldRunFeature('calendar', status, true, 1000000), false);
  assert.equal(sync.shouldRunFeature('announcements', status, true, 1000000), true);
  assert.equal(sync.shouldRunFeature('calendar', status, false, 1000000), true);
  assert.equal(sync.shouldRunFeature('drive', { ...status, job: { done: false, status: 'running' } }, true, 1000000), true);
  assert.equal(sync.shouldRunFeature('calendar', { ...status, calendarJob: { done: false, status: 'paused' } }, true, 2000000), false);
  assert.equal(sync.shouldRunFeature('drive', { ...status, job: { done: false, status: 'running', scopeChanged: true } }, true, 2000000), false);
});

test('Spectrum URL boundary rejects foreign hosts, login paths and session secrets', () => {
  assert.equal(sync.safeSpectrumUrl('/mod/forum/discuss.php?d=7'), 'https://spectrum.um.edu.my/mod/forum/discuss.php?d=7');
  for (const url of ['https://spectrum.um.edu.my.attacker.example/course/view.php?id=1',
    'javascript:alert(1)', '/login/index.php', '/mod/forum/discuss.php?d=7&sesskey=secret']) {
    assert.throws(() => sync.safeSpectrumUrl(url));
  }
});

// Synthetic API examples test a strict runtime adapter, not a verified live Spectrum fixture.
test('official adapter filters selected course deadlines and explicit course meetings', async () => {
  const result = await sync.adaptCalendarResponse([{ data: { weeks: [{ days: [{ events: [
    { id: 77, course: { id: 123 }, name: 'Report', description: '', eventtype: 'due', modulename: 'assign', timestart: 1794758340, timeduration: 0 },
    { id: 78, course: { id: 123 }, name: 'Lecture', description: '', eventtype: 'course', timestart: 1794700800, timeduration: 3600 },
    { id: 79, course: { id: 123 }, name: 'Assignment opens', eventtype: 'open', modulename: 'assign', timestart: 1794700800, timeduration: 0 },
    { id: 80, course: { id: 999 }, name: 'Unselected', eventtype: 'due', modulename: 'quiz', timestart: 1794700800, timeduration: 0 }
  ] }] }] } }], ['123']);
  assert.equal(result.length, 2);
  assert.equal(result[0].sourceKey, 'moodle:course:123:event:77');
  assert.equal(result[0].start, '2026-11-15T23:59:00+08:00');
  assert.equal(result[1].end, '2026-11-15T09:00:00+08:00');
  assert.match(result[0].sourceRevision, /^[a-f0-9]{64}$/);
});

test('unavailable or malformed calendar capability is never an empty successful scan', async () => {
  for (const payload of [[], [{ error: true, exception: { message: 'Denied' } }], [{ data: {} }],
    [{ data: { weeks: [{ days: [{ events: [{ id: 9, course: { id: 123 }, eventtype: 'due', modulename: 'assign', timestart: 'not-a-timestamp', timeduration: 0 }] }] }] } }]
  ]) await assert.rejects(sync.adaptCalendarResponse(payload, ['123']));
});

test('native review controls produce explicit Malaysia offsets and preserve revision', () => {
  assert.deepEqual(sync.makeReviewFields({ sourceRevision: 'rev2', title: 'Meeting', kind: 'meeting' }, {
    date: '2026-12-15', time: '14:00', endDate: '2026-12-15', endTime: '15:00', title: 'Meeting', meetingUrl: ''
  }), { reviewedRevision: 'rev2', title: 'Meeting', kind: 'meeting', precision: 'instant',
    start: '2026-12-15T14:00:00+08:00', end: '2026-12-15T15:00:00+08:00', meetingUrl: null });
  const result = sync.makeReviewFields({ sourceRevision: 'rev1', kind: 'deadline', title: 'Report' }, { date: '2026-12-15' });
  assert.equal(result.start, '2026-12-15');
  assert.equal(result.end, null);
  assert.equal(result.precision, 'date');
});

test('announcement forums require a recognised name and exact Spectrum forum URL', () => {
  assert.equal(sync.announcementForum('Pengumuman', '/mod/forum/view.php?id=5'), 'https://spectrum.um.edu.my/mod/forum/view.php?id=5');
  assert.equal(sync.announcementForum('News forum', '/mod/forum/view.php?f=5'), 'https://spectrum.um.edu.my/mod/forum/view.php?f=5');
  assert.equal(sync.announcementForum('Student discussion', '/mod/forum/view.php?id=5'), null);
  assert.equal(sync.announcementForum('Announcements', 'https://attacker.example/mod/forum/view.php?id=5'), null);
  assert.equal(sync.safeForumPage('/mod/forum/view.php?id=5&page=2', '/mod/forum/view.php?id=5'), 'https://spectrum.um.edu.my/mod/forum/view.php?id=5&page=2');
  assert.throws(() => sync.safeForumPage('/mod/forum/view.php?id=99&page=2', '/mod/forum/view.php?id=5'));
  assert.throws(() => sync.safeForumPage('/course/view.php?id=5', '/mod/forum/view.php?id=5'));
});

test('official scanner performs six read requests and deduplicates monthly IDs', async t => {
  const oldFetch = global.fetch, oldExporter = global.UmSpecExporter;
  t.after(() => { global.fetch = oldFetch; global.UmSpecExporter = oldExporter; });
  global.UmSpecExporter = { getSesskey: () => 'synthetic-session-key' };
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, redirected: false, json: async () => [{ data: { weeks: [{ days: [{ events: [
      { id: 77, courseid: 123, name: 'Report', eventtype: 'due', modulename: 'assign', timestart: 1794758340, timeduration: 0 }
    ] }] }] } }] };
  };
  const result = await sync.discoverOfficialEvents(['123'], undefined, '2026-10-24T00:00:00Z');
  assert.equal(result.complete, true);
  assert.equal(result.records.length, 1);
  assert.equal(requests.length, 6);
  const body = JSON.parse(requests[0].options.body);
  assert.equal(body[0].methodname, 'core_calendar_get_calendar_monthly_view');
  assert.equal(body[0].args.month, 10);
  assert.equal(requests[0].options.credentials, 'include');
});

test('calendar API denial reports incomplete coverage without inventing records', async t => {
  const oldFetch = global.fetch, oldExporter = global.UmSpecExporter;
  t.after(() => { global.fetch = oldFetch; global.UmSpecExporter = oldExporter; });
  global.UmSpecExporter = { getSesskey: () => 'synthetic-session-key' };
  global.fetch = async () => ({ ok: false, status: 403 });
  const result = await sync.discoverOfficialEvents(['123'], undefined, '2026-10-24T00:00:00Z');
  assert.equal(result.complete, false);
  assert.deepEqual(result.records, []);
  assert.ok(result.failures.length > 0);
});

test('manual sync remembers explicitly selected courses while automatic visits keep stored scope', async t => {
  const oldChrome = global.chrome, oldExporter = global.UmSpecExporter;
  t.after(() => { global.chrome = oldChrome; global.UmSpecExporter = oldExporter; });
  const messages = [];
  let status = { settings: { mode: 'zip', courseIds: ['456'], autoSync: false, calendarEnabled: false, announcementScanning: false }, syncTimes: {} };
  global.chrome = { runtime: { sendMessage: async message => {
    messages.push(message);
    if (message.type === 'SAVE_SETTINGS') status = { ...status, settings: { ...status.settings, ...message.settings } };
    return { ok: true, data: status };
  } } };
  global.UmSpecExporter = { getContext: () => ({ userId: '42', origin: 'https://spectrum.um.edu.my' }),
    selectedCourses: () => [{ id: 123 }], videoPolicy: () => 'links' };
  await sync.syncNow({ automatic: true });
  assert.equal(messages.some(m => m.type === 'SAVE_SETTINGS'), false);
  await sync.syncNow();
  assert.deepEqual(messages.find(m => m.type === 'SAVE_SETTINGS').settings.courseIds, ['123']);
});

test('ZIP selection hands control back to the existing exporter', async t => {
  const oldChrome = global.chrome, oldExporter = global.UmSpecExporter;
  t.after(() => { global.chrome = oldChrome; global.UmSpecExporter = oldExporter; });
  const commands = [];
  global.UmSpecExporter = { getContext: () => null, verifyContext: async () => { throw new Error('Unrecognised deployed profile selector'); } };
  global.chrome = { runtime: { sendMessage: async message => {
    commands.push(message.type); return { ok: true, data: { settings: { mode: 'zip' } } };
  } } };
  assert.equal(await sync.exportOrSync(), false);
  assert.deepEqual(commands, ['GET_STATUS']);
});

test('manual sync does not commit an unsaved semester folder from the hidden Settings tab', async t => {
  const previous = { chrome: global.chrome, exporter: global.UmSpecExporter, document: global.document };
  t.after(() => { global.chrome = previous.chrome; global.UmSpecExporter = previous.exporter; global.document = previous.document; });
  const messages = [];
  const state = { settings: { mode: 'zip', courseIds: ['123'], archiveId: 'Saved semester', videoPolicy: 'links' }, syncTimes: {} };
  global.document = { getElementById: id => id === 'umspec-sync-archive' ? { value: 'Unsaved semester' } : null };
  global.UmSpecExporter = { getContext: () => ({ userId: '42', origin: 'https://spectrum.um.edu.my' }), selectedCourses: () => [{ id: 123 }], videoPolicy: () => 'links' };
  global.chrome = { runtime: { sendMessage: async message => { messages.push(message); return { ok: true, data: state }; } } };
  await sync.syncNow();
  const saved = messages.find(message => message.type === 'SAVE_SETTINGS').settings;
  assert.equal(Object.hasOwn(saved, 'archiveId'), false);
  assert.equal(state.settings.archiveId, 'Saved semester');
});

test('Drive selection fails closed when current Spectrum identity cannot be verified', async t => {
  const oldChrome = global.chrome, oldExporter = global.UmSpecExporter;
  t.after(() => { global.chrome = oldChrome; global.UmSpecExporter = oldExporter; });
  const commands = [];
  global.UmSpecExporter = { getContext: () => null, verifyContext: async () => { throw new Error('Session could not be verified'); } };
  global.chrome = { runtime: { sendMessage: async message => {
    commands.push(message.type); return { ok: true, data: { settings: { mode: 'drive' } } };
  } } };
  await assert.rejects(sync.exportOrSync(), /Session could not be verified/);
  assert.deepEqual(commands, ['GET_STATUS']);
});

test('fresh account verification overrides a cached page identity before worker context is set', async t => {
  const oldChrome = global.chrome, oldExporter = global.UmSpecExporter;
  t.after(() => { global.chrome = oldChrome; global.UmSpecExporter = oldExporter; });
  const commands = [];
  global.UmSpecExporter = { getContext: () => ({ userId: '42', origin: 'https://spectrum.um.edu.my' }),
    verifyContext: async () => ({ userId: '43', origin: 'https://spectrum.um.edu.my' }) };
  global.chrome = { runtime: { sendMessage: async message => {
    commands.push(message); return { ok: true, data: { settings: { mode: 'zip', courseIds: [] } } };
  } } };
  await sync.syncNow({ automatic: true });
  assert.equal(commands[0].userId, '43');
  global.UmSpecExporter.verifyContext = async () => null;
  await assert.rejects(sync.syncNow({ automatic: true }), /signed-in/);
  assert.equal(commands.length, 1);
});

async function coordinatorResult(t, feature, completedJob) {
  const previous = { chrome: global.chrome, exporter: global.UmSpecExporter, document: global.document };
  t.after(() => { global.chrome = previous.chrome; global.UmSpecExporter = previous.exporter; global.document = previous.document; });
  const output = { textContent: '' };
  global.document = { getElementById: id => id === 'umspec-sync-status' ? output : null };
  global.UmSpecExporter = { getContext: () => ({ userId: '42', origin: 'https://spectrum.um.edu.my' }),
    selectedCourses: () => [{ id: '123' }], videoPolicy: () => 'links' };
  const key = feature === 'drive' ? 'job' : 'calendarJob';
  let status = { configured: true, account: { features: [feature] }, tabId: 1, bindingHash: 'binding', syncTimes: {},
    settings: { mode: feature === 'drive' ? 'drive' : 'zip', calendarEnabled: feature === 'calendar',
      courseIds: ['123'], archiveId: '2026-1' },
    [key]: { id: 'job', status: 'running', done: false, tabId: 1, cursor: 0 } };
  global.chrome = { runtime: { sendMessage: async message => {
    if (message.type === 'DRIVE_STEP' || message.type === 'CALENDAR_STEP') status = { ...status, [key]: { ...status[key], ...completedJob, done: true, status: 'complete' } };
    return { ok: true, data: status };
  } } };
  await sync.syncNow();
  return output.textContent;
}

test('completed Drive failures or conflicts remain an actionable partial-sync status', async t => {
  const message = await coordinatorResult(t, 'drive', { summary: { failed: 2, conflicts: 1 } });
  assert.match(message, /2 failed/);
  assert.match(message, /1 conflict/);
  assert.doesNotMatch(message, /up to date/i);
});

test('calendar review and restore results stay visibly unresolved after job completion', async t => {
  const message = await coordinatorResult(t, 'calendar', { results: [{ action: 'review' }, { action: 'restore' }] });
  assert.match(message, /2.*review/i);
  assert.doesNotMatch(message, /up to date/i);
});
