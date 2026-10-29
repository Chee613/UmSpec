const test = require('node:test');
const assert = require('node:assert/strict');
let stored = {};
global.chrome = {
  runtime: { id: 'test', getURL: path => 'chrome-extension://test/' + path, getManifest: () => ({}) },
  storage: { local: {
    get: async key => ({ [key]: stored[key] }),
    set: async value => { Object.assign(stored, structuredClone(value)); },
    setAccessLevel: async () => {}
  } }
};
const sender = { id: 'test', url: 'https://spectrum.um.edu.my/my/', tab: { id: 1 } };

test('website messages cannot open consent or read another student state', async () => {
  const worker = require('../background/worker.js');
  const denied = await worker.handleMessage({ type: 'CONNECT_GOOGLE', feature: 'drive' }, sender);
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, 'FORBIDDEN');
  const status = await worker.handleMessage({ type: 'GET_STATUS' }, sender);
  assert.equal(status.data.account, null);
});

test('settings belong to the authenticated user; credentials never appear in status', async () => {
  const worker = require('../background/worker.js');
  await worker.handleMessage({ type: 'SET_CONTEXT', userId: '42' }, sender);
  const saved = await worker.handleMessage({
    type: 'SAVE_SETTINGS', settings: { courseIds: ['123'], archiveId: '2026 Semester 1', announcementScanning: true }
  }, sender);
  assert.equal(saved.ok, true);
  const first = await worker.handleMessage({ type: 'GET_STATUS' }, sender);
  assert.deepEqual(first.data.settings.courseIds, ['123']);
  assert.equal(first.data.configured, false);
  await worker.handleMessage({ type: 'SET_CONTEXT', userId: '43' }, sender);
  const second = await worker.handleMessage({ type: 'GET_STATUS' }, sender);
  assert.deepEqual(second.data.settings.courseIds, []);
  assert.equal(JSON.stringify(second).includes('access_token'), false);
});

test('malformed settings and off-site sources fail before a job is created', async () => {
  const worker = require('../background/worker.js');
  const result = await worker.handleMessage({
    type: 'SAVE_SETTINGS', settings: { courseIds: ['not-a-course'] }
  }, sender);
  assert.equal(result.ok, false);
  const job = await worker.handleMessage({
    type: 'BEGIN_DRIVE_SYNC', materials: [{ courseId: '123', sourceUrl: 'https://attacker.example/file' }]
  }, sender);
  assert.equal(job.ok, false);
  assert.equal(stored.umspecState.activeJob, null);
});

test('missing OAuth configuration is actionable and does not call Google', async () => {
  const google = require('../background/google.js');
  await assert.rejects(google.connectGoogle('drive', true), { code: 'CONFIG_REQUIRED' });
  await assert.rejects(google.googleFetch('https://attacker.example', {}, 'drive'), { code: 'FORBIDDEN' });
});
