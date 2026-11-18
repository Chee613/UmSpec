/* Planner storage, reminders and toolbar badge. Reminders only notify; nothing here acts on Spectrum. */
(function (root) {
  'use strict';
  const core = () => root.UmSpecPlannerCore || require('../shared/planner-core.js');
  const DATA = 'umspecPlanner', PREFS = 'umspecPlannerPrefs', PLAN = 'umspecPlannerReminders';
  const ALARM_PREFIX = 'umspec-r:', BADGE_ALARM = 'umspec-badge';
  const error = (code, message) => Object.assign(new Error(message), { code });
  const defaults = () => ({ lang: 'en', theme: 'system', occ: {}, showAllOcc: false, view: 'calendar', calendarMode: 'dots',
    reminders: { enabled: false, deadlineLeads: [1440, 60], classLead: 10 } });

  async function read() {
    const saved = await chrome.storage.local.get([DATA, PREFS]);
    const prefs = { ...defaults(), ...(saved[PREFS] || {}) };
    prefs.reminders = { ...defaults().reminders, ...(prefs.reminders || {}) };
    return { data: saved[DATA] || null, prefs };
  }
  function trusted(sender) {
    if (sender?.id !== chrome.runtime.id) return null;
    const extensionPage = typeof sender.url === 'string' && sender.url.startsWith(chrome.runtime.getURL(''));
    if (extensionPage) return 'page';
    try { if (new URL(sender.url).origin === core().ORIGIN && Number.isInteger(sender.tab?.id)) return 'content'; } catch {}
    return null;
  }
  async function refreshBadge() {
    const { data, prefs } = await read();
    const count = data ? core().dueSoonCount(data, prefs) : 0;
    await chrome.action?.setBadgeBackgroundColor?.({ color: '#d9480f' });
    await chrome.action?.setBadgeText?.({ text: count ? String(Math.min(count, 99)) : '' });
  }
  async function schedule() {
    if (!chrome.alarms) return;
    const { data, prefs } = await read();
    const plan = core().reminderPlan(data, prefs);
    for (const alarm of await chrome.alarms.getAll()) if (alarm.name.startsWith(ALARM_PREFIX)) await chrome.alarms.clear(alarm.name);
    const stored = {};
    for (const item of plan) {
      stored[item.key] = item;
      await chrome.alarms.create(ALARM_PREFIX + item.key, { when: item.when });
    }
    await chrome.storage.local.set({ [PLAN]: stored });
    if (data) await chrome.alarms.create(BADGE_ALARM, { periodInMinutes: 60 });
    else await chrome.alarms.clear(BADGE_ALARM);
    await refreshBadge();
  }
  function reminderText(item, lang) {
    const t = key => core().t(lang, key);
    const due = new Date(item.due).toLocaleString(core().LANGS[lang] || 'en-MY', { timeZone: 'Asia/Kuala_Lumpur', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const lead = item.lead >= 1440 ? Math.round(item.lead / 1440) + ' ' + t('day') : item.lead >= 60 ? Math.round(item.lead / 60) + t('hours') : item.lead + ' ' + t('minutes');
    return item.kind === 'attendance' ? t('attendance') + ' · ' + due + ' (' + lead + ')' : t(item.kind) + ' · ' + t('dueIn') + ' ' + lead + ' · ' + due;
  }
  async function onAlarm(alarm) {
    if (alarm.name === BADGE_ALARM) return refreshBadge();
    if (!alarm.name.startsWith(ALARM_PREFIX)) return;
    const key = alarm.name.slice(ALARM_PREFIX.length);
    const { [PLAN]: plan = {} } = await chrome.storage.local.get(PLAN);
    const item = plan[key];
    if (!item || !chrome.notifications) return;
    const { prefs } = await read();
    if (!prefs.reminders.enabled) return;
    chrome.notifications.create(ALARM_PREFIX + key, { type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: item.title.slice(0, 120), message: reminderText(item, prefs.lang), priority: 2 });
  }
  async function onNotificationClick(id) {
    if (!id.startsWith(ALARM_PREFIX)) return;
    const { [PLAN]: plan = {} } = await chrome.storage.local.get(PLAN);
    const url = core().safeUrl(plan[id.slice(ALARM_PREFIX.length)]?.url, { spectrumOnly: true });
    if (url) chrome.tabs.create({ url });
    chrome.notifications.clear(id);
  }
  function openPlanner() { return chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') }); }

  async function handle(message, sender) {
    const kind = trusted(sender);
    if (!kind) throw error('FORBIDDEN', 'Unknown planner sender.');
    if (message.type === 'PLANNER_META') {
      const { data, prefs } = await read();
      return { collectedAt: data?.collectedAt || null, userHash: data?.userHash || null, occ: prefs.occ, detectedOcc: data?.detectedOcc || {},
        showAllOcc: prefs.showAllOcc, lang: prefs.lang, courses: (data?.courses || []).map(c => ({ id: c.id, code: c.code })) };
    }
    if (message.type === 'PLANNER_SAVE') {
      const clean = core().sanitizePlannerData(message.data);
      const { data: previous } = await read();
      // A different Spectrum account replaces the old planner instead of mixing two students' data.
      await chrome.storage.local.set({ [DATA]: clean });
      if (previous?.userHash && clean.userHash && previous.userHash !== clean.userHash) {
        const { prefs } = await read(); await chrome.storage.local.set({ [PREFS]: { ...prefs, occ: {} } });
      }
      await schedule();
      return { collectedAt: clean.collectedAt, items: clean.items.length };
    }
    if (message.type === 'PLANNER_SET_OCC' && kind === 'content') {
      const id = String(message.courseId || ''), value = String(message.occ ?? '').toUpperCase();
      if (!/^[1-9]\d{0,12}$/.test(id) || (value && !/^\d{1,2}[A-Z]?$/.test(value))) throw error('INVALID_MESSAGE', 'Invalid OCC.');
      const { data, prefs } = await read();
      const occ = { ...prefs.occ };
      if (message.resetAuto) delete occ[id];
      else if (value) occ[id] = value;
      else if (data?.detectedOcc?.[id]) occ[id] = '';
      else delete occ[id];
      await chrome.storage.local.set({ [PREFS]: { ...prefs, occ, ...(message.showAllOcc != null ? { showAllOcc: Boolean(message.showAllOcc) } : {}) } });
      return { ok: true };
    }
    if (message.type === 'PLANNER_DRIVE' && kind === 'page') {
      // Course-and-module pairs that the latest Drive passes stored, so Materials can show "In Drive".
      const { umspecState: state } = await chrome.storage.local.get('umspecState');
      const keys = new Set(), ok = new Set(['create', 'created', 'update', 'updated', 'skip', 'skipped', 'linked']);
      for (const job of [state?.activeJob, ...Object.values(state?.savedJobs?.drive || {})]) {
        if (!job?.materials) continue;
        const byKey = new Map(job.materials.map(m => [m.sourceKey, m]));
        for (const result of job.results || []) {
          const material = byKey.get(result.sourceKey);
          if (material && ok.has(result.action) && /^\d+$/.test(String(material.moduleId))) keys.add(material.courseId + ':' + material.moduleId);
        }
      }
      return { keys: [...keys] };
    }
    if (message.type === 'PLANNER_OPEN') { await openPlanner(); return { ok: true }; }
    if (message.type === 'PLANNER_RESCHEDULE') { await schedule(); return { ok: true }; }
    throw error('INVALID_MESSAGE', 'Unsupported planner command.');
  }
  function install() {
    if (!root.chrome?.runtime?.id) return;
    chrome.alarms?.onAlarm.addListener(alarm => { onAlarm(alarm).catch(() => {}); });
    chrome.notifications?.onClicked?.addListener(id => { onNotificationClick(id).catch(() => {}); });
    chrome.commands?.onCommand?.addListener(command => { if (command === 'open-planner') openPlanner(); });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && (changes[PREFS] || (changes[DATA] && !changes[DATA].newValue))) schedule().catch(() => {});
    });
    chrome.runtime.onInstalled?.addListener(() => { schedule().catch(() => {}); });
    chrome.runtime.onStartup?.addListener(() => { schedule().catch(() => {}); });
    chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false }).catch?.(() => {});
  }
  const api = { handle, schedule, refreshBadge, reminderText, defaults, install, KEYS: { DATA, PREFS, PLAN } };
  root.UmSpecPlannerWorker = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
