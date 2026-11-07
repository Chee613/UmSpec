const test = require('node:test');
const assert = require('node:assert/strict');
require('../shared/sync-core.js');
require('../shared/calendar-core.js');
require('../shared/announcement-core.js');
require('../background/calendar.js');
require('../background/drive.js');
const google = require('../background/google.js');
const worker = require('../background/worker.js');
const content = { id: 'integration', url: 'https://spectrum.um.edu.my/my/', tab: { id: 1 } };
const popup = { id: 'integration', url: 'chrome-extension://integration/popup/popup.html' };
const record = {
  sourceKey: 'moodle:course:123:event:77', sourceType: 'moodle',
  sourceUrl: 'https://spectrum.um.edu.my/calendar/view.php?view=event&id=77',
  courseId: '123', title: 'Assignment 1', description: 'Submit report',
  precision: 'date', start: '2026-11-15', end: '2026-11-16', timeZone: 'Asia/Kuala_Lumpur',
  meetingUrl: null, status: 'confirmed', sourceRevision: 'rev1', reminderMinutes: [1440, 60]
};
let sequence = 0;
function environment(t, { loseCalendarReply = false, hideCalendars = false, sourceBytes = 'source bytes', visibilityFailures = 0 } = {}) {
  let stored = {}, token = 'integration-token-' + ++sequence;
  const users = new Map([[token, { sub: 'sub-one', email: 'one@example.test' }]]);
  const calendars = new Map(), events = new Map(), eventPosts = [], calendarPosts = [], files = new Map();
  const calendarList = new Map(), visibilityPatches = [];
  const uploadSessions = new Map();
  let fileNumber = 0;
  let snapshotAtCalendarPost = null;
  const closedTabs = new Set();
  const previousChrome = globalThis.chrome, previousFetch = globalThis.fetch;
  t.after(() => { globalThis.chrome = previousChrome; globalThis.fetch = previousFetch; });
  globalThis.chrome = {
    runtime: { id: 'integration', getURL: path => 'chrome-extension://integration/' + path,
      getManifest: () => ({ oauth2: { client_id: 'integration.apps.googleusercontent.com' } }) },
    storage: { local: {
      get: async key => ({ [key]: structuredClone(stored[key]) }),
      set: async value => { Object.assign(stored, structuredClone(value)); }
    } },
    tabs: { sendMessage: async tabId => {
      if (closedTabs.has(tabId)) throw Object.assign(new Error('Tab was closed'), { code: 'TAB_CLOSED' });
      return { userId: '42', origin: 'https://spectrum.um.edu.my' };
    } },
    identity: { getAuthToken: async () => ({ token }), removeCachedAuthToken: async () => {}, clearAllCachedAuthTokens: async () => {} }
  };
  globalThis.fetch = async (value, options = {}) => {
    const url = new URL(value), method = options.method || 'GET';
    const reply = (status, body = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (url.origin === 'https://spectrum.um.edu.my') {
      assert.equal(options.credentials, 'include');
      const response = new Response(sourceBytes, { headers: { 'Content-Type': 'application/pdf' } });
      Object.defineProperty(response, 'url', { value: url.href });
      return response;
    }
    if (url.pathname === '/oauth2/v3/userinfo') return reply(200, users.get(new Headers(options.headers).get('Authorization').slice(7)));
    if (url.pathname === '/drive/v3/files/generateIds') return reply(200, { ids: ['file-' + ++fileNumber] });
    if (url.pathname === '/drive/v3/files') {
      if (method === 'GET') return reply(200, { files: [...files.values()] });
      const body = JSON.parse(options.body); files.set(body.id, body); return reply(200, body);
    }
    if (url.pathname.startsWith('/drive/v3/files/')) {
      const id = url.pathname.split('/').at(-1), file = files.get(id);
      if (!file) return reply(404);
      if (method === 'PATCH') {
        const body = JSON.parse(options.body);
        files.set(id, { ...file, ...body, appProperties: { ...file.appProperties, ...body.appProperties } });
      }
      return reply(200, files.get(id));
    }
    if (url.pathname.startsWith('/upload/drive/v3/files')) {
      if (method === 'PATCH') {
        const id = url.pathname.split('/').at(-1);
        uploadSessions.set(id, { fileId: id, bytes: [], offset: 0 });
        return new Response('{}', { status: 200, headers: { Location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=' + id } });
      }
      assert.equal(method, 'PUT');
      const session = uploadSessions.get(url.searchParams.get('upload_id'));
      if (!session) return reply(404);
      const range = new Headers(options.headers).get('Content-Range');
      if (range.startsWith('bytes */')) return session.complete ? reply(200, files.get(session.fileId))
        : new Response(null, { status: 308, headers: session.offset ? { Range: 'bytes=0-' + (session.offset - 1) } : {} });
      const sent = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
      assert.equal(Number(sent[1]), session.offset);
      session.bytes.push(new Uint8Array(options.body)); session.offset = Number(sent[2]) + 1;
      if (session.offset < Number(sent[3])) return new Response(null, { status: 308, headers: { Range: 'bytes=0-' + (session.offset - 1) } });
      const bytes = Buffer.concat(session.bytes), crypto = require('node:crypto');
      const file = { ...files.get(session.fileId), md5Checksum: crypto.createHash('md5').update(bytes).digest('hex'),
        sha256Checksum: crypto.createHash('sha256').update(bytes).digest('hex') };
      files.set(session.fileId, file); session.complete = true;
      return reply(200, file);
    }
    if (url.pathname === '/calendar/v3/users/me/calendarList') return reply(200, { items: hideCalendars ? [] : [...calendarList.values()]
      .filter(entry => !entry.hidden || url.searchParams.get('showHidden') === 'true') });
    if (url.pathname.startsWith('/calendar/v3/users/me/calendarList/')) {
      assert.equal(method, 'PATCH');
      const entry = calendarList.get(decodeURIComponent(url.pathname.split('/').at(-1)));
      if (!entry) return reply(404);
      const patch = JSON.parse(options.body); visibilityPatches.push(patch);
      if (visibilityFailures > 0) { visibilityFailures--; return reply(403); }
      Object.assign(entry, patch);
      return reply(200, entry);
    }
    if (url.pathname === '/calendar/v3/calendars' && method === 'POST') {
      const active = stored.umspecState.bindings[stored.umspecState.contexts['1'].bindingHash];
      snapshotAtCalendarPost = structuredClone(stored.umspecState);
      assert.equal(active.calendarCreateIntent.state, 'uncertain', 'uncertain intent must be durable before issuing POST');
      const calendar = { ...JSON.parse(options.body), id: 'calendar-' + calendars.size, etag: 'cal-etag' };
      calendars.set(calendar.id, calendar); calendarPosts.push(calendar);
      calendarList.set(calendar.id, { ...calendar, selected: false, hidden: true });
      if (loseCalendarReply) { loseCalendarReply = false; throw new Error('Lost calendar creation reply'); }
      return reply(200, calendar);
    }
    const calendar = url.pathname.match(/^\/calendar\/v3\/calendars\/([^/]+)$/);
    if (calendar) return calendars.has(calendar[1]) ? reply(200, calendars.get(calendar[1])) : reply(404);
    const event = url.pathname.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/);
    assert.ok(event, value);
    if (method === 'GET') return events.has(event[2]) ? reply(200, events.get(event[2])) : reply(404);
    if (method === 'PATCH') {
      if (new Headers(options.headers).get('If-Match') !== events.get(event[2])?.etag) return reply(412);
      const updated = { ...events.get(event[2]), ...JSON.parse(options.body), etag: 'event-edited' };
      events.set(event[2], updated); return reply(200, updated);
    }
    assert.equal(method, 'POST');
    const body = { ...JSON.parse(options.body), etag: 'event-etag' };
    events.set(body.id, body); eventPosts.push(body);
    return reply(200, body);
  };
  return {
    state: () => stored.umspecState, eventPosts, calendarPosts, calendarList, visibilityPatches, files, closeTab: id => closedTabs.add(id),
    snapshotAtCalendarPost: () => snapshotAtCalendarPost,
    restore: snapshot => { stored = { umspecState: structuredClone(snapshot) }; },
    showCalendars: () => { hideCalendars = false; },
    switchGoogle(sub = 'sub-two') { token = 'integration-token-' + ++sequence; users.set(token, { sub, email: sub === 'sub-one' ? 'one@example.test' : 'two@example.test' }); }
  };
}
async function send(message, sender = content) { return worker.handleMessage(message, sender); }
async function connectCalendar() {
  assert.equal((await send({ type: 'SET_CONTEXT', userId: '42' })).ok, true);
  assert.equal((await send({ type: 'SAVE_SETTINGS', settings: { courseIds: ['123'], announcementScanning: true } })).ok, true);
  const connected = await send({ type: 'CONNECT_GOOGLE', feature: 'calendar' }, popup);
  assert.equal(connected.ok, true, JSON.stringify(connected));
  assert.equal((await send({ type: 'SAVE_SETTINGS', settings: { announcementScanning: true } })).ok, true);
  return connected.data;
}
async function beginCalendar() {
  const begun = await send({ type: 'BEGIN_CALENDAR_SYNC', records: [record], complete: true });
  assert.equal(begun.ok, true, JSON.stringify(begun));
  return begun.data.calendarJob.id;
}

test('calendar integration persists creation intent between steps before remote writes', async t => {
  const env = environment(t);
  await connectCalendar();
  const jobId = await beginCalendar();
  await send({ type: 'CALENDAR_STEP', jobId });
  assert.equal(env.calendarPosts.length, 0);
  await send({ type: 'CALENDAR_STEP', jobId });
  assert.equal(env.calendarPosts.length, 1);
  await send({ type: 'CALENDAR_STEP', jobId });
  const finished = await send({ type: 'CALENDAR_STEP', jobId });
  assert.equal(finished.data.calendarJob.done, true);
  assert.equal(env.eventPosts.length, 1);
  assert.ok(finished.data.syncTimes.calendar.lastSuccessfulSyncAt);
  assert.equal(env.calendarList.get(finished.data.calendarId).selected, true);
  assert.equal(env.calendarList.get(finished.data.calendarId).hidden, false);
  assert.equal(env.state().bindings[finished.data.bindingHash].calendarVisibilityId, finished.data.calendarId);
});

test('Calendar visibility refusal syncs events without pausing, reports the status, then retries on the next sync without overriding later user hiding', async t => {
  const env = environment(t, { visibilityFailures: 1 });
  const connected = await connectCalendar();
  const jobId = await beginCalendar();
  await send({ type: 'CALENDAR_STEP', jobId });
  const refused = await send({ type: 'CALENDAR_STEP', jobId });
  assert.equal(refused.data.calendarJob.error, undefined);
  assert.equal(refused.data.calendarJob.status, 'running');
  assert.equal(refused.data.calendarId, 'calendar-0');
  assert.match(refused.data.calendarVisibilityNotice, /HTTP 403/);
  assert.equal(env.state().bindings[connected.bindingHash].calendarId, 'calendar-0');
  assert.equal(env.state().bindings[connected.bindingHash].calendarVisibilityId, undefined);
  assert.equal(env.state().bindings[connected.bindingHash].calendarVisibilityIssue.status, 403);
  assert.equal(env.calendarPosts.length, 1);
  assert.equal(env.calendarList.get('calendar-0').selected, false);
  await send({ type: 'CALENDAR_STEP', jobId });
  const synced = await send({ type: 'CALENDAR_STEP', jobId });
  assert.equal(synced.data.calendarJob.done, true);
  assert.equal(synced.data.calendarJob.status, 'complete');
  assert.ok(synced.data.syncTimes.calendar.lastSuccessfulSyncAt);
  assert.equal(env.eventPosts.length, 1);
  assert.equal(env.visibilityPatches.length, 1, 'a refusal is not retried within the same job');
  assert.match(synced.data.calendarVisibilityNotice, /My calendars/);
  const retryJob = await beginCalendar();
  await send({ type: 'CALENDAR_STEP', jobId: retryJob });
  const retried = await send({ type: 'CALENDAR_STEP', jobId: retryJob });
  assert.equal(retried.data.calendarJob.done, true);
  assert.equal(retried.data.calendarVisibilityNotice, null);
  assert.equal(env.state().bindings[connected.bindingHash].calendarVisibilityId, 'calendar-0');
  assert.equal(env.state().bindings[connected.bindingHash].calendarVisibilityIssue, undefined);
  assert.equal(env.calendarList.get('calendar-0').selected, true);
  assert.equal(env.calendarList.get('calendar-0').hidden, false);
  assert.deepEqual(env.visibilityPatches, [{ selected: true, hidden: false }, { selected: true, hidden: false }]);
  Object.assign(env.calendarList.get('calendar-0'), { selected: false, hidden: true });
  const repeatedJob = await beginCalendar();
  await send({ type: 'CALENDAR_STEP', jobId: repeatedJob });
  await send({ type: 'CALENDAR_STEP', jobId: repeatedJob });
  assert.equal(env.calendarList.get('calendar-0').selected, false);
  assert.equal(env.calendarList.get('calendar-0').hidden, true);
  assert.equal(env.visibilityPatches.length, 2);
  assert.equal(env.calendarPosts.length, 1);
  assert.equal(env.eventPosts.length, 1);
});

test('a persistently refused calendar lets an empty scan finish instead of looping, and a job paused by the old error resumes', async t => {
  const env = environment(t, { visibilityFailures: 100 }), connected = await connectCalendar();
  const initial = await beginCalendar();
  for (let step = 0; step < 4; step++) await send({ type: 'CALENDAR_STEP', jobId: initial });
  const empty = await send({ type: 'BEGIN_CALENDAR_SYNC', records: [], complete: true });
  const patches = env.visibilityPatches.length;
  let result;
  for (let step = 0; step < 2; step++) result = await send({ type: 'CALENDAR_STEP', jobId: empty.data.calendarJob.id });
  assert.equal(result.data.calendarJob.done, true);
  assert.equal(env.visibilityPatches.length, patches + 1);
  assert.match(result.data.calendarVisibilityNotice, /HTTP 403/);
  const stale = structuredClone(env.state());
  const next = { ...record, sourceKey: 'moodle:course:123:event:stale' };
  delete stale.bindings[connected.bindingHash].calendarVisibilityIssue;
  stale.calendarJob = { ...stale.calendarJob, id: 'stale-job', records: [next], cursor: 0, results: [], done: false, status: 'paused',
    error: { code: 'CALENDAR_VISIBILITY', message: 'Could not show the UM Spec calendar.' } };
  env.restore(stale);
  const resumed = await send({ type: 'BEGIN_CALENDAR_SYNC', records: [], complete: true });
  assert.equal(resumed.data.calendarJob.id, 'stale-job');
  assert.equal(resumed.data.calendarJob.error, null);
  let finished;
  for (let step = 0; step < 3 && !finished?.data.calendarJob.done; step++) finished = await send({ type: 'CALENDAR_STEP', jobId: 'stale-job' });
  assert.equal(finished.data.calendarJob.done, true);
  assert.equal(finished.data.calendarJob.error, null);
  assert.equal(env.eventPosts.length, 2);
});

test('an empty current scan activates a legacy calendar with saved events without creating empty calendars or overriding later hiding', async t => {
  const env = environment(t), connected = await connectCalendar();
  const empty = await send({ type: 'BEGIN_CALENDAR_SYNC', records: [], complete: true });
  await send({ type: 'CALENDAR_STEP', jobId: empty.data.calendarJob.id });
  assert.equal(env.calendarPosts.length, 0, 'an empty scan must not create a new calendar');
  assert.equal(env.visibilityPatches.length, 0);
  const initialJob = await beginCalendar();
  for (let step = 0; step < 4; step++) await send({ type: 'CALENDAR_STEP', jobId: initialJob });
  const legacy = structuredClone(env.state());
  const binding = legacy.bindings[connected.bindingHash];
  delete binding.calendarVisibilityId;
  assert.equal(Object.keys(binding.events).length, 1);
  env.restore(legacy);
  Object.assign(env.calendarList.get(binding.calendarId), { selected: false, hidden: true });
  const patchCount = env.visibilityPatches.length;
  const next = await send({ type: 'BEGIN_CALENDAR_SYNC', records: [], complete: true });
  let result;
  for (let step = 0; step < 2; step++) result = await send({ type: 'CALENDAR_STEP', jobId: next.data.calendarJob.id });
  assert.equal(result.data.calendarJob.done, true);
  assert.equal(env.calendarList.get(binding.calendarId).selected, true);
  assert.equal(env.calendarList.get(binding.calendarId).hidden, false);
  assert.equal(env.state().bindings[connected.bindingHash].calendarVisibilityId, binding.calendarId);
  assert.equal(env.visibilityPatches.length, patchCount + 1);
  Object.assign(env.calendarList.get(binding.calendarId), { selected: false, hidden: true });
  const later = await send({ type: 'BEGIN_CALENDAR_SYNC', records: [], complete: true });
  await send({ type: 'CALENDAR_STEP', jobId: later.data.calendarJob.id });
  assert.equal(env.calendarList.get(binding.calendarId).selected, false);
  assert.equal(env.calendarList.get(binding.calendarId).hidden, true);
  assert.equal(env.visibilityPatches.length, patchCount + 1);
  assert.equal(env.calendarPosts.length, 1);
  assert.equal(env.eventPosts.length, 1);
});

test('disabling calendar stops an already queued job before its next event write', async t => {
  const env = environment(t);
  await connectCalendar();
  const jobId = await beginCalendar();
  await send({ type: 'CALENDAR_STEP', jobId });
  await send({ type: 'CALENDAR_STEP', jobId });
  await send({ type: 'SAVE_SETTINGS', settings: { calendarEnabled: false } });
  await send({ type: 'CALENDAR_STEP', jobId });
  assert.equal(env.eventPosts.length, 0, 'disabled Calendar must not write its queued event');
  assert.equal(env.state().calendarJob.cursor, 0);
});

test('switching Google accounts does not migrate managed IDs or previous account events', async t => {
  const env = environment(t);
  await connectCalendar();
  const jobId = await beginCalendar();
  for (let step = 0; step < 4; step++) await send({ type: 'CALENDAR_STEP', jobId });
  const originalHash = env.state().contexts['1'].bindingHash;
  await send({ type: 'SAVE_SETTINGS', settings: { autoSync: false } });
  env.switchGoogle();
  const connected = await send({ type: 'CONNECT_GOOGLE', feature: 'calendar' }, popup);
  assert.equal(connected.ok, true);
  assert.equal(connected.data.account.email, 'two@example.test');
  assert.equal(connected.data.calendarId, null, 'another Google account must discover its own calendar');
  assert.deepEqual(connected.data.events, []);
  assert.equal(connected.data.calendarJob, null);
  assert.equal(connected.data.settings.autoSync, true);
  assert.deepEqual(connected.data.settings.courseIds, ['123']);
  assert.equal(env.state().bindings[originalHash].calendarId, 'calendar-0');
  assert.equal(env.state().bindings[originalHash].settings.autoSync, false);
});

test('review rejects refreshed content with a different authoritative forum identity', async t => {
  const env = environment(t);
  await connectCalendar();
  const post = { courseId: '123', forumId: '5', postId: '9', title: 'Deadline', text: 'Submit on 2036-11-15.',
    sourceUrl: 'https://spectrum.um.edu.my/mod/forum/discuss.php?d=8#p9', publishedAt: '2026-10-24T12:00:00+08:00', links: [] };
  const queued = await send({ type: 'QUEUE_ANNOUNCEMENTS', posts: [post], complete: true });
  assert.equal(queued.ok, true);
  const candidate = queued.data.candidates[0];
  const reviewed = await send({ type: 'REVIEW_ANNOUNCEMENT', candidateId: candidate.candidateId,
    refreshedPost: { ...post, forumId: '6' }, editedFields: { reviewedRevision: candidate.sourceRevision, start: '2036-11-15' } });
  assert.equal(reviewed.ok, false, 'a content hash is not a substitute for matching source identity');
  assert.equal(reviewed.error.code, 'STALE_REVIEW');
  assert.equal(env.state().bindings[queued.data.bindingHash].candidates[candidate.candidateId].state, 'pending');
});

test('userinfo 401 evicts the cached token and retries verification once', async t => {
  environment(t);
  let tokenReads = 0, removals = 0;
  chrome.identity.getAuthToken = async () => ({ token: tokenReads++ ? 'fresh-verification-token' : 'expired-verification-token' });
  chrome.identity.removeCachedAuthToken = async () => { removals++; };
  globalThis.fetch = async (value, options) => {
    assert.equal(new URL(value).pathname, '/oauth2/v3/userinfo');
    return new Headers(options.headers).get('Authorization') === 'Bearer expired-verification-token'
      ? new Response('{}', { status: 401 })
      : new Response(JSON.stringify({ sub: 'sub-one', email: 'one@example.test' }), { status: 200 });
  };
  assert.equal((await google.verifyAccount('sub-one', 'calendar')).sub, 'sub-one');
  assert.equal(removals, 1);
  assert.equal(tokenReads, 2);
});

test('status exposes resumable announcement cursor and the active tab', async t => {
  environment(t);
  await connectCalendar();
  await send({ type: 'SAVE_SETTINGS', settings: { announcementScanning: true } });
  const result = await send({ type: 'QUEUE_ANNOUNCEMENTS', posts: [], cursor: 'next-page', complete: false });
  assert.equal(result.data.announcementCursor, 'next-page');
  assert.equal(result.data.tabId, 1);
});

test('Drive worker retains course names and persists a returned cloned binding root', async t => {
  const env = environment(t);
  await connectCalendar();
  assert.equal((await send({ type: 'CONNECT_GOOGLE', feature: 'drive' }, popup)).ok, true);
  await send({ type: 'SAVE_SETTINGS', settings: { archiveId: '2026 Semester 1' } });
  const start = await send({ type: 'BEGIN_DRIVE_SYNC', materials: [{
    sourceKey: 'a'.repeat(64), sourceUrl: 'https://spectrum.um.edu.my/mod/resource/view.php?id=4',
    courseId: '123', moduleId: '4', name: 'Resource', category: 'Notes', kind: 'link',
    courseName: 'Computing / Fundamentals', courseFolder: 'WIX1001 / Computing'
  }] });
  assert.equal(start.ok, true, JSON.stringify(start));
  const jobId = start.data.job.id;
  for (let step = 0; step < 3; step++) await send({ type: 'DRIVE_STEP', jobId });
  const status = await send({ type: 'GET_STATUS' });
  assert.equal(status.data.driveRootId, 'file-1');
  assert.equal(status.data.job.tabId, 1);
  assert.equal(env.state().activeJob.materials[0].courseName, 'Computing _ Fundamentals');
  assert.equal(env.state().activeJob.materials[0].courseFolder, 'WIX1001 _ Computing');
});

test('pending calendar writer result does not advance the official event cursor', async t => {
  const env = environment(t);
  await connectCalendar();
  const jobId = await beginCalendar();
  await send({ type: 'CALENDAR_STEP', jobId });
  await send({ type: 'CALENDAR_STEP', jobId });
  const previous = globalThis.UmSpecCalendar;
  t.after(() => { globalThis.UmSpecCalendar = previous; });
  globalThis.UmSpecCalendar = { ...previous, syncEvent: async () => ({ action: 'pending', eventId: 'pending-id' }) };
  await send({ type: 'CALENDAR_STEP', jobId });
  assert.equal(env.state().calendarJob.cursor, 0);
  assert.deepEqual(Object.keys(env.state().bindings[env.state().calendarJob.bindingHash].events), []);
});

test('pending calendar writer result leaves an announcement unaccepted for retry', async t => {
  environment(t);
  await connectCalendar();
  const jobId = await beginCalendar();
  await send({ type: 'CALENDAR_STEP', jobId });
  await send({ type: 'CALENDAR_STEP', jobId });
  const post = { courseId: '123', forumId: '5', postId: '9', title: 'Deadline', text: 'Submit on 2036-11-15.',
    sourceUrl: 'https://spectrum.um.edu.my/mod/forum/discuss.php?d=8#p9', publishedAt: '2026-10-24T12:00:00+08:00', links: [] };
  const queued = await send({ type: 'QUEUE_ANNOUNCEMENTS', posts: [post], complete: true });
  const candidate = queued.data.candidates[0];
  const previous = globalThis.UmSpecCalendar;
  t.after(() => { globalThis.UmSpecCalendar = previous; });
  globalThis.UmSpecCalendar = { ...previous, syncEvent: async () => ({ action: 'pending', eventId: 'pending-id' }) };
  const reviewed = await send({ type: 'REVIEW_ANNOUNCEMENT', candidateId: candidate.candidateId, refreshedPost: post,
    editedFields: { reviewedRevision: candidate.sourceRevision, start: '2036-11-15' } });
  assert.equal(reviewed.data.retryReview, true);
  assert.equal(reviewed.data.candidates[0].state, 'pending');
});

test('disconnect status does not present the retained binding as a connected account', async t => {
  const env = environment(t);
  const connected = await connectCalendar();
  const jobId = await beginCalendar();
  await send({ type: 'CALENDAR_STEP', jobId });
  await send({ type: 'CALENDAR_STEP', jobId });
  const disconnected = await send({ type: 'DISCONNECT_GOOGLE' }, popup);
  assert.equal(disconnected.ok, true);
  assert.equal(disconnected.data.account, null);
  assert.equal(disconnected.data.settings.calendarEnabled, false);
  assert.equal(env.state().bindings[connected.bindingHash].calendarId, 'calendar-0');
});

test('duplicate reminders are rejected without changing the saved settings', async t => {
  environment(t);
  await connectCalendar();
  const result = await send({ type: 'SAVE_SETTINGS', settings: { reminderMinutes: [60, 60] } });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'INVALID_SETTINGS');
  assert.deepEqual((await send({ type: 'GET_STATUS' })).data.settings.reminderMinutes, [1440, 60]);
});

const announcementPost = () => ({ courseId: '123', forumId: '5', postId: '9', title: 'Deadline', text: 'Submit on 2036-11-15.',
  sourceUrl: 'https://spectrum.um.edu.my/mod/forum/discuss.php?d=8#p9', publishedAt: '2026-10-24T12:00:00+08:00', links: [] });
async function queuedReview() {
  const post = announcementPost();
  const result = await send({ type: 'QUEUE_ANNOUNCEMENTS', posts: [post], complete: true });
  assert.equal(result.ok, true);
  const candidate = result.data.candidates[0];
  return { type: 'REVIEW_ANNOUNCEMENT', candidateId: candidate.candidateId, refreshedPost: post,
    editedFields: { reviewedRevision: candidate.sourceRevision, start: '2036-11-15' } };
}
test('past announcement dates are not queued and queued dates leave Review once they pass', async t => {
  const env = environment(t);
  await connectCalendar();
  const past = { ...announcementPost(), postId: '10', sourceUrl: 'https://spectrum.um.edu.my/mod/forum/discuss.php?d=9#p10', text: 'Submit on 2020-01-15.' };
  const queued = await send({ type: 'QUEUE_ANNOUNCEMENTS', posts: [past, announcementPost()], complete: true });
  assert.deepEqual(queued.data.candidates.map(candidate => candidate.suggestedStart), ['2036-11-15']);
  const candidates = () => Object.values(env.state().bindings).flatMap(binding => Object.values(binding.candidates));
  candidates()[0].suggestedStart = '2020-02-01';
  const later = await send({ type: 'QUEUE_ANNOUNCEMENTS', posts: [], complete: true });
  assert.equal(later.data.candidates.length, 0);
  assert.equal(candidates()[0].state, 'expired');
});
test('ignored review candidates cannot be accepted through a stale command', async t => {
  const env = environment(t);
  await connectCalendar();
  const command = await queuedReview();
  await send({ type: 'IGNORE_ANNOUNCEMENT', candidateId: command.candidateId });
  const result = await send(command);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'INVALID_REVIEW');
  assert.equal(env.calendarPosts.length, 0);
});
test('already accepted review candidates cannot be rewritten without a changed source', async t => {
  const env = environment(t);
  await connectCalendar();
  const jobId = await beginCalendar();
  await send({ type: 'CALENDAR_STEP', jobId });
  await send({ type: 'CALENDAR_STEP', jobId });
  const command = await queuedReview();
  assert.equal((await send(command)).ok, true);
  const result = await send(command);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'INVALID_REVIEW');
  assert.equal(env.eventPosts.length, 1);
});

