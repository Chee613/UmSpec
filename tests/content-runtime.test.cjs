const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function mountedRuntime(overrides = {}) {
  const elements = new Map(), nodes = [], commands = [];
  let controls = [], choices = [], observer, listener, destinationMode = 'zip';
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, makeElement());
    return elements.get(selector);
  };
  const makeElement = tag => {
    const value = { tag, dataset: {}, style: {}, handlers: {}, children: [], disabled: false, value: '', checked: false, options: [],
      append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; }, setAttribute() {},
      querySelector: element,
      querySelectorAll: selector => selector === '[data-mode-choice]' ? choices : selector === 'input, select, [data-sync-save]' ? controls : [],
      addEventListener(type, handler) { this.handlers[type] = handler; },
      dispatchEvent(event) { this.pending = this.handlers[event.type]?.({ target: this }); },
      click() { if (!this.disabled) return this.handlers.click?.(); } };
    Object.defineProperty(value, 'id', { set(id) { elements.set('#' + id, value); } });
    nodes.push(value);
    return value;
  };
  element('[name="mode"]').options = [{ value: 'zip' }, { value: 'drive' }];
  element('[name="reminders"]').options = [{ value: '1440,60' }];
  controls = ['#umspec-sync-archive', '[name="videoDownloads"]', '[name="autoSync"]', '[name="calendarEnabled"]',
    '[name="announcementScanning"]', '[name="reminders"]', '[data-sync-save]'].map(element);
  choices = ['zip', 'drive'].map(mode => { const choice = makeElement(); choice.dataset.modeChoice = mode; return choice; });
  for (const id of ['umspec-settings-host', 'umspec-sync-home-host', 'umspec-dates-host', 'umspec-modal', 'umspec-sync-status']) element('#' + id);
  const state = overrides.state || { configured: true, bindingHash: 'verified', account: { email: 'student@example.test', features: ['drive', 'calendar'] },
    settings: { mode: 'zip', courseIds: ['123'], calendarEnabled: true, reminderMinutes: [1440, 60] },
    syncTimes: { drive: { lastSuccessfulSyncAt: 1 } }, candidates: [], events: [] };
  const context = { console, URL, AbortSignal, AbortController, Event,
    document: { documentElement: {}, activeElement: null, createElement: makeElement, getElementById: id => elements.get('#' + id) || null },
    MutationObserver: class { constructor(callback) { observer = this; this.callback = callback; } observe() {} disconnect() { this.disconnected = true; } },
    addEventListener() {}, UmSpecCalendarCore: { upcomingRecords: () => [] },
    UmSpecExporter: { verifyContext: async () => ({ userId: '42', origin: 'https://spectrum.um.edu.my' }),
      destination: () => destinationMode, applySettings: settings => { destinationMode = settings.mode; },
      setSelectedCourses() {}, selectedCourses: () => [], videoPolicy: () => 'links' },
    chrome: { runtime: { id: 'umspec',
      getURL: overrides.getURL || (path => 'chrome-extension://umspec/' + path),
      onMessage: { addListener: callback => { listener = callback; overrides.addListener?.(); } },
      sendMessage: message => { commands.push(message); return overrides.sendMessage ? overrides.sendMessage(message, state) : Promise.resolve({ ok: true, data: structuredClone(state) }); }
    } }
  };
  return { context, state, element, nodes, controls, choices, commands,
    get observer() { return observer; }, get listener() { return listener; },
    start() { vm.runInNewContext(fs.readFileSync('content/student-sync.js', 'utf8'), context); } };
}

test('Calendar preferences report the Calendar connection separately from Drive', async () => {
  const fixture = mountedRuntime();
  fixture.state.account.features = ['drive'];
  fixture.start(); await new Promise(setImmediate);
  fixture.element('#umspec-sync-panel').dataset.settingsProvider = 'calendar';
  await fixture.context.UmSpecStudentSync.refreshPanel();
  assert.equal(fixture.element('[data-settings-provider-status]').textContent, 'Google Calendar not connected');
  assert.equal(fixture.element('[data-settings-connection]').dataset.connected, 'false');
  fixture.state.account.features.push('calendar');
  await fixture.context.UmSpecStudentSync.refreshPanel();
  assert.equal(fixture.element('[data-settings-provider-status]').textContent, 'Google Calendar connected');
});

