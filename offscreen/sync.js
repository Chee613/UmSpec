/* Background reader for Drive sync. It only answers the extension's own worker and only reads Spectrum. */
(() => {
  'use strict';
  const ORIGIN = 'https://spectrum.um.edu.my';
  const scan = globalThis.UmSpecCourseScan, materials = globalThis.UmSpecMaterials;
  const fail = (code, message) => Object.assign(new Error(message), { code });
  let controller = null;

  async function page(url, signal) {
    const response = await fetch(url, { credentials: 'include', cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(25000)]) });
    const final = new URL(response.url || url);
    if (final.origin !== ORIGIN || /\/login(?:[/.]|$)/i.test(final.pathname)) throw fail('LOGIN_REQUIRED', 'Sign in to Spectrum again.');
    if (!response.ok) throw fail('SPECTRUM_UNAVAILABLE', 'Spectrum page could not be read (' + response.status + ').');
    const html = await response.text();
    if (/<form[^>]+id=["']login["']|name=["']password["']/i.test(html.slice(0, 200000))) throw fail('LOGIN_REQUIRED', 'Spectrum session expired.');
    return html;
  }
  // The signed-in account is read from Moodle's own configuration (M.cfg.userId); a second read covers a one-off short page.
  async function context(signal) {
    for (let attempt = 1; ; attempt++) {
      const html = await page(ORIGIN + '/my/', signal);
      const config = html.match(/M\.cfg\s*=\s*(\{[\s\S]*?\})\s*;/);
      let userId = null;
      try { userId = config ? String(JSON.parse(config[1]).userId ?? '') : null; } catch {}
      if (!/^[1-9]\d*$/.test(userId || '')) userId = html.match(/"userId"\s*:\s*(\d+)/)?.[1] || null;
      if (/^[1-9]\d*$/.test(userId || '')) return { userId, origin: ORIGIN };
      if (attempt >= 2) throw fail('LOGIN_REQUIRED', 'Could not identify the Spectrum account.');
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }
  async function scanCourses(courses, videoPolicy, signal, progress) {
    const out = [];
    const skippedItems = [];
    for (const [index, course] of courses.entries()) {
      signal.throwIfAborted();
      progress({ course: index + 1, courses: courses.length, name: course.fullName });
      const html = await page(ORIGIN + '/course/view.php?id=' + encodeURIComponent(course.id), signal);
      const { items } = scan.parseCourseActivitiesFromHTML(html, course, DOMParser);
      for (const item of items) {
        signal.throwIfAborted();
        // Same rules as the Spectrum tab's Drive scan: one unreadable item is counted and skipped.
        try {
          const files = item.isVideo && videoPolicy !== 'include' ? [{ url: item.url, name: item.name, kind: 'link' }]
            : await materials.resolveItemFiles(item, signal, videoPolicy === 'include' ? 'include' : 'links');
          for (const file of files) {
            try { out.push(await materials.describeMaterial(course, { ...item, fileCount: files.length }, file, '')); } catch (error) { skippedItems.push(materials.skippedItem(item, error)); }
          }
        } catch (error) {
          if (error?.name === 'AbortError' || signal.aborted || error?.code === 'LOGIN_REQUIRED') throw error;
          skippedItems.push(materials.skippedItem(item, error));
        }
      }
    }
    return { materials: [...new Map(out.map(item => [item.sourceKey, item])).values()], skipped: skippedItems.length, skippedItems: skippedItems.slice(0, 20) };
  }

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.target !== 'umspec-offscreen' || sender.id !== chrome.runtime.id || sender.tab) return;
    if (message.type === 'STOP') { controller?.abort(); reply({ ok: true }); return; }
    controller = new AbortController();
    const signal = controller.signal;
    const progress = detail => chrome.runtime.sendMessage({ target: 'umspec-worker', type: 'BG_SCAN_PROGRESS', ...detail }).catch(() => {});
    const task = message.type === 'CONTEXT' ? context(signal) : message.type === 'SCAN' ? scanCourses(message.courses || [], message.videoPolicy, signal, progress) : Promise.reject(fail('INVALID_MESSAGE', 'Unknown request.'));
    task.then(data => reply({ ok: true, data }), error => reply({ ok: false, error: { code: error.code || (error.name === 'AbortError' ? 'ABORTED' : 'REQUEST_FAILED'), message: String(error.message).slice(0, 240) } }));
    return true;
  });
})();