const secondContent = { ...content, tab: { id: 2 } };
async function otherTab() {
  assert.equal((await send({ type: 'SET_CONTEXT', userId: '42' }, secondContent)).ok, true);
}
test('another Spectrum tab joins the live calendar job and cannot advance its owner', async t => {
  const env = environment(t);
  await connectCalendar();
  const jobId = await beginCalendar();
  await otherTab();
  const joined = await send({ type: 'BEGIN_CALENDAR_SYNC', records: [], complete: false, retry: true }, secondContent);
  assert.equal(joined.data.calendarJob.id, jobId);
  assert.equal(joined.data.calendarJob.tabId, 1);
  await send({ type: 'CALENDAR_STEP', jobId }, secondContent);
  assert.equal(env.state().bindings[joined.data.bindingHash].calendarCreateIntent, undefined);
  assert.equal(env.state().calendarJob.records.length, 1);
});
test('calendar authorization failures persist pause and another authenticated tab resumes the checkpoint', async t => {
  const env = environment(t);
  await connectCalendar();
  const jobId = await beginCalendar();
  env.closeTab(1);
  await send({ type: 'CALENDAR_STEP', jobId });
  assert.equal(env.state().calendarJob.status, 'paused');
  assert.equal(env.state().calendarJob.error.code, 'TAB_CLOSED');
  await otherTab();
  const resumed = await send({ type: 'BEGIN_CALENDAR_SYNC', records: [], complete: true }, secondContent);
  assert.equal(resumed.data.calendarJob.id, jobId);
  assert.equal(resumed.data.calendarJob.tabId, 2);
  assert.equal(resumed.data.calendarJob.status, 'running');
  assert.equal(resumed.data.calendarJob.error, null);
  assert.equal(resumed.data.calendarJob.cursor, 0);
});
test('a closed calendar owner can be adopted without replacing the unfinished source records', async t => {
  const env = environment(t);
  await connectCalendar();
  const jobId = await beginCalendar();
  env.closeTab(1);
  await otherTab();
  const resumed = await send({ type: 'BEGIN_CALENDAR_SYNC', records: [], complete: false }, secondContent);
  assert.equal(resumed.data.calendarJob.id, jobId);
  assert.equal(resumed.data.calendarJob.tabId, 2);
  assert.equal(env.state().calendarJob.records.length, 1);
});
test('an account change pauses the previous calendar job on its owner tab', async t => {
  const env = environment(t);
  await connectCalendar();
  await beginCalendar();
  await send({ type: 'SET_CONTEXT', userId: '43' });
  assert.equal(env.state().calendarJob.status, 'paused');
});

