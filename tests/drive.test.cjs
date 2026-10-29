const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../shared/sync-core.js');

test('resource revisions change fingerprints without changing source identity', async () => {
  const a = core.canonicalSource('https://spectrum.um.edu.my/pluginfile.php/12/mod_resource/content/3/notes.pdf?forcedownload=1&sesskey=secret');
  const b = core.canonicalSource('https://spectrum.um.edu.my/pluginfile.php/12/mod_resource/content/4/notes.pdf');
  assert.equal(a.identity, b.identity);
  assert.equal(a.revision, '3');
  assert.equal(b.revision, '4');
  assert.notEqual(core.canonicalSource('https://spectrum.um.edu.my/pluginfile.php/12/mod_folder/content/3/a.pdf').identity,
    core.canonicalSource('https://spectrum.um.edu.my/pluginfile.php/12/mod_folder/content/4/a.pdf').identity);
  assert.throws(() => core.canonicalSource('https://spectrum.um.edu.my.evil.test/file.pdf'));
  assert.throws(() => core.canonicalSource('http://spectrum.um.edu.my/file.pdf'));
  assert.notEqual(await core.hashParts(['origin', '123', '7', '/notes.pdf']), await core.hashParts(['origin', '123', '8', '/notes.pdf']));
  assert.equal(await core.hashBytes(new TextEncoder().encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('decisions preserve edits and trash and do not trust names or unknown baselines', () => {
  const source = { sourceFingerprint: null, contentSha256: null, name: 'new name' };
  const remote = { sourceFingerprint: null, contentSha256: 'old', md5Checksum: 'uploaded', uploadedMd5: 'uploaded' };
  assert.equal(core.decideFileAction(source, null), 'create');
  assert.equal(core.decideFileAction(source, { ...remote, trashed: true }), 'trashed');
  assert.equal(core.decideFileAction(source, { ...remote, md5Checksum: 'edit' }), 'conflict');
  assert.equal(core.decideFileAction(source, remote), 'download');
  assert.equal(core.decideFileAction({ ...source, contentSha256: 'new' }, remote), 'update');
  assert.equal(core.decideFileAction({ ...source, contentSha256: 'old' }, remote), 'skip');
  assert.equal(core.decideFileAction({ ...source, sourceFingerprint: 'rev:4' }, { ...remote, sourceFingerprint: 'rev:4' }), 'skip');
  assert.equal(core.decideFileAction({ ...source, contentSha256: 'new' }, { ...remote, uploadedMd5: null }), 'conflict');
  assert.equal(core.decideFileAction(source, { ...remote, uploadedMd5: null }), 'download');
});

test('automatic navigation respects consent, authentication and cooldown', () => {
  const settings = { mode: 'drive', autoSync: true };
  assert.equal(core.shouldAutoSync(settings, 900000, 899000, true), false);
  assert.equal(core.shouldAutoSync(settings, 1800000, 899000, true), true);
  assert.equal(core.shouldAutoSync(settings, 1800000, null, false), false);
  assert.equal(core.shouldAutoSync({ ...settings, mode: 'zip' }, 1800000, null, true), false);
  assert.deepEqual(core.summariseResults([{ action: 'created' }, { action: 'linked' }, { action: 'conflict' }, { action: 'trashed' }, { action: 'failed' }]),
    { created: 1, updated: 0, skipped: 0, linked: 1, failed: 1, conflicts: 2 });
});

const response = (body, status = 200, headers = {}) => new Response(body == null ? null : JSON.stringify(body), { status, headers });
function fakeDrive() {
  const files = new Map();
  const sessions = new Map();
  const writes = { creates: 0, uploads: 0, updates: 0 };
  let id = 0;
  let loseCreate = false;
  let loseUpload = false;
  global.UmSpecGoogle = { async googleFetch(path, options = {}, feature) {
    assert.equal(feature, 'drive');
    const url = new URL(path, 'https://www.googleapis.com');
    const method = options.method || 'GET';
    if (url.pathname.endsWith('/generateIds')) return response({ ids: ['id' + ++id] });
    if (url.pathname === '/drive/v3/files' && method === 'GET') {
      const q = url.searchParams.get('q');
      return response({ files: [...files.values()].filter(file => q.includes("mimeType =") ? file.mimeType === 'application/vnd.google-apps.folder' : file.appProperties?.sourceKey) });
    }
    if (url.pathname === '/drive/v3/files' && method === 'POST') {
      const data = JSON.parse(options.body);
      if (files.has(data.id)) return response({}, 409);
      files.set(data.id, data);
      writes.creates++;
      if (loseCreate) { loseCreate = false; throw new Error('lost create response'); }
      return response(data);
    }
    if (url.pathname.startsWith('/upload/drive/v3/files') && method !== 'PUT') {
      const existingId = url.pathname.split('/')[5];
      const data = JSON.parse(options.body);
      const fileId = existingId || data.id;
      if (existingId) writes.updates++;
      sessions.set('s' + fileId, { id: fileId, data, bytes: [], offset: 0, complete: false });
      return response(null, 200, { Location: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=s' + fileId });
    }
    if (method === 'PUT') {
      const session = sessions.get(url.searchParams.get('upload_id'));
      if (!session) return response({}, 404);
      if (options.headers['Content-Range'].startsWith('bytes */')) {
        return session.complete ? response(files.get(session.id)) : response(null, 308, session.offset ? { Range: 'bytes=0-' + (session.offset - 1) } : {});
      }
      writes.uploads++;
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(options.headers['Content-Range']);
      assert.equal(Number(range[1]), session.offset);
      session.bytes.push(new Uint8Array(options.body));
      session.offset = Number(range[2]) + 1;
      if (session.offset < Number(range[3])) return response(null, 308, { Range: 'bytes=0-' + (session.offset - 1) });
      const bytes = Buffer.concat(session.bytes);
      const crypto = require('node:crypto');
      const file = { ...files.get(session.id), ...session.data, id: session.id,
        md5Checksum: crypto.createHash('md5').update(bytes).digest('hex'), sha256Checksum: crypto.createHash('sha256').update(bytes).digest('hex') };
      files.set(session.id, file);
      session.complete = true;
      if (loseUpload) { loseUpload = false; throw new Error('lost upload response'); }
      return response(file);
    }
    const fileId = url.pathname.split('/').pop();
    const file = files.get(fileId);
    if (method === 'GET') return file ? response(file) : response({}, 404);
    if (method === 'PATCH') {
      if (!file) return response({}, 404);
      const data = JSON.parse(options.body);
      files.set(fileId, { ...file, ...data, appProperties: { ...file.appProperties, ...data.appProperties } });
      return response(files.get(fileId));
    }
    throw new Error('Unexpected Google request: ' + method + ' ' + path);
  } };
  let bytes = new TextEncoder().encode('source bytes');
  global.fetch = async (url, options) => {
    assert.equal(new URL(url).origin, 'https://spectrum.um.edu.my');
    assert.equal(options.credentials, 'include');
    assert.equal(options.redirect, 'error');
    const res = new Response(bytes, { headers: { 'Content-Type': 'application/pdf' } });
    Object.defineProperty(res, 'url', { value: url });
    return res;
  };
  return { files, writes, setBytes(value) { bytes = value; }, loseCreate() { loseCreate = true; }, loseUpload() { loseUpload = true; } };
}
const binding = { hash: 'binding', spectrumUserId: '42', googleSub: 'sub', settings: { archiveId: '2026-1', courseIds: ['123'], videoPolicy: 'links' } };
const material = { sourceKey: 'source', courseId: '123', moduleId: '7', sourceUrl: 'https://spectrum.um.edu.my/pluginfile.php/12/mod_resource/content/1/notes.pdf', name: 'notes.pdf', category: 'Notes', archiveId: '2026-1', kind: 'binary', sourceFingerprint: null, contentSha256: null, sizeBytes: null };
function freshJob(id = 'job') { return { id, bindingHash: 'binding', binding: structuredClone(binding), materials: [structuredClone(material)] }; }
function loadDrive() { delete require.cache[require.resolve('../background/drive.js')]; return require('../background/drive.js'); }
async function complete(drive, job) {
  for (let i = 0; i < 80 && !job.done; i++) job = JSON.parse(JSON.stringify(await drive.runDriveStep(job)));
  assert.equal(job.done, true, 'job should complete within bounded steps');
  return job;
}

test('resume advances only to valid acknowledged bytes', () => {
  const drive = loadDrive();
  assert.equal(drive.acknowledgedOffset('bytes=0-1048575'), 1048576);
  assert.equal(drive.acknowledgedOffset(null), 0);
  assert.throws(() => drive.acknowledgedOffset('bytes=2-5'));
  assert.throws(() => drive.acknowledgedOffset('bytes=0-9007199254740992'));
});

test('identical sync does not create or upload, changed content retains ID and student name', async () => {
  const fake = fakeDrive();
  const drive = loadDrive();
  const first = await complete(drive, freshJob());
  assert.equal(first.results[0].action, 'created');
  const file = [...fake.files.values()].find(file => file.appProperties?.sourceKey);
  assert.equal(file.appProperties.uploadedMd5, file.md5Checksum);
  file.name = 'Student renamed.pdf';
  const previous = { ...fake.writes };
  const second = await complete(drive, freshJob('second'));
  assert.equal(second.results[0].action, 'skipped');
  assert.deepEqual(fake.writes, previous);
  fake.setBytes(new TextEncoder().encode('new source bytes'));
  const third = await complete(drive, freshJob('third'));
  assert.equal(third.results[0].action, 'updated');
  assert.equal(fake.files.get(file.id).name, 'Student renamed.pdf');
  assert.equal([...fake.files.values()].filter(file => file.appProperties?.sourceKey).length, 1);
});

test('include video policy uploads the selected video as a binary file', async () => {
  const fake = fakeDrive(), drive = loadDrive(), job = freshJob('video-include');
  job.binding.settings.videoPolicy = 'include';
  job.materials[0] = { ...job.materials[0], name: 'lecture.mp4', sourceUrl: 'https://spectrum.um.edu.my/pluginfile.php/12/mod_resource/content/1/lecture.mp4' };
  const result = await complete(drive, job);
  assert.equal(result.results[0].action, 'created');
  assert.ok([...fake.files.values()].some(file => file.name === 'lecture.mp4' && file.md5Checksum));
  assert.equal([...fake.files.values()].some(file => file.name === 'Spectrum links.md'), false);
});

test('video classification covers recording metadata without matching ordinary lecture notes or deceptive hosts', () => {
  for (const item of [
    { name: 'capture.AVI' }, { sourceUrl: 'https://spectrum.um.edu.my/file?id=4', name: 'audio.m4a' },
    { mimeType: 'video/webm' }, { contentType: 'audio/ogg' }, { isVideo: true },
    { category: '7.Recordings & Media' }, { name: 'Lecture recording' },
    { url: 'https://university.panopto.eu/Panopto/Pages/Viewer.aspx?id=4' }, { url: 'https://www.youtube.com/watch?v=4' },
    { url: 'https://vimeo.com/123' }, { url: 'https://zoom.us/rec/play/123' }
  ]) assert.equal(core.isVideoMaterial(item), true, JSON.stringify(item));
  for (const item of [{ name: 'Lecture notes.pdf' }, { name: 'Video Processing Notes.pdf' },
    { url: 'https://youtube.com.evil.test/file.pdf' }, { name: 'Spectrum links.md', kind: 'generated' }
  ]) assert.equal(core.isVideoMaterial(item), false, JSON.stringify(item));
});

test('default Drive video policy writes links before fetching AVI, named videos or recording categories', async () => {
  for (const fields of [
    { name: 'lecture.avi', sourceUrl: 'https://spectrum.um.edu.my/pluginfile.php/12/mod_resource/content/1/lecture.avi' },
    { name: 'lecture.m4v', sourceUrl: 'https://spectrum.um.edu.my/pluginfile.php/12/mod_resource/content/1/file' },
    { name: 'Session 1', category: '7.Recordings & Media' }
  ]) {
    const fake = fakeDrive(), drive = loadDrive(), job = freshJob();
    delete job.binding.settings.videoPolicy;
    job.materials[0] = { ...job.materials[0], ...fields };
    global.fetch = async () => { throw new Error('A link-only recording must not be fetched'); };
    const result = await complete(drive, job);
    assert.equal(result.results[0].action, 'linked');
    assert.equal([...fake.files.values()].some(file => file.name === fields.name), false);
    assert.ok([...fake.files.values()].some(file => file.name === 'Spectrum links.md'));
  }
});

test('a video Content-Type cancels the body and links an otherwise unknown file by default', async () => {
  const fake = fakeDrive(), drive = loadDrive();
  let cancelled = false;
  global.fetch = async url => {
    const response = new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'video/mp4' } });
    Object.defineProperty(response, 'url', { value: url });
    const cancel = response.body.cancel.bind(response.body);
    response.body.cancel = async () => { cancelled = true; return cancel(); };
    return response;
  };
  const result = await complete(drive, freshJob());
  assert.equal(result.results[0].action, 'linked');
  assert.equal(cancelled, true);
  assert.equal([...fake.files.values()].some(file => file.name === 'notes.pdf'), false);
});

test('an explicitly enabled video download resumes its saved byte session without losing its ID', async () => {
  const fake = fakeDrive();
  fake.setBytes(new Uint8Array(1024 * 1024 + 5).fill(7));
  const fetchSource = global.fetch;
  global.fetch = async (...args) => {
    const response = await fetchSource(...args);
    response.headers.set('Content-Type', 'video/mp4');
    return response;
  };
  let drive = loadDrive(), job = freshJob('video-resume');
  job.binding.settings.videoPolicy = 'include';
  job.materials[0] = { ...job.materials[0], name: 'recording.mp4', mimeType: 'video/mp4' };
  while (!job.upload?.offset) job = await drive.runDriveStep(job);
  const fileId = job.upload.fileId;
  assert.equal(job.upload.offset, 1024 * 1024);
  drive = loadDrive();
  job = await complete(drive, JSON.parse(JSON.stringify(job)));
  assert.equal(job.results[0].action, 'created');
  assert.equal(job.binding.settings.videoPolicy, 'include');
  assert.equal([...fake.files.values()].find(file => file.name === 'recording.mp4').id, fileId);
  assert.equal(fake.writes.uploads, 2);
});

test('lost folder create response reconciles persisted ID and interrupted chunks resume', async () => {
  const fake = fakeDrive();
  let drive = loadDrive();
  let job = freshJob();
  while (!job.folderIntent) job = await drive.runDriveStep(job);
  const reserved = job.folderIntent.id;
  fake.loseCreate();
  await assert.rejects(drive.runDriveStep(structuredClone(job)), /lost create response/);
  job = await drive.runDriveStep(job);
  assert.equal(job.folders.root, reserved);
  fake.setBytes(new Uint8Array(1024 * 1024 + 5).fill(7));
  while (!job.upload?.offset) job = await drive.runDriveStep(job);
  assert.equal(job.upload.offset, 1024 * 1024);
  drive = loadDrive();
  job = await complete(drive, JSON.parse(JSON.stringify(job)));
  assert.equal(job.results[0].action, 'created');
  assert.equal(fake.writes.uploads, 2);
});

test('trashed and student-edited files are retained without upload', async () => {
  const fake = fakeDrive();
  const drive = loadDrive();
  await complete(drive, freshJob());
  const file = [...fake.files.values()].find(file => file.appProperties?.sourceKey);
  file.md5Checksum = 'student edit';
  const count = fake.writes.uploads;
  assert.equal((await complete(drive, freshJob('conflict'))).results[0].action, 'conflict');
  file.trashed = true;
  assert.equal((await complete(drive, freshJob('trash'))).results[0].action, 'trashed');
  assert.equal(fake.writes.uploads, count);
});

test('login HTML becomes failure and oversized files produce a usable link index', async () => {
  const fake = fakeDrive();
  let drive = loadDrive();
  global.fetch = async url => {
    const res = new Response('<html><form action="/login/index.php">login</form></html>', { headers: { 'Content-Type': 'text/html' } });
    Object.defineProperty(res, 'url', { value: url });
    return res;
  };
  const failed = await complete(drive, freshJob());
  assert.equal(failed.results[0].action, 'failed');
  drive = loadDrive();
  const job = freshJob('large');
  job.materials[0].sizeBytes = 51 * 1024 * 1024;
  const linked = await complete(drive, job);
  assert.equal(linked.results.some(result => result.action === 'linked'), true);
  const index = [...fake.files.values()].find(file => file.name === 'Spectrum links.md');
  assert.ok(index);
  assert.equal(index.appProperties.uploadedMd5, index.md5Checksum);
});

test('an interrupted replacement does not publish its new revision before bytes succeed', async () => {
  const fake = fakeDrive();
  const drive = loadDrive();
  const first = freshJob();
  first.materials[0].sourceFingerprint = 'revision:1';
  await complete(drive, first);
  fake.setBytes(new TextEncoder().encode('revised source'));
  let replacement = freshJob('replacement');
  replacement.materials[0].sourceFingerprint = 'revision:2';
  while (!replacement.upload?.url) replacement = await drive.runDriveStep(replacement);
  const file = [...fake.files.values()].find(file => file.appProperties?.sourceKey);
  assert.equal(file.appProperties.sourceFingerprint, 'revision:1');
  const next = freshJob('next');
  next.materials[0].sourceFingerprint = 'revision:2';
  assert.equal((await complete(drive, next)).results[0].action, 'updated');
});

test('student edits after upload completion block finalization and are not adopted', async () => {
  const fake = fakeDrive();
  const drive = loadDrive();
  let job = freshJob();
  while (job.upload?.phase !== 'finalize-write') job = await drive.runDriveStep(job);
  const file = [...fake.files.values()].find(file => file.appProperties?.sourceKey);
  file.md5Checksum = 'student edited before metadata commit';
  job = await complete(drive, job);
  assert.equal(job.results[0].action, 'conflict');
  assert.notEqual(file.appProperties.uploadedMd5, file.md5Checksum);
});

test('reserved binary placeholders carry intent without claiming uploaded content', async () => {
  const fake = fakeDrive();
  const drive = loadDrive();
  let job = freshJob();
  job.materials[0].sourceFingerprint = 'revision:3';
  while (job.upload?.phase !== 'verify') job = await drive.runDriveStep(job);
  const file = [...fake.files.values()].find(file => file.appProperties?.sourceKey);
  assert.equal(file.appProperties.contentSha256, undefined);
  assert.equal(file.appProperties.sourceFingerprint, undefined);
  assert.equal(file.appProperties.pendingSha256, job.upload.hash);
});

test('lost binary create and completed upload responses reuse the persisted file ID', async () => {
  const fake = fakeDrive();
  let drive = loadDrive();
  let job = freshJob();
  while (job.upload?.phase !== 'create') job = await drive.runDriveStep(job);
  const fileId = job.upload.fileId;
  fake.loseCreate();
  await assert.rejects(drive.runDriveStep(job), /lost create response/);
  job = await drive.runDriveStep(job);
  while (job.upload?.phase !== 'chunk') job = await drive.runDriveStep(job);
  fake.loseUpload();
  await assert.rejects(drive.runDriveStep(job), /lost upload response/);
  drive = loadDrive();
  job = await complete(drive, JSON.parse(JSON.stringify(job)));
  assert.equal(job.results[0].action, 'created');
  assert.equal([...fake.files.values()].find(file => file.appProperties?.sourceKey).id, fileId);
  assert.equal(fake.writes.uploads, 1);
});

test('managed discovery completes pagination and keeps trashed source mappings', async () => {
  const drive = loadDrive();
  const paths = [];
  global.UmSpecGoogle = { async googleFetch(path) {
    paths.push(path);
    const url = new URL(path, 'https://www.googleapis.com');
    const q = url.searchParams.get('q');
    assert.match(q, /bindingHash/);
    assert.match(q, /archiveId/);
    assert.doesNotMatch(q, /trashed\s*=\s*false/);
    return url.searchParams.get('pageToken') === 'page2' ? response({ files: [{ id: 'b', trashed: true, appProperties: { sourceKey: 'two', uploadedMd5: 'md5' } }] }) :
      response({ files: [{ id: 'a', appProperties: { sourceKey: 'one' } }], nextPageToken: 'page2' });
  } };
  const files = await drive.findManagedFiles('binding', 'archive');
  assert.deepEqual(files.map(file => [file.id, file.sourceKey, file.trashed || false]), [['a', 'one', false], ['b', 'two', true]]);
  assert.equal(paths.length, 2);
});

test('a persisted upload session cannot redirect Google credentials to another origin', async () => {
  fakeDrive();
  const drive = loadDrive();
  let job = freshJob();
  while (job.upload?.phase !== 'chunk') job = await drive.runDriveStep(job);
  job.upload.url = 'https://www.googleapis.com.evil.test/upload/drive/v3/files?upload_id=secret';
  await assert.rejects(drive.runDriveStep(job), { code: 'INVALID_UPLOAD_URL' });
});

test('a student edit between verification and upload start prevents replacement', async () => {
  const fake = fakeDrive();
  const drive = loadDrive();
  await complete(drive, freshJob());
  fake.setBytes(new TextEncoder().encode('changed source'));
  let job = freshJob('replacement');
  while (job.upload?.phase !== 'start') job = await drive.runDriveStep(job);
  const file = [...fake.files.values()].find(file => file.appProperties?.sourceKey);
  file.md5Checksum = 'student edit';
  const uploads = fake.writes.uploads;
  job = await complete(drive, job);
  assert.equal(job.results[0].action, 'conflict');
  assert.equal(fake.writes.uploads, uploads);
});

test('course folders retain the existing exporter folder name and expose the managed root', async () => {
  const fake = fakeDrive();
  const drive = loadDrive();
  const job = freshJob();
  job.materials[0].courseFolder = 'WIX1001 - Computing';
  const result = await complete(drive, job);
  assert.ok([...fake.files.values()].some(file => file.mimeType === 'application/vnd.google-apps.folder' && file.name === 'WIX1001 - Computing'));
  assert.equal(result.binding.driveRootId, result.folders.root);
  const reused = await complete(drive, freshJob('reused'));
  assert.equal(reused.binding.driveRootId, result.folders.root);
});
