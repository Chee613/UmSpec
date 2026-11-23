/* Reads the signed-in student's own Spectrum data for the planner. Runs in the Spectrum tab or in the planner page. */
(function (root) {
  'use strict';
  const core = () => root.UmSpecPlannerCore || require('./planner-core.js');
  const ORIGIN = 'https://spectrum.um.edu.my';
  const fail = (code, message) => Object.assign(new Error(message), { code });
  const text = node => (node?.textContent || '').replace(/\s+/g, ' ').trim();

  function requestSignal(signal, ms = 25000) {
    const timeout = AbortSignal.timeout(ms);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
  }
  async function getDoc(url, signal) {
    const response = await fetch(url, { credentials: 'include', signal: requestSignal(signal) });
    const final = new URL(response.url || url);
    if (final.origin !== ORIGIN || /\/login(?:[/.]|$)/i.test(final.pathname)) throw fail('LOGIN_REQUIRED', 'Sign in to Spectrum again.');
    if (!response.ok) throw fail('SPECTRUM_UNAVAILABLE', 'Spectrum page could not be read (' + response.status + ').');
    const html = await response.text();
    if (html.length > 4 * 1024 * 1024) throw fail('CAPACITY', 'Spectrum page is too large.');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (doc.querySelector('form#login, input[name="password"]')) throw fail('LOGIN_REQUIRED', 'Sign in to Spectrum again.');
    return doc;
  }
  async function ajax(sesskey, calls, signal) {
    const names = [...new Set(calls.map(call => call.methodname))].join(',');
    const response = await fetch(ORIGIN + '/lib/ajax/service.php?sesskey=' + encodeURIComponent(sesskey) + '&info=' + encodeURIComponent(names), {
      method: 'POST', credentials: 'include', redirect: 'error', signal: requestSignal(signal), headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(calls.map((call, index) => ({ index, methodname: call.methodname, args: call.args })))
    });
    if (!response.ok) throw fail('SPECTRUM_UNAVAILABLE', 'Spectrum service request failed (' + response.status + ').');
    const payload = await response.json();
    if (!Array.isArray(payload)) throw fail('SPECTRUM_UNAVAILABLE', payload?.exception === 'core\\exception\\moodle_exception' || payload?.errorcode === 'servicerequireslogin' ? 'Sign in to Spectrum again.' : 'Spectrum service response was not recognised.');
    return payload;
  }
  async function one(sesskey, methodname, args, signal) {
    const [result] = await ajax(sesskey, [{ methodname, args }], signal);
    if (!result || result.error) throw fail(result?.exception?.errorcode === 'servicerequireslogin' ? 'LOGIN_REQUIRED' : 'SPECTRUM_UNAVAILABLE', result?.exception?.message || methodname + ' is unavailable.');
    return result.data;
  }
  async function pool(list, size, worker) {
    const results = new Array(list.length); let next = 0;
    await Promise.all(Array.from({ length: Math.min(size, list.length) }, async () => {
      while (next < list.length) { const index = next++; results[index] = await worker(list[index], index); }
    }));
    return results;
  }
  async function sha256(value) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
    return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ---------- Page adaptors: turn Spectrum markup into plain rows for the core rules ----------
  function courseActivities(doc) {
    const out = [], seen = new Set();
    // Each activity is read only from its own <li id="module-N">. Spectrum's theme also nests .activity-item and
    // data-for="cmitem" wrappers whose links can belong to a neighbouring activity, which once paired the
    // OCC 4 tutorial's ID with the OCC 7 tutorial's name.
    const OWNER = 'li.activity[id^="module-"]';
    const own = doc.querySelectorAll(OWNER);
    for (const element of own.length ? own : doc.querySelectorAll('[data-for="cmitem"][data-id]')) {
      // Subsections nest other activities; only nodes that belong to this activity (not a nested one) count.
      const mine = node => !own.length || node.closest(OWNER) === element;
      const first = selector => [...element.querySelectorAll(selector)].find(mine) || null;
      const link = first('a.aalink, .activityname a, .activity-instance a, a[href*="/mod/"]');
      let url; try { url = link ? new URL(link.getAttribute('href') || '', ORIGIN) : null; } catch { url = null; }
      const cmid = (element.id || '').match(/^module-(\d+)$/)?.[1] || element.getAttribute('data-id');
      const modtype = [...element.classList].find(c => c.startsWith('modtype_'))?.slice(8) || url?.pathname.match(/^\/mod\/([a-z0-9_]+)\//)?.[1] || '';
      if (!/^\d+$/.test(cmid || '') || seen.has(cmid) || !modtype) continue;
      seen.add(cmid);
      // A locked activity shows "Not available unless: You belong to GROUP 7 …" and has no link to open.
      const restricted = !link && /not available unless|tidak tersedia melainkan/i.test(text(element));
      // The lock names the group it is for ("You belong to GROUP 7 2026/2027_1"), which is that OCC.
      const lockOcc = restricted ? core().parseOcc(text(element.querySelector('.availabilityinfo, [data-region="availabilityinfo"]') || element).replace(/^[\s\S]*?(?=not available unless|tidak tersedia melainkan)/i, '')) : null;
      const nameNode = (first('.instancename') || first('.activityname') || link)?.cloneNode(true);
      nameNode?.querySelectorAll?.('.accesshide, .sr-only, .visually-hidden, .availabilityinfo, [data-region="availabilityinfo"]').forEach(n => n.remove());
      const section = element.closest('li.section, [data-for="section"], .course-section, section.section');
      // Spectrum's section header also holds hidden "Select section … Collapse" text, so the heading itself is read first.
      const heading = section && ['.sectionname', 'h3', '.section-title', '[data-for="section_title"]'].map(s => section.querySelector(s)).find(Boolean);
      const sectionName = text(heading) || section?.getAttribute('aria-label') || 'General';
      const icon = element.querySelector('img.activityicon, img.iconlarge, .activityiconcontainer img, img')?.getAttribute('src') || '';
      const name = text(nameNode).replace(/\s*(?:Not available unless|Tidak tersedia melainkan)\b.*$/i, '').trim();
      out.push({ cmid, modtype, name: name || element.getAttribute('data-activityname') || 'Activity', url: url ? url.href : '', section: sectionName, icon, restricted, lockOcc });
    }
    return out;
  }
  function attendanceTable(doc) {
    for (const table of doc.querySelectorAll('table')) {
      const headerCells = [...(table.querySelector('thead tr') || table.querySelector('tr'))?.querySelectorAll('th, td') || []].map(text);
      const lower = headerCells.map(h => h.toLowerCase());
      if (!lower.some(h => /date|tarikh/.test(h)) || !lower.some(h => /status/.test(h))) continue;
      const bodyRows = [...table.querySelectorAll('tbody tr')].filter(tr => !tr.querySelector('th') || tr.querySelector('td'));
      return { headers: headerCells, rows: bodyRows.map(tr => ({ cells: [...tr.querySelectorAll('td, th')].map(text), selfMark: Boolean(tr.querySelector('a[href*="/mod/attendance/attendance.php"]')) })) };
    }
    return { headers: [], rows: [] };
  }
  function forumDiscussions(doc) {
    const rows = [...doc.querySelectorAll('[data-region="discussion-list-item"], tr.discussion, .discussion-list .discussion, article.forum-post-container')];
    const scopes = rows.length ? rows : [...doc.querySelectorAll('a[href*="/mod/forum/discuss.php?d="]')].map(a => a.closest('tr, li, article, div') || a);
    const seen = new Set(), out = [];
    for (const row of scopes) {
      const link = row.matches?.('a[href*="discuss.php"]') ? row : row.querySelector('a[href*="/mod/forum/discuss.php?d="]');
      const id = row.getAttribute?.('data-discussionid') || (link ? new URL(link.getAttribute('href'), ORIGIN).searchParams.get('d') : null);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const times = [...row.querySelectorAll('time[datetime], [data-timestamp]')].map(n => n.getAttribute('datetime') ? Date.parse(n.getAttribute('datetime')) : Number(n.getAttribute('data-timestamp')) * 1000).filter(Number.isFinite);
      let time = times.length ? Math.min(...times) : null;
      if (time === null) { const parsed = core().parseSessionTime(text(row)); time = parsed ? parsed.start : null; }
      out.push({ id, title: link?.getAttribute('title') || text(link) || 'Announcement', time, author: text(row.querySelector('.author-info .text-truncate, .author, [data-region="author-name"]')) });
    }
    return out;
  }
  function findSesskey(html) { return String(html).match(/"sesskey"\s*:\s*"([A-Za-z0-9]{6,})"/)?.[1] || null; }
  function findUserId(html) { return String(html).match(/"userId"\s*:\s*(\d+)/)?.[1] || String(html).match(/data-userid="(\d+)"/)?.[1] || null; }

  // ---------- Collection ----------
  async function collect({ sesskey, userId = null, signal = null, progress = () => {}, now = Date.now(), full = true, knownOcc = {} } = {}) {
    const c = core(), warnings = [];
    if (!sesskey) {
      const response = await fetch(ORIGIN + '/my/', { credentials: 'include', signal: requestSignal(signal) });
      const final = new URL(response.url || ORIGIN);
      const html = response.ok && final.origin === ORIGIN && !/\/login/i.test(final.pathname) ? await response.text() : '';
      sesskey = findSesskey(html); userId ||= findUserId(html);
      if (!sesskey) throw fail('LOGIN_REQUIRED', 'Sign in to Spectrum, then refresh the planner.');
    }
    progress('courses', 0);
    let list = (await one(sesskey, 'core_course_get_enrolled_courses_by_timeline_classification', { classification: 'inprogress', limit: 0, offset: 0, sort: 'fullname' }, signal))?.courses || [];
    if (!list.length) {
      list = ((await one(sesskey, 'core_course_get_enrolled_courses_by_timeline_classification', { classification: 'all', limit: 0, offset: 0, sort: 'fullname' }, signal))?.courses || [])
        .filter(x => !x.hidden)
        .sort((a, b) => (Number(b.startdate) || 0) - (Number(a.startdate) || 0) || (Number(b.id) || 0) - (Number(a.id) || 0));
    }
    const courses = list.filter(x => x.id > 1).slice(0, 15).map(x => c.courseMeta({ id: x.id, fullName: x.fullname, shortName: x.shortname }));
    const courseIds = new Set(courses.map(x => x.id));

    progress('deadlines', 10);
    let outstanding = null;
    try {
      const events = []; let after = null;
      for (let page = 0; page < 6; page++) {
        const data = await one(sesskey, 'core_calendar_get_action_events_by_timesort', {
          timesortfrom: Math.floor((now - 120 * c.DAY) / 1000), timesortto: Math.floor((now + 200 * c.DAY) / 1000), limitnum: 50,
          limittononsuspendedevents: true, ...(after ? { aftereventid: after } : {}) }, signal);
        events.push(...(data?.events || []));
        if (!data?.events?.length || data.events.length < 50) break;
        after = data.lastid || data.events.at(-1).id;
      }
      outstanding = c.outstandingFromActionEvents(events);
    } catch (error) { if (error.code === 'LOGIN_REQUIRED') throw error; warnings.push('Submission status unavailable: ' + error.message); }

    const items = new Map();
    const months = [-1, 0, 1, 2, 3].map(offset => { const p = c.mytParts(now); const d = new Date(Date.UTC(p.y, p.m - 1 + offset, 1)); return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 }; });
    await pool(months, 2, async ({ year, month }) => {
      try {
        const data = await one(sesskey, 'core_calendar_get_calendar_monthly_view', { year, month, courseid: 0, categoryid: 0, includenavigation: false, mini: false, day: 1, view: 'month' }, signal);
        for (const week of data?.weeks || []) for (const day of week.days || []) for (const raw of day.events || []) {
          const item = c.classifyEvent(raw, outstanding);
          if (item && (!item.courseId || courseIds.has(item.courseId))) items.set(item.key, item);
        }
      } catch (error) { if (error.code === 'LOGIN_REQUIRED') throw error; warnings.push('Calendar ' + year + '-' + month + ': ' + error.message); }
    });
    progress('calendar', 30);

    const groups = {};
    try {
      const results = await ajax(sesskey, courses.map(x => ({ methodname: 'core_group_get_course_user_groups', args: { courseid: Number(x.id), userid: Number(userId) || 0 } })), signal);
      results.forEach((result, index) => { if (!result.error) groups[courses[index].id] = (result.data?.groups || []).map(g => c.clip(g.name, 80)); });
    } catch {}

    // A full pass also reads course pages (files, announcements); a quick pass relies on the calendar for attendance activities.
    const materials = [], detectedOcc = {}, readCmids = new Set();
    const activitiesByCourse = new Map(courses.map(x => [x.id, c.attendanceFromCalendar([...items.values()], x.id)]));
    let done = 0;
    await pool(courses, 3, async course => {
      try {
        const attendance = new Map(activitiesByCourse.get(course.id).map(a => [a.cmid, a]));
        let activities = null;
        if (full) {
          activities = courseActivities(await getDoc(course.url, signal));
          materials.push(...c.normaliseMaterials(activities, course.id));
          for (const activity of activities) if (activity.modtype === 'attendance' && activity.restricted) attendance.delete(activity.cmid);
          for (const activity of c.attendanceActivities(activities, course.id)) attendance.set(activity.cmid, activity);
          for (const forum of c.newsForumEntries(activities)) {
            try { for (const item of c.announcementItems(forumDiscussions(await getDoc(forum.url, signal)), course.id, now, forum.occ)) items.set(item.key, item); }
            catch (error) { if (error.code === 'LOGIN_REQUIRED') throw error; warnings.push(course.code + ' announcements: ' + error.message); }
          }
        }
        // Spectrum keeps one attendance activity per OCC (12 in WIA2001). A quick pass reads only the known OCC's reports;
        // a full pass reads every report the student can open, so a wrong remembered OCC is corrected.
        const sessions = [];
        await pool(c.attendanceToRead([...attendance.values()], full ? null : knownOcc[course.id]).slice(0, 20), 2, async activity => {
          try {
            const page = await getDoc(ORIGIN + '/mod/attendance/view.php?id=' + activity.cmid + '&view=5', signal);
            const rows = c.parseAttendanceRows(attendanceTable(page), activity);
            if (rows.length) readCmids.add(activity.cmid);
            sessions.push(...rows);
          } catch (error) { if (error.code === 'LOGIN_REQUIRED') throw error; warnings.push(course.code + ' attendance: ' + error.message); }
        });
        for (const item of c.attendanceItems(sessions)) items.set(item.key, item);
        const detected = c.detectOcc({ groups: [...(groups[course.id] || []), ...c.calendarGroups([...items.values()], course.id)], sessions, activities });
        if (detected) detectedOcc[course.id] = detected;
      } catch (error) {
        if (error.code === 'LOGIN_REQUIRED' || signal?.aborted) throw error;
        warnings.push(course.code + ': ' + error.message);
      }
      progress('courses', 30 + Math.round(++done / Math.max(1, courses.length) * 65));
    });
    // Calendar copies of attendance sessions stay only where the attendance report itself was not read.
    for (const [key, item] of items) {
      if (item.kind !== 'attendance' || !key.startsWith('cal:')) continue;
      if (readCmids.has(c.cmidFromUrl(item.url))) items.delete(key);
      else Object.assign(item, { statusKind: 'unmarked', sessionType: c.sessionType(item.title), canSelfMark: false });
    }
    progress('saving', 98);
    return c.sanitizePlannerData({ collectedAt: now, fullAt: full ? now : null, userHash: userId ? await sha256('umspec-planner:' + userId) : '', courses, items: [...items.values()], materials,
      detectedOcc, statusKnown: Boolean(outstanding), warnings }, now);
  }

  // ---------- Files for preview and course packs ----------
  function isContentPluginFile(url) {
    return url.origin === ORIGIN && /\/pluginfile\.php\//.test(url.pathname) && !/\/(?:user\/icon|theme|course\/overviewfiles)\//.test(url.pathname);
  }
  function folderFiles(doc, baseUrl) {
    const scope = doc.querySelector('#region-main .foldertree, #region-main .foldercontent, #region-main [role="main"], #region-main') || doc;
    const seen = new Set(), out = [];
    for (const a of scope.querySelectorAll('a[href*="pluginfile.php"]')) {
      let fileUrl;
      try { fileUrl = new URL(a.getAttribute('href'), baseUrl); } catch { continue; }
      if (!isContentPluginFile(fileUrl)) continue;
      fileUrl.searchParams.delete('forcedownload');
      const href = fileUrl.href;
      if (seen.has(href)) continue;
      seen.add(href);
      let name = '';
      try { name = decodeURIComponent(fileUrl.pathname.split('/').pop() || ''); } catch {}
      out.push({ url: href, name: name || text(a) || 'file' });
    }
    return out;
  }
  async function fetchResolvedFile(href, fallbackName, signal) {
    const fileUrl = new URL(href, ORIGIN);
    if (fileUrl.origin !== ORIGIN) return { kind: 'link', url: fileUrl.href };
    fileUrl.searchParams.delete('forcedownload');
    const file = await fetch(fileUrl.href, { credentials: 'include', signal: requestSignal(signal, 60000) });
    const final = new URL(file.url || fileUrl.href);
    if (final.origin !== ORIGIN || /\/login(?:[/.]|$)/i.test(final.pathname)) throw fail('LOGIN_REQUIRED', 'Sign in to Spectrum again.');
    if (!file.ok) throw fail('SPECTRUM_UNAVAILABLE', 'File could not be read (' + file.status + ').');
    let name = fallbackName || 'file';
    try { name = decodeURIComponent(final.pathname.split('/').pop() || name); } catch {}
    return { kind: 'file', response: file, type: file.headers.get('Content-Type') || '', url: final.href, name };
  }
  async function resolveFile(material, signal) {
    const url = new URL(material.url);
    if (url.origin !== ORIGIN) return { kind: 'link', url: url.href };
    const response = await fetch(url.href, { credentials: 'include', signal: requestSignal(signal, 60000) });
    const final = new URL(response.url || url.href);
    if (final.origin !== ORIGIN || /\/login(?:[/.]|$)/i.test(final.pathname)) throw fail('LOGIN_REQUIRED', 'Sign in to Spectrum again.');
    if (!response.ok) throw fail('SPECTRUM_UNAVAILABLE', 'File could not be read (' + response.status + ').');
    const type = response.headers.get('Content-Type') || '';
    if (!type.includes('text/html')) {
      let name = material.name;
      try { name = decodeURIComponent(final.pathname.split('/').pop() || name); } catch {}
      return { kind: 'file', response, type, url: final.href, name };
    }
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    if (material.modtype === 'folder' || /\/mod\/folder\/view\.php$/i.test(final.pathname)) {
      const files = folderFiles(doc, final.href);
      return files.length ? { kind: 'folder', url: final.href, files } : { kind: 'page', url: final.href };
    }
    const main = doc.querySelector('#region-main') || doc;
    const node = main.querySelector('.resourceworkaround a, .resourcecontent object[data], .resourcecontent a[href*="pluginfile.php"], .resourcecontent iframe[src*="pluginfile.php"]') ||
      [...main.querySelectorAll('a[href*="pluginfile.php"]')].find(a => { try { return isContentPluginFile(new URL(a.getAttribute('href'), final.href)); } catch { return false; } });
    const target = node?.getAttribute('data') || node?.getAttribute('src') || node?.getAttribute('href');
    if (!target) return { kind: 'page', url: final.href };
    const fileUrl = new URL(target, final.href);
    if (fileUrl.origin !== ORIGIN) return { kind: 'link', url: fileUrl.href };
    return fetchResolvedFile(fileUrl.href, material.name, signal);
  }

  const api = { collect, resolveFile, fetchResolvedFile, folderFiles, courseActivities, attendanceTable, forumDiscussions, findSesskey, findUserId };
  root.UmSpecPlannerCollect = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
