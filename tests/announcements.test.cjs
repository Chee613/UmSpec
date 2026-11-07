const test = require('node:test');
const assert = require('node:assert/strict');
const announcements = require('../shared/announcement-core.js');

// Synthetic examples exercise pure rules; these are not captured Spectrum fixtures.
const post = (fields = {}) => ({
  courseId: '123', forumId: '5', postId: '9',
  sourceUrl: 'https://spectrum.um.edu.my/mod/forum/discuss.php?d=7#p9',
  title: 'Course announcement', text: 'Submit by 15 December 2026.',
  publishedAt: '2026-12-10T09:00:00+08:00', modifiedAt: null, links: [], ...fields
});

test('normalisation hashes substantive content independently of fetch metadata', async () => {
  const first = await announcements.normalisePost(post({ text: 'Submit  by 15 December 2026.\r\n' }));
  const second = await announcements.normalisePost(post({ modifiedAt: '2026-12-11T09:00:00+08:00' }));
  assert.match(first.sourceRevision, /^[a-f0-9]{64}$/);
  assert.equal(first.sourceRevision, second.sourceRevision);
  assert.notEqual(first.sourceRevision, (await announcements.normalisePost(post({ text: 'Submit by 16 December 2026.' }))).sourceRevision);
  assert.notEqual(first.sourceRevision, (await announcements.normalisePost(post({ links: ['https://meet.google.com/abc-defg-hij'] }))).sourceRevision);
  const safe = await announcements.normalisePost(post({ text: 'Open /mod/assign/view.php?id=1&sesskey=live-secret before 15 December 2026.', links: ['https://spectrum.um.edu.my/mod/assign/view.php?id=1&sesskey=live-secret'] }));
  assert.equal(safe.text.includes('live-secret'), false);
  assert.deepEqual(safe.links, ['https://spectrum.um.edu.my/mod/assign/view.php?id=1']);
  assert.equal(announcements.extractSuggestions(safe)[0].linkedActivityUrl, 'https://spectrum.um.edu.my/mod/assign/view.php?id=1');
});

test('normalisation rejects invalid identity, foreign sources and oversized content', async () => {
  for (const fields of [
    { courseId: '' }, { postId: '../9' }, { forumId: 0 },
    { sourceUrl: 'https://spectrum.um.edu.my.attacker.example/mod/forum/discuss.php?d=7' },
    { sourceUrl: 'http://spectrum.um.edu.my/mod/forum/discuss.php?d=7' },
    { sourceUrl: 'https://spectrum.um.edu.my/mod/forum/discuss.php?d=7&sesskey=secret' },
    { sourceUrl: 'https://spectrum.um.edu.my/mod/forum/discuss.php?d=7#p8' },
    { text: 'x'.repeat(100001) }
  ]) await assert.rejects(announcements.normalisePost(post(fields)));
});

test('review becomes stale when source revision changes', () => {
  const candidate = { sourceRevision: 'rev1', acceptedRevision: 'rev1' };
  assert.equal(announcements.isReviewStale(candidate, 'rev1'), false);
  assert.equal(announcements.isReviewStale(candidate, 'rev2'), true);
});

test('English and Malay explicit dates keep Malaysian times and original meeting parameters', () => {
  const link = 'https://us02web.zoom.us/j/123?pwd=secret&from=calendar';
  const result = announcements.extractSuggestions(post({
    title: 'Sesi taklimat', text: 'Sesi taklimat pada 15 Disember 2026, 2:00 pm hingga 3:00 pm.', links: [link]
  }));
  assert.equal(result.length, 1);
  assert.equal(result[0].suggestedStart, '2026-12-15T14:00:00+08:00');
  assert.equal(result[0].suggestedEnd, '2026-12-15T15:00:00+08:00');
  assert.equal(result[0].meetingUrl, link);
  assert.equal(result[0].kind, 'meeting');
  assert.equal(result[0].confirmed, undefined);
});

