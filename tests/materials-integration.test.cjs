const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('../shared/sync-core.js');
const ORIGIN = 'https://spectrum.um.edu.my';
const course = { id: 123, fullName: 'WIX1001 Computing', folderName: 'WIX1001_Computing' };

function activity(type, id, name) {
  const href = ORIGIN + '/mod/' + type + '/view.php?id=' + id;
  return { classList: ['activity', 'modtype_' + type],
    querySelector(selector) {
      if (selector === '.instancename') return { innerText: name };
      if (selector === 'a') return { href };
      return null;
    } };
}
function fileNode(url, name) {
  return { textContent: name, innerText: name, href: url,
    getAttribute: attr => attr === 'href' ? url : null };
}
function courseDocument(activities, externalLinks = []) {
  const section = {
    querySelector: () => ({ innerText: 'Week 1' }),
    querySelectorAll: selector => selector === '.activity' ? activities : externalLinks
  };
  return { querySelector: () => null, querySelectorAll: selector => selector.includes('.course-content') ? [section] : [] };
}
function wrapperDocument(nodes) {
  return { querySelector: () => null, querySelectorAll: selector => selector.includes('pluginfile.php') ? nodes : [] };
}
function exporterHarness({ courseResponse = {}, document: sourceDocument, wrappers = {} } = {}) {
  const requested = [];
  const sourceHTML = '<html data-fixture="course"></html>';
  const empty = { querySelector: () => null, querySelectorAll: () => [] };
  const context = {
    console, URL, TextEncoder, TextDecoder, crypto, setTimeout, clearTimeout,
    AbortSignal, AbortController, DOMException, UmSpecSync: core,
    location: { origin: ORIGIN, pathname: '/my/' },
    localStorage: { getItem: () => null, setItem() {} },
    document: { readyState: 'loading', addEventListener() {}, querySelector: () => null },
    DOMParser: class {
      parseFromString(text) {
        if (/name=["']password["']/.test(text)) return { ...empty, querySelector: () => ({ type: 'password' }) };
        if (text === sourceHTML) return sourceDocument || empty;
        return wrappers[text] || empty;
      }
    },
    async fetch(value) {
      const url = String(value);
      requested.push(url);
      if (url === ORIGIN + '/course/view.php?id=123') {
        const response = new Response(courseResponse.body ?? sourceHTML, { status: courseResponse.status || 200,
          headers: { 'Content-Type': 'text/html' } });
        Object.defineProperty(response, 'url', { value: courseResponse.url || url });
        return response;
      }
      const entry = wrappers[url];
      if (!entry) throw new Error('Unexpected fixture request: ' + url);
      const response = new Response(entry, { headers: { 'Content-Type': 'text/html' } });
      Object.defineProperty(response, 'url', { value: url });
      return response;
    }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('content/materials.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('content/content.js', 'utf8'), context);
  return { exporter: context.UmSpecExporter, materials: context.UmSpecMaterials, requested };
}

test('Drive inventory keeps selected folder children and assignment attachments independently', async () => {
  const folder = activity('folder', '7', 'Lecture Folder');
  const assignment = activity('assign', '8', 'Assignment');
  const excluded = activity('resource', '9', 'Excluded Notes');
  const folderURL = ORIGIN + '/mod/folder/view.php?id=7';
  const assignmentURL = ORIGIN + '/mod/assign/view.php?id=8';
  const first = ORIGIN + '/pluginfile.php/44/mod_folder/content/0/a/notes.pdf';
  const second = ORIGIN + '/pluginfile.php/44/mod_folder/content/0/b/notes.pdf';
  const attachment = ORIGIN + '/pluginfile.php/45/mod_assign/introattachment/0/brief.pdf';
  const harness = exporterHarness({ document: courseDocument([folder, assignment, excluded]), wrappers: {
    [folderURL]: 'folder fixture', 'folder fixture': wrapperDocument([fileNode(first, 'notes.pdf'), fileNode(second, 'notes.pdf')]),
    [assignmentURL]: 'assignment fixture', 'assignment fixture': wrapperDocument([fileNode(attachment, 'brief.pdf')])
  } });
  const descriptors = await harness.exporter.resolveCourseMaterials(course, new Set([folderURL, assignmentURL]));
  assert.deepEqual(Array.from(descriptors, item => item.sourceUrl), [first, second, attachment]);
  assert.equal(new Set(descriptors.map(item => item.sourceKey)).size, 3);
  assert.equal(descriptors[0].courseFolder, 'WIX1001_Computing');
  assert.equal(harness.requested.includes(ORIGIN + '/mod/resource/view.php?id=9'), false);
});

test('course discovery rejects an expired Spectrum session instead of confirming an empty pass', async () => {
  const { exporter } = exporterHarness({ courseResponse: { body: '<html><form id="login"><input name="password"></form></html>',
    url: ORIGIN + '/login/index.php' } });
  await assert.rejects(exporter.resolveCourseMaterials(course, null), /sign in|session|login/i);
});

test('course HTTP failures cannot become successful empty selected-course inventories', async () => {
  const { exporter } = exporterHarness({ courseResponse: { status: 503, body: 'Service unavailable' } });
  await assert.rejects(exporter.resolveCourseMaterials(course, null), /503|failed|unavailable/i);
});

test('login HTML served at the course URL is rejected before scanning activities', async () => {
  const { exporter } = exporterHarness({ courseResponse: { body: '<html><form id="login"><input name="password"></form></html>' } });
  await assert.rejects(exporter.resolveCourseMaterials(course, null), /sign in|session|login/i);
});

test('embedded external lecture links keep a stable identity without an activity query ID', async () => {
  const url = 'https://www.youtube.com/watch?v=lecture-one';
  const { exporter } = exporterHarness({ document: courseDocument([], [fileNode(url, 'Lecture recording')]) });
  const first = await exporter.resolveCourseMaterials(course, null);
  const second = await exporter.resolveCourseMaterials(course, null);
  assert.equal(first.length, 1);
  assert.equal(first[0].kind, 'link');
  assert.equal(first[0].sourceUrl, url);
  assert.equal(first[0].sourceKey, second[0].sourceKey);
});

test('external links bearing authentication tokens are rejected before making descriptors', async () => {
  const { materials } = exporterHarness();
  await assert.rejects(materials.describeMaterial(course, { url: ORIGIN + '/mod/url/view.php?id=7', name: 'Recording' },
    { url: 'https://video.example/watch?access_token=private', name: 'Recording', kind: 'link' }, 'archive'), /secret|token|unsafe|unsupported/i);
});

test('private Zoom join links preserve their intentional meeting passcode', async () => {
  const { materials } = exporterHarness();
  const result = await materials.describeMaterial(course, { url: ORIGIN + '/mod/url/view.php?id=7', name: 'Meeting' },
    { url: 'https://zoom.us/j/123456789?pwd=meeting-passcode', name: 'Meeting', kind: 'link' }, 'archive');
  assert.equal(result.sourceUrl, 'https://zoom.us/j/123456789?pwd=meeting-passcode');
});

test('material fingerprints derive from verified resource revision rather than caller metadata', async () => {
  const { materials } = exporterHarness();
  const item = { url: ORIGIN + '/mod/resource/view.php?id=7', name: 'Notes', sourceFingerprint: 'untrusted' };
  const ordinary = await materials.describeMaterial(course, item, {
    url: ORIGIN + '/pluginfile.php/44/mod_folder/content/7/notes.pdf', kind: 'binary', sourceFingerprint: 'untrusted' }, 'archive');
  const revised = await materials.describeMaterial(course, item, {
    url: ORIGIN + '/pluginfile.php/44/mod_resource/content/7/notes.pdf', kind: 'binary', sourceFingerprint: 'untrusted' }, 'archive');
  assert.equal(ordinary.sourceFingerprint, null);
  assert.notEqual(revised.sourceFingerprint, 'untrusted');
  assert.match(revised.sourceFingerprint, /^[a-f0-9]{64}$/);
});
