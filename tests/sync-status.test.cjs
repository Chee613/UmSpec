const test = require('node:test');
const assert = require('node:assert/strict');
require('../shared/sync-core.js');

test('the planner page reads a running Drive sync and Calendar state for the account last used on Spectrum', async t => {
  const previous = global.chrome;
  t.after(() => { global.chrome = previous; });
  const now = Date.now();
  const store = { umspecState: {
    lastTabId: 7, contexts: { 7: { bindingHash: 'b1' } },
    bindings: {
      b1: { hash: 'b1', googleEmail: 'student@example.com', features: ['drive', 'calendar'], driveRootId: 'root1', calendarId: 'cal1',
        settings: { mode: 'drive', autoSync: true, calendarEnabled: true, archiveId: '2026-2027 Sem 1' },
        syncTimes: { drive: { lastSuccessfulSyncAt: now - 3600000 }, calendar: { lastSuccessfulSyncAt: now - 60000 } }, events: { a: {}, b: {} } },
      b2: { hash: 'b2', features: [], settings: {} }
    },
    activeJob: { bindingHash: 'b1', status: 'running', done: false, background: true, cursor: 12, materials: new Array(30).fill({}),
      results: [{ action: 'created' }, { action: 'linked' }, { action: 'failed', name: 'Notes' }] },
    calendarJob: null, savedJobs: { drive: {}, calendar: {} }
  } };
  global.chrome = {
    runtime: { id: 'ext', getURL: path => 'chrome-extension://ext/' + (path || '') },
    storage: { local: { get: async keys => Object.fromEntries([].concat(keys).map(k => [k, structuredClone(store[k])])), set: async () => {} } },
    action: {}, alarms: { clearAll: async () => {}, create: () => {} }
  };
  delete require.cache[require.resolve('../background/planner.js')];
  const planner = require('../background/planner.js');
  const page = { id: 'ext', url: 'chrome-extension://ext/dashboard/dashboard.html' };
  const status = await planner.handle({ type: 'PLANNER_SYNC_STATUS' }, page);
  assert.equal(status.account, 'student@example.com');
  assert.deepEqual([status.drive.running, status.drive.background, status.drive.cursor, status.drive.total, status.drive.attention], [true, true, 12, 30, 1]);
  assert.equal(status.drive.folderId, 'root1');
  assert.deepEqual([status.calendar.connected, status.calendar.running, status.calendar.dates], [true, false, 2]);
  await assert.rejects(planner.handle({ type: 'PLANNER_SYNC_STATUS' }, { id: 'ext', url: 'https://spectrum.um.edu.my/my/', tab: { id: 7 } }), 'only extension pages may read it');
  store.umspecState = undefined;
  assert.deepEqual(await planner.handle({ type: 'PLANNER_SYNC_STATUS' }, page), { account: null });
});
