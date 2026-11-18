/**
 * UmSpec Student Settings & Dashboard
 * Clean, student-focused controller for Google Drive, Calendar, and SPeCTRUM synchronization
 */

document.addEventListener('DOMContentLoaded', async () => {
  'use strict';

  const $ = id => document.getElementById(id);
  const $$ = selector => [...document.querySelectorAll(selector)];

  let currentStatus = null;
  let activeTabId = null;
  let isSpectrumActive = false;

  // --------------------------------------------------------------------------
  // Toast Notifications
  // --------------------------------------------------------------------------
  let toastTimer = null;
  function showToast(message, type = 'info', duration = 3500) {
    const toast = $('status-toast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = `toast ${type}`;
    toast.hidden = false;

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.hidden = true;
    }, duration);
  }

  // --------------------------------------------------------------------------
  // Tab & View Switching (Supports Deep-Linking via URL Hash)
  // --------------------------------------------------------------------------
  function switchView(viewName) {
    const navItems = $$('.sidebar-nav .nav-item');
    const viewPanels = $$('.view-panel');

    let targetNav = navItems.find(b => b.dataset.view === viewName);
    let targetPanel = $(`view-${viewName}`);

    if (!targetNav || !targetPanel) {
      targetNav = navItems[0];
      targetPanel = $('view-overview');
      viewName = 'overview';
    }

    navItems.forEach(b => {
      const active = b === targetNav;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', String(active));
      b.tabIndex = active ? 0 : -1;
    });

    viewPanels.forEach(panel => {
      panel.hidden = panel !== targetPanel;
      panel.classList.toggle('active', panel === targetPanel);
    });

    window.location.hash = viewName;
  }

  $$('.sidebar-nav .nav-item').forEach(button => {
    button.addEventListener('click', () => switchView(button.dataset.view));
    button.addEventListener('keydown', event => {
      const buttons = $$('.sidebar-nav .nav-item');
      let next = buttons.indexOf(button);
      if (['ArrowRight', 'ArrowDown'].includes(event.key)) next = (next + 1) % buttons.length;
      else if (['ArrowLeft', 'ArrowUp'].includes(event.key)) next = (next + buttons.length - 1) % buttons.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = buttons.length - 1;
      else return;
      event.preventDefault();
      switchView(buttons[next].dataset.view);
      buttons[next].focus();
    });
  });

  // Handle Initial Hash
  const initialHash = window.location.hash.replace('#', '');
  if (initialHash) {
    switchView(initialHash);
  }

  // --------------------------------------------------------------------------
  // Extension Messaging Service
  // --------------------------------------------------------------------------
  async function request(message) {
    const response = await chrome.runtime.sendMessage({
      ...message,
      tabId: activeTabId
    });

    if (!response?.ok) {
      const err = new Error(response?.error?.message || 'Operation failed.');
      err.code = response?.error?.code;
      throw err;
    }
    return response.data;
  }

  // --------------------------------------------------------------------------
  // SPeCTRUM Tab & Status Detection
  // --------------------------------------------------------------------------
  async function detectContext() {
    activeTabId = null;
    isSpectrumActive = false;
    try {
      const tabs = await chrome.tabs.query({ url: '*://spectrum.um.edu.my/*' });
      if (tabs.length > 0) {
        activeTabId = tabs[0].id;
        isSpectrumActive = true;
      }
    } catch {
      // Tab query fallback
    }

    try {
      currentStatus = await request({ type: 'GET_STATUS' });
    } catch {
      currentStatus = null;
    }

    renderStatus();
  }

  // --------------------------------------------------------------------------
  // Student UI Render Controller
  // --------------------------------------------------------------------------
  function syncTime(value) {
    return Number.isFinite(value) && value > 0
      ? new Date(value).toLocaleString('en-MY', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : null;
  }

  function renderStatus() {
    const status = currentStatus;
    const settings = status?.settings || {};
    const account = status?.account || null;
    const features = account?.features || [];
    const hasDrive = features.includes('drive');
    const hasCalendar = features.includes('calendar');

    // Sidebar Indicator Pills
    const dotSpectrum = $('dot-spectrum');
    const textSpectrum = $('text-spectrum');
    if (isSpectrumActive) {
      dotSpectrum.className = 'status-indicator-dot active';
      textSpectrum.textContent = 'Spectrum tab open';
    } else {
      dotSpectrum.className = 'status-indicator-dot';
      textSpectrum.textContent = 'Spectrum tab not open';
    }

    const dotGoogle = $('dot-google');
    const textGoogle = $('text-google');
    if (account?.email) {
      dotGoogle.className = 'status-indicator-dot active';
      textGoogle.textContent = `Google: ${account.email}`;
    } else {
      dotGoogle.className = 'status-indicator-dot';
      textGoogle.textContent = 'Google: Not connected';
    }

    // A connected service is not evidence of a completed sync.
    $('ov-status-note').hidden = Boolean(status);
    $('ov-spectrum-val').textContent = isSpectrumActive ? 'Spectrum tab open' : 'Open Spectrum to begin';
    $('ov-spectrum-val').classList.toggle('is-connected', isSpectrumActive);
    $('ov-spectrum-sub').textContent = isSpectrumActive
      ? 'Choose courses, review their files and start an export in your Spectrum tab.'
      : 'Open Spectrum to choose your courses and save the files you need.';
    $('ov-courses-val').textContent = !status ? 'Unavailable' : settings.courseIds?.length
      ? `${settings.courseIds.length} selected` : 'None selected yet';
    $('ov-archive').textContent = settings.archiveId || 'Course files';
    $('ov-export-val').textContent = !status ? 'Unavailable' : settings.mode === 'drive' ? 'Google Drive' : 'ZIP download';
    $('ov-export-sub').textContent = settings.mode === 'drive'
      ? hasDrive ? 'Your selected files go to a private UmSpec folder.' : 'Connect Drive in settings, or use a ZIP download.'
      : 'ZIP downloads work without a Google account.';
    $('btn-quick-spectrum').firstChild.textContent = isSpectrumActive ? 'Open course workspace ' : 'Open Spectrum ';

    for (const [feature, connected] of [['drive', hasDrive], ['calendar', hasCalendar]]) {
      $(`ov-${feature}-val`).textContent = !status ? 'Unavailable' : connected ? 'Connected' : 'Not connected';
      $(`ov-${feature}-val`).classList.toggle('is-connected', connected);
      $(`ov-${feature}-sub`).textContent = connected ? account.email || 'Google permissions granted.'
        : feature === 'drive' ? 'Keep selected course files in your Google Drive.' : 'Add confirmed course dates to your calendar.';
      const lastSync = syncTime(status?.syncTimes?.[feature]?.lastSuccessfulSyncAt);
      $(`ov-${feature}-sync`).textContent = lastSync ? `Last successful sync · ${lastSync}` : 'No successful sync recorded.';
      $(`btn-quick-${feature}`).firstChild.textContent = `${connected ? 'Manage' : 'Set up'} ${feature === 'drive' ? 'Drive' : 'Calendar'} `;
      $(`btn-quick-${feature}`).disabled = false;
    }
    $('ov-video-policy').textContent = !status ? 'Unavailable' : settings.videoPolicy === 'include' ? 'Download files' : 'Save links only';
    $('ov-auto-sync').textContent = !status ? 'Unavailable' : settings.autoSync ? 'Automatic' : 'Manual';
    $('ov-calendar-enabled').textContent = !status ? 'Unavailable' : settings.calendarEnabled ? 'On' : 'Off';
    const job = status?.job;
    const summary = job?.summary || {};
    $('ov-job-summary').textContent = !status ? 'Sync status is unavailable.' : !job
      ? syncTime(status.syncTimes?.drive?.lastSuccessfulSyncAt) ? 'No sync summary available.' : 'No Drive sync recorded.'
      : job.status === 'running' ? `Drive sync in progress · ${job.cursor || 0} of ${job.total || 0} files processed.`
      : job.status === 'paused' ? 'Drive sync paused. Open the course workspace to review or resume it.'
      : `Last Drive job · ${summary.created || 0} new, ${summary.updated || 0} updated, ${summary.skipped || 0} unchanged, ${summary.linked || 0} links saved, ${summary.failed || 0} failed, ${summary.conflicts || 0} need review.`;

    const recent = $('recent-changes');
    recent.replaceChildren();
    const changes = status?.recentChanges || [];
    if (!changes.length) {
      const empty = document.createElement('li');
      empty.className = 'activity-empty';
      empty.textContent = status ? 'Your file and date updates will appear here after a sync.' : 'Refresh status to load your recent activity.';
      recent.append(empty);
    }
    for (const change of changes.slice(0, 4)) {
      const row = document.createElement('li');
      row.className = 'activity-row';
      const description = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = change.title || change.name || 'Course item';
      const action = document.createElement('p');
      const labels = { create: 'Added', created: 'Added', update: 'Updated', updated: 'Updated', linked: 'Link saved', failed: 'Failed', conflict: 'Needs review', review: 'Needs review', restore: 'Needs review', trashed: 'Needs review' };
      action.textContent = labels[change.action || change.status] || 'Updated';
      description.append(title, action);
      const time = document.createElement('time');
      time.textContent = syncTime(change.at) || '';
      if (syncTime(change.at)) time.dateTime = new Date(change.at).toISOString();
      row.append(description, time);
      recent.append(row);
    }

    // Google Drive View
    $('drive-email-display').textContent = account?.email || 'Not connected';
    $('btn-auth-drive').textContent = hasDrive ? 'Drive connected' : 'Connect Google Drive';
    $('btn-auth-drive').disabled = hasDrive;
    $('btn-disconnect-google').disabled = !account?.email;

    $('input-archive-name').value = settings.archiveId || '';
    $('toggle-auto-sync').checked = Boolean(settings.autoSync);
    $('toggle-auto-sync').disabled = !hasDrive || !status?.syncTimes?.drive?.lastSuccessfulSyncAt;
    $('toggle-video-download').checked = settings.videoPolicy === 'include';

    // Google Calendar View
    $('calendar-status-display').textContent = hasCalendar ? `Connected (${account?.email || ''})` : 'Not connected';
    $('btn-auth-calendar').textContent = hasCalendar ? 'Calendar connected' : 'Connect Google Calendar';
    $('btn-auth-calendar').disabled = hasCalendar;

    $('toggle-calendar-sync').checked = Boolean(settings.calendarEnabled);
    $('toggle-calendar-sync').disabled = !hasCalendar;
    $('toggle-announcements').checked = Boolean(settings.announcementScanning);

    const reminders = (settings.reminderMinutes || []).join(',');
    $('select-reminders').value = ['1440,60', '1440', '60', ''].includes(reminders) ? reminders : '1440,60';

    for (const id of ['input-archive-name', 'toggle-video-download', 'toggle-announcements', 'select-reminders', 'btn-save-drive-settings', 'btn-save-calendar-settings']) $(id).disabled = !status;
  }

  // --------------------------------------------------------------------------
  // Google Auth Actions
  // --------------------------------------------------------------------------
  async function connectGoogle(feature) {
    try {
      showToast(`Requesting Google permissions for ${feature}...`, 'info');
      const allowed = await chrome.permissions.request({ origins: ['https://www.googleapis.com/*'] });
      if (!allowed) {
        showToast('Google access was not granted by user.', 'error');
        return;
      }

      const updated = await request({ type: 'CONNECT_GOOGLE', feature });
      currentStatus = updated;
      renderStatus();
      showToast(`Google ${feature === 'drive' ? 'Drive' : 'Calendar'} connected.`, 'success');
    } catch (err) {
      if (err.message && err.message.includes('access_denied')) {
        showToast('Google blocked access (Error 403). Open the Google setup guide in the Drive tab to add your email as a test user.', 'error', 6000);
      } else {
        showToast(err.message || `Failed to connect Google ${feature}.`, 'error');
      }
    }
  }

  async function disconnectGoogle() {
    try {
      showToast('Disconnecting Google account...', 'info');
      const updated = await request({ type: 'DISCONNECT_GOOGLE' });
      currentStatus = updated;
      renderStatus();
      showToast('Google account disconnected.', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to disconnect Google account.', 'error');
    }
  }

  $('btn-auth-drive')?.addEventListener('click', () => connectGoogle('drive'));
  $('btn-quick-drive')?.addEventListener('click', () => {
    switchView('drive');
  });

  $('btn-auth-calendar')?.addEventListener('click', () => connectGoogle('calendar'));
  $('btn-quick-calendar')?.addEventListener('click', () => {
    switchView('calendar');
  });

  $('btn-disconnect-google')?.addEventListener('click', disconnectGoogle);

  // --------------------------------------------------------------------------
  // Settings Persistence
  // --------------------------------------------------------------------------
  $('btn-save-drive-settings')?.addEventListener('click', async () => {
    try {
      const archiveId = $('input-archive-name').value.trim();
      const autoSync = $('toggle-auto-sync').checked;
      const videoPolicy = $('toggle-video-download').checked ? 'include' : 'links';

      const updated = await request({
        type: 'SAVE_SETTINGS',
        settings: { archiveId, autoSync, videoPolicy }
      });
      currentStatus = updated;
      renderStatus();
      showToast('Drive preferences saved.', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to save Drive preferences.', 'error');
    }
  });

  $('btn-save-calendar-settings')?.addEventListener('click', async () => {
    try {
      const calendarEnabled = $('toggle-calendar-sync').checked;
      const announcementScanning = $('toggle-announcements').checked;
      const reminderVal = $('select-reminders').value;
      const reminderMinutes = reminderVal ? reminderVal.split(',').map(Number) : [];

      const updated = await request({
        type: 'SAVE_SETTINGS',
        settings: { calendarEnabled, announcementScanning, reminderMinutes }
      });
      currentStatus = updated;
      renderStatus();
      showToast('Calendar preferences saved.', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to save Calendar preferences.', 'error');
    }
  });

  // --------------------------------------------------------------------------
  // Academic Profile
  // --------------------------------------------------------------------------
  async function loadAcademicProfile() {
    const stored = await chrome.storage.local.get('umspec_saved_degree');
    if (stored.umspec_saved_degree) {
      $('input-profile-degree').value = stored.umspec_saved_degree;
    } else {
      const local = localStorage.getItem('umspec_saved_degree');
      if (local) $('input-profile-degree').value = local;
    }
  }

  $('btn-save-profile')?.addEventListener('click', async () => {
    const val = $('input-profile-degree').value.trim();
    await chrome.storage.local.set({ umspec_saved_degree: val });
    localStorage.setItem('umspec_saved_degree', val);
    showToast('Academic profile updated.', 'success');
  });

  // --------------------------------------------------------------------------
  // SPeCTRUM Navigation Shortcuts
  // --------------------------------------------------------------------------
  const openSpectrumTab = () => chrome.tabs.create({ url: 'https://spectrum.um.edu.my/my/' });
  $('btn-open-spectrum')?.addEventListener('click', openSpectrumTab);
  $('btn-quick-spectrum')?.addEventListener('click', async () => {
    const button = $('btn-quick-spectrum');
    button.disabled = true;
    try {
      if (!activeTabId) await openSpectrumTab();
      else {
        await chrome.tabs.update(activeTabId, { active: true });
        await chrome.scripting.executeScript({ target: { tabId: activeTabId }, func: () => {
          const trigger = document.getElementById('umspec-trigger-btn');
          if (!trigger) throw new Error('Refresh Spectrum to load UmSpec.');
          trigger.click();
        } });
      }
    } catch (error) { showToast(error.message || 'Could not open your Spectrum workspace.', 'error'); }
    finally { button.disabled = false; }
  });
  $('btn-refresh-status')?.addEventListener('click', async () => {
    const button = $('btn-refresh-status');
    button.disabled = true;
    try { await detectContext(); }
    finally { button.disabled = false; }
  });

  // Initialize
  await loadAcademicProfile();
  await detectContext();
});