test('all supported explicit date formats validate components without locale inference', () => {
  for (const [text, date] of [
    ['Submit by 03/04/2026.', '2026-04-03'], ['Submit by 2028-02-29.', '2028-02-29'],
    ['Submit by 1 Mac 2026.', '2026-03-01'], ['Submit by 2 May 2026.', '2026-05-02'],
    ['Submit by 3 Oktober 2026.', '2026-10-03']
  ]) assert.equal(announcements.extractSuggestions(post({ text }))[0].suggestedStart, date);
  // Without a publication date a year-less date has no anchor.
  for (const [text, publishedAt] of [['Submit by 2026-02-29.'], ['Submit by 31/04/2026.'], ['Submit by 15 December.', null], ['Submit in Week 6.']]) {
    const result = announcements.extractSuggestions(post({ text, ...(publishedAt === null ? { publishedAt } : {}) }))[0];
    assert.equal(result.precision, 'unknown');
    assert.equal(result.suggestedStart, null);
  }
});

test('more written date and time formats are read without guessing', () => {
  for (const [text, start, end] of [
    ['Kelas pada 15hb Disember 2026, 2.30 petang hingga 4.30 petang.', '2026-12-15T14:30:00+08:00', '2026-12-15T16:30:00+08:00'],
    ['Quiz on December 20, 2026 at 10 a.m. for 60 minutes.', '2026-12-20T10:00:00+08:00', '2026-12-20T11:00:00+08:00'],
    ['Lecture 2 p.m. to 4 p.m. on 2026-12-20.', '2026-12-20T14:00:00+08:00', '2026-12-20T16:00:00+08:00'],
    ['Class on 20.12.2026 from 2-4pm.', '2026-12-20T14:00:00+08:00', '2026-12-20T16:00:00+08:00'],
    ['Meeting 20-12-2026 1430hrs to 1530hrs.', '2026-12-20T14:30:00+08:00', '2026-12-20T15:30:00+08:00'],
    ['Kuliah pada 20/12/2026 jam 10 pagi selama 2 jam.', '2026-12-20T10:00:00+08:00', '2026-12-20T12:00:00+08:00'],
    ['Taklimat 21 Dis 2026, 8 malam hingga 10 malam.', '2026-12-21T20:00:00+08:00', '2026-12-21T22:00:00+08:00']
  ]) {
    const result = announcements.extractSuggestions(post({ text }))[0];
    assert.equal(result.suggestedStart, start, text);
    assert.equal(result.suggestedEnd, end, text);
  }
});

test('a year-less date takes the only year within a week before to six months after posting', () => {
  for (const [text, publishedAt, date] of [
    ['Submit by 15 December.', '2026-12-10T09:00:00+08:00', '2026-12-15'],
    ['Quiz on 5 Jan.', '2026-12-10T09:00:00+08:00', '2027-01-05'],
    ['Quiz on Jan 5.', '2026-12-10T09:00:00+08:00', '2027-01-05'],
    ['Recap of 8 Dec.', '2026-12-10T09:00:00+08:00', '2026-12-08'],
    ['Submit by 2 Nov.', '2026-12-10T09:00:00+08:00', null],
    ['Final on 1 Oct.', '2026-12-10T09:00:00+08:00', null],
    ['Submit by 29 Feb.', '2027-01-10T09:00:00+08:00', null]
  ]) {
    const result = announcements.extractSuggestions(post({ text, publishedAt }))[0];
    assert.equal(result.suggestedStart, date, text);
    if (date) assert.equal(result.reason, 'inferred_year');
  }
});

test('ranges, contradicting weekdays and ambiguous wording stay unresolved', () => {
  for (const text of [
    'Talk 15-16 December 2026.', 'Talk December 15-16, 2026.', 'Workshop 15 dan 16 Disember 2026.',
    'Class on Monday, 20 Nov 2026.', 'Class on 20 Nov 2026 (Monday).', 'Class next Friday at 2pm.', 'Kelas Jumaat depan.'
  ]) assert.equal(announcements.extractSuggestions(post({ text }))[0].suggestedStart, null, text);
  assert.equal(announcements.extractSuggestions(post({ text: 'Class on Friday, 20 Nov 2026.' }))[0].suggestedStart, '2026-11-20');
  const shared = announcements.extractSuggestions(post({ text: 'Lecture 11-1pm on 2026-12-20.' }))[0];
  assert.equal(shared.suggestedStart, '2026-12-20', 'an out-of-order shared marker never turns the end into the start');
  assert.equal(announcements.extractSuggestions(post({ text: 'Groups of 3 may submit together.' })).length, 0);
});

