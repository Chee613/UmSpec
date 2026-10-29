const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../shared/calendar-core.js');

const event = {
  sourceKey: 'moodle:course:123:event:77', sourceType: 'moodle',
  sourceUrl: 'https://spectrum.um.edu.my/calendar/view.php?view=event&id=77',
  courseId: '123', title: 'Assignment 1', description: 'Submit report',
  precision: 'date', start: '2026-11-15', end: '2026-11-16',
  timeZone: 'Asia/Kuala_Lumpur', meetingUrl: null, status: 'confirmed',
  sourceRevision: 'rev1', reminderMinutes: [1440, 60]
};

test('strict dates, explicit offsets, source URLs and reminder bounds are enforced', () => {
  assert.equal(core.validateEvent(event).valid, true);
  for (const patch of [
    { start: '2026-02-30' }, { end: '2026-11-15' },
    { sourceUrl: 'https://spectrum.um.edu.my.evil.test/' },
    { sourceUrl: 'https://spectrum.um.edu.my/calendar/view.php?sesskey=secret' },
    { title: 'Title\u0000' },
    { reminderMinutes: [60, 60] }, { reminderMinutes: [-1] },
    { reminderMinutes: [40321] }, { reminderMinutes: [1, 2, 3, 4, 5, 6] },
    { meetingUrl: 'javascript:alert(1)' }, { sourceKey: 'x'.repeat(1025) },
    { precision: 'instant', start: '2026-11-15T10:00:00', end: '2026-11-15T11:00:00+08:00' },
    { precision: 'instant', start: '2026-02-30T10:00:00+08:00', end: '2026-03-01T11:00:00+08:00' }
  ]) assert.equal(core.validateEvent({ ...event, ...patch }).valid, false, JSON.stringify(patch));
  assert.equal(core.isValidDate('2024-02-29'), true);
  assert.equal(core.isValidDate('2026-02-29'), false);
  assert.equal(core.isValidDate('2026-1-01'), false);
});

test('ICS excludes unknown and unreviewed dates and preserves source identity', async () => {
  const pending = { ...event, precision: 'unknown', start: null, end: null, status: 'needs_review' };
  assert.equal((await core.generateICS([pending], new Date('2026-10-24T00:00:00Z'))).includes('BEGIN:VEVENT'), false);
  const a = await core.generateICS([event], new Date('2026-10-24T00:00:00Z'));
  const b = await core.generateICS([{ ...event, start: '2026-11-16', end: '2026-11-17' }], new Date('2026-10-25T00:00:00Z'));
  assert.equal(a.match(/UID:(.*)/)[1], b.match(/UID:(.*)/)[1]);
  assert.match(a, /DTSTART;VALUE=DATE:20261115\r\nDTEND;VALUE=DATE:20261116/);
  assert.match(a, /DTSTAMP:20261024T000000Z/);
  assert.match(await core.stableEventId('binding', event.sourceKey), /^[0-9a-f]{64}$/);
  assert.notEqual(await core.stableEventId('binding', event.sourceKey), await core.stableEventId('binding', 'another-source'));
});

