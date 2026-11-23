/* Pure planner rules shared by the Spectrum collector, the planner page and the worker. No DOM or network access here. */
(function (root) {
  'use strict';
  const ORIGIN = 'https://spectrum.um.edu.my';
  const MYT = 8 * 3600000, DAY = 86400000, MINUTE = 60000;
  const KINDS = ['assignment', 'quiz', 'attendance', 'notice', 'event'];
  const DATA_VERSION = 4;
  const clip = (value, max = 300) => String(value ?? '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const positiveId = value => /^[1-9]\d{0,12}$/.test(String(value ?? ''));

  // ---------- URLs ----------
  function safeUrl(value, { spectrumOnly = false } = {}) {
    try {
      const url = new URL(String(value || ''), ORIGIN);
      if (url.protocol !== 'https:' || url.username || url.password) return null;
      if (spectrumOnly && url.origin !== ORIGIN) return null;
      for (const key of [...url.searchParams.keys()]) {
        if (/^sesskey$/i.test(key)) url.searchParams.delete(key);
        else if (/token|password|secret|authorization|session(?:id|key)/i.test(key)) return null;
      }
      return url.href;
    } catch { return null; }
  }

  // ---------- Malaysia time helpers (UTC+8, no daylight saving) ----------
  const mytParts = ms => {
    const d = new Date(ms + MYT);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), wd: (d.getUTCDay() + 6) % 7, min: d.getUTCHours() * 60 + d.getUTCMinutes() };
  };
  const mytInstant = (y, m, d, minutes = 0) => Date.UTC(y, m - 1, d, 0, minutes) - MYT;
  const dayKey = ms => { const p = mytParts(ms); return p.y + '-' + String(p.m).padStart(2, '0') + '-' + String(p.d).padStart(2, '0'); };
  const startOfDay = ms => { const p = mytParts(ms); return mytInstant(p.y, p.m, p.d); };
  const startOfWeek = ms => startOfDay(ms) - mytParts(ms).wd * DAY;
  const hhmm = minutes => String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');

  // ---------- Occurrence (OCC) groups ----------
  // Lecturers write "OCC 4", "Occ4", "OCC-6", "OCCs 1, 2, 4", "Occurrence 3", "Kumpulan 2" or "Kump. 2". "Group N" is left
  // out on purpose: it usually names a project group, and Moodle itself hides activities locked to other groups.
  const OCC_PATTERN = /(?<![A-Za-z0-9])(?:occ(?:urrence)?s?|kumpulan|kump\.?)\s*[:#._\-–]?\s*((?:[0-9]{1,2}[A-Z]?(?![A-Za-z0-9]))(?:(?:\s*(?:,|&|\/|\band\b|\bdan\b|-|–|\bto\b))+\s*[0-9]{1,2}[A-Z]?(?![A-Za-z0-9]))*)/gi;
  // Moodle names UM's class groups "GROUP 3 2026/2027_1" (with the academic year), which is the OCC number.
  const GROUP_YEAR = /\bgroup\s+(\d{1,2}[A-Z]?)\s+20\d\d\s*\/\s*20\d\d/gi;
  function parseOcc(text) {
    const tokens = new Set();
    for (const match of String(text || '').matchAll(GROUP_YEAR)) tokens.add(match[1].toUpperCase().replace(/^0+(?=\d)/, ''));
    for (const match of String(text || '').matchAll(OCC_PATTERN)) {
      const parts = match[1].toUpperCase().split(/\s*(?:,|&|\/|\bAND\b|\bDAN\b)\s*/);
      for (const part of parts) {
        const range = part.match(/^(\d{1,2})\s*(?:-|–|TO)\s*(\d{1,2})$/);
        if (range && Number(range[2]) >= Number(range[1]) && Number(range[2]) - Number(range[1]) <= 20) {
          for (let n = Number(range[1]); n <= Number(range[2]); n++) tokens.add(String(n));
        } else for (const token of part.split(/\s*(?:-|–|TO)\s*/)) if (/^\d{1,2}[A-Z]?$/.test(token)) tokens.add(token.replace(/^0+(?=\d)/, ''));
      }
    }
    return tokens.size ? [...tokens] : null;
  }
  function occMatches(textOrTokens, mine) {
    if (!mine) return true;
    const tokens = Array.isArray(textOrTokens) ? textOrTokens : parseOcc(textOrTokens);
    return !tokens || !tokens.length || tokens.includes(String(mine).toUpperCase());
  }
  // Group membership is the most reliable signal; otherwise the sessions the student actually attended decide.
  function detectOcc({ groups = [], sessions = [], activities = null } = {}) {
    for (const name of groups) {
      const tokens = parseOcc(name);
      if (tokens?.length === 1) return { occ: tokens[0], source: 'group' };
    }
    const pick = list => {
      const score = new Map();
      for (const session of list) {
        const tokens = session.occ;
        if (!tokens?.length) continue;
        for (const token of tokens) score.set(token, (score.get(token) || 0) + 1 / tokens.length);
      }
      const ranked = [...score].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en', { numeric: true }));
      return ranked.length && (ranked.length === 1 || ranked[0][1] > ranked[1][1]) ? ranked[0][0] : null;
    };
    const attended = pick(sessions.filter(s => s.statusKind === 'present' || s.statusKind === 'late'));
    if (attended) return { occ: attended, source: 'attendance' };
    const access = occFromAccess(activities);
    if (access) return { occ: access, source: 'attendance' };
    const left = occFromLocks(activities);
    if (left) return { occ: left, source: 'attendance' };
    const taken = pick(sessions.filter(s => ['present', 'late', 'absent', 'excused'].includes(s.statusKind)));
    return taken ? { occ: taken, source: 'attendance' } : null;
  }

  // ---------- Course naming ----------
  const STOP = new Set(['and', 'of', 'the', 'for', 'in', 'to', 'dan', 'untuk', '&', 'a', 'an']);
  function courseMeta(raw) {
    const fullName = clip(raw.fullName ?? raw.fullname, 200), shortName = clip(raw.shortName ?? raw.shortname, 120);
    const code = (fullName + ' ' + shortName).match(/\b[A-Z]{3,4}\d{4}[A-Z]?\b/)?.[0] || shortName.split(/[\s/]/)[0] || 'COURSE';
    let name = fullName.replace(/\b[A-Z]{3,4}\d{4}[A-Z]?\b(?:\s*\/\s*\b[A-Z]{3,4}\d{4}[A-Z]?\b)*/g, '').replace(/^[\s:/\-–|]+|[\s:/\-–|]+$/g, '').trim() || fullName;
    if (name === name.toUpperCase()) name = name.toLowerCase().replace(/\b\p{L}/gu, c => c.toUpperCase());
    const words = name.split(/[\s\-/]+/).filter(word => word && !STOP.has(word.toLowerCase()) && /\p{L}/u.test(word));
    const abbrev = (words.length > 1 ? words.map(word => word[0]).join('') : (words[0] || code).slice(0, 3)).toUpperCase().slice(0, 4);
    return { id: String(raw.id), fullName, shortName, code, name, abbrev, url: ORIGIN + '/course/view.php?id=' + raw.id };
  }

  // ---------- Dates in attendance tables ----------
  const MONTHS = { jan: 1, feb: 2, mar: 3, mac: 3, apr: 4, may: 5, mei: 5, jun: 6, jul: 7, aug: 8, ogo: 8, sep: 9, oct: 10, okt: 10, nov: 11, dec: 12, dis: 12 };
  function parseDateText(text) {
    const s = String(text || '');
    let m = s.match(/\b(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\.?,?\s+(\d{4})\b/);
    if (m && MONTHS[m[2].toLowerCase()]) return { y: +m[3], m: MONTHS[m[2].toLowerCase()], d: +m[1], index: m.index, length: m[0].length };
    m = s.match(/\b([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/);
    if (m && MONTHS[m[1].toLowerCase()]) return { y: +m[3], m: MONTHS[m[1].toLowerCase()], d: +m[2], index: m.index, length: m[0].length };
    m = s.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/);
    if (m) return { y: m[3].length === 2 ? 2000 + +m[3] : +m[3], m: +m[2], d: +m[1], index: m.index, length: m[0].length };
    m = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (m) return { y: +m[1], m: +m[2], d: +m[3], index: m.index, length: m[0].length };
    return null;
  }
  function toMinutes(h, min, meridiem) {
    let hour = Number(h);
    const ampm = meridiem ? meridiem.replace(/\./g, '').toLowerCase() : '';
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    return hour * 60 + Number(min || 0);
  }
  function parseTimeRange(text) {
    const m = String(text || '').match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*([AaPp]\.?[Mm]\.?)?\s*(?:-|–|—|to|hingga)\s*(\d{1,2})(?:[:.](\d{2}))?\s*([AaPp]\.?[Mm]\.?)?/);
    if (!m || !(m[2] || m[3] || m[5] || m[6])) return null;
    let startMeridiem = m[3], endMeridiem = m[6];
    if (!startMeridiem && endMeridiem) {
      const asEnd = toMinutes(m[1], m[2], endMeridiem), end = toMinutes(m[4], m[5], endMeridiem);
      startMeridiem = asEnd <= end ? endMeridiem : /p/i.test(endMeridiem) ? 'am' : 'pm';
    }
    const start = toMinutes(m[1], m[2], startMeridiem), end = toMinutes(m[4], m[5], endMeridiem || startMeridiem);
    if (start >= 24 * 60 || end > 24 * 60 || end <= start) return null;
    return { start, end };
  }
  function parseSessionTime(text) {
    const date = parseDateText(text);
    if (!date) return null;
    const rest = String(text).slice(0, date.index) + ' ' + String(text).slice(date.index + date.length);
    const time = parseTimeRange(rest);
    const base = mytInstant(date.y, date.m, date.d);
    if (!Number.isFinite(base)) return null;
    return time ? { start: base + time.start * MINUTE, end: base + time.end * MINUTE, allDay: false } : { start: base, end: base + DAY, allDay: true };
  }
  function statusKind(text) {
    const s = clip(text, 60).toLowerCase();
    if (!s || s === '?' || /not\s*marked|belum|^-$/.test(s)) return 'unmarked';
    if (/^p$|present|hadir(?!\s*lewat)/.test(s) && !/tidak\s*hadir|absent/.test(s)) return 'present';
    if (/^l$|late|lewat/.test(s)) return 'late';
    if (/^e$|excus|cuti|dikecualikan|mc\b/.test(s)) return 'excused';
    if (/^a$|absent|tidak\s*hadir|ponteng/.test(s)) return 'absent';
    return 'unmarked';
  }
  function sessionType(text) {
    const s = String(text || '');
    if (/\b(tut(orial)?s?)\b/i.test(s)) return 'TUT';
    if (/\b(lab(oratory)?|amali|practical|makmal)\b/i.test(s)) return 'LAB';
    if (/\b(lec(ture)?s?|kuliah)\b/i.test(s)) return 'LEC';
    return 'CLS';
  }
  // Rows come from the student's own attendance report: header cells plus each row's cell text.
  function parseAttendanceRows(table, activity) {
    const headers = (table.headers || []).map(h => clip(h, 40).toLowerCase());
    const find = (...names) => headers.findIndex(h => names.some(name => h.includes(name)));
    const dateIdx = find('date', 'tarikh'), timeIdx = find('time', 'masa'), descIdx = find('description', 'keterangan', 'penerangan');
    const statusIdx = find('status');
    if (dateIdx < 0 || statusIdx < 0) return [];
    const sessions = [];
    for (const row of table.rows || []) {
      const cells = row.cells || [];
      const when = parseSessionTime(cells[dateIdx] + ' ' + (timeIdx >= 0 ? cells[timeIdx] : ''));
      if (!when) continue;
      const description = descIdx >= 0 ? clip(cells[descIdx], 200) : '';
      const status = clip(cells[statusIdx], 60);
      const occ = parseOcc(activity.name + ' ' + description);
      sessions.push({
        key: 'att:' + activity.cmid + ':' + when.start, courseId: String(activity.courseId), cmid: String(activity.cmid),
        activityName: clip(activity.name, 160), description, start: when.start, end: when.end,
        status: row.selfMark ? '' : status, statusKind: row.selfMark ? 'open' : statusKind(status), canSelfMark: Boolean(row.selfMark),
        type: sessionType(activity.name + ' ' + description), occ,
        url: ORIGIN + '/mod/attendance/view.php?id=' + activity.cmid
      });
    }
    return sessions;
  }

  // ---------- Calendar events ----------
  // Modules whose "due" date is a student submission (Spectrum also uses Turnitin for final submissions).
  const SUBMISSION_MODULES = new Set(['assign', 'turnitintooltwo', 'turnitintool', 'workshop', 'lesson', 'h5pactivity', 'scorm']);
  function classifyEvent(raw, outstanding) {
    if (!raw || !positiveId(raw.id) || !Number.isInteger(raw.timestart)) return null;
    const module = String(raw.modulename || '').toLowerCase(), type = String(raw.eventtype || '').toLowerCase();
    const opensOnly = module === 'quiz' && type === 'open';
    const kind = SUBMISSION_MODULES.has(module) && ['due', 'close', 'expectcompletionon'].includes(type) ? 'assignment' : module === 'quiz' ? 'quiz' : module === 'attendance' ? 'attendance' :
      module ? 'event' : ['course', 'site', 'category', 'group'].includes(type) ? 'notice' : 'event';
    if (type === 'gradingdue') return null;
    if (kind === 'quiz' && !['due', 'close'].includes(type) && !(opensOnly && raw.action)) return null;
    const start = raw.timestart * 1000, duration = Math.max(0, Number(raw.timeduration) || 0) * 1000;
    const courseId = String(raw.course?.id ?? raw.courseid ?? '');
    const actionKey = module && raw.instance ? module + ':' + raw.instance : null;
    let status = null;
    if (kind === 'assignment' || kind === 'quiz') {
      // The calendar's own "Add submission" action also means the work is still outstanding.
      if (raw.action || (actionKey && outstanding?.has(actionKey))) status = 'todo';
      else status = outstanding ? 'done' : 'unknown';
    }
    return {
      key: 'cal:' + raw.id, kind, courseId: positiveId(courseId) ? courseId : '', title: clip(String(raw.name || '').replace(/<[^>]*>/g, ' '), 200),
      start, end: duration ? start + duration : null, url: safeUrl(raw.url, { spectrumOnly: true }) || ORIGIN + '/calendar/view.php?view=event&id=' + raw.id,
      module: module || null, instance: raw.instance ? String(raw.instance) : null, status,
      occ: parseOcc(raw.name), detail: clip(String(raw.description || '').replace(/<[^>]*>/g, ' '), 280), opensOnly
    };
  }
  // Every action event is unfinished work; "actionable: false" only means it is not open for submission yet.
  function outstandingFromActionEvents(events) {
    const keys = new Set();
    for (const event of events || []) if (event?.modulename && event.instance && event.action) keys.add(String(event.modulename).toLowerCase() + ':' + event.instance);
    return keys;
  }
  function itemState(item, now = Date.now()) {
    if (item.kind === 'assignment' || item.kind === 'quiz') {
      if (item.status === 'done') return 'done';
      if (item.opensOnly) return 'todo';
      if (item.status === 'todo') return item.start < now ? 'overdue' : 'todo';
      return item.start < now ? 'past' : 'todo';
    }
    if (item.kind === 'attendance') {
      if (item.statusKind === 'open') return 'open';
      if (['present', 'late', 'excused'].includes(item.statusKind)) return 'attended';
      if (item.statusKind === 'absent') return 'missed';
      return item.end && item.end < now ? 'past' : item.start <= now ? 'live' : 'upcoming';
    }
    return item.start > now - 3 * DAY && item.start <= now ? 'new' : 'info';
  }

  // ---------- Course pages ----------
  const ICON_TYPES = [[/pdf/, 'pdf'], [/powerpoint|presentation|ppt/, 'pptx'], [/document|word|docx?\b|writer/, 'docx'],
    [/spreadsheet|excel|xlsx?\b|calc/, 'xlsx'], [/archive|zip|rar|7z/, 'zip'], [/video|mpeg|mp4|avi|quicktime/, 'video'],
    [/audio|mp3|wav/, 'audio'], [/image|jpe?g|png|gif|bmp/, 'image'], [/sourcecode|text|markup|java|python/, 'code']];
  function fileType(modtype, icon, url) {
    if (modtype === 'folder') return 'folder';
    if (modtype === 'url') return /youtu|panopto|vimeo|echo360|loom|stream/i.test(url) ? 'video' : 'link';
    if (modtype === 'page' || modtype === 'book') return 'page';
    const ext = String(url || '').match(/\.([a-z0-9]{2,5})(?:[?#]|$)/i)?.[1]?.toLowerCase();
    if (ext) for (const [pattern, type] of ICON_TYPES) if (pattern.test(ext)) return type;
    const hint = String(icon || '').toLowerCase().match(/\/f\/([a-z0-9_-]+)/)?.[1] || '';
    for (const [pattern, type] of ICON_TYPES) if (pattern.test(hint)) return type;
    return modtype === 'resource' ? 'file' : 'other';
  }
  const MATERIAL_TYPES = new Set(['resource', 'folder', 'url', 'page', 'book', 'h5pactivity', 'imscp', 'scorm', 'lightboxgallery']);
  function normaliseMaterials(activities, courseId) {
    const out = [], seen = new Set();
    for (const a of activities || []) {
      if (!MATERIAL_TYPES.has(a.modtype) || a.restricted || !positiveId(a.cmid) || seen.has(a.cmid)) continue;
      const url = safeUrl(a.url);
      if (!url) continue;
      seen.add(a.cmid);
      out.push({ key: courseId + ':' + a.cmid, courseId: String(courseId), cmid: String(a.cmid), name: clip(a.name, 200) || 'Material',
        section: clip(a.section, 160) || 'General', type: fileType(a.modtype, a.icon, url), modtype: a.modtype, url,
        occ: parseOcc(a.name) });
    }
    return out;
  }
  function cmidFromUrl(value) {
    try { const url = new URL(value, ORIGIN); return positiveId(url.searchParams.get('id')) ? url.searchParams.get('id') : null; } catch { return null; }
  }
  // Calendar attendance events name every OCC's activity, so a quick refresh can find them without opening course pages.
  function attendanceFromCalendar(items, courseId) {
    const found = new Map();
    for (const item of items) {
      if (item.kind !== 'attendance' || item.courseId !== String(courseId)) continue;
      const cmid = cmidFromUrl(item.url);
      if (cmid && !found.has(cmid)) found.set(cmid, { cmid, courseId: String(courseId), name: clip(String(item.title).replace(/\s*\(Group [^)]*\)\s*$/i, ''), 160) });
    }
    return [...found.values()];
  }
  function attendanceToRead(activities, occ) {
    return occ ? activities.filter(activity => occMatches(activity.name, occ)) : activities;
  }
  // Locked attendance activities (other groups' OCCs) only redirect to a "restricted" page, so they are not opened.
  function attendanceActivities(activities, courseId) {
    return (activities || []).filter(a => a.modtype === 'attendance' && !a.restricted && positiveId(a.cmid)).map(a => ({ cmid: String(a.cmid), name: clip(a.name, 160), courseId: String(courseId) }));
  }
  // Moodle names group events after the group ("Attendance (Group GROUP 3 2026/2027_1)") and shows a student only the
  // events of their own groups, so those names say which OCC the student is in.
  function calendarGroups(items, courseId) {
    return (items || []).filter(item => item.courseId === String(courseId))
      .map(item => String(item.title || '').match(/\(Group ([^)]*)\)?\s*$/i)?.[1]).filter(Boolean).map(name => clip(name, 80));
  }
  // Every OCC the course labels, minus those whose activities are locked to their group ("You belong to GROUP 1 …"):
  // when exactly one is left, it is the student's.
  function occFromLocks(activities) {
    const all = new Set(), locked = new Set();
    for (const a of activities || []) {
      for (const token of parseOcc([a.name, a.section].join(' ')) || []) all.add(token);
      if (a.restricted) for (const token of a.lockOcc || []) locked.add(token);
    }
    if (!locked.size) return null;
    const left = [...all].filter(token => !locked.has(token));
    return left.length === 1 ? left[0] : null;
  }
  // When other OCCs' attendance is locked to their groups, the one OCC activity the student can open is theirs.
  function occFromAccess(activities) {
    const attendance = (activities || []).filter(a => a.modtype === 'attendance');
    if (!attendance.some(a => a.restricted && parseOcc(a.name))) return null;
    const open = new Set(attendance.filter(a => !a.restricted).map(a => parseOcc(a.name)).filter(tokens => tokens?.length === 1).map(tokens => tokens[0]));
    return open.size === 1 ? [...open][0] : null;
  }
  // Lecturers add extra forums such as "Announcement from Dr. …" or "Announcement on MID-SEM Examination"; read up to three.
  // Lecturers add their own announcement forums ("Announcement from Dr. X", "Important Announcement for OCC-3"), so
  // the word may appear anywhere in the name. Discussion forums ("Company Website", "Review Questions") are not read.
  const ANNOUNCEMENT_WORDS = /\b(?:announcements?|pengumuman|makluman|hebahan|news|notices?|berita)\b/i;
  function isAnnouncementForum(name) { return ANNOUNCEMENT_WORDS.test(String(name || '')); }
  // Each forum keeps the OCC its name is labelled for, so its posts are filtered like any other OCC item.
  function newsForumEntries(activities) {
    return (activities || []).filter(a => a.modtype === 'forum' && positiveId(a.cmid) && isAnnouncementForum(clip(a.name, 120)))
      .slice(0, 5).map(forum => ({ url: ORIGIN + '/mod/forum/view.php?id=' + forum.cmid, occ: parseOcc(forum.name) }));
  }
  function newsForums(activities) { return newsForumEntries(activities).map(forum => forum.url); }
  function newsForum(activities) { return newsForums(activities)[0] || null; }
  function announcementItems(discussions, courseId, collectedAt, forumOcc = null) {
    return (discussions || []).filter(d => positiveId(d.id)).slice(0, 8).map(d => ({
      key: 'news:' + d.id, kind: 'notice', courseId: String(courseId), title: clip(d.title, 200) || 'Announcement',
      start: Number.isFinite(d.time) ? d.time : collectedAt, end: null, url: ORIGIN + '/mod/forum/discuss.php?d=' + d.id,
      status: null, occ: parseOcc(d.title) || forumOcc || null, detail: clip(d.author, 80), datedFromList: Number.isFinite(d.time)
    }));
  }

  // ---------- Stored data: validation before anything is written ----------
  function sanitizePlannerData(data, now = Date.now()) {
    if (!data || typeof data !== 'object') throw new Error('Invalid planner data');
    const courses = (Array.isArray(data.courses) ? data.courses : []).filter(c => positiveId(c.id)).slice(0, 40).map(courseMeta);
    // Two courses can share initials (e.g. "Turnitin Course Submission" and "Thinking and Communication Skills"); fall back to the code.
    for (const course of courses) if (courses.filter(other => other.abbrev === course.abbrev).length > 1) course.abbrev = course.code.slice(0, 8);
    const ids = new Set(courses.map(c => c.id));
    const time = value => Number.isFinite(value) && Math.abs(value - now) < 400 * DAY ? value : null;
    const items = (Array.isArray(data.items) ? data.items : []).slice(0, 1500).map(item => {
      const start = time(item.start);
      if (start === null || !KINDS.includes(item.kind)) return null;
      const url = safeUrl(item.url);
      if (!url) return null;
      return { key: clip(item.key, 120), kind: item.kind, courseId: ids.has(String(item.courseId)) ? String(item.courseId) : '',
        title: clip(item.title, 200), start, end: time(item.end), url, module: item.module ? clip(item.module, 30) : null,
        instance: item.instance ? clip(item.instance, 20) : null, status: ['todo', 'done', 'unknown'].includes(item.status) ? item.status : null,
        occ: Array.isArray(item.occ) ? item.occ.slice(0, 12).map(t => clip(t, 4)) : null, detail: clip(item.detail, 280), opensOnly: Boolean(item.opensOnly),
        ...(item.kind === 'attendance' ? { statusKind: ['present', 'late', 'absent', 'excused', 'open', 'unmarked'].includes(item.statusKind) ? item.statusKind : 'unmarked',
          sessionType: ['LEC', 'TUT', 'LAB', 'CLS'].includes(item.sessionType) ? item.sessionType : 'CLS', canSelfMark: Boolean(item.canSelfMark) } : {}) };
    }).filter(Boolean);
    const materials = (Array.isArray(data.materials) ? data.materials : []).slice(0, 3000).map(m => {
      const url = safeUrl(m.url);
      return url && ids.has(String(m.courseId)) && positiveId(m.cmid) ? { key: String(m.courseId) + ':' + m.cmid, courseId: String(m.courseId), cmid: String(m.cmid),
        name: clip(m.name, 200), section: clip(m.section, 160), type: clip(m.type, 10), modtype: clip(m.modtype, 20), url,
        occ: Array.isArray(m.occ) ? m.occ.slice(0, 12).map(t => clip(t, 4)) : null } : null;
    }).filter(Boolean);
    const detected = {};
    for (const [id, value] of Object.entries(data.detectedOcc || {})) if (ids.has(id) && /^\d{1,2}[A-Z]?$/.test(value?.occ || '')) detected[id] = { occ: value.occ, source: value.source === 'group' ? 'group' : 'attendance' };
    // Version 2: activity names are read per <li id="module-N">; version-1 data may pair an ID with a neighbour's name.
    return { version: DATA_VERSION, collectedAt: time(data.collectedAt) ?? now, fullAt: time(data.fullAt), userHash: clip(data.userHash, 64), courses, items, materials, detectedOcc: detected,
      statusKnown: Boolean(data.statusKnown), warnings: (Array.isArray(data.warnings) ? data.warnings : []).slice(0, 10).map(w => clip(w, 200)) };
  }
  function attendanceItems(sessions) {
    return sessions.map(s => ({ key: s.key, kind: 'attendance', courseId: s.courseId, title: s.activityName, start: s.start, end: s.end, url: s.url,
      status: null, statusKind: s.statusKind, sessionType: s.type, canSelfMark: s.canSelfMark, occ: s.occ, detail: s.description || s.status }));
  }

  // ---------- Filters, timetable, exports ----------
  function effectiveOcc(data, prefs, courseId) {
    if (prefs?.occ && Object.hasOwn(prefs.occ, courseId)) return prefs.occ[courseId] || null;
    return data?.detectedOcc?.[courseId]?.occ || null;
  }
  function visibleItems(data, prefs = {}) {
    return (data?.items || []).filter(item => prefs.showAllOcc || occMatches(item.occ, effectiveOcc(data, prefs, item.courseId)));
  }
  function uniquePath(used, dir, fileName) {
    const cleanDir = String(dir || '').replace(/^\/+|\/+$/g, '');
    const cleanName = String(fileName || 'file');
    const dot = cleanName.lastIndexOf('.');
    const stem = dot > 0 ? cleanName.slice(0, dot) : cleanName;
    const ext = dot > 0 ? cleanName.slice(dot) : '';
    let candidate = cleanDir ? cleanDir + '/' + cleanName : cleanName;
    let index = 2;
    while (used.has(candidate.toLowerCase())) {
      const next = stem + ' (' + index++ + ')' + ext;
      candidate = cleanDir ? cleanDir + '/' + next : next;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  }
  function layoutDaySlots(daySlots) {
    const ordered = [...(daySlots || [])].sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
    const placed = [];
    let cluster = [], clusterEnd = -Infinity;
    const flush = () => {
      if (!cluster.length) return;
      const laneEnds = [];
      const entries = cluster.map(slot => {
        let lane = laneEnds.findIndex(end => end <= slot.start);
        if (lane < 0) { lane = laneEnds.length; laneEnds.push(slot.end); }
        else laneEnds[lane] = slot.end;
        return { slot, lane };
      });
      const lanes = laneEnds.length;
      for (const entry of entries) placed.push({ slot: entry.slot, lane: entry.lane, lanes });
      cluster = []; clusterEnd = -Infinity;
    };
    for (const slot of ordered) {
      if (cluster.length && slot.start >= clusterEnd) flush();
      cluster.push(slot);
      clusterEnd = Math.max(clusterEnd, slot.end);
    }
    flush();
    return placed;
  }
  function buildTimetable(items, now = Date.now()) {
    const slots = new Map();
    for (const item of items) {
      if (item.kind !== 'attendance' || !item.end || item.end - item.start > 10 * 3600000) continue;
      const p = mytParts(item.start), endMin = p.min + Math.round((item.end - item.start) / MINUTE);
      const id = [item.courseId, item.sessionType, p.wd, p.min, endMin].join('|');
      const slot = slots.get(id) || { id, courseId: item.courseId, type: item.sessionType, weekday: p.wd, start: p.min, end: endMin,
        occ: item.occ, title: item.title, count: 0, first: item.start, last: item.start, upcoming: false };
      slot.count++; slot.first = Math.min(slot.first, item.start); slot.last = Math.max(slot.last, item.start);
      if (item.start >= startOfWeek(now) && item.start < startOfWeek(now) + 14 * DAY) slot.upcoming = true;
      slots.set(id, slot);
    }
    return [...slots.values()].filter(s => s.count >= 2 || s.upcoming).sort((a, b) => a.weekday - b.weekday || a.start - b.start || a.courseId.localeCompare(b.courseId));
  }
  const DAYS_EN = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const csvCell = value => { const s = String(value ?? ''); return /[",\n]|^[=+\-@]/.test(s) ? '"' + s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""') + '"' : s; };
  function timetableCSV(slots, courses) {
    const byId = new Map((courses || []).map(c => [c.id, c]));
    const rows = [['Day', 'Start', 'End', 'Code', 'Course', 'Type', 'OCC', 'Sessions']];
    for (const s of slots) { const c = byId.get(s.courseId) || {}; rows.push([DAYS_EN[s.weekday], hhmm(s.start), hhmm(s.end), c.code || '', c.name || s.title, s.type, (s.occ || []).join(' '), s.count]); }
    return rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }
  const icsText = value => String(value ?? '').replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  const icsTime = ms => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  function foldLine(line) {
    const out = []; let rest = line;
    while (new TextEncoder().encode(rest).length > 75) {
      let cut = 74; while (new TextEncoder().encode(rest.slice(0, cut)).length > 74) cut--;
      out.push(rest.slice(0, cut)); rest = ' ' + rest.slice(cut);
    }
    out.push(rest); return out.join('\r\n');
  }
  function sessionsICS(items, courses, generatedAt = Date.now()) {
    const byId = new Map((courses || []).map(c => [c.id, c]));
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//UM Spec//Planner//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:UM Spec timetable'];
    for (const item of items) {
      if (item.kind !== 'attendance' || !item.end) continue;
      const c = byId.get(item.courseId) || {};
      lines.push('BEGIN:VEVENT', 'UID:' + icsText(item.key) + '@umspec', 'DTSTAMP:' + icsTime(generatedAt), 'DTSTART:' + icsTime(item.start), 'DTEND:' + icsTime(item.end),
        'SUMMARY:' + icsText((c.code ? c.code + ' ' : '') + item.sessionType + ' · ' + (c.name || item.title)), 'URL:' + icsText(item.url), 'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return lines.map(foldLine).join('\r\n') + '\r\n';
  }
  function semesterWeek(items, now = Date.now()) {
    const starts = items.filter(i => i.kind === 'attendance').map(i => i.start).sort((a, b) => a - b);
    if (!starts.length) return null;
    const first = startOfWeek(starts.find(s => s > now - 200 * DAY) ?? starts[0]);
    const week = Math.floor((startOfWeek(now) - first) / (7 * DAY)) + 1;
    return week >= 1 && week <= 22 ? week : null;
  }

  // ---------- Reminders ----------
  function reminderPlan(data, prefs = {}, now = Date.now()) {
    const r = { enabled: false, deadlineLeads: [1440, 60], classLead: 10, ...(prefs.reminders || {}) };
    if (!r.enabled || !data) return [];
    const courses = new Map((data.courses || []).map(c => [c.id, c]));
    const plan = [];
    for (const item of visibleItems(data, prefs)) {
      const course = courses.get(item.courseId);
      const label = course ? course.code + ' · ' : '';
      if ((item.kind === 'assignment' || item.kind === 'quiz') && item.status !== 'done' && !item.opensOnly && item.start > now) {
        for (const lead of r.deadlineLeads || []) {
          const when = item.start - lead * MINUTE;
          if (when > now) plan.push({ key: 'd:' + item.key + ':' + lead, when, title: label + item.title, url: item.url, kind: item.kind, lead, due: item.start });
        }
      }
      if (item.kind === 'attendance' && r.classLead != null && r.classLead >= 0 && item.statusKind === 'unmarked' && item.end && item.start > now) {
        const when = item.start - r.classLead * MINUTE;
        if (when > now && item.start - now < 8 * DAY) plan.push({ key: 'c:' + item.key, when, title: label + item.sessionType + ' · ' + (course?.name || item.title), url: item.url, kind: 'attendance', lead: r.classLead, due: item.start });
      }
    }
    return plan.sort((a, b) => a.when - b.when).slice(0, 60);
  }
  function dueSoonCount(data, prefs = {}, now = Date.now(), hours = 48) {
    return visibleItems(data, prefs).filter(i => (i.kind === 'assignment' || i.kind === 'quiz') && itemState(i, now) !== 'done' &&
      ((i.start > now && i.start - now <= hours * 3600000) || itemState(i, now) === 'overdue')).length;
  }

  // ---------- Interface text ----------
  const STRINGS = {
    en: { planner: 'Planner', today: 'Today', week: 'Week', calendar: 'Calendar', list: 'List', timetable: 'Timetable', materials: 'Materials', settings: 'Settings',
      refresh: 'Refresh', refreshing: 'Refreshing…', allCourses: 'All', assignment: 'Assignment', quiz: 'Quiz', attendance: 'Attendance', notice: 'Notice', event: 'Event',
      overdue: 'Overdue', todo: 'To do', done: 'Submitted', past: 'Closed', open: 'Check-in open', attended: 'Present', missed: 'Absent', live: 'Now', upcoming: 'Upcoming', new: 'New', info: '', unknown: 'Status unknown',
      dots: 'Dots', count: 'Count', newest: 'Newest', oldest: 'Oldest', nothingDay: 'Nothing scheduled for this day.', nothing: 'Nothing to show yet. Open Spectrum and choose Refresh.',
      openSpectrum: 'Open in Spectrum', submit: 'Submit', submitLate: 'Submit late', viewSubmission: 'View submission', takeAttendance: 'Check in', lastUpdated: 'Updated',
      exportCsv: 'Export CSV', exportIcs: 'Add to calendar (.ics)', exportPng: 'Export PNG', print: 'Print / PDF', search: 'Search files…', downloadSelected: 'Download selected (.zip)',
      selectAll: 'Select all', clearSelection: 'Clear', preview: 'Preview', inDrive: 'In Drive', files: 'files', language: 'Language', theme: 'Theme', themeSystem: 'System', themeLight: 'Light', themeDark: 'Dark',
      occTitle: 'Class group (OCC)', occHelp: 'Hide attendance, notices and files meant for other OCCs. Detected values come from your groups or the classes you attended.',
      occAuto: 'auto', occNone: 'Not set', showAllOcc: 'Show items from every OCC', reminders: 'Reminders', remindersHelp: 'Browser notifications while Chrome is open. UM Spec never marks attendance for you.',
      enableReminders: 'Enable reminders', deadlineLead: 'Before deadlines', classLead: 'Before classes', off: 'Off', minutes: 'min', hours: 'h', day: 'day',
      sidePanel: 'Side panel', popOut: 'Pop out', clearData: 'Clear planner data', noTimetable: 'No class sessions found. Attendance activities provide the timetable.',
      dueIn: 'Due in', ago: 'ago', noDeadline: 'No deadline', live2: 'LIVE', sessions: 'sessions', notSignedIn: 'Sign in to Spectrum, then choose Refresh.', partial: 'Some courses could not be read:',
      courses: 'Courses', type: 'Type', all: 'All', zipping: 'Packaging', of: 'of', previewUnavailable: 'Preview is not available for this file type.', close: 'Close', permissionDenied: 'Notifications were not allowed.', coursePack: 'Course pack (.zip)' },
    ms: { planner: 'Perancang', today: 'Hari ini', week: 'Minggu', calendar: 'Kalendar', list: 'Senarai', timetable: 'Jadual', materials: 'Bahan', settings: 'Tetapan',
      refresh: 'Muat semula', refreshing: 'Memuat semula…', allCourses: 'Semua', assignment: 'Tugasan', quiz: 'Kuiz', attendance: 'Kehadiran', notice: 'Notis', event: 'Acara',
      overdue: 'Lewat', todo: 'Belum siap', done: 'Dihantar', past: 'Ditutup', open: 'Daftar masuk dibuka', attended: 'Hadir', missed: 'Tidak hadir', live: 'Sekarang', upcoming: 'Akan datang', new: 'Baharu', info: '', unknown: 'Status tidak diketahui',
      dots: 'Titik', count: 'Kiraan', newest: 'Terbaru', oldest: 'Terlama', nothingDay: 'Tiada jadual pada hari ini.', nothing: 'Belum ada data. Buka Spectrum dan pilih Muat semula.',
      openSpectrum: 'Buka di Spectrum', submit: 'Hantar', submitLate: 'Hantar lewat', viewSubmission: 'Lihat hantaran', takeAttendance: 'Daftar masuk', lastUpdated: 'Dikemas kini',
      exportCsv: 'Eksport CSV', exportIcs: 'Tambah ke kalendar (.ics)', exportPng: 'Eksport PNG', print: 'Cetak / PDF', search: 'Cari fail…', downloadSelected: 'Muat turun pilihan (.zip)',
      selectAll: 'Pilih semua', clearSelection: 'Kosongkan', preview: 'Pratonton', inDrive: 'Dalam Drive', files: 'fail', language: 'Bahasa', theme: 'Tema', themeSystem: 'Sistem', themeLight: 'Cerah', themeDark: 'Gelap',
      occTitle: 'Kumpulan kelas (OCC)', occHelp: 'Sembunyikan kehadiran, notis dan fail untuk OCC lain. Nilai automatik diambil daripada kumpulan anda atau kelas yang anda hadiri.',
      occAuto: 'auto', occNone: 'Belum ditetapkan', showAllOcc: 'Tunjukkan semua OCC', reminders: 'Peringatan', remindersHelp: 'Pemberitahuan pelayar semasa Chrome dibuka. UM Spec tidak sesekali menanda kehadiran untuk anda.',
      enableReminders: 'Hidupkan peringatan', deadlineLead: 'Sebelum tarikh akhir', classLead: 'Sebelum kelas', off: 'Tutup', minutes: 'min', hours: 'j', day: 'hari',
      sidePanel: 'Panel sisi', popOut: 'Tetingkap baharu', clearData: 'Padam data perancang', noTimetable: 'Tiada sesi kelas ditemui. Jadual dibina daripada aktiviti kehadiran.',
      dueIn: 'Tamat dalam', ago: 'lalu', noDeadline: 'Tiada tarikh akhir', live2: 'LANGSUNG', sessions: 'sesi', notSignedIn: 'Log masuk ke Spectrum, kemudian pilih Muat semula.', partial: 'Sesetengah kursus tidak dapat dibaca:',
      courses: 'Kursus', type: 'Jenis', all: 'Semua', zipping: 'Membungkus', of: 'daripada', previewUnavailable: 'Pratonton tidak tersedia untuk jenis fail ini.', close: 'Tutup', permissionDenied: 'Pemberitahuan tidak dibenarkan.', coursePack: 'Pek kursus (.zip)' },
    zh: { planner: '学习规划', today: '今天', week: '第', calendar: '日历', list: '列表', timetable: '课表', materials: '课程资料', settings: '设置',
      refresh: '刷新', refreshing: '正在刷新…', allCourses: '全部', assignment: '作业', quiz: '测验', attendance: '签到', notice: '通知', event: '活动',
      overdue: '已逾期', todo: '待完成', done: '已提交', past: '已截止', open: '签到开放中', attended: '已签到', missed: '缺席', live: '进行中', upcoming: '即将到来', new: '新', info: '', unknown: '状态未知',
      dots: '圆点', count: '数量', newest: '最新', oldest: '最早', nothingDay: '这一天没有安排。', nothing: '暂无数据。请打开 Spectrum 并点击刷新。',
      openSpectrum: '在 Spectrum 打开', submit: '提交', submitLate: '迟交', viewSubmission: '查看提交', takeAttendance: '签到', lastUpdated: '更新于',
      exportCsv: '导出 CSV', exportIcs: '加入日历 (.ics)', exportPng: '导出 PNG', print: '打印 / PDF', search: '搜索文件…', downloadSelected: '下载所选 (.zip)',
      selectAll: '全选', clearSelection: '清除', preview: '预览', inDrive: '已在云端硬盘', files: '个文件', language: '语言', theme: '主题', themeSystem: '跟随系统', themeLight: '浅色', themeDark: '深色',
      occTitle: '上课组别 (OCC)', occHelp: '隐藏其他 OCC 的签到、通知和文件。自动值来自你的群组或你出席过的课。',
      occAuto: '自动', occNone: '未设置', showAllOcc: '显示所有 OCC 的内容', reminders: '提醒', remindersHelp: 'Chrome 打开时显示浏览器通知。UM Spec 绝不会替你签到。',
      enableReminders: '开启提醒', deadlineLead: '截止前', classLead: '上课前', off: '关闭', minutes: '分钟', hours: '小时', day: '天',
      sidePanel: '侧边栏', popOut: '独立窗口', clearData: '清除规划数据', noTimetable: '未找到课堂。课表来自签到活动。',
      dueIn: '剩余', ago: '前', noDeadline: '无截止日期', live2: '直播', sessions: '次', notSignedIn: '请先登录 Spectrum，然后点击刷新。', partial: '部分课程无法读取：',
      courses: '课程', type: '类型', all: '全部', zipping: '正在打包', of: '/', previewUnavailable: '此文件类型无法预览。', close: '关闭', permissionDenied: '通知权限未获允许。', coursePack: '课程资料包 (.zip)' }
  };
  const LANGS = { en: 'en-MY', ms: 'ms-MY', zh: 'zh-CN' };
  // Overview and sync status strings.
  Object.assign(STRINGS.en, { overview: 'Overview', syncStatus: 'Sync status', drive: 'Google Drive', gcal: 'Google Calendar', plannerData: 'Planner',
    stSynced: 'Up to date', stSyncing: 'Syncing', stPaused: 'Paused', stAttention: 'Needs attention', stNotConnected: 'Not connected', stOff: 'Turned off', stNever: 'Not synced yet',
    connectHint: 'Connect it from the UM Spec toolbar button.', lastSync: 'Last sync', items: 'items', dates: 'dates saved', inBackground: 'in the background',
    openFolder: 'Open folder', openCalendar: 'Open calendar', dueWeek: 'Due in 7 days', overdueNow: 'Overdue', classesToday: 'Classes today', filesSynced: 'Files in Drive',
    allGood: 'All synced', justNow: 'just now', needAttention: 'need attention' });
  Object.assign(STRINGS.ms, { overview: 'Ringkasan', syncStatus: 'Status penyegerakan', drive: 'Google Drive', gcal: 'Google Calendar', plannerData: 'Perancang',
    stSynced: 'Terkini', stSyncing: 'Sedang disegerakkan', stPaused: 'Dijeda', stAttention: 'Perlu perhatian', stNotConnected: 'Belum disambung', stOff: 'Dimatikan', stNever: 'Belum disegerakkan',
    connectHint: 'Sambungkan melalui butang UM Spec di bar alat.', lastSync: 'Penyegerakan terakhir', items: 'item', dates: 'tarikh disimpan', inBackground: 'di latar belakang',
    openFolder: 'Buka folder', openCalendar: 'Buka kalendar', dueWeek: 'Tamat dalam 7 hari', overdueNow: 'Lewat', classesToday: 'Kelas hari ini', filesSynced: 'Fail dalam Drive',
    allGood: 'Semua disegerakkan', justNow: 'baru sahaja', needAttention: 'perlu perhatian' });
  Object.assign(STRINGS.zh, { overview: '概览', syncStatus: '同步状态', drive: 'Google 云端硬盘', gcal: 'Google 日历', plannerData: '计划',
    stSynced: '已是最新', stSyncing: '同步中', stPaused: '已暂停', stAttention: '需要处理', stNotConnected: '未连接', stOff: '已关闭', stNever: '尚未同步',
    connectHint: '请通过工具栏的 UM Spec 按钮连接。', lastSync: '上次同步', items: '项', dates: '个日期已保存', inBackground: '（后台）',
    openFolder: '打开文件夹', openCalendar: '打开日历', dueWeek: '7 天内截止', overdueNow: '已逾期', classesToday: '今日课程', filesSynced: '已存入云端硬盘',
    allGood: '全部已同步', justNow: '刚刚', needAttention: '项需要处理' });
  // The planner keeps one account's data. This tag (also stored with the data) tells whose it is, without storing the ID.
  async function accountTag(userId) {
    if (!/^[1-9]\d*$/.test(String(userId || ''))) return '';
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('umspec-planner:' + userId));
    return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  function t(lang, key) { return (STRINGS[lang] || STRINGS.en)[key] ?? STRINGS.en[key] ?? key; }

  const api = { ORIGIN, DAY, MINUTE, KINDS, DATA_VERSION, STRINGS, LANGS, t, clip, safeUrl, mytParts, mytInstant, dayKey, startOfDay, startOfWeek, hhmm,
    parseOcc, occMatches, detectOcc, courseMeta, parseDateText, parseTimeRange, parseSessionTime, statusKind, sessionType, parseAttendanceRows,
    classifyEvent, outstandingFromActionEvents, itemState, fileType, normaliseMaterials, attendanceActivities, occFromAccess, attendanceFromCalendar, attendanceToRead, accountTag, calendarGroups, occFromLocks, cmidFromUrl, newsForum, newsForums, newsForumEntries, isAnnouncementForum, announcementItems,
    attendanceItems, sanitizePlannerData, visibleItems, effectiveOcc, uniquePath, layoutDaySlots, buildTimetable, timetableCSV, sessionsICS, semesterWeek, reminderPlan, dueSoonCount };
  root.UmSpecPlannerCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
