(function (root) {
  'use strict';
  const core = () => root.UmSpecSync || require('../shared/sync-core.js');
  const origin = 'https://spectrum.um.edu.my';
  function safeURL(value, base = origin) {
    const url = new URL(value, base);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Unsupported material URL');
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (url.origin === origin && /^(sesskey|logintoken|MoodleSession|sessionid|sessionkey|wstoken|access_token)$/i.test(key)) url.searchParams.delete(key);
      else if (/token|secret|authorization|password|sesskey|session(?:id|key)|api[_-]?key/i.test(key)) throw new Error('Secret-bearing material URL');
    }
    return url;
  }
  function sanitizeLink(value) {
    return safeURL(value).href.replace(/[<>]/g, character => encodeURIComponent(character));
  }
  function markdownText(value) {
    return String(value ?? '').replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/[\\\[\]*_`<>]/g, '\\$&');
  }
  function markdownLink(title, url) {
    return '[' + markdownText(title || 'Material') + '](<' + sanitizeLink(url) + '>)';
  }
  const loginRequired = message => Object.assign(new Error(message), { code: 'LOGIN_REQUIRED' });
  // Submission, test and discussion tools hold no course files, and some (Turnitin) redirect off Spectrum where they
  // cannot be read, so they stay links without being opened.
  const NO_FILES = new Set(['turnitintooltwo', 'quiz', 'lti', 'questionnaire', 'workshop', 'choice', 'feedback', 'attendance', 'forum']);
  // A short, student-facing reason for an item the Drive scan had to leave out.
  function skipReason(error) {
    if (error?.status === 404 || error?.status === 410) return { reason: 'broken link on Spectrum', permanent: true };
    if (error?.status) return { reason: 'Spectrum answered ' + error.status, permanent: false };
    if (error?.name === 'TimeoutError') return { reason: 'timed out', permanent: false };
    if (/Unsupported material URL/.test(error?.message)) return { reason: 'not a secure https link', permanent: true };
    if (/Secret-bearing/.test(error?.message)) return { reason: 'link contains a password or token', permanent: true };
    if (/stable Spectrum module|resolved Spectrum file/.test(error?.message)) return { reason: 'unusual Spectrum layout', permanent: true };
    return { reason: 'could not be read', permanent: false };
  }
  const skippedItem = (item, error) => ({ name: String(item?.name || 'Material').replace(/[\x00-\x1f]+/g, ' ').trim().slice(0, 80), ...skipReason(error) });
  async function resolveItemFiles(item, signal, videoPolicy = 'links') {
    // The course reader already repairs "Join: https://…" addresses; repeating it covers items saved before that.
    const url = safeURL(scanApi()?.repairLink(item.url) ?? item.url);
    if (NO_FILES.has(item.type)) return [{ url: url.href, name: item.name, kind: 'link' }];
    if (videoPolicy !== 'include' && core().isVideoMaterial(item)) return [{ url: url.href, name: item.name, kind: 'link', isVideo: true }];
    if (item.isExternal || url.origin !== origin || item.type === 'url') return [{ url: url.href, name: item.name, kind: 'link' }];
    if (url.pathname.includes('/pluginfile.php/')) return [{ url: url.href, name: item.name, kind: 'binary' }];
    const timeout = AbortSignal.timeout(25000);
    const response = await fetch(url.href, { credentials: 'include', signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (new URL(response.url).origin !== origin || /\/login[/.]/.test(new URL(response.url).pathname)) throw loginRequired('Sign in to Spectrum to read this material.');
    if (!response.ok) throw Object.assign(new Error('Spectrum material request failed (' + response.status + ').'), { status: response.status });
    const type = response.headers.get('Content-Type') || '';
    if (!type.includes('text/html')) {
      await response.body?.cancel();
      const isVideo = core().isVideoMaterial({ ...item, mimeType: type });
      return [{ url: response.url, name: item.name, mimeType: type, isVideo, kind: isVideo && videoPolicy !== 'include' ? 'link' : 'binary' }];
    }
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    if (doc.querySelector('form#login, input[name="password"]')) throw loginRequired('Spectrum session expired.');
    const selector = item.type === 'assign'
      ? '#intro a[href*="pluginfile.php"], .intro a[href*="pluginfile.php"], .fileuploadsubmission a[href*="pluginfile.php"]'
      : item.type === 'folder' ? 'a[href*="pluginfile.php"]'
        : '.resourceworkaround a, .resourcecontent object, .resourcecontent a[href*="pluginfile.php"], a[href*="pluginfile.php"]';
    const files = [], seen = new Set();
    for (const node of doc.querySelectorAll(selector)) {
      const value = node.getAttribute('data') || node.getAttribute('href');
      if (!value) continue;
      const target = safeURL(value, response.url);
      if (seen.has(target.href)) continue;
      seen.add(target.href);
      const name = node.textContent?.trim() || item.name;
      const isVideo = core().isVideoMaterial({ ...item, url: target.href, name });
      files.push({ url: target.href, name, isVideo,
        kind: target.origin === origin && target.pathname.includes('/pluginfile.php/') && !(isVideo && videoPolicy !== 'include') ? 'binary' : 'link' });
    }
    return files.length ? files : [{ url: url.href, name: item.name, kind: 'link' }];
  }
  const scanApi = () => root.UmSpecCourseScan || (typeof require === 'function' ? require('../shared/course-scan.js') : null);
  async function describeMaterial(course, item, file, archiveId) {
    const url = safeURL(file.url);
    const activity = new URL(item.url, origin);
    let moduleId = (activity.origin === origin && /^\/mod\/[^/]+\/view\.php$/.test(activity.pathname) && activity.searchParams.get('id')) || item.moduleId;
    if (!moduleId || !/^\d+$/.test(String(moduleId))) {
      if (file.kind !== 'link') throw new Error('Material has no stable Spectrum module ID.');
      moduleId = 'link:' + await core().hashParts([String(item.section || ''), url.href]);
    }
    let identity = url.href, revision = null;
    if (file.kind === 'binary') {
      ({ identity, revision } = core().canonicalSource(url.href));
      if (!url.pathname.includes('/pluginfile.php/')) throw new Error('Material is not a resolved Spectrum file.');
    }
    const pathName = decodeURIComponent(url.pathname.split('/').pop() || '');
    const scan = root.UmSpecCourseScan || (typeof require === 'function' ? require('../shared/course-scan.js') : null);
    // What the student sees in Drive: "W04 <Spectrum title>.pptx". `name` keeps the uploaded file name, which earlier
    // versions used, so Drive sync can recognise and rename those files.
    const displayName = scan?.displayName({ title: item.name, section: item.section, fileName: file.kind === 'binary' && pathName.includes('.') ? pathName : '',
      // Only an activity that really holds several files adds each file's own name to its title.
      multiple: ['folder', 'assign'].includes(item.type) && (item.fileCount ?? 2) > 1 }) || null;
    return {
      sourceKey: await core().hashParts([origin, String(course.id), String(moduleId), identity]),
      courseId: String(course.id), moduleId: String(moduleId), sourceUrl: url.href,
      courseName: course.fullName, courseFolder: course.folderName,
      name: file.kind === 'binary' && pathName.includes('.') ? pathName : file.name || item.name,
      displayName, section: String(item.section || ''),
      category: item.category || 'Lecture Slides', archiveId, kind: file.kind,
      isVideo: core().isVideoMaterial({ ...item, ...file }), mimeType: file.mimeType || item.mimeType || '',
      sourceFingerprint: revision === null ? null : await core().hashParts(['resource-revision', revision]),
      contentSha256: null, sizeBytes: null
    };
  }
  const api = { resolveItemFiles, describeMaterial, sanitizeLink, markdownText, markdownLink, skippedItem };
  root.UmSpecMaterials = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
