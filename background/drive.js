(function (root) {
  'use strict';
  const core = root.UmSpecSync || (typeof require === 'function' && require('../shared/sync-core.js'));
  const FOLDER = 'application/vnd.google-apps.folder';
  const LIMIT = 50 * 1024 * 1024;
  const CHUNK = 1024 * 1024;
  const FIELDS = 'id,name,mimeType,parents,appProperties,md5Checksum,sha256Checksum,trashed';
  // ponytail: one buffered file per worker; streaming to durable disk can replace this if the 50 MiB limit changes.
  let buffered = null;
  const quote = value => String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const error = (code, message) => Object.assign(new Error(message), { code });
  const api = (path, options = {}) => root.UmSpecGoogle.googleFetch(path, options, 'drive');
  const jsonOptions = (method, body, headers = {}) => ({ method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  async function json(response) {
    if (!response.ok) throw error('DRIVE_HTTP_' + response.status, 'Drive request failed (' + response.status + ')');
    return response.json();
  }
  function normalize(file) {
    const props = file.appProperties || {};
    return { ...file, sourceKey: props.sourceKey, sourceFingerprint: props.sourceFingerprint || null,
      contentSha256: props.contentSha256 || null, uploadedMd5: props.uploadedMd5 || null, writerJobId: props.writerJobId || null };
  }
  async function list(q) {
    const files = [];
    const seen = new Set();
    let pageToken = '';
    do {
      const params = new URLSearchParams({ q, fields: 'nextPageToken,incompleteSearch,files(' + FIELDS + ')', pageSize: '1000', spaces: 'drive' });
      if (pageToken) params.set('pageToken', pageToken);
      const data = await json(await api('/drive/v3/files?' + params));
      if (data.incompleteSearch || !Array.isArray(data.files)) throw error('INCOMPLETE_DRIVE_SCAN', 'Drive inventory is incomplete');
      files.push(...data.files.map(normalize));
      pageToken = data.nextPageToken || '';
      if (pageToken && seen.has(pageToken)) throw error('INCOMPLETE_DRIVE_SCAN', 'Repeated Drive page');
      seen.add(pageToken);
      if (seen.size > 100) throw error('INCOMPLETE_DRIVE_SCAN', 'Drive inventory exceeds the supported page limit');
    } while (pageToken);
    return files;
  }
  function findManagedFiles(bindingHash, archiveId) {
    return list("appProperties has { key='bindingHash' and value='" + quote(bindingHash) + "' } and appProperties has { key='archiveId' and value='" + quote(archiveId) + "' }");
  }
  function folderPlan(binding, courses) {
    const archiveId = binding.settings.archiveId;
    const plan = [{ key: 'root', name: 'UM Spec', parent: null, archiveId: '*' },
      { key: 'archive', name: archiveId, parent: 'root', archiveId }];
    for (const course of courses) {
      const id = String(course.id ?? course.courseId);
      plan.push({ key: 'course:' + id, name: course.folderName || course.name || id, parent: 'archive', archiveId });
      for (const category of course.categories || []) plan.push({ key: 'category:' + id + ':' + category, name: category, parent: 'course:' + id, archiveId });
    }
    return plan;
  }
  async function ensureManagedFolders(binding, courses) {
    const files = await list("mimeType = '" + FOLDER + "' and appProperties has { key='bindingHash' and value='" + quote(binding.hash) + "' }");
    const folders = {};
    for (const item of folderPlan(binding, courses)) {
      const key = await core.hashParts([item.key, item.archiveId]);
      const matches = files.filter(file => file.appProperties?.folderKey === key);
      if (matches.length > 1) throw error('DUPLICATE_FOLDER', 'Duplicate managed folders require review');
      if (matches[0]?.trashed) throw error('TRASHED_FOLDER', 'Restore the managed folder from Drive trash before syncing');
      if (matches.length) folders[item.key] = matches[0].id;
    }
    // Discovery only: runDriveStep reserves and checkpoints IDs before creating missing folders.
    return folders;
  }
  function coursesFor(job) {
    const map = new Map();
    for (const material of job.materials) {
      const id = String(material.courseId);
      if (!map.has(id)) map.set(id, { id, name: material.courseFolder || material.courseName || id, categories: [] });
      const categories = map.get(id).categories;
      if (!categories.includes(material.category || 'Materials')) categories.push(material.category || 'Materials');
    }
    return [...map.values()];
  }
  async function generatedId() {
    const data = await json(await api('/drive/v3/files/generateIds?count=1&space=drive&type=files'));
    if (!/^[A-Za-z0-9_-]+$/.test(data.ids?.[0] || '')) throw error('INVALID_DRIVE_ID', 'Drive did not reserve a file ID');
    return data.ids[0];
  }
  async function getFile(id) {
    const response = await api('/drive/v3/files/' + encodeURIComponent(id) + '?fields=' + encodeURIComponent(FIELDS));
    if (response.status === 404) return null;
    const file = normalize(await json(response));
    file.etag = response.headers.get('ETag');
    return file;
  }
  function assertOwned(file, job, sourceKey) {
    if (file.appProperties?.bindingHash !== job.bindingHash || file.appProperties?.archiveId !== job.binding.settings.archiveId ||
      (sourceKey && file.appProperties?.sourceKey !== sourceKey)) throw error('UNMANAGED_FILE', 'Drive resource ownership did not match this sync');
  }
  function acknowledgedOffset(range) {
    if (!range) return 0;
    const match = /^bytes=0-(\d+)$/.exec(range);
    const offset = match ? Number(match[1]) + 1 : NaN;
    if (!Number.isSafeInteger(offset) || offset < 1) throw error('INVALID_ACK', 'Invalid Drive upload acknowledgement');
    return offset;
  }
  function uploadPath(value) {
    const url = new URL(value);
    if (url.origin !== 'https://www.googleapis.com' || url.username || url.password || url.hash ||
      !/^\/upload\/drive\/v3\/files(?:\/[A-Za-z0-9_-]+)?$/.test(url.pathname) || !url.searchParams.get('upload_id')) {
      throw error('INVALID_UPLOAD_URL', 'Invalid Drive upload session');
    }
    return url.pathname + url.search;
  }
  function safeLink(value) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || /[\r\n<>]/.test(value)) throw error('UNSAFE_LINK', 'Unsupported source link');
    for (const key of [...url.searchParams.keys()]) {
      if (/^sesskey$/i.test(key) && url.origin === core.SPECTRUM_ORIGIN) url.searchParams.delete(key);
      else if (/token|password|secret|authorization|sesskey/i.test(key)) throw error('UNSAFE_LINK', 'Secret-bearing source link');
    }
    return url.href;
  }
  async function readSource(material, videoPolicy) {
    if (material.kind === 'generated') return { bytes: new TextEncoder().encode(material.text), mimeType: 'text/markdown; charset=utf-8' };
    core.canonicalSource(material.sourceUrl);
    const url = safeLink(material.sourceUrl);
    if (material.sizeBytes > LIMIT) return { linked: true };
    const response = await fetch(url, { credentials: 'include', redirect: 'error', signal: AbortSignal.timeout(45000) });
    if (!response.ok) throw error('SPECTRUM_HTTP_' + response.status, 'Spectrum file request failed (' + response.status + ')');
    if (!response.url || new URL(response.url).origin !== core.SPECTRUM_ORIGIN || /\/login(?:\/|\.|$)/i.test(new URL(response.url).pathname)) throw error('SPECTRUM_LOGIN', 'Sign in to Spectrum again');
    const mimeType = response.headers.get('Content-Type') || 'application/octet-stream';
    if (videoPolicy !== 'include' && core.isVideoMaterial({ mimeType })) { await response.body?.cancel(); return { linked: true }; }
    if (Number(response.headers.get('Content-Length')) > LIMIT) { await response.body?.cancel(); return { linked: true }; }
    const reader = response.body?.getReader();
    if (!reader) throw error('EMPTY_SOURCE', 'Spectrum returned no file body');
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > LIMIT) { await reader.cancel(); return { linked: true }; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const prefix = new TextDecoder().decode(bytes.subarray(0, 8192));
    if (/text\/html/i.test(mimeType) || /<form[^>]+(?:login|password)|name=["'](?:password|logintoken)["']|<title[^>]*>\s*(?:log ?in|sign ?in)/i.test(prefix)) {
      throw error('SPECTRUM_LOGIN', 'Spectrum returned an HTML page instead of a resolved file');
    }
    return { bytes, mimeType };
  }
  function finish(job, material, action, detail) {
    job.results.push({ sourceKey: material.sourceKey, name: material.name, action, ...(detail ? { detail } : {}) });
    job.cursor++;
    job.upload = null;
    buffered = null;
    job.summary = core.summariseResults(job.results);
    return job;
  }
  function properties(job, material, hash) {
    return { bindingHash: job.bindingHash, archiveId: job.binding.settings.archiveId, sourceKey: material.sourceKey,
      sourceFingerprint: material.sourceFingerprint || '', contentSha256: hash, writerJobId: job.id };
  }
  function pendingProperties(job, material, hash) {
    return { bindingHash: job.bindingHash, archiveId: job.binding.settings.archiveId, sourceKey: material.sourceKey,
      pendingSha256: hash, writerJobId: job.id };
  }
  async function runDriveStep(input) {
    const job = structuredClone(input);
    if (!job.id || !job.binding || job.binding.hash !== job.bindingHash || !job.binding.settings?.archiveId || !Array.isArray(job.materials)) throw error('INVALID_JOB', 'Invalid Drive job binding');
    if (job.done) return job;
    job.cursor ??= 0;
    job.results ??= [];
    job.links ??= [];
    job.status = 'running';
    const courses = coursesFor(job);
    if (!job.folders) {
      job.folders = await ensureManagedFolders(job.binding, courses);
      if (job.folders.root) job.binding.driveRootId = job.folders.root;
      return job;
    }
    if (job.folderIntent) {
      const intent = job.folderIntent;
      const existing = await getFile(intent.id);
      if (existing) {
        if (existing.trashed || existing.appProperties?.bindingHash !== job.bindingHash || existing.appProperties?.folderKey !== intent.metadata.appProperties.folderKey) throw error('FOLDER_CONFLICT', 'Managed folder requires review');
      } else {
        const response = await api('/drive/v3/files?fields=' + encodeURIComponent(FIELDS), jsonOptions('POST', intent.metadata));
        if (response.status === 409) return job;
        await json(response);
      }
      job.folders[intent.key] = intent.id;
      if (intent.key === 'root') job.binding.driveRootId = intent.id;
      job.folderIntent = null;
      return job;
    }
    const missing = folderPlan(job.binding, courses).find(item => !job.folders[item.key]);
    if (missing) {
      const id = await generatedId();
      job.folderIntent = { key: missing.key, id, metadata: { id, name: missing.name, mimeType: FOLDER,
        ...(missing.parent ? { parents: [job.folders[missing.parent]] } : {}), appProperties: { bindingHash: job.bindingHash,
          archiveId: missing.archiveId, folderKey: await core.hashParts([missing.key, missing.archiveId]), purpose: missing.key.split(':')[0] } } };
      return job;
    }
    if (!job.remoteFiles) { job.remoteFiles = await findManagedFiles(job.bindingHash, job.binding.settings.archiveId); return job; }
    if (job.cursor >= job.materials.length) {
      if (job.links.length && !job.indexAdded) {
        const escape = value => String(value).replace(/[\\\[\]*_`]/g, '\\$&').replace(/[\r\n]+/g, ' ');
        const text = '# Spectrum links\n\nThese materials are links, not binary backups. Sign in to Spectrum to open course files.\n\n' +
          job.links.map(link => '- ' + escape(link.courseId) + ': [' + escape(link.name) + '](<' + safeLink(link.sourceUrl) + '>)').join('\n') + '\n';
        job.materials.push({ sourceKey: await core.hashParts([job.bindingHash, job.binding.settings.archiveId, 'link-index']),
          courseId: courses[0]?.id || String(job.binding.settings.courseIds[0]), category: 'Materials', archiveId: job.binding.settings.archiveId,
          name: 'Spectrum links.md', kind: 'generated', text, sourceFingerprint: null });
        job.indexAdded = true;
        return job;
      }
      job.done = true;
      job.status = 'complete';
      job.summary = core.summariseResults(job.results);
      return job;
    }
    const material = job.materials[job.cursor];
    if (material.archiveId !== job.binding.settings.archiveId || !job.binding.settings.courseIds.map(String).includes(String(material.courseId))) throw error('INVALID_MATERIAL', 'Material does not belong to the selected archive and courses');
    const matches = job.remoteFiles.filter(file => file.sourceKey === material.sourceKey);
    if (matches.length > 1) return finish(job, material, 'conflict', 'Duplicate source mappings require review');
    const remote = matches[0] || null;
    if (!job.upload) {
      if (material.kind === 'link' || material.sizeBytes > LIMIT || (job.binding.settings.videoPolicy !== 'include' && core.isVideoMaterial(material))) {
        try { job.links.push({ name: material.name, sourceUrl: safeLink(material.sourceUrl), courseId: material.courseId }); }
        catch (err) { return finish(job, material, 'failed', err.code || 'UNSAFE_LINK'); }
        return finish(job, material, 'linked');
      }
      const action = core.decideFileAction({ ...material, contentSha256: null }, remote);
      if (['skip', 'trashed', 'conflict'].includes(action)) return finish(job, material, action === 'skip' ? 'skipped' : action);
      let source;
      try { source = await readSource(material, job.binding.settings.videoPolicy); }
      catch (err) { return finish(job, material, 'failed', err.code || 'SOURCE_READ_FAILED'); }
      if (source.linked) { job.links.push({ name: material.name, sourceUrl: safeLink(material.sourceUrl), courseId: material.courseId }); return finish(job, material, 'linked'); }
      const hash = await core.hashBytes(source.bytes);
      const decision = core.decideFileAction({ ...material, contentSha256: hash }, remote);
      if (['skip', 'conflict', 'trashed'].includes(decision)) return finish(job, material, decision === 'skip' ? 'skipped' : decision);
      buffered = { jobId: job.id, sourceKey: material.sourceKey, ...source, hash };
      job.upload = { fileId: remote?.id || null, action: remote ? 'updated' : 'created', hash, size: source.bytes.length,
        mimeType: source.mimeType, offset: 0, phase: remote ? 'verify' : 'reserve' };
      return job;
    }
    const upload = job.upload;
    if (upload.phase === 'finalize' || upload.phase === 'finalize-write') {
      if (upload.phase === 'finalize') {
        const current = await getFile(upload.fileId);
        if (!current) return finish(job, material, 'failed', 'Uploaded file disappeared');
        assertOwned(current, job, material.sourceKey);
        if (current.trashed || current.md5Checksum !== upload.completedMd5 || (current.sha256Checksum && current.sha256Checksum !== upload.hash)) return finish(job, material, 'conflict');
        upload.phase = 'finalize-write';
        upload.etag = current.etag;
        return job;
      }
      const current = await getFile(upload.fileId);
      if (!current) return finish(job, material, 'conflict', 'Uploaded file disappeared before finalization');
      assertOwned(current, job, material.sourceKey);
      if (current.trashed || current.md5Checksum !== upload.completedMd5 || (current.sha256Checksum && current.sha256Checksum !== upload.hash)) return finish(job, material, 'conflict');
      const props = { ...properties(job, material, upload.hash), uploadedMd5: upload.completedMd5 };
      const file = normalize(await json(await api('/drive/v3/files/' + encodeURIComponent(upload.fileId) + '?fields=' + encodeURIComponent(FIELDS),
        jsonOptions('PATCH', { appProperties: props }, current.etag ? { 'If-Match': current.etag } : {}))));
      job.remoteFiles = job.remoteFiles.filter(file => file.sourceKey !== material.sourceKey).concat(file);
      return finish(job, material, upload.action);
    }
    if (!buffered || buffered.jobId !== job.id || buffered.sourceKey !== material.sourceKey) {
      let source;
      // A saved upload already owns its byte session; retain its checkpoint while recovering the same bytes.
      try { source = await readSource(material, 'include'); }
      catch (err) { return finish(job, material, 'failed', err.code || 'SOURCE_READ_FAILED'); }
      if (source.linked || await core.hashBytes(source.bytes) !== upload.hash) return finish(job, material, 'conflict', 'Source changed during upload; retry to reconcile');
      buffered = { jobId: job.id, sourceKey: material.sourceKey, ...source, hash: upload.hash };
      if (upload.url) upload.phase = 'probe';
      return job;
    }
    if (upload.phase === 'reserve') { upload.fileId = await generatedId(); upload.phase = 'create'; return job; }
    if (upload.phase === 'create') {
      const existing = await getFile(upload.fileId);
      if (existing) assertOwned(existing, job, material.sourceKey);
      else {
        const parent = material.kind === 'generated' ? job.folders.archive : job.folders['category:' + material.courseId + ':' + (material.category || 'Materials')];
        const response = await api('/drive/v3/files?fields=' + encodeURIComponent(FIELDS), jsonOptions('POST', { id: upload.fileId, name: material.name,
          parents: [parent], appProperties: pendingProperties(job, material, upload.hash) }));
        if (response.status === 409) return job;
        await json(response);
      }
      upload.phase = 'verify';
      return job;
    }
    if (upload.phase === 'verify') {
      const current = await getFile(upload.fileId);
      if (!current) return finish(job, material, 'conflict', 'Managed file was removed');
      assertOwned(current, job, material.sourceKey);
      const ownPending = current.writerJobId === job.id && current.appProperties?.pendingSha256 === upload.hash;
      if (current.trashed) return finish(job, material, 'trashed');
      if (ownPending && current.sha256Checksum === upload.hash && current.md5Checksum) { upload.completedMd5 = current.md5Checksum; upload.phase = 'finalize'; return job; }
      if ((!current.uploadedMd5 || current.md5Checksum !== current.uploadedMd5) && !(ownPending && !current.md5Checksum)) return finish(job, material, 'conflict');
      upload.etag = current.etag;
      upload.phase = 'start';
      return job;
    }
    if (upload.phase === 'start') {
      const current = await getFile(upload.fileId);
      if (!current) return finish(job, material, 'conflict', 'Managed file was removed');
      assertOwned(current, job, material.sourceKey);
      if (current.trashed) return finish(job, material, 'trashed');
      const emptyIntent = current.writerJobId === job.id && current.appProperties?.pendingSha256 === upload.hash && !current.md5Checksum;
      if (!emptyIntent && (!current.uploadedMd5 || current.md5Checksum !== current.uploadedMd5)) return finish(job, material, 'conflict');
      const headers = { 'X-Upload-Content-Type': upload.mimeType, 'X-Upload-Content-Length': String(upload.size), ...(current.etag ? { 'If-Match': current.etag } : {}) };
      const response = await api('/upload/drive/v3/files/' + encodeURIComponent(upload.fileId) + '?uploadType=resumable&fields=' + encodeURIComponent(FIELDS),
        jsonOptions('PATCH', { appProperties: pendingProperties(job, material, upload.hash) }, headers));
      if (!response.ok) await json(response);
      const location = response.headers.get('Location');
      uploadPath(location);
      upload.url = location;
      upload.phase = 'probe';
      return job;
    }
    const probing = upload.phase === 'probe';
    const end = Math.min(upload.offset + CHUNK, upload.size);
    const response = await api(uploadPath(upload.url), { method: 'PUT', headers: { 'Content-Type': upload.mimeType,
      'Content-Range': probing || upload.size === 0 ? 'bytes */' + upload.size : 'bytes ' + upload.offset + '-' + (end - 1) + '/' + upload.size },
      body: probing ? undefined : buffered.bytes.slice(upload.offset, end) });
    if (response.status === 404 || response.status === 410) { upload.url = null; upload.offset = 0; upload.phase = 'verify'; return job; }
    if (response.status === 308) {
      const offset = acknowledgedOffset(response.headers.get('Range'));
      if (offset > upload.size || (!probing && offset < upload.offset) || (!probing && offset > end)) throw error('INVALID_ACK', 'Drive acknowledgement exceeds the sent bytes');
      upload.offset = offset;
      upload.phase = 'chunk';
      return job;
    }
    const completed = await json(response);
    if (!completed.md5Checksum || (probing && completed.sha256Checksum !== upload.hash) || (completed.sha256Checksum && completed.sha256Checksum !== upload.hash)) return finish(job, material, 'conflict', 'Upload checksum could not be reconciled');
    upload.completedMd5 = completed.md5Checksum;
    upload.offset = upload.size;
    upload.phase = 'finalize';
    return job;
  }
  const exported = { findManagedFiles, ensureManagedFolders, runDriveStep, acknowledgedOffset };
  root.UmSpecDrive = exported;
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
})(globalThis);