const material = fields => ({ sourceKey: 'a'.repeat(64), sourceUrl: 'https://spectrum.um.edu.my/pluginfile.php/1/mod_resource/content/7/lecture.pdf',
  courseId: '123', moduleId: '4', name: 'Lecture', category: 'Notes', kind: 'binary', ...fields });
async function connectDrive() {
  await connectCalendar();
  assert.equal((await send({ type: 'CONNECT_GOOGLE', feature: 'drive' }, popup)).ok, true);
  await send({ type: 'SAVE_SETTINGS', settings: { archiveId: '2026 Semester 1' } });
}

test('Drive defaults to video downloads and preserves explicit opt-out and bounded recording metadata', async t => {
  const env = environment(t);
  await connectDrive();
  const status = await send({ type: 'GET_STATUS' });
  assert.equal(status.data.settings.videoPolicy, 'include');
  assert.equal((await send({ type: 'SAVE_SETTINGS', settings: { videoPolicy: 'links' } })).ok, true);
  assert.equal((await send({ type: 'GET_STATUS' })).data.settings.videoPolicy, 'links');
  assert.equal((await send({ type: 'SAVE_SETTINGS', settings: { videoPolicy: 'include' } })).ok, true);
  const begun = await send({ type: 'BEGIN_DRIVE_SYNC', materials: [material({ isVideo: true, mimeType: 'video/webm' })] });
  assert.equal(begun.ok, true, JSON.stringify(begun));
  assert.equal(env.state().activeJob.materials[0].isVideo, true);
  assert.equal(env.state().activeJob.materials[0].mimeType, 'video/webm');
  assert.equal(env.state().activeJob.binding.settings.videoPolicy, 'include');
  assert.equal((await send({ type: 'GET_STATUS' })).data.settings.videoPolicy, 'include');
});
test('Drive derives verified resource fingerprints instead of trusting supplied fingerprints', async t => {
  const env = environment(t);
  await connectDrive();
  const begun = await send({ type: 'BEGIN_DRIVE_SYNC', materials: [material({ sourceFingerprint: 'attacker-provided' })] });
  assert.equal(begun.ok, true);
  const expected = require('node:crypto').createHash('sha256').update('["resource-revision","7"]').digest('hex');
  assert.equal(env.state().activeJob.materials[0].sourceFingerprint, expected);
});
test('switching to ZIP pauses Drive before its next remote operation', async t => {
  const env = environment(t);
  await connectDrive();
  const begun = await send({ type: 'BEGIN_DRIVE_SYNC', materials: [material()] });
  await send({ type: 'SAVE_SETTINGS', settings: { mode: 'zip' } });
  await send({ type: 'DRIVE_STEP', jobId: begun.data.job.id });
  assert.equal(env.state().activeJob.status, 'paused');
  assert.equal(env.state().activeJob.folders, undefined);
});
test('another tab cannot steal a live Drive owner through retry', async t => {
  environment(t);
  await connectDrive();
  const begun = await send({ type: 'BEGIN_DRIVE_SYNC', materials: [material()] });
  await otherTab();
  const joined = await send({ type: 'BEGIN_DRIVE_SYNC', materials: [], retry: true }, secondContent);
  assert.equal(joined.data.job.id, begun.data.job.id);
  assert.equal(joined.data.job.tabId, 1);
});

