/* Keeps the planner fresh while Spectrum is open and filters course pages to the student's own OCC. */
(function (root) {
  'use strict';
  if (typeof document === 'undefined' || !root.chrome?.runtime?.id || root.top !== root) return;
  const core = () => root.UmSpecPlannerCore, collector = () => root.UmSpecPlannerCollect;
  const STALE_MS = 30 * 60000, LOCK = 'umspec_planner_lock';
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
  function collect() {
    if (running) return running;
    running = (async () => {
      const key = sesskey();
      if (!key) throw Object.assign(new Error('Sign in to Spectrum, then refresh the planner.'), { code: 'LOGIN_REQUIRED' });
      let userId = null;
      try { userId = root.UmSpecExporter?.getContext?.()?.userId || null; } catch {}
      const data = await collector().collect({ sesskey: key, userId });
      return send({ type: 'PLANNER_SAVE', data });
    })().finally(() => { running = null; });
    return running;
  }
  function lockFree() {
    try {
      const held = Number(localStorage.getItem(LOCK) || 0);
      if (Date.now() - held < 5 * 60000) return false;
      localStorage.setItem(LOCK, String(Date.now()));
      return true;
    } catch { return true; }
  }
  function release() { try { localStorage.removeItem(LOCK); } catch {} }

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
      const found = core().parseOcc(label);
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
    const open = document.createElement('button');
    open.type = 'button'; open.textContent = t('planner') + ' ↗';
    open.addEventListener('click', () => send({ type: 'PLANNER_OPEN' }).catch(() => {}));
    bar.append(label, summary, toggle, open);
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
    collect().then(data => reply({ ok: true, data }), error => reply({ ok: false, error: { code: error.code || 'REQUEST_FAILED', message: String(error.message).slice(0, 240) } }));
    return true;
  });

  const start = async () => {
    let meta = null;
    try { meta = courseId ? await refreshOcc() : await send({ type: 'PLANNER_META' }); } catch { return; }
    if (courseId) {
      // Moodle loads some sections lazily; re-apply the saved filter locally, ignoring the bar's own updates.
      let pending = 0;
      new MutationObserver(records => {
        if (records.every(record => record.target.closest?.('.umspec-occ-bar') || [...record.addedNodes].every(n => n.classList?.contains('umspec-occ-bar')))) return;
        clearTimeout(pending); pending = setTimeout(() => { if (lastMeta) applyOcc(lastMeta); }, 400);
      }).observe(document.querySelector('#region-main') || document.body, { childList: true, subtree: true });
    }
    if (!sesskey() || (meta?.collectedAt && Date.now() - meta.collectedAt < STALE_MS) || !lockFree()) return;
    try { await collect(); if (courseId) await refreshOcc(); } catch {} finally { release(); }
  };
  const later = () => setTimeout(() => { start().catch(() => {}); }, 6000);
  if (document.readyState === 'complete') later(); else root.addEventListener('load', later, { once: true });
})(globalThis);
