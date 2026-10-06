/**
 * UmSpec - SPeCTRUM Course Exporter (Zero-Touch Smart Edition)
 * Client-side browser extension for Universiti Malaya (UM) SPeCTRUM.
 */

(function () {
  'use strict';

  if (window.__umspec_injected) return;
  window.__umspec_injected = true;

  console.log('[UmSpec] Zero-Touch Smart Exporter initialized on SPeCTRUM');

  // State
  let detectedCourses = [];
  let studentProfile = null;
  let isExporting = false;
  let sesskey = null;

  // Helper: Sanitize folder/file names
  function sanitizeName(name) {
    if (!name) return 'unnamed';
    return name
      .replace(/[\\/*?:"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160);
  }

  // Helper: Extract clean course folder name (e.g. "WIA2007 MAD")
  function formatCourseFolder(fullName, shortName) {
    const codeMatch = fullName.match(/([A-Z]{3}\d{4})/i);
    const code = codeMatch ? codeMatch[1].toUpperCase() : 'COURSE';

    let title = fullName
      .replace(/([A-Z]{3}\d{4}\/[A-Z]{3}\d{4}|[A-Z]{3}\d{4})/gi, '')
      .replace(/[^\w\s]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const words = title.split(' ').filter(w => w.length > 2);
    let acronym = words.map(w => w[0]).join('').slice(0, 5).toUpperCase();
    if (!acronym) acronym = 'MATERIALS';

    return sanitizeName(`${code} ${acronym}`);
  }

  // Detect Bachelor's Degree & Year/Semester from Course List
  function detectAcademicProfile(courses, userName) {
    const codes = courses.map(c => {
      const m = c.fullName.match(/([A-Z]{3})(\d)(\d{3})/i);
      return m ? { prefix: m[1].toUpperCase(), year: parseInt(m[2]), fullCode: m[0].toUpperCase() } : null;
    }).filter(Boolean);

    let faculty = 'Universiti Malaya';
    let bachelor = 'Bachelor Degree Programme';

    const fsktmCount = codes.filter(c => ['WIA', 'WIB', 'WIC', 'WID', 'WIX'].includes(c.prefix)).length;
    const engCount = codes.filter(c => ['KIE', 'KKA', 'KMK', 'KBE'].includes(c.prefix)).length;
    const artsCount = codes.filter(c => ['AIA', 'AIB', 'GIG'].includes(c.prefix)).length;

    if (fsktmCount >= 2) {
      faculty = 'Faculty of Computer Science & Information Technology (FSKTM)';
      const fullList = codes.map(c => c.fullCode);
      if (fullList.includes('WIA2007') || fullList.includes('WIA2006')) {
        bachelor = 'Bachelor of Computer Science (Software Engineering)';
      } else if (fullList.some(c => c.startsWith('WID'))) {
        bachelor = 'Bachelor of Computer Science (Data Science / AI)';
      } else if (fullList.some(c => c.startsWith('WIB'))) {
        bachelor = 'Bachelor of Information Technology (Information Systems)';
      } else {
        bachelor = 'Bachelor of Computer Science / IT';
      }
    } else if (engCount >= 2) {
      faculty = 'Faculty of Engineering (FK)';
      bachelor = 'Bachelor of Engineering';
    } else if (artsCount >= 2) {
      faculty = 'Faculty of Arts and Social Sciences (FASS)';
      bachelor = 'Bachelor of Arts / Social Sciences';
    }

    const yearNumbers = codes.map(c => c.year).filter(y => y > 0 && y <= 4);
    const avgYear = yearNumbers.length ? Math.round(yearNumbers.reduce((a, b) => a + b, 0) / yearNumbers.length) : 1;

    return {
      studentName: userName || 'UM Student',
      faculty,
      bachelor,
      yearSem: `Year ${avgYear}, Semester 1`,
      totalCourses: courses.length
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
    studentProfile = detectAcademicProfile(courses, userName);

    return courses;
  }

  // Create Floating Trigger Button
  function injectTriggerButton() {
    if (document.getElementById('umspec-trigger-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'umspec-trigger-btn';
    btn.innerHTML = `
      <span class="umspec-icon">⚡</span>
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
            <span style="font-size: 26px;">⚡</span>
            <div>
              <h2>UmSpec Smart Course Exporter</h2>
              <p>Zero-touch automatic download, taxonomy classification & ZIP packaging</p>
            </div>
          </div>
          <button class="umspec-close-btn" id="umspec-close-modal" title="Close">&times;</button>
        </div>

        <div class="umspec-modal-body">
          <!-- Student Academic Profile Card -->
          <div class="umspec-profile-card" id="umspec-profile-card">
            <div class="umspec-profile-header">
              <span class="umspec-profile-badge">🎓 Academic Profile Detected</span>
              <span class="umspec-profile-year" id="umspec-profile-year">Detecting...</span>
            </div>
            <div class="umspec-profile-major" id="umspec-profile-major">Analyzing enrolled curriculum...</div>
            <div class="umspec-profile-faculty" id="umspec-profile-faculty">Universiti Malaya</div>
          </div>

          <!-- Course Overview Section -->
          <div class="umspec-section-label">
            <span>Enrolled Subjects (<span id="umspec-course-count">0</span> detected)</span>
            <span style="font-size: 11px; color: #16a34a; font-weight: 700;">✓ Auto-Selected</span>
          </div>

          <div class="umspec-courses-list" id="umspec-courses-container">
            <div style="padding: 24px; text-align: center; color: #64748b;">
              🔄 Scanning SPeCTRUM session and course materials...
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
          <div class="umspec-footer-info" id="umspec-footer-stats">
            Zero configuration needed • 100% Client-side
          </div>
          <button class="umspec-btn-primary" id="umspec-start-btn">
            <span>⚡ Start 1-Click Export (ZIP)</span>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById('umspec-close-modal').onclick = closeModal;
    overlay.onclick = (e) => {
      if (e.target === overlay && !isExporting) closeModal();
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
    document.getElementById('umspec-profile-major').innerText = studentProfile.bachelor;
    document.getElementById('umspec-profile-faculty').innerText = studentProfile.faculty;
  }

  // Render Courses List
  function renderCoursesList() {
    const container = document.getElementById('umspec-courses-container');
    const countEl = document.getElementById('umspec-course-count');
    if (!container) return;

    if (detectedCourses.length === 0) {
      container.innerHTML = `
        <div style="padding: 24px; text-align: center; color: #ef4444;">
          No enrolled courses found. Please ensure you are logged into SPeCTRUM.
        </div>
      `;
      countEl.innerText = '0';
      return;
    }

    countEl.innerText = detectedCourses.length;
    container.innerHTML = detectedCourses.map(c => `
      <div class="umspec-course-row" id="umspec-row-${c.id}">
        <div class="umspec-course-info">
          <span class="umspec-bullet">📚</span>
          <div>
            <div class="umspec-course-title">${c.fullName}</div>
            <span class="umspec-course-code">${c.folderName}</span>
          </div>
        </div>
        <span class="umspec-course-status" id="umspec-status-${c.id}">Ready</span>
      </div>
    `).join('');
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

    isExporting = true;
    window.onbeforeunload = () => 'Export in progress. Exiting will abort download.';

    const startBtn = document.getElementById('umspec-start-btn');
    startBtn.disabled = true;
    startBtn.innerHTML = `<span>⏳ Smart Exporting...</span>`;

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
      for (let i = 0; i < detectedCourses.length; i++) {
        if (!isExporting) break;

        const course = detectedCourses[i];
        const statusBadge = document.getElementById(`umspec-status-${course.id}`);
        if (statusBadge) {
          statusBadge.innerText = 'Scanning...';
          statusBadge.style.color = '#1976d2';
        }

        statusEl.innerText = `Analyzing course ${i + 1}/${detectedCourses.length}: ${course.fullName}...`;

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
          statusBadge.style.color = '#0284c7';
        }

        let courseDownloadedCount = 0;

        for (let j = 0; j < itemsToDownload.length; j++) {
          if (!isExporting) break;

          const item = itemsToDownload[j];
          statusEl.innerText = `[${course.folderName}] (${j + 1}/${itemsToDownload.length}) ${item.name}`;

          const progressVal = Math.round(((i + (j / Math.max(1, itemsToDownload.length))) / detectedCourses.length) * 100);
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

      // Generate Executive Academic Audit Report
      const auditReport = `# 🎓 Universiti Malaya - SPeCTRUM Semester Academic Audit

> **Auto-Generated by UmSpec Zero-Touch Engine** on ${new Date().toLocaleString()}

---

## 🧑‍🎓 Student Academic Profile

* **Student:** ${studentProfile?.studentName || 'UM Student'}
* **Faculty:** ${studentProfile?.faculty || 'Faculty of Computer Science & Information Technology'}
* **Detected Programme:** ${studentProfile?.bachelor || 'Bachelor of Computer Science'}
* **Academic Period:** ${studentProfile?.yearSem || 'Year 2, Semester 1'}
* **Total Enrolled Courses:** ${detectedCourses.length} Courses

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

      statusEl.innerText = `✅ Export Complete! Processed ${totalFiles} files (${(totalBytes / (1024 * 1024)).toFixed(1)} MB).`;
      footerStats.innerText = `Saved SPeCTRUM_Smart_Export_${dateStr}.zip`;
      startBtn.innerHTML = `<span>🎉 Export Complete</span>`;

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
