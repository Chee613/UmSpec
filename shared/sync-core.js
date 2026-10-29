(function (root) {
  'use strict';
  const SPECTRUM_ORIGIN = 'https://spectrum.um.edu.my';
  async function hashBytes(bytes) {
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  }
  const hashParts = parts => hashBytes(new TextEncoder().encode(JSON.stringify(parts)));
  function canonicalSource(value) {
    const url = new URL(value);
    if (url.origin !== SPECTRUM_ORIGIN || url.username || url.password) throw new Error('Unsupported Spectrum source');
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(sesskey|forcedownload)$/i.test(key)) url.searchParams.delete(key);
      else if (/token|password|secret|authorization/i.test(key)) throw new Error('Secret-bearing source URL');
    }
    let revision = null;
    url.pathname = url.pathname.replace(/(\/mod_resource\/content\/)(\d+)(\/)/, (_, before, value, after) => {
      revision = value;
      return before + '_' + after;
    });
    url.searchParams.sort();
    return { identity: url.href, revision };
  }
  function decideFileAction(source, remote) {
    if (!remote) return 'create';
    if (remote.trashed) return 'trashed';
    if (remote.md5Checksum && remote.uploadedMd5 && remote.md5Checksum !== remote.uploadedMd5) return 'conflict';
    if (!remote.md5Checksum || !remote.uploadedMd5) {
      if (!source.contentSha256) return 'download';
      return remote.contentSha256 === source.contentSha256 ? 'skip' : 'conflict';
    }
    if (source.sourceFingerprint && source.sourceFingerprint === remote.sourceFingerprint) return 'skip';
    if (!source.contentSha256) return 'download';
    return source.contentSha256 === remote.contentSha256 ? 'skip' : 'update';
  }
  function summariseResults(results) {
    const summary = { created: 0, updated: 0, skipped: 0, linked: 0, failed: 0, conflicts: 0 };
    const keys = { create: 'created', created: 'created', update: 'updated', updated: 'updated', skip: 'skipped', skipped: 'skipped', linked: 'linked', failed: 'failed', conflict: 'conflicts', trashed: 'conflicts' };
    for (const result of results || []) if (keys[result.action || result.status]) summary[keys[result.action || result.status]]++;
    return summary;
  }
  function shouldAutoSync(settings, now, lastAttemptAt, authenticated) {
    return Boolean(authenticated && settings?.mode === 'drive' && settings.autoSync === true && Number.isFinite(now) &&
      (lastAttemptAt == null || (Number.isFinite(lastAttemptAt) && now - lastAttemptAt >= 15 * 60 * 1000)));
  }
  function isVideoMaterial(item = {}) {
    if (item.kind === 'generated') return false;
    if (item.isVideo === true || /^(?:video|audio)\//i.test(item.mimeType || item.contentType || '') ||
      /recordings?|media|videos?/i.test(item.category || '') || ['kalvidres', 'panopto'].includes(item.type)) return true;
    if (/\brecordings?\b|\brakaman\b|\blecture video\b|\bwebinar\b/i.test(item.name || '')) return true;
    const extension = /\.(?:mp4|mkv|avi|mov|mp3|webm|flv|m4v|wav|ogg|ogv|m4a|aac|wma|wmv|m3u8|mpd)(?:[?#]|$)/i;
    if (extension.test(item.name || '')) return true;
    try {
      const url = new URL(item.sourceUrl || item.url);
      if (extension.test(decodeURIComponent(url.pathname))) return true;
      return ['youtube.com', 'youtu.be', 'vimeo.com', 'panopto.com', 'panopto.eu', 'zoom.us'].some(host =>
        url.hostname === host || url.hostname.endsWith('.' + host));
    } catch { return false; }
  }
  const api = { SPECTRUM_ORIGIN, hashParts, hashBytes, canonicalSource, decideFileAction, summariseResults, shouldAutoSync, isVideoMaterial };
  root.UmSpecSync = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
