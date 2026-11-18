/* Popup shortcut to the planner, with a count of deadlines due in the next two days. */
document.addEventListener('DOMContentLoaded', async () => {
  'use strict';
  const C = globalThis.UmSpecPlannerCore;
  const page = chrome.runtime.getURL('dashboard/dashboard.html');
  document.getElementById('open-planner')?.addEventListener('click', () => { chrome.tabs.create({ url: page }); window.close(); });
  const side = document.getElementById('open-planner-side');
  if (!chrome.sidePanel?.open) side?.setAttribute('hidden', '');
  side?.addEventListener('click', async () => {
    try { const win = await chrome.windows.getCurrent(); await chrome.sidePanel.open({ windowId: win.id }); window.close(); }
    catch { chrome.tabs.create({ url: page }); }
  });
  try {
    const { umspecPlanner: data, umspecPlannerPrefs: prefs = {} } = await chrome.storage.local.get(['umspecPlanner', 'umspecPlannerPrefs']);
    const summary = document.getElementById('planner-summary');
    if (!data || !summary || !C) return;
    const due = C.dueSoonCount(data, prefs), now = Date.now();
    const open = C.visibleItems(data, prefs).filter(item => item.kind === 'attendance' && C.itemState(item, now) === 'open').length;
    summary.textContent = (due ? due + ' deadline' + (due === 1 ? '' : 's') + ' due or overdue' : 'No deadlines in the next 2 days') + (open ? ' · ' + open + ' check-in open' : '') + '.';
  } catch {}
});
