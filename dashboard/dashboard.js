/* UM Spec planner page. Renders cached planner data; Refresh asks an open Spectrum tab (or this page) to read it again. */
(() => {
  'use strict';
  const C = globalThis.UmSpecPlannerCore, collector = globalThis.UmSpecPlannerCollect;
  const DATA = 'umspecPlanner', PREFS = 'umspecPlannerPrefs', UI_KEY = 'umspec_planner_ui';
  const ORIGIN = C.ORIGIN, DAY = C.DAY;
  const panelMode = new URLSearchParams(location.search).has('panel');
  const $ = selector => document.querySelector(selector);
  let data = null, prefs = null, driveKeys = new Set(), busy = false, zipping = null;
  const ui = Object.assign({ view: 'calendar', course: 'all', month: null, day: null, calMode: 'count', sort: 'oldest', type: 'all', search: '',
    expanded: [], collapsedSections: [] }, readUi());
  const selected = new Set();

  function readUi() { try { return JSON.parse(localStorage.getItem(UI_KEY) || '{}'); } catch { return {}; } }
  function saveUi() { try { localStorage.setItem(UI_KEY, JSON.stringify({ ...ui, day: null, month: null })); } catch {} }
  const t = key => C.t(prefs?.lang || 'en', key);
  const locale = () => C.LANGS[prefs?.lang] || 'en-MY';
  const fmt = (ms, options) => new Date(ms).toLocaleString(locale(), { timeZone: 'Asia/Kuala_Lumpur', ...options });
  const timeOf = ms => C.hhmm(C.mytParts(ms).min);

  // Small DOM builder: every string goes through textContent.
  function h(tag, attrs = {}, ...children) {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value == null || value === false) continue;
      if (key === 'class') element.className = value;
      else if (key === 'text') element.textContent = value;
      else if (key.startsWith('on')) element.addEventListener(key.slice(2), value);
      else element.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) if (child != null && child !== false) element.append(child instanceof Node ? child : document.createTextNode(String(child)));
    return element;
  }
  const svg = path => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = path; return s; };
  const ICONS = {
    assignment: '<path d="M9 3h6l1 2h3v16H5V5h3Z"/><path d="m9 13 2 2 4-4"/>', quiz: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01"/>',
    attendance: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20a6 6 0 0 1 12 0M16 11l2 2 4-4"/>', notice: '<path d="M4 10v4h3l6 4V6L7 10Z"/><path d="M17 9a4 4 0 0 1 0 6"/>',
    event: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/>', eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    ext: '<path d="M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>', caret: '<path d="m9 6 6 6-6 6"/>', down: '<path d="M12 4v12M6 10l6 6 6-6M4 20h16"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', left: '<path d="m15 6-6 6 6 6"/>', right: '<path d="m9 6 6 6-6 6"/>'
  };

  // ---------- Storage ----------
  async function load() {
    const saved = await chrome.storage.local.get([DATA, PREFS]);
    data = saved[DATA] || null;
    prefs = { lang: 'en', theme: 'system', occ: {}, showAllOcc: false, reminders: { enabled: false, deadlineLeads: [1440, 60], classLead: 10 }, ...(saved[PREFS] || {}) };
    prefs.reminders = { enabled: false, deadlineLeads: [1440, 60], classLead: 10, ...(prefs.reminders || {}) };
    try { const keys = (await chrome.runtime.sendMessage({ type: 'PLANNER_DRIVE' }))?.data?.keys; driveKeys = new Set(Array.isArray(keys) ? keys : []); } catch {}
  }
  async function savePrefs(patch) {
    prefs = { ...prefs, ...patch };
    await chrome.storage.local.set({ [PREFS]: prefs });
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[DATA]) data = changes[DATA].newValue || null;
    if (changes[PREFS]) prefs = { ...prefs, ...(changes[PREFS].newValue || {}) };
    if (changes[DATA] || changes[PREFS]) render();
  });

  // ---------- Derived data ----------
  const courses = () => data?.courses || [];
  const courseById = id => courses().find(c => c.id === id);
  const items = () => (data ? C.visibleItems(data, prefs) : []).filter(i => ui.course === 'all' || i.courseId === ui.course);
  const occFor = id => C.effectiveOcc(data, prefs, id);

  // ---------- Shell ----------
  function applyTheme() {
    const dark = prefs.theme === 'dark' || (prefs.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.lang = prefs.lang === 'zh' ? 'zh-CN' : prefs.lang === 'ms' ? 'ms' : 'en';
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (prefs?.theme === 'system') applyTheme(); });
  function notice(message, kind = '', actions = []) {
    const box = $('#notice');
    box.replaceChildren(h('span', { text: message }), ...actions);
    box.className = 'banner ' + kind; box.hidden = !message;
  }
  function renderShell() {
    applyTheme();
    for (const node of document.querySelectorAll('[data-t]')) node.textContent = t(node.dataset.t);
    for (const node of document.querySelectorAll('[data-tip]')) { node.title = t(node.dataset.tip); node.setAttribute('aria-label', t(node.dataset.tip)); }
    for (const button of document.querySelectorAll('[data-lang]')) button.setAttribute('aria-pressed', String(button.dataset.lang === prefs.lang));
    for (const tab of document.querySelectorAll('[data-view]')) { const on = tab.dataset.view === ui.view; tab.setAttribute('aria-selected', String(on)); tab.tabIndex = on ? 0 : -1; }
    const week = data ? C.semesterWeek(data.items) : null;
    $('#week-pill').hidden = !week; $('#week-pill').textContent = prefs.lang === 'zh' ? '第 ' + week + ' 周' : t('week').toUpperCase() + ' ' + week;
    $('#updated').textContent = data?.collectedAt ? t('lastUpdated') + ' ' + fmt(data.collectedAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
    $('#refresh').disabled = busy;
    $('#refresh').querySelector('span').textContent = busy ? t('refreshing') : t('refresh');
    $('#open-side').hidden = panelMode || !chrome.sidePanel?.open;
    renderChips();
  }
  function renderChips() {
    const box = $('#course-chips');
    box.hidden = ui.view === 'settings' || !courses().length;
    const all = data ? C.visibleItems(data, prefs) : [];
    const count = id => (ui.view === 'materials' ? (data?.materials || []).filter(m => (id === 'all' || m.courseId === id) && (prefs.showAllOcc || C.occMatches(m.occ, occFor(m.courseId)))) :
      all.filter(i => id === 'all' || i.courseId === id)).length;
    box.replaceChildren(
      h('button', { type: 'button', class: 'chip', 'aria-pressed': String(ui.course === 'all'), onclick: () => setCourse('all') }, t('allCourses') + ' ' + courses().length, h('span', { class: 'n', text: count('all') })),
      ...courses().map(c => h('button', { type: 'button', class: 'chip', title: c.fullName, 'aria-pressed': String(ui.course === c.id), onclick: () => setCourse(c.id) }, c.abbrev, h('span', { class: 'n', text: count(c.id) }))));
  }
  function setCourse(id) { ui.course = id; saveUi(); render(); }
  function setView(view) { ui.view = view; saveUi(); render(); scrollToToday(); }
  function scrollToToday() { if (ui.view === 'list') requestAnimationFrame(() => $('#tl-today')?.scrollIntoView({ block: 'start' })); }

  // ---------- Cards ----------
  function relative(ms, now = Date.now()) {
    const diff = ms - now, abs = Math.abs(diff);
    const n = abs >= DAY ? Math.round(abs / DAY) + (prefs.lang === 'zh' ? '天' : 'D') : abs >= 3600000 ? Math.round(abs / 3600000) + (prefs.lang === 'zh' ? '小时' : 'H') : Math.max(1, Math.round(abs / 60000)) + (prefs.lang === 'zh' ? '分钟' : 'M');
    return diff >= 0 ? t('dueIn') + ' ' + n : n + ' ' + t('ago');
  }
  function card(item, now = Date.now()) {
    const course = courseById(item.courseId), state = C.itemState(item, now);
    const head = h('div', { class: 'course' }, course ? h('b', { text: course.code }) : null, course ? ' / ' + course.name : '');
    const metaBox = h('div', { class: 'meta' });
    const meta = { append: (...nodes) => metaBox.append(...nodes.filter(Boolean)) };
    let side = [];
    const timeRange = item.end && item.end - item.start < DAY ? timeOf(item.start) + ' – ' + timeOf(item.end) : null;
    if (item.kind === 'attendance') {
      meta.append(h('span', { class: 'state ' + state, text: t(state) }), h('span', { text: item.sessionType }), item.detail ? h('span', { text: item.detail.slice(0, 60) }) : null);
      side.push(state === 'open' ? h('a', { class: 'act hot', href: item.url, target: '_blank', rel: 'noopener noreferrer' }, t('takeAttendance') + ' →') :
        state === 'attended' ? h('span', { class: 'act good', text: '✓ ' + t('attended') }) :
          h('a', { class: 'act', href: item.url, target: '_blank', rel: 'noopener noreferrer' }, t('openSpectrum') + ' ↗'));
    } else if (item.kind === 'assignment' || item.kind === 'quiz') {
      meta.append(h('span', { class: 'state ' + state, text: state === 'overdue' ? t('overdue') + ' ' + relative(item.start, now).replace(t('ago'), '').trim() : t(state) }),
        h('span', { text: fmt(item.start, { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) }),
        state === 'todo' ? h('span', { text: item.opensOnly ? t('noDeadline') : relative(item.start, now) }) : null);
      const label = state === 'done' ? t('viewSubmission') : state === 'overdue' ? t('submitLate') + ' →' : state === 'past' ? t('openSpectrum') + ' ↗' : t('submit') + ' →';
      side.push(h('a', { class: 'act' + (state === 'todo' || state === 'overdue' ? ' solid' : ''), href: item.url, target: '_blank', rel: 'noopener noreferrer', text: label }));
    } else {
      meta.append(state === 'new' ? h('span', { class: 'state new', text: t('new') }) : null, h('span', { text: fmt(item.start, { day: 'numeric', month: 'short', ...(item.kind === 'event' ? { hour: '2-digit', minute: '2-digit' } : {}) }) }),
        item.detail ? h('span', { text: item.detail.slice(0, 70) }) : null);
      side.push(h('a', { class: 'act', href: item.url, target: '_blank', rel: 'noopener noreferrer', text: t('openSpectrum') + ' ↗' }));
    }
    const occ = item.occ?.length ? h('span', { class: 'occ', text: 'OCC ' + item.occ.join(', ') }) : occFor(item.courseId) && item.kind === 'attendance' ? h('span', { class: 'occ', text: 'OCC ' + occFor(item.courseId) }) : null;
    return h('article', { class: 'card ' + item.kind },
      h('span', { class: 'ico' }, svg(ICONS[item.kind] || ICONS.event)),
      head,
      item.kind === 'attendance' && timeRange ? h('div', { class: 'time', text: timeRange }) : h('div', { class: 'title', text: item.title }),
      item.kind === 'attendance' && timeRange ? h('div', { class: 'meta' }, h('span', { text: item.title })) : null,
      metaBox,
      h('div', { class: 'side' }, occ || h('span'), ...side));
  }

  // ---------- Calendar ----------
  function monthState(now = Date.now()) {
    const today = C.mytParts(now);
    if (!ui.month) ui.month = { y: today.y, m: today.m };
    if (!ui.day) ui.day = C.dayKey(now);
    return today;
  }
  function renderCalendar(view) {
    const now = Date.now(); monthState(now);
    const list = items(), byDay = new Map();
    for (const item of list) { const key = C.dayKey(item.start); if (!byDay.has(key)) byDay.set(key, []); byDay.get(key).push(item); }
    const first = C.mytInstant(ui.month.y, ui.month.m, 1), gridStart = C.startOfWeek(first);
    const title = fmt(first + 12 * 3600000, { month: 'long', year: 'numeric' });
    const move = delta => { const d = new Date(Date.UTC(ui.month.y, ui.month.m - 1 + delta, 1)); ui.month = { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 }; render(); };
    const grid = h('div', { class: 'month', role: 'grid', 'aria-label': title });
    for (let i = 0; i < 7; i++) grid.append(h('div', { class: 'dow', role: 'columnheader', text: fmt(gridStart + i * DAY + 12 * 3600000, { weekday: 'short' }) }));
    const weeks = Math.ceil((C.startOfDay(C.mytInstant(ui.month.y, ui.month.m + 1, 1) - DAY) + DAY - gridStart) / (7 * DAY));
    for (let i = 0; i < weeks * 7; i++) {
      const start = gridStart + i * DAY, p = C.mytParts(start + 12 * 3600000), key = C.dayKey(start + 12 * 3600000);
      const dayItems = byDay.get(key) || [];
      const counts = {}; for (const item of dayItems) counts[item.kind] = (counts[item.kind] || 0) + 1;
      const cell = h('button', { type: 'button', role: 'gridcell', class: 'day' + (p.m !== ui.month.m ? ' other' : '') + (key === C.dayKey(now) ? ' today' : ''),
        'aria-selected': String(key === ui.day), 'aria-label': fmt(start + 12 * 3600000, { dateStyle: 'full' }) + (dayItems.length ? ', ' + dayItems.length : ''),
        onclick: () => { ui.day = key; render(); } }, h('span', { class: 'num', text: p.d }));
      if (ui.calMode === 'count') for (const kind of C.KINDS) { if (counts[kind]) cell.append(h('span', { class: 'tag ' + kind }, t(kind), h('b', { text: counts[kind] }))); }
      const dots = h('span', { class: 'dots' });
      for (const kind of C.KINDS) for (let n = 0; n < Math.min(counts[kind] || 0, 4); n++) dots.append(h('span', { class: 'dot ' + kind }));
      if (ui.calMode === 'dots' || matchMedia('(max-width: 820px)').matches) cell.append(dots);
      grid.append(cell);
    }
    const left = h('section', { class: 'box' },
      h('div', { class: 'cal-head' },
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Previous month', onclick: () => move(-1) }, svg(ICONS.left)),
        h('h2', { text: title }),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Next month', onclick: () => move(1) }, svg(ICONS.right)),
        h('button', { type: 'button', class: 'btn small', onclick: () => { ui.month = null; ui.day = null; render(); } }, t('today')),
        h('span', { class: 'topbar-spacer' }),
        h('div', { class: 'seg', role: 'group' }, ...['dots', 'count'].map(mode => h('button', { type: 'button', 'aria-pressed': String(ui.calMode === mode), onclick: () => { ui.calMode = mode; saveUi(); render(); } }, t(mode))))),
      grid,
      h('div', { class: 'legend' }, ...C.KINDS.map(kind => h('span', {}, h('span', { class: 'dot ' + kind }), t(kind)))));
    const [y, m, d] = ui.day.split('-').map(Number), dayStart = C.mytInstant(y, m, d);
    const agendaItems = (byDay.get(ui.day) || []).sort((a, b) => order(a) - order(b) || a.start - b.start);
    const right = h('section', { class: 'box' },
      h('div', { class: 'agenda-head' }, h('span', { class: 'big', text: d }), h('span', { class: 'sub' }, fmt(dayStart + 12 * 3600000, { weekday: 'long' }), h('br'), fmt(dayStart + 12 * 3600000, { month: 'long', year: 'numeric' }))),
      h('div', { class: 'agenda' }, agendaItems.length ? agendaItems.map(item => card(item, now)) : h('p', { class: 'empty', text: data ? t('nothingDay') : t('nothing') })));
    view.append(h('div', { class: 'cal-layout' }, left, right));
  }
  const order = item => ({ assignment: 0, quiz: 1, attendance: 2, notice: 3, event: 4 })[item.kind] ?? 5;

  // ---------- List ----------
  function renderList(view) {
    const now = Date.now();
    const all = data ? C.visibleItems(data, prefs) : [];
    const side = h('aside', { class: 'box course-side' },
      h('div', { class: 'big' }, h('strong', { text: courses().length }), h('span', { text: t('courses') + ' · ' + all.length })),
      h('button', { type: 'button', class: 'course-row', 'aria-pressed': String(ui.course === 'all'), onclick: () => setCourse('all') }, h('span', { class: 'ab', text: '∗' }), h('span', { class: 'nm', text: t('allCourses') }), h('span', { class: 'ct', text: all.length })),
      ...courses().map(c => h('button', { type: 'button', class: 'course-row', 'aria-pressed': String(ui.course === c.id), onclick: () => setCourse(c.id) },
        h('span', { class: 'ab', text: c.abbrev }), h('span', { class: 'nm' }, c.code, h('small', { text: occFor(c.id) ? 'OCC ' + occFor(c.id) : c.name })), h('span', { class: 'ct', text: all.filter(i => i.courseId === c.id).length }))));
    const list = items().filter(i => i.start > now - 21 * DAY && i.start < now + 150 * DAY).sort((a, b) => ui.sort === 'oldest' ? a.start - b.start : b.start - a.start);
    const timeline = h('div', { class: 'timeline' });
    let lastKey = null, todayShown = false;
    const todayKey = C.dayKey(now);
    const marker = () => { todayShown = true; return h('div', { class: 'tl-day today', id: 'tl-today', text: t('today') + ' · ' + fmt(now, { day: '2-digit', month: 'short' }) }); };
    for (const item of list) {
      const key = C.dayKey(item.start);
      if (!todayShown && (ui.sort === 'oldest' ? key > todayKey : key < todayKey)) timeline.append(marker());
      if (key !== lastKey) {
        if (key === todayKey && !todayShown) timeline.append(marker());
        else if (key !== todayKey) timeline.append(h('div', { class: 'tl-day', text: fmt(item.start, { day: '2-digit', month: 'short', weekday: 'short' }) }));
        timeline.append(h('div', { class: 'tl-items' })); lastKey = key;
      }
      timeline.lastChild.append(card(item, now));
    }
    if (!todayShown) timeline.append(marker());
    const main = h('section', {},
      h('div', { class: 'toolbar' }, h('h2', { text: ui.course === 'all' ? t('allCourses') : courseById(ui.course)?.fullName || '' }),
        h('div', { class: 'seg' }, ...['newest', 'oldest'].map(sort => h('button', { type: 'button', 'aria-pressed': String(ui.sort === sort), onclick: () => { ui.sort = sort; saveUi(); render(); } }, t(sort)))),
        h('button', { type: 'button', class: 'btn small', onclick: () => $('#tl-today')?.scrollIntoView({ block: 'center', behavior: 'smooth' }) }, t('today'))),
      list.length ? timeline : h('p', { class: 'empty box', text: t('nothing') }));
    view.append(h('div', { class: 'list-layout' }, side, main));
  }

  // ---------- Timetable ----------
  function timetableData() {
    const all = items();
    const slots = C.buildTimetable(all);
    const days = Math.max(5, ...slots.map(s => s.weekday + 1));
    const startHour = Math.min(8, ...slots.map(s => Math.floor(s.start / 60)));
    const endHour = Math.max(18, ...slots.map(s => Math.ceil(s.end / 60)));
    return { all, slots, days, startHour, endHour };
  }
  function renderTimetable(view) {
    const { all, slots, days, startHour, endHour } = timetableData();
    const now = Date.now(), today = C.mytParts(now), weekStart = C.startOfWeek(now);
    const PX = 64, hours = endHour - startHour;
    const toolbar = h('div', { class: 'toolbar' }, h('h2', { text: t('timetable') + ' · ' + fmt(weekStart + 12 * 3600000, { day: 'numeric', month: 'short' }) + ' – ' + fmt(weekStart + (days - 1) * DAY + 12 * 3600000, { day: 'numeric', month: 'short' }) }),
      h('button', { type: 'button', class: 'btn small', onclick: () => download('umspec-timetable.csv', new Blob([C.timetableCSV(slots, courses())], { type: 'text/csv' })) }, svg(ICONS.down), t('exportCsv')),
      h('button', { type: 'button', class: 'btn small', onclick: () => download('umspec-classes.ics', new Blob([C.sessionsICS(all.filter(i => i.kind === 'attendance'), courses())], { type: 'text/calendar' })) }, svg(ICONS.down), t('exportIcs')),
      h('button', { type: 'button', class: 'btn small', onclick: () => exportPng(slots, days, startHour, endHour) }, svg(ICONS.down), t('exportPng')),
      h('button', { type: 'button', class: 'btn small', onclick: () => { document.body.classList.add('print-tt'); print(); document.body.classList.remove('print-tt'); } }, t('print')));
    if (!slots.length) { view.append(toolbar, h('p', { class: 'empty box', text: data ? t('noTimetable') : t('nothing') })); return; }
    const grid = h('div', { class: 'tt-grid', style: 'grid-template-columns: 52px repeat(' + days + ', minmax(110px, 1fr))' });
    const hoursCol = h('div', {}, h('div', { class: 'tt-dayname', text: ' ' }));
    for (let hour = startHour; hour < endHour; hour++) hoursCol.append(h('div', { class: 'tt-hour', style: 'height:' + PX + 'px', text: String(hour).padStart(2, '0') + ':00' }));
    grid.append(hoursCol);
    for (let wd = 0; wd < days; wd++) {
      const date = weekStart + wd * DAY + 12 * 3600000;
      const col = h('div', { class: 'tt-col' + (wd === today.wd ? ' today' : '') }, h('div', { class: 'tt-dayname', text: fmt(date, { weekday: 'short', day: 'numeric' }) }));
      const body = h('div', { style: 'position:relative;height:' + hours * PX + 'px' });
      for (let i = 0; i < hours; i++) body.append(h('div', { class: 'line', style: 'top:' + i * PX + 'px' }));
      const daySlots = C.layoutDaySlots(slots.filter(s => s.weekday === wd));
      for (const { slot, lane, lanes } of daySlots) {
        const c = courseById(slot.courseId) || {};
        const live = wd === today.wd && today.min >= slot.start && today.min < slot.end;
        body.append(h('div', { class: 'tt-block' + (live ? ' live' : ''), title: (c.fullName || slot.title) + ' · ' + slot.count + ' ' + t('sessions'),
          style: 'top:' + ((slot.start - startHour * 60) / 60 * PX + 1) + 'px;height:' + Math.max(28, (slot.end - slot.start) / 60 * PX - 3) + 'px;' + (lanes > 1 ? 'left:calc(' + (lane / lanes * 100) + '% + 3px);right:auto;width:calc(' + (100 / lanes) + '% - 6px)' : '') },
          live ? h('span', { class: 'badge', text: '● ' + t('live2') }) : null,
          h('span', { class: 'k' }, (c.code || '') + ' · ' + (c.abbrev || ''), h('i', { text: slot.type })),
          h('span', { class: 'tm', text: C.hhmm(slot.start) + ' – ' + C.hhmm(slot.end) + (slot.occ?.length === 1 ? ' · OCC ' + slot.occ[0] : occFor(slot.courseId) ? ' · OCC ' + occFor(slot.courseId) : '') }),
          h('span', { class: 'nm', text: c.name || slot.title })));
      }
      if (wd === today.wd && today.min >= startHour * 60 && today.min < endHour * 60) body.append(h('div', { class: 'tt-now', style: 'top:' + (today.min - startHour * 60) / 60 * PX + 'px' }));
      col.append(body); grid.append(col);
    }
    view.append(toolbar, h('div', { class: 'box tt' }, grid));
  }
  function exportPng(slots, days, startHour, endHour) {
    const scale = 2, colW = 200, hourH = 70, left = 60, top = 70, W = left + days * colW + 20, H = top + (endHour - startHour) * hourH + 20;
    const canvas = document.createElement('canvas'); canvas.width = W * scale; canvas.height = H * scale;
    const g = canvas.getContext('2d'); g.scale(scale, scale);
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#15181d'; g.font = '700 18px system-ui, sans-serif'; g.fillText('UM Spec · ' + t('timetable'), left, 30);
    const weekStart = C.startOfWeek(Date.now());
    g.font = '600 12px ui-monospace, Consolas, monospace';
    for (let wd = 0; wd < days; wd++) { g.fillStyle = '#5d6573'; g.fillText(fmt(weekStart + wd * DAY + 12 * 3600000, { weekday: 'short' }).toUpperCase(), left + wd * colW + 8, top - 12); }
    for (let i = 0; i <= endHour - startHour; i++) {
      const y = top + i * hourH; g.strokeStyle = '#e2e5ea'; g.lineWidth = 1; g.beginPath(); g.moveTo(left, y); g.lineTo(left + days * colW, y); g.stroke();
      if (i < endHour - startHour) { g.fillStyle = '#8a919c'; g.font = '500 11px ui-monospace, Consolas, monospace'; g.fillText(String(startHour + i).padStart(2, '0') + ':00', 8, y + 14); }
    }
    for (let wd = 0; wd <= days; wd++) { g.beginPath(); g.moveTo(left + wd * colW, top); g.lineTo(left + wd * colW, H - 20); g.stroke(); }
    const fit = (text, max) => { let s = String(text); while (s.length > 1 && g.measureText(s).width > max) s = s.slice(0, -2) + '…'; return s; };
    for (let wd = 0; wd < days; wd++) {
      for (const { slot, lane, lanes } of C.layoutDaySlots(slots.filter(s => s.weekday === wd))) {
        const c = courseById(slot.courseId) || {};
        const laneW = (colW - 8) / lanes;
        const x = left + slot.weekday * colW + 4 + lane * laneW;
        const w = Math.max(24, laneW - (lanes > 1 ? 2 : 0));
        const y = top + (slot.start - startHour * 60) / 60 * hourH + 2, hh = Math.max(26, (slot.end - slot.start) / 60 * hourH - 4);
        g.fillStyle = '#f5f6f8'; g.strokeStyle = '#cfd4dc'; g.beginPath(); g.roundRect(x, y, w, hh, 6); g.fill(); g.stroke();
        g.fillStyle = '#15181d'; g.fillRect(x, y, 3, hh);
        g.font = '700 12px ui-monospace, Consolas, monospace'; g.fillText(fit((c.code || '') + ' ' + slot.type, w - 16), x + 8, y + 17);
        g.font = '500 11px ui-monospace, Consolas, monospace'; g.fillStyle = '#5d6573'; g.fillText(fit(C.hhmm(slot.start) + ' – ' + C.hhmm(slot.end) + (slot.occ?.length === 1 ? ' · OCC ' + slot.occ[0] : ''), w - 16), x + 8, y + 32);
        if (hh > 44) { g.font = '600 12px system-ui, sans-serif'; g.fillStyle = '#15181d'; g.fillText(fit(c.name || slot.title, w - 16), x + 8, y + 49); }
      }
    }
    canvas.toBlob(blob => blob && download('umspec-timetable.png', blob), 'image/png');
  }

  // ---------- Materials ----------
  const TYPES = ['all', 'pdf', 'pptx', 'docx', 'xlsx', 'zip', 'video', 'link', 'other'];
  const typeGroup = type => ['pdf', 'pptx', 'docx', 'xlsx', 'zip', 'video', 'link'].includes(type) ? type : 'other';
  function materialList() {
    const q = ui.search.trim().toLowerCase();
    return (data?.materials || []).filter(m => (ui.course === 'all' || m.courseId === ui.course) && (prefs.showAllOcc || C.occMatches(m.occ, occFor(m.courseId))) &&
      (ui.type === 'all' || typeGroup(m.type) === ui.type) && (!q || (m.name + ' ' + m.section).toLowerCase().includes(q)));
  }
  function renderMaterials(view) {
    const list = materialList();
    const search = h('input', { type: 'search', placeholder: t('search'), value: ui.search, 'aria-label': t('search') });
    search.addEventListener('input', () => { ui.search = search.value; renderMaterialsBody(); });
    const tools = h('div', { class: 'mat-tools' },
      h('label', { class: 'search' }, svg(ICONS.search), search),
      h('div', { class: 'type-chips', role: 'group', 'aria-label': t('type') }, ...TYPES.map(type => h('button', { type: 'button', 'aria-pressed': String(ui.type === type), onclick: () => { ui.type = type; saveUi(); render(); } }, type === 'all' ? t('all') : '.' + type.toUpperCase()))),
      h('button', { type: 'button', class: 'btn small', onclick: () => { materialList().forEach(m => selected.add(m.key)); render(); } }, t('selectAll')),
      h('button', { type: 'button', class: 'btn small', onclick: () => { selected.clear(); render(); } }, t('clearSelection')));
    const body = h('div', { id: 'mat-body' });
    view.append(tools, body);
    renderMaterialsBody(list);
    renderSelbar();
  }
  function renderMaterialsBody(list = materialList()) {
    const body = $('#mat-body'); if (!body) return;
    body.replaceChildren();
    if (!list.length) { body.append(h('p', { class: 'empty box', text: data ? '—' : t('nothing') })); return; }
    const byCourse = new Map();
    for (const m of list) { if (!byCourse.has(m.courseId)) byCourse.set(m.courseId, []); byCourse.get(m.courseId).push(m); }
    for (const [courseId, files] of byCourse) {
      const c = courseById(courseId) || { code: courseId, name: '', abbrev: '?' };
      const open = ui.search || ui.course !== 'all' || ui.expanded.includes(courseId);
      const pack = h('section', { class: 'box course-pack' + (open ? ' open' : '') });
      const toggle = () => { ui.expanded = ui.expanded.includes(courseId) ? ui.expanded.filter(x => x !== courseId) : [...ui.expanded, courseId]; saveUi(); renderMaterialsBody(); };
      pack.append(h('div', { class: 'pack-head', role: 'button', tabindex: '0', 'aria-expanded': String(Boolean(open)), onclick: toggle, onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } } },
        h('span', { class: 'caret' }, svg(ICONS.caret)), h('span', { class: 'ab', text: c.abbrev }), h('span', { class: 'nm', text: c.code + '  ' + c.name }), h('span', { class: 'ct', text: files.length + ' ' + t('files') }),
        h('span', { class: 'topbar-spacer' }),
        h('button', { type: 'button', class: 'btn small', onclick: e => { e.stopPropagation(); downloadZip(c.code + '_CoursePack', files); } }, svg(ICONS.down), t('coursePack'))));
      if (open) {
        const sections = new Map();
        for (const f of files) { if (!sections.has(f.section)) sections.set(f.section, []); sections.get(f.section).push(f); }
        for (const [name, sectionFiles] of sections) {
          const sid = courseId + '|' + name, collapsed = ui.collapsedSections.includes(sid) && !ui.search;
          const syncSectionCheck = box => {
            const count = sectionFiles.filter(f => selected.has(f.key)).length;
            box.checked = count > 0 && count === sectionFiles.length;
            box.indeterminate = count > 0 && count < sectionFiles.length;
          };
          const check = h('input', { type: 'checkbox', 'aria-label': name, onclick: e => e.stopPropagation(), onchange: e => { sectionFiles.forEach(f => e.target.checked ? selected.add(f.key) : selected.delete(f.key)); renderMaterialsBody(); renderSelbar(); } });
          syncSectionCheck(check);
          const flip = () => { ui.collapsedSections = collapsed ? ui.collapsedSections.filter(x => x !== sid) : [...ui.collapsedSections, sid]; saveUi(); renderMaterialsBody(); };
          const sec = h('div', { class: 'sec' + (collapsed ? '' : ' open') }, h('div', { class: 'sec-head', role: 'button', tabindex: '0', 'aria-expanded': String(!collapsed), onclick: flip, onkeydown: e => { if (e.key === 'Enter') flip(); } },
            h('span', { class: 'caret' }, svg(ICONS.caret)), check, h('span', { text: name }), h('span', { class: 'ct', text: sectionFiles.length + ' ' + t('files') })));
          if (!collapsed) for (const f of sectionFiles) sec.append(fileRow(f, () => syncSectionCheck(check)));
          pack.append(sec);
        }
      }
      body.append(pack);
    }
  }
  function fileRow(f, onToggle) {
    const check = h('input', { type: 'checkbox', 'aria-label': f.name, onchange: e => { e.target.checked ? selected.add(f.key) : selected.delete(f.key); onToggle?.(); renderSelbar(); } });
    check.checked = selected.has(f.key);
    const previewable = ['pdf', 'image', 'video', 'file', 'code'].includes(f.type);
    return h('div', { class: 'file' }, check, h('span', { class: 'ftype ' + f.type, text: f.type }), h('span', { class: 'fn', title: f.name, text: f.name }),
      driveKeys.has(f.courseId + ':' + f.cmid) ? h('span', { class: 'synced', text: '✓ ' + t('inDrive') }) : h('span'),
      h('span', { class: 'acts' },
        previewable ? h('button', { type: 'button', class: 'mini', title: t('preview'), 'aria-label': t('preview') + ': ' + f.name, onclick: () => preview(f) }, svg(ICONS.eye)) : null,
        h('a', { class: 'mini', href: f.url, target: '_blank', rel: 'noopener noreferrer', title: t('openSpectrum'), 'aria-label': t('openSpectrum') + ': ' + f.name }, svg(ICONS.ext))));
  }
  function renderSelbar() {
    let bar = $('.selbar');
    if (ui.view !== 'materials' || (!selected.size && !zipping)) { bar?.remove(); return; }
    if (!bar) { bar = h('div', { class: 'selbar' }); document.body.append(bar); }
    const progress = h('div', { class: 'progress' }, h('span', { style: 'width:' + (zipping ? zipping.percent : 0) + '%' }));
    bar.replaceChildren(h('span', { text: zipping ? t('zipping') + ' ' + zipping.done + ' ' + t('of') + ' ' + zipping.total : selected.size + ' ' + t('files') }), progress,
      zipping ? h('button', { type: 'button', class: 'btn small', onclick: () => zipping?.controller.abort() }, '✕') :
        h('button', { type: 'button', class: 'btn small', onclick: () => { selected.clear(); render(); } }, t('clearSelection')),
      h('button', { type: 'button', class: 'btn small primary', disabled: Boolean(zipping), onclick: () => downloadZip('UMSpec_Materials') }, svg(ICONS.down), t('downloadSelected')));
  }
  const safeName = value => String(value || 'file').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'file';
  async function downloadZip(baseName, explicitFiles = null) {
    if (zipping) return;
    const files = explicitFiles ? [...explicitFiles] : (data?.materials || []).filter(m => selected.has(m.key));
    if (!files.length) return;
    const controller = new AbortController();
    zipping = { done: 0, total: files.length, percent: 0, controller };
    renderSelbar();
    const zip = new JSZip(), used = new Set(), links = [], failed = [];
    let bytes = 0;
    const addBlob = async (dir, fileName, response) => {
      const blob = await response.blob();
      bytes += blob.size;
      if (bytes > 1.5 * 1024 ** 3) throw new Error('Selection is larger than 1.5 GB. Download fewer files at a time.');
      zip.file(C.uniquePath(used, dir, safeName(fileName)), blob);
    };
    try {
      for (const f of files) {
        if (controller.signal.aborted) throw new DOMException('Stopped', 'AbortError');
        const c = courseById(f.courseId) || { code: f.courseId };
        const folder = safeName(c.code + ' ' + (c.name || '')) + '/' + safeName(f.section);
        try {
          if (['link', 'video', 'page'].includes(f.type)) links.push('- [' + f.name.replace(/[[\]]/g, '') + '](<' + f.url + '>)');
          else {
            const result = await collector.resolveFile(f, controller.signal);
            if (result.kind === 'folder') {
              const subFolder = folder + '/' + safeName(f.name);
              for (const entry of result.files || []) {
                if (controller.signal.aborted) throw new DOMException('Stopped', 'AbortError');
                try {
                  const fetched = await collector.fetchResolvedFile(entry.url, entry.name, controller.signal);
                  if (fetched.kind === 'file') await addBlob(subFolder, fetched.name, fetched.response);
                  else links.push('- [' + entry.name.replace(/[[\]]/g, '') + '](<' + fetched.url + '>)');
                } catch (entryError) {
                  if (controller.signal.aborted || /1\.5 GB/.test(entryError.message)) throw entryError;
                  failed.push(f.name + ' / ' + entry.name + ' — ' + entryError.message);
                }
              }
            } else if (result.kind !== 'file') links.push('- [' + f.name.replace(/[[\]]/g, '') + '](<' + result.url + '>)');
            else await addBlob(folder, result.name, result.response);
          }
        } catch (error) {
          if (controller.signal.aborted || /1\.5 GB/.test(error.message)) throw error;
          failed.push(f.name + ' — ' + error.message);
        }
        zipping.done++; zipping.percent = Math.round(zipping.done / files.length * 90); renderSelbar();
      }
      if (links.length) zip.file(C.uniquePath(used, '', 'LINKS.md'), '# Links\n\n' + links.join('\n') + '\n');
      if (failed.length) zip.file(C.uniquePath(used, '', 'NOT_INCLUDED.txt'), failed.join('\r\n') + '\r\n');
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, meta => { zipping.percent = 90 + Math.round(meta.percent / 10); renderSelbar(); });
      download(safeName(baseName) + '.zip', blob);
      notice(failed.length ? failed.length + ' file(s) could not be read — see NOT_INCLUDED.txt in the ZIP.' : '');
      if (!explicitFiles) selected.clear();
    } catch (error) {
      notice(controller.signal.aborted ? '' : error.message, controller.signal.aborted ? '' : 'error');
    } finally { zipping = null; render(); }
  }
  async function preview(f) {
    const dialog = $('#preview'), body = $('#preview-body');
    $('#preview-title').textContent = f.name;
    $('#preview-open').href = f.url; $('#preview-open').textContent = t('openSpectrum') + ' ↗';
    body.replaceChildren(h('p', { class: 'empty', text: '…' }));
    dialog.showModal();
    const controller = new AbortController();
    dialog.addEventListener('close', () => { controller.abort(); for (const node of body.querySelectorAll('[data-blob]')) URL.revokeObjectURL(node.dataset.blob); body.replaceChildren(); }, { once: true });
    try {
      const result = await collector.resolveFile(f, controller.signal);
      if (result.kind !== 'file') { body.replaceChildren(h('p', { class: 'empty' }, t('previewUnavailable') + ' ', h('a', { href: result.url, target: '_blank', rel: 'noopener noreferrer', text: t('openSpectrum') + ' ↗' }))); return; }
      const type = result.type.split(';')[0].trim().toLowerCase();
      if (!/^(application\/pdf|image\/(png|jpe?g|gif|webp)|video\/(mp4|webm)|text\/plain)$/.test(type)) {
        await result.response.body?.cancel();
        body.replaceChildren(h('p', { class: 'empty' }, t('previewUnavailable') + ' (' + (result.name.split('.').pop() || type).toUpperCase() + ') ', h('a', { href: result.url, target: '_blank', rel: 'noopener noreferrer', text: t('openSpectrum') + ' ↗' })));
        return;
      }
      const blob = new Blob([await result.response.arrayBuffer()], { type });
      const url = URL.createObjectURL(blob);
      const node = type.startsWith('image/') ? h('img', { src: url, alt: f.name }) : type.startsWith('video/') ? h('video', { src: url, controls: true }) : h('iframe', { src: url, title: f.name });
      node.dataset.blob = url;
      body.replaceChildren(node);
    } catch (error) {
      if (!controller.signal.aborted) body.replaceChildren(h('p', { class: 'empty', text: error.code === 'LOGIN_REQUIRED' ? t('notSignedIn') : error.message }));
    }
  }
  $('#preview-close').addEventListener('click', () => $('#preview').close());

  // ---------- Settings ----------
  function renderSettings(view) {
    const occBox = h('section', { class: 'box' }, h('h3', { text: t('occTitle') }), h('p', { class: 'help', text: t('occHelp') }));
    for (const c of courses()) {
      const hasManual = Boolean(prefs.occ && Object.hasOwn(prefs.occ, c.id));
      const manual = hasManual ? prefs.occ[c.id] : undefined;
      const detected = data?.detectedOcc?.[c.id]?.occ;
      const shown = hasManual ? (manual || '') : (detected || '');
      const input = h('input', { type: 'text', inputmode: 'numeric', maxlength: '3', value: shown, placeholder: '—', 'aria-label': c.code + ' OCC' });
      const commit = value => {
        const clean = String(value || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
        const occ = { ...prefs.occ };
        if (clean && /^\d{1,2}[A-Z]?$/.test(clean)) {
          if (clean === detected) delete occ[c.id];
          else occ[c.id] = clean;
        } else if (detected) {
          occ[c.id] = '';
        } else {
          delete occ[c.id];
        }
        savePrefs({ occ });
      };
      const resetAuto = () => { const occ = { ...prefs.occ }; delete occ[c.id]; savePrefs({ occ }); };
      input.addEventListener('change', () => commit(input.value));
      const step = delta => { const n = Math.max(1, Math.min(99, (parseInt(input.value, 10) || 0) + delta)); input.value = String(n); commit(n); };
      occBox.append(h('div', { class: 'occ-row' },
        h('div', { class: 'c' }, c.code, h('small', { text: c.name })),
        h('div', {}, !hasManual && detected ? h('span', { class: 'auto', text: '● ' + t('occAuto') }) : hasManual && detected ? h('button', { type: 'button', class: 'btn small', style: 'margin-right:8px', onclick: resetAuto }, t('occAuto')) : null,
          h('span', { class: 'stepper' }, h('button', { type: 'button', 'aria-label': '−', onclick: () => step(-1) }, '−'), input, h('button', { type: 'button', 'aria-label': '+', onclick: () => step(1) }, '+')))));
    }
    if (!courses().length) occBox.append(h('p', { class: 'empty', text: t('nothing') }));
    occBox.append(h('div', { class: 'row' }, h('span', { text: t('showAllOcc') }), toggle(prefs.showAllOcc, value => savePrefs({ showAllOcc: value }))));

    const r = prefs.reminders;
    const leads = [[1440, '1 ' + t('day')], [180, '3' + t('hours')], [60, '1' + t('hours')]];
    const reminderBox = h('section', { class: 'box' }, h('h3', { text: t('reminders') }), h('p', { class: 'help', text: t('remindersHelp') }),
      h('div', { class: 'row' }, h('span', { text: t('enableReminders') }), toggle(r.enabled, async value => {
        if (value && !(await chrome.permissions.request({ permissions: ['notifications'] }).catch(() => false))) { notice(t('permissionDenied'), 'error'); render(); return; }
        await savePrefs({ reminders: { ...r, enabled: value } });
      })),
      h('div', { class: 'row' }, h('span', { text: t('deadlineLead') }), h('div', { class: 'checks' }, ...leads.map(([value, label]) => {
        const box = h('input', { type: 'checkbox', disabled: !r.enabled, onchange: e => savePrefs({ reminders: { ...r, deadlineLeads: e.target.checked ? [...new Set([...r.deadlineLeads, value])] : r.deadlineLeads.filter(x => x !== value) } }) });
        box.checked = r.deadlineLeads.includes(value);
        return h('label', {}, box, label);
      }))),
      h('div', { class: 'row' }, h('span', { text: t('classLead') }), (() => {
        const select = h('select', { class: 'sel', disabled: !r.enabled, onchange: e => savePrefs({ reminders: { ...r, classLead: e.target.value === 'off' ? null : Number(e.target.value) } }) },
          h('option', { value: 'off', text: t('off') }), ...[0, 5, 10, 15, 30].map(n => h('option', { value: String(n), text: n + ' ' + t('minutes') })));
        select.value = r.classLead == null ? 'off' : String(r.classLead);
        return select;
      })()));

    const look = h('section', { class: 'box' }, h('h3', { text: t('language') + ' · ' + t('theme') }),
      h('div', { class: 'row' }, h('span', { text: t('language') }), h('div', { class: 'seg' }, ...[['en', 'English'], ['ms', 'Bahasa Melayu'], ['zh', '中文']].map(([value, label]) => h('button', { type: 'button', 'aria-pressed': String(prefs.lang === value), onclick: () => savePrefs({ lang: value }) }, label)))),
      h('div', { class: 'row' }, h('span', { text: t('theme') }), h('div', { class: 'seg' }, ...['system', 'light', 'dark'].map(value => h('button', { type: 'button', 'aria-pressed': String(prefs.theme === value), onclick: () => savePrefs({ theme: value }) }, t('theme' + value[0].toUpperCase() + value.slice(1)))))),
      h('div', { class: 'row' }, h('span', { class: 'mono', text: 'Alt+Shift+P' }), h('button', { type: 'button', class: 'btn small', onclick: async () => { await chrome.storage.local.remove(DATA); data = null; await chrome.runtime.sendMessage({ type: 'PLANNER_RESCHEDULE' }).catch(() => {}); render(); } }, t('clearData'))));
    view.append(h('div', { class: 'settings' }, occBox, reminderBox, look));
  }
  function toggle(value, change) {
    const input = h('input', { type: 'checkbox', role: 'switch' }); input.checked = Boolean(value);
    input.addEventListener('change', () => change(input.checked));
    return h('label', { class: 'switch' }, input, h('span'));
  }

  // ---------- Refresh ----------
  async function refresh() {
    if (busy) return;
    busy = true; renderShell(); notice(t('refreshing'));
    try {
      // An open Spectrum tab already has a verified session, so it is asked first; this page reads Spectrum itself otherwise.
      let done = false;
      const tabs = await chrome.tabs.query({ url: ORIGIN + '/*' }).catch(() => []);
      for (const tab of tabs) {
        try {
          const response = await chrome.tabs.sendMessage(tab.id, { type: 'UMSPEC_PLANNER_COLLECT' });
          if (response?.ok) { done = true; break; }
        } catch {}
      }
      if (!done) {
        const knownOcc = {};
        for (const c of courses()) { const occ = occFor(c.id); if (occ) knownOcc[c.id] = occ; }
        const fresh = await collector.collect({ knownOcc, progress: (stage, percent) => notice(t('refreshing') + ' ' + percent + '%') });
        const saved = await chrome.runtime.sendMessage({ type: 'PLANNER_SAVE', data: fresh });
        if (!saved?.ok) throw new Error(saved?.error?.message || 'Could not save planner data.');
      }
      await load();
      const warnings = data?.warnings || [];
      notice(warnings.length ? t('partial') + ' ' + warnings.slice(0, 3).join(' · ') : '');
    } catch (error) {
      const login = error.code === 'LOGIN_REQUIRED' || /sign in/i.test(error.message);
      notice(login ? t('notSignedIn') : error.message, 'error', login ? [h('a', { class: 'btn small', href: ORIGIN + '/my/', target: '_blank', rel: 'noopener noreferrer', text: t('openSpectrum') + ' ↗' })] : []);
    } finally { busy = false; render(); }
  }

  function download(name, blob) {
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  // ---------- Render ----------
  function render() {
    if (!prefs) return;
    renderShell();
    const view = $('#view'); view.replaceChildren();
    if (ui.view === 'calendar') renderCalendar(view);
    else if (ui.view === 'list') renderList(view);
    else if (ui.view === 'timetable') renderTimetable(view);
    else if (ui.view === 'materials') renderMaterials(view);
    else renderSettings(view);
    if (ui.view !== 'materials') $('.selbar')?.remove();
    if (!data && !busy && ui.view !== 'settings' && $('#notice').hidden) notice(t('nothing'), '', [h('button', { type: 'button', class: 'btn small primary', onclick: refresh }, t('refresh'))]);
  }

  // ---------- Wiring ----------
  for (const tab of document.querySelectorAll('[data-view]')) {
    tab.addEventListener('click', () => setView(tab.dataset.view));
    tab.addEventListener('keydown', event => {
      const tabs = [...document.querySelectorAll('[data-view]')], i = tabs.indexOf(tab);
      const next = { ArrowDown: i + 1, ArrowRight: i + 1, ArrowUp: i - 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[event.key];
      if (next == null) return;
      event.preventDefault(); const target = tabs[(next + tabs.length) % tabs.length]; setView(target.dataset.view); target.focus();
    });
  }
  for (const button of document.querySelectorAll('[data-lang]')) button.addEventListener('click', () => savePrefs({ lang: button.dataset.lang }));
  $('#theme-toggle').addEventListener('click', () => savePrefs({ theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' }));
  $('#refresh').addEventListener('click', refresh);
  $('#open-side').addEventListener('click', async () => { try { const win = await chrome.windows.getCurrent(); await chrome.sidePanel.open({ windowId: win.id }); } catch (error) { notice(error.message, 'error'); } });
  $('#pop-out').addEventListener('click', () => chrome.windows.create({ url: chrome.runtime.getURL('dashboard/dashboard.html?panel=1'), type: 'popup', width: 480, height: 820 }));
  // Keeps the timetable's "now" line and LIVE badge current without disturbing other views.
  setInterval(() => { if (ui.view === 'timetable' && !document.hidden) render(); }, 60000);

  load().then(() => {
    render();
    scrollToToday();
    if (!data || Date.now() - data.collectedAt > 30 * 60000) refresh();
  });
})();