test('calendar creation persists uncertainty before a lost response or worker termination', async t => {
  const env = environment(t, { loseCalendarReply: true, hideCalendars: true });
  await connectCalendar();
  const jobId = await beginCalendar();
  await send({ type: 'CALENDAR_STEP', jobId });
  await send({ type: 'CALENDAR_STEP', jobId });
  const durable = env.snapshotAtCalendarPost();
  const hash = durable.contexts['1'].bindingHash;
  assert.equal(durable.bindings[hash].calendarCreateIntent.state, 'uncertain');
  assert.equal(env.calendarPosts.length, 1);
  // Resume exactly the snapshot durable when the request left, before any finally checkpoint.
  env.restore(durable);
  await send({ type: 'CALENDAR_STEP', jobId });
  assert.equal(env.calendarPosts.length, 1);
  assert.equal(env.state().calendarJob.error.code, 'CALENDAR_CREATE_UNCERTAIN');
  env.showCalendars();
  await send({ type: 'BEGIN_CALENDAR_SYNC', records: [] });
  await send({ type: 'CALENDAR_STEP', jobId });
  assert.equal(env.state().bindings[hash].calendarId, 'calendar-0');
  assert.equal(env.calendarPosts.length, 1);
});

test('paused Drive and Calendar jobs survive another Google account and resume under their original binding', async t => {
  const env = environment(t);
  await connectDrive();
  const original = await send({ type: 'BEGIN_DRIVE_SYNC', materials: [material()] });
  const calendarId = await beginCalendar();
  const firstHash = original.data.bindingHash;
  env.switchGoogle();
  assert.equal((await send({ type: 'CONNECT_GOOGLE', feature: 'drive' }, popup)).ok, true);
  assert.equal((await send({ type: 'CONNECT_GOOGLE', feature: 'calendar' }, popup)).ok, true);
  const otherDrive = await send({ type: 'BEGIN_DRIVE_SYNC', materials: [material({ sourceKey: 'b'.repeat(64) })] });
  assert.equal(otherDrive.ok, true, JSON.stringify(otherDrive));
  const otherCalendar = await send({ type: 'BEGIN_CALENDAR_SYNC', records: [record], complete: true });
  assert.equal(otherCalendar.ok, true, JSON.stringify(otherCalendar));
  assert.notEqual(otherDrive.data.job.id, original.data.job.id);
  env.switchGoogle('sub-one');
  await send({ type: 'CONNECT_GOOGLE', feature: 'drive' }, popup);
  const recoveredDrive = await send({ type: 'BEGIN_DRIVE_SYNC', materials: [], retry: true });
  assert.equal(recoveredDrive.ok, true, JSON.stringify(recoveredDrive));
  assert.equal(recoveredDrive.data.job.id, original.data.job.id);
  assert.equal(recoveredDrive.data.bindingHash, firstHash);
  await send({ type: 'CONNECT_GOOGLE', feature: 'calendar' }, popup);
  const recoveredCalendar = await send({ type: 'BEGIN_CALENDAR_SYNC', records: [] });
  assert.equal(recoveredCalendar.ok, true, JSON.stringify(recoveredCalendar));
  assert.equal(recoveredCalendar.data.calendarJob.id, calendarId);
  assert.equal(env.state().activeJob.materials.length, 1);
  assert.equal(env.state().calendarJob.records.length, 1);
});

