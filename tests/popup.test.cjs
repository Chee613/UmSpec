const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const popupDirectory = path.join(__dirname, '..', 'popup');
const defaultStatus = () => ({ configured: true, bindingHash: 'binding', account: { email: 'student@example.com', features: ['drive', 'calendar'] },
  settings: { mode: 'zip', archiveId: '2026-1', autoSync: false, calendarEnabled: false, announcementScanning: false, reminderMinutes: [1440, 60], videoPolicy: 'links' }, syncTimes: {} });

function popup(status = defaultStatus(), overrides = {}) {
  const elements = [], byId = new Map(), listeners = new Map(), messages = [], tabMessages = [];
  const attributes = text => Object.fromEntries([...text.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(match => [match[1], match[2] ?? '']));
  for (const match of fs.readFileSync(path.join(popupDirectory, 'popup.html'), 'utf8').matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)) {
    const attrs = attributes(match[2]), handlers = {};
    const element = { id: attrs.id, tagName: match[1].toUpperCase(), value: attrs.value || '', textContent: '',
      disabled: Object.hasOwn(attrs, 'disabled'), checked: Object.hasOwn(attrs, 'checked'), hidden: Object.hasOwn(attrs, 'hidden'),
      tabIndex: Number(attrs.tabindex || 0), attributes: attrs, classList: { toggle() {}, add() {}, remove() {} },
      getAttribute: name => attrs[name] ?? null, setAttribute(name, value) { attrs[name] = String(value); },
      addEventListener(type, handler) { (handlers[type] ||= []).push(handler); },
      async emit(type, extra = {}) { for (const handler of handlers[type] || []) await handler({ target: element, preventDefault() {}, ...extra }); },
      focus() { document.activeElement = element; } };
    elements.push(element); if (attrs.id) byId.set(attrs.id, element);
  }
  const document = { activeElement: null, getElementById: id => byId.get(id) || null,
    addEventListener: (type, handler) => listeners.set(type, handler),
    querySelectorAll(selector) {
      const match = selector.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
      if (!match) throw new Error('Unsupported test selector: ' + selector);
      return elements.filter(element => Object.hasOwn(element.attributes, match[1]) && (match[2] === undefined || element.attributes[match[1]] === match[2]));
    } };
  let savedStatus = status;
  const chrome = { tabs: { query: async () => [{ id: 7, url: 'https://spectrum.um.edu.my/my/' }], sendMessage: async (tabId, message) => {
    tabMessages.push(message);
    return overrides.tabMessage ? overrides.tabMessage(tabId, message) : { ok: true };
  }, create: async () => {} },
    scripting: { executeScript: async () => {} }, permissions: { request: async () => true },
    runtime: { getURL: value => 'chrome-extension://extension/' + value,
      sendMessage: async message => {
        messages.push(message);
        if (overrides.sendMessage) return overrides.sendMessage(message, savedStatus);
        if (message.type === 'SAVE_SETTINGS') savedStatus = { ...savedStatus, settings: { ...savedStatus.settings, ...message.settings } };
        return { ok: true, data: savedStatus };
      } } };
  const context = { document, chrome, URL, console, window: { close() {} } };
  vm.runInNewContext(fs.readFileSync(path.join(popupDirectory, 'popup.js'), 'utf8'), context);
  return { document, messages, tabMessages, chrome, el: id => byId.get(id), start: () => listeners.get('DOMContentLoaded')() };
}

test('video links default stays authoritative and the settings checkbox saves inclusion', async () => {
  const page = popup();
  await page.start();
  assert.ok(page.el('download-videos'), 'Files settings must expose the existing video option');
  assert.equal(page.el('download-videos').checked, false);
  page.el('download-videos').checked = true;
  await page.el('download-videos').emit('change');
  const save = page.messages.find(message => message.type === 'SAVE_SETTINGS');
  assert.equal(save.settings.videoPolicy, 'include');
  assert.equal(page.el('download-videos').checked, true);
});

test('settings stay disabled while loading and a rejected save restores worker values', async () => {
  let completeInitial;
  let initial = true;
  const status = defaultStatus();
  const page = popup(status, { sendMessage: async message => {
    if (initial) { initial = false; return new Promise(resolve => { completeInitial = () => resolve({ ok: true, data: status }); }); }
    return message.type === 'SAVE_SETTINGS' ? { ok: false, error: { code: 'UPLOAD_IN_PROGRESS', message: 'Finish the current upload before changing its archive.' } } : { ok: true, data: status };
  } });
  const started = page.start();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(page.el('archive-name').disabled);
  assert.ok(page.el('download-videos'), 'Video setting is a loaded worker preference');
  assert.ok(page.el('download-videos').disabled);
  completeInitial(); await started;
  page.el('archive-name').value = 'new-unsaved-archive';
  await page.el('archive-name').emit('change');
  assert.equal(page.el('archive-name').value, '2026-1');
  assert.match(page.el('sync-status').textContent, /Finish the current upload/);
  assert.equal(page.el('archive-name').disabled, false);
});

