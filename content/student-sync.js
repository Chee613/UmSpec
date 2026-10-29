(function (root) {
  'use strict';
  const ORIGIN = 'https://spectrum.um.edu.my';
  const dep = (name, file) => root[name] || (typeof require === 'function' ? require(file) : null);
  const core = () => dep('UmSpecCalendarCore', '../shared/calendar-core.js');
  const announcements = () => dep('UmSpecAnnouncements', '../shared/announcement-core.js');
  const hash = parts => dep('UmSpecSync', '../shared/sync-core.js').hashParts(parts);
  const exporter = () => root.UmSpecExporter;
  const fail = (code, message) => Object.assign(new Error(message), { code });
  const positiveId = value => /^[1-9]\d*$/.test(String(value ?? ''));
  function safeSpectrumUrl(value, base = ORIGIN) {
    const url = new URL(value, base);
    if (url.origin !== ORIGIN || url.username || url.password ||
        !/^\/(?:course\/view|mod\/forum\/(?:view|discuss)|calendar\/view)\.php$/.test(url.pathname) ||
        [...url.searchParams.keys()].some(key => /sesskey|token|password|secret|authorization/i.test(key))) {
      throw fail('UNSAFE_SOURCE', 'Unsupported Spectrum source URL.');
    }
    return url.href;
  }
  function calendarMonths(now = new Date()) {
    const malaysia = new Date(new Date(now).getTime() + 8 * 3600000);
    if (!Number.isFinite(malaysia.getTime())) throw new TypeError('Invalid scan date');
    return Array.from({ length: 6 }, (_, index) => {
      const month = new Date(Date.UTC(malaysia.getUTCFullYear(), malaysia.getUTCMonth() + index, 1));
      return { year: month.getUTCFullYear(), month: month.getUTCMonth() + 1 };
    });
  }
  function shouldRunFeature(feature, status, automatic, now = Date.now()) {
    const settings = status.settings || {};
    const job = feature === 'drive' ? status.job : feature === 'calendar' ? status.calendarJob : null;
    if (automatic && job?.scopeChanged) return false;
    const featureEnabled = feature === 'drive' ? settings.mode === 'drive' : feature === 'calendar' ? settings.calendarEnabled : settings.announcementScanning;
    if (automatic && job && !job.done && featureEnabled) return job.status === 'running';
    const enabled = feature === 'drive' ? settings.mode === 'drive' && (!automatic || settings.autoSync) :
      feature === 'calendar' ? settings.calendarEnabled : settings.announcementScanning;
    const attempted = status.syncTimes?.[feature]?.lastAttemptAt;
    return Boolean(enabled && (!automatic || !attempted || now - attempted >= 15 * 60000));
  }
  function plainText(value) {
    if (typeof document === 'undefined') return String(value || '').replace(/<[^>]*>/g, ' ').trim();
    return new DOMParser().parseFromString(String(value || ''), 'text/html').body.textContent.trim();
  }
  async function adaptCalendarResponse(payload, selectedIds) {
    const data = payload?.[0]?.data;
    if (!Array.isArray(payload) || payload.length !== 1 || payload[0]?.error || !Array.isArray(data?.weeks)) {
      throw fail('CALENDAR_UNAVAILABLE', 'Official calendar sync unavailable on this Spectrum version.');
    }
    const selected = new Set(selectedIds.map(String)), records = [];
    for (const week of data.weeks) {
      if (!Array.isArray(week.days)) throw fail('CALENDAR_UNAVAILABLE', 'Calendar week structure was not recognised.');
      for (const day of week.days) {
        if (!Array.isArray(day.events)) throw fail('CALENDAR_UNAVAILABLE', 'Calendar day structure was not recognised.');
        for (const raw of day.events) {
          const courseId = String(raw.course?.id ?? raw.courseid ?? '');
          if (!selected.has(courseId)) continue;
          const type = String(raw.eventtype || '').toLowerCase();
          const deadline = ['assign', 'quiz'].includes(raw.modulename) && ['due', 'close'].includes(type);
          if (!deadline && type !== 'course') continue;
          if (!positiveId(raw.id) || !Number.isInteger(raw.timestart) || !Number.isInteger(raw.timeduration) || raw.timeduration < 0) {
            throw fail('CALENDAR_UNAVAILABLE', 'An official calendar item has unsupported timestamps.');
          }
          const title = plainText(raw.name), description = plainText(raw.description);
          let sourceUrl = ORIGIN + '/calendar/view.php?view=event&id=' + raw.id;
          try {
            const activity = new URL(raw.url, ORIGIN);
            if (activity.origin === ORIGIN && !activity.username && !activity.password &&
                /^\/mod\/(?:assign|quiz)\/view\.php$/.test(activity.pathname) && positiveId(activity.searchParams.get('id')) &&
                ![...activity.searchParams.keys()].some(key => /sesskey|token|password|secret|authorization/i.test(key))) sourceUrl = activity.href;
          } catch {}
          const revision = await hash([String(raw.id), courseId, title, description, raw.timestart, raw.timeduration, raw.timemodified ?? null]);
          records.push(core().normaliseMoodleEvent({ id: raw.id, courseId, title, description,
            kind: deadline ? 'deadline' : 'meeting', startSeconds: raw.timestart,
            durationSeconds: raw.timeduration, revision }, sourceUrl));
        }
      }
    }
    return records;
  }
  function makeReviewFields(candidate, values) {
    const instant = (date, time) => date && time ? date + 'T' + time + (time.length === 5 ? ':00' : '') + '+08:00' : null;
    const result = {
      reviewedRevision: candidate.sourceRevision, title: values.title ?? candidate.title,
      kind: values.kind ?? candidate.kind, precision: values.time ? 'instant' : 'date',
      start: values.time ? instant(values.date, values.time) : values.date || null,
      end: values.time ? instant(values.endDate || values.date, values.endTime) : values.endDate || null,
      meetingUrl: values.meetingUrl || null
    };
    if (values.durationMinutes) result.durationMinutes = Number(values.durationMinutes);
    return result;
  }
  function requestSignal(signal) {
    const timeout = AbortSignal.timeout(20000);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
  }
  async function discoverOfficialEvents(courseIds, signal, now = new Date()) {
    const records = new Map(), failures = [];
    const sesskey = exporter()?.getSesskey();
    if (!sesskey) return { records: [], complete: false, failures: [{ message: 'Sign in to Spectrum before scanning dates.' }] };
    for (const { year, month } of calendarMonths(now)) {
      try {
        const response = await fetch(ORIGIN + '/lib/ajax/service.php?sesskey=' + encodeURIComponent(sesskey) + '&info=core_calendar_get_calendar_monthly_view', {
          method: 'POST', credentials: 'include', redirect: 'error', signal: requestSignal(signal),
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([{ index: 0, methodname: 'core_calendar_get_calendar_monthly_view', args: {
            year, month, courseid: 0, categoryid: 0, includenavigation: false, mini: false, day: 1, view: 'month'
          } }])
        });
        if (!response.ok) throw fail('CALENDAR_UNAVAILABLE', 'Official calendar read was denied (' + response.status + ').');
        const items = await adaptCalendarResponse(await response.json(), courseIds);
        for (const record of items) records.set(record.sourceKey, record);
      } catch (error) {
        failures.push({ year, month, message: error.code === 'CALENDAR_UNAVAILABLE' ? error.message : 'Could not read this Spectrum calendar month.' });
        // ponytail: one denied schema is enough; retry the six-month scan on the next eligible visit.
        break;
      }
    }
    return { records: [...records.values()], complete: !failures.length, failures };
  }
  function announcementForum(name, value) {
    if (!/^(?:announcements?|news(?: forum)?|pengumuman(?: kursus)?)(?:\s+forum)?$/i.test(String(name || '').trim())) return null;
    try {
      const url = new URL(safeSpectrumUrl(value));
      return url.pathname === '/mod/forum/view.php' && (positiveId(url.searchParams.get('id')) || positiveId(url.searchParams.get('f'))) ? url.href : null;
    } catch { return null; }
  }
  function safeForumPage(value, forumUrl, forumId) {
    const url = new URL(safeSpectrumUrl(value)), original = new URL(forumUrl, ORIGIN);
    const sameId = ['id', 'f'].some(key => positiveId(original.searchParams.get(key)) && url.searchParams.get(key) === original.searchParams.get(key));
    if (url.pathname !== '/mod/forum/view.php' || (!sameId && (!positiveId(forumId) || url.searchParams.get('f') !== String(forumId)))) {
      throw fail('ANNOUNCEMENTS_UNAVAILABLE', 'Announcement pagination changed forum identity.');
    }
    return url.href;
  }
  async function fetchPage(value, signal) {
    const url = safeSpectrumUrl(value);
    const response = await fetch(url, { credentials: 'include', signal: requestSignal(signal) });
    if (!response.ok) throw fail('SPECTRUM_UNAVAILABLE', 'Spectrum page could not be read (' + response.status + ').');
    if (response.url) safeSpectrumUrl(response.url);
    const html = await response.text();
    if (html.length > 2 * 1024 * 1024) throw fail('CAPACITY', 'This Spectrum page is too large for one scan.');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (doc.querySelector('form#login,form[action*="/login/index.php"]')) throw fail('LOGIN_REQUIRED', 'Sign in to Spectrum to resume scanning.');
    return doc;
  }
  function forumIdFrom(doc, url) {
    const fromUrl = new URL(url).searchParams.get('f');
    const element = doc.querySelector('[data-forumid],[data-forum-id],input[name="f"],input[name="forum"]');
    const value = fromUrl || element?.getAttribute('data-forumid') || element?.getAttribute('data-forum-id') || element?.value;
    if (positiveId(value)) return String(value);
    for (const link of doc.querySelectorAll('nav a[href*="/mod/forum/view.php"],.breadcrumb a[href*="/mod/forum/view.php"]')) {
      try { const id = new URL(link.getAttribute('href'), url).searchParams.get('f'); if (positiveId(id)) return id; } catch {}
    }
    return null;
  }
  function postFromDocument(doc, source, courseId, forumId, expectedPostId) {
    const container = expectedPostId ? doc.getElementById('p' + expectedPostId) || doc.querySelector('[data-post-id="' + expectedPostId + '"]') :
      doc.querySelector('.forumpost,[data-region="post"][data-post-id]');
    const postId = container?.getAttribute('data-post-id') || container?.getAttribute('data-postid') || container?.id?.match(/^p(\d+)$/)?.[1];
    const body = container?.querySelector('[data-region="post-content"],.posting,.post-content-container,.post-content,.content .no-overflow');
    const verifiedForum = forumIdFrom(doc, source) || forumId;
    if (!positiveId(postId) || !body || !positiveId(verifiedForum) || (forumId && verifiedForum !== String(forumId))) {
      throw fail('ANNOUNCEMENTS_UNAVAILABLE', 'Announcement post or forum identity is not exposed by this Spectrum layout.');
    }
    const clone = body.cloneNode(true);
    clone.querySelectorAll('script,style,blockquote,.forum-post-quoted,.commands,.forum-post-footer').forEach(element => element.remove());
    clone.querySelectorAll('br').forEach(element => element.replaceWith('\n'));
    clone.querySelectorAll('p,div,li').forEach(element => element.append('\n'));
    const url = new URL(source);
    url.hash = 'p' + postId;
    const timestamp = selector => {
      const element = container.querySelector(selector);
      const explicit = element?.getAttribute('datetime');
      if (explicit) return explicit;
      const seconds = element?.getAttribute('data-timestamp');
      return /^\d{1,12}$/.test(seconds || '') ? new Date(Number(seconds) * 1000).toISOString() : null;
    };
    return {
      courseId: String(courseId), forumId: verifiedForum, postId: String(postId), sourceUrl: url.href,
      title: (container.querySelector('.subject,[data-region="post-subject"]')?.textContent || doc.querySelector('h1,h2')?.textContent || 'Announcement').trim(),
      text: clone.textContent,
      publishedAt: timestamp('.author time[datetime],[data-region="post-date"] time[datetime],time[datetime],[data-timestamp]'),
      modifiedAt: timestamp('.edited time[datetime],[data-region="post-edited"] time[datetime]'),
      links: [...clone.querySelectorAll('a[href]')].map(link => {
        try { return new URL(link.getAttribute('href'), source).href; } catch { return ''; }
      }).filter(Boolean)
    };
  }
  async function refreshPost(candidate, signal) {
    const doc = await fetchPage(candidate.sourceUrl, signal);
    return announcements().normalisePost(postFromDocument(doc, candidate.sourceUrl, candidate.courseId, candidate.forumId, candidate.postId));
  }
  async function discoverAnnouncements(courseIds, signal, cursor = null) {
    const posts = [], failures = [];
    let resume = cursor;
    for (const courseId of courseIds.map(String)) {
      if (resume?.courseId && resume.courseId !== courseId) continue;
      let forums = [], current = { courseId, forumUrl: null, listingUrl: null, threadOffset: 0 };
      try {
        const course = await fetchPage(ORIGIN + '/course/view.php?id=' + courseId, signal);
        for (const link of course.querySelectorAll('a[href*="/mod/forum/view.php"]')) {
          const name = link.querySelector('.instancename')?.cloneNode(true) || link.cloneNode(true);
          name.querySelectorAll('.accesshide,.sr-only,.icon').forEach(element => element.remove());
          const url = announcementForum(name.textContent, new URL(link.getAttribute('href'), ORIGIN).href);
          if (url && !forums.includes(url)) forums.push(url);
        }
        let count = 0;
        for (const forumUrl of forums) {
          if (resume?.forumUrl && resume.forumUrl !== forumUrl) continue;
          let listingUrl = safeForumPage(resume?.listingUrl || forumUrl, forumUrl, resume?.forumId), offset = resume?.threadOffset || 0;
          const pages = new Set();
          while (listingUrl) {
            current = { courseId, forumUrl, listingUrl, threadOffset: offset };
            if (pages.has(listingUrl) || pages.size >= 100) throw fail('ANNOUNCEMENTS_UNAVAILABLE', 'Announcement pagination needs a layout review.');
            pages.add(listingUrl);
            const listing = await fetchPage(listingUrl, signal), forumId = forumIdFrom(listing, forumUrl);
            current.forumId = forumId;
            const threads = [...new Set([...listing.querySelectorAll('a[href*="/mod/forum/discuss.php"]')].map(link => {
              try {
                const url = new URL(safeSpectrumUrl(new URL(link.getAttribute('href'), listingUrl).href));
                const discussion = url.searchParams.get('d');
                return positiveId(discussion) ? ORIGIN + '/mod/forum/discuss.php?d=' + discussion : null;
              } catch { return null; }
            }).filter(Boolean))];
            for (let index = offset; index < threads.length; index++) {
              current.threadOffset = index;
              if (count >= 100 || posts.length >= 100) return { posts, complete: false, cursor: current, failures };
              const thread = await fetchPage(threads[index], signal);
              posts.push(await announcements().normalisePost(postFromDocument(thread, threads[index], courseId, forumId)));
              count++;
            }
            const next = listing.querySelector('a[rel="next"],.paging a.next,.pagination .next:not(.disabled) a');
            listingUrl = next ? safeForumPage(new URL(next.getAttribute('href'), listingUrl).href, forumUrl, forumId) : null;
            offset = 0;
            resume = null;
          }
        }
        if (resume?.forumUrl && !forums.includes(resume.forumUrl)) throw fail('ANNOUNCEMENTS_UNAVAILABLE', 'Saved announcement forum is no longer visible.');
        resume = null;
      } catch (error) {
        failures.push({ courseId, message: error.code ? error.message : 'Could not read this course announcement layout.' });
        return { posts, complete: false, cursor: current, failures };
      }
    }
    return { posts, complete: true, cursor: null, failures };
  }
  let status = null, running = null, controller = null, notice = '';
  function messageText(message) {
    notice = message;
    if (typeof document !== 'undefined') {
      const output = document.getElementById('umspec-sync-status');
      if (output) output.textContent = message;
    }
  }
  async function command(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw fail(response?.error?.code || 'WORKER_UNAVAILABLE', response?.error?.message || 'Reopen the extension to restore sync.');
    status = response.data;
    renderPanel();
    return status;
  }
  async function contextStatus() {
    const bridge = exporter();
    const context = bridge?.verifyContext ? await bridge.verifyContext() : bridge?.getContext();
    if (!context || context.origin !== ORIGIN || !positiveId(context.userId)) throw fail('LOGIN_REQUIRED', 'Open your signed-in Spectrum page to set up sync.');
    return command({ type: 'SET_CONTEXT', userId: context.userId });
  }
  function linked(feature) { return status?.configured && status.account?.features?.includes(feature); }
  async function runDrive(automatic, signal) {
    if (!linked('drive')) throw fail('CONNECT_REQUIRED', status?.configured ? 'Connect Google Drive from the extension popup.' : 'Google setup is required. ZIP and local announcement review remain available.');
    if (!status.settings.archiveId) throw fail('ARCHIVE_REQUIRED', 'Enter and save a semester archive name before syncing to Drive.');
    let job = status.job;
    if (job && !job.done && !job.scopeChanged) {
      await command({ type: 'BEGIN_DRIVE_SYNC', bindingHash: status.bindingHash, materials: [], retry: !automatic });
    } else {
      messageText('Checking selected courses for fresh material…');
      const courses = await exporter().discoverCourses();
      const selected = new Set(status.settings.courseIds), materials = [];
      for (const course of courses.filter(course => selected.has(String(course.id)))) {
        materials.push(...await exporter().resolveCourseMaterials(course, automatic ? null : exporter().selectedUrls(course.id), signal));
        selected.delete(String(course.id));
      }
      if (selected.size) throw fail('PARTIAL_SCAN', 'Some selected courses are unavailable. Reopen the course list before syncing.');
      await command({ type: 'BEGIN_DRIVE_SYNC', bindingHash: status.bindingHash, materials, retry: !automatic, freshInventory: Boolean(job?.scopeChanged) });
    }
    while (status.job && !status.job.done && status.job.status === 'running' && !signal.aborted) {
      job = status.job;
      if (job.tabId != null && job.tabId !== status.tabId) throw fail('BUSY', 'Drive sync is running in another Spectrum tab.');
      messageText('Drive sync: ' + job.cursor + ' of ' + job.total + ' items checked.');
      await command({ type: 'DRIVE_STEP', jobId: job.id, bindingHash: status.bindingHash });
    }
    if (status.job?.error) throw fail(status.job.error.code, status.job.error.message);
    const summary = status.job?.summary;
    if (status.job?.done && (summary?.failed || summary?.conflicts)) {
      throw fail('PARTIAL_SYNC', 'Drive sync: ' + (summary.failed || 0) + ' failed, ' + (summary.conflicts || 0) +
        ' conflict(s). Retry failed items or open Drive to review edits and restore removed files.');
    }
  }
  async function runCalendar(automatic, signal) {
    if (!linked('calendar')) throw fail('CONNECT_REQUIRED', 'Connect Google Calendar from the extension popup.');
    if (status.calendarJob && !status.calendarJob.done && !status.calendarJob.scopeChanged) {
      await command({ type: 'BEGIN_CALENDAR_SYNC', records: [], complete: status.calendarJob.complete === true });
    } else {
      messageText('Reading the next six months of official Spectrum dates…');
      const scan = await discoverOfficialEvents(status.settings.courseIds, signal);
      await command({ type: 'BEGIN_CALENDAR_SYNC', records: scan.records, complete: scan.complete, freshInventory: Boolean(status.calendarJob?.scopeChanged) });
      if (scan.failures.length) messageText(scan.failures[0].message + ' Previous calendar entries are retained.');
      status._calendarScanWarning = scan.failures[0]?.message;
    }
    const warning = status._calendarScanWarning;
    while (status.calendarJob && !status.calendarJob.done && status.calendarJob.status === 'running' && !status.calendarJob.error && !signal.aborted) {
      if (status.calendarJob.tabId != null && status.calendarJob.tabId !== status.tabId) throw fail('BUSY', 'Calendar sync is running in another Spectrum tab.');
      await command({ type: 'CALENDAR_STEP', jobId: status.calendarJob.id });
    }
    if (status.calendarJob?.error) throw fail(status.calendarJob.error.code, status.calendarJob.error.message);
    const unresolved = (status.calendarJob?.results || []).filter(result => ['review', 'restore'].includes(result.action)).length;
    if (status.calendarJob?.done && unresolved) throw fail('REVIEW_REQUIRED', unresolved + ' calendar dates need review. Open Google Calendar to check edits or restore removed entries.' + (warning ? ' ' + warning : ''));
    if (warning) throw fail('PARTIAL_SCAN', warning + ' Previously synced dates were retained.');
  }
  async function runAnnouncements(signal) {
    messageText('Reading selected-course announcements locally…');
    const scan = await discoverAnnouncements(status.settings.courseIds, signal, status.announcementCursor);
    await command({ type: 'QUEUE_ANNOUNCEMENTS', posts: scan.posts, complete: scan.complete, cursor: scan.cursor });
    if (scan.failures.length) throw fail('PARTIAL_SCAN', scan.failures[0].message + ' Previous reviews were retained.');
    if (!scan.complete) throw fail('PARTIAL_SCAN', 'Announcement pass saved. More posts will be checked on the next visit or Sync now.');
  }
  async function performSync(automatic) {
    await contextStatus();
    if (!automatic) {
      let selected = exporter().selectedCourses().map(course => String(course.id));
      if (!selected.length && typeof document !== 'undefined' && !document.getElementById('umspec-courses-container')) selected = status.settings.courseIds;
      if (!selected.length) throw fail('SELECT_COURSES', 'Select at least one course above.');
      await command({ type: 'SAVE_SETTINGS', settings: {
        courseIds: selected, videoPolicy: exporter().videoPolicy()
      } });
    }
    if (!status.settings.courseIds.length) return status;
    const errors = [];
    const signal = controller.signal;
    for (const [feature, run] of [['drive', () => runDrive(automatic, signal)], ['calendar', () => runCalendar(automatic, signal)], ['announcements', () => runAnnouncements(signal)]]) {
      if (signal.aborted || !shouldRunFeature(feature, status, automatic)) continue;
      try { await run(); }
      catch (error) {
        if (error.name === 'AbortError' || signal.aborted) break;
        errors.push(error.message);
      }
    }
    messageText(signal.aborted ? 'Sync paused. Reopen Spectrum or choose Sync now to continue.' : errors.length ? errors.join(' ') : 'Selected features are up to date.');
    return status;
  }
  function syncNow(options = {}) {
    if (running) return running;
    controller = new AbortController();
    running = performSync(options.automatic === true).catch(error => { messageText(error.message); throw error; }).finally(() => {
      running = null; controller = null; renderPanel();
    });
    renderPanel();
    return running;
  }
  async function exportOrSync() {
    await command({ type: 'GET_STATUS' });
    if (status.settings.mode !== 'drive') return false;
    await contextStatus();
    await syncNow();
    return true;
  }
  async function refreshPanel() {
    try { await contextStatus(); }
    catch (error) { messageText(error.message); }
    return status;
  }
  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text != null) element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  function externalLink(title, value) {
    const link = node('a', title);
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password) return node('span', title);
      link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
    } catch { return node('span', title); }
    return link;
  }
  function field(parent, title, type, value = '') {
    const label = node('label', title), input = node('input');
    input.type = type; input.value = value; label.append(input); parent.append(label);
    return input;
  }
  let reviewPage = 0, upcomingPage = 0, changesPage = 0;
  function wireTabs(parent, group) {
    const buttons = [...parent.querySelectorAll('[data-' + group + '-tab]')];
    const select = button => {
      const value = button.getAttribute('data-' + group + '-tab');
      for (const tab of buttons) {
        tab.setAttribute('aria-selected', String(tab === button)); tab.tabIndex = tab === button ? 0 : -1;
      }
      parent.querySelectorAll('[data-' + group + '-view]').forEach(view => { view.hidden = view.getAttribute('data-' + group + '-view') !== value; });
    };
    for (const button of buttons) {
      button.addEventListener('click', () => select(button));
      button.addEventListener('keydown', event => {
        let index = buttons.indexOf(button);
        if (event.key === 'ArrowRight') index = (index + 1) % buttons.length;
        else if (event.key === 'ArrowLeft') index = (index + buttons.length - 1) % buttons.length;
        else if (event.key === 'Home') index = 0;
        else if (event.key === 'End') index = buttons.length - 1;
        else return;
        event.preventDefault(); select(buttons[index]); buttons[index].focus();
      });
    }
    if (buttons.length) select(buttons[0]);
  }
  function pager(parent, count, page, size, change) {
    if (count <= size) return;
    const nav = node('nav', null, 'umspec-pager'); nav.setAttribute('aria-label', 'List pages');
    const previous = node('button', 'Previous'), next = node('button', 'Next');
    previous.type = next.type = 'button'; previous.disabled = page === 0; next.disabled = (page + 1) * size >= count;
    previous.onclick = () => change(page - 1); next.onclick = () => change(page + 1);
    nav.append(previous, node('span', (page + 1) + ' / ' + Math.ceil(count / size)), next); parent.append(nav);
  }
  function renderReviews(modal) {
    const candidates = status.candidates || [], events = status.events || [];
    reviewPage = Math.min(reviewPage, Math.max(0, candidates.length - 1));
    const signature = JSON.stringify([reviewPage, candidates.map(c => [c.candidateId, c.sourceRevision, c.state]), events.map(e => [e.sourceKey, e.sourceRevision]), linked('calendar'), status.settings.calendarEnabled]);
    const target = modal.querySelector('[data-sync-reviews]');
    if (target._signature === signature) return;
    target._signature = signature;
    target.replaceChildren();
    modal.querySelector('[data-review-count]').textContent = candidates.length ? ' (' + candidates.length + ')' : '';
    if (!candidates.length) { target.append(node('p', 'No dates to review. Turn on announcement checks in Settings.')); return; }
    const candidate = candidates[reviewPage];
    const row = node('article', null, 'umspec-sync-review');
    const heading = node('h4', candidate.title); heading.title = candidate.title; row.append(heading);
    const evidence = node('p', candidate.evidence, 'umspec-evidence'); evidence.title = candidate.evidence; row.append(evidence);
    row.append(externalLink('Read announcement', candidate.sourceUrl));
    if (candidate.meetingUrl) row.append(externalLink('Meeting link', candidate.meetingUrl));
    if (candidate.cancellationSuggested) row.append(node('p', 'Possible cancellation. Check the existing event in Google Calendar.'));
    const tablist = node('div', null, 'umspec-subtabs'); tablist.setAttribute('role', 'tablist'); tablist.setAttribute('aria-label', 'Review fields');
    tablist.innerHTML = '<button type="button" role="tab" data-review-tab="date" aria-controls="umspec-review-date">Date & time</button><button type="button" role="tab" data-review-tab="details" aria-controls="umspec-review-details">More details</button>';
    row.append(tablist);
    const inputs = node('div', null, 'umspec-sync-fields'); inputs.id = 'umspec-review-date'; inputs.dataset.reviewView = 'date'; inputs.setAttribute('role', 'tabpanel');
    const date = field(inputs, 'Date (Malaysia)', 'date', candidate.suggestedStart?.slice(0, 10));
    const time = field(inputs, 'Start time', 'time', candidate.precision === 'instant' ? candidate.suggestedStart?.slice(11, 16) : '');
    const endTime = field(inputs, 'End time', 'time', candidate.suggestedEnd?.slice(11, 16));
    const duration = field(inputs, 'Or duration (minutes)', 'number'); duration.min = '1'; duration.max = '10080';
    const details = node('div', null, 'umspec-sync-fields'); details.id = 'umspec-review-details'; details.dataset.reviewView = 'details'; details.setAttribute('role', 'tabpanel');
    const title = field(details, 'Event title', 'text', candidate.title); title.maxLength = 500;
    const endDate = field(details, 'End date (if different)', 'date', candidate.suggestedEnd?.slice(0, 10));
    const meeting = field(details, 'Meeting URL', 'url', candidate.meetingUrl || '');
    row.append(inputs, details);
    const duplicate = candidate.linkedActivityUrl && events.find(event => event.sourceUrl === candidate.linkedActivityUrl);
    let separate = null;
    if (duplicate) {
      row.append(externalLink('Existing official event', duplicate.sourceUrl));
      separate = field(row, 'Add a separate event', 'checkbox');
    }
    const actions = node('div', null, 'umspec-sync-actions');
    const accept = node('button', 'Save to Calendar');
    const allowed = () => linked('calendar') && status.settings.calendarEnabled && !candidate.cancellationSuggested && (!duplicate || separate?.checked);
    accept.type = 'button'; accept.disabled = !allowed();
    if (!linked('calendar') || !status.settings.calendarEnabled) row.append(node('p', 'Connect and enable Calendar in the UM Spec toolbar popup.', 'umspec-helper'));
    separate?.addEventListener('change', () => { accept.disabled = !allowed(); });
    accept.addEventListener('click', async () => {
      accept.disabled = true;
      try {
        messageText('Checking the announcement before saving…');
        const refreshedPost = await refreshPost(candidate);
        const editedFields = makeReviewFields(candidate, { title: title.value, date: date.value, time: time.value,
          endDate: endDate.value, endTime: endTime.value, durationMinutes: duration.value, meetingUrl: meeting.value });
        const validation = announcements().validateReview(candidate, editedFields);
        if (!validation.valid) throw fail('INVALID_REVIEW', validation.reasons.join(' '));
        let result = await command({ type: 'REVIEW_ANNOUNCEMENT', candidateId: candidate.candidateId, refreshedPost, editedFields });
        if (result.retryReview) result = await command({ type: 'REVIEW_ANNOUNCEMENT', candidateId: candidate.candidateId, refreshedPost, editedFields });
        messageText(result.retryReview ? 'Calendar setup is pending. Try again.' : 'Date saved to your UM Spec calendar.');
      } catch (error) { messageText(error.message); accept.disabled = !allowed(); }
    });
    const ignore = node('button', 'Ignore'); ignore.type = 'button';
    ignore.addEventListener('click', () => command({ type: 'IGNORE_ANNOUNCEMENT', candidateId: candidate.candidateId }).catch(error => messageText(error.message)));
    actions.append(accept, ignore); row.append(actions); target.append(row);
    wireTabs(row, 'review');
    pager(target, candidates.length, reviewPage, 1, page => { reviewPage = page; renderPanel(); });
  }
  function renderPanel() {
    if (!status) return;
    exporter()?.applySettings?.(status.settings);
    if (typeof document === 'undefined') return;
    const panel = document.getElementById('umspec-sync-panel'), modal = document.getElementById('umspec-modal');
    if (!panel || !modal) return;
    panel.querySelectorAll('input, select, [data-sync-save]').forEach(input => { input.disabled = Boolean(panel._saving); });
    const destination = modal.querySelector('[name="mode"]'); destination.disabled = destination.dataset.saving === 'true';
    const settings = status.settings;
    const reminders = panel.querySelector('[name="reminders"]'), reminderValue = (settings.reminderMinutes || []).join(',');
    if (![...reminders.options].some(option => option.value === reminderValue)) {
      const option = node('option', (settings.reminderMinutes || []).join(' and ') + ' minutes before');
      option.value = reminderValue; reminders.append(option);
    }
    const setValue = (selector, value, checkbox = false) => {
      const input = modal.querySelector(selector);
      if (input && document.activeElement !== input) input[checkbox ? 'checked' : 'value'] = value;
    };
    setValue('[name="mode"]', settings.mode);
    if (!panel._dirty) {
      setValue('#umspec-sync-archive', settings.archiveId || '');
      setValue('[name="videoDownloads"]', settings.videoPolicy === 'include', true);
      setValue('[name="autoSync"]', settings.autoSync, true);
      setValue('[name="calendarEnabled"]', settings.calendarEnabled, true);
      setValue('[name="announcementScanning"]', settings.announcementScanning, true);
      setValue('[name="reminders"]', reminderValue);
    }
    panel.querySelector('[name="autoSync"]').disabled = Boolean(panel._saving) || !linked('drive') || !status.syncTimes?.drive?.lastSuccessfulSyncAt;
    panel.querySelector('[data-auto-hint]').hidden = !panel.querySelector('[name="autoSync"]').disabled;
    panel.querySelector('[name="calendarEnabled"]').disabled = Boolean(panel._saving) || !linked('calendar');
    panel.querySelector('[data-sync-account]').textContent = status.account ? status.account.email : 'Connect Google from the UM Spec icon in Chrome’s toolbar.';
    const summary = status.job?.summary;
    modal.querySelector('[data-sync-progress]').textContent = summary ?
      summary.created + ' added · ' + summary.updated + ' updated · ' + summary.skipped + ' unchanged · ' + summary.linked + ' links · ' + (summary.conflicts + summary.failed) + ' need attention' :
      'Files are saved. Videos stay as links unless enabled in Settings.';
    const providerLinks = modal.querySelector('[data-sync-provider-links]'); providerLinks.replaceChildren();
    if (status.driveRootId) providerLinks.append(externalLink('Open Drive folder', 'https://drive.google.com/drive/folders/' + encodeURIComponent(status.driveRootId)));
    if (status.calendarId) providerLinks.append(externalLink('Open Google Calendar', 'https://calendar.google.com/calendar/u/0/r'));
    providerLinks.hidden = !providerLinks.childElementCount;
    modal.querySelector('[data-sync-now]').disabled = Boolean(running);
    modal.querySelector('[data-sync-pause]').disabled = !running && status.job?.status !== 'running';
    if (notice) modal.querySelector('#umspec-sync-status').textContent = notice;
    const upcoming = modal.querySelector('[data-sync-upcoming]'); upcoming.replaceChildren();
    const events = core().upcomingRecords(status.events || []), size = 3;
    upcomingPage = Math.min(upcomingPage, Math.max(0, Math.ceil(events.length / size) - 1));
    if (!events.length) upcoming.append(node('p', 'No confirmed dates in the next 7 days. Sync Calendar or review an announcement.'));
    for (const event of events.slice(upcomingPage * size, (upcomingPage + 1) * size)) {
      const row = node('article', null, 'umspec-date-row'); row.append(node('strong', event.title));
      row.append(node('p', event.start.slice(0, 10) + (event.precision === 'instant' ? ' · ' + new Date(event.start).toLocaleTimeString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit' }) : ' · All day')));
      row.append(externalLink('Open Spectrum', event.sourceUrl));
      if (event.meetingUrl) row.append(externalLink('Join meeting', event.meetingUrl));
      upcoming.append(row);
    }
    pager(upcoming, events.length, upcomingPage, size, page => { upcomingPage = page; renderPanel(); });
    renderReviews(modal);
    const recent = modal.querySelector('[data-sync-changes]'); recent.replaceChildren();
    const changes = status.recentChanges || [];
    changesPage = Math.min(changesPage, Math.max(0, Math.ceil(changes.length / 4) - 1));
    if (!changes.length) recent.append(node('p', 'New files and date updates will appear here.'));
    for (const change of changes.slice(changesPage * 4, (changesPage + 1) * 4)) recent.append(node('p',
      (change.title || change.name || 'Course item') + ': ' + (change.action || change.status || 'changed'), 'umspec-date-row'));
    pager(recent, changes.length, changesPage, 4, page => { changesPage = page; renderPanel(); });
  }
  function mountPanel() {
    if (document.getElementById('umspec-sync-panel')) return;
    const host = document.getElementById('umspec-settings-host'); if (!host) return;
    const panel = node('section', null, 'umspec-sync-panel'); panel.id = 'umspec-sync-panel';
    panel.setAttribute('aria-label', 'Settings');
    panel.innerHTML = `<nav class="umspec-subtabs" role="tablist" aria-label="Settings">
      <button type="button" role="tab" data-settings-tab="files" aria-controls="umspec-settings-files">Files</button>
      <button type="button" role="tab" data-settings-tab="calendar" aria-controls="umspec-settings-calendar">Calendar</button>
      <button type="button" role="tab" data-settings-tab="about" aria-controls="umspec-settings-about">More</button></nav>
      <section id="umspec-settings-files" data-settings-view="files" role="tabpanel">
        <h3>File preferences</h3><div class="umspec-sync-fields"><label>Semester folder<input id="umspec-sync-archive" type="text" maxlength="80" placeholder="2026–27 Semester 1"></label></div>
        <label class="umspec-setting-row"><span><strong>Download videos</strong><small>Off saves links. On downloads available video files.</small></span><input type="checkbox" name="videoDownloads"></label>
        <label class="umspec-setting-row"><span><strong>Automatic Drive updates</strong><small>Check when you open Spectrum.</small></span><input type="checkbox" name="autoSync"></label>
        <p data-auto-hint class="umspec-helper">Connect Drive and complete one sync to enable automatic updates.</p>
        <p class="umspec-helper">Hosted recordings stay as links. Drive files over 50 MiB are linked.</p>
      </section>
      <section id="umspec-settings-calendar" data-settings-view="calendar" role="tabpanel" hidden>
        <h3>Calendar preferences</h3>
        <label class="umspec-setting-row"><span><strong>Sync official dates</strong><small>Use your dedicated UM Spec calendar.</small></span><input type="checkbox" name="calendarEnabled"></label>
        <label class="umspec-setting-row"><span><strong>Check announcement dates</strong><small>Review suggestions in Dates before adding.</small></span><input type="checkbox" name="announcementScanning"></label>
        <div class="umspec-sync-fields"><label>Remind me<select name="reminders"><option value="1440,60">1 day and 1 hour before</option><option value="1440">1 day before</option><option value="60">1 hour before</option><option value="">No reminders</option></select></label></div>
        <p class="umspec-helper">Connect Google Calendar from the UM Spec toolbar popup. Announcement checks run locally.</p>
      </section>
      <section id="umspec-settings-about" data-settings-view="about" role="tabpanel" hidden><h3>Account & extras</h3><p data-sync-account></p></section>
      <div class="umspec-sync-actions"><button type="button" data-sync-save>Save settings</button><span data-settings-saved role="status"></span></div>`;
    host.append(panel);
    const extras = document.getElementById('umspec-extra-settings');
    if (extras) panel.querySelector('[data-settings-view="about"]').append(extras);
    wireTabs(panel, 'settings');
    const home = document.getElementById('umspec-sync-home-host');
    home.innerHTML = `<div class="umspec-save-row"><label>Save to <select name="mode"><option value="zip">ZIP file</option><option value="drive">Google Drive</option></select></label><button type="button" data-sync-pause disabled>Pause sync</button></div><p data-sync-progress></p><div data-sync-provider-links class="umspec-provider-links"></div>`;
    const dates = document.getElementById('umspec-dates-host');
    dates.className = 'umspec-sync-panel';
    dates.innerHTML = `<div class="umspec-dates-heading"><h3>Your dates</h3><button type="button" data-sync-now>Check for updates</button></div>
      <nav class="umspec-subtabs" role="tablist" aria-label="Dates"><button type="button" role="tab" data-dates-tab="upcoming" aria-controls="umspec-dates-upcoming">Next 7 days</button><button type="button" role="tab" data-dates-tab="review" aria-controls="umspec-dates-review">Review<span data-review-count></span></button><button type="button" role="tab" data-dates-tab="recent" aria-controls="umspec-dates-recent">Recent</button></nav>
      <section id="umspec-dates-upcoming" data-dates-view="upcoming" role="tabpanel" data-sync-upcoming></section><section id="umspec-dates-review" data-dates-view="review" role="tabpanel" data-sync-reviews hidden></section><section id="umspec-dates-recent" data-dates-view="recent" role="tabpanel" data-sync-changes hidden></section>`;
    wireTabs(dates, 'dates');
    panel.querySelectorAll('input, select, [data-sync-save]').forEach(input => { input.disabled = true; });
    home.querySelector('[name="mode"]').disabled = true;
    panel.addEventListener('input', () => { panel._dirty = true; panel.querySelector('[data-settings-saved]').textContent = 'Unsaved changes'; });
    const savePreferences = async () => {
      const text = panel.querySelector('[name="reminders"]').value;
      const settings = { archiveId: panel.querySelector('#umspec-sync-archive').value,
        videoPolicy: panel.querySelector('[name="videoDownloads"]').checked ? 'include' : 'links',
        autoSync: panel.querySelector('[name="autoSync"]').checked,
        calendarEnabled: panel.querySelector('[name="calendarEnabled"]').checked,
        announcementScanning: panel.querySelector('[name="announcementScanning"]').checked,
        reminderMinutes: text ? text.split(',').map(Number) : [], courseIds: exporter().selectedCourses().map(course => String(course.id)) };
      panel._saving = true; renderPanel();
      try {
        await contextStatus(); await command({ type: 'SAVE_SETTINGS', settings });
        panel._dirty = false; renderPanel(); panel.querySelector('[data-settings-saved]').textContent = 'Saved'; messageText('Settings saved.');
      } catch (error) {
        if (error.code === 'UPLOAD_IN_PROGRESS') { panel._dirty = false; await refreshPanel(); }
        throw error;
      } finally { panel._saving = false; renderPanel(); }
    };
    panel.querySelector('[data-sync-save]').addEventListener('click', () => savePreferences().catch(error => messageText(error.message)));
    home.querySelector('[name="mode"]').addEventListener('change', async event => {
      const input = event.target, mode = input.value; input.dataset.saving = 'true'; input.disabled = true;
      try { await contextStatus(); await command({ type: 'SAVE_SETTINGS', settings: { mode } }); }
      catch (error) { messageText(error.message); renderPanel(); }
      finally { delete input.dataset.saving; input.disabled = false; }
    });
    dates.querySelector('[data-sync-now]').addEventListener('click', () => syncNow().catch(error => messageText(error.message)));
    home.querySelector('[data-sync-pause]').addEventListener('click', () => {
      controller?.abort(); command({ type: 'PAUSE_SYNC' }).then(() => messageText('Sync paused.')).catch(error => messageText(error.message));
    });
    refreshPanel();
  }
  const api = { safeSpectrumUrl, calendarMonths, shouldRunFeature, adaptCalendarResponse, makeReviewFields,
    announcementForum, safeForumPage, discoverOfficialEvents, discoverAnnouncements, refreshPost, exportOrSync, syncNow, refreshPanel,
    savedCourseIds: () => status?.settings?.courseIds?.length ? [...status.settings.courseIds] : null };
  root.UmSpecStudentSync = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document !== 'undefined' && root.chrome?.runtime) {
    chrome.runtime.onMessage.addListener((message, sender, reply) => {
      if (sender.id !== chrome.runtime.id) return;
      if (message.type === 'UMSPEC_CONTEXT') {
        const bridge = exporter();
        Promise.resolve(bridge?.verifyContext ? bridge.verifyContext() : bridge?.getContext()).then(value => reply(value || null), () => reply(null));
        return true;
      }
      if (message.type === 'UMSPEC_SYNC_NOW') { syncNow().catch(() => {}); reply({ ok: true }); }
      if (message.type === 'UMSPEC_REFRESH_STATUS') {
        contextStatus().then(() => reply({ ok: true }), error => {
          messageText(error.message);
          reply({ ok: false, error: { code: error.code || 'LOGIN_REQUIRED', message: error.message } });
        });
        return true;
      }
    });
    new MutationObserver(mountPanel).observe(document.documentElement, { childList: true, subtree: true });
    mountPanel();
    contextStatus().then(() => {
      if (status.settings.courseIds?.length) exporter().setSelectedCourses(status.settings.courseIds);
      return syncNow({ automatic: true });
    }).catch(error => messageText(error.message));
    root.addEventListener('pagehide', () => controller?.abort(), { once: true });
  }
})(globalThis);
