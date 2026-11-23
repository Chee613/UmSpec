const test = require('node:test');
const assert = require('node:assert/strict');
const sync = require('../content/student-sync.js');

test('the date scan reads last month and six months ahead, using the Malaysia month across UTC boundaries', () => {
  assert.deepEqual(sync.calendarMonths('2026-12-31T18:00:00Z'), [
    { year: 2026, month: 12 }, { year: 2027, month: 1 }, { year: 2027, month: 2 }, { year: 2027, month: 3 },
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

test('automatic Drive visits require a first successful sync but can resume an active job', () => {
  const status = { settings: { mode: 'drive', autoSync: true }, syncTimes: {} };
  assert.equal(sync.shouldRunFeature('drive', status, true), false);
  assert.equal(sync.shouldRunFeature('drive', status, false), true);
  assert.equal(sync.shouldRunFeature('drive', { ...status, job: { done: false, status: 'running' } }, true), true);
  assert.equal(sync.shouldRunFeature('drive', { ...status, job: { done: false, status: 'paused' } }, true), false);
  assert.equal(sync.shouldRunFeature('drive', { ...status, syncTimes: { drive: { lastSuccessfulSyncAt: 1 } } }, true), true);
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

test('official scanner reads seven months, deduplicates monthly IDs and records submission status', async t => {
  const oldFetch = global.fetch, oldExporter = global.UmSpecExporter;
  t.after(() => { global.fetch = oldFetch; global.UmSpecExporter = oldExporter; });
  global.UmSpecExporter = { getSesskey: () => 'synthetic-session-key' };
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, redirected: false, json: async () => [{ data: { weeks: [{ days: [{ events: [
      { id: 77, courseid: 123, name: 'Report', eventtype: 'due', modulename: 'assign', timestart: 1794758340, timeduration: 0 },
      { id: 78, courseid: 123, name: 'Tutorial 5', eventtype: 'due', modulename: 'assign', timestart: 1794758340, timeduration: 0,
        action: { name: 'Add submission', actionable: true } },
      { id: 79, courseid: 123, name: 'Quiz 2', eventtype: 'close', modulename: 'quiz', timestart: 1794758340, timeduration: 0 }
    ] }] }] } }] };
  };
  const result = await sync.discoverOfficialEvents(['123'], undefined, '2026-10-24T00:00:00Z');
  assert.equal(result.complete, true);
  assert.equal(result.records.length, 3);
  assert.equal(requests.length, 7);
  const body = JSON.parse(requests[0].options.body);
  assert.equal(body[0].methodname, 'core_calendar_get_calendar_monthly_view');
  assert.equal(body[0].args.month, 9);
  const line = id => result.records.find(record => record.sourceKey.endsWith(':event:' + id)).description;
  assert.match(line(77), /^Spectrum: nothing left to submit$/m);
  assert.match(line(78), /^Spectrum: not submitted yet$/m);
  assert.match(line(79), /^Spectrum: nothing left to attempt$/m);
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
  const oldChrome = global.chrome, oldExporter = global.UmSpecExporter, oldDocument = global.document;
  t.after(() => { global.chrome = oldChrome; global.UmSpecExporter = oldExporter; global.document = oldDocument; });
  const output = { textContent: '' };
  global.document = { getElementById: id => id === 'umspec-sync-status' ? output : null };
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
  assert.equal(output.textContent, '', 'an automatic visit with no enabled sync should not claim that files were synced');
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

test('an explicitly selected local ZIP bypasses saved Drive mode when Spectrum verification is unavailable', async t => {
  const oldChrome = global.chrome, oldExporter = global.UmSpecExporter;
  t.after(() => { global.chrome = oldChrome; global.UmSpecExporter = oldExporter; });
  const commands = [];
  global.UmSpecExporter = { destination: () => 'zip', verifyContext: async () => { throw new Error('Session could not be verified'); } };
  global.chrome = { runtime: { sendMessage: async message => {
    commands.push(message.type); return { ok: true, data: { settings: { mode: 'drive' } } };
  } } };
  assert.equal(await sync.exportOrSync(), false, 'the visible ZIP action must return to the local exporter');
  assert.deepEqual(commands, [], 'choosing local ZIP must neither read nor change an unverified account');
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

test('local date discovery works without Google, preserves Drive scope and shows deadlines beyond seven days', async t => {
  const previous = { chrome: global.chrome, exporter: global.UmSpecExporter, fetch: global.fetch, parser: global.DOMParser };
  t.after(() => { global.chrome = previous.chrome; global.UmSpecExporter = previous.exporter; global.fetch = previous.fetch; global.DOMParser = previous.parser; });
  const messages = [];
  const state = { bindingHash: 'local', settings: { mode: 'zip', courseIds: ['456'] }, events: [], candidates: [] };
  global.UmSpecExporter = { getContext: () => ({ userId: '42', origin: 'https://spectrum.um.edu.my' }),
    selectedCourses: () => [{ id: 123 }], getSesskey: () => 'fixture' };
  global.chrome = { runtime: { sendMessage: async message => {
    messages.push(message);
    if (message.type === 'SAVE_DATE_SCAN') state.dateScan = { ...message, completedAt: Date.now() };
    return { ok: true, data: structuredClone(state) };
  } } };
  global.DOMParser = class { parseFromString() { return { querySelector: () => null, querySelectorAll: () => [] }; } };
  global.fetch = async url => ({ ok: true, url, text: async () => '<html></html>', json: async () => [{ data: { weeks: [{ days: [{ events: [
    { id: 77, courseid: 123, name: 'Report', eventtype: 'due', modulename: 'assign', timestart: 1794758340, timeduration: 0 }
  ] }] }] } }] });
  await sync.analyseDates({ force: true });
  const saved = messages.find(m => m.type === 'SAVE_DATE_SCAN');
  assert.deepEqual(saved.courseIds, ['123']);
  assert.equal(saved.bindingHash, 'local');
  assert.equal(saved.complete, true);
  assert.equal(saved.records.length, 1);
  assert.deepEqual(state.settings.courseIds, ['456']);
  assert.equal(messages.some(m => ['SAVE_SETTINGS', 'BEGIN_CALENDAR_SYNC', 'BEGIN_DRIVE_SYNC'].includes(m.type)), false);
  assert.equal(sync.dateRecords(state, new Date('2026-10-30T00:00:00Z')).length, 1);
  assert.equal(sync.dateRecords({ ...state, events: saved.records }, new Date('2026-10-30T00:00:00Z')).length, 1, 'local and Google copies deduplicate');
});

test('stopping a date scan never commits a partial post-cancellation inventory', async t => {
  const previous = { chrome: global.chrome, exporter: global.UmSpecExporter, fetch: global.fetch };
  t.after(() => { global.chrome = previous.chrome; global.UmSpecExporter = previous.exporter; global.fetch = previous.fetch; });
  const messages = []; let entered;
  const reading = new Promise(resolve => { entered = resolve; });
  global.UmSpecExporter = { getContext: () => ({ userId: '42', origin: 'https://spectrum.um.edu.my' }),
    selectedCourses: () => [{ id: 123 }], getSesskey: () => 'fixture' };
  global.chrome = { runtime: { sendMessage: async message => { messages.push(message); return { ok: true, data: { bindingHash: 'local', settings: {} } }; } } };
  global.fetch = async (_url, options) => { entered(); return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })); };
  const pending = sync.analyseDates({ force: true });
  await reading; sync.stopDateAnalysis(); await pending;
  assert.equal(messages.some(m => m.type === 'SAVE_DATE_SCAN' || m.type === 'BEGIN_CALENDAR_SYNC'), false);
});

test('stopping dates during a pending Drive handoff resolves without cancelling the file writer', async t => {
  const previous = { chrome: global.chrome, exporter: global.UmSpecExporter, fetch: global.fetch, parser: global.DOMParser };
  t.after(() => { global.chrome = previous.chrome; global.UmSpecExporter = previous.exporter; global.fetch = previous.fetch; global.DOMParser = previous.parser; });
  const messages = [];
  let enterDrive, releaseDrive, savedDates, driveFinished = false;
  const driveEntered = new Promise(resolve => { enterDrive = resolve; });
  const driveRelease = new Promise(resolve => { releaseDrive = resolve; });
  const scanSaved = new Promise(resolve => { savedDates = resolve; });
  let state = { configured: true, bindingHash: 'same-student', tabId: 1, account: { features: ['drive', 'calendar'] },
    settings: { mode: 'drive', autoSync: true, calendarEnabled: true, announcementScanning: false, courseIds: ['123'], archiveId: 'Semester' },
    syncTimes: { calendar: { lastAttemptAt: Date.now() } }, events: [], candidates: [],
    job: { id: 'drive-job', tabId: 1, status: 'running', done: false, cursor: 0, total: 1 } };
  global.UmSpecExporter = { getContext: () => ({ userId: '42', origin: 'https://spectrum.um.edu.my' }),
    selectedCourses: () => [{ id: 123 }], getSesskey: () => 'fixture' };
  global.DOMParser = class { parseFromString() { return { querySelector: () => null, querySelectorAll: () => [] }; } };
  global.fetch = async url => ({ ok: true, url, text: async () => '<html></html>',
    json: async () => [{ data: { weeks: [] } }] });
  global.chrome = { runtime: { sendMessage: async message => {
    messages.push(message);
    if (message.type === 'DRIVE_STEP') {
      enterDrive();
      await driveRelease;
      state = { ...state, job: { ...state.job, done: true, status: 'complete', summary: { failed: 0, conflicts: 0 } } };
    }
    if (message.type === 'SAVE_DATE_SCAN') {
      state.dateScan = { ...message, completedAt: Date.now() };
      savedDates();
    }
    return { ok: true, data: structuredClone(state) };
  } } };
  const fileJob = sync.syncNow({ automatic: true }).finally(() => { driveFinished = true; });
  let dateJob;
  try {
    await driveEntered;
    dateJob = sync.analyseDates({ force: true });
    await scanSaved;
    await new Promise(setImmediate);
    sync.stopDateAnalysis();
    const stopped = await Promise.race([dateJob.then(() => true), new Promise(resolve => setImmediate(() => resolve(false)))]);
    assert.equal(stopped, true, 'date cancellation must not wait for the unfinished Drive request');
    assert.equal(driveFinished, false, 'the file writer must remain independently active');
    assert.equal(messages.some(message => message.type === 'PAUSE_SYNC' || message.type === 'BEGIN_CALENDAR_SYNC'), false,
      'stopping before Calendar owns the writer must not pause Drive or start Calendar');
  } finally {
    releaseDrive();
    await fileJob;
    await dateJob;
  }
});

function backgroundScanFixture(t) {
  const saved = { chrome: global.chrome, exporter: global.UmSpecExporter, fetch: global.fetch, document: global.document };
  t.after(() => { global.chrome = saved.chrome; global.UmSpecExporter = saved.exporter; global.fetch = saved.fetch; global.document = saved.document; });
  global.document = undefined;
  const events = [];
  // First-ever Drive sync: Drive is connected, no successful sync yet, announcement checks on by default.
  const state = { configured: true, bindingHash: 'verified', account: { email: 'student@example.test', features: ['drive'] },
    settings: { mode: 'drive', archiveId: 'Semester 1', courseIds: ['123'], videoPolicy: 'links', autoSync: true, calendarEnabled: false, announcementScanning: true },
    syncTimes: {}, candidates: [], events: [] };
  global.chrome = { runtime: { sendMessage: async message => { events.push(message.type); return { ok: true, data: structuredClone(state) }; } } };
  global.UmSpecExporter = { getContext: () => ({ userId: '42', origin: 'https://spectrum.um.edu.my' }),
    selectedCourses: () => [{ id: 123 }], selectedUrls: () => null, videoPolicy: () => 'links',
    discoverCourses: async () => [{ id: 123, fullName: 'Networks' }], resolveCourseMaterials: async () => Object.assign([], { skipped: 0 }) };
  let scanStarted, crawling = false;
  const started = new Promise(resolve => { scanStarted = resolve; });
  // A slow Spectrum page: the background crawl sits on its first request until it is aborted.
  global.fetch = (url, { signal }) => {
    events.push('FETCH');
    if (crawling) return Promise.reject(new Error('offline'));
    crawling = true;
    scanStarted();
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  };
  return { events, started };
}

test('a sync the student asks for is not absorbed by a running background check', async t => {
  const { events, started } = backgroundScanFixture(t);
  const background = sync.syncNow({ automatic: true }).catch(() => {});
  await started;
  const outcome = await Promise.race([sync.syncNow().then(() => 'finished'),
    new Promise(resolve => setTimeout(resolve, 200, 'still waiting on the background scan'))]);
  assert.equal(outcome, 'finished');
  assert.ok(events.includes('BEGIN_DRIVE_SYNC'), 'the requested Drive sync must actually start');
  await background;
});

test('a background scan records its attempt before crawling so leaving the page cannot restart it', async t => {
  const { events, started } = backgroundScanFixture(t);
  const background = sync.syncNow({ automatic: true }).catch(() => {});
  await started;
  const firstFetch = events.indexOf('FETCH');
  assert.ok(events.slice(0, firstFetch).includes('MARK_SYNC_ATTEMPT'), 'the 15-minute cooldown must start before the first Spectrum request');
  await Promise.race([sync.syncNow(), new Promise(resolve => setTimeout(resolve, 200))]);
  await Promise.race([background, new Promise(resolve => setTimeout(resolve, 200))]);
});

test('a finished Drive sync names the items that failed instead of only counting them', async t => {
  const saved = { chrome: global.chrome, exporter: global.UmSpecExporter, document: global.document };
  t.after(() => { global.chrome = saved.chrome; global.UmSpecExporter = saved.exporter; global.document = saved.document; });
  const output = { textContent: '' };
  global.document = { getElementById: id => id === 'umspec-sync-status' ? output : null };
  const base = { configured: true, bindingHash: 'verified', account: { email: 'student@example.test', features: ['drive'] },
    settings: { mode: 'drive', archiveId: 'Semester 1', courseIds: ['123'], videoPolicy: 'links', autoSync: true, calendarEnabled: false, announcementScanning: false },
    syncTimes: {}, candidates: [], events: [] };
  global.chrome = { runtime: { sendMessage: async message => ({ ok: true, data: message.type === 'BEGIN_DRIVE_SYNC' ? { ...base, job: { id: 'job', done: true, status: 'complete',
    summary: { failed: 1, conflicts: 0 }, attention: [{ name: 'Notes.pdf', action: 'failed', detail: 'SPECTRUM_HTTP_404' }] } } : base }) } };
  global.UmSpecExporter = { getContext: () => ({ userId: '42', origin: 'https://spectrum.um.edu.my' }),
    selectedCourses: () => [{ id: 123 }], selectedUrls: () => null, videoPolicy: () => 'links',
    discoverCourses: async () => [{ id: 123, fullName: 'Networks' }], resolveCourseMaterials: async () => Object.assign([], { skipped: 0 }) };
  await sync.syncNow();
  assert.match(output.textContent, /1 failed/);
  assert.match(output.textContent, /Affected: Notes\.pdf \(SPECTRUM_HTTP_404\)\./);
});

test('an expired session on the single sign-on page reads as sign-in required, not a changed announcement layout', async t => {
  const previous = { fetch: global.fetch, parser: global.DOMParser };
  t.after(() => { global.fetch = previous.fetch; global.DOMParser = previous.parser; });
  const candidate = { sourceUrl: 'https://spectrum.um.edu.my/mod/forum/discuss.php?d=5', courseId: '1', forumId: '2', postId: '3' };
  for (const [landed, page] of [
    ['https://spectrum.um.edu.my/login/index.php', { body: { id: 'page-login-index' }, selector: null }],
    ['https://spectrum.um.edu.my/mod/forum/discuss.php?d=5', { body: { id: 'page-login-index' }, selector: null }],
    ['https://login.microsoftonline.com/tenant/oauth2/authorize', { body: { id: 'other' }, selector: null }]
  ]) {
    global.fetch = async () => Object.defineProperty(new Response('<html></html>', { status: 200 }), 'url', { value: landed });
    global.DOMParser = class { parseFromString() { return { body: page.body, querySelector: query => page.selector && query.includes(page.selector) ? {} : null, querySelectorAll: () => [] }; } };
    await assert.rejects(sync.refreshPost(candidate), error => error.code === 'LOGIN_REQUIRED');
  }
});

test('announcement forums are found by the word anywhere in their name', () => {
  assert.equal(sync.announcementForum('Announcement from Dr. Tarak Nandy', '/mod/forum/view.php?id=7'), 'https://spectrum.um.edu.my/mod/forum/view.php?id=7');
  assert.equal(sync.announcementForum('Makluman OCC-3', '/mod/forum/view.php?id=8'), 'https://spectrum.um.edu.my/mod/forum/view.php?id=8');
  assert.equal(sync.announcementForum('Company Website', '/mod/forum/view.php?id=9'), null);
});

test('a deadline for another OCC is kept in Calendar but labelled as not the student\'s', async () => {
  require('../shared/planner-core.js');
  const event = (id, name, url, action) => ({ id, courseid: 25559, name, eventtype: 'due', modulename: 'assign', timestart: 1794758340, timeduration: 0,
    url: 'https://spectrum.um.edu.my/mod/assign/view.php?id=' + url, ...(action ? { action: { name: 'Add submission' } } : {}) });
  const payload = [{ data: { weeks: [{ days: [{ events: [
    event(1, 'Assignment. Occ 1, Occ 1M is due', 1128831, true),
    event(2, 'Online class quiz is due', 1128814, true),
    event(3, 'Pop Quiz. DC. is due', 1141243, true),
    event(4, 'Tutorial 3 (Occ3) is due', 1150000, false)
  ] }] }] } }];
  const occ = { mine: id => id === '25559' ? '3' : null, ai: (id, cmid) => cmid === '1128814' ? ['1', '1M'] : null };
  const records = await sync.adaptCalendarResponse(payload, ['25559'], occ);
  const line = id => records.find(r => r.sourceKey.endsWith(':event:' + id)).description;
  assert.match(line(1), /^Spectrum: for OCC 1, 1M, not your OCC \(3\)$/m, 'the title names other OCCs');
  assert.match(line(2), /^Spectrum: for OCC 1, 1M, not your OCC \(3\)$/m, 'the AI placed it with OCC 1, 1M');
  assert.match(line(3), /^Spectrum: not submitted yet$/m, 'no OCC label: for everyone');
  assert.match(line(4), /^Spectrum: nothing left to submit$/m, 'the student\'s own OCC');
  const unknown = await sync.adaptCalendarResponse(payload, ['25559'], { mine: () => null, ai: () => null });
  assert.match(unknown.find(r => r.sourceKey.endsWith(':event:1')).description, /not submitted yet/, 'with no known OCC nothing is hidden');
});