test('Drive scope changes freeze the old snapshot until an explicit fresh inventory replaces it', async t => {
  const env = environment(t);
  await connectDrive();
  const original = await send({ type: 'BEGIN_DRIVE_SYNC', materials: [material()] });
  await send({ type: 'SAVE_SETTINGS', settings: { archiveId: '2027 Semester 2', courseIds: ['456'], videoPolicy: 'include' } });
  assert.equal(env.state().activeJob.status, 'paused');
  assert.equal(env.state().activeJob.scopeChanged, true);
  assert.equal(env.state().activeJob.binding.settings.archiveId, '2026 Semester 1');
  assert.deepEqual(env.state().activeJob.binding.settings.courseIds, ['123']);
  await send({ type: 'DRIVE_STEP', jobId: original.data.job.id });
  assert.equal(env.state().activeJob.folders, undefined);
  const stale = await send({ type: 'BEGIN_DRIVE_SYNC', materials: [], retry: true });
  assert.equal(stale.ok, false);
  assert.equal(stale.error.code, 'SCOPE_CHANGED');
  const fresh = await send({ type: 'BEGIN_DRIVE_SYNC', freshInventory: true, retry: true,
    materials: [material({ sourceKey: 'b'.repeat(64), courseId: '456' })] });
  assert.equal(fresh.ok, true, JSON.stringify(fresh));
  assert.notEqual(fresh.data.job.id, original.data.job.id);
  assert.equal(fresh.data.job.scopeChanged, false);
  assert.equal(env.state().activeJob.materials[0].archiveId, '2027 Semester 2');
  assert.equal(env.state().activeJob.binding.settings.videoPolicy, 'include');
});

test('Calendar course changes pause the frozen scan until a manual fresh scan replaces it', async t => {
  const env = environment(t);
  await connectCalendar();
  const jobId = await beginCalendar();
  await send({ type: 'SAVE_SETTINGS', settings: { courseIds: ['456'] } });
  assert.equal(env.state().calendarJob.status, 'paused');
  assert.equal(env.state().calendarJob.scopeChanged, true);
  await send({ type: 'CALENDAR_STEP', jobId });
  assert.equal(env.calendarPosts.length, 0);
  const stale = await send({ type: 'BEGIN_CALENDAR_SYNC', records: [] });
  assert.equal(stale.ok, false);
  assert.equal(stale.error.code, 'SCOPE_CHANGED');
  const fresh = await send({ type: 'BEGIN_CALENDAR_SYNC', freshInventory: true, records: [{ ...record, courseId: '456', sourceKey: 'moodle:course:456:event:88' }], complete: true });
  assert.equal(fresh.ok, true, JSON.stringify(fresh));
  assert.notEqual(fresh.data.calendarJob.id, jobId);
  assert.equal(fresh.data.calendarJob.scopeChanged, false);
  assert.equal(env.state().calendarJob.records[0].courseId, '456');
});

test('announcement change feed adds one compact review item per new source revision', async t => {
  environment(t);
  await connectCalendar();
  const initial = announcementPost();
  const first = await send({ type: 'QUEUE_ANNOUNCEMENTS', posts: [initial], complete: true });
  assert.equal(first.data.recentChanges.length, 1);
  assert.equal(first.data.recentChanges[0].action, 'review');
  assert.equal(first.data.recentChanges[0].title, 'Deadline');
  assert.equal(first.data.recentChanges[0].text, undefined);
  const repeated = await send({ type: 'QUEUE_ANNOUNCEMENTS', posts: [initial], complete: true });
  assert.equal(repeated.data.recentChanges.length, 1);
  const revised = { ...initial, text: 'Submit on 2036-11-16. Meeting on 2036-11-17 at 14:00 to 15:00.' };
  const changed = await send({ type: 'QUEUE_ANNOUNCEMENTS', posts: [revised], complete: true });
  assert.equal(changed.data.recentChanges.length, 2);
  assert.notEqual(changed.data.recentChanges[0].sourceRevision, changed.data.recentChanges[1].sourceRevision);
  assert.equal((await send({ type: 'QUEUE_ANNOUNCEMENTS', posts: [revised] })).data.recentChanges.length, 2);
});

async function pendingFile(env) {
  await connectDrive();
  await send({ type: 'SAVE_SETTINGS', settings: { videoPolicy: 'links' } });
  const begun = await send({ type: 'BEGIN_DRIVE_SYNC', materials: [material()] });
  assert.equal(begun.ok, true);
  const jobId = begun.data.job.id;
  for (let step = 0; step < 30 && env.state().activeJob.upload?.phase !== 'verify'; step++) {
    const result = await send({ type: 'DRIVE_STEP', jobId });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.job.error, null, JSON.stringify(result));
  }
  const job = env.state().activeJob;
  assert.equal(job.upload.phase, 'verify');
  assert.ok(env.files.has(job.upload.fileId));
  assert.equal(env.files.get(job.upload.fileId).md5Checksum, undefined);
  return { jobId, bindingHash: begun.data.bindingHash, fileId: job.upload.fileId };
}

test('active and parked uploads block scope changes and keep their empty placeholder recoverable', async t => {
  const env = environment(t), original = await pendingFile(env);
  await send({ type: 'PAUSE_SYNC' });
  for (const settings of [{ courseIds: ['123', '456'] }, { archiveId: '2027 Semester 2' }, { videoPolicy: 'include' }]) {
    const result = await send({ type: 'SAVE_SETTINGS', settings });
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.error.code, 'UPLOAD_IN_PROGRESS');
    assert.equal(env.state().activeJob.id, original.jobId);
    assert.equal(env.state().activeJob.upload.fileId, original.fileId);
  }
  const settings = env.state().bindings[original.bindingHash].settings;
  assert.deepEqual(settings.courseIds, ['123']);
  assert.equal(settings.archiveId, '2026 Semester 1');
  assert.equal(settings.videoPolicy, 'links');
  env.switchGoogle();
  await send({ type: 'CONNECT_GOOGLE', feature: 'drive' }, popup);
  env.switchGoogle('sub-one');
  await send({ type: 'CONNECT_GOOGLE', feature: 'drive' }, popup);
  assert.equal(env.state().activeJob, null);
  const parked = await send({ type: 'SAVE_SETTINGS', settings: { courseIds: ['123', '456'] } });
  assert.equal(parked.ok, false);
  assert.equal(parked.error.code, 'UPLOAD_IN_PROGRESS');
  assert.equal(env.state().savedJobs.drive[original.bindingHash].upload.fileId, original.fileId);
  const resumed = await send({ type: 'BEGIN_DRIVE_SYNC', materials: [], retry: true });
  assert.equal(resumed.data.job.id, original.jobId);
  for (let step = 0; step < 30 && !env.state().activeJob.done; step++) await send({ type: 'DRIVE_STEP', jobId: original.jobId });
  assert.equal(env.state().activeJob.done, true);
  assert.equal(env.state().activeJob.results[0].action, 'created');
  const uploaded = env.files.get(original.fileId);
  assert.equal(uploaded.appProperties.uploadedMd5, uploaded.md5Checksum);
  assert.equal([...env.files.values()].filter(file => file.appProperties?.sourceKey === material().sourceKey).length, 1);
});

