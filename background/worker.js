/* Google credentials and durable state stay in this trusted extension context. */
if (typeof importScripts === 'function') {
  importScripts('../shared/sync-core.js', '../shared/calendar-core.js', '../shared/announcement-core.js',
    'google.js', 'drive.js', 'calendar.js');
}
(function (root) {
  'use strict';
  const dep = (name, file) => root[name] || (typeof require === 'function' ? require(file) : null);
  const core = () => dep('UmSpecSync', '../shared/sync-core.js');
  const google = () => dep('UmSpecGoogle', './google.js');
  const calendar = () => dep('UmSpecCalendarCore', '../shared/calendar-core.js');
  const announcements = () => dep('UmSpecAnnouncements', '../shared/announcement-core.js');
  const error = (code, message) => Object.assign(new Error(message), { code });
  const defaults = () => ({
    mode: 'zip', autoSync: false, calendarEnabled: false, announcementScanning: false,
    archiveId: '', courseIds: [], videoPolicy: 'links', reminderMinutes: [1440, 60]
  });
  const freshState = () => ({
    schemaVersion: 1, bindings: {}, contexts: {}, google: null, activeJob: null,
    calendarJob: null, savedJobs: { drive: {}, calendar: {} }, recentChanges: []
  });
  let serial = Promise.resolve();
  async function readState() {
    const saved = (await chrome.storage.local.get('umspecState')).umspecState;
    if (saved && saved.schemaVersion !== 1) throw error('STATE_VERSION', 'A newer extension is needed for saved sync data.');
    const state = saved || freshState();
    state.savedJobs ||= { drive: {}, calendar: {} };
    state.savedJobs.drive ||= {};
    state.savedJobs.calendar ||= {};
    return state;
  }
  async function save(state) { await chrome.storage.local.set({ umspecState: state }); }
  function senderKind(sender) {
    if (sender?.id !== chrome.runtime.id) throw error('FORBIDDEN', 'Unknown extension sender.');
    if (typeof sender.url === 'string') {
      if (sender.url.startsWith(chrome.runtime.getURL('popup/popup.html')) ||
          sender.url.startsWith(chrome.runtime.getURL('options/options.html'))) return 'popup';
      try {
        if (new URL(sender.url).origin === 'https://spectrum.um.edu.my' && Number.isInteger(sender.tab?.id)) return 'content';
      } catch {}
    }
    throw error('FORBIDDEN', 'Open the extension on Spectrum.');
  }
  function bindingFor(state, sender, message) {
    const tabId = sender.tab?.id ?? message.tabId ?? state.lastTabId;
    let context = state.contexts[String(tabId)];
    let binding = context && state.bindings[context.bindingHash];
    if (!binding) {
      if (message.bindingHash && state.bindings[message.bindingHash]) {
        binding = state.bindings[message.bindingHash];
      } else {
        const all = Object.values(state.bindings || {});
        if (all.length > 0) {
          binding = all.find(b => b.googleSub && b.googleSub === state.google?.sub) ||
            all.find(b => b.hash === state.contexts[String(state.lastTabId)]?.bindingHash) || all[0];
        }
      }
    }
    if (!binding) {
      const defaultHash = 'default_student_binding';
      if (!state.bindings[defaultHash]) {
        state.bindings[defaultHash] = {
          hash: defaultHash, spectrumOrigin: 'https://spectrum.um.edu.my', spectrumUserId: 'local_student',
          googleSub: null, googleEmail: null, features: [], settings: defaults(), syncTimes: {},
          candidates: {}, events: {}, driveRootId: null, calendarId: null
        };
      }
      binding = state.bindings[defaultHash];
    }
    if (!context && tabId != null) {
      context = state.contexts[String(tabId)] = { bindingHash: binding.hash, userId: binding.spectrumUserId };
    }
    return { binding, context, tabId };
  }
  function publicStatus(state, sender, message) {
    let binding = null, tabId = sender.tab?.id ?? message.tabId ?? state.lastTabId ?? null;
    try { ({ binding, tabId } = bindingFor(state, sender, message)); } catch {}
    const job = state.activeJob?.bindingHash === binding?.hash ? state.activeJob : state.savedJobs.drive[binding?.hash] || null;
    const calendarJob = state.calendarJob?.bindingHash === binding?.hash ? state.calendarJob : state.savedJobs.calendar[binding?.hash] || null;
    return {
      configured: google().configured(), account: binding?.googleSub === state.google?.sub && binding?.features?.length
        ? { email: binding.googleEmail, features: binding.features || [] } : null,
      settings: binding?.settings || defaults(), bindingHash: binding?.hash || null, tabId,
      announcementCursor: binding?.announcementCursor || null,
      syncTimes: binding?.syncTimes || {}, driveRootId: binding?.driveRootId || null,
      calendarId: binding?.calendarId || null,
      job: job ? { id: job.id, tabId: job.tabId, done: Boolean(job.done), status: job.status, cursor: job.cursor || 0,
        total: job.materials.length, scopeChanged: !scopeMatches(job, binding, 'drive'),
        summary: core().summariseResults(job.results || []), error: job.error || null } : null,
      calendarJob: calendarJob ? { ...calendarJob, scopeChanged: !scopeMatches(calendarJob, binding, 'calendar'), records: undefined } : null,
      candidates: Object.values(binding?.candidates || {}).filter(c => ['pending', 'stale'].includes(c.state)),
      events: Object.values(binding?.events || {}),
      recentChanges: state.recentChanges.filter(c => c.bindingHash === binding?.hash)
    };
  }
  function validSettings(patch, current) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw error('INVALID_SETTINGS', 'Invalid settings.');
    const result = { ...current };
    for (const [key, value] of Object.entries(patch)) {
      if (['autoSync', 'calendarEnabled', 'announcementScanning'].includes(key) && typeof value === 'boolean') result[key] = value;
      else if (key === 'mode' && ['zip', 'drive'].includes(value)) result.mode = value;
      else if (key === 'videoPolicy' && ['links', 'include'].includes(value)) result.videoPolicy = value;
      else if (key === 'archiveId' && typeof value === 'string' && value.length <= 80 && !/[\x00-\x1f/\\]/.test(value)) result.archiveId = value.trim();
      else if (key === 'courseIds' && Array.isArray(value) && value.length <= 500 && value.every(id => /^[1-9]\d*$/.test(String(id)))) result.courseIds = [...new Set(value.map(String))];
      else if (key === 'reminderMinutes' && Array.isArray(value) && value.length <= 5 && new Set(value).size === value.length &&
        value.every(n => Number.isInteger(n) && n >= 0 && n <= 40320)) result.reminderMinutes = [...value].sort((a, b) => b - a);
      else throw error('INVALID_SETTINGS', 'Unsupported or invalid setting: ' + key);
    }
    return result;
  }
  async function liveContext(state, tabId, binding) {
    const current = await chrome.tabs.sendMessage(tabId, { type: 'UMSPEC_CONTEXT' });
    if (String(current?.userId) !== binding.spectrumUserId || current?.origin !== 'https://spectrum.um.edu.my') {
      throw error('LOGIN_REQUIRED', 'Spectrum session changed. Reopen Spectrum and retry.');
    }
  }
  async function authorise(state, tabId, binding, feature) {
    await liveContext(state, tabId, binding);
    if (!binding.googleSub || !binding.features?.includes(feature)) throw error('CONNECT_REQUIRED', 'Connect Google ' + feature + ' first.');
    await google().verifyAccount(binding.googleSub, feature);
  }
  async function joinJob(state, job, tabId, binding) {
    if (job.tabId !== tabId && job.status !== 'paused' && Number.isInteger(job.tabId)) {
      try { await liveContext(state, job.tabId, binding); return; } catch {}
    }
    job.tabId = tabId;
    job.status = 'running';
    job.error = null;
  }
  const jobField = feature => feature === 'drive' ? 'activeJob' : 'calendarJob';
  function scopeKey(settings, feature) {
    const courses = [...settings.courseIds].sort();
    return JSON.stringify(feature === 'drive' ? [settings.archiveId, courses, settings.videoPolicy] : [courses]);
  }
  function scopeMatches(job, binding, feature) {
    const key = job.scopeKey ?? (feature === 'drive' && job.binding?.settings ? scopeKey(job.binding.settings, feature) : null);
    return key === scopeKey(binding.settings, feature);
  }
  function pauseForScope(job, binding, feature) {
    if (!job || job.done) return;
    job.scopeChanged = !scopeMatches(job, binding, feature);
    if (job.scopeChanged) {
      job.status = 'paused';
      job.error = { code: 'SCOPE_CHANGED', message: 'Selected courses or archive settings changed. Choose Sync now to scan the new selection.' };
    }
  }
  function parkJob(state, feature) {
    const field = jobField(feature), job = state[field];
    if (job && !job.done) {
      job.status = 'paused';
      state.savedJobs[feature][job.bindingHash] = job;
    }
    state[field] = null;
  }
  function selectJob(state, feature, binding) {
    const field = jobField(feature), current = state[field];
    if (current && current.bindingHash !== binding.hash) {
      if (!current.done && current.status !== 'paused') throw error('BUSY', 'Pause the other account job first.');
      parkJob(state, feature);
    }
    if (!state[field] && state.savedJobs[feature][binding.hash]) {
      state[field] = state.savedJobs[feature][binding.hash];
      delete state.savedJobs[feature][binding.hash];
    }
    return state[field];
  }
  function disconnectDriveJob(job) {
    if (!job || job.done) return;
    job.status = 'paused';
    if (job.upload) {
      delete job.upload.url;
      if (job.upload.fileId && ['probe', 'chunk', 'start'].includes(job.upload.phase)) job.upload.phase = 'verify';
    }
  }
  function addChanges(state, binding, changes) {
    const now = Date.now();
    for (const change of changes) {
      if (['skip', 'skipped'].includes(change.action || change.status)) continue;
      state.recentChanges.unshift({ bindingHash: binding.hash, at: now, ...change });
    }
    state.recentChanges = state.recentChanges.filter(c => now - c.at < 30 * 86400000).slice(0, 100);
  }
  async function validateMaterials(materials, binding) {
    if (!Array.isArray(materials) || materials.length > 5000) throw error('CAPACITY', 'Select fewer materials for this sync.');
    const seen = new Set();
    return Promise.all(materials.map(async item => {
      if (!binding.settings.courseIds.includes(String(item.courseId)) || !/^[a-f0-9]{64}$/.test(item.sourceKey || '') ||
          seen.has(item.sourceKey)) throw error('INVALID_SOURCE', 'Invalid or duplicate material identity.');
      seen.add(item.sourceKey);
      const url = new URL(item.sourceUrl);
      if (item.kind === 'binary' && (url.origin !== 'https://spectrum.um.edu.my' || !url.pathname.includes('/pluginfile.php/'))) throw error('INVALID_SOURCE', 'Only resolved Spectrum files may be downloaded.');
      if (url.protocol !== 'https:' || url.username || url.password || url.searchParams.has('sesskey')) throw error('INVALID_SOURCE', 'Unsafe material URL.');
      if (!['binary', 'link'].includes(item.kind)) throw error('INVALID_SOURCE', 'Unknown material type.');
      const name = String(item.name || 'Material').replace(/[\x00-\x1f/\\]/g, '_').slice(0, 240);
      const category = String(item.category || '9.Reference').replace(/[\x00-\x1f/\\]/g, '_').slice(0, 100);
      const courseName = String(item.courseName || item.courseId).replace(/[\x00-\x1f/\\]/g, '_').slice(0, 240);
      const courseFolder = String(item.courseFolder || courseName).replace(/[\x00-\x1f/\\]/g, '_').slice(0, 240);
      const revision = item.kind === 'binary' ? core().canonicalSource(url.href).revision : null;
      const sourceFingerprint = revision ? await core().hashParts(['resource-revision', revision]) : null;
      const mimeType = String(item.mimeType || item.contentType || '').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 100);
      return { sourceKey: item.sourceKey, sourceUrl: url.href, courseId: String(item.courseId),
        moduleId: String(item.moduleId || ''), name, category, courseName, courseFolder, archiveId: binding.settings.archiveId,
        kind: item.kind, sourceFingerprint, contentSha256: null, mimeType,
        isVideo: core().isVideoMaterial({ ...item, name, category, mimeType }),
        sizeBytes: Number.isSafeInteger(item.sizeBytes) ? item.sizeBytes : null };
    }));
  }
  async function dispatch(message, sender) {
    const kind = senderKind(sender);
    if (!message || typeof message.type !== 'string') throw error('INVALID_MESSAGE', 'Invalid command.');
    const popupOnly = ['CONNECT_GOOGLE', 'DISCONNECT_GOOGLE'];
    if (popupOnly.includes(message.type) && kind !== 'popup') throw error('FORBIDDEN', 'Connect Google from the extension popup.');
    if (message.type === 'OPEN_OPTIONS') {
      if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
      else chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
      return { ok: true };
    }
    const state = await readState();
    if (message.type === 'GET_STATUS' || message.type === 'GET_REVIEW_QUEUE') return publicStatus(state, sender, message);
    if (message.type === 'SET_CONTEXT') {
      if (kind !== 'content' || !/^[1-9]\d*$/.test(String(message.userId))) throw error('FORBIDDEN', 'An authenticated Spectrum user is required.');
      const tabId = sender.tab.id;
      const old = state.contexts[String(tabId)];
      const existing = Object.values(state.bindings).find(b => b.spectrumUserId === String(message.userId) &&
        b.googleSub === state.google?.sub);
      const hash = existing?.hash || await core().hashParts(['https://spectrum.um.edu.my', String(message.userId)]);
      if (!state.bindings[hash]) {
        const fallback = state.bindings['default_student_binding'];
        state.bindings[hash] = {
          hash, spectrumOrigin: 'https://spectrum.um.edu.my', spectrumUserId: String(message.userId),
          googleSub: state.google?.sub || fallback?.googleSub || null,
          googleEmail: state.google?.email || fallback?.googleEmail || null,
          features: fallback?.features || (state.google ? ['drive'] : []),
          settings: fallback?.settings ? { ...fallback.settings } : defaults(),
          syncTimes: {}, candidates: {}, events: {}, driveRootId: null, calendarId: null
        };
      }
      if (old && old.bindingHash !== hash && state.activeJob?.tabId === tabId) state.activeJob.status = 'paused';
      if (old && old.bindingHash !== hash && state.calendarJob?.tabId === tabId) state.calendarJob.status = 'paused';
      state.contexts[String(tabId)] = { bindingHash: hash, userId: String(message.userId) };
      state.lastTabId = tabId;
      await save(state);
      return publicStatus(state, sender, message);
    }
    const { binding, context, tabId } = bindingFor(state, sender, message);
    if (message.bindingHash && message.bindingHash !== binding.hash) throw error('ACCOUNT_CHANGED', 'The active account changed.');
    if (message.type === 'SAVE_SETTINGS') {
      const settings = validSettings(message.settings, binding.settings);
      const uploading = [state.activeJob, state.savedJobs.drive[binding.hash]].some(job => job?.bindingHash === binding.hash && !job.done && job.upload != null);
      if (uploading && scopeKey(settings, 'drive') !== scopeKey(binding.settings, 'drive')) throw error('UPLOAD_IN_PROGRESS', 'Finish or resume the current file before changing semester, courses or video choices.');
      binding.settings = settings;
      for (const feature of ['drive', 'calendar']) {
        const current = state[jobField(feature)];
        if (current?.bindingHash === binding.hash) pauseForScope(current, binding, feature);
        pauseForScope(state.savedJobs[feature][binding.hash], binding, feature);
      }
      if (state.calendarJob?.bindingHash === binding.hash && !state.calendarJob.done && !binding.settings.calendarEnabled) state.calendarJob.status = 'paused';
      if (state.activeJob?.bindingHash === binding.hash && !state.activeJob.done && binding.settings.mode !== 'drive') state.activeJob.status = 'paused';
      await save(state);
      return publicStatus(state, sender, message);
    }
    if (message.type === 'CONNECT_GOOGLE') {
      const account = await google().connectGoogle(message.feature, true);
      const hash = await core().hashParts([binding.spectrumOrigin, binding.spectrumUserId, account.sub]);
      const local = !binding.googleSub;
      const connected = state.bindings[hash] || {
        hash, spectrumOrigin: binding.spectrumOrigin, spectrumUserId: binding.spectrumUserId,
        googleSub: account.sub, googleEmail: account.email, features: [],
        settings: { ...defaults(), courseIds: [...binding.settings.courseIds], archiveId: binding.settings.archiveId,
          videoPolicy: binding.settings.videoPolicy, reminderMinutes: [...binding.settings.reminderMinutes] },
        syncTimes: {}, candidates: local ? structuredClone(binding.candidates || {}) : {},
        events: local ? structuredClone(binding.events || {}) : {}, calendarEvents: {}, driveRootId: null, calendarId: null
      };
      connected.features = [...new Set([...(connected.features || []), message.feature])];
      connected.settings[message.feature === 'drive' ? 'mode' : 'calendarEnabled'] = message.feature === 'drive' ? 'drive' : true;
      state.bindings[hash] = connected;
      if (binding.hash === 'default_student_binding') delete state.bindings['default_student_binding'];
      state.google = account;
      if (context) {
        context.bindingHash = hash;
      } else if (tabId != null) {
        state.contexts[String(tabId)] = { bindingHash: hash, userId: binding.spectrumUserId };
      }
      if (state.activeJob) state.activeJob.status = 'paused';
      for (const feature of ['drive', 'calendar']) if (state[jobField(feature)]?.bindingHash !== hash) parkJob(state, feature);
      await save(state);
      return publicStatus(state, sender, message);
    }
    if (message.type === 'DISCONNECT_GOOGLE') {
      await google().disconnectGoogle();
      state.google = null;
      for (const b of Object.values(state.bindings)) {
        b.features = [];
        b.settings.autoSync = false;
        b.settings.calendarEnabled = false;
      }
      disconnectDriveJob(state.activeJob);
      if (state.calendarJob && !state.calendarJob.done) state.calendarJob.status = 'paused';
      for (const feature of ['drive', 'calendar']) for (const job of Object.values(state.savedJobs[feature])) {
        if (feature === 'drive') disconnectDriveJob(job);
        else job.status = 'paused';
      }
      await save(state);
      return publicStatus(state, sender, message);
    }
    if (message.type === 'PAUSE_SYNC') {
      if (state.activeJob?.bindingHash === binding.hash) state.activeJob.status = 'paused';
      if (state.calendarJob?.bindingHash === binding.hash) state.calendarJob.status = 'paused';
      await save(state);
      return publicStatus(state, sender, message);
    }
    if (message.type === 'BEGIN_DRIVE_SYNC') {
      if (binding.settings.mode !== 'drive') throw error('DISABLED', 'Choose Drive before syncing materials.');
      const materials = await validateMaterials(message.materials, binding);
      if (!binding.settings.archiveId) throw error('ARCHIVE_REQUIRED', 'Name your semester archive before syncing.');
      await authorise(state, tabId, binding, 'drive');
      const existing = selectJob(state, 'drive', binding);
      const changed = existing && !scopeMatches(existing, binding, 'drive');
      if (existing && !existing.done && changed && existing.upload != null) throw error('UPLOAD_IN_PROGRESS', 'Finish or resume the current file before changing semester, courses or video choices.');
      if (existing && !existing.done && changed && !(message.freshInventory === true && message.retry === true)) throw error('SCOPE_CHANGED', 'Choose Sync now to scan the new course/archive selection.');
      if (existing && !existing.done && !changed) {
        await joinJob(state, existing, tabId, binding);
      } else {
        state.activeJob = { id: crypto.randomUUID(), bindingHash: binding.hash, binding: structuredClone(binding), scopeKey: scopeKey(binding.settings, 'drive'), scopeChanged: false,
          tabId, materials, cursor: 0, results: [], status: 'running', done: false };
        binding.syncTimes.drive = { ...binding.syncTimes.drive, lastAttemptAt: Date.now() };
      }
      await save(state);
      return publicStatus(state, sender, message);
    }
    if (message.type === 'DRIVE_STEP') {
      const job = state.activeJob;
      if (!job || job.bindingHash !== binding.hash || job.id !== message.jobId) throw error('JOB_CHANGED', 'No matching sync job.');
      if (binding.settings.mode !== 'drive') {
        job.status = 'paused';
        await save(state);
        return publicStatus(state, sender, message);
      }
      if (job.status !== 'running' || job.done) return publicStatus(state, sender, message);
      if (job.tabId !== tabId) return publicStatus(state, sender, message);
      if (!scopeMatches(job, binding, 'drive')) {
        pauseForScope(job, binding, 'drive');
        await save(state);
        return publicStatus(state, sender, message);
      }
      const before = job.results.length;
      try {
        await authorise(state, tabId, binding, 'drive');
        state.activeJob = await dep('UmSpecDrive', './drive.js').runDriveStep(job);
        binding.driveRootId = state.activeJob.binding.driveRootId ?? binding.driveRootId;
        addChanges(state, binding, state.activeJob.results.slice(before));
        if (state.activeJob.done) {
          state.activeJob.status = 'complete';
          const summary = core().summariseResults(state.activeJob.results);
          if (!summary.failed && !summary.conflicts) binding.syncTimes.drive.lastSuccessfulSyncAt = Date.now();
        }
      } catch (e) {
        job.status = 'paused';
        job.error = { code: e.code || 'SYNC_FAILED', message: 'Sync paused. ' + String(e.message).slice(0, 180) };
      }
      await save(state);
      return publicStatus(state, sender, message);
    }
    if (message.type === 'BEGIN_CALENDAR_SYNC') {
      if (!binding.settings.calendarEnabled) throw error('DISABLED', 'Enable Google Calendar first.');
      await authorise(state, tabId, binding, 'calendar');
      if (!Array.isArray(message.records) || message.records.length > 5000) throw error('CAPACITY', 'Too many dates in one pass.');
      const records = message.records.filter(record => binding.settings.courseIds.includes(String(record.courseId)));
      for (const record of records) if (!calendar().validateEvent(record).valid || record.sourceType !== 'moodle') throw error('INVALID_EVENT', 'Official dates failed validation.');
      const existing = selectJob(state, 'calendar', binding);
      const changed = existing && !scopeMatches(existing, binding, 'calendar');
      if (existing && !existing.done && changed && message.freshInventory !== true) throw error('SCOPE_CHANGED', 'Choose Sync now to read the new selected-course calendar.');
      if (existing && !existing.done && !changed) {
        await joinJob(state, existing, tabId, binding);
      } else {
        state.calendarJob = { id: crypto.randomUUID(), bindingHash: binding.hash, tabId, records, cursor: 0,
          scopeKey: scopeKey(binding.settings, 'calendar'), scopeChanged: false, results: [], done: false, status: 'running', complete: message.complete === true };
        binding.syncTimes.calendar = { ...binding.syncTimes.calendar, lastAttemptAt: Date.now() };
      }
      await save(state);
      return publicStatus(state, sender, message);
    }
    if (message.type === 'CALENDAR_STEP') {
      const job = state.calendarJob;
      if (!job || job.bindingHash !== binding.hash || job.id !== message.jobId) throw error('JOB_CHANGED', 'No matching calendar job.');
      if (job.done) return publicStatus(state, sender, message);
      if (!binding.settings.calendarEnabled) {
        job.status = 'paused';
        await save(state);
        return publicStatus(state, sender, message);
      }
      if (job.status !== 'running' || job.tabId !== tabId) return publicStatus(state, sender, message);
      if (!scopeMatches(job, binding, 'calendar')) {
        pauseForScope(job, binding, 'calendar');
        await save(state);
        return publicStatus(state, sender, message);
      }
      try {
        await authorise(state, tabId, binding, 'calendar');
        if (!binding.calendarId && job.records.length) {
          await dep('UmSpecCalendar', './calendar.js').ensureCalendar(binding, false, () => save(state));
        } else if (job.cursor < job.records.length) {
          const record = { ...job.records[job.cursor], reminderMinutes: binding.settings.reminderMinutes };
          const result = await dep('UmSpecCalendar', './calendar.js').syncEvent(binding, record, () => save(state));
          if (result.action === 'pending') return publicStatus(state, sender, message);
          job.results.push({ ...result, title: record.title });
          if (['create', 'update', 'skip'].includes(result.action)) binding.events[record.sourceKey] = record;
          addChanges(state, binding, [{ ...result, title: record.title }]);
          job.cursor++;
        } else {
          job.done = true;
          job.status = 'complete';
          if (job.complete && !job.results.some(r => ['review', 'restore'].includes(r.action))) binding.syncTimes.calendar.lastSuccessfulSyncAt = Date.now();
        }
      } catch (e) { job.status = 'paused'; job.error = { code: e.code || 'CALENDAR_FAILED', message: String(e.message).slice(0, 180) }; }
      finally { await save(state); }
      return publicStatus(state, sender, message);
    }
    if (message.type === 'QUEUE_ANNOUNCEMENTS') {
      if (!binding.settings.announcementScanning) throw error('DISABLED', 'Enable announcement scanning first.');
      if (!Array.isArray(message.posts) || message.posts.length > 100) throw error('CAPACITY', 'Read announcements in smaller batches.');
      for (const raw of message.posts) {
        if (!binding.settings.courseIds.includes(String(raw.courseId))) throw error('INVALID_SOURCE', 'Unselected course.');
        const post = await announcements().normalisePost(raw);
        const prior = Object.values(binding.candidates).filter(c => c.postId === post.postId && c.courseId === post.courseId && c.forumId === post.forumId);
        if (prior.length && prior.every(c => c.sourceRevision === post.sourceRevision)) continue;
        const suggestions = announcements().extractSuggestions(post);
        addChanges(state, binding, [{ action: 'review', feature: 'announcements',
          sourceKey: 'announcement:' + [post.courseId, post.forumId, post.postId].join(':'),
          sourceRevision: post.sourceRevision, title: post.title.slice(0, 500),
          reason: prior.length ? 'Announcement changed; review required' : 'New announcement; review required' }]);
        if (prior.length && (prior.length !== 1 || suggestions.length !== 1)) {
          for (const candidate of prior) Object.assign(candidate, {
            state: 'stale', sourceRevision: post.sourceRevision, reason: 'multiple_dates',
            evidence: post.text.slice(0, 300), suggestedStart: null, suggestedEnd: null
          });
          continue;
        }
        for (const suggestion of suggestions) {
          if (Object.values(binding.candidates).filter(c => ['pending', 'stale'].includes(c.state)).length >= 500) throw error('BACKLOG_FULL', 'Review the pending dates before scanning more announcements.');
          const candidate = prior[0] || { candidateId: crypto.randomUUID(), slotId: crypto.randomUUID() };
          Object.assign(candidate, suggestion, { courseId: post.courseId, forumId: post.forumId,
            postId: post.postId, sourceUrl: post.sourceUrl, sourceRevision: post.sourceRevision,
            state: prior.length ? 'stale' : 'pending', acceptedRevision: null });
          candidate.sourceKey = 'announcement:' + [post.courseId, post.forumId, post.postId, candidate.slotId].join(':');
          binding.candidates[candidate.candidateId] = candidate;
        }
      }
      binding.syncTimes.announcements = { ...binding.syncTimes.announcements, lastAttemptAt: Date.now() };
      if (message.complete === true) binding.syncTimes.announcements.lastSuccessfulSyncAt = Date.now();
      binding.announcementCursor = message.cursor || null;
      await save(state);
      return publicStatus(state, sender, message);
    }
    if (message.type === 'IGNORE_ANNOUNCEMENT') {
      const candidate = binding.candidates[message.candidateId];
      if (!candidate) throw error('INVALID_REVIEW', 'Review item no longer exists.');
      candidate.state = 'ignored';
      candidate.evidence = '';
      await save(state);
      return publicStatus(state, sender, message);
    }
    if (message.type === 'REVIEW_ANNOUNCEMENT') {
      const candidate = binding.candidates[message.candidateId];
      if (!candidate || !['pending', 'stale'].includes(candidate.state) || !binding.settings.calendarEnabled) throw error('INVALID_REVIEW', 'Review a queued date with Calendar enabled.');
      const refreshed = await announcements().normalisePost(message.refreshedPost);
      if (refreshed.postId !== candidate.postId || refreshed.courseId !== candidate.courseId || refreshed.forumId !== candidate.forumId || refreshed.sourceUrl !== candidate.sourceUrl ||
          refreshed.sourceRevision !== candidate.sourceRevision) throw error('STALE_REVIEW', 'Announcement changed. Scan again before adding this date.');
      const review = announcements().validateReview(candidate, message.editedFields || {});
      if (!review.valid) throw error('INVALID_REVIEW', review.reasons.join(' '));
      await authorise(state, tabId, binding, 'calendar');
      try {
        if (!binding.calendarId) {
          const target = await dep('UmSpecCalendar', './calendar.js').ensureCalendar(binding, false, () => save(state));
          if (!target.id) return { ...publicStatus(state, sender, message), retryReview: true };
        }
        const event = { ...review.event, reminderMinutes: binding.settings.reminderMinutes };
        const result = await dep('UmSpecCalendar', './calendar.js').syncEvent(binding, event, () => save(state));
        if (result.action === 'pending') return { ...publicStatus(state, sender, message), retryReview: true };
        if (['review', 'restore'].includes(result.action)) throw error('EVENT_CONFLICT', 'This calendar entry was edited or removed. Open Google Calendar to review it.');
        candidate.state = 'accepted';
        candidate.acceptedRevision = candidate.sourceRevision;
        candidate.evidence = '';
        binding.events[event.sourceKey] = event;
        addChanges(state, binding, [{ ...result, title: event.title }]);
      } finally { await save(state); }
      return publicStatus(state, sender, message);
    }
    throw error('INVALID_MESSAGE', 'Unsupported command.');
  }
  function handleMessage(message, sender) {
    const task = serial.then(async () => {
      try { return { ok: true, data: await dispatch(message, sender) }; }
      catch (e) { return { ok: false, error: { code: e.code || 'REQUEST_FAILED', message: String(e.message).slice(0, 240) } }; }
    });
    serial = task.then(() => {}, () => {});
    return task;
  }
  root.UmSpecWorker = { handleMessage };
  if (typeof module !== 'undefined') module.exports = root.UmSpecWorker;
  if (typeof importScripts === 'function' && root.chrome?.runtime?.onMessage) {
    const ready = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    chrome.runtime.onMessage.addListener((message, sender, reply) => {
      ready.then(() => handleMessage(message, sender)).then(reply);
      return true;
    });
  }
})(globalThis);