test('the Dates tab keeps the saved count and shows a visibility notice instead of a paused state', async () => {
  const fixture = mountedRuntime();
  const feedback = () => fixture.element('[data-calendar-feedback]').children[0].textContent;
  Object.assign(fixture.state, { calendarId: 'managed', events: [{ status: 'confirmed' }, { status: 'confirmed' }],
    calendarVisibilityNotice: 'UM Spec could not turn on its calendar (HTTP 403 insufficientPermissions).' });
  fixture.start(); await new Promise(setImmediate);
  await fixture.context.UmSpecStudentSync.refreshPanel();
  assert.match(feedback(), /^2 dates saved\. UM Spec could not turn on its calendar \(HTTP 403 insufficientPermissions\)/);
  assert.doesNotMatch(feedback(), /paused/);
  fixture.state.calendarJob = { status: 'paused', error: { code: 'CALENDAR_HTTP', message: 'Google Calendar request failed (500)' } };
  await fixture.context.UmSpecStudentSync.refreshPanel();
  assert.match(feedback(), /^Calendar sync paused: Google Calendar request failed \(500\)/);
});

test('an invalidated icon lookup leaves a refresh notice and stops repeated mounting', async () => {
  let lookups = 0;
  const fixture = mountedRuntime({ getURL() { lookups++; throw new Error('Extension context invalidated.'); } });
  assert.doesNotThrow(() => fixture.start());
  await new Promise(setImmediate);
  assert.match(fixture.element('#umspec-sync-status').textContent, /UM Spec was updated.*Refresh this Spectrum tab/);
  assert.equal(fixture.observer.disconnected, true);
  fixture.observer.callback();
  assert.equal(lookups, 1);
  assert.ok(fixture.controls.every(control => control.disabled));
  assert.equal(fixture.choices[0].disabled, false, 'local ZIP stays selectable');
  assert.equal(fixture.choices[1].disabled, true);
  assert.equal(fixture.commands.length, 0, 'stale mounting must not start account commands');
});

test('invalidated listener registration does not crash startup or start account work', async () => {
  const fixture = mountedRuntime({ addListener() { throw new Error('Extension context invalidated.'); } });
  assert.doesNotThrow(() => fixture.start());
  await new Promise(setImmediate);
  assert.match(fixture.element('#umspec-sync-status').textContent, /Refresh this Spectrum tab/);
  assert.equal(fixture.commands.length, 0);
});