test('freshInventory cannot discard an outstanding upload from an older mismatched saved scope', async t => {
  const env = environment(t), original = await pendingFile(env);
  const corrupted = structuredClone(env.state());
  corrupted.bindings[original.bindingHash].settings.courseIds = ['123', '456'];
  env.restore(corrupted);
  const result = await send({ type: 'BEGIN_DRIVE_SYNC', freshInventory: true, retry: true, materials: [material()] });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'UPLOAD_IN_PROGRESS');
  assert.equal(env.state().activeJob.id, original.jobId);
  assert.equal(env.state().activeJob.upload.fileId, original.fileId);
});

test('disconnect after placeholder creation preserves the writer checkpoint for same-file recovery', async t => {
  const env = environment(t), original = await pendingFile(env);
  const hash = env.state().activeJob.upload.hash;
  const disconnected = await send({ type: 'DISCONNECT_GOOGLE' }, popup);
  assert.equal(disconnected.ok, true);
  assert.equal(env.state().activeJob.id, original.jobId);
  assert.equal(env.state().activeJob.upload?.fileId, original.fileId);
  assert.equal(env.state().activeJob.upload.hash, hash);
  assert.equal(env.state().activeJob.upload.phase, 'verify');
  await send({ type: 'CONNECT_GOOGLE', feature: 'drive' }, popup);
  const resumed = await send({ type: 'BEGIN_DRIVE_SYNC', materials: [], retry: true });
  assert.equal(resumed.data.job.id, original.jobId);
  for (let step = 0; step < 30 && !env.state().activeJob.done; step++) await send({ type: 'DRIVE_STEP', jobId: original.jobId });
  assert.equal(env.state().activeJob.results[0].action, 'created');
  const uploaded = env.files.get(original.fileId);
  assert.equal(uploaded.appProperties.uploadedMd5, uploaded.md5Checksum);
  assert.equal([...env.files.values()].filter(file => file.appProperties?.sourceKey === material().sourceKey).length, 1);
});

test('disconnect removes a parked partial-upload URL while retaining its writer and restarting safe verification', async t => {
  const env = environment(t, { sourceBytes: new Uint8Array(1024 * 1024 + 64).fill(7) });
  const original = await pendingFile(env);
  for (let step = 0; step < 10 && !env.state().activeJob.upload.offset; step++) await send({ type: 'DRIVE_STEP', jobId: original.jobId });
  assert.equal(env.state().activeJob.upload.offset, 1024 * 1024);
  assert.equal(env.state().activeJob.upload.phase, 'chunk');
  assert.ok(env.state().activeJob.upload.url);
  const hash = env.state().activeJob.upload.hash;
  env.switchGoogle();
  await send({ type: 'CONNECT_GOOGLE', feature: 'drive' }, popup);
  await send({ type: 'DISCONNECT_GOOGLE' }, popup);
  const parked = env.state().savedJobs.drive[original.bindingHash];
  assert.equal(parked.id, original.jobId);
  assert.equal(parked.upload?.fileId, original.fileId);
  assert.equal(parked.upload.hash, hash);
  assert.equal(parked.upload.url, undefined);
  assert.equal(parked.upload.phase, 'verify');
  env.switchGoogle('sub-one');
  await send({ type: 'CONNECT_GOOGLE', feature: 'drive' }, popup);
  const resumed = await send({ type: 'BEGIN_DRIVE_SYNC', materials: [], retry: true });
  assert.equal(resumed.data.job.id, original.jobId);
  for (let step = 0; step < 30 && !env.state().activeJob.done; step++) await send({ type: 'DRIVE_STEP', jobId: original.jobId });
  assert.equal(env.state().activeJob.done, true);
  assert.equal(env.state().activeJob.results[0].action, 'created');
  const uploaded = env.files.get(original.fileId);
  assert.equal(uploaded.appProperties.uploadedMd5, uploaded.md5Checksum);
  assert.equal(uploaded.sha256Checksum, hash);
  assert.equal([...env.files.values()].filter(file => file.appProperties?.sourceKey === material().sourceKey).length, 1);
});

test('options dashboard connects Google Calendar directly without prior SET_CONTEXT and without bindingHash crash', async t => {
  const env = environment(t);
  const optionsSender = { id: 'integration', url: 'chrome-extension://integration/options/options.html#calendar' };
  const connected = await send({ type: 'CONNECT_GOOGLE', feature: 'calendar' }, optionsSender);
  assert.equal(connected.ok, true, JSON.stringify(connected));
  assert.ok(connected.data.account?.email);
  assert.ok(connected.data.account?.features.includes('calendar'));
  assert.equal(connected.data.settings.calendarEnabled, true);
});

test('unregistered Spectrum tabs cannot read or change another student binding', async t => {
  const env = environment(t);
  const connected = await connectCalendar();
  await send({ type: 'SAVE_SETTINGS', settings: { archiveId: 'Private archive' } });
  for (const fields of [{}, { bindingHash: connected.bindingHash }]) {
    const status = await send({ type: 'GET_STATUS', ...fields }, secondContent);
    assert.equal(status.ok, true);
    assert.equal(status.data.bindingHash, null);
    assert.equal(status.data.account, null);
    assert.equal(status.data.settings.archiveId, '');
    const saved = await send({ type: 'SAVE_SETTINGS', settings: { archiveId: 'Wrong student' }, ...fields }, secondContent);
    assert.equal(saved.ok, false);
    assert.equal(saved.error.code, 'LOGIN_REQUIRED');
  }
  assert.equal(env.state().bindings[connected.bindingHash].settings.archiveId, 'Private archive');
  assert.equal(env.state().contexts['2'], undefined);
});

test('a registered Spectrum tab cannot select another student through bindingHash', async t => {
  const env = environment(t);
  const first = await connectCalendar();
  const second = await send({ type: 'SET_CONTEXT', userId: '43' }, secondContent);
  assert.equal(second.data.account, null);
  assert.deepEqual(second.data.settings.courseIds, []);
  const status = await send({ type: 'GET_STATUS', bindingHash: first.bindingHash }, secondContent);
  assert.equal(status.data.bindingHash, second.data.bindingHash);
  const saved = await send({ type: 'SAVE_SETTINGS', bindingHash: first.bindingHash, settings: { archiveId: 'Wrong student' } }, secondContent);
  assert.equal(saved.ok, false);
  assert.equal(saved.error.code, 'ACCOUNT_CHANGED');
  assert.equal(env.state().bindings[first.bindingHash].settings.archiveId, '');
});

test('pending options connection and settings move to the first Spectrum identity only', async t => {
  const env = environment(t);
  const optionsSender = { id: 'integration', url: 'chrome-extension://integration/options/options.html' };
  await send({ type: 'CONNECT_GOOGLE', feature: 'calendar' }, optionsSender);
  const settings = { archiveId: 'Draft archive', courseIds: ['123'], videoPolicy: 'include', announcementScanning: true };
  await send({ type: 'SAVE_SETTINGS', settings }, optionsSender);
  const first = await send({ type: 'SET_CONTEXT', userId: '42' });
  assert.deepEqual(first.data.account.features, ['calendar']);
  assert.equal(first.data.settings.calendarEnabled, true);
  for (const [key, value] of Object.entries(settings)) assert.deepEqual(first.data.settings[key], value);
  assert.equal(Object.values(env.state().bindings).some(binding => binding.spectrumUserId === 'local_student'), false);
  const second = await send({ type: 'SET_CONTEXT', userId: '43' }, secondContent);
  assert.equal(second.data.account, null);
  assert.equal(second.data.settings.calendarEnabled, true);
  assert.equal(second.data.settings.archiveId, '');
  assert.deepEqual(second.data.settings.courseIds, []);
  const restored = await send({ type: 'SET_CONTEXT', userId: '42' });
  assert.equal(restored.data.bindingHash, first.data.bindingHash);
  assert.deepEqual(restored.data.account.features, ['calendar']);
  assert.equal(restored.data.settings.archiveId, settings.archiveId);
});