test('today, tonight and lusa anchor to the posting day', () => {
  for (const [text, start] of [['Meeting today at 2pm to 3pm.', '2026-12-10T14:00:00+08:00'],
    ['Taklimat malam ini 8 malam hingga 9 malam.', '2026-12-10T20:00:00+08:00'], ['Hantar lusa.', '2026-12-12']]) {
    assert.equal(announcements.extractSuggestions(post({ text }))[0].suggestedStart, start, text);
  }
});

test('posts without any date signal are not queued and past dates are dropped when a clock is given', () => {
  for (const text of ['Assignment 2 is released. Submit via the portal.', 'Join the class via Zoom.', 'Quiz answers are posted.']) {
    assert.deepEqual(announcements.extractSuggestions(post({ text, links: ['https://meet.google.com/abc-defg-hij'] })), [], text);
  }
  const now = Date.parse('2026-12-16T00:00:00+08:00');
  const mixed = post({ text: 'Submit by 2026-12-15.\nQuiz on 2026-12-16 at 10:00 to 11:00.\nExam on 2026-12-20.' });
  assert.deepEqual(announcements.extractSuggestions(mixed, { now }).map(item => item.suggestedStart), ['2026-12-16T10:00:00+08:00', '2026-12-20']);
  assert.equal(announcements.extractSuggestions(mixed).length, 3, 'without a clock nothing is dropped');
  assert.equal(announcements.extractSuggestions(post({ text: 'Submit in Week 6.' }), { now }).length, 1, 'undated hints stay reviewable');
});

test('abbreviated month names retain explicit years and reject impossible dates', () => {
  for (const [text, date] of [
    ['Submit by 2 Nov 2026.', '2026-11-02'], ['Submit by 3 Sep 2026.', '2026-09-03'],
    ['Submit by 4 Okt 2026.', '2026-10-04'], ['Submit by 5 Dis 2026.', '2026-12-05'],
    ['Submit by 31 Apr 2026.', null], ['Submit by 2 Nov.', null]
  ]) assert.equal(announcements.extractSuggestions(post({ text }))[0].suggestedStart, date);
});

test('an explicit title date is retained when the body has no date', () => {
  const result = announcements.extractSuggestions(post({ title: 'Assignment due 2 Nov 2026', text: 'Please follow the attached instructions.' }));
  assert.equal(result.length, 1);
  assert.equal(result[0].suggestedStart, '2026-11-02');
  assert.equal(result[0].precision, 'date');
  assert.match(result[0].evidence, /2 Nov 2026/);
  assert.equal(result[0].confirmed, undefined);
  assert.equal(result[0].status, undefined);
});

test('a single explicit date can use an immediately adjacent labelled or time-only line', () => {
  for (const fields of [
    { text: 'Meeting on 2 November 2026\nTime: 2 pm to 3 pm' },
    { text: 'Time: 14:00 to 15:00\nMeeting on 2 November 2026' },
    { title: 'Meeting on 2 November 2026', text: '14:00 to 15:00\nPlease attend.' }
  ]) {
    const result = announcements.extractSuggestions(post(fields))[0];
    assert.equal(result.suggestedStart, '2026-11-02T14:00:00+08:00');
    assert.equal(result.suggestedEnd, '2026-11-02T15:00:00+08:00');
  }
});

test('adjacent times are not borrowed through unrelated text, blank lines or competing times', () => {
  for (const text of [
    'Submit by 2 November 2026\nOffice hours at 14:00.',
    'Submit by 2 November 2026\n\n14:00',
    '14:00\nSubmit by 2 November 2026\n15:00',
    'Submit by 2 November 2026\nTime: 14:00\nMeeting on 3 November 2026'
  ]) assert.equal(announcements.extractSuggestions(post({ text }))[0].suggestedStart, '2026-11-02');
});

test('neutral undated notices are skipped while incomplete event details remain reviewable', () => {
  for (const text of ['Please read the handbook.', 'The updated materials are available.']) {
    assert.deepEqual(announcements.extractSuggestions(post({ text })), []);
  }
  for (const text of ['Submission deadline: Week 6.', 'Week 6', 'Meeting next week.', 'Submit by 2 Nov.', 'Date: 2 Nov.']) {
    const result = announcements.extractSuggestions(post({ text }));
    assert.equal(result.length, 1);
    assert.equal(result[0].suggestedStart, null);
    assert.equal(result[0].precision, 'unknown');
    assert.equal(result[0].status, undefined);
  }
});