test('ICS escapes injection and folds UTF8 text to 75 octets without damaging Unicode', async () => {
  const title = 'Penilaian 中文 '.repeat(15) + '\\,;\nInjected: yes';
  const ics = await core.generateICS([{ ...event, title }], new Date('2026-10-24T00:00:00Z'));
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75);
  const unfolded = ics.replace(/\r\n /g, '');
  assert.ok(unfolded.includes('SUMMARY:' + title.replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n')));
  assert.equal(ics.replace(/\r\n/g, '').includes('\n'), false);
});

test('official raw contract retains Malaysia wall clock and one-minute deadline semantics', () => {
  const startSeconds = Date.parse('2026-11-15T23:59:00+08:00') / 1000;
  const raw = { id: 77, courseId: 123, title: 'Assignment 1', description: 'Submit report', kind: 'deadline', startSeconds, durationSeconds: 0, revision: 'rev1' };
  const result = core.normaliseMoodleEvent(raw, event.sourceUrl);
  assert.equal(result.start, '2026-11-15T23:59:00+08:00');
  assert.equal(Date.parse(result.end) - Date.parse(result.start), 60000);
  assert.match(result.title, /^Due at/);
  assert.equal(core.normaliseMoodleEvent({ ...raw, kind: 'meeting' }, event.sourceUrl).status, 'needs_review');
  for (const start of [NaN, Infinity, '1794758340', null]) assert.throws(() => core.normaliseMoodleEvent({ ...raw, startSeconds: start }, event.sourceUrl));
  assert.throws(() => core.normaliseMoodleEvent({ ...raw, revision: '' }, event.sourceUrl));
});

test('Google payloads carry safe links, no invitations, and hash actual owned fields', async () => {
  const payload = core.buildGoogleEvent({ ...event, meetingUrl: 'https://meet.google.com/abc-defg-hij' }, 'a'.repeat(64));
  assert.deepEqual(payload.start, { date: '2026-11-15' });
  assert.ok(payload.description.includes(event.sourceUrl));
  assert.equal(payload.location, 'https://meet.google.com/abc-defg-hij');
  assert.equal(payload.attendees, undefined);
  assert.equal(payload.conferenceData, undefined);
  assert.throws(() => core.buildGoogleEvent({ ...event, status: 'needs_review' }));
  const hash = await core.eventPayloadHash(payload);
  assert.equal(hash, await core.eventPayloadHash({ ...payload, colorId: '5', extendedProperties: { private: { umspecAppliedHash: 'forged' } } }));
  assert.notEqual(hash, await core.eventPayloadHash({ ...payload, summary: 'Student edit' }));
  const remote = { ...payload, extendedProperties: { private: { umspecSource: event.sourceKey, umspecRevision: 'rev1', umspecAppliedHash: hash } } };
  assert.equal(core.decideEventAction(event, remote, hash), 'skip');
  assert.equal(core.decideEventAction({ ...event, sourceRevision: 'rev2' }, remote, hash), 'update');
  assert.equal(core.decideEventAction(event, remote, 'edited'), 'review');
  assert.equal(core.decideEventAction(event, { ...remote, status: 'cancelled' }, hash), 'restore');
  assert.equal(core.decideEventAction({ ...event, status: 'cancelled' }, remote, hash), 'review');
});

test('upcoming dates respect exclusive ends, Malaysia midnight and exactly seven days', () => {
  const now = new Date('2026-11-15T00:00:00+08:00');
  const records = [event, { ...event, sourceKey: 'expired', start: '2026-11-14', end: '2026-11-15' },
    { ...event, sourceKey: 'boundary', start: '2026-11-22', end: '2026-11-23' },
    { ...event, sourceKey: 'cancelled', status: 'cancelled' },
    { ...event, sourceKey: 'pending', status: 'needs_review' }];
  assert.deepEqual(core.upcomingRecords(records, now).map(r => r.sourceKey), [event.sourceKey]);
});

const writer = require('../background/calendar.js');
const binding = () => ({ hash: 'binding', spectrumUserId: '42', googleSub: 'sub', calendarId: 'managed', settings: { reminderMinutes: [1440, 60] } });
function fakeGoogle(t, { calendars = [{ id: 'managed', description: 'umspec:v1:binding', etag: 'cal-etag' }], pages, failCreate = false, loseInsert = false } = {}) {
  const events = new Map(), requests = [];
  const previous = globalThis.UmSpecGoogle;
  t.after(() => { globalThis.UmSpecGoogle = previous; });
  globalThis.UmSpecGoogle = { async googleFetch(path, options = {}, feature) {
    assert.equal(feature, 'calendar');
    const method = options.method || 'GET', url = new URL(path, 'https://www.googleapis.com');
    requests.push({ path, method, options });
    const reply = (status, body = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (url.pathname === '/calendar/v3/users/me/calendarList') {
      if (pages) return reply(200, pages[url.searchParams.get('pageToken') || 'first']);
      return reply(200, { items: calendars });
    }
    if (url.pathname === '/calendar/v3/calendars' && method === 'POST') {
      const calendar = { ...JSON.parse(options.body), id: 'created', etag: 'cal-new' };
      calendars.push(calendar);
      if (failCreate) throw new Error('Lost calendar response');
      return reply(200, calendar);
    }
    if (/^\/calendar\/v3\/calendars\/[^/]+$/.test(url.pathname)) {
      const calendar = calendars.find(c => c.id === decodeURIComponent(url.pathname.split('/').at(-1)));
      return calendar ? reply(200, calendar) : reply(404);
    }
    const match = url.pathname.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/);
    assert.ok(match, path);
    assert.equal(decodeURIComponent(match[1]), 'managed');
    const id = match[2] && decodeURIComponent(match[2]);
    if (method === 'GET') return events.has(id) ? reply(200, events.get(id)) : reply(404);
    const body = JSON.parse(options.body);
    assert.equal(body.attendees, undefined);
    assert.equal(body.conferenceData, undefined);
    assert.equal(url.searchParams.get('sendUpdates'), 'none');
    if (method === 'POST') {
      if (events.has(body.id)) return reply(409);
      events.set(body.id, { ...body, etag: 'event-1' });
      if (loseInsert) { loseInsert = false; throw new Error('Lost event response'); }
      return reply(200, events.get(body.id));
    }
    assert.equal(method, 'PATCH');
    if (options.headers['If-Match'] !== events.get(id)?.etag) return reply(412);
    events.set(id, { ...events.get(id), ...body, etag: 'event-2' });
    return reply(200, events.get(id));
  } };
  return { events, requests, calendars };
}

test('calendar recovery paginates exact binding markers and rejects duplicates', async t => {
  const fake = fakeGoogle(t, { pages: {
    first: { items: [{ id: 'personal', summary: 'UM Spec', description: '' }], nextPageToken: 'next' },
    next: { items: [{ id: 'recovered', description: 'umspec:v1:binding', etag: 'found' }] }
  } });
  const account = { ...binding(), calendarId: null };
  assert.equal((await writer.ensureCalendar(account, false)).id, 'recovered');
  assert.equal(account.calendarId, 'recovered');
  assert.equal(fake.requests.filter(r => r.method === 'POST').length, 0);
  fakeGoogle(t, { calendars: [{ id: 'a', description: 'umspec:v1:binding' }, { id: 'b', description: 'umspec:v1:binding' }] });
  await assert.rejects(writer.ensureCalendar({ ...binding(), calendarId: null }, false), /multiple|ambiguous/i);
});

test('calendar creation requires a persisted intent and recovers a lost response', async t => {
  const fake = fakeGoogle(t, { calendars: [], failCreate: true });
  const account = { ...binding(), calendarId: null };
  assert.deepEqual(await writer.ensureCalendar(account, true), { id: null, pending: true });
  assert.equal(fake.requests.filter(r => r.method === 'POST').length, 0);
  assert.equal(account.calendarCreateIntent.state, 'prepared');
  await assert.rejects(writer.ensureCalendar(account, true), /Lost calendar response/);
  assert.equal(account.calendarCreateIntent.state, 'uncertain');
  assert.equal((await writer.ensureCalendar(account, true)).id, 'created');
  assert.equal(fake.requests.filter(r => r.method === 'POST').length, 1);
  assert.equal(fake.requests.find(r => r.method === 'POST').options.retry, false);
});

test('deleted or wrongly marked stored calendars never expose their event endpoint', async t => {
  const fake = fakeGoogle(t, { calendars: [{ id: 'managed', description: 'my personal calendar' }] });
  await assert.rejects(writer.syncEvent(binding(), event), /marker|managed|ownership/i);
  assert.equal(fake.requests.some(r => r.path.includes('/events')), false);
  fake.calendars.length = 0;
  await assert.rejects(writer.ensureCalendar(binding(), false), /deleted|missing/i);
  assert.equal(fake.requests.some(r => r.method === 'POST'), false);
});

test('repeated sync and lost insert responses create one stable event', async t => {
  const fake = fakeGoogle(t, { loseInsert: true }), account = binding();
  const first = await writer.syncEvent(account, event);
  assert.equal(first.action, 'create');
  assert.equal((await writer.syncEvent(account, event)).action, 'skip');
  assert.equal(fake.events.size, 1);
  assert.equal(fake.requests.filter(r => r.method === 'POST').length, 1);
  assert.equal(account.calendarEvents[first.eventId].sourceKey, event.sourceKey);
});

test('source changes patch with If-Match while user edits and deletions need review', async t => {
  const fake = fakeGoogle(t), account = binding();
  const first = await writer.syncEvent(account, event);
  const original = fake.events.get(first.eventId);
  original.colorId = '5'; original.attendees = [{ email: 'existing@example.test' }];
  original.extendedProperties.private.unrelated = 'keep';
  const revised = { ...event, sourceRevision: 'rev2', start: '2026-11-16', end: '2026-11-17' };
  assert.equal((await writer.syncEvent(account, revised)).action, 'update');
  const updated = fake.events.get(first.eventId);
  assert.equal(updated.start.date, '2026-11-16');
  assert.equal(updated.colorId, '5');
  assert.equal(updated.attendees.length, 1);
  assert.equal(updated.extendedProperties.private.unrelated, 'keep');
  updated.summary = 'My changed title';
  assert.equal((await writer.syncEvent(account, revised)).action, 'review');
  assert.equal(updated.summary, 'My changed title');
  updated.status = 'cancelled';
  assert.equal((await writer.syncEvent(account, revised)).action, 'restore');
  fake.events.delete(first.eventId);
  assert.equal((await writer.syncEvent(account, revised)).action, 'restore');
  assert.equal(fake.requests.filter(r => r.method === 'POST').length, 1);
  assert.equal((await writer.syncEvent(account, { ...revised, status: 'cancelled' })).action, 'review');
});

test('412 races refetch once without overwriting, and scope denial stays an error', async t => {
  const fake = fakeGoogle(t), account = binding();
  const first = await writer.syncEvent(account, event);
  const base = globalThis.UmSpecGoogle.googleFetch;
  globalThis.UmSpecGoogle.googleFetch = async (path, options, feature) => {
    if (options?.method === 'PATCH') { fake.events.get(first.eventId).etag = 'concurrent'; fake.events.get(first.eventId).summary = 'Concurrent edit'; }
    return base(path, options, feature);
  };
  assert.equal((await writer.syncEvent(account, { ...event, sourceRevision: 'rev2' })).action, 'review');
  assert.equal(fake.events.get(first.eventId).summary, 'Concurrent edit');
  assert.equal(fake.requests.filter(r => r.method === 'PATCH').length, 1);
  globalThis.UmSpecGoogle.googleFetch = async () => new Response('{}', { status: 403 });
  await assert.rejects(writer.ensureCalendar(binding(), false), error => error.status === 403);
});

test('oversized ownership values are rejected before any Google request', async t => {
  const fake = fakeGoogle(t);
  await assert.rejects(writer.ensureCalendar({ ...binding(), hash: 'x'.repeat(1025) }, false), /binding/i);
  assert.equal(fake.requests.length, 0);
});

test('Google offset normalization keeps timed events unchanged', async () => {
  const payload = core.buildGoogleEvent({ ...event, precision: 'instant', start: '2026-11-15T23:59:00+08:00', end: '2026-11-16T00:00:00+08:00' });
  const remote = { ...payload, start: { dateTime: '2026-11-15T15:59:00Z', timeZone: 'Asia/Kuala_Lumpur' }, end: { dateTime: '2026-11-15T16:00:00Z', timeZone: 'Asia/Kuala_Lumpur' } };
  assert.equal(await core.eventPayloadHash(payload), await core.eventPayloadHash(remote));
});