test('synchronous and rejected stale runtime commands lock the account and remain handled by review clicks', async () => {
  for (const synchronous of [true, false]) {
    let stale = false;
    const fixture = mountedRuntime({ sendMessage(message, state) {
      if (stale) {
        const error = new Error('Extension context invalidated.');
        if (synchronous) throw error;
        return Promise.reject(error);
      }
      return Promise.resolve({ ok: true, data: structuredClone(state) });
    } });
    fixture.start();
    await new Promise(setImmediate);
    assert.deepEqual(Array.from(fixture.context.UmSpecStudentSync.savedCourseIds()), ['123']);
    fixture.state.candidates = [{ candidateId: 'pending', title: 'Meeting', courseId: '123', forumId: '5', postId: '9',
      sourceKey: 'forum:9', sourceRevision: 'rev', sourceUrl: 'https://spectrum.um.edu.my/mod/forum/discuss.php?d=8#p9',
      kind: 'meeting', precision: 'instant', suggestedStart: '2026-11-02T14:00:00+08:00', suggestedEnd: '2026-11-02T15:00:00+08:00' }];
    await fixture.context.UmSpecStudentSync.refreshPanel();
    const accept = fixture.nodes.find(value => value.textContent === 'Save to Calendar');
    const body = { textContent: 'Meeting on 2 Nov 2026 at 14:00 to 15:00', querySelectorAll: () => [] };
    body.cloneNode = () => body;
    const post = { id: 'p9', getAttribute: name => name === 'data-post-id' ? '9' : null,
      querySelector: selector => selector.startsWith('[data-region="post-content"]') ? body : null };
    fixture.context.DOMParser = class { parseFromString() { return { getElementById: () => post, querySelector: () => null, querySelectorAll: () => [] }; } };
    fixture.context.fetch = async url => ({ ok: true, url, text: async () => '<html></html>' });
    fixture.context.UmSpecAnnouncements = { normalisePost: async value => value, validateReview: () => ({ valid: true }) };
    stale = true;
    await accept.click();
    await new Promise(setImmediate);
    assert.match(fixture.element('#umspec-sync-status').textContent, /UM Spec was updated.*Refresh this Spectrum tab/);
    assert.equal(accept.disabled, true, 'the stale review cannot be submitted again');
    assert.equal(fixture.context.UmSpecStudentSync.savedCourseIds(), null);
    assert.ok(fixture.controls.every(control => control.disabled));
    assert.equal(fixture.choices[0].disabled, false);
    assert.equal(fixture.choices[1].disabled, true);
    const sent = fixture.commands.length;
    await fixture.context.UmSpecStudentSync.refreshPanel();
    assert.equal(fixture.commands.length, sent, 'known stale contexts never send another account request');
    assert.equal(await fixture.context.UmSpecStudentSync.exportOrSync(), false, 'local ZIP still bypasses the worker');
  }
});

test('runtime invalidation cancels an active date scan and stops its animation before any dates are saved', async () => {
  let stale = false, enterRead, aborted = false, stops = 0;
  const reading = new Promise(resolve => { enterRead = resolve; });
  const fixture = mountedRuntime({ sendMessage(_message, state) {
    return stale ? Promise.reject(new Error('Extension context invalidated.')) : Promise.resolve({ ok: true, data: structuredClone(state) });
  } });
  fixture.start();
  await new Promise(setImmediate);
  const runner = { state: 'IDLE', start: async () => { runner.state = 'RUNNING'; }, stop: () => { runner.state = 'IDLE'; stops++; } };
  fixture.context.document.querySelector = selector => fixture.element(selector);
  fixture.context.UmSpecExporter.createDateAnalysisRunner = () => runner;
  fixture.context.UmSpecExporter.selectedCourses = () => [{ id: '123' }];
  fixture.context.UmSpecExporter.getSesskey = () => 'fixture';
  fixture.context.fetch = async (_url, options) => {
    enterRead();
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => { aborted = true; reject(options.signal.reason); }, { once: true }));
  };
  fixture.context.UmSpecStudentSync.onTabChange('dates');
  await reading;
  assert.equal(runner.state, 'RUNNING');
  stale = true;
  await fixture.context.UmSpecStudentSync.refreshPanel();
  await fixture.context.UmSpecStudentSync.analyseDates();
  assert.equal(aborted, true);
  assert.equal(runner.state, 'IDLE');
  assert.ok(stops > 0);
  assert.equal(fixture.element('[data-date-analysis]').hidden, true);
  assert.match(fixture.element('[data-dates-summary]').textContent, /Refresh this Spectrum tab/);
  assert.equal(fixture.commands.some(message => ['SAVE_DATE_SCAN', 'BEGIN_CALENDAR_SYNC'].includes(message.type)), false);
});

