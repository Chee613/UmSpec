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
  // Last month is read again too, so deadlines that just passed get their latest submission status.
  function calendarMonths(now = new Date()) {
    const malaysia = new Date(new Date(now).getTime() + 8 * 3600000);
    if (!Number.isFinite(malaysia.getTime())) throw new TypeError('Invalid scan date');
    return Array.from({ length: 7 }, (_, index) => {
      const month = new Date(Date.UTC(malaysia.getUTCFullYear(), malaysia.getUTCMonth() + index - 1, 1));
      return { year: month.getUTCFullYear(), month: month.getUTCMonth() + 1 };
    });
  }
  function shouldRunFeature(feature, status, automatic, now = Date.now()) {
    const settings = status.settings || {};
    const job = feature === 'drive' ? status.job : feature === 'calendar' ? status.calendarJob : null;
    if (automatic && job?.scopeChanged) return false;
    const featureEnabled = feature === 'drive' ? settings.mode === 'drive' : feature === 'calendar' ? settings.calendarEnabled : settings.announcementScanning;
    if (automatic && job && !job.done && featureEnabled) return job.status === 'running';
    if (automatic && feature === 'drive' && !status.syncTimes?.drive?.lastSuccessfulSyncAt) return false;
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
          // Spectrum offers an action ("Add submission", "Attempt quiz now") only while something is still to do, so its
          // absence means nothing is left to hand in. The line lets Google Calendar and the UM Spec bot tell a missed
          // deadline from a finished one.
          const pending = Boolean(raw.action), quiz = raw.modulename === 'quiz';
          const progress = !deadline ? '' : 'Spectrum: ' + (pending ? (quiz ? 'not attempted yet' : 'not submitted yet') : (quiz ? 'nothing left to attempt' : 'nothing left to submit'));
          const title = plainText(raw.name), description = [plainText(raw.description), progress].filter(Boolean).join('\n');
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
  async function discoverOfficialEvents(courseIds, signal, now = new Date(), progress = () => {}) {
    const records = new Map(), failures = [];
    const sesskey = exporter()?.getSesskey();
    if (!sesskey) return { records: [], complete: false, failures: [{ message: 'Sign in to Spectrum before scanning dates.' }] };
    for (const { year, month } of calendarMonths(now)) {
      signal?.throwIfAborted();
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
        progress({ year, month });
      } catch (error) {
        signal?.throwIfAborted();
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
    // An expired session lands on Spectrum's sign-in page, which at UM offers only the Microsoft (OIDC) button and no
    // password form; without these checks it reads as an unsupported URL or a changed announcement layout.
    const landed = response.url ? new URL(response.url) : null;
    if (landed && (landed.origin !== ORIGIN || /^\/(?:login|auth)\//.test(landed.pathname))) throw fail('LOGIN_REQUIRED', 'Sign in to Spectrum to resume scanning.');
    if (!response.ok) throw fail('SPECTRUM_UNAVAILABLE', 'Spectrum page could not be read (' + response.status + ').');
    if (response.url) safeSpectrumUrl(response.url);
    const html = await response.text();
    if (html.length > 2 * 1024 * 1024) throw fail('CAPACITY', 'This Spectrum page is too large for one scan.');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (doc.body?.id === 'page-login-index' ||
        doc.querySelector('form#login,form[action*="/login/index.php"]')) throw fail('LOGIN_REQUIRED', 'Sign in to Spectrum to resume scanning.');
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
  async function discoverAnnouncements(courseIds, signal, cursor = null, progress = () => {}) {
    const posts = [], failures = [], unreadable = [];
    let resume = cursor;
    for (const courseId of courseIds.map(String)) {
      signal?.throwIfAborted();
      if (resume?.courseId && resume.courseId !== courseId) continue;
      let forums = [], current = { courseId, forumUrl: null, listingUrl: null, threadOffset: 0 };
      try {
        const course = await fetchPage(ORIGIN + '/course/view.php?id=' + courseId, signal);
        const courseLabel = (String(course.title || '').match(/\b[A-Z]{3,4}\d{4}[A-Z]?\b/) || [])[0] || 'course ' + courseId;
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
              // One post in an unusual layout is skipped and named, so it neither stops the other posts nor becomes the
              // saved resume point that every later scan would fail on again.
              try { posts.push(await announcements().normalisePost(postFromDocument(thread, threads[index], courseId, forumId))); }
              catch (error) {
                if (error?.code !== 'ANNOUNCEMENTS_UNAVAILABLE') throw error;
                unreadable.push('"' + String(thread.querySelector('h1,h2,h3')?.textContent || 'Announcement').replace(/\s+/g, ' ').trim().slice(0, 60) + '" (' + courseLabel + ')');
              }
              progress({ courseId, posts: posts.length });
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
        progress({ courseId, posts: posts.length, courseComplete: true });
      } catch (error) {
        signal?.throwIfAborted();
        failures.push({ courseId, message: error.code ? error.message : 'Could not read this course announcement layout.' });
        return { posts, complete: false, cursor: current, failures };
      }
    }
    if (unreadable.length) failures.push({ courseId: null, message: unreadable.length + ' announcement post(s) could not be read and were skipped: ' +
      unreadable.slice(0, 3).join(', ') + (unreadable.length > 3 ? ' and ' + (unreadable.length - 3) + ' more' : '') + '.' });
    return { posts, complete: true, cursor: null, failures };
  }
  let status = null, contextReady = false, localZip = false, running = null, runningAutomatic = false, controller = null, notice = '';
  let dateRunning = null, dateController = null, dateRunner = null, datesVisible = false, dateCalendarActive = false;
  let contextInvalidated = false, mutationObserver = null;
  const refreshMessage = 'UM Spec was updated. Refresh this Spectrum tab to continue.';
  const dateAnalysis = { active: false, stage: '', detail: '', progress: 0, error: '' };
  function runtimeFailure(error) {
    if (!/extension context invalidated/i.test(error?.message || '')) return error;
    contextInvalidated = true; contextReady = false;
    controller?.abort(); dateController?.abort(); dateRunner?.stop('IDLE');
    dateAnalysis.active = false; dateAnalysis.error = refreshMessage;
    mutationObserver?.disconnect?.();
    messageText(refreshMessage); renderPanel();
    return fail('EXTENSION_CONTEXT_INVALIDATED', refreshMessage);
  }
  function runtimeIcon(path) {
    if (contextInvalidated) return '';
    try { return root.chrome?.runtime?.getURL?.(path) || ''; }
    catch (error) {
      const failure = runtimeFailure(error);
      if (failure === error) throw error;
      return '';
    }
  }
  function dateRecords(value, now = new Date()) {
    const records = new Map((value.events || []).map(record => [record.sourceKey, record]));
    for (const record of value.dateScan?.records || []) records.set(record.sourceKey, record);
    return core().upcomingRecords([...records.values()], now, 186);
  }
  function renderDateAnalysis() {
    if (typeof document === 'undefined') return;
    const panel = document.querySelector?.('[data-date-analysis]');
    if (!panel) return;
    panel.hidden = !dateAnalysis.active;
    panel.querySelector('[data-date-stage]').textContent = dateAnalysis.stage;
    panel.querySelector('[data-date-detail]').textContent = dateAnalysis.detail;
    panel.querySelector('[data-date-meter]').style.width = dateAnalysis.progress + '%';
    panel.querySelector('[role="progressbar"]').setAttribute('aria-valuenow', String(dateAnalysis.progress));
    if (dateAnalysis.active && datesVisible && !root.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      if (!dateRunner) dateRunner = exporter()?.createDateAnalysisRunner?.(panel.querySelector('canvas'), panel.querySelector('[data-date-score]'));
      if (dateRunner && !['RUNNING', 'STARTING'].includes(dateRunner.state)) {
        dateRunner.state = 'STARTING';
        dateRunner.start().catch(() => { dateRunner?.stop('IDLE'); });
      }
    } else dateRunner?.stop('IDLE');
  }
  function onTabChange(tab) {
    datesVisible = tab === 'dates'; renderDateAnalysis();
    if (datesVisible) analyseDates().catch(() => {});
  }
  function stopDateAnalysis() {
    dateController?.abort();
    if (dateCalendarActive) return command({ type: 'PAUSE_SYNC', feature: 'calendar', bindingHash: status.bindingHash }).catch(error => { dateAnalysis.error = error.message; });
  }
  function analyseDates(options = {}) {
    if (dateRunning) return dateRunning;
    dateController = new AbortController();
    const signal = dateController.signal;
    const update = (stage, detail, progress) => { Object.assign(dateAnalysis, { active: true, stage, detail, progress, error: '' }); renderPanel(); };
    dateRunning = (async () => {
      await contextStatus(); signal.throwIfAborted();
      const courseIds = exporter().selectedCourses().map(course => String(course.id));
      if (!courseIds.length) throw fail('SELECT_COURSES', 'Choose courses in the Courses tab to analyse their dates.');
      const bindingHash = status.bindingHash, prior = status.dateScan;
      const sameScope = prior && [...prior.courseIds].sort().join(',') === [...courseIds].sort().join(',');
      const cached = !options.force && sameScope && prior.complete && Date.now() - prior.completedAt < 15 * 60000;
      if (cached && !shouldRunFeature('calendar', status, true)) return status;
      if (!cached) {
        update('Reading official dates…', 'Checking six months of Spectrum deadlines and course events.', 0);
        let months = 0, courses = 0;
        const official = await discoverOfficialEvents(courseIds, signal, new Date(), () => {
          update('Reading official dates…', ++months + ' of 6 calendar months checked.', Math.round(months / 6 * 40));
        });
        signal.throwIfAborted();
        update('Reading course announcements…', 'Scanning selected courses locally. Your files can keep exporting.', 40);
        const scan = await discoverAnnouncements(courseIds, signal, sameScope ? prior.announcementCursor : null, item => {
          if (item.courseComplete) courses++;
          update('Reading course announcements…', courses + ' of ' + courseIds.length + ' courses checked · ' + item.posts + ' posts read.', 40 + Math.round(courses / courseIds.length * 50));
        });
        signal.throwIfAborted();
        await contextStatus(); signal.throwIfAborted();
        if (status.bindingHash !== bindingHash) throw fail('ACCOUNT_CHANGED', 'Spectrum account changed. Run date analysis again.');
        update('Saving dates for review…', official.records.length + ' official dates · ' + scan.posts.length + ' announcement posts checked.', 95);
        await command({ type: 'SAVE_DATE_SCAN', bindingHash, courseIds, records: official.records, posts: scan.posts,
          complete: official.complete && scan.complete, announcementCursor: scan.cursor,
          failures: [...official.failures, ...scan.failures] });
      }
      signal.throwIfAborted();
      if (status.bindingHash !== bindingHash) throw fail('ACCOUNT_CHANGED', 'Spectrum account changed. Dates were not sent to Calendar.');
      if (linked('calendar') && status.settings.calendarEnabled) {
        // ponytail: reuse the serial Calendar writer after file sync; local discovery never waits for an export.
        if (running) {
          update('Dates ready · files still syncing…', 'Official dates will sync to Calendar after the file writer finishes.', 96);
          await new Promise((resolve, reject) => {
            const stopped = () => reject(signal.reason);
            signal.addEventListener('abort', stopped, { once: true });
            running.catch(() => {}).then(resolve).finally(() => signal.removeEventListener('abort', stopped));
            if (signal.aborted) stopped();
          });
        }
        signal.throwIfAborted();
        if (status.bindingHash !== bindingHash) throw fail('ACCOUNT_CHANGED', 'Spectrum account changed. Dates were not sent to Calendar.');
        if (!linked('calendar') || !status.settings.calendarEnabled) return status;
        update('Syncing official dates…', 'Announcement suggestions stay in Review.', 98);
        dateCalendarActive = true;
        await runCalendar(false, signal, true);
        signal.throwIfAborted();
      }
      return status;
    })().catch(error => {
      dateAnalysis.error = contextInvalidated ? refreshMessage : signal.aborted ? 'Date analysis stopped. Previous dates are retained.' : error.message;
      return status;
    }).finally(() => {
      dateAnalysis.active = false; dateCalendarActive = false; dateRunning = null; dateController = null;
      renderDateAnalysis(); renderPanel();
    });
    renderPanel();
    return dateRunning;
  }
  function messageText(message) {
    notice = message;
    if (typeof document !== 'undefined') {
      const output = document.getElementById('umspec-sync-status');
      if (output) output.textContent = message;
    }
  }
  async function command(message) {
    if (contextInvalidated) throw fail('EXTENSION_CONTEXT_INVALIDATED', refreshMessage);
    let response;
    try { response = await root.chrome.runtime.sendMessage(message); }
    catch (error) { throw runtimeFailure(error); }
    if (contextInvalidated) throw fail('EXTENSION_CONTEXT_INVALIDATED', refreshMessage);
    if (!response?.ok) throw fail(response?.error?.code || 'WORKER_UNAVAILABLE', response?.error?.message || 'Reopen the extension to restore sync.');
    status = response.data;
    renderPanel();
    return status;
  }
  async function contextStatus(options = {}) {
    try {
      if (contextInvalidated) throw fail('EXTENSION_CONTEXT_INVALIDATED', refreshMessage);
      const bridge = exporter();
      // On page load the document was just rendered for this session; every real sync still verifies with a fresh request.
      const context = options.fromDocument && bridge?.getContext ? bridge.getContext() : bridge?.verifyContext ? await bridge.verifyContext() : bridge?.getContext();
      if (!context || context.origin !== ORIGIN || !positiveId(context.userId)) throw fail('LOGIN_REQUIRED', 'Open your signed-in Spectrum page to set up sync.');
      const result = await command({ type: 'SET_CONTEXT', userId: context.userId });
      if (contextInvalidated) throw fail('EXTENSION_CONTEXT_INVALIDATED', refreshMessage);
      contextReady = true;
      renderPanel();
      return result;
    } catch (error) {
      contextReady = false;
      renderPanel();
      throw error;
    }
  }
  function linked(feature) { return status?.configured && status.account?.features?.includes(feature); }
  function dueInBackground(feature) {
    return shouldRunFeature(feature, status, true) && (feature !== 'calendar' || Boolean(linked('calendar')));
  }
  // Background checks wait for Spectrum to finish loading so they never compete with the page the student opened.
  function afterPageLoad(delay = 3000) {
    return new Promise(resolve => {
      const wait = () => setTimeout(resolve, delay);
      if (document.readyState === 'complete') wait();
      else root.addEventListener('load', wait, { once: true });
    });
  }
  function renderProviderStatus(panel) {
    const feature = panel.dataset?.settingsProvider === 'calendar' ? 'calendar' : 'drive';
    const name = feature === 'calendar' ? 'Google Calendar' : 'Google Drive';
    const available = Boolean(status && contextReady && !contextInvalidated);
    const output = panel.querySelector?.('[data-settings-provider-status]');
    if (!output) return;
    output.textContent = available ? name + (linked(feature) ? ' connected' : ' not connected') : 'Verify Spectrum to check ' + (feature === 'calendar' ? 'Calendar' : 'Drive');
    panel.querySelector('[data-settings-connection]').dataset.connected = String(available && Boolean(linked(feature)));
    for (const icon of panel.querySelectorAll('[data-settings-provider]')) icon.hidden = icon.dataset.settingsProvider !== feature;
  }
  function attentionText(job) {
    const items = job?.attention || [];
    return items.length ? ' Affected: ' + items.map(item => item.name + (item.detail ? ' (' + item.detail + ')' : '')).join(', ') + '.' : '';
  }
  async function runDrive(automatic, signal) {
    if (!linked('drive')) throw fail('CONNECT_REQUIRED', status?.configured ? 'Connect Google Drive from the extension popup.' : 'Google setup is required. ZIP and local announcement review remain available.');
    if (!status.settings.archiveId) throw fail('ARCHIVE_REQUIRED', 'Enter and save a semester archive name before syncing to Drive.');
    if (status.background?.running) { messageText(backgroundText()); return; }
    let job = status.job;
    const skipped = [];
    if (job && !job.done && !job.scopeChanged) {
      await command({ type: 'BEGIN_DRIVE_SYNC', bindingHash: status.bindingHash, materials: [], retry: !automatic });
    } else {
      messageText('Checking selected courses for fresh material…');
      const courses = await exporter().discoverCourses();
      const selected = new Set(status.settings.courseIds), materials = [];
      const wanted = courses.filter(course => selected.has(String(course.id)));
      for (const [index, course] of wanted.entries()) {
        const label = 'Checking course ' + (index + 1) + ' of ' + wanted.length + (course.fullName ? ' (' + course.fullName + ')' : '');
        messageText(label + '… Keep this tab open.');
        const found = await exporter().resolveCourseMaterials(course, automatic ? null : exporter().selectedUrls(course.id), signal,
          (done, total) => messageText(label + ': item ' + done + ' of ' + total + '. Keep this tab open.'));
        skipped.push(...(found.skippedItems || []));
        materials.push(...found);
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
        ' conflict(s). Retry failed items or open Drive to review edits and restore removed files.' + attentionText(status.job));
    }
    if (skipped.length) throw fail('PARTIAL_SCAN', skippedText(skipped));
  }
  // Names what was left out and why, so a broken lecturer link is not mistaken for something a retry would fix.
  function skippedText(items) {
    const shown = items.slice(0, 3).map(item => '"' + item.name + '" (' + item.reason + ')').join(', ') + (items.length > 3 ? ' and ' + (items.length - 3) + ' more' : '');
    const retry = items.some(item => !item.permanent);
    return 'Drive sync finished, but ' + items.length + ' course item(s) were left out: ' + shown + '.' +
      (retry ? ' Sync again later to retry them.' : ' These need fixing on Spectrum itself, so ask your lecturer if you need them.');
  }
  function backgroundText() {
    const bg = status?.background, job = status?.job;
    if (bg?.progress?.phase === 'scanning') return 'Syncing to Google Drive in the background: checking course ' + (bg.progress.course || 1) + ' of ' + (bg.progress.courses || '…') + '. You can leave this page.';
    if (job?.background && !job.done) return 'Syncing to Google Drive in the background: ' + job.cursor + ' of ' + job.total + ' items. You can leave this page.';
    return 'Syncing to Google Drive in the background. You can leave this page.';
  }
  async function runCalendar(automatic, signal, useDateScan = false) {
    if (!linked('calendar')) throw fail('CONNECT_REQUIRED', 'Connect Google Calendar from the extension popup.');
    useDateScan ||= Boolean(status.calendarJob?.useDateScan && !status.calendarJob.done);
    signal.throwIfAborted();
    if (useDateScan) {
      await command({ type: 'BEGIN_CALENDAR_SYNC', bindingHash: status.bindingHash, useDateScan: true, freshInventory: true });
    } else if (status.calendarJob && !status.calendarJob.done && !status.calendarJob.scopeChanged) {
      await command({ type: 'BEGIN_CALENDAR_SYNC', records: [], complete: status.calendarJob.complete === true });
    } else {
      messageText('Reading the next six months of official Spectrum dates…');
      const scan = await discoverOfficialEvents(status.settings.courseIds, signal);
      signal.throwIfAborted();
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
    signal.throwIfAborted();
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
    // Automatic Drive updates run in the extension's background, so they continue after this tab is closed.
    // An unfinished sync a tab started earlier still resumes here, where its checkpoint belongs.
    const tabJob = status.job && !status.job.done && !status.job.background && status.job.status === 'running';
    const drive = automatic && !tabJob ? () => command({ type: 'BACKGROUND_DRIVE_SYNC' }) : () => runDrive(automatic, signal);
    for (const [feature, run] of [['drive', drive], ['calendar', () => runCalendar(automatic, signal)], ['announcements', () => runAnnouncements(signal)]]) {
      const due = automatic ? dueInBackground(feature) : shouldRunFeature(feature, status, false);
      if (signal.aborted || (dateRunning && feature !== 'drive') || !due) continue;
      try {
        // Start the cooldown first: a scan cut short by leaving the page must not restart on every visit.
        // The background Drive run records its own attempt.
        if (automatic && feature !== 'drive') await command({ type: 'MARK_SYNC_ATTEMPT', feature });
        await run();
      }
      catch (error) {
        if (error.name === 'AbortError' || signal.aborted) break;
        errors.push(error.message);
      }
    }
    messageText(contextInvalidated ? refreshMessage : signal.aborted ? 'Sync paused. Reopen Spectrum or choose Sync now to continue.' : errors.length ? errors.join(' ') : automatic ? '' : 'Selected features are up to date.');
    return status;
  }
  function syncNow(options = {}) {
    const automatic = options.automatic === true;
    if (running && !automatic && runningAutomatic) {
      // Background checks skip a first Drive sync, so joining one would silently drop what the student asked for.
      controller?.abort();
      return running.catch(() => {}).then(() => syncNow(options));
    }
    if (running) return running;
    controller = new AbortController();
    runningAutomatic = automatic;
    running = performSync(automatic).catch(error => { messageText(error.message); throw error; }).finally(() => {
      running = null; controller = null; renderPanel();
    });
    renderPanel();
    return running;
  }
  async function exportOrSync() {
    if (exporter()?.destination?.() === 'zip') return false;
    await command({ type: 'GET_STATUS' });
    if (status.settings.mode !== 'drive') return false;
    await contextStatus();
    analyseDates().catch(() => {});
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
      if (group === 'settings') { parent.dataset.settingsProvider = value === 'calendar' ? 'calendar' : 'drive'; renderProviderStatus(parent); }
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
    const officialReviews = (status.dateScan?.records || []).filter(item => item.status === 'needs_review');
    reviewPage = Math.min(reviewPage, Math.max(0, candidates.length - 1));
    const signature = JSON.stringify([reviewPage, candidates.map(c => [c.candidateId, c.sourceRevision, c.state]), events.map(e => [e.sourceKey, e.sourceRevision]), officialReviews.map(e => [e.sourceKey, e.sourceRevision]), linked('calendar'), status.settings.calendarEnabled]);
    const target = modal.querySelector('[data-sync-reviews]');
    if (target._signature === signature) return;
    target._signature = signature;
    target.replaceChildren();
    const count = candidates.length + officialReviews.length;
    modal.querySelector('[data-review-count]').textContent = count ? ' (' + count + ')' : '';
    for (const event of officialReviews) {
      const row = node('article', null, 'umspec-date-row');
      row.append(node('strong', event.title), node('p', 'Spectrum did not provide a complete time or duration. Check the source before adding this date.'), externalLink('Check official event', event.sourceUrl));
      target.append(row);
    }
    if (!candidates.length) { if (!officialReviews.length) target.append(node('p', 'No dates to review. Analyse your selected courses to check announcements.')); return; }
    const candidate = candidates[reviewPage];
    const row = node('article', null, 'umspec-sync-review');
    const heading = node('h4', candidate.title); heading.title = candidate.title; row.append(heading);
    const evidence = node('p', candidate.evidence, 'umspec-evidence'); evidence.title = candidate.evidence; row.append(evidence);
    row.append(externalLink('Read announcement', candidate.sourceUrl));
    if (candidate.reason === 'inferred_year') row.append(node('p', 'The post gave no year, so it was taken from the posting date. Check it before saving.', 'umspec-helper'));
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
    const allowed = () => contextReady && !contextInvalidated && linked('calendar') && status.settings.calendarEnabled && !candidate.cancellationSuggested && (!duplicate || separate?.checked);
    accept.type = 'button'; accept.disabled = !allowed();
    if (!linked('calendar') || !status.settings.calendarEnabled) row.append(node('p', 'Connect Calendar from the UM Spec toolbar popup, then enable it in Settings → Calendar.', 'umspec-helper'));
    separate?.addEventListener('change', () => { accept.disabled = !allowed(); });
    accept.addEventListener('click', async () => {
      if (!allowed()) return;
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
  // ---------- Drive clean-up: preview first, then move only those items to Drive trash ----------
  const cleanup = { busy: false, preview: null, done: null, error: '' };
  const megabytes = bytes => (bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0) + ' MB';
  function renderCleanup(panel) {
    const box = panel?.querySelector?.('[data-cleanup]');
    if (!box) return;
    const find = box.querySelector('[data-cleanup-find]'), apply = box.querySelector('[data-cleanup-apply]');
    const text = box.querySelector('[data-cleanup-text]'), list = box.querySelector('[data-cleanup-list]');
    const usable = Boolean(status && contextReady && !contextInvalidated && linked('drive'));
    find.disabled = !usable || cleanup.busy || Boolean(running) || Boolean(status?.background?.running);
    const preview = cleanup.preview;
    apply.hidden = !preview?.total || Boolean(cleanup.done);
    apply.disabled = cleanup.busy;
    apply.textContent = 'Move ' + (preview?.total || 0) + ' item' + (preview?.total === 1 ? '' : 's') + ' to Drive trash';
    list.hidden = !preview?.sample?.length || Boolean(cleanup.done);
    list.replaceChildren(...(preview?.sample || []).map(item => node('li', item.name + ' — ' + item.reason)));
    text.textContent = cleanup.error ? cleanup.error :
      !usable ? 'Connect Google Drive to find duplicate files.' :
      cleanup.done ? (cleanup.done.done < cleanup.done.total ? 'Moving to Drive trash: ' + cleanup.done.done + ' of ' + cleanup.done.total + '…' : 'Moved ' + cleanup.done.total + ' items to Drive trash. You can restore them from Drive trash for 30 days.') :
      cleanup.busy ? 'Checking your UM Spec files in Drive…' :
      preview ? (preview.total ? 'Found ' + (preview.total - preview.folders) + ' extra copies (' + megabytes(preview.bytes) + ')' + (preview.folders ? ' and ' + preview.folders + ' empty old folders' : '') + '. ' + preview.kept + ' files stay. Nothing is removed until you choose Move.' : 'No duplicates found. ' + preview.kept + ' files checked.') :
      'Find extra copies of files UM Spec uploaded more than once. Files you added yourself are never touched.';
  }
  async function findDuplicates(panel) {
    cleanup.busy = true; cleanup.preview = null; cleanup.done = null; cleanup.error = ''; renderCleanup(panel);
    try { await contextStatus(); cleanup.preview = (await command({ type: 'DRIVE_CLEANUP_PREVIEW' })).cleanup; }
    catch (error) { cleanup.error = error.message; }
    finally { cleanup.busy = false; renderCleanup(panel); }
  }
  async function trashDuplicates(panel) {
    cleanup.busy = true; cleanup.error = ''; cleanup.done = { done: 0, total: cleanup.preview?.total || 0 }; renderCleanup(panel);
    try {
      for (let guard = 0; guard < 400; guard++) {
        cleanup.done = (await command({ type: 'DRIVE_CLEANUP_APPLY' })).cleanup;
        renderCleanup(panel);
        if (cleanup.done.done >= cleanup.done.total) break;
      }
    } catch (error) { cleanup.error = error.message; cleanup.done = null; }
    finally { cleanup.busy = false; renderCleanup(panel); }
  }
  function renderPanel() {
    const available = Boolean(status && contextReady && !contextInvalidated);
    if (available) exporter()?.applySettings?.(localZip ? { ...status.settings, mode: 'zip' } : status.settings);
    if (typeof document === 'undefined') return;
    const panel = document.getElementById('umspec-sync-panel'), modal = document.getElementById('umspec-modal');
    if (!panel || !modal) return;
    const destination = modal.querySelector('[name="mode"]');
    const saving = Boolean(panel._saving) || destination.dataset.saving === 'true';
    panel.querySelectorAll('input, select, [data-sync-save]').forEach(input => { input.disabled = !available || saving; });
    destination.disabled = saving;
    for (const option of destination.options) if (option.value === 'drive') option.disabled = !available || !linked('drive');
    destination.value = available ? localZip ? 'zip' : status.settings.mode : exporter()?.destination?.() || 'zip';
    for (const choice of modal.querySelectorAll('[data-mode-choice]')) {
      choice.disabled = destination.disabled || (choice.dataset.modeChoice === 'drive' && destination.options[1].disabled);
      choice.setAttribute('aria-pressed', String(choice.dataset.modeChoice === destination.value));
    }
    const spectrumStatus = document.getElementById('umspec-spectrum-status');
    if (spectrumStatus) {
      spectrumStatus.textContent = available ? 'Spectrum connected' : 'Verify Spectrum';
      spectrumStatus.closest('.umspec-live-pill').dataset.connected = String(available);
    }
    modal.querySelector('[data-sync-now]').disabled = !available || saving || Boolean(dateRunning);
    renderProviderStatus(panel);
    if (!available) {
      const pause = modal.querySelector('[data-sync-pause]'); if (pause) pause.disabled = true;
      const summary = modal.querySelector('[data-dates-summary]');
      if (summary) summary.textContent = dateAnalysis.error || 'Verify your signed-in Spectrum session to analyse course dates.';
      for (const selector of ['[data-sync-upcoming]', '[data-sync-reviews]', '[data-sync-changes]', '[data-calendar-feedback]']) {
        const target = modal.querySelector(selector);
        target?.replaceChildren?.();
        if (target) delete target._signature;
      }
      renderDateAnalysis();
      return;
    }
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
    if (!panel._dirty) {
      setValue('#umspec-sync-archive', settings.archiveId || '');
      setValue('[name="videoDownloads"]', settings.videoPolicy === 'include', true);
      setValue('[name="autoSync"]', settings.autoSync, true);
      setValue('[name="calendarEnabled"]', settings.calendarEnabled, true);
      setValue('[name="announcementScanning"]', settings.announcementScanning, true);
      setValue('[name="reminders"]', reminderValue);
    }
    panel.querySelector('[name="autoSync"]').disabled = saving || !linked('drive') || !status.syncTimes?.drive?.lastSuccessfulSyncAt;
    panel.querySelector('[data-auto-hint]').hidden = !panel.querySelector('[name="autoSync"]').disabled;
    panel.querySelector('[name="calendarEnabled"]').disabled = saving || !linked('calendar');
    panel.querySelector('[data-sync-account]').textContent = status.account ? status.account.email : 'Connect Google from the UM Spec icon in Chrome’s toolbar.';
    const summary = status.job?.summary;
    modal.querySelector('[data-sync-progress]').textContent = summary ?
      summary.created + ' added · ' + summary.updated + ' updated · ' + summary.skipped + ' unchanged · ' + summary.linked + ' links · ' + (summary.conflicts + summary.failed) + ' need attention' + attentionText(status.job) :
      '';
    const providerLinks = modal.querySelector('[data-sync-provider-links]'); providerLinks.replaceChildren();
    if (status.driveRootId) providerLinks.append(externalLink('Open Drive folder', 'https://drive.google.com/drive/folders/' + encodeURIComponent(status.driveRootId)));
    if (status.calendarId) providerLinks.append(externalLink('Open Google Calendar', 'https://calendar.google.com/calendar/'));
    providerLinks.hidden = !providerLinks.childElementCount;
    modal.querySelector('[data-sync-pause]').disabled = !running && status.job?.status !== 'running';
    if (status.background?.running) notice = backgroundText();
    else if (status.background?.phase === 'paused' && status.background.error && !running && notice.startsWith('Syncing to Google Drive in the background')) notice = 'Background Drive sync paused: ' + status.background.error;
    else if (status.background?.phase === 'complete' && !running && notice.startsWith('Syncing to Google Drive in the background')) notice = 'Background Drive sync finished.';
    if (notice) modal.querySelector('#umspec-sync-status').textContent = notice;
    renderCleanup(panel);
    const upcoming = modal.querySelector('[data-sync-upcoming]'); upcoming.replaceChildren();
    const scan = status.dateScan;
    const calendarFeedback = modal.querySelector('[data-calendar-feedback]');
    if (calendarFeedback) {
      const count = (status.events || []).filter(event => event.status === 'confirmed').length;
      const pending = (status.candidates || []).length;
      calendarFeedback.replaceChildren();
      calendarFeedback.append(node('span', !linked('calendar') ? 'Google Calendar is not connected. Connect it from the UM Spec toolbar popup.' :
        !settings.calendarEnabled ? 'Calendar is connected, but date sync is off. Turn on Settings → Calendar → Sync official dates.' :
        status.calendarJob?.error ? 'Calendar sync paused: ' + status.calendarJob.error.message :
        status.calendarVisibilityNotice ? (count ? count + ' dates saved. ' : '') + status.calendarVisibilityNotice :
        count ? count + ' dates saved to the “UM Spec” calendar for ' + status.account.email + '.' + (pending ? ' ' + pending + ' announcement suggestions still need review.' : '') :
        pending ? pending + ' announcement suggestions need review before they can appear in Google Calendar.' :
        'Calendar is connected. Analyse dates to find official deadlines for your selected courses.'));
      if (status.calendarId) calendarFeedback.append(externalLink('Open Google Calendar', 'https://calendar.google.com/calendar/'));
    }
    const scanSummary = modal.querySelector('[data-dates-summary]');
    if (scanSummary) scanSummary.textContent = dateAnalysis.error || (dateAnalysis.active ? 'Analysis continues while you export. Dates appear here when this pass finishes.' :
      scan ? (scan.complete ? 'Checked ' : 'Partial scan of ') + scan.courseIds.length + ' courses · ' + new Date(scan.completedAt).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', dateStyle: 'medium', timeStyle: 'short' }) +
        (scan.failures?.length ? '. ' + scan.failures[0].message : !scan.complete ? '. Run Analyse dates again to continue.' : '. Upcoming six months · Malaysia time.') :
        'Analyse selected courses for official deadlines and announcement dates.');
    renderDateAnalysis();
    const events = dateRecords(status), size = 3;
    upcomingPage = Math.min(upcomingPage, Math.max(0, Math.ceil(events.length / size) - 1));
    if (!events.length) upcoming.append(node('p', dateAnalysis.active ? 'Checking your courses…' : !scan ? 'Choose Analyse dates to check your selected courses.' : scan.complete ?
      'No upcoming official deadlines found. Check Review for announcement suggestions.' : 'The scan is incomplete. Previously found dates are retained; try Analyse dates again.'));
    for (const event of events.slice(upcomingPage * size, (upcomingPage + 1) * size)) {
      const row = node('article', null, 'umspec-date-row'); row.append(node('strong', event.title));
      row.append(node('p', event.start.slice(0, 10) + (event.precision === 'instant' ? ' · ' + new Date(event.start).toLocaleTimeString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit' }) : ' · All day')));
      row.append(externalLink('Open Spectrum', event.sourceUrl));
      row.append(node('span', (status.events || []).some(item => item.sourceKey === event.sourceKey && item.sourceRevision === event.sourceRevision) ? 'Synced to Calendar' : 'Official Spectrum date', 'umspec-date-source'));
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
    if (contextInvalidated) return;
    if (document.getElementById('umspec-sync-panel')) return;
    const host = document.getElementById('umspec-settings-host'); if (!host) return;
    const panel = node('section', null, 'umspec-sync-panel'); panel.id = 'umspec-sync-panel';
    panel.setAttribute('aria-label', 'Settings');
    panel.innerHTML = `<nav class="umspec-subtabs" role="tablist" aria-label="Settings">
      <button type="button" role="tab" data-settings-tab="files" aria-controls="umspec-settings-files">Files</button>
      <button type="button" role="tab" data-settings-tab="calendar" aria-controls="umspec-settings-calendar">Calendar</button>
      <button type="button" role="tab" data-settings-tab="about" aria-controls="umspec-settings-about">More</button></nav>
      <section id="umspec-settings-files" data-settings-view="files" role="tabpanel">
        <h3>File preferences</h3><div class="umspec-sync-fields"><label>Semester folder<input id="umspec-sync-archive" type="text" maxlength="80" placeholder="e.g. Semester 1"></label></div>
        <label class="umspec-setting-row"><span><strong>Download videos</strong><small>Turn off to save video links for faster exports.</small></span><span class="umspec-switch"><input type="checkbox" name="videoDownloads"><span class="umspec-slider" aria-hidden="true"></span></span></label>
        <label class="umspec-setting-row"><span><strong>Automatic Drive updates</strong><small>Check when you open Spectrum.</small></span><span class="umspec-switch"><input type="checkbox" name="autoSync"><span class="umspec-slider" aria-hidden="true"></span></span></label>
        <p data-auto-hint class="umspec-helper">Connect Drive and complete one sync to enable automatic updates.</p>
        <p class="umspec-helper">Hosted recordings stay as links. Drive files over 50 MiB are linked.</p>
      </section>
      <section id="umspec-settings-calendar" data-settings-view="calendar" role="tabpanel" hidden>
        <h3 class="umspec-provider-heading"><img src="${runtimeIcon('icons/google-calendar.svg')}" alt="" width="28" height="28">Calendar preferences</h3>
        <label class="umspec-setting-row"><span><strong>Sync official dates</strong><small>Use your dedicated UM Spec calendar.</small></span><span class="umspec-switch"><input type="checkbox" name="calendarEnabled"><span class="umspec-slider" aria-hidden="true"></span></span></label>
        <label class="umspec-setting-row"><span><strong>Check announcement dates</strong><small>Review suggestions in Dates before adding.</small></span><span class="umspec-switch"><input type="checkbox" name="announcementScanning"><span class="umspec-slider" aria-hidden="true"></span></span></label>
        <div class="umspec-sync-fields"><label>Remind me<select name="reminders"><option value="1440,60">1 day and 1 hour before</option><option value="1440">1 day before</option><option value="60">1 hour before</option><option value="">No reminders</option></select></label></div>
        <p class="umspec-helper">Use Dates → Analyse dates to check selected courses. Announcement suggestions need review before saving to Calendar.</p>
      </section>
      <section id="umspec-settings-about" data-settings-view="about" role="tabpanel" hidden><h3>Account & extras</h3><p data-sync-account></p>
        <div class="umspec-cleanup" data-cleanup><h4>Drive clean-up</h4><p class="umspec-helper" data-cleanup-text>Find extra copies of files UM Spec uploaded more than once. Files you added yourself are never touched.</p><ul data-cleanup-list hidden></ul><div class="umspec-sync-actions"><button type="button" data-cleanup-find>Find duplicates</button><button type="button" data-cleanup-apply hidden>Move to Drive trash</button></div></div></section>
      <div class="umspec-sync-actions"><div class="umspec-settings-connection" data-settings-connection><img data-settings-provider="drive" src="${runtimeIcon('icons/google-drive.svg')}" alt="" width="26" height="26"><img data-settings-provider="calendar" src="${runtimeIcon('icons/google-calendar.svg')}" alt="" width="26" height="26" hidden><span data-settings-provider-status>Checking Google Drive…</span></div><span data-settings-saved role="status"></span><button type="button" data-sync-save>Save changes</button></div>`;
    host.append(panel);
    const extras = document.getElementById('umspec-extra-settings');
    if (extras) panel.querySelector('[data-settings-view="about"]').append(extras);
    wireTabs(panel, 'settings');
    panel.querySelector('[data-cleanup-find]')?.addEventListener('click', () => findDuplicates(panel));
    panel.querySelector('[data-cleanup-apply]')?.addEventListener('click', () => trashDuplicates(panel));
    // While a background Drive sync runs, refresh its progress every few seconds when this tab is visible.
    const poll = root.setInterval?.(() => {
      if (contextInvalidated || document.visibilityState !== 'visible' || !status?.background?.running || running) return;
      command({ type: 'GET_STATUS' }).catch(() => {});
    }, 5000);
    poll?.unref?.();
    const home = document.getElementById('umspec-sync-home-host');
    home.innerHTML = `<div class="umspec-save-row"><div class="umspec-destination-field"><span id="umspec-destination-label">Save to</span><div class="umspec-destination-options" role="group" aria-labelledby="umspec-destination-label"><button type="button" data-mode-choice="zip" aria-pressed="true">ZIP file</button><button type="button" data-mode-choice="drive" aria-pressed="false" disabled><img class="umspec-provider-icon" src="${runtimeIcon('icons/google-drive.svg')}" alt="" width="20" height="20">Google Drive</button></div><select name="mode" hidden aria-hidden="true" tabindex="-1"><option value="zip">ZIP file</option><option value="drive">Google Drive</option></select></div><button type="button" data-sync-pause disabled>Pause sync</button></div><p data-sync-progress></p><div data-sync-provider-links class="umspec-provider-links"></div>`;
    panel.querySelector('[data-settings-view="about"]').append(home.querySelector('[data-sync-provider-links]'));
    const dates = document.getElementById('umspec-dates-host');
    dates.className = 'umspec-sync-panel';
    dates.innerHTML = `<div class="umspec-dates-heading"><h3>Your dates</h3><button type="button" data-sync-now>Analyse dates</button></div>
      <p class="umspec-dates-summary" data-dates-summary></p>
      <p class="umspec-calendar-feedback" data-calendar-feedback></p>
      <section class="umspec-date-analysis" data-date-analysis hidden aria-label="Date analysis"><div class="umspec-analysis-titlebar"><strong>DATE SCANNER.EXE</strong><span>UM SPEC</span></div><div class="umspec-analysis-body"><div class="umspec-analysis-copy"><strong data-date-stage role="status">Reading official dates…</strong><button type="button" data-date-stop>Stop</button></div><p data-date-detail></p><canvas id="umspec-date-runner-canvas" width="640" height="90" aria-label="Dino running past cactus while dates are checked"></canvas><span data-date-score hidden></span><div class="umspec-analysis-meter" role="progressbar" aria-label="Date analysis progress" aria-valuemin="0" aria-valuemax="100"><span data-date-meter></span></div><p class="umspec-analysis-caption">Runs locally while your files export. Announcement dates stay in Review.</p></div></section>
      <nav class="umspec-subtabs" role="tablist" aria-label="Dates"><button type="button" role="tab" data-dates-tab="upcoming" aria-controls="umspec-dates-upcoming">Upcoming</button><button type="button" role="tab" data-dates-tab="review" aria-controls="umspec-dates-review">Review<span data-review-count></span></button><button type="button" role="tab" data-dates-tab="recent" aria-controls="umspec-dates-recent">Recent</button></nav>
      <section id="umspec-dates-upcoming" data-dates-view="upcoming" role="tabpanel" data-sync-upcoming></section><section id="umspec-dates-review" data-dates-view="review" role="tabpanel" data-sync-reviews hidden></section><section id="umspec-dates-recent" data-dates-view="recent" role="tabpanel" data-sync-changes hidden></section>`;
    wireTabs(dates, 'dates');
    panel.querySelectorAll('input, select, [data-sync-save]').forEach(input => { input.disabled = true; });
    home.querySelector('[name="mode"]').disabled = true;
    panel.addEventListener('input', () => { panel._dirty = true; panel.querySelector('[data-settings-saved]').textContent = 'Unsaved changes'; });
    const savePreferences = async () => {
      const text = panel.querySelector('[name="reminders"]').value;
      const settings = { mode: home.querySelector('[name="mode"]').value, archiveId: panel.querySelector('#umspec-sync-archive').value,
        videoPolicy: panel.querySelector('[name="videoDownloads"]').checked ? 'include' : 'links',
        autoSync: panel.querySelector('[name="autoSync"]').checked,
        calendarEnabled: panel.querySelector('[name="calendarEnabled"]').checked,
        announcementScanning: panel.querySelector('[name="announcementScanning"]').checked,
        reminderMinutes: text ? text.split(',').map(Number) : [], courseIds: exporter().selectedCourses().map(course => String(course.id)) };
      panel._saving = true; renderPanel();
      try {
        await contextStatus(); await command({ type: 'SAVE_SETTINGS', settings });
        localZip = false;
        panel._dirty = false; renderPanel(); panel.querySelector('[data-settings-saved]').textContent = 'Saved'; messageText('Settings saved.');
      } catch (error) {
        if (error.code === 'UPLOAD_IN_PROGRESS') { panel._dirty = false; await refreshPanel(); }
        throw error;
      } finally { panel._saving = false; renderPanel(); }
    };
    panel.querySelector('[data-sync-save]').addEventListener('click', () => savePreferences().catch(error => messageText(error.message)));
    home.querySelector('[name="mode"]').addEventListener('change', async event => {
      const input = event.target, mode = input.value; input.dataset.saving = 'true'; input.disabled = true;
      renderPanel();
      const useLocalZip = () => {
        localZip = true;
        exporter().applySettings({ mode: 'zip', videoPolicy: exporter().videoPolicy() });
        input.value = 'zip';
      };
      try {
        if (mode === 'zip' && !contextReady) { useLocalZip(); messageText('ZIP selected. Verify Spectrum to save account preferences.'); }
        else { await contextStatus(); await command({ type: 'SAVE_SETTINGS', settings: { mode } }); localZip = false; }
      } catch (error) {
        if (mode === 'zip') useLocalZip();
        else input.value = localZip ? 'zip' : status?.settings?.mode || 'zip';
        messageText((mode === 'zip' ? 'ZIP selected. ' : '') + error.message);
      }
      finally { delete input.dataset.saving; renderPanel(); }
    });
    for (const choice of home.querySelectorAll('[data-mode-choice]')) choice.addEventListener('click', () => {
      const input = home.querySelector('[name="mode"]');
      input.value = choice.dataset.modeChoice;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    dates.querySelector('[data-sync-now]').addEventListener('click', () => analyseDates({ force: true }));
    dates.querySelector('[data-date-stop]').addEventListener('click', stopDateAnalysis);
    home.querySelector('[data-sync-pause]').addEventListener('click', () => {
      controller?.abort(); command({ type: 'PAUSE_SYNC' }).then(() => messageText('Sync paused.')).catch(error => messageText(error.message));
    });
    refreshPanel();
  }
  const api = { safeSpectrumUrl, calendarMonths, shouldRunFeature, adaptCalendarResponse, makeReviewFields,
    announcementForum, safeForumPage, discoverOfficialEvents, discoverAnnouncements, refreshPost, exportOrSync, syncNow, refreshPanel,
    analyseDates, stopDateAnalysis, dateRecords, onTabChange,
    savedCourseIds: () => contextReady && status?.settings?.courseIds?.length ? [...status.settings.courseIds] : null };
  root.UmSpecStudentSync = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document !== 'undefined' && root.chrome?.runtime) {
    mutationObserver = new MutationObserver(mountPanel);
    try {
      const extensionId = root.chrome.runtime.id;
      root.chrome.runtime.onMessage.addListener((message, sender, reply) => {
        if (contextInvalidated || sender.id !== extensionId) return;
        if (message.type === 'UMSPEC_CONTEXT') {
          const bridge = exporter();
          Promise.resolve().then(() => bridge?.verifyContext ? bridge.verifyContext() : bridge?.getContext()).then(value => reply(value || null), () => reply(null));
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
    } catch (error) {
      const failure = runtimeFailure(error);
      if (failure === error) throw error;
    }
    if (!contextInvalidated) mutationObserver.observe(document.documentElement, { childList: true, subtree: true });
    mountPanel();
    contextStatus({ fromDocument: true }).then(async () => {
      if (!status.settings.courseIds?.length) return;
      exporter().setSelectedCourses(status.settings.courseIds);
      if (!['drive', 'calendar', 'announcements'].some(feature => dueInBackground(feature))) return;
      await afterPageLoad();
      return syncNow({ automatic: true });
    }).catch(error => messageText(error.message));
    root.addEventListener('pagehide', () => { controller?.abort(); stopDateAnalysis(); dateRunner?.stop('IDLE'); }, { once: true });
  }
})(globalThis);
