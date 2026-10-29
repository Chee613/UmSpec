/**
 * UmSpec Options & Dashboard
 * Enterprise settings controller for Google Drive, Calendar, Edge AI, and Academic Profile
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
    });

    viewPanels.forEach(panel => {
      panel.hidden = panel !== targetPanel;
      panel.classList.toggle('active', panel === targetPanel);
    });

    window.location.hash = viewName;
  }

  $$('.sidebar-nav .nav-item').forEach(button => {
    button.addEventListener('click', () => switchView(button.dataset.view));
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
      const err = new Error(response?.error?.message || 'Extension communication failed.');
      err.code = response?.error?.code;
      throw err;
    }
    return response.data;
  }

  // --------------------------------------------------------------------------
  // SPeCTRUM Tab & Status Detection
  // --------------------------------------------------------------------------
  async function detectContext() {
    try {
      const tabs = await chrome.tabs.query({ url: '*://spectrum.um.edu.my/*' });
      if (tabs.length > 0) {
        activeTabId = tabs[0].id;
        isSpectrumActive = true;
      }
    } catch {
      // Tab query error fallback
    }

    try {
      currentStatus = await request({ type: 'GET_STATUS' });
    } catch {
      currentStatus = null;
    }

    renderStatus();
  }

  // --------------------------------------------------------------------------
  // UI Render Controller
  // --------------------------------------------------------------------------
  function renderStatus() {
    const status = currentStatus;
    const settings = status?.settings || {};
    const account = status?.account || null;
    const features = account?.features || [];
    const hasDrive = features.includes('drive');
    const hasCalendar = features.includes('calendar');
    const hasBinding = Boolean(status?.bindingHash);

    // Sidebar Indicators
    const dotSpectrum = $('dot-spectrum');
    const textSpectrum = $('text-spectrum');
    if (hasBinding || isSpectrumActive) {
      dotSpectrum.className = 'status-indicator-dot active';
      textSpectrum.textContent = 'SPeCTRUM: Active';
    } else {
      dotSpectrum.className = 'status-indicator-dot';
      textSpectrum.textContent = 'SPeCTRUM: Standby';
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

    // Overview Metrics
    $('ov-spectrum-val').textContent = hasBinding ? 'Authenticated' : (isSpectrumActive ? 'Open' : 'Standby');
    $('ov-spectrum-sub').textContent = hasBinding ? 'Active student session verified' : 'Open SPeCTRUM tab to link';

    $('ov-google-val').textContent = account?.email ? 'Connected' : 'Offline';
    $('ov-google-sub').textContent = account?.email ? account.email : 'Google Drive & Calendar optional';

    $('ov-export-val').textContent = settings.mode === 'drive' && hasDrive ? 'Google Drive' : 'ZIP Archive';
    $('ov-export-sub').textContent = settings.mode === 'drive' && hasDrive ? 'Private UM Spec folder' : 'Zero-touch instant export';

    // Google Drive View
    $('drive-email-display').textContent = account?.email || 'Not connected';
    $('btn-auth-drive').textContent = hasDrive ? 'Drive Connected ✓' : 'Connect Google Drive';
    $('btn-auth-drive').disabled = hasDrive;
    $('btn-disconnect-google').disabled = !account?.email;

    $('input-archive-name').value = settings.archiveId || '';
    $('toggle-auto-sync').checked = Boolean(settings.autoSync);
    $('toggle-auto-sync').disabled = !hasDrive || !status?.syncTimes?.drive?.lastSuccessfulSyncAt;
    $('toggle-video-download').checked = settings.videoPolicy === 'include';

    // Google Calendar View
    $('calendar-status-display').textContent = hasCalendar ? `Connected (${account?.email || ''})` : 'Not connected';
    $('btn-auth-calendar').textContent = hasCalendar ? 'Calendar Connected ✓' : 'Connect Google Calendar';
    $('btn-auth-calendar').disabled = hasCalendar;

    $('toggle-calendar-sync').checked = Boolean(settings.calendarEnabled);
    $('toggle-calendar-sync').disabled = !hasCalendar;
    $('toggle-announcements').checked = Boolean(settings.announcementScanning);

    const reminders = (settings.reminderMinutes || []).join(',');
    $('select-reminders').value = ['1440,60', '1440', '60', ''].includes(reminders) ? reminders : '1440,60';

    // Quick Action Buttons
    $('btn-quick-drive').textContent = hasDrive ? 'Drive Synced' : 'Connect Google Drive';
    $('btn-quick-drive').disabled = hasDrive;
    $('btn-quick-calendar').textContent = hasCalendar ? 'Calendar Synced' : 'Connect Google Calendar';
    $('btn-quick-calendar').disabled = hasCalendar;
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
      showToast(`Google ${feature === 'drive' ? 'Drive' : 'Calendar'} connected successfully!`, 'success');
    } catch (err) {
      showToast(err.message || `Failed to connect Google ${feature}.`, 'error');
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
    if (!currentStatus?.account?.features?.includes('drive')) connectGoogle('drive');
  });

  $('btn-auth-calendar')?.addEventListener('click', () => connectGoogle('calendar'));
  $('btn-quick-calendar')?.addEventListener('click', () => {
    switchView('calendar');
    if (!currentStatus?.account?.features?.includes('calendar')) connectGoogle('calendar');
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
  // Campus AI Proxy & Health Ping
  // --------------------------------------------------------------------------
  const DEFAULT_BACKEND_URL = 'https://umspec-ai.tankeat0613.workers.dev';

  async function loadBackendUrl() {
    const stored = await chrome.storage.local.get('umspecBackendUrl');
    const url = stored.umspecBackendUrl || DEFAULT_BACKEND_URL;
    $('input-backend-url').value = url;
  }

  async function pingHealth() {
    const rawUrl = $('input-backend-url').value.trim() || DEFAULT_BACKEND_URL;
    const healthUrl = rawUrl.replace(/\/+$/, '') + '/api/health';

    $('health-status-val').textContent = 'Pinging...';
    $('health-keys-val').textContent = '...';
    $('health-kv-val').textContent = '...';
    $('health-latency-val').textContent = '...';

    const startTime = performance.now();
    try {
      const res = await fetch(healthUrl, { method: 'GET', headers: { Accept: 'application/json' } });
      const latency = Math.round(performance.now() - startTime);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      $('health-status-val').textContent = `${res.status} OK (Healthy)`;
      $('health-keys-val').textContent = `${data.geminiKeyCount || 0} API Keys Active`;
      $('health-kv-val').textContent = data.cacheEnabled ? 'Active (Cloudflare KV)' : 'In-Memory Cache';
      $('health-latency-val').textContent = `${latency} ms`;

      showToast(`Edge AI Proxy responded in ${latency}ms`, 'success');
    } catch (err) {
      $('health-status-val').textContent = 'Offline / Error';
      $('health-latency-val').textContent = 'Timeout';
      showToast(`Health check failed: ${err.message}`, 'error');
    }
  }

  $('btn-test-health')?.addEventListener('click', pingHealth);
  $('btn-quick-test-ai')?.addEventListener('click', () => {
    switchView('ai');
    pingHealth();
  });

  $('btn-save-ai-settings')?.addEventListener('click', async () => {
    const url = $('input-backend-url').value.trim() || DEFAULT_BACKEND_URL;
    await chrome.storage.local.set({ umspecBackendUrl: url });
    showToast('Edge backend proxy URL saved.', 'success');
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
  // Navigation & SPeCTRUM Shortcuts
  // --------------------------------------------------------------------------
  $('btn-open-spectrum')?.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://spectrum.um.edu.my/my/' });
  });

  // Initialize
  await loadBackendUrl();
  await loadAcademicProfile();
  await detectContext();
});