test('popup refresh waits for verified worker context and reports verification failures', async () => {
  let listener, verify, persist;
  const exporter = { getContext: () => null };
  const context = { console, URL, AbortSignal, AbortController,
    document: { getElementById: () => null, documentElement: {} },
    MutationObserver: class { observe() {} }, addEventListener() {},
    UmSpecExporter: exporter,
    chrome: { runtime: { id: 'umspec', onMessage: { addListener: callback => { listener = callback; } },
      sendMessage: () => new Promise(resolve => { persist = resolve; }) } }
  };
  vm.runInNewContext(fs.readFileSync('content/student-sync.js', 'utf8'), context);
  await new Promise(setImmediate);
  exporter.verifyContext = () => new Promise(resolve => { verify = resolve; });
  let response;
  assert.equal(listener({ type: 'UMSPEC_REFRESH_STATUS' }, { id: 'umspec' }, value => { response = value; }), true);
  assert.equal(response, undefined);
  verify({ userId: '42', origin: 'https://spectrum.um.edu.my' });
  await new Promise(setImmediate);
  assert.equal(response, undefined, 'verification alone must not acknowledge before SET_CONTEXT finishes');
  persist({ ok: true, data: { bindingHash: 'verified', settings: { mode: 'zip' } } });
  await new Promise(setImmediate);
  assert.equal(response.ok, true);
  exporter.verifyContext = async () => { throw Object.assign(new Error('Spectrum account changed. Refresh this tab.'), { code: 'ACCOUNT_CHANGED' }); };
  response = undefined;
  listener({ type: 'UMSPEC_REFRESH_STATUS' }, { id: 'umspec' }, value => { response = value; });
  await new Promise(setImmediate);
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'ACCOUNT_CHANGED');
  assert.match(response.error.message, /Refresh this tab/);
});

test('failed Spectrum revalidation locks account settings while leaving local ZIP available', async () => {
  const context = { console, URL, AbortSignal, AbortController,
    UmSpecExporter: { verifyContext: async () => ({ userId: '42', origin: 'https://spectrum.um.edu.my' }) },
    chrome: { runtime: { sendMessage: async () => ({ ok: true, data: {
      bindingHash: 'verified', settings: { mode: 'zip', courseIds: ['123'] }
    } }) } }
  };
  vm.runInNewContext(fs.readFileSync('content/student-sync.js', 'utf8'), context);
  const sync = context.UmSpecStudentSync;
  await sync.refreshPanel();
  assert.deepEqual(Array.from(sync.savedCourseIds()), ['123']);
  const controls = [{ disabled: false }, { disabled: false }];
  const destination = { disabled: false, dataset: {}, options: [{ value: 'zip' }, { value: 'drive' }] }, updateButton = { disabled: false }, notice = {};
  const choices = ['zip', 'drive'].map(mode => ({ disabled: false, dataset: { modeChoice: mode }, attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; } }));
  const panel = { querySelectorAll: () => controls };
  const modal = { querySelector: selector => selector === '[name="mode"]' ? destination : updateButton,
    querySelectorAll: () => choices };
  context.document = { getElementById: id => ({
    'umspec-sync-panel': panel, 'umspec-modal': modal, 'umspec-sync-status': notice
  })[id] || null };
  context.UmSpecExporter.verifyContext = async () => {
    throw Object.assign(new Error('Could not verify your Spectrum session. Refresh Spectrum and retry.'), { code: 'LOGIN_REQUIRED' });
  };
  await sync.refreshPanel();
  assert.equal(destination.disabled, false, 'ZIP must remain selectable without authorising account changes');
  assert.equal(destination.options[1].disabled, true, 'Drive still requires verified context');
  assert.equal(choices[0].disabled, false, 'the visible ZIP button remains usable');
  assert.equal(choices[0].attributes['aria-pressed'], 'true');
  assert.equal(choices[1].disabled, true, 'the visible Drive button follows the same authorisation boundary');
  assert.ok(controls.every(control => control.disabled));
  assert.equal(updateButton.disabled, true);
  assert.equal(sync.savedCourseIds(), null, 'an unverified session must not reuse the previous student selection');
  assert.match(notice.textContent, /Refresh Spectrum/);
  assert.equal(await sync.exportOrSync(), false, 'local ZIP remains available');
  assert.equal(destination.options[1].disabled, true, 'a status read cannot replace Spectrum verification');
});

