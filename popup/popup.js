document.addEventListener('DOMContentLoaded', async () => {
  'use strict';
  const el = id => document.getElementById(id);
  const controls = [...document.querySelectorAll('[data-control]')];
  let activeTab = null, isSpectrum = false, contextReady = false, status = null, busy = true;
  const showMessage = message => { el('sync-status').textContent = String(message || '').slice(0, 240); };
  const request = async message => {
    const result = await chrome.runtime.sendMessage({ ...message, tabId: activeTab?.id });
    if (!result?.ok) throw Object.assign(new Error(result?.error?.message || 'Refresh Spectrum and open UmSpec again.'), { code: result?.error?.code });
    return result.data;
  };
  async function refreshContext() {
    contextReady = false;
    let response;
    try { response = await chrome.tabs.sendMessage(activeTab.id, { type: 'UMSPEC_REFRESH_STATUS' }); }
    catch { throw new Error('Refresh Spectrum to load the updated UmSpec extension.'); }
    if (!response?.ok) throw Object.assign(new Error(response?.error?.message || 'Refresh Spectrum to confirm your account.'), { code: response?.error?.code });
    contextReady = true;
  }
  function selectTab(tab, focus = false) {
    const group = tab.getAttribute('data-tab-group');
    for (const other of document.querySelectorAll('[data-tab-group="' + group + '"]')) {
      const selected = other === tab;
      other.setAttribute('aria-selected', String(selected));
      other.tabIndex = selected ? 0 : -1;
      el(other.getAttribute('aria-controls')).hidden = !selected;
    }
    if (focus) tab.focus();
  }
  for (const tab of document.querySelectorAll('[role="tab"]')) {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', event => {
      const tabs = [...document.querySelectorAll('[data-tab-group="' + tab.getAttribute('data-tab-group') + '"]')];
      const index = tabs.indexOf(tab);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 :
        event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : null;
      if (next !== null) { event.preventDefault(); selectTab(tabs[next], true); }
    });
  }
  function render() {
    for (const control of controls) control.disabled = true;
    el('action-btn').disabled = !activeTab;
    el('action-label').textContent = isSpectrum ? 'Open courses' : 'Open Spectrum';
    if (busy) return;
    const settings = status?.settings || {}, features = status?.account?.features || [];
    const available = Boolean(isSpectrum && contextReady && status?.bindingHash);
    const drive = features.includes('drive'), calendar = features.includes('calendar');
    el('status-title').textContent = isSpectrum ? 'Spectrum is open' : 'Open Spectrum to begin';
    el('status-desc').textContent = isSpectrum ? available ? 'Choose courses and save the files you need.' : 'Open courses to sign in and choose your files.' : 'Your course files stay a click away.';
    el('status-indicator').classList.toggle('active', available);
    el('drive-settings').disabled = false;
    el('drive-settings').hidden = drive;
    el('google-setup').disabled = false;
    for (const input of document.querySelectorAll('[name="destination"]')) {
      input.checked = input.value === (settings.mode || 'zip');
      input.disabled = !available || (input.value === 'drive' && !drive);
    }
    el('destination-hint').textContent = settings.mode === 'drive' ? 'New and changed files go to your UM Spec folder.' : 'Download one ZIP. A Google account is optional.';
    el('archive-name').value = settings.archiveId || '';
    el('archive-name').disabled = !available;
    el('download-videos').checked = settings.videoPolicy === 'include';
    el('download-videos').disabled = !available;
    el('auto-sync').checked = Boolean(settings.autoSync);
    el('auto-sync').disabled = !available || !drive || !status?.syncTimes?.drive?.lastSuccessfulSyncAt;
    el('auto-sync-hint').textContent = el('auto-sync').disabled ? 'Available after your first successful Drive sync.' : 'Checks on page visits, at most once every 15 minutes.';
    el('calendar-enabled').checked = Boolean(settings.calendarEnabled);
    el('calendar-enabled').disabled = !available || !calendar;
    const reminders = (settings.reminderMinutes || []).join(',');
    const custom = !['1440,60', '1440', '60', ''].includes(reminders);
    el('custom-reminders').hidden = !custom;
    if (custom) { el('custom-reminders').value = reminders; el('custom-reminders').textContent = 'Custom: ' + reminders + ' minutes before'; }
    el('calendar-reminders').value = reminders;
    el('calendar-reminders').disabled = !available;
    el('announcement-scanning').checked = Boolean(settings.announcementScanning);
    el('announcement-scanning').disabled = !available;
    el('account-email').textContent = status?.account?.email || 'Not connected';
    el('connect-drive').textContent = drive ? 'Drive connected' : 'Connect Drive';
    el('connect-calendar').textContent = calendar ? 'Calendar connected' : 'Connect Google Calendar';
    el('connect-drive').disabled = !available || !status?.configured || drive;
    el('connect-calendar').disabled = !available || !status?.configured || calendar;
    el('disconnect-google').disabled = !available || !status?.account;
    const canSync = available && settings.courseIds?.length > 0 && ((settings.mode === 'drive' && drive) || (settings.calendarEnabled && calendar) || settings.announcementScanning);
    el('sync-now').hidden = !canSync;
    el('sync-now').disabled = !canSync;
    const reviews = status?.candidates?.length || 0;
    el('home-summary').textContent = reviews ? reviews + (reviews === 1 ? ' announcement date needs' : ' announcement dates need') + ' review in Open courses.' :
      settings.calendarEnabled ? 'Calendar is on. Review announcement dates in Open courses.' : 'Choose your courses before saving files.';
  }
  function normalMessage() {
    if (!isSpectrum) return 'Open Spectrum to use your saved preferences.';
    if (!status?.bindingHash) return 'Open courses to confirm your Spectrum account. ZIP remains available.';
    if (status.job?.error) return status.job.error.message;
    if (status.calendarJob?.error) return status.calendarJob.error.message;
    return status.configured ? 'Preferences save automatically.' : 'Google setup is required for Drive and Calendar. ZIP and local review are available.';
  }
  async function action(task) {
    if (busy) return;
    busy = true; render();
    let errorMessage = '';
    try { const data = await task(); if (data) status = data; }
    catch (error) {
      errorMessage = error.message;
      try { status = await request({ type: 'GET_STATUS' }); } catch { status = null; }
    } finally { busy = false; render(); showMessage(errorMessage || normalMessage()); }
  }
  async function save(settings) {
    const data = await request({ type: 'SAVE_SETTINGS', settings });
    if (isSpectrum) await refreshContext();
    return data;
  }
  for (const input of document.querySelectorAll('[name="destination"]')) input.addEventListener('change', () => action(() => save({ mode: input.value })));
  for (const [id, setting] of [['auto-sync', 'autoSync'], ['calendar-enabled', 'calendarEnabled'], ['announcement-scanning', 'announcementScanning']]) {
    el(id).addEventListener('change', () => action(() => save({ [setting]: el(id).checked })));
  }
  el('download-videos').addEventListener('change', () => action(() => save({ videoPolicy: el('download-videos').checked ? 'include' : 'links' })));
  el('archive-name').addEventListener('change', () => action(() => save({ archiveId: el('archive-name').value })));
  el('calendar-reminders').addEventListener('change', () => action(() => save({ reminderMinutes: el('calendar-reminders').value ? el('calendar-reminders').value.split(',').map(Number) : [] })));
  for (const feature of ['drive', 'calendar']) el('connect-' + feature).addEventListener('click', () => action(async () => {
    const allowed = await chrome.permissions.request({ origins: ['https://www.googleapis.com/*'] });
    if (!allowed) throw new Error('Google access was not granted. ZIP remains available.');
    const data = await request({ type: 'CONNECT_GOOGLE', feature });
    await refreshContext();
    return data;
  }));
  el('disconnect-google').addEventListener('click', () => action(async () => {
    const data = await request({ type: 'DISCONNECT_GOOGLE' });
    if (isSpectrum) await refreshContext();
    return data;
  }));
  el('drive-settings').addEventListener('click', () => { selectTab(el('tab-settings')); selectTab(el('tab-account'), true); });
  el('google-setup').addEventListener('click', () => action(async () => { await chrome.tabs.create({ url: chrome.runtime.getURL('setup/google.html') }); }));
  el('action-btn').addEventListener('click', async () => {
    if (!activeTab) return;
    el('action-btn').disabled = true;
    try {
      if (isSpectrum) await chrome.scripting.executeScript({ target: { tabId: activeTab.id }, func: () => {
        const trigger = document.getElementById('umspec-trigger-btn');
        if (!trigger) throw new Error('Refresh Spectrum to load UmSpec.');
        trigger.click();
      } });
      else await chrome.tabs.create({ url: 'https://spectrum.um.edu.my/my/' });
      window.close();
    } catch (error) { showMessage(error.message); }
    finally { render(); }
  });
  el('sync-now').addEventListener('click', () => action(async () => {
    await chrome.tabs.sendMessage(activeTab.id, { type: 'UMSPEC_SYNC_NOW' });
    window.close();
  }));
  render();
  try {
    [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    try { isSpectrum = new URL(activeTab?.url).origin === 'https://spectrum.um.edu.my'; } catch {}
    render();
    if (isSpectrum) await refreshContext();
    status = await request({ type: 'GET_STATUS' });
    showMessage(normalMessage());
  } catch (error) { showMessage(error.message); }
  finally { busy = false; render(); }
});
