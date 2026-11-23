/* AI reading of a course page's OCC labels ("G1", "Group 1M", lecturer sections). Only the course structure is sent:
 * activity IDs, types, titles, section names and lock text. The student's own OCC never leaves the browser. */
(function (root) {
  'use strict';
  const planner = () => root.UmSpecPlannerCore || (typeof require === 'function' ? require('./planner-core.js') : null);
  const BACKEND = 'https://umspec-ai.tankeat0613.workers.dev/api/v1/course/layout';
  const MAX = 400;
  const text = node => String(node?.textContent || '').replace(/\s+/g, ' ').trim();

  // The course page as the backend sees it. Each activity is read from its own <li id="module-N">.
  function layoutActivities(doc) {
    const out = [];
    for (const element of doc.querySelectorAll('li.activity[id^="module-"]')) {
      const id = element.id.slice(7);
      if (!/^[1-9]\d*$/.test(id) || out.some(item => item.id === id)) continue;
      const nameNode = element.querySelector('.instancename, .activityname')?.cloneNode(true);
      nameNode?.querySelectorAll?.('.accesshide, .sr-only, .visually-hidden').forEach(n => n.remove());
      const section = element.closest('li.section, [data-for="section"], .course-section, section.section');
      const heading = section && ['.sectionname', 'h3', '.section-title', '[data-for="section_title"]'].map(s => section.querySelector(s)).find(Boolean);
      const lock = text(element.querySelector('.availabilityinfo, [data-region="availabilityinfo"]'));
      out.push({ id, type: [...element.classList].find(c => c.startsWith('modtype_'))?.slice(8) || '',
        name: text(nameNode).replace(/\s*(?:Not available unless|Tidak tersedia melainkan)\b.*$/i, '').slice(0, 140),
        section: text(heading).slice(0, 120) || 'General', lock: /not available|tidak tersedia/i.test(lock) ? lock.slice(0, 160) : '' });
      if (out.length >= MAX) break;
    }
    return out;
  }

  // An answer is kept only if Spectrum's own data agrees: where a lock names a group ("GROUP 7 2026/2027_1") or a title
  // already names an OCC, the AI must say the same. One disagreement discards the whole answer for that course.
  function checkLayout(layout, activities) {
    const core = planner();
    if (!layout || typeof layout !== 'object' || !layout.activities || typeof layout.activities !== 'object') return { ok: false, reason: 'No answer.' };
    const byId = new Map(activities.map(a => [a.id, a]));
    for (const [id, entry] of Object.entries(layout.activities)) {
      const activity = byId.get(id);
      if (!activity || !Array.isArray(entry?.occ) || !entry.occ.length) return { ok: false, reason: 'Unknown activity ' + id + '.' };
      for (const evidence of [core.parseOcc(activity.lock), core.parseOcc(activity.name)]) {
        if (evidence && !evidence.some(token => entry.occ.includes(token))) return { ok: false, reason: '"' + activity.name + '" disagrees with Spectrum.' };
      }
    }
    return { ok: true };
  }

  // OCC tokens for one activity: its own label first, then the AI's reading of it, then the AI's reading of its section.
  function occFor(layout, activity) {
    const own = planner().parseOcc([activity?.name, activity?.lock].filter(Boolean).join(' '));
    if (own) return own;
    return layout?.activities?.[String(activity?.id)]?.occ || layout?.sections?.[activity?.section]?.occ || null;
  }

  async function digest(activities) {
    // The version prefix makes answers from an older parser count as stale.
    const bytes = new TextEncoder().encode('layout-v3' + JSON.stringify(activities));
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  async function requestLayout({ courseId, courseCode, activities }, fetcher = root.fetch.bind(root)) {
    const response = await fetcher(BACKEND, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courseId, courseCode, activities }), signal: AbortSignal.timeout(40000) });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) throw Object.assign(new Error(data?.error || 'AI course reading failed (' + response.status + ').'), { code: 'AI_FAILED' });
    return { activities: data.activities || {}, sections: data.sections || {}, groupStyle: String(data.groupStyle || '').slice(0, 200) };
  }

  const api = { BACKEND, layoutActivities, checkLayout, occFor, digest, requestLayout };
  root.UmSpecCourseAI = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
