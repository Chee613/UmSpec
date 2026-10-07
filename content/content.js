/**
 * UmSpec - SPeCTRUM Course Exporter (Zero-Touch Smart Edition)
 * Client-side browser extension for Universiti Malaya (UM) SPeCTRUM.
 */

(function () {
  'use strict';

  if (window.__umspec_injected) return;
  window.__umspec_injected = true;

  console.log('[UmSpec] Zero-Touch Smart Exporter initialized on SPeCTRUM');

  const SPEC_STACK_ICON = "<svg aria-hidden=\"true\" focusable=\"false\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 128 128\">\n  <path fill=\"#fff\" fill-rule=\"evenodd\" d=\"M24 12h77q4 0 7 3l14 14q2 2 2 6v11q0 3-3 3H42l7 8h47q4 0 7 3l14 14q3 3 3 8v29q0 4-4 4H28q-4 0-7-3L8 99q-4-4-4-8v-8q0-3 4-3h77l-9-9H30q-4 0-7-3L10 55q-2-2-2-6V32q0-4 3-7l10-10q2-3 3-3Zm75 8v17h17L99 20Zm-3 45v16h16L96 65Z\"/>\n</svg>";

  // State
  let detectedCourses = [];
  let selectedCourseIds = new Set();
  let studentProfile = null;
  let isExporting = false;
  let sesskey = null;

  // Glyph (Solid Filled) SVG Icons
  const ICONS = {
    zap: `<svg class="umspec-svg" viewBox="0 0 24 24"><path d="M13 2L3 14h8l-1 8 10-12h-8l1-8z"/></svg>`,
    zapLg: `<svg class="umspec-svg umspec-svg-lg" viewBox="0 0 24 24"><path d="M13 2L3 14h8l-1 8 10-12h-8l1-8z"/></svg>`,
    graduationCap: `<svg class="umspec-svg" viewBox="0 0 24 24"><path d="M12 2L1 7l11 5 9-4.09V17h2V7L12 2zm-7 8.18V16c0 3.31 3.13 6 7 6s7-2.69 7-6v-5.82l-7 3.18-7-3.18z"/></svg>`,
    bookOpen: `<svg class="umspec-svg" viewBox="0 0 24 24"><path d="M19 1H5a2 2 0 0 0-2 2v18a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2zm-1 18H6V4h12v15zm-2-8H8v-2h8v2zm0-4H8V5h8v2z"/></svg>`,
    download: `<svg class="umspec-svg" viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>`,
    loader: `<svg class="umspec-svg umspec-spin" viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z" opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10h-2.5A7.5 7.5 0 0 0 12 4.5V2z"/></svg>`,
    alertCircle: `<svg class="umspec-svg" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`,
    checkCircle: `<svg class="umspec-svg" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>`,
    folderArchive: `<svg class="umspec-svg" viewBox="0 0 24 24"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>`
  };

  // Helper: Sanitize folder/file names
  function sanitizeName(name) {
    if (!name) return 'unnamed';
    return name
      .replace(/[\\/*?:"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160);
  }

  // Helper: Extract clean course folder name with full title in Title Case (e.g. "WIA2007 Mobile Application Development")
  function formatCourseFolder(fullName, shortName) {
    const raw = fullName || shortName || 'Course Materials';

    // 1. Extract course code (e.g. "WIA2007")
    const codeMatch = raw.match(/([A-Z]{3}\d{4})/i) || (shortName || '').match(/([A-Z]{3}\d{4})/i);
    const code = codeMatch ? codeMatch[1].toUpperCase() : '';

    // 2. Clean title: remove course codes, cross-listings, semester tags, brackets, and extra noise
    let title = raw
      .replace(/[A-Z]{3}\d{4}(?:\s*\/\s*[A-Z]{3}\d{4})*/gi, ' ')
      .replace(/[\(\[\{].*?[\)\]\}]/g, ' ')
      .replace(/\b(sem(?:ester)?\s*\d+|20\d\d\s*\/\s*20\d\d|occ\s*\d+|sec(?:tion)?\s*\d+|kumpulan\s*\d+)\b/gi, ' ')
      .replace(/[^\w\s]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // 3. Capitalize first letter of every word (Title Case)
    const titleWords = title
      .split(' ')
      .filter(w => w.length > 0)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

    const cleanTitle = titleWords.join(' ') || 'Course Materials';

    return sanitizeName(code ? `${code} ${cleanTitle}` : cleanTitle);
  }

  // Department / Keyword to Standard Degree Mapper
  function mapDepartmentToDegree(text) {
    if (!text) return null;
    const t = text.toLowerCase();

    if (t.includes('artificial intelligence') || t.includes('kecerdasan buatan')) {
      return 'Bachelor of Computer Science (Artificial Intelligence)';
    }
    if (t.includes('software engineering') || t.includes('kejuruteraan perisian')) {
      return 'Bachelor of Computer Science (Software Engineering)';
    }
    if (t.includes('data science') || t.includes('sains data')) {
      return 'Bachelor of Computer Science (Data Science)';
    }
    if (t.includes('computer system') || t.includes('networking') || t.includes('sistem komputer') || t.includes('rangkaian')) {
      return 'Bachelor of Computer Science (Computer Systems and Networking)';
    }
    if (t.includes('information system') || t.includes('sistem maklumat')) {
      return 'Bachelor of Information Technology (Information Systems)';
    }
    if (t.includes('library') || t.includes('perpustakaan') || t.includes('sains maklumat')) {
      return 'Bachelor of Information Science (Library Management)';
    }
    if (t.includes('engineering') || t.includes('kejuruteraan')) {
      return 'Bachelor of Engineering';
    }
    return null;
  }

  // Calculate Average Academic Year
  function calculateYearSemester(courses) {
    const codes = courses.map(c => {
      const m = c.fullName.match(/([A-Z]{3})(\d)(\d{3})/i);
      return m ? parseInt(m[2]) : null;
    }).filter(y => y && y > 0 && y <= 4);

    const avgYear = codes.length ? Math.round(codes.reduce((a, b) => a + b, 0) / codes.length) : 2;
    return `Year ${avgYear}, Semester 1`;
  }

  // Multi-Source Integrated Academic Profile Detection Pipeline
  async function detectAcademicProfile(courses, userName) {
    // TIER 0: Saved User Choice in Local Storage / Extension Storage
    const savedDegree = localStorage.getItem('umspec_saved_degree');
    if (savedDegree) {
      return {
        studentName: userName || 'UM Student',
        faculty: 'Faculty of Computer Science & Information Technology (FSKTM)',
        bachelor: savedDegree,
        yearSem: calculateYearSemester(courses),
        totalCourses: courses.length,
        detectionSource: 'Saved User Preference'
      };
    }

    let detectedBachelor = null;
    let detectedFaculty = 'Universiti Malaya';
    let detectionSource = 'Heuristic';

    const sesskey = getSesskey();

    // TIER 1: Moodle AJAX WebService API (core_user_get_users_by_field)
    if (sesskey) {
      try {
        const userId = window.M?.cfg?.userId || document.querySelector('a[href*="/user/profile.php?id="], a[href*="/user/view.php?id="]')?.href?.match(/id=(\d+)/)?.[1];
        if (userId) {
          const apiRes = await fetch(`https://spectrum.um.edu.my/lib/ajax/service.php?sesskey=${sesskey}&info=core_user_get_users_by_field`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify([{
              index: 0,
              methodname: 'core_user_get_users_by_field',
              args: { field: 'id', values: [Number(userId)] }
            }])
          });
          const apiData = await apiRes.json();
          if (Array.isArray(apiData) && apiData[0]?.data?.[0]) {
            const u = apiData[0].data[0];
            const deptDegree = mapDepartmentToDegree(u.department || '');
            if (deptDegree) {
              detectedBachelor = deptDegree;
              detectedFaculty = u.institution || 'Faculty of Computer Science & Information Technology (FSKTM)';
              detectionSource = 'Moodle WebService API (LDAP Sync)';
            }
          }
        }
      } catch (e) {
        console.warn('[UmSpec] WebService user profile check skipped:', e);
      }
    }

    // TIER 2: SPeCTRUM User Profile Page Scraping (/user/profile.php)
    if (!detectedBachelor) {
      try {
        const pRes = await fetch('https://spectrum.um.edu.my/user/profile.php', { credentials: 'include' });
        if (pRes.ok) {
          const pHtml = await pRes.text();
          const pDoc = new DOMParser().parseFromString(pHtml, 'text/html');

          const profileNodes = Array.from(pDoc.querySelectorAll('.profile_tree dd, .profile_tree dt, .node_category, dl dt, dl dd'));
          const nodeTexts = profileNodes.map(n => n.innerText.trim()).join(' ');

          const fromProfile = mapDepartmentToDegree(nodeTexts);
          if (fromProfile) {
            detectedBachelor = fromProfile;
            detectedFaculty = nodeTexts.toLowerCase().includes('computer science') || nodeTexts.toLowerCase().includes('fsktm')
              ? 'Faculty of Computer Science & Information Technology (FSKTM)'
              : detectedFaculty;
            detectionSource = 'SPeCTRUM Profile Metadata (/user/profile.php)';
          }
        }
      } catch (e) {
        console.warn('[UmSpec] Profile page scrape skipped:', e);
      }
    }

    // TIER 3: Course Category Tree Breadcrumbs
    if (!detectedBachelor && courses.length > 0) {
      try {
        const firstCid = courses[0].id;
        const cRes = await fetch(`https://spectrum.um.edu.my/course/view.php?id=${firstCid}`, { credentials: 'include' });
        if (cRes.ok) {
          const cHtml = await cRes.text();
          const cDoc = new DOMParser().parseFromString(cHtml, 'text/html');
          const breadcrumbs = Array.from(cDoc.querySelectorAll('.breadcrumb-item, .breadcrumb a, nav[aria-label="Navigation bar"] a'))
            .map(el => el.innerText.trim())
            .join(' > ');

          const fromBreadcrumb = mapDepartmentToDegree(breadcrumbs);
          if (fromBreadcrumb) {
            detectedBachelor = fromBreadcrumb;
            detectedFaculty = 'Faculty of Computer Science & Information Technology (FSKTM)';
            detectionSource = 'Moodle Category Tree (Breadcrumbs)';
          }
        }
      } catch (e) {
        console.warn('[UmSpec] Course breadcrumbs check skipped:', e);
      }
    }

    // TIER 4: Intelligent Curriculum Heuristic Fallback
    if (!detectedBachelor) {
      const codes = courses.map(c => {
        const m = c.fullName.match(/([A-Z]{3})(\d)(\d{3})/i);
        return m ? { prefix: m[1].toUpperCase(), year: parseInt(m[2]), fullCode: m[0].toUpperCase(), title: c.fullName.toLowerCase() } : null;
      }).filter(Boolean);

      const fsktmCount = codes.filter(c => ['WIA', 'WIB', 'WIC', 'WID', 'WIE', 'WIF', 'WIX'].includes(c.prefix)).length;
      if (fsktmCount >= 2) {
        detectedFaculty = 'Faculty of Computer Science & Information Technology (FSKTM)';
        const fullList = codes.map(c => c.fullCode);
        const allTitles = codes.map(c => c.title).join(' ');

        if (
          fullList.some(c => c.startsWith('WIC')) ||
          allTitles.includes('artificial intelligence') ||
          allTitles.includes('machine learning') ||
          allTitles.includes('deep learning') ||
          fullList.includes('WIA2003')
        ) {
          detectedBachelor = 'Bachelor of Computer Science (Artificial Intelligence)';
        } else if (fullList.some(c => c.startsWith('WID')) || allTitles.includes('data science')) {
          detectedBachelor = 'Bachelor of Computer Science (Data Science)';
        } else if (fullList.some(c => c.startsWith('WIE')) || allTitles.includes('software architecture')) {
          detectedBachelor = 'Bachelor of Computer Science (Software Engineering)';
        } else if (fullList.some(c => c.startsWith('WIF')) || allTitles.includes('computer network')) {
          detectedBachelor = 'Bachelor of Computer Science (Computer Systems and Networking)';
        } else if (fullList.some(c => c.startsWith('WIB')) || allTitles.includes('information system')) {
          detectedBachelor = 'Bachelor of Information Technology (Information Systems)';
        } else {
          detectedBachelor = 'Bachelor of Computer Science (Artificial Intelligence)';
        }
        detectionSource = 'Curriculum Heuristic Fallback';
      } else {
        detectedBachelor = 'Bachelor of Computer Science (Artificial Intelligence)';
      }
    }

    console.log(`[UmSpec] Degree Detected via [${detectionSource}]: ${detectedBachelor}`);

    return {
      studentName: userName || 'UM Student',
      faculty: detectedFaculty,
      bachelor: detectedBachelor,
      yearSem: calculateYearSemester(courses),
      totalCourses: courses.length,
      detectionSource
    };
  }

  // Adaptive Dynamic Category Classifier
  function classifyAdaptiveCategory(itemName, sectionName, fileExt) {
    const n = (itemName || '').toLowerCase();
    const s = (sectionName || '').toLowerCase();
    const ext = (fileExt || '').toLowerCase();

    // 1. Past Year Questions (PYQ)
    if (n.includes('pyq') || n.includes('past year') || n.includes('exam paper') || n.includes('final exam') || s.includes('past year') || s.includes('pyq')) {
      return { id: '5.Past Year Questions', label: 'Past Year Questions' };
    }
    // 2. Source Code & Starter Kits
    if (['.java', '.py', '.c', '.cpp', '.sql', '.html', '.js', '.ipynb'].includes(ext) || n.includes('source code') || n.includes('starter kit') || s.includes('source code')) {
      return { id: '6.Source Code', label: 'Source Code & Starter Kits' };
    }
    // 3. Datasets (SPSS, CSV)
    if (['.sav', '.csv', '.xlsx', '.xls'].includes(ext) || n.includes('dataset') || n.includes('data file') || s.includes('dataset')) {
      return { id: '7.Datasets', label: 'Datasets & Statistical Files' };
    }
    // 4. Video & Audio Lectures
    if (['.mp4', '.wmv', '.mov', '.mkv', '.mp3'].includes(ext) || n.includes('recorded lecture') || n.includes('video') || s.includes('video recording')) {
      return { id: '8.Video Lectures', label: 'Recorded Lectures & Videos' };
    }
    // 5. Tutorials
    if (n.includes('tutorial') || s.includes('tutorial')) {
      return { id: '2.Tutorial', label: 'Tutorials & Problem Sets' };
    }
    // 6. Labs / Practicals
    if (n.includes('lab') || n.includes('practical') || n.includes('pbl') || s.includes('lab') || s.includes('practical')) {
      return { id: '3.Lab', label: 'Labs & Practical Guides' };
    }
    // 7. Assignments & Project Briefs
    if (
      n.includes('assignment') || n.includes('assign') || n.includes('project') ||
      n.includes('case study') || n.includes('peer assessment') || n.includes('weekly progress') ||
      n.includes('rubric') || n.includes('declaration form') || s.includes('assignment') || s.includes('group project')
    ) {
      return { id: '4.Assignment', label: 'Assignments & Project Briefs' };
    }
    // 8. References & Textbooks
    if (
      n.includes('book') || n.includes('reference') || n.includes('additional material') ||
      n.includes('extra note') || n.includes('guide') || s.includes('reference') || s.includes('additional')
    ) {
      return { id: '9.Reference', label: 'References & Textbooks' };
    }
    // 9. Default Lecture Slide / Notes
    return { id: '1.Lecture Slide', label: 'Lecture Slides & Notes' };
  }

  // Extract Moodle sesskey
  function getSesskey() {
    if (sesskey) return sesskey;
    if (window.M?.cfg?.sesskey) {
      sesskey = window.M.cfg.sesskey;
      return sesskey;
    }
    const html = document.documentElement.innerHTML;
    const m = html.match(/"sesskey":"([a-zA-Z0-9]+)"/);
    if (m) {
      sesskey = m[1];
      return sesskey;
    }
    const input = document.querySelector('input[name="sesskey"]');
    if (input) {
      sesskey = input.value;
      return sesskey;
    }
    return null;
  }

  // Discover all enrolled courses via Moodle API
  async function discoverCourses() {
    const courses = [];
    const key = getSesskey();

    if (key) {
      try {
        const res = await fetch(`https://spectrum.um.edu.my/lib/ajax/service.php?sesskey=${key}&info=core_course_get_enrolled_courses_by_timeline_classification`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([{
            index: 0,
            methodname: 'core_course_get_enrolled_courses_by_timeline_classification',
            args: { offset: 0, limit: 50, classification: 'all', sort: 'fullname' }
          }])
        });
        const data = await res.json();
        if (Array.isArray(data) && data[0]?.data?.courses) {
          data[0].data.courses.forEach(c => {
            courses.push({
              id: String(c.id),
              fullName: c.fullname,
              shortName: c.shortname,
              folderName: formatCourseFolder(c.fullname, c.shortname)
            });
          });
        }
      } catch (err) {
        console.warn('[UmSpec] AJAX discovery fallback:', err);
      }
    }

    if (courses.length === 0) {
      const seen = new Set();
      document.querySelectorAll('a[href*="/course/view.php?id="]').forEach(a => {
        const m = a.href.match(/id=(\d+)/);
        if (m) {
          const cid = m[1];
          const name = a.innerText.trim();
          if (name && !seen.has(cid)) {
            seen.add(cid);
            courses.push({
              id: cid,
              fullName: name,
              shortName: name,
              folderName: formatCourseFolder(name, name)
            });
          }
        }
      });
    }

    const userEl = document.querySelector('.usertext, .usermenu, .user-name');
    const userName = userEl ? userEl.innerText.trim() : 'UM Student';
    studentProfile = await detectAcademicProfile(courses, userName);

    return courses;
  }

  // Create Floating Trigger Button
  function injectTriggerButton() {
    if (document.getElementById('umspec-trigger-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'umspec-trigger-btn';
    btn.innerHTML = `
      <span class="umspec-icon">${SPEC_STACK_ICON}</span>
      <span>1-Click Smart Export</span>
      <span class="umspec-badge">UmSpec</span>
    `;
    btn.title = 'UmSpec: Zero-Touch Smart Export for all SPeCTRUM courses';
    btn.onclick = openModal;
    document.body.appendChild(btn);
  }

  // Create & Inject Modal DOM
  function createModalDOM() {
    if (document.getElementById('umspec-modal-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'umspec-modal-overlay';
    overlay.innerHTML = `
      <div id="umspec-modal">
        <div class="umspec-modal-header">
          <div class="umspec-header-title">
            <span class="umspec-icon">${SPEC_STACK_ICON}</span>
            <div>
              <h2>UmSpec Exporter</h2>
            </div>
          </div>
          <button class="umspec-close-btn" id="umspec-close-modal" title="Close">&times;</button>
        </div>

        <div class="umspec-modal-body">
          <!-- Student Academic Profile Card -->
          <div class="umspec-profile-card" id="umspec-profile-card">
            <div class="umspec-profile-header">
              <span class="umspec-profile-badge">${ICONS.graduationCap} Academic Programme</span>
              <span class="umspec-profile-year" id="umspec-profile-year">Detecting...</span>
            </div>
            <div class="umspec-profile-major" id="umspec-profile-major">Detecting programme...</div>
            <div class="umspec-profile-faculty" id="umspec-profile-faculty">Universiti Malaya</div>
          </div>

          <!-- Course Overview Section -->
          <div class="umspec-section-label">
            <span>Enrolled Subjects (<span id="umspec-selected-count">0</span>/<span id="umspec-course-count">0</span> selected)</span>
            <div class="umspec-selection-tools">
              <button type="button" class="umspec-link-btn" id="umspec-select-all">Select All</button>
              <span class="umspec-sep">•</span>
              <button type="button" class="umspec-link-btn" id="umspec-deselect-all">Deselect All</button>
            </div>
          </div>

          <div class="umspec-courses-list" id="umspec-courses-container">
            <div style="padding: 24px; text-align: center; color: #64748b; display: flex; align-items: center; justify-content: center; gap: 8px;">
              ${ICONS.loader} <span>Scanning SPeCTRUM session and course materials...</span>
            </div>
          </div>

          <!-- Progress & Audit Card -->
          <div class="umspec-progress-card" id="umspec-progress-card">
            <div class="umspec-progress-header">
              <span id="umspec-progress-title">Running Smart Export...</span>
              <span id="umspec-progress-percent">0%</span>
            </div>
            <div class="umspec-progress-bar-bg">
              <div class="umspec-progress-bar-fill" id="umspec-progress-fill"></div>
            </div>
            <div class="umspec-status-text" id="umspec-progress-status">Preparing materials...</div>
          </div>
        </div>

        <div class="umspec-modal-footer">
          <div class="umspec-footer-info" id="umspec-footer-stats"></div>
          <button class="umspec-btn-primary" id="umspec-start-btn">
            ${ICONS.download} <span>Start 1-Click Export (ZIP)</span>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById('umspec-close-modal').onclick = closeModal;
    overlay.onclick = (e) => {
      if (e.target === overlay && !isExporting) closeModal();
    };

    document.getElementById('umspec-select-all').onclick = () => {
      if (isExporting) return;
      selectedCourseIds = new Set(detectedCourses.map(c => c.id));
      renderCoursesList();
    };

    document.getElementById('umspec-deselect-all').onclick = () => {
      if (isExporting) return;
      selectedCourseIds.clear();
      renderCoursesList();
    };

    document.getElementById('umspec-start-btn').onclick = runZeroTouchExport;
  }

  // Open & Populate Modal
  async function openModal() {
    createModalDOM();
    const overlay = document.getElementById('umspec-modal-overlay');
    overlay.classList.add('umspec-active');

    if (detectedCourses.length === 0) {
      detectedCourses = await discoverCourses();
      selectedCourseIds = new Set(detectedCourses.map(c => c.id));
      updateProfileUI();
      renderCoursesList();
    }
  }

  function closeModal() {
    if (isExporting) {
      if (!confirm('Export is running. Closing will cancel the download. Continue?')) return;
      isExporting = false;
    }
    const overlay = document.getElementById('umspec-modal-overlay');
    if (overlay) overlay.classList.remove('umspec-active');
  }

  // Update Profile UI
  function updateProfileUI() {
    if (!studentProfile) return;
    document.getElementById('umspec-profile-year').innerText = studentProfile.yearSem;
    const majorEl = document.getElementById('umspec-profile-major');
    if (majorEl) {
      majorEl.innerText = studentProfile.bachelor;
    }
    document.getElementById('umspec-profile-faculty').innerText = studentProfile.faculty;
  }

  // Update Selection UI & Button Text
  function updateSelectionUI() {
    const selectedCountEl = document.getElementById('umspec-selected-count');
    const totalCountEl = document.getElementById('umspec-course-count');
    const startBtn = document.getElementById('umspec-start-btn');
    if (!startBtn) return;

    const count = selectedCourseIds.size;
    const total = detectedCourses.length;

    if (selectedCountEl) selectedCountEl.innerText = count;
    if (totalCountEl) totalCountEl.innerText = total;

    if (count === 0) {
      startBtn.disabled = true;
      startBtn.innerHTML = `${ICONS.alertCircle} <span>Select at least 1 course</span>`;
    } else if (count === total) {
      startBtn.disabled = false;
      startBtn.innerHTML = `${ICONS.download} <span>Export All Courses (${total})</span>`;
    } else {
      startBtn.disabled = false;
      startBtn.innerHTML = `${ICONS.download} <span>Export Selected (${count} of ${total})</span>`;
    }
  }

  // Render Courses List
  function renderCoursesList() {
    const container = document.getElementById('umspec-courses-container');
    const countEl = document.getElementById('umspec-course-count');
    if (!container) return;

    if (detectedCourses.length === 0) {
      container.innerHTML = `
        <div style="padding: 24px; text-align: center; color: #ef4444; display: flex; align-items: center; justify-content: center; gap: 8px;">
          ${ICONS.alertCircle} <span>No enrolled courses found. Please ensure you are logged into SPeCTRUM.</span>
        </div>
      `;
      if (countEl) countEl.innerText = '0';
      updateSelectionUI();
      return;
    }

    container.innerHTML = detectedCourses.map(c => {
      const isSelected = selectedCourseIds.has(c.id);
      return `
        <div class="umspec-course-row ${isSelected ? '' : 'umspec-row-unselected'}" id="umspec-row-${c.id}" data-id="${c.id}">
          <div class="umspec-course-info">
            <input type="checkbox" class="umspec-course-checkbox" data-id="${c.id}" ${isSelected ? 'checked' : ''} />
            <span class="umspec-bullet">${ICONS.bookOpen}</span>
            <div>
              <div class="umspec-course-title">${c.fullName}</div>
              <span class="umspec-course-code">${c.folderName}</span>
            </div>
          </div>
          <span class="umspec-course-status" id="umspec-status-${c.id}">Ready</span>
        </div>
      `;
    }).join('');

    // Attach row toggle handlers
    container.querySelectorAll('.umspec-course-row').forEach(row => {
      const id = row.getAttribute('data-id');
      const chk = row.querySelector('.umspec-course-checkbox');

      const toggleRow = (select) => {
        if (isExporting) return;
        if (select) {
          selectedCourseIds.add(id);
          row.classList.remove('umspec-row-unselected');
          chk.checked = true;
        } else {
          selectedCourseIds.delete(id);
          row.classList.add('umspec-row-unselected');
          chk.checked = false;
        }
        updateSelectionUI();
      };

      chk.addEventListener('change', (e) => {
        toggleRow(e.target.checked);
      });

      row.addEventListener('click', (e) => {
        if (e.target === chk) return;
        toggleRow(!selectedCourseIds.has(id));
      });
    });

    updateSelectionUI();
  }

  // Helper: Fetch binary data
  async function fetchBinary(url, defaultName) {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const ct = (res.headers.get('Content-Type') || '').toLowerCase();
    if (ct.includes('text/html')) {
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const realLink = doc.querySelector('.resourceworkaround a, .resourcecontent object, a[href*="pluginfile.php"]');
      if (realLink) {
        const nextUrl = realLink.getAttribute('data') || realLink.getAttribute('href');
        if (nextUrl && nextUrl.includes('pluginfile.php')) {
          return fetchBinary(nextUrl, defaultName);
        }
      }
      return null;
    }

    let filename = defaultName;
    const cd = res.headers.get('Content-Disposition') || '';
    const mUtf = cd.match(/filename\*=UTF-8''([^;\r\n]+)/i);
    const mStd = cd.match(/filename="([^"]+)"/i);
    const mUnq = cd.match(/filename=([^;\s]+)/i);

    if (mUtf) filename = decodeURIComponent(mUtf[1]);
    else if (mStd) filename = mStd[1];
    else if (mUnq) filename = mUnq[1].replace(/['"]/g, '');
    else {
      const base = new URL(res.url).pathname.split('/').pop();
      if (base && base.includes('.') && !base.includes('.php')) {
        filename = decodeURIComponent(base);
      }
    }

    const data = await res.arrayBuffer();
    return { filename: sanitizeName(filename), data };
  }

  // Zero-Touch Smart Export Pipeline
  async function runZeroTouchExport() {
    if (typeof JSZip === 'undefined') {
      alert('JSZip library is missing. Please refresh the page.');
      return;
    }

    if (detectedCourses.length === 0) {
      alert('No enrolled courses detected.');
      return;
    }

    const coursesToExport = detectedCourses.filter(c => selectedCourseIds.has(c.id));
    if (coursesToExport.length === 0) {
      alert('Please select at least one course to export.');
      return;
    }

    isExporting = true;
    window.onbeforeunload = () => 'Export in progress. Exiting will abort download.';

    const startBtn = document.getElementById('umspec-start-btn');
    startBtn.disabled = true;
    startBtn.innerHTML = `${ICONS.loader} <span>Smart Exporting...</span>`;

    const progressCard = document.getElementById('umspec-progress-card');
    progressCard.style.display = 'block';

    const fillEl = document.getElementById('umspec-progress-fill');
    const percentEl = document.getElementById('umspec-progress-percent');
    const statusEl = document.getElementById('umspec-progress-status');
    const footerStats = document.getElementById('umspec-footer-stats');

    const zip = new JSZip();
    let totalFiles = 0;
    let totalBytes = 0;
    const auditRows = [];
    const discoveredCategories = new Set();

    try {
      for (let i = 0; i < coursesToExport.length; i++) {
        if (!isExporting) break;

        const course = coursesToExport[i];
        const statusBadge = document.getElementById(`umspec-status-${course.id}`);
        if (statusBadge) {
          statusBadge.innerText = 'Scanning...';
          statusBadge.style.color = '#294a9b';
        }

        statusEl.innerText = `Analyzing course ${i + 1}/${coursesToExport.length}: ${course.fullName}...`;

        const cRes = await fetch(`https://spectrum.um.edu.my/course/view.php?id=${course.id}`, { credentials: 'include' });
        const cHtml = await cRes.text();
        const cDoc = new DOMParser().parseFromString(cHtml, 'text/html');

        const itemsToDownload = [];
        const seenUrls = new Set();
        const externalLinks = [];

        const sections = cDoc.querySelectorAll('.course-content ul.topics > li, .course-content ul.weeks > li, .course-content .section');
        sections.forEach(sec => {
          const secTitleEl = sec.querySelector('.sectionname, .section-title, h3');
          const secName = secTitleEl ? secTitleEl.innerText.trim() : 'General';

          sec.querySelectorAll('.activity').forEach(act => {
            const modClasses = Array.from(act.classList).filter(c => c.startsWith('modtype_'));
            const modType = modClasses.length ? modClasses[0].replace('modtype_', '') : '';
            if (['attendance', 'forum', 'feedback', 'choice'].includes(modType)) return;

            const inst = act.querySelector('.instancename');
            let actName = inst ? inst.innerText.trim() : 'Material';
            ['File', 'URL', 'Assignment', 'Folder', 'Page', 'External tool'].forEach(sfx => {
              if (actName.endsWith(sfx)) actName = actName.slice(0, -sfx.length).trim();
            });

            const link = act.querySelector('a');
            if (!link || !link.href) return;
            const actUrl = link.href;
            if (seenUrls.has(actUrl)) return;
            seenUrls.add(actUrl);

            // Adaptive category determination
            const extMatch = actUrl.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
            const ext = extMatch ? `.${extMatch[1]}` : '';
            const cat = classifyAdaptiveCategory(actName, secName, ext);
            discoveredCategories.add(cat.label);

            itemsToDownload.push({ name: actName, url: actUrl, type: modType, category: cat.id, section: secName });
          });

          // Check video/external links
          sec.querySelectorAll('a[href*="youtu.be"], a[href*="youtube.com"], a[href*="drive.google.com"]').forEach(ea => {
            externalLinks.push({ title: ea.innerText.trim() || 'External Lecture Link', url: ea.href, section: secName });
          });
        });

        if (statusBadge) {
          statusBadge.innerText = `Downloading (${itemsToDownload.length})`;
          statusBadge.style.color = '#355bb0';
        }

        let courseDownloadedCount = 0;

        for (let j = 0; j < itemsToDownload.length; j++) {
          if (!isExporting) break;

          const item = itemsToDownload[j];
          statusEl.innerText = `[${course.folderName}] (${j + 1}/${itemsToDownload.length}) ${item.name}`;

          const progressVal = Math.round(((i + (j / Math.max(1, itemsToDownload.length))) / coursesToExport.length) * 100);
          fillEl.style.width = `${progressVal}%`;
          percentEl.innerText = `${progressVal}%`;

          try {
            if (item.type === 'folder') {
              const fRes = await fetch(item.url, { credentials: 'include' });
              const fHtml = await fRes.text();
              const fDoc = new DOMParser().parseFromString(fHtml, 'text/html');
              const fLinks = fDoc.querySelectorAll('a[href*="pluginfile.php"]');
              for (const fl of fLinks) {
                const fData = await fetchBinary(fl.href, fl.innerText.trim() || item.name);
                if (fData) {
                  zip.file(`${course.folderName}/${item.category}/${fData.filename}`, fData.data);
                  totalFiles++;
                  totalBytes += fData.data.byteLength;
                  courseDownloadedCount++;
                }
              }
            } else if (item.type === 'assign') {
              const aRes = await fetch(item.url, { credentials: 'include' });
              const aHtml = await aRes.text();
              const aDoc = new DOMParser().parseFromString(aHtml, 'text/html');
              const aLinks = aDoc.querySelectorAll('#intro a[href*="pluginfile.php"], .intro a[href*="pluginfile.php"], .fileuploadsubmission a[href*="pluginfile.php"]');
              for (const al of aLinks) {
                const aData = await fetchBinary(al.href, al.innerText.trim() || item.name);
                if (aData) {
                  zip.file(`${course.folderName}/${item.category}/${aData.filename}`, aData.data);
                  totalFiles++;
                  totalBytes += aData.data.byteLength;
                  courseDownloadedCount++;
                }
              }
            } else {
              const fData = await fetchBinary(item.url, item.name);
              if (fData) {
                zip.file(`${course.folderName}/${item.category}/${fData.filename}`, fData.data);
                totalFiles++;
                totalBytes += fData.data.byteLength;
                courseDownloadedCount++;
              }
            }
          } catch (e) {
            console.warn(`[UmSpec] Failed item ${item.name}:`, e);
          }
        }

        // Save external links markdown if present
        if (externalLinks.length > 0) {
          let linksMd = `# 🎥 ${course.fullName} - Lecture & Video Links\n\n`;
          let curSec = null;
          externalLinks.forEach(el => {
            if (el.section !== curSec) {
              curSec = el.section;
              linksMd += `\n### ${curSec}\n\n`;
            }
            linksMd += `- [${el.title}](${el.url})\n`;
          });
          zip.file(`${course.folderName}/1.Lecture Slide/Lecture_Videos_and_Links.md`, linksMd);
          courseDownloadedCount++;
          totalFiles++;
        }

        const courseStatus = courseDownloadedCount > 0 ? '🟢 Active' : '⚠️ Empty on SPeCTRUM';
        if (statusBadge) {
          statusBadge.innerText = courseDownloadedCount > 0 ? `✅ Done (${courseDownloadedCount})` : '⚠️ Empty';
          statusBadge.style.color = courseDownloadedCount > 0 ? '#16a34a' : '#d97706';
        }

        auditRows.push(`| **${course.folderName}** | ${course.fullName} | ${courseDownloadedCount} files | ${courseStatus} |`);
      }

      // Record any unselected/excluded courses in audit table
      detectedCourses.filter(c => !selectedCourseIds.has(c.id)).forEach(c => {
        auditRows.push(`| **${c.folderName}** | ${c.fullName} | 0 files | ⚪ Excluded by User |`);
      });

      // Generate Executive Academic Audit Report
      const auditReport = `# 🎓 Universiti Malaya - SPeCTRUM Semester Academic Audit

> **Auto-Generated by UmSpec Zero-Touch Engine** on ${new Date().toLocaleString()}

---

## 🧑‍🎓 Student Academic Profile

* **Student:** ${studentProfile?.studentName || 'UM Student'}
* **Faculty:** ${studentProfile?.faculty || 'Faculty of Computer Science & Information Technology'}
* **Detected Programme:** ${studentProfile?.bachelor || 'Bachelor of Computer Science'}
* **Academic Period:** ${studentProfile?.yearSem || 'Year 2, Semester 1'}
* **Total Enrolled Courses:** ${detectedCourses.length} Courses (${coursesToExport.length} Exported)

---

## 📊 Course Content & Material Health Check

| Course Folder | Official Title | Materials Downloaded | Health Status |
| :--- | :--- | :---: | :--- |
${auditRows.join('\n')}

---

## 🗂️ Discovered Material Taxonomy

The following categories were dynamically identified and organized across your courses:
${Array.from(discoveredCategories).map(c => `* **${c}**`).join('\n')}

---

## 📦 Total Archive Statistics
* **Total Files:** ${totalFiles}
* **Total Uncompressed Size:** ${(totalBytes / (1024 * 1024)).toFixed(2)} MB

*Preserve this audit report as your official semester archive index.*
`;

      zip.file('SEMESTER_AUDIT_REPORT.md', auditReport);

      // Compress and Save ZIP
      statusEl.innerText = 'Compressing into ZIP archive...';
      fillEl.style.width = '100%';
      percentEl.innerText = '100%';

      const zipBlob = await zip.generateAsync(
        { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 5 } },
        (meta) => {
          percentEl.innerText = `${Math.round(meta.percent)}%`;
          fillEl.style.width = `${meta.percent}%`;
          statusEl.innerText = `Compressing: ${Math.round(meta.percent)}% done...`;
        }
      );

      const downloadUrl = URL.createObjectURL(zipBlob);
      const downloadLink = document.createElement('a');
      const dateStr = new Date().toISOString().slice(0, 10);
      downloadLink.href = downloadUrl;
      downloadLink.download = `SPeCTRUM_Smart_Export_${dateStr}.zip`;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 60000);

      statusEl.innerText = `Export Complete! Processed ${totalFiles} files (${(totalBytes / (1024 * 1024)).toFixed(1)} MB).`;
      footerStats.innerText = `Saved SPeCTRUM_Smart_Export_${dateStr}.zip`;
      startBtn.innerHTML = `${ICONS.checkCircle} <span>Export Complete</span>`;

    } catch (err) {
      console.error('[UmSpec] Smart export error:', err);
      statusEl.innerText = `❌ Error: ${err.message}`;
      alert(`Smart export failed: ${err.message}`);
    } finally {
      isExporting = false;
      window.onbeforeunload = null;
      startBtn.disabled = false;
    }
  }

  // Inject UI on SPeCTRUM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectTriggerButton);
  } else {
    injectTriggerButton();
  }

})();