test('a pending destination save blocks Settings edits until failure or success finishes', async () => {
  const elements = new Map(), commands = [];
  let controls = [], choices = [], resumeVerification, deferVerification = false, rejectSave = true, destinationMode = 'zip';
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, makeElement());
    return elements.get(selector);
  };
  const makeElement = () => {
    const value = { dataset: {}, handlers: {}, disabled: false, value: '', checked: false, options: [],
      append() {}, replaceChildren() {}, setAttribute() {},
      querySelector: element,
      querySelectorAll: selector => selector === '[data-mode-choice]' ? choices : selector === 'input, select, [data-sync-save]' ? controls : [],
      addEventListener(type, handler) { this.handlers[type] = handler; },
      dispatchEvent(event) { this.pending = this.handlers[event.type]?.({ target: this }); },
      click() { if (!this.disabled) return this.handlers.click?.(); } };
    Object.defineProperty(value, 'id', { set(id) { elements.set('#' + id, value); } });
    return value;
  };
  const destination = element('[name="mode"]');
  destination.options = [{ value: 'zip' }, { value: 'drive' }];
  element('[name="reminders"]').options = [{ value: '1440,60' }];
  controls = ['#umspec-sync-archive', '[name="videoDownloads"]', '[name="autoSync"]', '[name="calendarEnabled"]',
    '[name="announcementScanning"]', '[name="reminders"]', '[data-sync-save]'].map(element);
  choices = ['zip', 'drive'].map(mode => { const choice = makeElement(); choice.dataset.modeChoice = mode; return choice; });
  for (const id of ['umspec-settings-host', 'umspec-sync-home-host', 'umspec-dates-host', 'umspec-modal']) element('#' + id);
  const identity = { userId: '42', origin: 'https://spectrum.um.edu.my' };
  let status = { configured: true, bindingHash: 'verified', account: { email: 'student@example.test', features: ['drive', 'calendar'] },
    settings: { mode: 'zip', courseIds: [], videoPolicy: 'links', reminderMinutes: [1440, 60] },
    syncTimes: { drive: { lastSuccessfulSyncAt: 1 } }, candidates: [], events: [] };
  const context = { console, URL, AbortSignal, AbortController, Event,
    document: { documentElement: {}, activeElement: null, createElement: makeElement, getElementById: id => elements.get('#' + id) || null },
    MutationObserver: class { observe() {} }, addEventListener() {},
    UmSpecCalendarCore: { upcomingRecords: () => [] },
    UmSpecExporter: {
      verifyContext: () => deferVerification ? new Promise(resolve => { resumeVerification = resolve; }) : Promise.resolve(identity),
      destination: () => destinationMode, applySettings: settings => { destinationMode = settings.mode; },
      videoPolicy: () => 'links', selectedCourses: () => []
    },
    chrome: { runtime: { id: 'umspec', onMessage: { addListener() {} }, sendMessage: async message => {
      commands.push(message);
      if (message.type === 'SAVE_SETTINGS') {
        if (rejectSave) return { ok: false, error: { code: 'REQUEST_FAILED', message: 'Save failed' } };
        status = { ...status, settings: { ...status.settings, ...message.settings } };
      }
      return { ok: true, data: structuredClone(status) };
    } } }
  };
  vm.runInNewContext(fs.readFileSync('content/student-sync.js', 'utf8'), context);
  await new Promise(setImmediate);
  const save = element('[data-sync-save]'), syncNow = element('[data-sync-now]');
  assert.equal(save.disabled, false);
  assert.equal(element('[data-settings-provider-status]').textContent, 'Google Drive connected');
  assert.equal(element('[data-settings-connection]').dataset.connected, 'true');
  deferVerification = true;
  for (const shouldReject of [true, false]) {
    rejectSave = shouldReject;
    choices[1].click();
    assert.equal(save.disabled, true, 'Settings cannot save the previous hidden destination while its replacement is pending');
    assert.ok(controls.every(control => control.disabled), 'all Settings edits must stay locked during destination verification');
    assert.equal(syncNow.disabled, true, 'a new sync must not start with the previous destination');
    const sent = commands.length;
    save.click();
    assert.equal(commands.length, sent, 'disabled Settings cannot issue an overlapping save');
    resumeVerification(identity);
    await destination.pending;
    assert.ok(controls.every(control => !control.disabled), 'both rejected and completed saves unlock Settings');
    assert.equal(syncNow.disabled, false);
    assert.equal(destinationMode, shouldReject ? 'zip' : 'drive');
  }
});

