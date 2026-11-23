/* Google credentials and durable state stay in this trusted extension context. */
if (typeof importScripts === 'function') {
  importScripts('../shared/sync-core.js', '../shared/calendar-core.js', '../shared/announcement-core.js',
    'google.js', 'drive.js', 'calendar.js', '../shared/planner-core.js', '../shared/course-ai.js', 'planner.js', '../shared/course-scan.js');
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
    mode: 'zip', autoSync: true, calendarEnabled: true, announcementScanning: true,
    archiveId: '', courseIds: [], videoPolicy: 'include', reminderMinutes: [1440, 60]
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
    for (const binding of Object.values(state.bindings)) binding.settings = { ...defaults(), ...binding.settings };
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
    if (senderKind(sender) === 'content' && (!binding || !/^[1-9]\d*$/.test(binding.spectrumUserId) || context.userId !== binding.spectrumUserId)) {
      throw error('LOGIN_REQUIRED', 'Confirm your Spectrum account before changing settings.');
    }
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
      dateScan: binding?.dateScan ? structuredClone(binding.dateScan) : null,
      syncTimes: binding?.syncTimes || {}, driveRootId: binding?.driveRootId || null,
      calendarId: binding?.calendarId || null,
      calendarVisibilityNotice: binding?.calendarId && binding.calendarVisibilityIssue?.calendarId === binding.calendarId ? binding.calendarVisibilityIssue.message : null,
      background: binding ? { ...(binding.background || {}), running: Boolean(bgRun), progress: bgProgress } : null,
      job: job ? { id: job.id, tabId: job.tabId, background: Boolean(job.background), done: Boolean(job.done), status: job.status, cursor: job.cursor || 0,
        total: job.materials.length, scopeChanged: !scopeMatches(job, binding, 'drive'),
        summary: core().summariseResults(job.results || []), error: job.error || null,
        attention: (job.results || []).filter(result => ['failed', 'conflict', 'trashed'].includes(result.action)).slice(0, 5)
          .map(result => ({ name: result.name, action: result.action, detail: result.detail || null })) } : null,
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
  function calendarScopeKey(binding, useDateScan) {
    if (!useDateScan) return scopeKey(binding.settings, 'calendar');
    const courseIds = [...(binding.dateScan?.courseIds || [])].sort();
    const sources = (binding.dateScan?.records || []).filter(record => courseIds.includes(String(record.courseId)))
      .map(record => [record.sourceKey, record.sourceRevision]).sort((a, b) => a[0].localeCompare(b[0]));
    return JSON.stringify(['dateScan', courseIds, sources, binding.dateScan?.complete === true,
      binding.settings.calendarEnabled, binding.settings.reminderMinutes]);
  }
  function scopeMatches(job, binding, feature) {
    const key = job.scopeKey ?? (feature === 'drive' && job.binding?.settings ? scopeKey(job.binding.settings, feature) : null);
    return key === (feature === 'calendar' ? calendarScopeKey(binding, job.useDateScan === true) : scopeKey(binding.settings, feature));
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
  async function queueAnnouncementPosts(state, binding, posts, courseIds) {
    if (!Array.isArray(posts) || posts.length > 100) throw error('CAPACITY', 'Read announcements in smaller batches.');
    const now = Date.now();
    // Dates that have already passed cannot be added usefully, so they leave the review queue.
    for (const candidate of Object.values(binding.candidates)) {
      const end = candidate.suggestedEnd || candidate.suggestedStart;
      if (['pending', 'stale'].includes(candidate.state) && end && Date.parse(end.length === 10 ? end + 'T23:59:59+08:00' : end) < now) {
        candidate.state = 'expired';
        candidate.evidence = '';
      }
    }
    for (const raw of posts) {
      if (!raw || !courseIds.includes(String(raw.courseId))) throw error('INVALID_SOURCE', 'Unselected course.');
      const post = await announcements().normalisePost(raw);
      const prior = Object.values(binding.candidates).filter(c => c.postId === post.postId && c.courseId === post.courseId && c.forumId === post.forumId);
      if (prior.length && prior.every(c => c.sourceRevision === post.sourceRevision)) continue;
      // Edited posts keep every suggestion so their earlier reviews are reconciled; new posts skip past dates.
      const suggestions = announcements().extractSuggestions(post, prior.length ? {} : { now });
      if (!prior.length && !suggestions.length) continue;
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
      const category = String(item.category || 'Lecture Slides').replace(/[\x00-\x1f/\\]/g, '_').slice(0, 100);
      const displayName = item.displayName ? String(item.displayName).replace(/[\x00-\x1f/\\]/g, '_').slice(0, 160) : null;
      const section = String(item.section || '').replace(/[\x00-\x1f]/g, ' ').slice(0, 160);
      const courseName = String(item.courseName || item.courseId).replace(/[\x00-\x1f/\\]/g, '_').slice(0, 240);
      const courseFolder = String(item.courseFolder || courseName).replace(/[\x00-\x1f/\\]/g, '_').slice(0, 240);
      const revision = item.kind === 'binary' ? core().canonicalSource(url.href).revision : null;
      const sourceFingerprint = revision ? await core().hashParts(['resource-revision', revision]) : null;
      const mimeType = String(item.mimeType || item.contentType || '').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 100);
      return { sourceKey: item.sourceKey, sourceUrl: url.href, courseId: String(item.courseId),
        moduleId: String(item.moduleId || ''), name, displayName, section, category, courseName, courseFolder, archiveId: binding.settings.archiveId,
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
    if (message.type === 'GET_DEGREE') {
      const saved = await chrome.storage.local.get('umspec_saved_degree');
      return { degree: typeof saved.umspec_saved_degree === 'string' ? saved.umspec_saved_degree : null };
    }
    if (message.type === 'SET_DEGREE') {
      const degree = String(message.degree || '').replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
      await chrome.storage.local.set({ umspec_saved_degree: degree });
      return { degree };
    }
    if (message.type === 'GET_STATUS' || message.type === 'GET_REVIEW_QUEUE') return publicStatus(state, sender, message);
    if (message.type === 'SET_CONTEXT') {
      if (kind !== 'content' || !/^[1-9]\d*$/.test(String(message.userId))) throw error('FORBIDDEN', 'An authenticated Spectrum user is required.');
      const tabId = sender.tab.id;
      const old = state.contexts[String(tabId)];
      const existing = Object.values(state.bindings).find(b => b.spectrumUserId === String(message.userId) &&
        b.googleSub === state.google?.sub);
      const pending = !existing && Object.values(state.bindings).find(b => b.spectrumUserId === 'local_student' &&
        (!b.googleSub || b.googleSub === state.google?.sub));
      const hash = existing?.hash || await core().hashParts(['https://spectrum.um.edu.my', String(message.userId), ...(pending?.googleSub ? [pending.googleSub] : [])]);
      if (!state.bindings[hash]) {
        state.bindings[hash] = {
          googleSub: null, googleEmail: null, features: [], settings: defaults(),
          syncTimes: {}, candidates: {}, events: {}, driveRootId: null, calendarId: null,
          ...pending, hash, spectrumOrigin: 'https://spectrum.um.edu.my', spectrumUserId: String(message.userId)
        };
        if (pending) delete state.bindings[pending.hash];
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
        settings: { ...defaults(), ...(local ? binding.settings : {}), courseIds: [...binding.settings.courseIds], archiveId: binding.settings.archiveId,
          videoPolicy: binding.settings.videoPolicy, reminderMinutes: [...binding.settings.reminderMinutes] },
        syncTimes: {}, candidates: local ? structuredClone(binding.candidates || {}) : {},
        events: local ? structuredClone(binding.events || {}) : {}, dateScan: local ? structuredClone(binding.dateScan || null) : null,
        calendarEvents: {}, driveRootId: null, calendarId: null
      };
      connected.features = [...new Set([...(connected.features || []), message.feature])];
      if (message.feature === 'drive') connected.settings.mode = 'drive';
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
      if (message.feature !== undefined) {
        if (message.feature !== 'calendar') throw error('INVALID_MESSAGE', 'Unsupported pause feature.');
        if (kind !== 'content' || !message.bindingHash) throw error('FORBIDDEN', 'A verified Calendar tab is required.');
        if (state.calendarJob?.bindingHash === binding.hash && state.calendarJob.tabId !== tabId) throw error('BUSY', 'Calendar sync is running in another Spectrum tab.');
      }
      if (message.feature !== 'calendar' && state.activeJob?.bindingHash === binding.hash) state.activeJob.status = 'paused';
      if (state.calendarJob?.bindingHash === binding.hash) state.calendarJob.status = 'paused';
      await save(state);
      return publicStatus(state, sender, message);
    }
    if (message.type === 'MARK_SYNC_ATTEMPT') {
      if (kind !== 'content' || !['drive', 'calendar', 'announcements'].includes(message.feature)) throw error('INVALID_MESSAGE', 'Unsupported sync feature.');
      binding.syncTimes[message.feature] = { ...binding.syncTimes[message.feature], lastAttemptAt: Date.now() };
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
      await advanceDrive(state, binding, job, () => authorise(state, tabId, binding, 'drive'));
      await save(state);
      return publicStatus(state, sender, message);
    }
    if (message.type === 'BACKGROUND_DRIVE_SYNC') {
      if (kind !== 'content') throw error('FORBIDDEN', 'Background sync starts from a signed-in Spectrum tab.');
      // The tab only starts it; the worker and its hidden reader page carry on after the tab is closed.
      startBackgroundSync(binding.hash, { force: message.force === true });
      return publicStatus(state, sender, message);
    }
    if (message.type === 'DRIVE_CLEANUP_PREVIEW' || message.type === 'DRIVE_CLEANUP_APPLY') {
      if (kind !== 'content') throw error('FORBIDDEN', 'Clean up Drive from a signed-in Spectrum tab.');
      const job = state.activeJob?.bindingHash === binding.hash ? state.activeJob : state.savedJobs.drive[binding.hash] || null;
      if (!job?.done) throw error('SYNC_FIRST', 'Finish a Drive sync first, so clean-up knows which files are current.');
      await authorise(state, tabId, binding, 'drive');
      const drive = dep('UmSpecDrive', './drive.js');
      if (message.type === 'DRIVE_CLEANUP_PREVIEW') {
        const plan = drive.planCleanup(await drive.listAppFiles(), { bindingHash: binding.hash, archiveId: binding.settings.archiveId,
          keepKeys: new Set(job.materials.map(item => item.sourceKey)), keepFolderIds: Object.values(job.folders || {}) });
        binding.cleanupPlan = { at: Date.now(), ids: plan.items.map(item => item.id), done: 0 };
        await save(state);
        return { ...publicStatus(state, sender, message), cleanup: { total: plan.items.length, folders: plan.items.filter(item => item.folder).length,
          bytes: plan.bytes, kept: plan.kept, sample: plan.items.filter(item => !item.folder).slice(0, 8).map(item => ({ name: item.name, reason: item.reason })) } };
      }
      // Trashing waits for an explicit preview from the last 15 minutes and works through it in short batches.
      const plan = binding.cleanupPlan;
      if (!plan || Date.now() - plan.at > 15 * 60000) throw error('PREVIEW_FIRST', 'Find duplicates again before moving them to Drive trash.');
      const started = Date.now();
      while (plan.done < plan.ids.length && Date.now() - started < 2500) { await drive.trashFile(plan.ids[plan.done]); plan.done++; }
      const progress = { done: plan.done, total: plan.ids.length };
      if (plan.done >= plan.ids.length) { binding.cleanupPlan = null; binding.lastCleanup = { at: Date.now(), trashed: plan.ids.length }; }
      await save(state);
      return { ...publicStatus(state, sender, message), cleanup: progress };
    }
    if (message.type === 'BEGIN_CALENDAR_SYNC') {
      if (!binding.settings.calendarEnabled) throw error('DISABLED', 'Enable Google Calendar first.');
      await authorise(state, tabId, binding, 'calendar');
      const useDateScan = message.useDateScan === true;
      if (useDateScan && (!message.bindingHash || !binding.dateScan)) throw error('INVALID_SOURCE', 'Complete a verified local date scan first.');
      const sourceRecords = useDateScan ? binding.dateScan.records : message.records;
      const courseIds = useDateScan ? binding.dateScan.courseIds : binding.settings.courseIds;
      if (!Array.isArray(sourceRecords) || sourceRecords.length > 5000) throw error('CAPACITY', 'Too many dates in one pass.');
      const records = sourceRecords.filter(record => courseIds.includes(String(record.courseId)));
      for (const record of records) if (!calendar().validateEvent(record).valid || record.sourceType !== 'moodle') throw error('INVALID_EVENT', 'Official dates failed validation.');
      const existing = selectJob(state, 'calendar', binding);
      const changed = existing && (Boolean(existing.useDateScan) !== useDateScan || !scopeMatches(existing, binding, 'calendar'));
      if (existing && !existing.done && changed && message.freshInventory !== true) throw error('SCOPE_CHANGED', 'Choose Sync now to read the new selected-course calendar.');
      if (existing && !existing.done && !changed) {
        await joinJob(state, existing, tabId, binding);
      } else {
        state.calendarJob = { id: crypto.randomUUID(), bindingHash: binding.hash, tabId, records, cursor: 0,
          scopeKey: calendarScopeKey(binding, useDateScan), useDateScan, scopeChanged: false, results: [], done: false, status: 'running',
          complete: useDateScan ? binding.dateScan.complete === true : message.complete === true };
        binding.syncTimes.calendar = { ...binding.syncTimes.calendar, lastAttemptAt: Date.now() };
      }
      // Each sync may try once more to show the calendar after an earlier refusal.
      delete binding.calendarVisibilityIssue;
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
        if ((!binding.calendarId && job.records.length) ||
            (binding.calendarId && !job.records.length && binding.calendarVisibilityId !== binding.calendarId &&
              binding.calendarVisibilityIssue?.calendarId !== binding.calendarId)) {
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
    if (message.type === 'SAVE_DATE_SCAN') {
      if (kind !== 'content' || typeof message.bindingHash !== 'string' || !message.bindingHash) throw error('FORBIDDEN', 'A verified date scan binding is required.');
      if (!Array.isArray(message.courseIds) || message.courseIds.length > 100 ||
          message.courseIds.some(id => !/^[1-9]\d*$/.test(String(id))) || typeof message.complete !== 'boolean') throw error('INVALID_SOURCE', 'Invalid date scan course scope.');
      const courseIds = [...new Set(message.courseIds.map(String))];
      if (!Array.isArray(message.records) || message.records.length > 5000) throw error('CAPACITY', 'Too many dates in one scan.');
      for (const record of message.records) {
        if (!calendar().validateEvent(record).valid || record.sourceType !== 'moodle' || !courseIds.includes(String(record.courseId))) throw error('INVALID_EVENT', 'Official dates failed validation.');
      }
      const failures = message.failures ?? [];
      if (!Array.isArray(failures) || failures.length > 200 || failures.some(item => !item || typeof item.message !== 'string' ||
          item.message.length > 500 || (item.courseId != null && !courseIds.includes(String(item.courseId))))) throw error('INVALID_SOURCE', 'Invalid date scan failures.');
      const cursor = message.announcementCursor ?? null;
      if (cursor !== null && (typeof cursor !== 'object' || Array.isArray(cursor) || JSON.stringify(cursor).length > 8192 ||
          (cursor.courseId != null && !courseIds.includes(String(cursor.courseId))))) throw error('INVALID_SOURCE', 'Invalid date scan cursor.');
      const records = new Map((message.complete ? [] : binding.dateScan?.records || []).map(record => [record.sourceKey, record]));
      for (const record of message.records) records.set(record.sourceKey, record);
      if (records.size > 5000) throw error('CAPACITY', 'Too many dates in one scan.');
      await liveContext(state, tabId, binding);
      await queueAnnouncementPosts(state, binding, message.posts, courseIds);
      binding.dateScan = { courseIds, records: structuredClone([...records.values()]), completedAt: Date.now(),
        complete: message.complete, announcementCursor: structuredClone(cursor),
        failures: failures.map(item => ({ message: item.message, ...(item.courseId != null ? { courseId: String(item.courseId) } : {}) })) };
      if (state.calendarJob?.bindingHash === binding.hash) pauseForScope(state.calendarJob, binding, 'calendar');
      pauseForScope(state.savedJobs.calendar[binding.hash], binding, 'calendar');
      await save(state);
      return publicStatus(state, sender, message);
    }
    if (message.type === 'QUEUE_ANNOUNCEMENTS') {
      if (!binding.settings.announcementScanning) throw error('DISABLED', 'Enable announcement scanning first.');
      await liveContext(state, tabId, binding);
      await queueAnnouncementPosts(state, binding, message.posts, binding.settings.courseIds);
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
  // One Drive step, then any further files that finish without an upload, under a single verification and state write
  // (live: 480 items took ~1.7 s each when every file needed its own account checks and state write).
  async function advanceDrive(state, binding, job, authoriseFn) {
    const before = job.results.length;
    try {
      await authoriseFn();
      const drive = dep('UmSpecDrive', './drive.js');
      state.activeJob = await drive.runDriveStep(job);
      const started = Date.now();
      for (let settled = 1; settled < 60 && Date.now() - started < 2000; settled++) {
        const current = state.activeJob, count = current.results.length;
        if (current.done || current.upload || current.folderIntent || current.status !== 'running' || !current.remoteFiles || count === before) break;
        const next = await drive.runDriveStep(current);
        state.activeJob = next;
        if (next.results.length === count) break;
      }
      binding.driveRootId = state.activeJob.binding.driveRootId ?? binding.driveRootId;
      binding.driveLinks = state.activeJob.binding.driveLinks ?? binding.driveLinks;
      addChanges(state, binding, state.activeJob.results.slice(before));
      if (state.activeJob.done) {
        state.activeJob.status = 'complete';
        const summary = core().summariseResults(state.activeJob.results);
        if (!summary.failed && !summary.conflicts) binding.syncTimes.drive.lastSuccessfulSyncAt = Date.now();
      }
    } catch (e) {
      // Keep whatever this call already settled; pause on the item that failed.
      const paused = state.activeJob || job;
      if (paused !== job) {
        binding.driveRootId = paused.binding.driveRootId ?? binding.driveRootId;
        binding.driveLinks = paused.binding.driveLinks ?? binding.driveLinks;
        addChanges(state, binding, paused.results.slice(before));
      }
      paused.status = 'paused';
      paused.error = { code: e.code || 'SYNC_FAILED', message: 'Sync paused. ' + String(e.message).slice(0, 180) };
    }
  }

  // ---------- Background Drive sync ----------
  // Opening Spectrum starts it; a hidden extension page reads course pages with the signed-in session, and this worker
  // uploads. Progress is saved after every batch, and a one-minute alarm resumes it if Chrome stops the worker.
  const BG_ALARM = 'umspec-bg-drive';
  let bgRun = null, bgProgress = null, bgVerifiedAt = 0;
  function exclusive(fn) {
    const task = serial.then(fn);
    serial = task.then(() => {}, () => {});
    return task;
  }
  async function offscreen(type, payload = {}) {
    if (!root.chrome?.offscreen) throw error('UNSUPPORTED', 'This browser cannot sync in the background. Keep a Spectrum tab open instead.');
    const open = chrome.runtime.getContexts ? (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length > 0 : false;
    if (!open) {
      await chrome.offscreen.createDocument({ url: 'offscreen/sync.html', reasons: ['DOM_PARSER'],
        justification: 'Read signed-in Spectrum course pages so Google Drive sync continues without an open tab.' })
        .catch(e => { if (!/single offscreen|already/i.test(e.message)) throw e; });
    }
    const response = await chrome.runtime.sendMessage({ target: 'umspec-offscreen', type, ...payload });
    if (!response?.ok) throw error(response?.error?.code || 'BACKGROUND_UNAVAILABLE', response?.error?.message || 'Background reader unavailable.');
    return response.data;
  }
  async function closeOffscreen() { try { await chrome.offscreen?.closeDocument(); } catch {} }
  async function authoriseBackground(binding) {
    if (Date.now() - bgVerifiedAt > 60000) {
      const current = await offscreen('CONTEXT');
      if (String(current.userId) !== binding.spectrumUserId) throw error('LOGIN_REQUIRED', 'A different Spectrum account is signed in. Background sync stopped.');
      bgVerifiedAt = Date.now();
    }
    if (!binding.googleSub || !binding.features?.includes('drive')) throw error('CONNECT_REQUIRED', 'Connect Google Drive first.');
    await google().verifyAccount(binding.googleSub, 'drive');
  }
  function backgroundDue(binding, now = Date.now()) {
    const settings = binding.settings, times = binding.syncTimes?.drive || {};
    return Boolean(settings.mode === 'drive' && settings.autoSync && settings.archiveId && settings.courseIds.length &&
      binding.features?.includes('drive') && times.lastSuccessfulSyncAt && now - (times.lastAttemptAt || 0) >= 15 * 60000);
  }
  // Course names and Drive folder names come from the last Drive job, so files land in the same folders as before.
  async function backgroundCourses(state, binding) {
    const known = new Map();
    for (const job of [state.activeJob, state.savedJobs.drive[binding.hash]]) {
      if (job?.bindingHash !== binding.hash) continue;
      for (const item of job.materials || []) {
        if (!known.has(String(item.courseId)) && item.courseName) known.set(String(item.courseId), { id: Number(item.courseId), fullName: item.courseName, shortName: '', folderName: item.courseFolder || item.courseName });
      }
    }
    const planner = (await chrome.storage.local.get('umspecPlanner')).umspecPlanner;
    const scan = dep('UmSpecCourseScan', '../shared/course-scan.js');
    return binding.settings.courseIds.map(id => {
      if (known.has(String(id))) return known.get(String(id));
      const course = planner?.courses?.find(item => item.id === String(id));
      return course ? { id: Number(id), fullName: course.fullName, shortName: course.shortName, folderName: scan.formatCourseFolder(course.fullName, course.shortName) } : null;
    });
  }
  function startBackgroundSync(bindingHash, options = {}) {
    if (bgRun) return bgRun;
    bgRun = backgroundSync(bindingHash, options).catch(() => {}).finally(() => { bgRun = null; bgProgress = null; });
    return bgRun;
  }
  async function recordBackground(bindingHash, patch) {
    await exclusive(async () => {
      const state = await readState(), binding = state.bindings[bindingHash];
      if (!binding) return;
      binding.background = { ...binding.background, ...patch, at: Date.now() };
      await save(state);
    });
  }
  async function backgroundSync(bindingHash, { force = false } = {}) {
    let jobId = await exclusive(async () => {
      const state = await readState(), binding = state.bindings[bindingHash];
      if (!binding) return null;
      const current = state.activeJob?.bindingHash === bindingHash ? state.activeJob : null;
      if (current && !current.done && current.background && current.status === 'running' && current.tabId == null && scopeMatches(current, binding, 'drive')) return current.id;
      if (current && !current.done && current.upload != null) return null;
      if (!(force ? binding.settings.mode === 'drive' && binding.features?.includes('drive') : backgroundDue(binding))) return null;
      binding.syncTimes.drive = { ...binding.syncTimes.drive, lastAttemptAt: Date.now() };
      binding.background = { phase: 'scanning', error: null, at: Date.now() };
      await save(state);
      return 'scan';
    });
    if (!jobId) return;
    await chrome.alarms?.create(BG_ALARM, { periodInMinutes: 1 });
    try {
      if (jobId === 'scan') {
        bgProgress = { phase: 'scanning', course: 0, courses: 0 };
        const state = await readState(), binding = state.bindings[bindingHash];
        await authoriseBackground(binding);
        const courses = await backgroundCourses(state, binding);
        if (courses.some(course => !course)) throw error('PARTIAL_SCAN', 'Some selected courses are not known yet. Open Courses in UM Spec once.');
        const scanned = await offscreen('SCAN', { courses, videoPolicy: binding.settings.videoPolicy });
        jobId = await exclusive(async () => {
          const state = await readState(), binding = state.bindings[bindingHash];
          const materials = await validateMaterials(scanned.materials, binding);
          const existing = selectJob(state, 'drive', binding);
          // A sync the student started in a Spectrum tab meanwhile keeps priority.
          if (existing && !existing.done && (existing.upload != null || (existing.tabId != null && existing.status === 'running'))) throw error('BUSY', 'A Spectrum tab is already syncing to Drive.');
          state.activeJob = { id: crypto.randomUUID(), bindingHash, binding: structuredClone(binding), scopeKey: scopeKey(binding.settings, 'drive'), scopeChanged: false,
            tabId: null, background: true, heartbeat: Date.now(), materials, cursor: 0, results: [], status: 'running', done: false };
          binding.background = { phase: 'uploading', error: null, skipped: scanned.skipped || 0, at: Date.now() };
          await save(state);
          return state.activeJob.id;
        });
      }
      bgProgress = { phase: 'uploading' };
      for (;;) {
        const outcome = await exclusive(async () => {
          const state = await readState(), binding = state.bindings[bindingHash], job = state.activeJob;
          // A Spectrum tab that took the job over (tabId set) or a pause from the student ends the background loop.
          if (!binding || !job || job.id !== jobId || job.tabId != null || job.done || job.status !== 'running') return 'stop';
          if (!scopeMatches(job, binding, 'drive')) { pauseForScope(job, binding, 'drive'); await save(state); return 'stop'; }
          await advanceDrive(state, binding, job, () => authoriseBackground(binding));
          state.activeJob.heartbeat = Date.now();
          if (state.activeJob.done) binding.background = { phase: 'complete', error: null, at: Date.now() };
          else if (state.activeJob.error) binding.background = { phase: 'paused', error: state.activeJob.error.message, at: Date.now() };
          await save(state);
          return state.activeJob.done || state.activeJob.status !== 'running' ? 'stop' : 'more';
        });
        if (outcome === 'stop') break;
      }
    } catch (e) {
      await recordBackground(bindingHash, { phase: 'paused', error: String(e.message).slice(0, 200) });
    } finally {
      bgVerifiedAt = 0;
      await chrome.alarms?.clear(BG_ALARM);
      await closeOffscreen();
    }
  }
  async function resumeBackground() {
    const state = await readState(), job = state.activeJob;
    if (job?.background && !job.done && job.status === 'running' && job.tabId == null) startBackgroundSync(job.bindingHash);
    else await chrome.alarms?.clear(BG_ALARM);
  }

  function handleMessage(message, sender) {
    // Planner commands keep their own storage key, so they never wait behind a long Drive or Calendar step.
    if (typeof message?.type === 'string' && message.type.startsWith('PLANNER_')) {
      const planner = dep('UmSpecPlannerWorker', './planner.js');
      return Promise.resolve().then(() => planner.handle(message, sender)).then(data => ({ ok: true, data }),
        e => ({ ok: false, error: { code: e.code || 'REQUEST_FAILED', message: String(e.message).slice(0, 240) } }));
    }
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
    root.UmSpecPlannerWorker?.install();
    chrome.runtime.onMessage.addListener((message, sender, reply) => {
      // The hidden background reader talks only to this worker; its requests are not student commands.
      if (message?.target === 'umspec-offscreen') return;
      if (message?.target === 'umspec-worker') {
        if (sender.id === chrome.runtime.id && !sender.tab && message.type === 'BG_SCAN_PROGRESS' && bgProgress) {
          bgProgress = { phase: 'scanning', course: Number(message.course) || 0, courses: Number(message.courses) || 0 };
        }
        return;
      }
      ready.then(() => handleMessage(message, sender)).then(reply);
      return true;
    });
    chrome.alarms?.onAlarm.addListener(alarm => { if (alarm.name === BG_ALARM) ready.then(resumeBackground).catch(() => {}); });
    chrome.runtime.onStartup?.addListener(() => { ready.then(resumeBackground).catch(() => {}); });
  }
  root.UmSpecWorker.backgroundDue = backgroundDue;
})(globalThis);
