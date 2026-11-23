/* Keeps the planner fresh while Spectrum is open and filters course pages to the student's own OCC. */
(function (root) {
  'use strict';
  if (typeof document === 'undefined' || !root.chrome?.runtime?.id || root.top !== root) return;
  const core = () => root.UmSpecPlannerCore, collector = () => root.UmSpecPlannerCollect;
  const STALE_MS = 30 * 60000, FULL_MS = 6 * 3600000, LOCK = 'umspec_planner_lock';
  let dead = false, running = null, lastMeta = null;

  async function send(message) {
    if (dead) throw new Error('UM Spec was updated. Refresh this tab.');
    try {
      const response = await chrome.runtime.sendMessage(message);
      if (!response?.ok) throw Object.assign(new Error(response?.error?.message || 'UM Spec is unavailable.'), { code: response?.error?.code });
      return response.data;
    } catch (error) {
      if (/extension context invalidated/i.test(error?.message || '')) dead = true;
      throw error;
    }
  }
  function sesskey() { return root.UmSpecExporter?.getSesskey?.() || null; }
  // Course pages are large (up to 1.4 MB), so they are read on a full pass: on Refresh or every six hours.
  function knownOcc(meta) {
    const known = {};
    for (const [id, value] of Object.entries(meta?.detectedOcc || {})) if (value?.occ) known[id] = value.occ;
    for (const [id, value] of Object.entries(meta?.occ || {})) { if (value) known[id] = value; else delete known[id]; }
    return known;
  }
  function collect({ full = true, meta = null } = {}) {
    if (running) return running;
    running = (async () => {
      const key = sesskey();
      if (!key) throw Object.assign(new Error('Sign in to Spectrum, then refresh the planner.'), { code: 'LOGIN_REQUIRED' });
      let userId = null;
      try { userId = root.UmSpecExporter?.getContext?.()?.userId || null; } catch {}
      meta ||= await send({ type: 'PLANNER_META' }).catch(() => null);
      const data = await collector().collect({ sesskey: key, userId, full, knownOcc: knownOcc(meta) });
      return send({ type: 'PLANNER_SAVE', data });
    })().finally(() => { running = null; });
    return running;
  }
  let holdingLock = false;
  function lockFree() {
    try {
      const held = Number(localStorage.getItem(LOCK) || 0);
      if (Date.now() - held < 5 * 60000) return false;
      localStorage.setItem(LOCK, String(Date.now()));
      holdingLock = true;
      return true;
    } catch { return true; }
  }
  function release() { if (!holdingLock) return; holdingLock = false; try { localStorage.removeItem(LOCK); } catch {} }
  // Leaving the page mid-refresh must not block other tabs for five minutes.
  root.addEventListener('pagehide', release);

  // ---------- OCC filter on course pages ----------
  const courseId = (() => {
    if (!/^\/course\/(?:view|overview)\.php$/.test(location.pathname)) return null;
    const id = new URLSearchParams(location.search).get('id');
    return /^[1-9]\d*$/.test(id || '') ? id : null;
  })();
  function candidates() {
    return [...document.querySelectorAll('li.activity, [data-for="cmitem"], #region-main table tbody tr')]
      .filter(element => !element.closest('#umspec-modal, .umspec-occ-bar'));
  }
  // AI reading of this course's OCC labels ("G1", "Group 1M", lecturer sections), used where a title names no OCC.
  let aiLayout = null, aiNote = '', aiBusy = false;
  const AI_CONSENT = 'Let UM Spec\'s AI read how this course labels its class groups (for example "G1" or "Group 1M")?\n\n' +
    'This sends the activity titles, section names and lock notes of your Spectrum courses to UM Spec\'s server and Google Gemini. ' +
    'Your name, matric number, submissions and OCC are not sent. Answers are shared with other students in the same course.\n\n' +
    'You can turn this off again from the OCC bar.';
  async function refreshAI(meta, enable) {
    const ai = root.UmSpecCourseAI;
    if (!courseId || !ai || aiBusy || (!meta?.courseAI && enable !== true)) return;
    const activities = ai.layoutActivities(document);
    if (!activities.length) return;
    aiBusy = true; aiNote = 'AI is reading this course…';
    if (lastMeta) applyOcc(lastMeta);
    try {
      const code = (document.title.match(/\b[A-Z]{3,4}\d{4}[A-Z]?\b/) || [])[0] || '';
      const result = await send({ type: 'PLANNER_COURSE_AI', courseId, courseCode: code, activities, ...(enable != null ? { enable } : {}) });
      aiLayout = result?.layout || null;
      aiNote = !result?.enabled ? '' : aiLayout ? 'AI read this course\'s groups' + (aiLayout.groupStyle ? ': ' + aiLayout.groupStyle : '') :
        result.rejected ? 'AI answer disagreed with Spectrum, so it is not used' : '';
    } catch (error) {
      aiNote = 'AI course reading failed: ' + String(error.message).slice(0, 80);
    } finally { aiBusy = false; }
    const meta2 = await refreshOcc().catch(() => lastMeta);
    return meta2;
  }
  function aiTokens(element) {
    if (!aiLayout) return null;
    const item = element.closest('li.activity[id^="module-"]');
    const id = item?.id?.slice(7);
    const section = element.closest('li.section, [data-for="section"], .course-section, section.section');
    const heading = section && ['.sectionname', 'h3', '.section-title', '[data-for="section_title"]'].map(s => section.querySelector(s)).find(Boolean);
    const sectionName = String(heading?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    return (id && aiLayout.activities?.[id]?.occ) || aiLayout.sections?.[sectionName]?.occ || null;
  }
  function applyOcc(meta) {
    if (!courseId) return;
    const hasOverride = Boolean(meta.occ && Object.hasOwn(meta.occ, courseId));
    const detected = meta.detectedOcc?.[courseId]?.occ || '';
    const mine = hasOverride ? (meta.occ[courseId] || '') : detected;
    const auto = !hasOverride && Boolean(detected);
    const showAll = Boolean(meta.showAllOcc);
    const tokens = new Set();
    let hidden = 0;
    for (const element of candidates()) {
      const label = element.querySelector('.instancename, .activityname, a')?.textContent || element.textContent;
      const found = core().parseOcc(label) || aiTokens(element);
      found?.forEach(token => tokens.add(token));
      const other = Boolean(mine && found && !found.includes(mine));
      element.classList.toggle('umspec-occ-hidden', other && !showAll);
      element.classList.toggle('umspec-occ-dim', other && showAll);
      if (other) hidden++;
    }
    if (!tokens.size && !mine && !detected) { document.querySelector('.umspec-occ-bar')?.remove(); return; }
    let bar = document.querySelector('.umspec-occ-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'umspec-occ-bar';
      bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', 'UM Spec OCC filter');
      const host = document.querySelector('#region-main .course-content, #region-main [role="main"], #region-main') || document.body;
      host.prepend(bar);
    }
    const lang = meta.lang || 'en', t = key => core().t(lang, key);
    bar.replaceChildren();
    const label = document.createElement('label');
    const strong = document.createElement('strong'); strong.textContent = 'UM Spec · OCC';
    const select = document.createElement('select');
    select.setAttribute('aria-label', t('occTitle'));
    const options = ['', ...new Set([...tokens, ...(mine ? [mine] : []), ...(detected ? [detected] : [])])].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    for (const value of options) {
      const option = document.createElement('option');
      option.value = value; option.textContent = value ? 'OCC ' + value + (value === mine && auto ? ' (' + t('occAuto') + ')' : '') : t('occNone');
      select.append(option);
    }
    select.value = mine;
    select.addEventListener('change', () => send({ type: 'PLANNER_SET_OCC', courseId, occ: select.value }).then(refreshOcc).catch(() => {}));
    label.append(strong, select);
    const summary = document.createElement('span');
    summary.textContent = mine ? hidden + ' × ' + (showAll ? 'other OCC (dimmed)' : 'other OCC hidden') : t('occHelp');
    const toggle = document.createElement('button');
    toggle.type = 'button'; toggle.textContent = showAll ? '✓ ' + t('showAllOcc') : t('showAllOcc');
    toggle.setAttribute('aria-pressed', String(showAll));
    toggle.hidden = !mine;
    toggle.addEventListener('click', () => send({ type: 'PLANNER_SET_OCC', courseId, occ: mine, showAllOcc: !showAll }).then(refreshOcc).catch(() => {}));
    const aiButton = document.createElement('button');
    aiButton.type = 'button';
    aiButton.textContent = meta.courseAI ? (aiBusy ? 'AI reading…' : 'AI on') : 'Read groups with AI';
    aiButton.title = meta.courseAI ? (aiNote || 'AI reads labels such as "G1" or "Group 1M". Click to turn it off.') : 'Let AI work out labels such as "G1" or "Group 1M" in this course.';
    aiButton.setAttribute('aria-pressed', String(Boolean(meta.courseAI)));
    aiButton.disabled = aiBusy;
    aiButton.addEventListener('click', () => {
      if (meta.courseAI) {
        if (!confirm('Turn off AI course reading? Saved AI answers are removed from this device.')) return;
        aiLayout = null; aiNote = '';
        send({ type: 'PLANNER_COURSE_AI', courseId, activities: [], enable: false }).then(refreshOcc).catch(() => {});
      } else if (confirm(AI_CONSENT)) refreshAI(meta, true).catch(() => {});
    });
    const open = document.createElement('button');
    open.type = 'button'; open.textContent = t('planner') + ' ↗';
    open.addEventListener('click', () => send({ type: 'PLANNER_OPEN' }).catch(() => {}));
    bar.append(label, summary, toggle, aiButton, open);
    if (aiNote) { const note = document.createElement('small'); note.className = 'umspec-occ-ai'; note.textContent = aiNote; bar.append(note); }
  }
  async function refreshOcc() {
    if (!courseId) return null;
    const meta = await send({ type: 'PLANNER_META' });
    lastMeta = meta;
    applyOcc(meta);
    return meta;
  }

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (dead || sender.id !== chrome.runtime.id || message?.type !== 'UMSPEC_PLANNER_COLLECT') return;
    collect({ full: message.full !== false }).then(data => reply({ ok: true, data }), error => reply({ ok: false, error: { code: error.code || 'REQUEST_FAILED', message: String(error.message).slice(0, 240) } }));
    return true;
  });

  // The OCC filter applies as soon as the course content is in the page; the refresh waits until the page has finished loading.
  const showFilter = async () => {
    const meta = courseId ? await refreshOcc() : await send({ type: 'PLANNER_META' });
    if (courseId) {
      // Moodle loads some sections lazily; re-apply the saved filter locally, ignoring the bar's own updates.
      let pending = 0;
      new MutationObserver(records => {
        if (records.every(record => record.target.closest?.('.umspec-occ-bar') || [...record.addedNodes].every(n => n.classList?.contains('umspec-occ-bar')))) return;
        clearTimeout(pending); pending = setTimeout(() => { if (lastMeta) applyOcc(lastMeta); }, 400);
      }).observe(document.querySelector('#region-main') || document.body, { childList: true, subtree: true });
    }
    return meta;
  };
  const filtered = showFilter().catch(() => null);
  filtered.then(meta => { if (meta?.courseAI) refreshAI(meta).catch(() => {}); });
  const refresh = async () => {
    const meta = await filtered;
    // Data saved for a different Spectrum account (after switching accounts) is replaced at once with a full read.
    let userId = null; try { userId = root.UmSpecExporter?.getContext?.()?.userId || null; } catch {}
    const tag = userId ? await core().accountTag(userId) : '';
    const otherAccount = Boolean(tag && meta?.userHash && meta.userHash !== tag);
    if (!meta || !sesskey() || (!otherAccount && meta.collectedAt && Date.now() - meta.collectedAt < STALE_MS) || !lockFree()) return;
    const full = otherAccount || !meta.fullAt || Date.now() - meta.fullAt >= FULL_MS;
    try { await collect({ full, meta }); if (courseId) await refreshOcc(); } catch {} finally { release(); }
  };
  const later = () => setTimeout(() => { refresh().catch(() => {}); }, 3000);
  if (document.readyState === 'complete') later(); else root.addEventListener('load', later, { once: true });
})(globalThis);
