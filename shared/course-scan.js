/* Course page scanning shared by the Spectrum tab and the background Drive sync (offscreen document). */
(function (root) {
  'use strict';
  const sync = () => root.UmSpecSync || require('./sync-core.js');
  function sanitizeName(name) {
    if (!name) return 'unnamed';
    return name.replace(/[\\/*?:"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 160);
  }
  // Helper: Extract clean course folder name
  function formatCourseFolder(fullName, shortName) {
    const raw = fullName || shortName || 'Course Materials';
    // UM codes have three or four letters (WIA2001, GIG1013, KXEX1110), sometimes with a trailing letter.
    const CODE = /\b([A-Z]{3,4}\d{4}[A-Z]?)\b/i;
    const codeMatch = raw.match(CODE) || (shortName || '').match(CODE);
    const code = codeMatch ? codeMatch[1].toUpperCase() : '';

    let title = raw
      .replace(/\b[A-Z]{3,4}\d{4}[A-Z]?\b(?:\s*\/\s*[A-Z]{3,4}\d{4}[A-Z]?\b)*/gi, ' ')
      .replace(/[\(\[\{].*?[\)\]\}]/g, ' ')
      .replace(/\b(sem(?:ester)?\s*\d+|20\d\d\s*\/\s*20\d\d|occ\s*\d+|sec(?:tion)?\s*\d+|kumpulan\s*\d+)\b/gi, ' ')
      .replace(/[^\w\s]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const titleWords = title
      .split(' ')
      .filter(w => w.length > 0)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

    const cleanTitle = titleWords.join(' ') || 'Course Materials';
    return sanitizeName(code ? `${code} ${cleanTitle}` : cleanTitle);
  }

  // ---------- File types ----------
  // Folder names are the category ids. Words match whole words only: "example" is not "exam", "syllabus" is not "lab".
  const CATEGORY = { lecture: 'Lecture Slides', tutorial: 'Tutorials', lab: 'Labs', assignment: 'Assignments & Projects',
    test: 'Past Year & Tests', info: 'Course Info', code: 'Source Code', media: 'Recordings & Media' };
  // Earlier versions used numbered folders; Drive sync renames those folders instead of making new ones.
  const LEGACY_CATEGORY = { 'Lecture Slides': '1.Lecture Slide', Tutorials: '2.Tutorials', Labs: '3.Lab Materials',
    'Assignments & Projects': '5.Assignments & Projects', 'Past Year & Tests': '4.Past Year Questions', 'Source Code': '6.Source Code & References',
    'Recordings & Media': '7.Recordings & Media' };
  const words = list => new RegExp('(?:^|[^\\p{L}\\p{N}])(?:' + list.join('|') + ')(?=$|[^\\p{L}\\p{N}])', 'iu');
  const RULES = [
    [CATEGORY.info, words(['pro-?forma', 'course outline', 'course info(?:rmation)?', 'course plan', 'teaching plan', 'syllabus', 'synopsis', 'sinopsis', 'learning outcomes?', 'course briefing', 'hasil pembelajaran', 'maklumat kursus', 'rancangan pengajaran', 'mqf'])],
    [CATEGORY.test, words(['past years?', 'pyq', 'exams?', 'examinations?', 'final exam', 'peperiksaan', 'sample papers?', 'mid[- ]?terms?', 'mid[- ]?sem(?:ester)?', 'tests?', 'quiz(?:zes)?', 'kuiz', 'ujian'])],
    // A lab sheet ("Lab 2 worksheet") is a lab, so labs are checked before tutorial words.
    [CATEGORY.lab, words(['labs?', 'lab\\s*\\d+', 'laboratory', 'practicals?', 'amali', 'makmal', 'hands-on'])],
    [CATEGORY.tutorial, words(['tutorials?', 'tut\\s*\\d+', 'tuto\\d*', 'exercises?', 'latihan', 'worksheets?', 'problem sets?'])],
    [CATEGORY.assignment, words(['assignments?', 'projects?', 'tugasan', 'rubrics?', 'milestones?', 'proposals?', 'reports?', 'case stud(?:y|ies)', 'group work'])],
    [CATEGORY.media, words(['recordings?', 'videos?', 'webinars?', 'panopto', 'zoom meeting', 'rakaman'])],
    [CATEGORY.code, words(['source code', 'sample code', 'starter code', 'codes?', 'scripts?'])],
    [CATEGORY.lecture, words(['lectures?', 'slides?', 'kuliah', 'notes?', 'nota', 'chapters?', 'topics?', 'weeks?', 'minggu', 'units?', 'modules?'])]
  ];
  // '.php' is left out: every Spectrum activity address ends in view.php.
  const CODE_EXT = ['.py', '.java', '.c', '.cpp', '.sql', '.js', '.css', '.ipynb', '.dart', '.kt', '.r'];
  const MEDIA_EXT = ['.mp4', '.mkv', '.avi', '.mov', '.mp3', '.webm', '.flv', '.m4v'];
  function classifyAdaptiveCategory(actName, secName, ext) {
    const e = (ext || '').toLowerCase();
    if (MEDIA_EXT.includes(e)) return { id: CATEGORY.media, label: CATEGORY.media };
    if (CODE_EXT.includes(e)) return { id: CATEGORY.code, label: CATEGORY.code };
    // The activity's own title decides first; the section ("Group Project", "Week 4") only when the title says nothing.
    for (const text of [actName, secName]) {
      for (const [id, pattern] of RULES) if (pattern.test(String(text || ''))) return { id, label: id };
    }
    return { id: CATEGORY.lecture, label: CATEGORY.lecture };
  }

  // ---------- File names: "W04 Normalization - Compact Notes.pptx" ----------
  function weekOf(...texts) {
    for (const text of texts) {
      const match = String(text || '').match(/\b(?:week|wk|minggu|w)\s*[-:#.]?\s*0*(\d{1,2})\b/i);
      if (match && Number(match[1]) >= 1 && Number(match[1]) <= 20) return Number(match[1]);
    }
    return null;
  }
  // Courses are organised by week, topic, chapter, lecture, unit, module or session; each gets its own letter so files
  // still sort in teaching order: W04, T03 (Topic/Topik), C02 (Chapter), B02 (Bab), L05 (Lecture/Kuliah), U01, M01, S01.
  const ORDER_LABELS = [['W', 'week|wk|minggu|w'], ['T', 'topic|topik'], ['C', 'chapter|chap|ch'], ['B', 'bab'],
    ['L', 'lecture|lec|kuliah'], ['U', 'unit'], ['M', 'module|modul'], ['S', 'session|sesi']];
  const ORDER_PATTERNS = ORDER_LABELS.map(([letter, names]) => [letter, new RegExp('\\b(?:' + names + ')\\.?\\s*[-:#.]?\\s*0*(\\d{1,2})\\b', 'i')]);
  function sequenceOf(...texts) {
    for (const text of texts) {
      // The earliest label in the text wins, so "Topic 3: Lecture 5 notes" is T03.
      let best = null;
      for (const [letter, pattern] of ORDER_PATTERNS) {
        const match = String(text || '').match(pattern);
        if (match && Number(match[1]) >= 1 && Number(match[1]) <= 40 && (!best || match.index < best.index)) best = { letter, number: Number(match[1]), index: match.index };
      }
      if (best) return { letter: best.letter, number: best.number };
    }
    return null;
  }
  const STARTS_WITH_ORDER = new RegExp('^(?:' + ORDER_LABELS.map(([, names]) => names).join('|') + ')\\.?\\s*\\d{1,2}\\b', 'i');
  const extensionOf = name => String(name || '').match(/(\.[a-z0-9]{1,6})$/i)?.[1]?.toLowerCase() || '';
  function cleanTitle(value) {
    return String(value || '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').replace(/\s*\(\d+\)(?=\s*$)/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  // Activity title as shown on Spectrum, prefixed with its week; a folder or assignment with several files adds each file's own name.
  function displayName({ title, section, fileName, multiple = false }) {
    const ext = extensionOf(fileName);
    // An image pasted into a text block has no title of its own ("Material"), so its file name is used instead.
    const titled = /^(?:material|file|image)?$/i.test(cleanTitle(title)) ? '' : cleanTitle(title);
    let base = titled || cleanTitle(fileName.replace(/\.[^.]+$/, '')) || 'Material';
    const own = cleanTitle(String(fileName || '').replace(/\.[^.]+$/, ''));
    if (multiple && own && own.toLowerCase() !== base.toLowerCase()) base += ' - ' + own;
    // A title that already starts with its number ("Week 4 Tutorial", "Topic 3 Intro") keeps it; the prefix only adds what is missing.
    const order = sequenceOf(section, title);
    const prefix = order && !STARTS_WITH_ORDER.test(base) ? order.letter + String(order.number).padStart(2, '0') + ' ' : '';
    if (ext && base.toLowerCase().endsWith(ext)) base = base.slice(0, -ext.length).trim();
    // A title ending in a full stop ("Pop Quiz. DC.") would otherwise give "..pdf".
    base = base.replace(/[.\s]+$/, '');
    return (prefix + base).slice(0, 140).trim() + ext;
  }
  // Submission, attendance and quiz pages are things to do, not materials, so they stay out of the Links document.
  function isMaterialLink(name, url) {
    // Section shortcuts (course/section.php) only jump around the course page.
    if (/\/mod\/(?:assign|quiz|attendance|forum|feedback|choice|turnitintooltwo|questionnaire|workshop|lti|chat)\/|\/course\/(?:section|view)\.php/i.test(String(url || ''))) return false;
    return !/\b(?:submission|submit|hantar|attendance|kehadiran|quiz|kuiz|feedback|turnitin|evaluation form)\b/i.test(String(name || ''));
  }

  const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.mp3', '.webm', '.flv', '.m4v', '.wav', '.ogg'];
  const EXTERNAL_VIDEO_DOMAINS = [
    'panopto.com',
    'panopto.eu',
    'zoom.us',
    'teams.microsoft.com',
    'microsoftstream.com',
    'webex.com',
    'youtube.com',
    'youtu.be',
    'drive.google.com',
    'vimeo.com',
    'echo360',
    'loom.com'
  ];

  function isExternalVideoUrl(url) {
    if (!url) return false;
    const lower = url.toLowerCase();
    return EXTERNAL_VIDEO_DOMAINS.some(domain => lower.includes(domain));
  }

  function isVideoActivity(actName, actUrl, modType, categoryId) {
    if (sync().isVideoMaterial({ name: actName, url: actUrl, type: modType, category: categoryId })) return true;
    const text = `${actName}`.toLowerCase();
    const extMatch = (actUrl || '').match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
    const ext = extMatch ? `.${extMatch[1].toLowerCase()}` : '';

    if (VIDEO_EXTENSIONS.includes(ext)) return true;
    if (categoryId === CATEGORY.media) return true;
    if (['kalvidres', 'panopto'].includes(modType)) return true;
    if (text.includes('recording') || text.includes('lecture video') || text.includes('webinar') || text.includes('zoom meeting') || text.includes('panopto')) return true;

    return false;
  }

  // Parse activities from course HTML (shared by drawer, pre-flight analysis, and export)
  // Lecturers sometimes paste "Join: https://…" into a link's address, which the browser reads as a "join:" address;
  // the real https address inside it is used instead.
  function repairLink(value) {
    const text = String(value || '').trim();
    if (/^https?:\/\//i.test(text) || text.startsWith('/')) return text;
    return text.match(/https:\/\/[^\s"'<>]+/i)?.[0] || text;
  }
  function parseCourseActivitiesFromHTML(cHtml, course, Parser = root.DOMParser) {
    const cDoc = new Parser().parseFromString(cHtml, 'text/html');
    if (cDoc.querySelector('form#login, input[name="password"]')) throw new Error('Spectrum session expired. Sign in again.');
    const items = [];
    const externalLinks = [];
    const seenUrls = new Set();

    const sections = cDoc.querySelectorAll('.course-content ul.topics > li, .course-content ul.weeks > li, .course-content .section');
    sections.forEach(sec => {
      const secTitleEl = sec.querySelector('.sectionname, .section-title, h3');
      const secName = secTitleEl ? secTitleEl.innerText.trim() : 'General';

      sec.querySelectorAll('.activity').forEach(act => {
        const modClasses = Array.from(act.classList).filter(c => c.startsWith('modtype_'));
        const modType = modClasses.length ? modClasses[0].replace('modtype_', '') : '';
        // Subsections only group other activities, and chat rooms hold no course files.
        if (['attendance', 'forum', 'feedback', 'choice', 'subsection', 'chat'].includes(modType)) return;

        const inst = act.querySelector('.instancename');
        let actName = inst ? inst.innerText.trim() : 'Material';
        ['File', 'URL', 'Assignment', 'Folder', 'Page', 'External tool'].forEach(sfx => {
          if (actName.endsWith(sfx)) actName = actName.slice(0, -sfx.length).trim();
        });

        const link = act.querySelector('a');
        if (!link || !link.href) return;
        const actUrl = repairLink(link.href);
        // Labels and inline files have no view.php link, so keep Moodle's own module ID for a stable Drive identity.
        const moduleId = (act.id || '').match(/^module-(\d+)$/)?.[1] || act.getAttribute?.('data-id') || undefined;
        if (seenUrls.has(actUrl)) return;
        seenUrls.add(actUrl);

        if (isExternalVideoUrl(actUrl)) {
          externalLinks.push({ title: actName, url: actUrl, section: secName, isStreaming: true });
          items.push({
            name: actName,
            url: actUrl,
            type: modType,
            category: CATEGORY.media,
            section: secName,
            isVideo: true,
            isExternal: true,
            courseName: course?.fullName || '',
            courseFolder: course?.folderName || ''
          });
          return;
        }

        const extMatch = actUrl.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
        const ext = extMatch ? `.${extMatch[1]}` : '';
        const cat = classifyAdaptiveCategory(actName, secName, ext);
        const isVideo = isVideoActivity(actName, actUrl, modType, cat.id);
        const isProforma = /proforma|pro-forma|course outline|maklumat kursus|syllabus/i.test(actName);

        items.push({
          name: actName,
          url: actUrl,
          type: modType,
          moduleId,
          category: cat.id,
          section: secName,
          isVideo,
          isProforma,
          courseName: course?.fullName || '',
          courseFolder: course?.folderName || ''
        });
      });

      sec.querySelectorAll('a[href*="youtu.be"], a[href*="youtube.com"], a[href*="drive.google.com"], a[href*="panopto."], a[href*="zoom.us"], a[href*="teams.microsoft.com"], a[href*="webex.com"], a[href*="echo360."], a[href*="vimeo.com"], a[href*="loom.com"]').forEach(ea => {
        const url = repairLink(ea.href);
        if (!seenUrls.has(url)) {
          seenUrls.add(url);
          const title = ea.innerText.trim() || 'External Lecture Link';
          externalLinks.push({ title, url, section: secName, isStreaming: true });
          items.push({
            name: title,
            url,
            type: 'url',
            category: CATEGORY.media,
            section: secName,
            isVideo: true,
            isExternal: true,
            courseName: course?.fullName || '',
            courseFolder: course?.folderName || ''
          });
        }
      });
    });

    return { items, externalLinks };
  }

  const api = { sanitizeName, formatCourseFolder, classifyAdaptiveCategory, isExternalVideoUrl, isVideoActivity, parseCourseActivitiesFromHTML, VIDEO_EXTENSIONS,
    CATEGORY, LEGACY_CATEGORY, weekOf, sequenceOf, displayName, isMaterialLink, repairLink };
  root.UmSpecCourseScan = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
