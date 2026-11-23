const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../shared/planner-core.js');

// Synthetic examples shaped like Spectrum attendance and calendar data; not captured live fixtures.
const myt = (y, m, d, h = 0, min = 0) => Date.UTC(y, m - 1, d, h - 8, min);

test('OCC lists, ranges and Malay wording are parsed; unrelated words are not', () => {
  assert.deepEqual(C.parseOcc('Attendance for Lecture (OCC 3, 4, 5, 6, 7)'), ['3', '4', '5', '6', '7']);
  assert.deepEqual(C.parseOcc('Attendance OCC 1, 2, 1M Lecture'), ['1', '2', '1M']);
  assert.deepEqual(C.parseOcc('Attendance (Occ5)'), ['5']);
  assert.deepEqual(C.parseOcc('OCC 3, 4, 5, 6, and 7'), ['3', '4', '5', '6', '7']);
  assert.deepEqual(C.parseOcc('Tutorial OCC 3-5'), ['3', '4', '5']);
  assert.deepEqual(C.parseOcc('Kumpulan 2 dan 4'), ['2', '4']);
  assert.equal(C.parseOcc('Occasionally 3 students'), null);
  assert.equal(C.parseOcc('WIX2001 Thinking Skills'), null);
});

test('OCC filtering keeps untagged items and items that include the student OCC', () => {
  assert.equal(C.occMatches('Attendance for Tutorial (OCC 3)', '3'), true);
  assert.equal(C.occMatches('Attendance for Tutorial (OCC 4)', '3'), false);
  assert.equal(C.occMatches('Week 1 slides', '3'), true);
  assert.equal(C.occMatches('Attendance for Tutorial (OCC 4)', null), true);
  assert.equal(C.occMatches(['1M', '2'], '1m'), true);
});

test('OCC detection prefers groups, then attended sessions, and refuses ties', () => {
  assert.deepEqual(C.detectOcc({ groups: ['OCC 4'] }), { occ: '4', source: 'group' });
  const sessions = [
    { statusKind: 'present', occ: ['3', '4', '5', '6', '7'] },
    { statusKind: 'present', occ: ['3'] },
    { statusKind: 'absent', occ: ['4'] }
  ];
  assert.deepEqual(C.detectOcc({ groups: ['Year 2'], sessions }), { occ: '3', source: 'attendance' });
  assert.equal(C.detectOcc({ sessions: [{ statusKind: 'present', occ: ['1', '2'] }] }), null);
  assert.equal(C.detectOcc({ sessions: [{ statusKind: 'unmarked', occ: ['8'] }] }), null);
});

test('attendance dates and times parse in Malaysia time across Moodle formats', () => {
  const at = text => { const r = C.parseSessionTime(text); return r && [r.start, r.end, r.allDay]; };
  assert.deepEqual(at('Thu 5 Nov 2026 11AM - 12PM'), [myt(2026, 11, 5, 11), myt(2026, 11, 5, 12), false]);
  assert.deepEqual(at('Thu 05 Nov 2026 11.00AM - 12.00PM'), [myt(2026, 11, 5, 11), myt(2026, 11, 5, 12), false]);
  assert.deepEqual(at('Khamis 5 Nov 2026 2:00 PM - 4:00 PM'), [myt(2026, 11, 5, 14), myt(2026, 11, 5, 16), false]);
  assert.deepEqual(at('5/11/26 14:00 - 16:00'), [myt(2026, 11, 5, 14), myt(2026, 11, 5, 16), false]);
  assert.deepEqual(at('Isn 2 Dis 2026 11 - 1PM'), [myt(2026, 12, 2, 11), myt(2026, 12, 2, 13), false]);
  assert.deepEqual(at('Thu 5 Nov 2026'), [myt(2026, 11, 5), myt(2026, 11, 6), true]);
  assert.equal(C.parseSessionTime('No date here'), null);
  assert.equal(C.parseTimeRange('2026 - 2027'), null);
});