test('clock boundaries, explicit duration and missing meeting end remain honest', () => {
  for (const [text, start, end] of [
    ['Meeting 2026-12-15 at 12 am to 1 am.', '2026-12-15T00:00:00+08:00', '2026-12-15T01:00:00+08:00'],
    ['Meeting 2026-12-15 at 12 pm for 90 minutes.', '2026-12-15T12:00:00+08:00', '2026-12-15T13:30:00+08:00'],
    ['Kelas 2026-12-15 23:30 selama 2 jam.', '2026-12-15T23:30:00+08:00', '2026-12-16T01:30:00+08:00']
  ]) {
    const result = announcements.extractSuggestions(post({ text }))[0];
    assert.equal(result.suggestedStart, start);
    assert.equal(result.suggestedEnd, end);
  }
  const result = announcements.extractSuggestions(post({ text: 'Meeting 2026-12-15 at 14:00.' }))[0];
  assert.equal(result.suggestedEnd, null);
  assert.equal(result.reason, 'unknown_end');
  const dateOnly = announcements.extractSuggestions(post({ text: 'Submit by 2026-12-15.' }))[0];
  assert.equal(dateOnly.suggestedEnd, null);
  assert.equal(dateOnly.precision, 'date');
});

test('unrelated times are not borrowed across sentences or paragraphs', () => {
  const result = announcements.extractSuggestions(post({
    text: 'Submit by 2026-12-15. Office hours at 14:00.\nMeeting 2026-12-16 at 10:00 to 11:00.'
  }));
  assert.equal(result.length, 2);
  assert.equal(result[0].suggestedStart, '2026-12-15');
  assert.equal(result[1].suggestedStart, '2026-12-16T10:00:00+08:00');
  const ambiguous = announcements.extractSuggestions(post({ text: 'Meeting on 2026-12-15 or 2026-12-16 at 14:00.' }))[0];
  assert.equal(ambiguous.reason, 'multiple_dates');
  assert.equal(ambiguous.suggestedStart, null);
  assert.equal(announcements.extractSuggestions(post({ text: 'Submit by 2026-12-15. 14:00 office hours.' }))[0].suggestedStart, '2026-12-15');
  assert.equal(announcements.extractSuggestions(post({ title: 'Assignment briefing', text: 'Meeting 2026-12-15 at 14:00.' }))[0].kind, 'meeting');
});

test('relative suggestions anchor only to the source publication day in Malaysia', () => {
  const tomorrow = announcements.extractSuggestions(post({ text: 'Meeting esok 14:00 to 15:00.', publishedAt: '2026-12-10T20:00:00Z' }))[0];
  assert.equal(tomorrow.suggestedStart, '2026-12-12T14:00:00+08:00');
  assert.equal(tomorrow.reason, 'relative');
  const weekday = announcements.extractSuggestions(post({ text: 'Meeting Friday 14:00 to 15:00.', publishedAt: '2026-12-10T09:00:00+08:00' }))[0];
  assert.equal(weekday.suggestedStart, '2026-12-11T14:00:00+08:00');
  assert.equal(weekday.reason, 'relative');
  assert.equal(announcements.extractSuggestions(post({ text: 'Submit tomorrow.', publishedAt: null }))[0].suggestedStart, null);
  assert.equal(announcements.extractSuggestions(post({ text: 'Submit tomorrow.', publishedAt: '2026-02-30T09:00:00+08:00' }))[0].suggestedStart, null);
});

test('meeting host checks reject executable links and deceptive suffixes', () => {
  const links = ['javascript:alert(1)', 'https://zoom.us.attacker.example/j/9', 'https://attackerzoom.us/j/9', 'http://meet.google.com/abc', 'https://zoom.us@attacker.example/j/9', 'https://teams.microsoft.com/l/meetup-join/123?context=abc'];
  const result = announcements.extractSuggestions(post({ text: 'Join online next week.', links }))[0];
  assert.equal(result.meetingUrl, links[5]);
  assert.equal(result.precision, 'unknown');
  assert.equal(result.reason, 'missing_date');
  assert.equal(announcements.extractSuggestions(post({ text: 'Join online next week.', links: links.slice(0, 5) }))[0].meetingUrl, null);
});

