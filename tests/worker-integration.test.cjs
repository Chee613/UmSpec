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
function environment(t, { loseCalendarReply = false, hideCalendars = false, sourceBytes = 'source bytes' } = {}) {
  let stored = {}, token = 'integration-token-' + ++sequence;
  const users = new Map([[token, { sub: 'sub-one', email: 'one@example.test' }]]);
  const calendars = new Map(), events = new Map(), eventPosts = [], calendarPosts = [], files = new Map();
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
    if (url.pathname === '/calendar/v3/users/me/calendarList') return reply(200, { items: hideCalendars ? [] : [...calendars.values()] });
    if (url.pathname === '/calendar/v3/calendars' && method === 'POST') {
      const active = stored.umspecState.bindings[stored.umspecState.contexts['1'].bindingHash];
      snapshotAtCalendarPost = structuredClone(stored.umspecState);
      assert.equal(active.calendarCreateIntent.state, 'uncertain', 'uncertain intent must be durable before issuing POST');
      const calendar = { ...JSON.parse(options.body), id: 'calendar-' + calendars.size, etag: 'cal-etag' };
      calendars.set(calendar.id, calendar); calendarPosts.push(calendar);
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
    state: () => stored.umspecState, eventPosts, calendarPosts, files, closeTab: id => closedTabs.add(id),
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
  await send({ type: 'SAVE_SETTINGS', settings: { autoSync: true } });
  env.switchGoogle();
  const connected = await send({ type: 'CONNECT_GOOGLE', feature: 'calendar' }, popup);
  assert.equal(connected.ok, true);
  assert.equal(connected.data.account.email, 'two@example.test');
  assert.equal(connected.data.calendarId, null, 'another Google account must discover its own calendar');
  assert.deepEqual(connected.data.events, []);
  assert.equal(connected.data.calendarJob, null);
  assert.equal(connected.data.settings.autoSync, false);
  assert.deepEqual(connected.data.settings.courseIds, ['123']);
  assert.equal(env.state().bindings[originalHash].calendarId, 'calendar-0');
  assert.equal(env.state().bindings[originalHash].settings.autoSync, true);
});

test('review rejects refreshed content with a different authoritative forum identity', async t => {
  const env = environment(t);
  await connectCalendar();
  const post = { courseId: '123', forumId: '5', postId: '9', title: 'Deadline', text: 'Submit on 2026-11-15.',
    sourceUrl: 'https://spectrum.um.edu.my/mod/forum/discuss.php?d=8#p9', publishedAt: '2026-10-24T12:00:00+08:00', links: [] };
  const queued = await send({ type: 'QUEUE_ANNOUNCEMENTS', posts: [post], complete: true });
  assert.equal(queued.ok, true);
  const candidate = queued.data.candidates[0];
  const reviewed = await send({ type: 'REVIEW_ANNOUNCEMENT', candidateId: candidate.candidateId,
    refreshedPost: { ...post, forumId: '6' }, editedFields: { reviewedRevision: candidate.sourceRevision, start: '2026-11-15' } });
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
  const post = { courseId: '123', forumId: '5', postId: '9', title: 'Deadline', text: 'Submit on 2026-11-15.',
    sourceUrl: 'https://spectrum.um.edu.my/mod/forum/discuss.php?d=8#p9', publishedAt: '2026-10-24T12:00:00+08:00', links: [] };
  const queued = await send({ type: 'QUEUE_ANNOUNCEMENTS', posts: [post], complete: true });
  const candidate = queued.data.candidates[0];
  const previous = globalThis.UmSpecCalendar;
  t.after(() => { globalThis.UmSpecCalendar = previous; });
  globalThis.UmSpecCalendar = { ...previous, syncEvent: async () => ({ action: 'pending', eventId: 'pending-id' }) };
  const reviewed = await send({ type: 'REVIEW_ANNOUNCEMENT', candidateId: candidate.candidateId, refreshedPost: post,
    editedFields: { reviewedRevision: candidate.sourceRevision, start: '2026-11-15' } });
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

const announcementPost = () => ({ courseId: '123', forumId: '5', postId: '9', title: 'Deadline', text: 'Submit on 2026-11-15.',
  sourceUrl: 'https://spectrum.um.edu.my/mod/forum/discuss.php?d=8#p9', publishedAt: '2026-10-24T12:00:00+08:00', links: [] });
async function queuedReview() {
  const post = announcementPost();
  const result = await send({ type: 'QUEUE_ANNOUNCEMENTS', posts: [post], complete: true });
  assert.equal(result.ok, true);
  const candidate = result.data.candidates[0];
  return { type: 'REVIEW_ANNOUNCEMENT', candidateId: candidate.candidateId, refreshedPost: post,
    editedFields: { reviewedRevision: candidate.sourceRevision, start: '2026-11-15' } };
}
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

test('Drive defaults to video links and preserves bounded recording metadata and explicit include choice', async t => {
  const env = environment(t);
  await connectDrive();
  const status = await send({ type: 'GET_STATUS' });
  assert.equal(status.data.settings.videoPolicy, 'links');
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
  const revised = { ...initial, text: 'Submit on 2026-11-16. Meeting on 2026-11-17 at 14:00 to 15:00.' };
  const changed = await send({ type: 'QUEUE_ANNOUNCEMENTS', posts: [revised], complete: true });
  assert.equal(changed.data.recentChanges.length, 2);
  assert.notEqual(changed.data.recentChanges[0].sourceRevision, changed.data.recentChanges[1].sourceRevision);
  assert.equal((await send({ type: 'QUEUE_ANNOUNCEMENTS', posts: [revised] })).data.recentChanges.length, 2);
});

async function pendingFile(env) {
  await connectDrive();
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