test('attendance rows become sessions with status, self check-in, type and OCC', () => {
  const rows = C.parseAttendanceRows({
    headers: ['Date', 'Description', 'Status', 'Points', 'Remarks'],
    rows: [
      { cells: ['Tue 3 Nov 2026 4PM - 6PM', 'Regular class session', 'Present', '2 / 2', ''] },
      { cells: ['Thu 5 Nov 2026 11AM - 12PM', 'Regular class session', 'Submit attendance', '? / 2', ''], selfMark: true },
      { cells: ['Thu 12 Nov 2026 11AM - 12PM', 'Regular class session', '?', '? / 2', ''] },
      { cells: ['Summary row without a date', '', '', '', ''] }
    ]
  }, { cmid: '77', courseId: '129', name: 'Attendance for Tutorial (OCC 3)' });
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(r => r.statusKind), ['present', 'open', 'unmarked']);
  assert.equal(rows[1].canSelfMark, true);
  assert.equal(rows[0].type, 'TUT');
  assert.deepEqual(rows[0].occ, ['3']);
  assert.equal(rows[0].url, 'https://spectrum.um.edu.my/mod/attendance/view.php?id=77');
  assert.equal(C.parseAttendanceRows({ headers: ['Name', 'Grade'], rows: [] }, { cmid: '1', courseId: '1', name: 'x' }).length, 0);
  assert.equal(C.statusKind('Tidak hadir'), 'absent');
  assert.equal(C.statusKind('Hadir'), 'present');
  assert.equal(C.statusKind('Lewat'), 'late');
});

test('calendar events are classified and submission status follows outstanding action events', () => {
  const now = myt(2026, 11, 4, 12);
  const raw = (fields) => ({ id: 10, name: 'Tutorial 4 (OCC4) is due', modulename: 'assign', instance: 55, eventtype: 'due', timestart: Math.floor(myt(2026, 11, 3, 18) / 1000), timeduration: 0,
    course: { id: 129 }, url: 'https://spectrum.um.edu.my/mod/assign/view.php?id=900&sesskey=secret', ...fields });
  const outstanding = C.outstandingFromActionEvents([{ modulename: 'assign', instance: 55, action: { actionable: true } }]);
  const overdue = C.classifyEvent(raw(), outstanding);
  assert.equal(overdue.kind, 'assignment');
  assert.equal(overdue.status, 'todo');
  assert.equal(C.itemState(overdue, now), 'overdue');
  assert.equal(overdue.url.includes('sesskey'), false);
  assert.deepEqual(overdue.occ, ['4']);
  const submitted = C.classifyEvent(raw({ instance: 56 }), outstanding);
  assert.equal(C.itemState(submitted, now), 'done');
  assert.equal(C.classifyEvent(raw(), null).status, 'unknown');
  assert.equal(C.classifyEvent(raw({ eventtype: 'gradingdue' }), outstanding), null);
  assert.equal(C.classifyEvent(raw({ modulename: undefined, eventtype: 'course', name: 'Mid-term briefing' }), outstanding).kind, 'notice');
  assert.equal(C.classifyEvent(raw({ id: 'x' }), outstanding), null);
});

test('course names give a code, readable name and short label', () => {
  const db = C.courseMeta({ id: 129, fullName: 'WIA2001/WIB2001 DATABASE', shortName: 'WIA2001' });
  assert.equal(db.code, 'WIA2001'); assert.equal(db.name, 'Database');
  const ps = C.courseMeta({ id: 2, fullName: 'WIA2003/WIB2003 PROBABILITY AND STATISTICS', shortName: 'WIA2003' });
  assert.equal(ps.abbrev, 'PS'); assert.equal(ps.name, 'Probability And Statistics');
  assert.equal(C.courseMeta({ id: 3, fullName: 'WIX2001 Thinking and Communication Skills', shortName: 'WIX2001' }).abbrev, 'TCS');
});