test('accessible tabs support keyboard selection without exposing multiple settings panels', async () => {
  const page = popup(); await page.start();
  assert.ok(page.el('tab-home'));
  await page.el('tab-home').emit('keydown', { key: 'ArrowRight' });
  assert.equal(page.el('tab-settings').getAttribute('aria-selected'), 'true');
  assert.equal(page.el('panel-home').hidden, true);
  assert.equal(page.el('panel-settings').hidden, false);
  await page.el('tab-files').emit('keydown', { key: 'End' });
  assert.equal(page.el('tab-account').getAttribute('aria-selected'), 'true');
  assert.equal(page.el('panel-files').hidden, true);
  assert.equal(page.el('panel-calendar').hidden, true);
  assert.equal(page.el('panel-account').hidden, false);
});

test('Google permission denial never starts consent or changes saved destination', async () => {
  const page = popup({ ...defaultStatus(), account: null }); await page.start();
  page.chrome.permissions.request = async () => false;
  await page.el('connect-drive').emit('click');
  assert.equal(page.messages.some(message => message.type === 'CONNECT_GOOGLE'), false);
  assert.match(page.el('sync-status').textContent, /not granted/);
  assert.equal(page.el('destination-zip').checked, true);
});

test('unavailable status after a rejected edit disables settings until state can be reloaded', async () => {
  let reads = 0;
  const page = popup(defaultStatus(), { sendMessage: async message => {
    if (message.type === 'GET_STATUS' && reads++ === 0) return { ok: true, data: defaultStatus() };
    return { ok: false, error: { message: 'Extension state is temporarily unavailable.' } };
  } });
  await page.start();
  page.el('download-videos').checked = true;
  await page.el('download-videos').emit('change');
  assert.equal(page.el('download-videos').disabled, true);
  assert.equal(page.el('archive-name').disabled, true);
  assert.equal(page.el('action-btn').disabled, false);
});

test('Sync now is offered only after courses have been chosen', async () => {
  const status = defaultStatus();
  status.settings.mode = 'drive';
  status.settings.courseIds = [];
  const page = popup(status); await page.start();
  assert.equal(page.el('sync-now').hidden, true);
  assert.equal(page.el('action-label').textContent, 'Open courses');
});

test('popup waits for authoritative content context before reading its first worker settings', async () => {
  let contextReady = false;
  const ready = defaultStatus();
  const page = popup(ready, {
    tabMessage: async (_id, message) => { if (message.type === 'UMSPEC_REFRESH_STATUS') contextReady = true; return { ok: true }; },
    sendMessage: async () => ({ ok: true, data: contextReady ? ready : { ...ready, bindingHash: null, account: null } })
  });
  await page.start();
  assert.equal(page.el('download-videos').disabled, false, 'the same popup should unlock after verified context registration');
  assert.equal(page.tabMessages[0].type, 'UMSPEC_REFRESH_STATUS');
});

test('failed content verification keeps old worker bindings locked and shows the real error', async () => {
  const page = popup(defaultStatus(), { tabMessage: async () => ({ ok: false, error: { code: 'LOGIN_REQUIRED', message: 'Spectrum account changed. Refresh this page.' } }) });
  await page.start();
  assert.equal(page.el('download-videos').disabled, true);
  assert.equal(page.el('connect-drive').disabled, true);
  assert.equal(page.el('disconnect-google').disabled, true);
  assert.equal(page.el('action-btn').disabled, false);
  assert.match(page.el('sync-status').textContent, /Spectrum account changed/);
  assert.equal(page.messages.some(message => message.type === 'GET_STATUS'), false);
});

test('a missing content receiver gives an actionable refresh message without blocking Open courses', async () => {
  const page = popup(defaultStatus(), { tabMessage: async () => { throw new Error('Could not establish connection. Receiving end does not exist.'); } });
  await page.start();
  assert.match(page.el('sync-status').textContent, /Refresh Spectrum/);
  assert.equal(page.el('action-btn').disabled, false);
  assert.equal(page.el('download-videos').disabled, true);
});

test('post-save context errors preserve the actual saved preference while locking further edits', async () => {
  let refreshes = 0;
  const page = popup(defaultStatus(), { tabMessage: async () => ++refreshes === 1 ? { ok: true } :
    { ok: false, error: { code: 'LOGIN_REQUIRED', message: 'Sign in to Spectrum again.' } } });
  await page.start();
  page.el('download-videos').checked = true;
  await page.el('download-videos').emit('change');
  assert.equal(page.el('download-videos').checked, true);
  assert.equal(page.el('download-videos').disabled, true);
  assert.match(page.el('sync-status').textContent, /Sign in to Spectrum again/);
});

test('Open courses stays usable while authoritative settings are still loading', async () => {
  let completeStatus, opened = 0;
  const page = popup(defaultStatus(), { sendMessage: async () => new Promise(resolve => {
    completeStatus = () => resolve({ ok: true, data: defaultStatus() });
  }) });
  page.chrome.scripting.executeScript = async options => { assert.equal(options.target.tabId, 7); opened++; };
  const started = page.start();
  await new Promise(resolve => setImmediate(resolve));
  try {
    assert.equal(page.el('download-videos').disabled, true);
    assert.equal(page.el('action-btn').disabled, false);
    await page.el('action-btn').emit('click');
    assert.equal(opened, 1);
  } finally { completeStatus(); await started; }
});
