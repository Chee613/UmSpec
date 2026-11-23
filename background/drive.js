(function (root) {
  'use strict';
  const core = root.UmSpecSync || (typeof require === 'function' && require('../shared/sync-core.js'));
  const FOLDER = 'application/vnd.google-apps.folder';
  const LIMIT = 50 * 1024 * 1024;
  const CHUNK = 1024 * 1024;
  const FIELDS = 'id,name,mimeType,parents,appProperties,md5Checksum,sha256Checksum,trashed';
  // Drive reports this MD5 for the zero-byte body of a metadata-only placeholder.
  const EMPTY_MD5 = 'd41d8cd98f00b204e9800998ecf8427e';
  const unwritten = file => !file.md5Checksum || file.md5Checksum === EMPTY_MD5;
  // A pending placeholder left by this or an interrupted earlier job, still without uploaded bytes.
  const placeholder = file => Boolean(file.appProperties?.pendingSha256) && !file.uploadedMd5 && unwritten(file);
  // ponytail: one buffered file per worker; streaming to durable disk can replace this if the 50 MiB limit changes.
  let buffered = null;
  const quote = value => String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const error = (code, message) => Object.assign(new Error(message), { code });
  const api = (path, options = {}) => root.UmSpecGoogle.googleFetch(path, options, 'drive');
  const jsonOptions = (method, body, headers = {}) => ({ method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  async function json(response) {
    if (!response.ok) {
      // Google's own reason ("insufficientPermissions", "storageQuotaExceeded", …) makes a paused sync explainable.
      let reason = '';
      try { const body = await response.json(); reason = String(body?.error?.errors?.[0]?.reason || body?.error?.message || '').replace(/[\u0000-\u001f]/g, ' ').slice(0, 80); } catch {}
      throw error('DRIVE_HTTP_' + response.status, 'Drive request failed (' + response.status + (reason ? ': ' + reason : '') + ')');
    }
    return response.json();
  }
  function normalize(file) {
    const props = file.appProperties || {};
    return { ...file, sourceKey: props.sourceKey, sourceFingerprint: props.sourceFingerprint || null,
      contentSha256: props.contentSha256 || null, uploadedMd5: props.uploadedMd5 || null, writerJobId: props.writerJobId || null,
      pendingSha256: props.pendingSha256 || null, managedName: props.managedName || null };
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
  const listManagedFolders = binding => list("mimeType = '" + FOLDER + "' and appProperties has { key='bindingHash' and value='" + quote(binding.hash) + "' }");
  async function ensureManagedFolders(binding, courses, managed = null) {
    const files = managed || await listManagedFolders(binding);
    const folders = {};
    for (const item of folderPlan(binding, courses)) {
      const key = await core.hashParts([item.key, item.archiveId]);
      const matches = files.filter(file => file.appProperties?.folderKey === key);
      // A trashed twin (for example an empty copy removed by clean-up) does not block the folder still in use.
      const live = matches.filter(file => !file.trashed);
      if (live.length > 1) throw error('DUPLICATE_FOLDER', 'Duplicate managed folders require review');
      if (!live.length && matches.length) throw error('TRASHED_FOLDER', 'Restore the managed folder from Drive trash before syncing');
      if (live.length) folders[item.key] = live[0].id;
    }
    // Discovery only: runDriveStep reserves and checkpoints IDs before creating missing folders.
    return folders;
  }
  function coursesFor(job) {
    const map = new Map();
    for (const material of job.materials) {
      // The generated links index is written to the semester folder, so it needs no course "Materials" folder.
      if (material.kind === 'generated') continue;
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
  // Drive v3 does not document conditional writes; after one 412 the job relies on the GET re-check made in the same step.
  const ifMatch = (job, current) => current.etag && !job.skipIfMatch ? { 'If-Match': current.etag } : {};
  // The name UM Spec gives a file in Drive ("W04 <Spectrum title>.pptx"); materials from older versions only carry `name`.
  const driveName = material => material.displayName || material.name;
  function properties(job, material, hash) {
    return { bindingHash: job.bindingHash, archiveId: job.binding.settings.archiveId, sourceKey: material.sourceKey,
      sourceFingerprint: material.sourceFingerprint || '', contentSha256: hash, writerJobId: job.id, managedName: driveName(material).slice(0, 100) };
  }
  function pendingProperties(job, material, hash) {
    return { bindingHash: job.bindingHash, archiveId: job.binding.settings.archiveId, sourceKey: material.sourceKey,
      pendingSha256: hash, writerJobId: job.id, managedName: driveName(material).slice(0, 100) };
  }
  const scan = () => root.UmSpecCourseScan || (typeof require === 'function' ? require('../shared/course-scan.js') : null);
  // Moves and renames a file UM Spec placed earlier into the current layout. A file the student renamed, or moved out
  // of UM Spec's folders, is theirs to keep where it is.
  async function placeRemote(job, material, remote) {
    const parent = targetFolder(job, material), name = driveName(material);
    if (!parent || remote.trashed || (remote.parents?.includes(parent) && remote.name === name)) return remote;
    const ours = remote.managedName ? [remote.managedName] : [material.name];
    if (!ours.includes(remote.name) && remote.name !== name) return remote;
    const folders = new Set([...Object.values(job.folders || {}), ...Object.values(job.folderIndex || {})]);
    if (!(remote.parents || []).every(id => folders.has(id))) return remote;
    const params = new URLSearchParams({ fields: FIELDS });
    if (!remote.parents?.includes(parent)) { params.set('addParents', parent); params.set('removeParents', (remote.parents || []).join(',')); }
    const response = await api('/drive/v3/files/' + encodeURIComponent(remote.id) + '?' + params,
      jsonOptions('PATCH', { name, appProperties: { managedName: name.slice(0, 100) } }));
    if (!response.ok) return remote;
    const file = normalize(await response.json());
    job.remoteFiles = job.remoteFiles.filter(item => item.id !== remote.id).concat(file);
    job.reorganised = (job.reorganised || 0) + 1;
    return file;
  }

  // ---------- Links: one Google Doc per course ----------
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const planner = () => root.UmSpecPlannerCore || (typeof require === 'function' ? require('../shared/planner-core.js') : null);
  // The student's OCC for a course as the planner knows it (their own choice first, then detection). null keeps every
  // OCC: nothing is known yet, or the student chose to see items from every OCC.
  async function occFor(courseId) {
    try {
      const saved = await chrome.storage.local.get(['umspecPlanner', 'umspecPlannerPrefs', 'umspecCourseAI']);
      const prefs = saved.umspecPlannerPrefs || {};
      const layout = prefs.courseAI ? saved.umspecCourseAI?.[String(courseId)]?.layout || null : null;
      return { occ: prefs.showAllOcc ? null : planner()?.effectiveOcc(saved.umspecPlanner, prefs, String(courseId)) || null, layout };
    } catch { return { occ: null, layout: null }; }
  }
  function linksHtml(courseName, links, occ = null) {
    const sections = new Map();
    for (const link of links) {
      const section = link.section || 'General';
      if (!sections.has(section)) sections.set(section, []);
      sections.get(section).push(link);
    }
    const body = links.length ? [...sections].map(([section, items]) => '<h2>' + escapeHtml(section) + '</h2><ul>' + items.map(link => {
      let host = ''; try { host = new URL(link.sourceUrl).hostname.replace(/^www\./, ''); } catch {}
      return '<li><a href="' + escapeHtml(link.sourceUrl) + '">' + escapeHtml(link.displayName || link.name) + '</a>' + (host ? ' <span style="color:#666">(' + escapeHtml(host) + ')</span>' : '') + '</li>';
    }).join('') + '</ul>').join('') : '<p>No links in this course right now.</p>';
    return '<html><head><meta charset="utf-8"></head><body><h1>' + escapeHtml(courseName) + ' · Links</h1>' +
      '<p style="color:#666">Videos, online classes and websites from Spectrum, grouped as on the course page. Kept up to date by UM Spec.' +
      (occ ? ' Showing links for OCC ' + escapeHtml(occ) + ' and links meant for everyone. Change your OCC in the UM Spec planner.' : '') + '</p>' + body + '</body></html>';
  }
  async function writeLinksDoc(job, courseId) {
    const archiveId = job.binding.settings.archiveId;
    const { occ, layout } = await occFor(courseId);
    // Links labelled for another OCC (in their title or section) are left out, like the course-page OCC bar hides them.
    // Where the title names none, the AI's reading of the course (if the student turned it on) decides.
    const tokensOf = link => planner().parseOcc([link.displayName || link.name, link.section].join(' ')) ||
      (layout ? layout.activities?.[String(link.moduleId)]?.occ || layout.sections?.[link.section]?.occ || null : null);
    const links = job.links.filter(link => String(link.courseId) === courseId && scan().isMaterialLink(link.name, link.sourceUrl) &&
      (!occ || planner().occMatches(tokensOf(link), occ)));
    const course = coursesFor(job).find(item => item.id === courseId);
    const sourceKey = await core.hashParts([job.bindingHash, archiveId, 'links-doc', courseId]);
    const remote = job.remoteFiles.find(file => file.sourceKey === sourceKey && !file.trashed) || null;
    if (!links.length && !remote) return;
    const html = linksHtml(course?.name || courseId, links, occ);
    const hash = await core.hashParts(['links-doc', html]);
    if (remote?.contentSha256 === hash) return;
    const appProperties = { bindingHash: job.bindingHash, archiveId, sourceKey, contentSha256: hash, writerJobId: job.id, managedName: 'Links' };
    // Google Docs cannot take a pre-reserved file ID, so Drive is asked for this course's Doc right before creating one;
    // a retry after a lost reply therefore updates the Doc it already made.
    const found = remote || (await list("appProperties has { key='sourceKey' and value='" + quote(sourceKey) + "' } and trashed = false"))[0] || null;
    const targetId = found?.id || null;
    const exists = Boolean(found);
    const metadata = exists ? { appProperties } : { name: 'Links', mimeType: 'application/vnd.google-apps.document', parents: [job.folders['course:' + courseId]], appProperties };
    const boundary = 'umspec' + Math.random().toString(16).slice(2);
    const body = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(metadata) +
      '\r\n--' + boundary + '\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n' + html + '\r\n--' + boundary + '--';
    const path = '/upload/drive/v3/files' + (exists ? '/' + encodeURIComponent(targetId) : '') + '?uploadType=multipart&fields=' + encodeURIComponent(FIELDS);
    const file = normalize(await json(await api(path, { method: exists ? 'PATCH' : 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body })));
    job.remoteFiles = job.remoteFiles.filter(item => item.id !== file.id).concat(file);
  }
  const targetFolder = (job, material) => material.kind === 'generated' ? job.folders.archive : job.folders['category:' + material.courseId + ':' + (material.category || 'Materials')];
  // A material whose identity drifted (for example a page revision number in its Spectrum URL) used to be uploaded again
  // beside the old copy. An identical, finished file with the same name in the same folder that no current material
  // claims is relabelled for this material instead.
  // Spectrum courses reuse one image (a course map, a teaching-team photo) in several activities; those activities share one
  // Drive file instead of each adding an identical copy to the folder.
  const twinsOf = (job, material, hash) => (job.remoteFiles || []).filter(file => !file.trashed && [material.name, driveName(material)].includes(file.name) &&
    file.parents?.includes(targetFolder(job, material)) && file.contentSha256 === hash && file.uploadedMd5 && file.md5Checksum === file.uploadedMd5);
  async function adoptTwin(job, material, hash) {
    const claimed = new Set(job.materials.map(item => item.sourceKey));
    const twins = twinsOf(job, material, hash);
    const twin = twins.find(file => !claimed.has(file.sourceKey));
    if (!twin) return twins.length ? { shared: true } : null;
    const current = await getFile(twin.id);
    if (!current || current.trashed || current.md5Checksum !== twin.uploadedMd5) return null;
    const response = await api('/drive/v3/files/' + encodeURIComponent(twin.id) + '?fields=' + encodeURIComponent(FIELDS),
      jsonOptions('PATCH', { appProperties: { ...properties(job, material, hash), uploadedMd5: twin.uploadedMd5 } }, ifMatch(job, current)));
    if (!response.ok) return null;
    const file = normalize(await response.json());
    job.remoteFiles = job.remoteFiles.filter(item => item.id !== twin.id).concat(file);
    return file;
  }

  // ---------- Duplicate clean-up ----------
  const CLEANUP_FIELDS = 'id,name,mimeType,parents,appProperties,md5Checksum,size,createdTime,trashed';
  async function listAppFiles() {
    // With the drive.file scope Drive lists only files UM Spec created, across every archive and earlier versions.
    const files = [], seen = new Set();
    let pageToken = '';
    do {
      const params = new URLSearchParams({ q: 'trashed = false', fields: 'nextPageToken,incompleteSearch,files(' + CLEANUP_FIELDS + ')', pageSize: '1000', spaces: 'drive' });
      if (pageToken) params.set('pageToken', pageToken);
      const data = await json(await api('/drive/v3/files?' + params));
      if (data.incompleteSearch || !Array.isArray(data.files)) throw error('INCOMPLETE_DRIVE_SCAN', 'Drive inventory is incomplete');
      files.push(...data.files.map(normalize));
      pageToken = data.nextPageToken || '';
      if (pageToken && seen.has(pageToken)) throw error('INCOMPLETE_DRIVE_SCAN', 'Repeated Drive page');
      seen.add(pageToken);
      if (seen.size > 50) throw error('INCOMPLETE_DRIVE_SCAN', 'Drive inventory exceeds the supported page limit');
    } while (pageToken);
    return files;
  }
  // Only copies are removed: a file is trashed when an identical file (same MD5) is kept, and it is not one the
  // latest sync maps to a Spectrum material. Unique files, such as materials a lecturer later removed, always stay.
  function planCleanup(files, { bindingHash, archiveId, keepKeys, keepFolderIds = [] }) {
    const live = files.filter(file => !file.trashed);
    const mapped = file => file.appProperties?.bindingHash === bindingHash && file.appProperties?.archiveId === archiveId && keepKeys.has(file.appProperties?.sourceKey);
    const trash = new Map(), kept = new Set();
    const groups = new Map();
    for (const file of live) {
      if (file.mimeType === FOLDER) continue;
      if (!file.md5Checksum || file.md5Checksum === EMPTY_MD5) {
        // An empty placeholder left by an interrupted upload holds no student content.
        if (file.appProperties?.pendingSha256 && !mapped(file)) trash.set(file.id, { ...file, reason: 'Unfinished upload' });
        else kept.add(file.id);
        continue;
      }
      if (!groups.has(file.md5Checksum)) groups.set(file.md5Checksum, []);
      groups.get(file.md5Checksum).push(file);
    }
    for (const group of groups.values()) {
      // Within one folder, identical files with the same name collapse to the oldest; the sync then shares that file
      // between the activities that used the same image. Identical files in different folders all stay when in use.
      const oldestFirst = [...group].sort((a, b) => String(a.createdTime).localeCompare(String(b.createdTime)));
      const keep = [], seenPlace = new Set();
      for (const file of oldestFirst.filter(mapped)) {
        const place = (file.parents || []).join(',') + '|' + file.name;
        if (!seenPlace.has(place)) { seenPlace.add(place); keep.push(file); }
      }
      if (!keep.length) keep.push(oldestFirst.at(-1));
      for (const file of group) {
        if (keep.includes(file)) kept.add(file.id);
        else trash.set(file.id, { ...file, reason: 'Duplicate of ' + keep[0].name });
      }
    }
    // Folders from older archives or versions that are left empty go too; folders the current sync uses always stay.
    const folders = live.filter(file => file.mimeType === FOLDER);
    const keepFolders = new Set(keepFolderIds);
    let changed = true;
    while (changed) {
      changed = false;
      for (const folder of folders) {
        const key = folder.appProperties?.folderKey;
        if (trash.has(folder.id) || !key) continue;
        const hasChild = live.some(file => file.parents?.includes(folder.id) && !trash.has(file.id));
        if (hasChild) continue;
        // UM Spec cannot see files the student added (drive.file scope), so a folder that looks empty may not be.
        // Only known leftovers go: an empty twin of another folder with the same identity, or an old links-index
        // "Materials" folder. A folder the current sync uses stays unless it is such a twin.
        const twin = folders.some(other => other !== folder && other.appProperties?.folderKey === key && !trash.has(other.id));
        // Old links-index "Materials" folders and numbered type folders from earlier versions ("6.Source Code & References").
        const leftover = folder.appProperties?.purpose === 'category' && (folder.name === 'Materials' || /^[1-9].(?:Lecture Slide|Tutorials|Lab Materials|Past Year Questions|Assignments & Projects|Source Code & References|Recordings & Media|Reference)$/.test(folder.name));
        if (!twin && (keepFolders.has(folder.id) || !leftover)) continue;
        trash.set(folder.id, { ...folder, reason: 'Empty folder' }); changed = true;
      }
    }
    const items = [...trash.values()].map(file => ({ id: file.id, name: file.name, folder: file.mimeType === FOLDER, size: Number(file.size) || 0, reason: file.reason }));
    return { items, bytes: items.reduce((sum, item) => sum + item.size, 0), kept: kept.size };
  }
  async function trashFile(id) {
    const response = await api('/drive/v3/files/' + encodeURIComponent(id) + '?fields=id,trashed', jsonOptions('PATCH', { trashed: true }));
    if (response.status === 404) return false;
    await json(response);
    return true;
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
      const managed = await listManagedFolders(job.binding);
      job.folders = await ensureManagedFolders(job.binding, courses, managed);
      // Every existing managed folder by identity, so a folder needed only later in the job (the links index's
      // "Materials" folder) is reused instead of created again; that once left one empty folder per sync.
      job.folderIndex = Object.fromEntries(managed.filter(file => !file.trashed && file.appProperties?.folderKey).map(file => [file.appProperties.folderKey, file.id]));
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
      const newKey = await core.hashParts([missing.key, missing.archiveId]);
      const existingId = job.folderIndex?.[newKey];
      if (existingId) { job.folders[missing.key] = existingId; return job; }
      // A numbered folder from an earlier version ("1.Lecture Slide") is renamed in place, so anything the student
      // put inside it stays, and no second folder appears.
      const [, courseId, ...rest] = missing.key.split(':');
      const legacy = missing.key.startsWith('category:') && scan()?.LEGACY_CATEGORY?.[rest.join(':')];
      const legacyId = legacy && job.folderIndex?.[await core.hashParts(['category:' + courseId + ':' + legacy, missing.archiveId])];
      if (legacyId && !Object.values(job.folders).includes(legacyId)) {
        const response = await api('/drive/v3/files/' + encodeURIComponent(legacyId) + '?fields=' + encodeURIComponent(FIELDS),
          jsonOptions('PATCH', { name: missing.name, appProperties: { folderKey: newKey } }));
        if (response.ok) {
          job.folders[missing.key] = legacyId;
          job.folderIndex[newKey] = legacyId;
          return job;
        }
      }
      const id = await generatedId();
      job.folderIntent = { key: missing.key, id, metadata: { id, name: missing.name, mimeType: FOLDER,
        ...(missing.parent ? { parents: [job.folders[missing.parent]] } : {}), appProperties: { bindingHash: job.bindingHash,
          archiveId: missing.archiveId, folderKey: await core.hashParts([missing.key, missing.archiveId]), purpose: missing.key.split(':')[0] } } };
      return job;
    }
    if (!job.remoteFiles) { job.remoteFiles = await findManagedFiles(job.bindingHash, job.binding.settings.archiveId); return job; }
    if (job.cursor >= job.materials.length) {
      // Links go into one clickable "Links" Google Doc per course, one course per step.
      const archiveId = job.binding.settings.archiveId;
      if (!job.linkDocs) {
        const selected = job.binding.settings.courseIds.map(String);
        job.binding.driveLinks = { ...job.binding.driveLinks, [archiveId]: [...(job.binding.driveLinks?.[archiveId] || []).filter(link => !selected.includes(String(link.courseId))), ...job.links] };
        job.linkDocs = { pending: coursesFor(job).map(course => course.id), legacyChecked: false };
        return job;
      }
      if (job.linkDocs.pending.length) {
        await writeLinksDoc(job, job.linkDocs.pending[0]);
        job.linkDocs.pending.shift();
        return job;
      }
      if (!job.linkDocs.legacyChecked) {
        // The single "Spectrum links.md" of earlier versions is replaced by the course Docs; it goes to Drive trash unless the student renamed it.
        const legacyKey = await core.hashParts([job.bindingHash, archiveId, 'link-index']);
        const legacy = job.remoteFiles.find(file => file.sourceKey === legacyKey && !file.trashed && file.name === 'Spectrum links.md');
        if (legacy) await trashFile(legacy.id);
        job.linkDocs.legacyChecked = true;
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
    let remote = matches[0] || null;
    if (!job.upload) {
      if (material.kind === 'link' || material.sizeBytes > LIMIT || (job.binding.settings.videoPolicy !== 'include' && core.isVideoMaterial(material))) {
        try { job.links.push({ name: material.name, displayName: material.displayName || null, section: material.section || '', sourceUrl: safeLink(material.sourceUrl), courseId: material.courseId }); }
        catch (err) { return finish(job, material, 'failed', err.code || 'UNSAFE_LINK'); }
        return finish(job, material, 'linked');
      }
      if (remote && !remote.trashed && material.kind !== 'generated') remote = await placeRemote(job, material, remote);
      // An extra copy that clean-up moved to trash: the identical file left in the same folder still holds it.
      // The kept copy may since have been renamed to its own Spectrum title or sorted into another type folder of the course.
      const courseFolders = new Set(Object.entries(job.folders || {}).filter(([key]) => key.startsWith('category:' + material.courseId + ':')).map(([, id]) => id));
      if (remote?.trashed && remote.contentSha256 && material.kind !== 'generated' && (job.remoteFiles || []).some(file => !file.trashed &&
          file.contentSha256 === remote.contentSha256 && file.uploadedMd5 && (file.parents || []).some(id => courseFolders.has(id)))) {
        return finish(job, material, 'skipped', 'Same file already in this folder');
      }
      const action = core.decideFileAction({ ...material, contentSha256: null }, remote);
      if (['skip', 'trashed', 'conflict'].includes(action)) return finish(job, material, action === 'skip' ? 'skipped' : action);
      let source;
      try { source = await readSource(material, job.binding.settings.videoPolicy); }
      catch (err) { return finish(job, material, 'failed', err.code || 'SOURCE_READ_FAILED'); }
      if (source.linked) { job.links.push({ name: material.name, sourceUrl: safeLink(material.sourceUrl), courseId: material.courseId }); return finish(job, material, 'linked'); }
      const hash = await core.hashBytes(source.bytes);
      if (!remote && material.kind !== 'generated') {
        const twin = await adoptTwin(job, material, hash);
        if (twin?.shared) return finish(job, material, 'skipped', 'Same file already in this folder');
        if (twin) return finish(job, material, 'skipped', 'Reused identical copy already in Drive');
      }
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
      const response = await api('/drive/v3/files/' + encodeURIComponent(upload.fileId) + '?fields=' + encodeURIComponent(FIELDS),
        jsonOptions('PATCH', { appProperties: props }, ifMatch(job, current)));
      if (response.status === 412 && !job.skipIfMatch) { job.skipIfMatch = true; return job; }
      const file = normalize(await json(response));
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
        const parent = targetFolder(job, material);
        const response = await api('/drive/v3/files?fields=' + encodeURIComponent(FIELDS), jsonOptions('POST', { id: upload.fileId, name: driveName(material),
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
      const samePending = current.appProperties?.pendingSha256 === upload.hash;
      if (current.trashed) return finish(job, material, 'trashed');
      // Bytes already match this upload (for example a lost completion response): only the metadata commit remains.
      if (samePending && current.sha256Checksum === upload.hash && current.md5Checksum) { upload.completedMd5 = current.md5Checksum; upload.phase = 'finalize'; return job; }
      if ((!current.uploadedMd5 || current.md5Checksum !== current.uploadedMd5) && !placeholder(current)) return finish(job, material, 'conflict');
      upload.etag = current.etag;
      upload.phase = 'start';
      return job;
    }
    if (upload.phase === 'start') {
      const current = await getFile(upload.fileId);
      if (!current) return finish(job, material, 'conflict', 'Managed file was removed');
      assertOwned(current, job, material.sourceKey);
      if (current.trashed) return finish(job, material, 'trashed');
      if (!placeholder(current) && (!current.uploadedMd5 || current.md5Checksum !== current.uploadedMd5)) return finish(job, material, 'conflict');
      const headers = { 'X-Upload-Content-Type': upload.mimeType, 'X-Upload-Content-Length': String(upload.size), ...ifMatch(job, current) };
      const response = await api('/upload/drive/v3/files/' + encodeURIComponent(upload.fileId) + '?uploadType=resumable&fields=' + encodeURIComponent(FIELDS),
        jsonOptions('PATCH', { appProperties: pendingProperties(job, material, upload.hash) }, headers));
      if (response.status === 412 && !job.skipIfMatch) { job.skipIfMatch = true; return job; }
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
  const exported = { findManagedFiles, ensureManagedFolders, runDriveStep, acknowledgedOffset, listAppFiles, planCleanup, trashFile };
  root.UmSpecDrive = exported;
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
})(globalThis);