test('course materials keep only learning resources with file types from icons or extensions', () => {
  const list = C.normaliseMaterials([
    { cmid: '1', modtype: 'resource', name: 'Normalization - Updated 2026', url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=1', section: 'Week 4', icon: 'https://spectrum.um.edu.my/theme/image.php/x/core/1/f/powerpoint' },
    { cmid: '2', modtype: 'resource', name: 'Tutorial 3', url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=2', section: 'Week 4', icon: '/f/pdf-24' },
    { cmid: '3', modtype: 'url', name: 'Lecture recording', url: 'https://www.youtube.com/watch?v=x', section: 'Week 4' },
    { cmid: '4', modtype: 'assign', name: 'Tutorial 4 submission', url: 'https://spectrum.um.edu.my/mod/assign/view.php?id=4' },
    { cmid: '5', modtype: 'resource', name: 'Bad link', url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=5&token=abc' },
    { cmid: '1', modtype: 'resource', name: 'Duplicate', url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=1' }
  ], '129');
  assert.deepEqual(list.map(m => [m.cmid, m.type]), [['1', 'pptx'], ['2', 'pdf'], ['3', 'video']]);
  assert.equal(C.newsForum([{ modtype: 'forum', cmid: '9', name: 'Announcements' }]), 'https://spectrum.um.edu.my/mod/forum/view.php?id=9');
  assert.equal(C.newsForum([{ modtype: 'forum', cmid: '9', name: 'Group discussion' }]), null);
});

function sampleData(now) {
  const courses = [{ id: '129', fullName: 'WIA2001/WIB2001 DATABASE', shortName: 'WIA2001' }, { id: '5372', fullName: 'WIA2003 PROBABILITY AND STATISTICS', shortName: 'WIA2003' }];
  const items = [];
  for (let week = -3; week <= 3; week++) {
    const start = C.startOfWeek(now) + week * 7 * C.DAY + 1 * C.DAY + 11 * 3600000;
    items.push({ key: 'att:1:' + start, kind: 'attendance', courseId: '129', title: 'Attendance for Tutorial (OCC 4)', start, end: start + 3600000,
      url: 'https://spectrum.um.edu.my/mod/attendance/view.php?id=1', statusKind: week < 0 ? 'present' : 'unmarked', sessionType: 'TUT', occ: ['4'] });
    items.push({ key: 'att:2:' + start, kind: 'attendance', courseId: '129', title: 'Attendance for Tutorial (OCC 3)', start, end: start + 3600000,
      url: 'https://spectrum.um.edu.my/mod/attendance/view.php?id=2', statusKind: 'unmarked', sessionType: 'TUT', occ: ['3'] });
  }
  items.push({ key: 'cal:1', kind: 'assignment', courseId: '129', title: 'Tutorial 5', start: now + 20 * 3600000, end: null, url: 'https://spectrum.um.edu.my/mod/assign/view.php?id=9', status: 'todo', occ: null });
  items.push({ key: 'cal:2', kind: 'quiz', courseId: '5372', title: 'Quiz 2', start: now - 2 * C.DAY, end: null, url: 'https://spectrum.um.edu.my/mod/quiz/view.php?id=8', status: 'todo', occ: null });
  items.push({ key: 'cal:3', kind: 'assignment', courseId: '5372', title: 'Report', start: now + 5 * C.DAY, end: null, url: 'https://spectrum.um.edu.my/mod/assign/view.php?id=7', status: 'done', occ: null });
  return C.sanitizePlannerData({ collectedAt: now, courses, items, materials: [], detectedOcc: { 129: { occ: '4', source: 'attendance' } }, statusKnown: true }, now);
}

test('stored planner data is validated, bounded and stripped of secrets', () => {
  const now = myt(2026, 11, 4, 12);
  const clean = C.sanitizePlannerData({ collectedAt: now, courses: [{ id: '129', fullName: 'WIA2001 DATABASE' }, { id: '../x' }],
    items: [{ key: 'a', kind: 'assignment', courseId: '129', title: 'T', start: now, url: 'https://spectrum.um.edu.my/mod/assign/view.php?id=1&sesskey=s' },
      { key: 'b', kind: 'assignment', courseId: '129', title: 'T', start: now, url: 'javascript:alert(1)' },
      { key: 'c', kind: 'virus', courseId: '129', title: 'T', start: now, url: 'https://spectrum.um.edu.my/' },
      { key: 'd', kind: 'notice', courseId: '999', title: 'T', start: now + 900 * C.DAY, url: 'https://spectrum.um.edu.my/' }],
    detectedOcc: { 129: { occ: '<b>' }, 999: { occ: '3' } } }, now);
  assert.equal(clean.courses.length, 1);
  assert.deepEqual(clean.items.map(i => i.key), ['a']);
  assert.equal(clean.items[0].url, 'https://spectrum.um.edu.my/mod/assign/view.php?id=1');
  assert.deepEqual(clean.detectedOcc, {});
  assert.throws(() => C.sanitizePlannerData(null));
});

test('timetable groups weekly sessions for the student OCC and exports CSV and ICS', () => {
  const now = myt(2026, 11, 4, 12);
  const data = sampleData(now);
  const visible = C.visibleItems(data, { occ: {} });
  assert.equal(visible.filter(i => i.kind === 'attendance').length, 7);
  assert.equal(C.visibleItems(data, { showAllOcc: true }).filter(i => i.kind === 'attendance').length, 14);
  assert.equal(C.visibleItems(data, { occ: { 129: '3' } }).filter(i => i.kind === 'attendance' && i.occ[0] === '3').length, 7);
  const slots = C.buildTimetable(visible, now);
  assert.equal(slots.length, 1);
  assert.deepEqual([slots[0].weekday, slots[0].start, slots[0].end, slots[0].type, slots[0].count], [1, 660, 720, 'TUT', 7]);
  const csv = C.timetableCSV(slots, data.courses);
  assert.match(csv, /^Day,Start,End,Code,Course,Type,OCC,Sessions\r\nTuesday,11:00,12:00,WIA2001,Database,TUT,4,7\r\n$/);
  assert.equal(C.timetableCSV([{ ...slots[0], title: '=cmd()' }], []).includes("'=cmd()"), true);
  const ics = C.sessionsICS(visible, data.courses, now);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 7);
  assert.ok(ics.split('\r\n').every(line => Buffer.byteLength(line) <= 75));
  assert.equal(C.semesterWeek(data.items, now), 4);
});

test('reminders cover open deadlines and upcoming classes only, and only when enabled', () => {
  const now = myt(2026, 11, 4, 12);
  const data = sampleData(now);
  assert.deepEqual(C.reminderPlan(data, {}, now), []);
  const plan = C.reminderPlan(data, { reminders: { enabled: true, deadlineLeads: [1440, 60], classLead: 10 } }, now);
  const deadline = plan.filter(p => p.kind === 'assignment');
  assert.deepEqual(deadline.map(p => p.lead), [60]);
  assert.ok(plan.some(p => p.kind === 'attendance'));
  assert.ok(plan.every(p => p.when > now));
  assert.equal(plan.some(p => p.title.includes('Report')), false);
  assert.equal(C.dueSoonCount(data, {}, now), 2);
});

test('every interface string has Malay and Chinese text', () => {
  for (const key of Object.keys(C.STRINGS.en)) {
    assert.ok(key in C.STRINGS.ms, 'ms missing ' + key);
    assert.ok(key in C.STRINGS.zh, 'zh missing ' + key);
  }
  assert.equal(C.t('xx', 'refresh'), 'Refresh');
});

test('planner worker accepts only extension senders and resets OCC choices when the account changes', async () => {
  const store = {};
  const alarms = new Map();
  global.chrome = {
    runtime: { id: 'ext', getURL: path => 'chrome-extension://ext/' + path },
    storage: { local: { get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(k => k in store).map(k => [k, structuredClone(store[k])])),
      set: async values => Object.assign(store, structuredClone(values)) } },
    alarms: { getAll: async () => [...alarms.keys()].map(name => ({ name })), clear: async name => alarms.delete(name), create: async (name, info) => alarms.set(name, info) },
    action: { setBadgeText: async ({ text }) => { store.badge = text; }, setBadgeBackgroundColor: async () => {} }
  };
  delete require.cache[require.resolve('../background/planner.js')];
  const worker = require('../background/planner.js');
  const page = { id: 'ext', url: 'chrome-extension://ext/dashboard/dashboard.html' };
  const content = { id: 'ext', url: 'https://spectrum.um.edu.my/course/view.php?id=129', tab: { id: 4 } };
  await assert.rejects(worker.handle({ type: 'PLANNER_META' }, { id: 'other', url: page.url }), /Unknown planner sender/);
  await assert.rejects(worker.handle({ type: 'PLANNER_META' }, { id: 'ext', url: 'https://evil.example/' }), /Unknown planner sender/);
  const now = Date.now();
  const data = { ...sampleData(now), userHash: 'a' };
  await worker.handle({ type: 'PLANNER_SAVE', data }, content);
  assert.equal(store.umspecPlanner.items.length, data.items.length);
  await worker.handle({ type: 'PLANNER_SET_OCC', courseId: '129', occ: '3' }, content);
  assert.equal(store.umspecPlannerPrefs.occ['129'], '3');
  await assert.rejects(worker.handle({ type: 'PLANNER_SET_OCC', courseId: '129', occ: '<x>' }, content));
  await assert.rejects(worker.handle({ type: 'PLANNER_SET_OCC', courseId: '129', occ: '3' }, page), /Unsupported/);
  store.umspecPlannerPrefs.reminders = { enabled: true, deadlineLeads: [60], classLead: 10 };
  await worker.handle({ type: 'PLANNER_SAVE', data: { ...data, userHash: 'b' } }, content);
  assert.deepEqual(store.umspecPlannerPrefs.occ, {});
  assert.ok([...alarms.keys()].some(name => name.startsWith('umspec-r:')));
  assert.match(worker.reminderText({ kind: 'assignment', lead: 60, due: now }, 'ms'), /Tugasan · Tamat dalam 1j/);
  const meta = await worker.handle({ type: 'PLANNER_META' }, content);
  assert.equal(meta.collectedAt, data.collectedAt);

  // Unsetting an auto-detected OCC keeps it disabled instead of falling back to detectedOcc.
  await worker.handle({ type: 'PLANNER_SET_OCC', courseId: '129', occ: '' }, content);
  assert.equal(store.umspecPlannerPrefs.occ['129'], '');
  assert.equal(C.effectiveOcc(store.umspecPlanner, store.umspecPlannerPrefs, '129'), null);
  assert.equal(C.visibleItems(store.umspecPlanner, store.umspecPlannerPrefs).filter(i => i.kind === 'attendance').length, 14);
  await worker.handle({ type: 'PLANNER_SET_OCC', courseId: '129', resetAuto: true }, content);
  assert.equal(Object.hasOwn(store.umspecPlannerPrefs.occ, '129'), false);
  assert.equal(C.effectiveOcc(store.umspecPlanner, store.umspecPlannerPrefs, '129'), '4');

  // Clearing planner data and rescheduling removes reminder alarms, badge alarm and toolbar badge.
  delete store.umspecPlanner;
  await worker.handle({ type: 'PLANNER_RESCHEDULE' }, page);
  assert.equal([...alarms.keys()].some(name => name.startsWith('umspec-r:')), false);
  assert.equal(alarms.has('umspec-badge'), false);
  assert.equal(store.badge, '');
  assert.deepEqual(store.umspecPlannerReminders, {});
  delete global.chrome;
});

test('uniquePath deduplicates filenames case-insensitively while preserving extensions', () => {
  const used = new Set();
  assert.equal(C.uniquePath(used, 'WIA2001/Week 1', 'Lecture.pdf'), 'WIA2001/Week 1/Lecture.pdf');
  assert.equal(C.uniquePath(used, 'WIA2001/Week 1', 'lecture.pdf'), 'WIA2001/Week 1/lecture (2).pdf');
  assert.equal(C.uniquePath(used, 'WIA2001/Week 1', 'Lecture.pdf'), 'WIA2001/Week 1/Lecture (3).pdf');
  assert.equal(C.uniquePath(used, '', 'README'), 'README');
  assert.equal(C.uniquePath(used, '', 'README'), 'README (2)');
});

test('layoutDaySlots places overlapping timetable blocks into non-colliding lanes', () => {
  const slots = [
    { id: 'A', start: 540, end: 720 }, // 09:00 - 12:00
    { id: 'B', start: 540, end: 600 }, // 09:00 - 10:00
    { id: 'C', start: 660, end: 720 }, // 11:00 - 12:00 (reuses B's lane)
    { id: 'D', start: 840, end: 900 }  // 14:00 - 15:00 (separate cluster)
  ];
  const layout = Object.fromEntries(C.layoutDaySlots(slots).map(x => [x.slot.id, { lane: x.lane, lanes: x.lanes }]));
  assert.deepEqual(layout.A, { lane: 0, lanes: 2 });
  assert.deepEqual(layout.B, { lane: 1, lanes: 2 });
  assert.deepEqual(layout.C, { lane: 1, lanes: 2 });
  assert.deepEqual(layout.D, { lane: 0, lanes: 1 });
});

test('folderFiles extracts all Moodle folder files and ignores avatars/theme links', () => {
  const collect = require('../shared/planner-collect.js');
  const fakeLink = (href, label) => ({ getAttribute: attr => (attr === 'href' ? href : null), textContent: label });
  const links = [
    fakeLink('https://spectrum.um.edu.my/pluginfile.php/10/user/icon/f1', 'Avatar'),
    fakeLink('https://spectrum.um.edu.my/pluginfile.php/10/mod_folder/content/0/Week1_Slides.pdf?forcedownload=1', 'Week1_Slides.pdf'),
    fakeLink('https://spectrum.um.edu.my/pluginfile.php/10/mod_folder/content/0/Week1_Slides.pdf', 'Week1_Slides.pdf'),
    fakeLink('https://spectrum.um.edu.my/pluginfile.php/10/mod_folder/content/0/Lab%20Sheet%201.docx?forcedownload=1', 'Lab Sheet 1.docx'),
    fakeLink('https://evil.example/pluginfile.php/10/mod_folder/content/0/evil.pdf', 'Evil')
  ];
  const scope = { querySelectorAll: () => links };
  const doc = { querySelector: () => scope };
  const files = collect.folderFiles(doc, 'https://spectrum.um.edu.my/mod/folder/view.php?id=99');
  assert.deepEqual(files, [
    { url: 'https://spectrum.um.edu.my/pluginfile.php/10/mod_folder/content/0/Week1_Slides.pdf', name: 'Week1_Slides.pdf' },
    { url: 'https://spectrum.um.edu.my/pluginfile.php/10/mod_folder/content/0/Lab%20Sheet%201.docx', name: 'Lab Sheet 1.docx' }
  ]);
});

// Shapes below follow names and fields seen on the live Spectrum calendar (Nov 2026); values are synthetic.
test('live Spectrum attendance names, Turnitin deadlines and not-yet-open submissions classify correctly', () => {
  const t = Math.floor(Date.UTC(2026, 10, 30, 15, 59) / 1000);
  const turnitin = C.classifyEvent({ id: 1271175, name: 'FINAL SUBMISSION #1 (November)', modulename: 'turnitintooltwo', instance: 1007088, eventtype: 'due', timestart: t, timeduration: 0,
    course: { id: 26842 }, action: { name: 'Add Submission', actionable: true } }, new Set());
  assert.equal(turnitin.kind, 'assignment'); assert.equal(turnitin.status, 'todo');
  const later = C.outstandingFromActionEvents([{ modulename: 'assign', instance: 1150762, action: { name: 'Add submission', actionable: false } }]);
  assert.equal(C.classifyEvent({ id: 9, name: 'Final report is due', modulename: 'assign', instance: 1150762, eventtype: 'due', timestart: t, timeduration: 0, course: { id: 5372 } }, later).status, 'todo');
  const opens = C.classifyEvent({ id: 1272390, name: 'QUIZ: Barriers to Communication opens', modulename: 'quiz', instance: 1146671, eventtype: 'open', timestart: t - 30 * 86400, timeduration: 0,
    course: { id: 141 }, action: { name: 'Attempt quiz now' } }, new Set());
  assert.equal(opens.opensOnly, true); assert.equal(C.itemState(opens, t * 1000), 'todo');
  assert.equal(C.classifyEvent({ id: 3, name: 'Quiz opens', modulename: 'quiz', instance: 4, eventtype: 'open', timestart: t, timeduration: 0, course: { id: 141 } }, new Set()), null);
  assert.deepEqual(C.parseOcc('Attendance Lecture Group 2 (OCC3-OCC5-OCC8-OCC9)'), ['3', '5', '8', '9']);
  assert.deepEqual(C.parseOcc('Attendance (OCC4) (Group GROUP 4 2026/2027_1)'), ['4']);
  assert.deepEqual(C.parseOcc('Attendance Tutorial Occurrence 2'), ['2']);
  assert.equal(C.parseOcc('Lecture Attendance-DK1, Thursday, 4-6pm'), null);
  assert.deepEqual(C.sanitizePlannerData({ courses: [{ id: 1, fullName: 'Turnitin Course Submission', shortName: 'TCS00' }, { id: 2, fullName: 'WIX2001 THINKING AND COMMUNICATION SKILLS' }] }).courses.map(c => c.abbrev), ['TCS00', 'TCS']);
  assert.deepEqual(C.newsForums([{ modtype: 'forum', cmid: '304', name: 'Announcements' }, { modtype: 'forum', cmid: '1128997', name: 'Announcement from Dr. Tarak Nandy' }, { modtype: 'forum', cmid: '5', name: 'Company Website' }]),
    ['https://spectrum.um.edu.my/mod/forum/view.php?id=304', 'https://spectrum.um.edu.my/mod/forum/view.php?id=1128997']);
});

test('quick refresh finds attendance activities in the calendar and reads only the student OCC', () => {
  const event = (cmid, name) => ({ kind: 'attendance', courseId: '5372', title: name, url: 'https://spectrum.um.edu.my/mod/attendance/view.php?id=' + cmid });
  const items = [event(1126547, 'Attendance for Lecture (OCC 3, 4, 5, 6, 7)'), event(1128975, 'Attendance for Tutorial (OCC 3)'), event(1128975, 'Attendance for Tutorial (OCC 3)'),
    event(1128899, 'Attendance (Occ5)'), event(1072792, 'Attendance OCC 2 (Group GROUP 2 2026/2027_1)'), { ...event(1, 'x'), courseId: '129' }];
  const found = C.attendanceFromCalendar(items, '5372');
  assert.deepEqual(found.map(a => a.cmid), ['1126547', '1128975', '1128899', '1072792']);
  assert.equal(found[3].name, 'Attendance OCC 2');
  assert.deepEqual(C.attendanceToRead(found, '3').map(a => a.cmid), ['1126547', '1128975']);
  assert.equal(C.attendanceToRead(found, null).length, 4);
  assert.equal(C.cmidFromUrl('https://spectrum.um.edu.my/mod/attendance/view.php?id=1128975'), '1128975');
});

test('a quick save keeps files and announcements from the last full pass for the same account only', async () => {
  const store = {};
  global.chrome = {
    runtime: { id: 'ext', getURL: path => 'chrome-extension://ext/' + path },
    storage: { local: { get: async keys => Object.fromEntries([].concat(keys).filter(k => k in store).map(k => [k, structuredClone(store[k])])), set: async v => Object.assign(store, structuredClone(v)) } },
    alarms: { getAll: async () => [], clear: async () => {}, create: async () => {} },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} }
  };
  delete require.cache[require.resolve('../background/planner.js')];
  const worker = require('../background/planner.js');
  const content = { id: 'ext', url: 'https://spectrum.um.edu.my/my/', tab: { id: 1 } };
  const now = Date.now();
  const base = { userHash: 'a', courses: [{ id: '129', fullName: 'WIA2001 DATABASE' }] };
  const news = { key: 'news:1', kind: 'notice', courseId: '129', title: 'Mid Term Test', start: now - 3600000, url: 'https://spectrum.um.edu.my/mod/forum/discuss.php?d=1' };
  const material = { courseId: '129', cmid: '5', name: 'Slides', section: 'Week 1', type: 'pdf', url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=5' };
  await worker.handle({ type: 'PLANNER_SAVE', data: { ...base, collectedAt: now - 7 * 3600000, fullAt: now - 7 * 3600000, items: [news], materials: [material], detectedOcc: { 129: { occ: '4', source: 'attendance' } } } }, content);
  await worker.handle({ type: 'PLANNER_SAVE', data: { ...base, collectedAt: now, items: [], materials: [], detectedOcc: {} } }, content);
  assert.equal(store.umspecPlanner.materials.length, 1);
  assert.deepEqual(store.umspecPlanner.items.map(i => i.key), ['news:1']);
  assert.equal(store.umspecPlanner.detectedOcc['129'].occ, '4');
  assert.equal(store.umspecPlanner.fullAt, now - 7 * 3600000);
  assert.equal((await worker.handle({ type: 'PLANNER_META' }, content)).fullAt, now - 7 * 3600000);
  await worker.handle({ type: 'PLANNER_SAVE', data: { ...base, userHash: 'b', collectedAt: now, items: [], materials: [] } }, content);
  assert.equal(store.umspecPlanner.materials.length, 0);
  assert.equal(store.umspecPlanner.items.length, 0);
  delete global.chrome;
});

// Mirrors the live WIA2001 course page (Nov 2026): every OCC has its own attendance activity, locked to that OCC's group.
test('locked OCC activities are skipped and the one open OCC activity identifies the student', () => {
  const activities = [
    { modtype: 'attendance', cmid: '894047', name: 'Attendance Lecture DK1', restricted: true },
    { modtype: 'attendance', cmid: '894051', name: 'Attendance Lecture DK2', restricted: false },
    { modtype: 'attendance', cmid: '1130605', name: 'Tutorial Attendance (OCC7)', restricted: true },
    { modtype: 'attendance', cmid: '1130610', name: 'Tutorial Attendance (OCC4)', restricted: false },
    { modtype: 'attendance', cmid: '1126804', name: 'Tutorial Attendance (OCC 3), Thursday 10am - 11am', restricted: true },
    { modtype: 'resource', cmid: '5', name: 'OCC7 slides', url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=5', restricted: true }
  ];
  assert.deepEqual(C.attendanceActivities(activities, '129').map(a => a.cmid), ['894051', '1130610']);
  assert.equal(C.occFromAccess(activities), '4');
  assert.equal(C.occFromAccess(activities.map(a => ({ ...a, restricted: false }))), null);
  assert.deepEqual(C.detectOcc({ sessions: [], activities }), { occ: '4', source: 'attendance' });
  // Attended sessions still win over access when both exist.
  assert.deepEqual(C.detectOcc({ sessions: [{ statusKind: 'present', occ: ['4'] }], activities }).occ, '4');
  assert.equal(C.normaliseMaterials(activities, '129').length, 0);
  assert.equal(C.sanitizePlannerData({ courses: [] }).version, C.DATA_VERSION);
});

test('OCC labels and announcement forums are recognised in the forms lecturers actually write', () => {
  assert.deepEqual(C.parseOcc('Announcement for OCC-6 , OCC-8 and OCC-9'), ['6', '8', '9']);
  assert.deepEqual(C.parseOcc('Lecture Group 1 (OCCs 1, 2, 4, 6, 7, 10)'), ['1', '2', '4', '6', '7', '10']);
  assert.deepEqual(C.parseOcc('Important Announcement for OCC-3 (18-11-2025)'), ['3']);
  assert.deepEqual(C.parseOcc('Tutorial Kump. 2'), ['2']);
  assert.equal(C.parseOcc('Group 3 presentation slides'), null, 'project group numbers are not OCCs');
  assert.equal(C.parseOcc('Occasionally 3 students'), null);
  const forums = C.newsForumEntries([
    { modtype: 'forum', cmid: '1', name: 'Announcements' },
    { modtype: 'forum', cmid: '2', name: 'Important Announcement for OCC-3 (18-11-2025)' },
    { modtype: 'forum', cmid: '3', name: 'Makluman Kursus' },
    { modtype: 'forum', cmid: '4', name: 'Group Project: System Testing Planning' },
    { modtype: 'forum', cmid: '5', name: 'Company Website' }
  ]);
  assert.deepEqual(forums.map(forum => forum.url.split('=')[1]), ['1', '2', '3']);
  assert.deepEqual(forums[1].occ, ['3']);
  const [post] = C.announcementItems([{ id: 9, title: 'Class moved to Friday' }], '7', 0, ['3']);
  assert.deepEqual(post.occ, ['3'], 'a post without its own OCC label takes its forum\'s OCC');
  assert.equal(C.occMatches(post.occ, '4'), false);
});