test('local date discovery works without Google and keeps Drive scope and unreviewed announcements separate', async t => {
  const env = environment(t);
  const registered = await send({ type: 'SET_CONTEXT', userId: '42' });
  const settings = { courseIds: ['123'], archiveId: 'Drive selection', videoPolicy: 'include', calendarEnabled: false, announcementScanning: false };
  await send({ type: 'SAVE_SETTINGS', settings });
  const official = { ...record, courseId: '456', sourceKey: 'moodle:course:456:event:77' };
  const scan = { type: 'SAVE_DATE_SCAN', bindingHash: registered.data.bindingHash, courseIds: ['456'],
    records: [official], posts: [{ ...announcementPost(), courseId: '456' }], complete: true, announcementCursor: null, failures: [] };
  const saved = await send(scan);
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.deepEqual(saved.data.dateScan.courseIds, ['456']);
  assert.deepEqual(saved.data.dateScan.records, [official]);
  assert.equal(saved.data.dateScan.complete, true);
  assert.ok(saved.data.dateScan.completedAt > 0);
  for (const [key, value] of Object.entries(settings)) assert.deepEqual(saved.data.settings[key], value);
  assert.equal(saved.data.settings.calendarEnabled, false);
  assert.equal(saved.data.settings.announcementScanning, false);
  assert.equal(saved.data.candidates.length, 1);
  assert.equal(saved.data.candidates[0].state, 'pending');
  assert.deepEqual(saved.data.events, []);
  assert.equal(env.calendarPosts.length + env.eventPosts.length, 0, 'local discovery must not create Google resources');
  saved.data.dateScan.records[0].title = 'Caller mutation';
  assert.equal((await send({ type: 'GET_STATUS' })).data.dateScan.records[0].title, 'Assignment 1');
  const legacy = await send({ type: 'QUEUE_ANNOUNCEMENTS', posts: [], complete: true });
  assert.equal(legacy.error.code, 'DISABLED', 'automatic announcement checks retain their opt-in gate');
});

test('incomplete local date discovery preserves prior official records and the legacy announcement cursor', async t => {
  const env = environment(t);
  const registered = await send({ type: 'SET_CONTEXT', userId: '42' });
  const other = { ...record, courseId: '456', sourceKey: 'moodle:course:456:event:78' };
  const command = { type: 'SAVE_DATE_SCAN', bindingHash: registered.data.bindingHash, courseIds: ['123', '456'],
    records: [record, other], posts: [], complete: true, announcementCursor: null, failures: [] };
  assert.equal((await send(command)).ok, true);
  const snapshot = structuredClone(env.state()), binding = snapshot.bindings[registered.data.bindingHash];
  binding.announcementCursor = { courseId: '123', threadOffset: 5 };
  binding.events[record.sourceKey] = record;
  env.restore(snapshot);
  const saved = await send({ ...command, records: [{ ...record, title: 'Updated report' }], complete: false,
    announcementCursor: { courseId: '456', threadOffset: 3 }, failures: [{ courseId: '456', message: 'Course unavailable' }] });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.deepEqual(saved.data.dateScan.records.map(item => item.title), ['Updated report', 'Assignment 1']);
  assert.equal(saved.data.dateScan.complete, false);
  assert.deepEqual(saved.data.dateScan.announcementCursor, { courseId: '456', threadOffset: 3 });
  assert.deepEqual(saved.data.announcementCursor, { courseId: '123', threadOffset: 5 });
  assert.deepEqual(saved.data.events, [record], 'local rescanning never replaces already synced events');
});

test('local date discovery rejects malformed, out-of-scope and stale-account results without replacing saved data', async t => {
  const env = environment(t);
  const registered = await send({ type: 'SET_CONTEXT', userId: '42' });
  const command = { type: 'SAVE_DATE_SCAN', bindingHash: registered.data.bindingHash, courseIds: ['123'],
    records: [record], posts: [], complete: true, announcementCursor: null, failures: [] };
  assert.equal((await send(command)).ok, true);
  const before = structuredClone(env.state());
  for (const patch of [
    { bindingHash: null }, { courseIds: ['0'] }, { courseIds: Array(101).fill('123') },
    { records: [{ ...record, courseId: '999' }] }, { records: [{ ...record, sourceType: 'announcement' }] },
    { posts: [{ ...announcementPost(), courseId: '999' }] }, { posts: [announcementPost(), { courseId: '123' }] }
  ]) {
    assert.equal((await send({ ...command, ...patch })).ok, false, JSON.stringify(patch));
    assert.deepEqual(env.state(), before, 'invalid results must not partially replace records or queue candidates');
  }
  globalThis.chrome.tabs.sendMessage = async () => ({ userId: '43', origin: 'https://spectrum.um.edu.my' });
  assert.equal((await send(command)).error.code, 'LOGIN_REQUIRED');
  assert.deepEqual(env.state(), before);
  await send({ type: 'SAVE_SETTINGS', settings: { announcementScanning: true, courseIds: ['123'] } });
  assert.equal((await send({ type: 'QUEUE_ANNOUNCEMENTS', posts: [announcementPost()] })).error.code, 'LOGIN_REQUIRED');
  await send({ type: 'SET_CONTEXT', userId: '43' });
  assert.equal((await send(command)).error.code, 'ACCOUNT_CHANGED');
});

test('Calendar sync uses the saved date-scan scope without changing the Drive selection', async t => {
  const env = environment(t);
  const local = await send({ type: 'SET_CONTEXT', userId: '42' });
  await send({ type: 'SAVE_SETTINGS', settings: { courseIds: ['123'], archiveId: 'Drive archive' } });
  const official = { ...record, courseId: '456', sourceKey: 'moodle:course:456:event:77' };
  const scan = { type: 'SAVE_DATE_SCAN', bindingHash: local.data.bindingHash, courseIds: ['456'], records: [official],
    posts: [], complete: true, announcementCursor: null, failures: [] };
  assert.equal((await send(scan)).ok, true);
  const connected = await send({ type: 'CONNECT_GOOGLE', feature: 'calendar' }, popup);
  assert.deepEqual(connected.data.dateScan?.courseIds, ['456'], 'connecting Google must preserve an existing local scan');
  const command = { type: 'BEGIN_CALENDAR_SYNC', bindingHash: connected.data.bindingHash, useDateScan: true,
    records: [{ ...record, title: 'Do not trust client replacement' }], complete: false };
  const begun = await send(command);
  assert.equal(begun.ok, true, JSON.stringify(begun));
  assert.equal(begun.data.calendarJob.complete, true, 'coverage comes from the stored scan');
  assert.equal(env.state().calendarJob.records[0].courseId, '456');
  assert.equal(env.state().calendarJob.useDateScan, true);
  for (let step = 0; step < 8 && !env.state().calendarJob.done; step++) {
    await send({ type: 'CALENDAR_STEP', bindingHash: connected.data.bindingHash, jobId: begun.data.calendarJob.id });
  }
  assert.equal(env.eventPosts.length, 1);
  assert.equal(env.eventPosts[0].summary, 'Assignment 1');
  const saved = await send({ type: 'GET_STATUS' });
  assert.deepEqual(saved.data.settings.courseIds, ['123']);
  assert.equal(saved.data.settings.archiveId, 'Drive archive');
  assert.equal(saved.data.events[0].courseId, '456');
  await send({ ...scan, bindingHash: connected.data.bindingHash, courseIds: ['789'],
    records: [{ ...official, courseId: '789', sourceKey: 'moodle:course:789:event:77' }] });
  const pending = await send(command);
  await send({ type: 'SAVE_SETTINGS', settings: { reminderMinutes: [60] } });
  assert.equal(env.state().calendarJob.status, 'paused');
  const blocked = await send(command);
  assert.equal(blocked.error.code, 'SCOPE_CHANGED');
  const restarted = await send({ ...command, freshInventory: true });
  assert.equal(restarted.ok, true);
  assert.notEqual(restarted.data.calendarJob.id, pending.data.calendarJob.id);
  const stale = await send({ ...command, bindingHash: local.data.bindingHash });
  assert.equal(stale.error.code, 'ACCOUNT_CHANGED');
  const legacy = await send({ type: 'BEGIN_CALENDAR_SYNC', records: [record], complete: true });
  assert.equal(legacy.error.code, 'SCOPE_CHANGED', 'legacy and date-scan jobs cannot silently replace each other');
});