function pageLoadFixture(state) {
  const fixture = mountedRuntime({ state });
  const load = [], timers = [];
  let verifications = 0;
  fixture.context.document.readyState = 'loading';
  // The modal, and so the settings panel, does not exist until the student opens UM Spec.
  fixture.context.document.getElementById = () => null;
  fixture.context.addEventListener = (type, handler) => { if (type === 'load') load.push(handler); };
  fixture.context.setTimeout = handler => { timers.push(handler); return timers.length; };
  fixture.context.UmSpecExporter.getContext = () => ({ userId: '42', origin: 'https://spectrum.um.edu.my' });
  fixture.context.UmSpecExporter.verifyContext = async () => { verifications++; return { userId: '42', origin: 'https://spectrum.um.edu.my' }; };
  return { fixture, load, timers, get verifications() { return verifications; } };
}

test('opening a Spectrum page with nothing due fetches nothing extra', async () => {
  const page = pageLoadFixture({ configured: true, bindingHash: 'verified', account: { email: 'student@example.test', features: ['drive', 'calendar'] },
    settings: { mode: 'drive', courseIds: ['123'], autoSync: true, calendarEnabled: true, announcementScanning: true, reminderMinutes: [] },
    syncTimes: { drive: { lastAttemptAt: Date.now(), lastSuccessfulSyncAt: 1 }, calendar: { lastAttemptAt: Date.now() }, announcements: { lastAttemptAt: Date.now() } },
    candidates: [], events: [] });
  page.fixture.start();
  await new Promise(setImmediate);
  assert.equal(page.verifications, 0, 'the page just rendered proves the account; no extra /my/ request on every visit');
  assert.deepEqual(page.fixture.commands.map(command => command.type), ['SET_CONTEXT']);
  assert.equal(page.load.length, 0, 'nothing is queued for later');
});

test('a due background check waits until the page has finished loading', async () => {
  const page = pageLoadFixture({ configured: true, bindingHash: 'verified', account: { email: 'student@example.test', features: [] },
    settings: { mode: 'zip', courseIds: ['123'], autoSync: true, calendarEnabled: false, announcementScanning: true, reminderMinutes: [] },
    syncTimes: {}, candidates: [], events: [] });
  page.fixture.start();
  await new Promise(setImmediate);
  assert.equal(page.verifications, 0);
  assert.equal(page.load.length, 1, 'the check must wait for the page load event');
  page.load[0]();
  assert.equal(page.timers.length, 1, 'and a short delay after it');
  assert.equal(page.verifications, 0);
  page.timers[0]();
  await new Promise(setImmediate);
  assert.equal(page.verifications, 1, 'the real check verifies the session when it finally runs');
});

test('an unconnected Calendar does not trigger background work on every visit', async () => {
  const page = pageLoadFixture({ configured: true, bindingHash: 'verified', account: null,
    settings: { mode: 'zip', courseIds: ['123'], autoSync: true, calendarEnabled: true, announcementScanning: false, reminderMinutes: [] },
    syncTimes: {}, candidates: [], events: [] });
  page.fixture.start();
  await new Promise(setImmediate);
  assert.equal(page.load.length, 0);
  assert.equal(page.verifications, 0);
});

test('injected CSS never watches attributes from inside :has(), which froze Spectrum on every page load', () => {
  for (const file of ['content/content.css', 'content/student-sync.css']) {
    const css = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(css, /:has\([^{}]*\[/, file + ' must set a class from JS instead');
  }
});

test('the progress card toggles the class that replaces the :has() rule', () => {
  const source = fs.readFileSync('content/content.js', 'utf8');
  assert.match(source, /classList\.toggle\('umspec-progress-visible', visible\)/);
  assert.doesNotMatch(source, /umspec-progress-card'\)\.style\.display = '(?:block|none)'/, 'always show or hide it through setProgressCardVisible');
  assert.doesNotMatch(source, /progressCard\.style\.display/);
});
