const test = require('node:test');
const assert = require('node:assert/strict');
const drive = require('../background/drive.js');

// Shapes follow the live UM Spec folder (Nov 2026): the same course image uploaded again by earlier versions.
const FOLDER = 'application/vnd.google-apps.folder';
const file = (id, fields = {}) => ({ id, name: 'WIA2003-Course-Map.png', mimeType: 'image/png', parents: ['cat-ps'], md5Checksum: 'md5-map', size: '551398',
  createdTime: '2026-11-21T07:14:08Z', trashed: false, appProperties: { bindingHash: 'B', archiveId: 'Sem 1', sourceKey: 'key-' + id }, ...fields });
const options = { bindingHash: 'B', archiveId: 'Sem 1', keepKeys: new Set(['key-current']), keepFolderIds: ['root', 'archive', 'cat-ps'] };

test('only extra copies are trashed; the file the latest sync uses always stays', () => {
  const files = [
    file('current'),
    file('old-1', { createdTime: '2026-11-01T09:45:25Z' }),
    file('old-2', { createdTime: '2026-11-05T16:44:15Z', appProperties: { bindingHash: 'older-version', archiveId: 'Sem 1', sourceKey: 'x' } }),
    file('unique', { name: 'Removed by lecturer.pdf', md5Checksum: 'md5-unique' }),
    file('edited', { name: 'Notes.pdf', md5Checksum: 'md5-edited' })
  ];
  const plan = drive.planCleanup(files, options);
  assert.deepEqual(plan.items.map(item => item.id).sort(), ['old-1', 'old-2']);
  assert.equal(plan.bytes, 551398 * 2);
  assert.match(plan.items[0].reason, /Duplicate of WIA2003-Course-Map\.png/);
  assert.equal(plan.kept, 3);
});

test('when no copy is current, the newest one is kept', () => {
  const plan = drive.planCleanup([
    file('a', { createdTime: '2026-11-01T00:00:00Z' }), file('b', { createdTime: '2026-11-21T00:00:00Z' }), file('c', { createdTime: '2026-11-05T00:00:00Z' })
  ], { ...options, keepKeys: new Set() });
  assert.deepEqual(plan.items.map(item => item.id).sort(), ['a', 'c']);
});

test('two current files with the same content in different folders both stay', () => {
  const plan = drive.planCleanup([file('lecture', { parents: ['cat-1'] }), file('reference', { parents: ['cat-9'] })],
    { ...options, keepKeys: new Set(['key-lecture', 'key-reference']) });
  assert.equal(plan.items.length, 0);
});

test('unfinished uploads and old Materials leftovers go; other empty folders stay, since they may hold the student’s own files', () => {
  const folder = (id, parents, key = 'fk-' + id) => ({ id, name: id, mimeType: FOLDER, parents, trashed: false, appProperties: { folderKey: key } });
  const files = [
    folder('root', []), folder('archive', ['root']), folder('cat-ps', ['archive']),
    folder('old-archive', ['root']), folder('old-cat', ['old-archive']), folder('kept-old', ['root']),
    { ...folder('old-materials', ['archive']), name: 'Materials', appProperties: { folderKey: 'fk-m', purpose: 'category' } },
    file('current'),
    file('old-copy', { parents: ['old-cat'], createdTime: '2026-11-01T00:00:00Z' }),
    file('placeholder', { md5Checksum: 'd41d8cd98f00b204e9800998ecf8427e', appProperties: { pendingSha256: 'abc', sourceKey: 'gone' } }),
    file('only-copy', { name: 'Old handout.pdf', md5Checksum: 'md5-handout', parents: ['kept-old'] })
  ];
  const plan = drive.planCleanup(files, options);
  assert.deepEqual(plan.items.map(item => item.id).sort(), ['old-copy', 'old-materials', 'placeholder']);
  assert.deepEqual(plan.items.filter(item => item.folder).map(item => item.id), ['old-materials']);
});

test('an empty current folder goes when an identical folder holds the files', () => {
  const folder = (id, key, created) => ({ id, name: 'Materials', mimeType: 'application/vnd.google-apps.folder', parents: ['course'], createdTime: created, trashed: false, appProperties: { folderKey: key } });
  const plan = drive.planCleanup([
    folder('course', 'fk-course'), folder('m-old', 'fk-m', '2026-11-05'), folder('m-new', 'fk-m', '2026-11-21'), folder('m-mid', 'fk-m', '2026-11-07'),
    file('index', { name: 'Spectrum links.md', md5Checksum: 'md5-index', parents: ['m-old'] })
  ], { ...options, keepKeys: new Set(['key-index']), keepFolderIds: ['course', 'm-new'] });
  assert.deepEqual(plan.items.map(item => item.id).sort(), ['m-mid', 'm-new']);
});

test('identical in-use files with the same name in one folder collapse to the oldest copy', () => {
  const plan = drive.planCleanup([
    file('label-1', { createdTime: '2026-11-01T09:45:25Z' }), file('label-2', { createdTime: '2026-11-01T09:46:22Z' }),
    file('label-3', { createdTime: '2026-11-21T07:14:08Z' }), file('elsewhere', { parents: ['cat-ref'], createdTime: '2026-11-21T07:13:30Z' })
  ], { ...options, keepKeys: new Set(['key-label-1', 'key-label-2', 'key-label-3', 'key-elsewhere']) });
  assert.deepEqual(plan.items.map(item => item.id).sort(), ['label-2', 'label-3']);
});

test('an emptied numbered folder from an earlier version is offered for clean-up', () => {
  const folder = (id, name) => ({ id, name, mimeType: 'application/vnd.google-apps.folder', parents: ['course'], trashed: false, appProperties: { folderKey: 'fk-' + id, purpose: 'category' } });
  const plan = drive.planCleanup([folder('course', 'WIA2001 Database'), folder('old-code', '6.Source Code & References'), folder('own', 'My notes'), folder('slides', 'Lecture Slides')],
    { ...options, keepKeys: new Set(), keepFolderIds: ['course', 'slides'] });
  assert.deepEqual(plan.items.map(item => item.id), ['old-code']);
});
