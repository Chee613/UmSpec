const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const JSZip = require('../lib/jszip.min.js');
const ORIGIN = 'https://spectrum.um.edu.my';

function anchor(href, name) {
  return { href, innerText: name, textContent: name, getAttribute: key => key === 'href' ? href : key === 'title' ? name : null };
}
function activity(type, id, name, query = '') {
  const link = anchor(ORIGIN + '/mod/' + type + '/view.php?id=' + id + query, name);
  return { classList: ['activity', 'modtype_' + type],
    querySelector: selector => selector === 'a' ? link : selector === '.instancename' ? { innerText: name } : null };
}
async function zipHarness(activities, sources, deselected = [], options = {}) {
  const ui = new Map();
  let uiAvailable = !options.discoverBeforeModal;
  const requested = [];
  const binaryReads = [];
  let blob;
  const node = () => ({ style: {}, classList: { add() {}, remove() {}, contains: () => false },
    querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, innerText: '' });
  const courseLink = anchor(ORIGIN + '/course/view.php?id=123', 'WIX1001 Computing');
  const courseDoc = { querySelector: () => null, querySelectorAll: () => [{
    querySelector: () => ({ innerText: 'Week 1' }), querySelectorAll: selector => selector === '.activity' ? activities : []
  }] };
  class FixtureURL extends URL {
    static createObjectURL(value) { blob = value; return 'blob:zip-fixture'; }
    static revokeObjectURL() {}
  }
  const context = {
    console, URL: FixtureURL, TextEncoder, TextDecoder, crypto, AbortSignal, AbortController,
    JSZip, Blob, ArrayBuffer, Uint8Array, DOMException, UmSpecSync: require('../shared/sync-core.js'),
    setTimeout(callback, delay) { const timer = setTimeout(callback, delay); timer.unref(); return timer; }, clearTimeout,
    location: { origin: ORIGIN, pathname: '/my/' },
    localStorage: { getItem: key => key === 'umspec_saved_degree' ? 'Computing' : null, setItem() {} },
    alert(message) { throw new Error(message); },
    document: {
      readyState: 'loading', addEventListener() {}, activeElement: null,
      querySelector: () => null,
      querySelectorAll: selector => selector.includes('/course/view.php?id=') ? [courseLink] : [],
      getElementById(id) {
        if (!uiAvailable) return null;
        if (id === 'umspec-runner-canvas') return null;
        if (!ui.has(id)) ui.set(id, node());
        return ui.get(id);
      },
      body: { appendChild() {} }, createElement: () => ({ click() {} })
    },
    DOMParser: class {
      parseFromString(text) {
        if (text === 'course fixture') return courseDoc;
        const children = sources[text];
        if (Array.isArray(children)) return { querySelector: () => null,
          querySelectorAll: selector => selector.includes('pluginfile.php') ? children : [] };
        throw new Error('Unexpected HTML fixture: ' + text);
      }
    },
    async fetch(value, options = {}) {
      const url = String(value);
      requested.push(url);
      assert.equal(new URL(url).origin, ORIGIN, 'ZIP should not fetch an arbitrary external target');
      assert.equal(options.credentials, 'include');
      let body, type;
      if (url === courseLink.href) { body = 'course fixture'; type = 'text/html'; }
      else {
        const source = sources[url];
        if (!source) throw new Error('Unexpected fetch: ' + url);
        body = source.bytes || source;
        type = source.bytes ? source.mimeType || 'application/pdf' : 'text/html';
      }
      const response = new Response(body, { headers: { 'Content-Type': type } });
      if (sources[url]?.bytes) {
        const getReader = response.body.getReader.bind(response.body);
        response.body.getReader = (...args) => { binaryReads.push(url); return getReader(...args); };
      }
      Object.defineProperty(response, 'url', { value: url });
      return response;
    }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('content/materials.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('content/content.js', 'utf8'), context);
  if (options.discoverBeforeModal) {
    await context.UmSpecExporter.discoverCourses();
    context.UmSpecExporter.setSelectedCourses(['123']);
    uiAvailable = true;
  }
  await context.UmSpecExporter.openModal();
  for (let i = 0; i < 20 && !context.UmSpecExporter.selectedUrls(123); i++) await new Promise(setImmediate);
  const selected = context.UmSpecExporter.selectedUrls(123);
  assert.ok(selected, 'the real background scanner should populate selected URLs');
  deselected.forEach(url => selected.delete(url));
  if (options.videoPolicy) context.UmSpecExporter.applySettings({ mode: 'zip', videoPolicy: options.videoPolicy });
  await context.UmSpecExporter.exportZip();
  assert.ok(blob, 'the actual ZIP pipeline should produce a downloadable archive');
  return { archive: await JSZip.loadAsync(await blob.arrayBuffer()), requested, ui, binaryReads };
}

test('opening the modal renders courses and profile after automatic discovery already ran', async () => {
  const { ui } = await zipHarness([], {}, [], { discoverBeforeModal: true });
  assert.equal(String(ui.get('umspec-course-count')?.innerText ?? ''), '1');
  assert.equal(ui.get('umspec-profile-major')?.innerText, 'Computing');
  assert.match(ui.get('umspec-courses-container')?.innerHTML || '', /data-id="123"/);
});

test('ZIP runtime retains same-name folder children and assignment paths without overwriting bytes', async () => {
  const first = ORIGIN + '/pluginfile.php/44/mod_folder/content/0/a/notes.pdf';
  const second = ORIGIN + '/pluginfile.php/44/mod_folder/content/0/b/notes.pdf';
  const attachment = ORIGIN + '/pluginfile.php/45/mod_assign/introattachment/0/brief.pdf';
  const excluded = ORIGIN + '/mod/resource/view.php?id=9';
  const { archive, requested } = await zipHarness([
    activity('folder', 7, 'Lecture Folder'), activity('assign', 8, 'Project brief Assignment'), activity('resource', 9, 'Excluded')
  ], {
    [ORIGIN + '/mod/folder/view.php?id=7']: 'folder fixture',
    'folder fixture': [anchor(first, 'notes.pdf'), anchor(second, 'notes.pdf')],
    [ORIGIN + '/mod/assign/view.php?id=8']: 'assignment fixture',
    'assignment fixture': [anchor(attachment, 'brief.pdf')],
    [first]: { bytes: new TextEncoder().encode('first child') },
    [second]: { bytes: new TextEncoder().encode('second child') },
    [attachment]: { bytes: new TextEncoder().encode('assignment attachment') }
  }, [excluded]);
  const paths = Object.keys(archive.files).filter(path => !archive.files[path].dir);
  const notes = paths.filter(path => /^WIX1001 Computing\/1\.Lecture Slide\/(?:[a-f0-9]{8}_)?notes\.pdf$/.test(path));
  assert.equal(notes.length, 2);
  assert.deepEqual((await Promise.all(notes.map(path => archive.file(path).async('string')))).sort(), ['first child', 'second child']);
  assert.equal(await archive.file('WIX1001 Computing/5.Assignments & Projects/brief.pdf').async('string'), 'assignment attachment');
  assert.equal(requested.includes(excluded), false);
  assert.ok(archive.file('SEMESTER_AUDIT_REPORT.md'));
});

test('ZIP linked-only videos do not write raw Spectrum session credentials into the archive', async () => {
  const { archive } = await zipHarness([activity('resource', 10, 'Lecture recording', '&sesskey=private-session&logintoken=private-login&MoodleSession=private-cookie')], {});
  const links = await archive.file('WIX1001 Computing/7.Recordings & Media/Lecture_Videos_and_Links.md').async('string');
  assert.match(links, /\/mod\/resource\/view\.php\?id=10/);
  assert.doesNotMatch(links, /sesskey|private-session|logintoken|private-login|MoodleSession|private-cookie/);
});

test('ZIP links folder videos and opaque video bodies by default; Settings opt-in includes their bytes', async () => {
  const video = ORIGIN + '/pluginfile.php/44/mod_folder/content/0/lesson.m4v';
  const opaque = ORIGIN + '/pluginfile.php/44/mod_folder/content/0/download';
  const activities = [activity('folder', 7, 'Week 1 files')];
  const sources = {
    [ORIGIN + '/mod/folder/view.php?id=7']: 'mixed folder',
    'mixed folder': [anchor(video, 'lesson.m4v'), anchor(opaque, 'Course material')],
    [video]: { bytes: new TextEncoder().encode('video bytes'), mimeType: 'video/mp4' },
    [opaque]: { bytes: new TextEncoder().encode('opaque video bytes'), mimeType: 'video/webm' }
  };
  const linked = await zipHarness(activities, sources);
  assert.equal(linked.requested.includes(video), false, 'recognised video should need no binary request');
  assert.deepEqual(linked.binaryReads, [], 'video Content-Type must be rejected before reading its body');
  const links = await linked.archive.file('WIX1001 Computing/7.Recordings & Media/Lecture_Videos_and_Links.md').async('string');
  assert.ok(links.includes(video) && links.includes(opaque));
  const included = await zipHarness(activities, sources, [], { videoPolicy: 'include' });
  assert.equal(await included.archive.file('WIX1001 Computing/1.Lecture Slide/lesson.m4v').async('string'), 'video bytes');
  assert.equal(await included.archive.file('WIX1001 Computing/1.Lecture Slide/Course material').async('string'), 'opaque video bytes');
});

test('ZIP link boundary escapes titles and destinations, rejects tokens and retains meeting passcodes', async () => {
  const external = (url, name) => ({ classList: ['activity', 'modtype_url'],
    querySelector: selector => selector === 'a' ? anchor(url, name) : selector === '.instancename' ? { innerText: name } : null });
  const { archive } = await zipHarness([
    external('https://zoom.us/j/123456789?pwd=join-passcode&note=a>b', 'Meeting ](https://attacker.example)\n# Injected'),
    external('https://www.youtube.com/watch?v=lecture&access_token=private-external-token', 'Private lecture')
  ], {});
  const links = await archive.file('WIX1001 Computing/7.Recordings & Media/Lecture_Videos_and_Links.md').async('string');
  assert.doesNotMatch(links, /private-external-token|access_token/);
  assert.match(links, /pwd=join-passcode/);
  assert.doesNotMatch(links, /\n# Injected/);
  assert.match(links, /Meeting \\\]/);
  assert.match(links, /note=a%3Eb/);
});
