const test = require('node:test');
const assert = require('node:assert/strict');
const ai = require('../shared/course-ai.js');
require('../shared/planner-core.js');

// KIG2012 as Spectrum shows it to an OCC 3 student (Nov 2026).
const activities = [
  { id: '11', type: 'url', name: 'Online class G1, G1M', section: 'General', lock: '' },
  { id: '12', type: 'attendance', name: 'Attendance_G1', section: 'General', lock: 'Not available unless: You belong to GROUP 1 2026/2027_1' },
  { id: '13', type: 'attendance', name: 'Attendance (Occ3)_2026/2027.S1', section: 'General', lock: '' },
  { id: '14', type: 'resource', name: 'Tutorial 5', section: 'AP DR MUMTAZ\'S SECTION', lock: '' },
  { id: '15', type: 'resource', name: 'DC Lab Sheets', section: 'General', lock: '' }
];

test('an AI answer that agrees with Spectrum\'s locks and labels is used; one that contradicts them is thrown away', () => {
  const good = { activities: { 11: { occ: ['1', '1M'] }, 12: { occ: ['1'] } }, sections: { 'AP DR MUMTAZ\'S SECTION': { occ: ['4', '7'] } } };
  assert.equal(ai.checkLayout(good, activities).ok, true);
  assert.deepEqual(ai.occFor(good, activities[0]), ['1', '1M'], 'G1, G1M read as OCC 1 and 1M');
  assert.deepEqual(ai.occFor(good, activities[2]), ['3'], 'a title that names its OCC wins over the AI');
  assert.deepEqual(ai.occFor(good, activities[3]), ['4', '7'], 'a lecturer section takes the OCCs the AI matched to it');
  assert.equal(ai.occFor(good, activities[4]), null, 'everything else stays for everyone');
  const lockClash = { activities: { 12: { occ: ['2'] } } };
  assert.equal(ai.checkLayout(lockClash, activities).ok, false, 'the lock says GROUP 1, so OCC 2 is wrong');
  const titleClash = { activities: { 13: { occ: ['5'] } } };
  assert.equal(ai.checkLayout(titleClash, activities).ok, false, 'the title says Occ3');
  assert.equal(ai.checkLayout({ activities: { 99: { occ: ['1'] } } }, activities).ok, false, 'unknown activities are rejected');
});

test('the background asks the AI only after the student turns it on, keeps checked answers and reuses them', async t => {
  const store = {};
  const previous = { chrome: global.chrome, fetch: global.fetch };
  t.after(() => { global.chrome = previous.chrome; global.fetch = previous.fetch; });
  global.chrome = {
    runtime: { id: 'ext', getURL: path => 'chrome-extension://ext/' + (path || '') },
    storage: { local: { get: async keys => Object.fromEntries([].concat(keys).map(k => [k, structuredClone(store[k])])), set: async value => Object.assign(store, structuredClone(value)) } },
    action: {}, alarms: { clearAll: async () => {}, create: () => {} }
  };
  let calls = 0;
  global.fetch = async (url, options) => {
    calls++;
    assert.equal(url, ai.BACKEND);
    const body = JSON.parse(options.body);
    assert.equal(body.courseId, '25559');
    assert.equal(JSON.stringify(body).includes('occ'), false, 'the student\'s OCC is not sent');
    return Response.json({ activities: { 11: { occ: ['1', '1M'] } }, sections: {}, groupStyle: 'G1 = OCC 1' });
  };
  delete require.cache[require.resolve('../background/planner.js')];
  const planner = require('../background/planner.js');
  const sender = { id: 'ext', url: 'https://spectrum.um.edu.my/course/view.php?id=25559', tab: { id: 3 } };
  const ask = extra => planner.handle({ type: 'PLANNER_COURSE_AI', courseId: '25559', courseCode: 'KIG2012', activities, ...extra }, sender);
  assert.deepEqual(await ask(), { enabled: false });
  assert.equal(calls, 0, 'nothing is sent before the student agrees');
  const first = await ask({ enable: true });
  assert.deepEqual(first.layout.activities[11].occ, ['1', '1M']);
  assert.equal(store.umspecPlannerPrefs.courseAI, true);
  await ask();
  assert.equal(calls, 1, 'the same course page is answered from this device');
  assert.deepEqual(await ask({ enable: false }), { enabled: false });
  assert.deepEqual(store.umspecCourseAI, {}, 'turning it off removes saved answers');
});
