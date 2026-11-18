/* Visual-check stand-in for Chrome extension APIs with synthetic planner data. Not shipped (tests/ is excluded from releases). */
(() => {
  const C = globalThis.UmSpecPlannerCore;
  const now = Date.now(), week = C.startOfWeek(now), H = 3600000, D = C.DAY;
  const courses = [
    { id: '129', fullName: 'WIA2001/WIB2001 DATABASE', shortName: 'WIA2001' },
    { id: '5372', fullName: 'WIA2003/WIB2003 PROBABILITY AND STATISTICS', shortName: 'WIA2003' },
    { id: '201', fullName: 'WIA2006 SYSTEMS ANALYSIS AND DESIGN', shortName: 'WIA2006' },
    { id: '202', fullName: 'WIA2007/WIX3004 MOBILE APPLICATION DEVELOPMENT', shortName: 'WIA2007' },
    { id: '203', fullName: 'WIX2001 THINKING AND COMMUNICATION SKILLS', shortName: 'WIX2001' },
    { id: '204', fullName: 'WIX2002 PROJECT MANAGEMENT', shortName: 'WIX2002' }
  ];
  const slots = [['129', 1, 11, 12, 'Lecture', '4'], ['129', 1, 16, 18, 'Tutorial', '4'], ['5372', 3, 14, 16, 'Lecture', '3'], ['201', 0, 10, 12, 'Lecture', '2'],
    ['202', 0, 12, 14, 'Lecture', '8'], ['203', 1, 8, 10, 'Lecture', '3'], ['203', 2, 11, 12, 'Tutorial', '3'], ['204', 3, 15, 16, 'Lecture', '3'], ['129', 2, 12, 14, 'Lecture', '4']];
  const items = [];
  for (let w = -5; w <= 8; w++) for (const [course, wd, from, to, type, occ] of slots) {
    const start = week + w * 7 * D + wd * D + from * H;
    const past = start + (to - from) * H < now;
    items.push({ key: 'att:' + course + ':' + start, kind: 'attendance', courseId: course, title: 'Attendance for ' + type + ' (OCC ' + occ + ')', start, end: start + (to - from) * H,
      url: 'https://spectrum.um.edu.my/mod/attendance/view.php?id=1', statusKind: past ? (w === -2 && course === '5372' ? 'absent' : 'present') : start - now < 2 * H && start > now - H ? 'open' : 'unmarked',
      sessionType: type === 'Lecture' ? 'LEC' : 'TUT', occ: [occ], canSelfMark: false });
    if (course === '129' && type === 'Tutorial') items.push({ ...items.at(-1), key: items.at(-1).key + ':o3', title: 'Attendance for Tutorial (OCC 3)', occ: ['3'], statusKind: 'unmarked' });
  }
  const due = (key, course, title, offset, status, kind = 'assignment') => items.push({ key, kind, courseId: course, title, start: now + offset, end: null, url: 'https://spectrum.um.edu.my/mod/assign/view.php?id=1', status, occ: C.parseOcc(title) });
  due('c1', '129', 'Tutorial 4 (OCC4)', -1 * D - 2 * H, 'todo'); due('c2', '129', 'Tutorial 3 (OCC4)', -7 * D, 'todo'); due('c3', '129', 'Tutorial 5 (OCC4)', 3 * D, 'todo');
  due('c4', '5372', 'Quiz: Tutorial 5: Try', 20 * H, 'todo', 'quiz'); due('c5', '202', 'Quiz: Quiz (Lecture Week 2)', 30 * H, 'todo', 'quiz');
  due('c6', '201', 'Requirements & UML Diagram', 9 * D, 'done'); due('c7', '204', 'Week 5 - Tutorial (Self-paced)', 2 * D + 5 * H, 'todo');
  items.push({ key: 'n1', kind: 'notice', courseId: '201', title: 'Requirements Engineering & UML Diagram Scope', start: now - 2 * H, end: null, url: 'https://spectrum.um.edu.my/mod/forum/discuss.php?d=1', occ: null, detail: 'Dr. Lecturer' });
  items.push({ key: 'n2', kind: 'notice', courseId: '202', title: 'Group Project Registration', start: now - 26 * H, end: null, url: 'https://spectrum.um.edu.my/mod/forum/discuss.php?d=2', occ: null, detail: 'Lecturer' });
  const materials = [];
  const weeks = ['Course overview & proforma', 'Week 1: Introduction to the Database', 'Week 2: Data Model', 'Week 4: Normalization', 'Week 9: SQL'];
  const kinds = ['pdf', 'pptx', 'pptx', 'docx', 'zip', 'link'];
  let cm = 1000;
  for (const c of courses) for (const section of weeks.slice(0, c.id === '129' ? 5 : 3)) for (let i = 0; i < 3; i++) {
    const type = kinds[(cm++) % kinds.length];
    materials.push({ courseId: c.id, cmid: String(cm), name: section.split(':').pop().trim() + ' – ' + ['Slides', 'Tutorial', 'Compact notes'][i], section, type, modtype: type === 'link' ? 'url' : 'resource', url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=' + cm, occ: null });
  }
  const data = C.sanitizePlannerData({ collectedAt: now - 4 * 60000, userHash: 'demo', courses, items, materials, detectedOcc: { 129: { occ: '4', source: 'attendance' }, 5372: { occ: '3', source: 'group' } }, statusKnown: true }, now);
  const store = { umspecPlanner: data, umspecPlannerPrefs: { lang: new URLSearchParams(location.search).get('lang') || 'en', theme: new URLSearchParams(location.search).get('theme') || 'light' } };
  const listeners = [];
  globalThis.chrome = {
    runtime: { id: 'demo', getURL: path => location.origin + '/' + path, sendMessage: async message => ({ ok: true, data: message.type === 'PLANNER_DRIVE' ? { keys: ['129:1001', '129:1002', '129:1004'] } : {} }) },
    storage: { local: { get: async keys => Object.fromEntries([].concat(keys).filter(k => k in store).map(k => [k, structuredClone(store[k])])),
      set: async values => { const changes = {}; for (const [k, v] of Object.entries(values)) { changes[k] = { newValue: structuredClone(v) }; store[k] = structuredClone(v); } listeners.forEach(f => f(changes, 'local')); },
      remove: async key => { delete store[key]; listeners.forEach(f => f({ [key]: { newValue: undefined } }, 'local')); } },
      onChanged: { addListener: f => listeners.push(f) } },
    tabs: { query: async () => [], create: () => {} }, permissions: { request: async () => true }, windows: { create: () => {}, getCurrent: async () => ({ id: 1 }) }
  };
})();