test('explicit cancellations remain review proposals and evidence stays bounded', () => {
  const result = announcements.extractSuggestions(post({ title: 'Meeting', text: 'Meeting on 2026-12-15 is cancelled. ' + 'x'.repeat(500) }))[0];
  assert.equal(result.cancellationSuggested, true);
  assert.equal(result.status, undefined);
  assert.ok(result.evidence.length <= 300);
  assert.equal(announcements.extractSuggestions(post({ text: 'Meeting on 2026-12-15. The meeting is cancelled.' }))[0].cancellationSuggested, true);
  assert.equal(announcements.extractSuggestions(post({ title: 'Meeting cancelled', text: 'Meeting on 2026-12-15.' }))[0].cancellationSuggested, true);
});

const candidate = (fields = {}) => ({
  candidateId: 'candidate-1', slotId: 'persisted-slot', sourceKey: 'announcement:123:5:9:persisted-slot',
  sourceRevision: 'rev2', acceptedRevision: 'rev1', state: 'stale', courseId: '123', postId: '9',
  sourceUrl: post().sourceUrl, title: 'Consultation', evidence: 'Meeting at 2 pm.', kind: 'meeting',
  suggestedStart: '2026-12-15T14:00:00+08:00', suggestedEnd: null, meetingUrl: null, ...fields
});

test('review of an old source revision cannot authorise current content', () => {
  assert.equal(announcements.validateReview(candidate(), {
    reviewedRevision: 'rev1', start: '2026-12-15T14:00:00+08:00', end: '2026-12-15T15:00:00+08:00'
  }).valid, false);
  assert.equal(announcements.validateReview(candidate(), {
    start: '2026-12-15T14:00:00+08:00', end: '2026-12-15T15:00:00+08:00'
  }).valid, false);
});

test('a current review produces a validated confirmed event using authoritative identity', () => {
  const result = announcements.validateReview(candidate(), {
    reviewedRevision: 'rev2', start: '2026-12-16T14:00:00+08:00', end: '2026-12-16T15:00:00+08:00',
    sourceKey: 'attacker-replacement', sourceUrl: 'https://attacker.example/', courseId: '999', status: 'cancelled'
  });
  assert.equal(result.valid, true, result.reasons.join('; '));
  assert.equal(result.event.sourceKey, 'announcement:123:5:9:persisted-slot');
  assert.equal(result.event.sourceUrl, post().sourceUrl);
  assert.equal(result.event.courseId, '123');
  assert.equal(result.event.sourceRevision, 'rev2');
  assert.equal(result.event.sourceType, 'announcement');
  assert.equal(result.event.status, 'confirmed');
  assert.equal(result.event.timeZone, 'Asia/Kuala_Lumpur');
});

test('review requires meeting end or duration but can confirm date-only and precise deadlines', () => {
  const fields = { reviewedRevision: 'rev2', start: '2026-12-15T14:00:00+08:00' };
  assert.equal(announcements.validateReview(candidate(), fields).valid, false);
  const duration = announcements.validateReview(candidate(), { ...fields, durationMinutes: 60 });
  assert.equal(duration.event.end, '2026-12-15T15:00:00+08:00');
  const date = announcements.validateReview(candidate({ kind: 'deadline' }), { reviewedRevision: 'rev2', start: '2026-12-31' });
  assert.equal(date.event.start, '2026-12-31');
  assert.equal(date.event.end, '2027-01-01');
  assert.equal(date.event.precision, 'date');
  const precise = announcements.validateReview(candidate({ kind: 'deadline' }), fields);
  assert.equal(precise.event.end, '2026-12-15T14:01:00+08:00');
  assert.match(precise.event.title, /^Due at:/);
});

test('review validates dates, URLs and bounded text at the trust boundary', () => {
  for (const fields of [
    { start: '2026-02-30T14:00:00+08:00' }, { start: '2026-12-15T14:00:00' },
    { end: '2026-12-15T13:00:00+08:00' }, { meetingUrl: 'javascript:alert(1)' }, { title: 'x'.repeat(501) }
  ]) {
    assert.equal(announcements.validateReview(candidate(), {
      reviewedRevision: 'rev2', start: '2026-12-15T14:00:00+08:00', end: '2026-12-15T15:00:00+08:00', ...fields
    }).valid, false);
  }
});
