const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function dashboard(initial, spectrumTab = null) {
  const directory = path.join(__dirname, '..', 'options');
  const elements = [], byId = new Map(), listeners = new Map(), messages = [], actions = [];
  let status = initial;
  const element = (attributes = {}) => {
    const handlers = {}, classes = new Set((attributes.class || '').split(' '));
    return { attributes, id: attributes.id, dataset: { view: attributes['data-view'] }, value: '', checked: false,
      hidden: Object.hasOwn(attributes, 'hidden'), disabled: Object.hasOwn(attributes, 'disabled'), textContent: '', firstChild: { textContent: '' }, children: [],
      classList: { toggle(name, on) { on ? classes.add(name) : classes.delete(name); } },
      setAttribute(name, value) { attributes[name] = String(value); },
      addEventListener(type, handler) { (handlers[type] ||= []).push(handler); },
      async emit(type, extra = {}) { for (const handler of handlers[type] || []) await handler({ preventDefault() {}, ...extra }); },
      replaceChildren(...children) { this.children = children; }, append(...children) { this.children.push(...children); }, focus() {} };
  };
  for (const match of fs.readFileSync(path.join(directory, 'options.html'), 'utf8').matchAll(/<[a-z][\w-]*\b([^>]*)>/gi)) {
    const attrs = Object.fromEntries([...match[1].matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(value => [value[1], value[2] ?? '']));
    const node = element(attrs); elements.push(node); if (attrs.id) byId.set(attrs.id, node);
  }
  const document = { getElementById: id => byId.get(id), createElement: () => element(),
    addEventListener: (name, handler) => listeners.set(name, handler),
    querySelectorAll: selector => elements.filter(node => selector === '.view-panel' ? node.attributes.class?.split(' ').includes('view-panel') : Boolean(node.dataset.view)) };
  const chrome = { tabs: { query: async () => spectrumTab ? [spectrumTab] : [],
    create: async value => { actions.push({ create: value }); }, update: async (id, value) => { actions.push({ activate: id, ...value }); } },
    scripting: { executeScript: async value => { actions.push({ exporter: value.target.tabId }); } },
    storage: { local: { get: async () => ({}), set: async () => {} } },
    permissions: { request: async () => true }, runtime: { sendMessage: async message => {
      messages.push(message);
      if (message.type === 'SAVE_SETTINGS') status = { ...status, settings: { ...status.settings, ...message.settings } };
      return { ok: true, data: status };
    } } };
  vm.runInNewContext(fs.readFileSync(path.join(directory, 'options.js'), 'utf8'), {
    document, chrome, window: { location: { hash: '' } }, localStorage: { getItem() {}, setItem() {} }, setTimeout: () => 0, clearTimeout() {}, console
  });
  return { el: id => byId.get(id), messages, actions, start: () => listeners.get('DOMContentLoaded')(), setStatus: value => { status = value; } };
}

test('dashboard distinguishes connected services from successful sync and renders only real activity', async () => {
  const status = { bindingHash: 'default_student_binding', account: { email: 'student@example.com', features: ['drive', 'calendar'] },
    settings: { courseIds: ['123', '456'], archiveId: '2026 Semester 1', mode: 'drive', videoPolicy: 'links', reminderMinutes: [60] }, syncTimes: {}, recentChanges: [] };
  const page = dashboard(status); await page.start();
  assert.equal(page.el('ov-drive-val').textContent, 'Connected');
  assert.equal(page.el('ov-calendar-val').textContent, 'Connected');
  assert.equal(page.el('ov-drive-sync').textContent, 'No successful sync recorded.');
  assert.equal(page.el('ov-calendar-sync').textContent, 'No successful sync recorded.');
  assert.equal(page.el('text-spectrum').textContent, 'Spectrum tab not open', 'A saved binding does not prove an active Spectrum session');
  assert.equal(page.el('ov-courses-val').textContent, '2 selected');
  assert.equal(page.el('ov-archive').textContent, '2026 Semester 1');
  assert.equal(page.el('btn-quick-drive').disabled, false);
  await page.el('btn-quick-drive').emit('click');
  assert.equal(page.el('view-drive').hidden, false);
  assert.equal(page.messages.some(message => message.type === 'CONNECT_GOOGLE'), false, 'Settings navigation must not trigger OAuth');
  page.setStatus({ ...status, syncTimes: { drive: { lastSuccessfulSyncAt: 1793286000000 } } });
  await page.el('btn-refresh-status').emit('click');
  assert.equal(page.el('ov-job-summary').textContent, 'No sync summary available.', 'A recorded successful sync must not be described as absent');
  page.setStatus({ ...status, syncTimes: { drive: { lastSuccessfulSyncAt: 1793286000000 } },
    job: { status: 'complete', summary: { created: 3, updated: 1, skipped: 2, failed: 0, conflicts: 1 } },
    recentChanges: [{ name: '<img src=x onerror=alert(1)>', action: 'create', at: 1793286000000 }] });
  await page.el('btn-refresh-status').emit('click');
  assert.match(page.el('ov-drive-sync').textContent, /^Last successful sync/);
  assert.equal(page.el('ov-calendar-sync').textContent, 'No successful sync recorded.');
  assert.match(page.el('ov-job-summary').textContent, /3 new, 1 updated, 2 unchanged/);
  const row = page.el('recent-changes').children[0];
  assert.equal(row.children[0].children[0].textContent, '<img src=x onerror=alert(1)>');
  assert.equal(row.children[0].children[1].textContent, 'Added');
  page.el('input-archive-name').value = 'Next semester';
  await page.el('btn-save-drive-settings').emit('click');
  assert.equal(page.messages.find(message => message.type === 'SAVE_SETTINGS').settings.archiveId, 'Next semester');
});

test('workspace action opens the exporter in the Spectrum tab or opens Spectrum when absent', async () => {
  const status = { settings: { courseIds: [], reminderMinutes: [] } };
  const existing = dashboard(status, { id: 77, url: 'https://spectrum.um.edu.my/my/' });
  await existing.start(); await existing.el('btn-quick-spectrum').emit('click');
  assert.deepEqual(existing.actions, [{ activate: 77, active: true }, { exporter: 77 }]);
  assert.equal(existing.el('btn-quick-spectrum').disabled, false);
  const missing = dashboard(status);
  await missing.start(); await missing.el('btn-quick-spectrum').emit('click');
  assert.equal(missing.actions.length, 1);
  assert.equal(missing.actions[0].create.url, 'https://spectrum.um.edu.my/my/');
  assert.equal(missing.el('btn-quick-spectrum').disabled, false);
});