test('a fresh date scan replaces stale pending Calendar records while identical inventories resume', async t => {
  const env = environment(t), connected = await connectCalendar();
  const original = { ...record, courseId: '456', sourceKey: 'moodle:course:456:event:77' };
  const scan = { type: 'SAVE_DATE_SCAN', bindingHash: connected.bindingHash, courseIds: ['456'], records: [original],
    posts: [], complete: true, announcementCursor: null, failures: [] };
  const begin = { type: 'BEGIN_CALENDAR_SYNC', bindingHash: connected.bindingHash, useDateScan: true };
  await send(scan);
  const oldJob = await send(begin);
  const updated = { ...original, title: 'Rescheduled assignment', start: '2026-11-18', end: '2026-11-19', sourceRevision: 'rev2' };
  const saved = await send({ ...scan, records: [updated] });
  assert.equal(saved.data.calendarJob.scopeChanged, true, 'a changed source revision must invalidate the pending inventory');
  assert.equal(saved.data.calendarJob.status, 'paused');
  await send({ type: 'CALENDAR_STEP', jobId: oldJob.data.calendarJob.id });
  assert.equal(env.eventPosts.length, 0, 'a superseded date must never be written after the new scan is saved');
  assert.equal((await send(begin)).error.code, 'SCOPE_CHANGED');
  const fresh = await send({ ...begin, freshInventory: true });
  assert.notEqual(fresh.data.calendarJob.id, oldJob.data.calendarJob.id);
  await send({ ...scan, records: [updated] });
  const resumed = await send(begin);
  assert.equal(resumed.data.calendarJob.id, fresh.data.calendarJob.id, 'unchanged sources keep their checkpoint');
  for (let step = 0; step < 8 && !env.state().calendarJob.done; step++) await send({ type: 'CALENDAR_STEP', jobId: resumed.data.calendarJob.id });
  assert.equal(env.eventPosts.length, 1);
  assert.equal(env.eventPosts[0].summary, 'Rescheduled assignment');
  assert.deepEqual(env.eventPosts[0].start, { date: '2026-11-18' });
});

test('stopping date Calendar sync pauses only its matching tab and leaves the Drive writer running', async t => {
  const env = environment(t), connected = await connectCalendar();
  await beginCalendar();
  await send({ type: 'SET_CONTEXT', userId: '42' }, secondContent);
  const snapshot = structuredClone(env.state());
  snapshot.activeJob = { id: 'drive-running', bindingHash: connected.bindingHash, tabId: 1, materials: [], results: [], status: 'running', done: false };
  env.restore(snapshot);
  const pause = { type: 'PAUSE_SYNC', feature: 'calendar', bindingHash: connected.bindingHash };
  assert.equal((await send({ ...pause, bindingHash: 'stale' })).error.code, 'ACCOUNT_CHANGED');
  assert.equal((await send({ ...pause, feature: 'unknown' })).ok, false);
  assert.equal((await send({ ...pause, bindingHash: undefined })).error.code, 'FORBIDDEN');
  assert.equal((await send(pause, secondContent)).error.code, 'BUSY', 'another tab cannot stop this date writer');
  const stopped = await send(pause);
  assert.equal(stopped.ok, true, JSON.stringify(stopped));
  assert.equal(stopped.data.calendarJob.status, 'paused');
  assert.equal(env.state().activeJob.status, 'running', 'date cancellation must not pause concurrent file exports');
  const legacy = await send({ type: 'PAUSE_SYNC' });
  assert.equal(legacy.data.job.status, 'paused', 'the existing combined Pause keeps its behavior');
});

test('neutral announcement notices do not invent a review change without a candidate', async t => {
  environment(t);
  await connectCalendar();
  const queued = await send({ type: 'QUEUE_ANNOUNCEMENTS', complete: true,
    posts: [{ ...announcementPost(), title: 'Course notice', text: 'Please read the handbook before opening the resources.' }] });
  assert.equal(queued.ok, true, JSON.stringify(queued));
  assert.deepEqual(queued.data.candidates, []);
  assert.deepEqual(queued.data.recentChanges, [], 'a skipped neutral post must not claim to need date review');
});

test('new and missing preferences default on while explicit saved choices and the semester name remain unchanged', async t => {
  const env = environment(t);
  const initial = await send({ type: 'SET_CONTEXT', userId: '42' });
  assert.deepEqual({ autoSync: initial.data.settings.autoSync, calendarEnabled: initial.data.settings.calendarEnabled,
    announcementScanning: initial.data.settings.announcementScanning, videoPolicy: initial.data.settings.videoPolicy },
  { autoSync: true, calendarEnabled: true, announcementScanning: true, videoPolicy: 'include' });
  assert.equal(initial.data.settings.archiveId, '');
  const calendar = await send({ type: 'BEGIN_CALENDAR_SYNC', records: [record], complete: true });
  assert.equal(calendar.error.code, 'CONNECT_REQUIRED', 'an enabled preference cannot grant Calendar permission');
  await send({ type: 'SAVE_SETTINGS', settings: { autoSync: false, calendarEnabled: false, announcementScanning: false, videoPolicy: 'links', archiveId: 'My semester' } });
  const snapshot = structuredClone(env.state());
  delete snapshot.bindings[initial.data.bindingHash].settings.autoSync;
  env.restore(snapshot);
  const loaded = await send({ type: 'GET_STATUS' });
  assert.equal(loaded.data.settings.autoSync, true, 'only a missing key receives its current default');
  assert.equal(loaded.data.settings.calendarEnabled, false);
  assert.equal(loaded.data.settings.announcementScanning, false);
  assert.equal(loaded.data.settings.videoPolicy, 'links');
  assert.equal(loaded.data.settings.archiveId, 'My semester');
  assert.equal(loaded.data.account, null);
  assert.equal(env.calendarPosts.length + env.eventPosts.length, 0, 'enabled preferences cannot grant Google access');
});

test('connecting Google preserves explicit disabled local preferences instead of resetting them', async t => {
  environment(t);
  await send({ type: 'SET_CONTEXT', userId: '42' });
  const choices = { autoSync: false, calendarEnabled: false, announcementScanning: false, videoPolicy: 'links' };
  await send({ type: 'SAVE_SETTINGS', settings: choices });
  for (const feature of ['drive', 'calendar']) {
    const connected = await send({ type: 'CONNECT_GOOGLE', feature }, popup);
    assert.equal(connected.ok, true, JSON.stringify(connected));
    assert.ok(connected.data.account.features.includes(feature));
    for (const [key, value] of Object.entries(choices)) assert.equal(connected.data.settings[key], value, key);
  }
});

test('a background scan can start its cooldown before crawling, for known features only', async t => {
  environment(t);
  await send({ type: 'SET_CONTEXT', userId: '42' });
  const before = Date.now();
  const marked = await send({ type: 'MARK_SYNC_ATTEMPT', feature: 'announcements' });
  assert.equal(marked.ok, true);
  assert.ok(marked.data.syncTimes.announcements.lastAttemptAt >= before);
  const rejected = await send({ type: 'MARK_SYNC_ATTEMPT', feature: 'constructor' });
  assert.equal(rejected.ok, false);
});

test('the worker remembers linked materials between Drive jobs', async t => {
  const env = environment(t);
  await connectCalendar();
  assert.equal((await send({ type: 'CONNECT_GOOGLE', feature: 'drive' }, popup)).ok, true);
  await send({ type: 'SAVE_SETTINGS', settings: { archiveId: '2026 Semester 1' } });
  const start = await send({ type: 'BEGIN_DRIVE_SYNC', materials: [{
    sourceKey: 'b'.repeat(64), sourceUrl: 'https://spectrum.um.edu.my/mod/url/view.php?id=4',
    courseId: '123', moduleId: '4', name: 'Lecture recording', category: 'Notes', kind: 'link'
  }] });
  assert.equal(start.ok, true, JSON.stringify(start));
  const jobId = start.data.job.id;
  let status = start;
  for (let step = 0; step < 40 && !status.data.job.done; step++) status = await send({ type: 'DRIVE_STEP', jobId });
  const binding = env.state().bindings[status.data.bindingHash];
  assert.deepEqual(binding.driveLinks['2026 Semester 1'].map(link => link.name), ['Lecture recording']);
});

test('status names the Drive items that need attention', async t => {
  environment(t);
  await connectCalendar();
  assert.equal((await send({ type: 'CONNECT_GOOGLE', feature: 'drive' }, popup)).ok, true);
  await send({ type: 'SAVE_SETTINGS', settings: { archiveId: '2026 Semester 1' } });
  const start = await send({ type: 'BEGIN_DRIVE_SYNC', materials: [{
    sourceKey: 'c'.repeat(64), sourceUrl: 'https://files.example.test/notes?token=abc',
    courseId: '123', moduleId: '4', name: 'Shared notes', category: 'Notes', kind: 'link'
  }] });
  assert.equal(start.ok, true, JSON.stringify(start));
  let status = start;
  for (let step = 0; step < 40 && !status.data.job.done; step++) status = await send({ type: 'DRIVE_STEP', jobId: start.data.job.id });
  assert.deepEqual(status.data.job.attention, [{ name: 'Shared notes', action: 'failed', detail: 'UNSAFE_LINK' }]);
});
