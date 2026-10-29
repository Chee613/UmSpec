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
  async function resolveItemFiles(item, signal, videoPolicy = 'links') {
    const url = safeURL(item.url);
    if (videoPolicy !== 'include' && core().isVideoMaterial(item)) return [{ url: url.href, name: item.name, kind: 'link', isVideo: true }];
    if (item.isExternal || url.origin !== origin || item.type === 'url') return [{ url: url.href, name: item.name, kind: 'link' }];
    if (url.pathname.includes('/pluginfile.php/')) return [{ url: url.href, name: item.name, kind: 'binary' }];
    const response = await fetch(url.href, { credentials: 'include', signal: signal || AbortSignal.timeout(25000) });
    if (!response.ok || new URL(response.url).origin !== origin || /\/login[/.]/.test(new URL(response.url).pathname)) throw new Error('Sign in to Spectrum to read this material.');
    const type = response.headers.get('Content-Type') || '';
    if (!type.includes('text/html')) {
      await response.body?.cancel();
      const isVideo = core().isVideoMaterial({ ...item, mimeType: type });
      return [{ url: response.url, name: item.name, mimeType: type, isVideo, kind: isVideo && videoPolicy !== 'include' ? 'link' : 'binary' }];
    }
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    if (doc.querySelector('form#login, input[name="password"]')) throw new Error('Spectrum session expired.');
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
    return {
      sourceKey: await core().hashParts([origin, String(course.id), String(moduleId), identity]),
      courseId: String(course.id), moduleId: String(moduleId), sourceUrl: url.href,
      courseName: course.fullName, courseFolder: course.folderName,
      name: file.kind === 'binary' && pathName.includes('.') ? pathName : file.name || item.name,
      category: item.category || '9.Reference', archiveId, kind: file.kind,
      isVideo: core().isVideoMaterial({ ...item, ...file }), mimeType: file.mimeType || item.mimeType || '',
      sourceFingerprint: revision === null ? null : await core().hashParts(['resource-revision', revision]),
      contentSha256: null, sizeBytes: null
    };
  }
  const api = { resolveItemFiles, describeMaterial, sanitizeLink, markdownText, markdownLink };
  root.UmSpecMaterials = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
