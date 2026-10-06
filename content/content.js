/**
 * UmSpec - SPeCTRUM Course Exporter
 * Client-side extension content script for Universiti Malaya SPeCTRUM.
 */

(function () {
  'use strict';

  // Prevent multiple injections
  if (window.__umspec_injected) return;
  window.__umspec_injected = true;

  console.log('[UmSpec] Extension initialized on SPeCTRUM');

  // State
  let detectedCourses = [];
  let isExporting = false;
  let sesskey = null;

  // Categories config
  const CATEGORIES = [
    { id: '1.Lecture Slide', label: '📖 1. Lecture Slides & Notes', default: true },
    { id: '2.Tutorial', label: '📝 2. Tutorials & Problem Sets', default: true },
    { id: '3.Lab', label: '💻 3. Labs & Practicals', default: true },
    { id: '4.Assignment', label: '📂 4. Assignments & Project Briefs', default: true },
    { id: '5.Reference', label: '📚 5. References & Textbooks', default: true }
  ];

  // Helper: Sanitize folder/file names
  function sanitizeName(name) {
    if (!name) return 'unnamed';
    return name
      .replace(/[\\/*?:"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 150);
  }

  // Helper: Extract course short folder name (e.g. "WIA2007 MAD")
  function formatCourseFolder(fullName, shortName) {
    const codeMatch = fullName.match(/([A-Z]{3}\d{4})/i);
    const code = codeMatch ? codeMatch[1].toUpperCase() : 'COURSE';
    
    // Generate clean short title
    let title = fullName
      .replace(/([A-Z]{3}\d{4}\/[A-Z]{3}\d{4}|[A-Z]{3}\d{4})/gi, '')
      .replace(/[^\w\s]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
      
    // Acronym or short name
    const words = title.split(' ').filter(w => w.length > 2);
    let acronym = words.map(w => w[0]).join('').slice(0, 5).toUpperCase();
    if (!acronym) acronym = 'MATERIALS';

    return sanitizeName(`${code} ${acronym}`);
  }

  // Helper: Classify item into category
  function classifyCategory(itemName, sectionName) {
    const n = (itemName || '').toLowerCase();
    const s = (sectionName || '').toLowerCase();

    if (n.includes('tutorial') || s.includes('tutorial')) {
      return '2.Tutorial';
    }
    if (n.includes('lab') || n.includes('practical') || n.includes('pbl') || s.includes('lab') || s.includes('practical')) {
      return '3.Lab';
    }
    if (
      n.includes('assignment') || n.includes('assign') || n.includes('project') ||
      n.includes('case study') || n.includes('peer assessment') || n.includes('weekly progress') ||
      s.includes('assignment') || s.includes('project')
    ) {
      return '4.Assignment';
    }
    if (
      n.includes('book') || n.includes('reference') || n.includes('additional material') ||
      n.includes('extra note') || n.includes('guide') || s.includes('reference') || s.includes('additional')
    ) {
      return '5.Reference';
    }
    return '1.Lecture Slide';
  }

  // Extract Moodle sesskey from page
  function getSesskey() {
    if (sesskey) return sesskey;
    if (window.M && window.M.cfg && window.M.cfg.sesskey) {
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

  // Discover all enrolled courses
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
        console.warn('[UmSpec] AJAX course discovery failed, falling back to DOM scan:', err);
      }
    }

    // Fallback or complement with DOM course links
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

    return courses;
  }

  // Create & Inject Floating Button
  function injectTriggerButton() {
    if (document.getElementById('umspec-trigger-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'umspec-trigger-btn';
    btn.innerHTML = `
      <span class="umspec-icon">📦</span>
      <span>Export Courses (ZIP)</span>
      <span class="umspec-badge">UmSpec</span>
    `;
    btn.title = 'UmSpec: Download all enrolled course materials as a structured ZIP file';
    btn.onclick = openModal;
    document.body.appendChild(btn);
  }

  // Create & Inject Modal Dialog
  function createModalDOM() {
    if (document.getElementById('umspec-modal-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'umspec-modal-overlay';
    overlay.innerHTML = `
      <div id="umspec-modal">
        <div class="umspec-modal-header">
          <div class="umspec-header-title">
            <span style="font-size: 24px;">📦</span>
            <div>
              <h2>SPeCTRUM Course Exporter</h2>
              <p>Download and package your enrolled course materials into a single structured ZIP</p>
            </div>
          </div>
          <button class="umspec-close-btn" id="umspec-close-modal" title="Close">&times;</button>
        </div>

        <div class="umspec-modal-body">
          <!-- Category Filter Section -->
          <div class="umspec-section-label">
            <span>Material Types to Include</span>
            <div class="umspec-quick-actions">
              <button class="umspec-link-btn" id="umspec-select-all-cats">All</button>
              <span>|</span>
              <button class="umspec-link-btn" id="umspec-deselect-all-cats">None</button>
            </div>
          </div>
          <div class="umspec-categories-grid" id="umspec-cats-container">
            ${CATEGORIES.map(cat => `
              <label class="umspec-cat-card">
                <input type="checkbox" value="${cat.id}" ${cat.default ? 'checked' : ''} class="umspec-cat-cb">
                <span>${cat.label}</span>
              </label>
            `).join('')}
          </div>

          <!-- Courses Selection Section -->
          <div class="umspec-section-label">
            <span>Select Courses (<span id="umspec-course-count">0</span>)</span>
            <div class="umspec-quick-actions">
              <button class="umspec-link-btn" id="umspec-select-all-courses">Select All</button>
              <span>|</span>
              <button class="umspec-link-btn" id="umspec-deselect-all-courses">Deselect All</button>
            </div>
          </div>
          <div class="umspec-courses-list" id="umspec-courses-container">
            <div style="padding: 20px; text-align: center; color: #64748b;">
              🔄 Scanning your enrolled courses...
            </div>
          </div>

          <!-- Progress Card -->
          <div class="umspec-progress-card" id="umspec-progress-card">
            <div class="umspec-progress-header">
              <span id="umspec-progress-title">Exporting Materials...</span>
              <span id="umspec-progress-percent">0%</span>
            </div>
            <div class="umspec-progress-bar-bg">
              <div class="umspec-progress-bar-fill" id="umspec-progress-fill"></div>
            </div>
            <div class="umspec-status-text" id="umspec-progress-status">Initializing download...</div>
          </div>
        </div>

        <div class="umspec-modal-footer">
          <div class="umspec-footer-info" id="umspec-footer-stats">
            Ready to export selected course materials
          </div>
          <button class="umspec-btn-primary" id="umspec-start-btn">
            <span>🚀 Start Export (ZIP)</span>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Event listeners
    document.getElementById('umspec-close-modal').onclick = closeModal;
    overlay.onclick = (e) => {
      if (e.target === overlay && !isExporting) closeModal();
    };

    document.getElementById('umspec-select-all-cats').onclick = () => {
      document.querySelectorAll('.umspec-cat-cb').forEach(cb => cb.checked = true);
    };
    document.getElementById('umspec-deselect-all-cats').onclick = () => {
      document.querySelectorAll('.umspec-cat-cb').forEach(cb => cb.checked = false);
    };

    document.getElementById('umspec-select-all-courses').onclick = () => {
      document.querySelectorAll('.umspec-course-cb').forEach(cb => cb.checked = true);
    };
    document.getElementById('umspec-deselect-all-courses').onclick = () => {
      document.querySelectorAll('.umspec-course-cb').forEach(cb => cb.checked = false);
    };

    document.getElementById('umspec-start-btn').onclick = startExportProcess;
  }

  // Open & Populate Modal
  async function openModal() {
    createModalDOM();
    const overlay = document.getElementById('umspec-modal-overlay');
    overlay.classList.add('umspec-active');

    if (detectedCourses.length === 0) {
      detectedCourses = await discoverCourses();
      renderCoursesList();
    }
  }

  function closeModal() {
    if (isExporting) {
      if (!confirm('An export is currently in progress. Closing will stop the download. Continue?')) {
        return;
      }
      isExporting = false;
    }
    const overlay = document.getElementById('umspec-modal-overlay');
    if (overlay) overlay.classList.remove('umspec-active');
  }

  // Render Courses in Modal
  function renderCoursesList() {
    const container = document.getElementById('umspec-courses-container');
    const countEl = document.getElementById('umspec-course-count');
    if (!container) return;

    if (detectedCourses.length === 0) {
      container.innerHTML = `
        <div style="padding: 20px; text-align: center; color: #ef4444;">
          No enrolled courses detected. Please ensure you are logged into SPeCTRUM.
        </div>
      `;
      countEl.innerText = '0';
      return;
    }

    countEl.innerText = detectedCourses.length;
    container.innerHTML = detectedCourses.map(c => {
      // Uncheck administrative courses by default
      const isSystem = c.fullName.toLowerCase().includes('turnitin') || c.fullName.toLowerCase().includes('leap');
      return `
        <div class="umspec-course-row" id="umspec-row-${c.id}">
          <div class="umspec-course-info">
            <input type="checkbox" value="${c.id}" class="umspec-course-cb" ${!isSystem ? 'checked' : ''}>
            <div>
              <div class="umspec-course-title">${c.fullName}</div>
              <span class="umspec-course-code">${c.folderName}</span>
            </div>
          </div>
          <span class="umspec-course-status" id="umspec-status-${c.id}">Pending</span>
        </div>
      `;
    }).join('');
  }

  // Helper: Fetch a single file binary with credentials
  async function fetchBinary(url, defaultName) {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const ct = (res.headers.get('Content-Type') || '').toLowerCase();
    
    // Check if HTML embedded page
    if (ct.includes('text/html')) {
      const html = await res.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const realLink = doc.querySelector('.resourceworkaround a, .resourcecontent object, a[href*="pluginfile.php"]');
      if (realLink) {
        const nextUrl = realLink.getAttribute('data') || realLink.getAttribute('href');
        if (nextUrl && nextUrl.includes('pluginfile.php')) {
          return fetchBinary(nextUrl, defaultName);
        }
      }
      return null; // Skip non-binary wrapper
    }

    // Determine filename
    let filename = defaultName;
    const cd = res.headers.get('Content-Disposition') || '';
    const mUtf = cd.match(/filename\*=UTF-8''([^;\r\n]+)/i);
    const mStd = cd.match(/filename="([^"]+)"/i);
    const mUnq = cd.match(/filename=([^;\s]+)/i);
    
    if (mUtf) filename = decodeURIComponent(mUtf[1]);
    else if (mStd) filename = mStd[1];
    else if (mUnq) filename = mUnq[1].replace(/['"]/g, '');
    else {
      const pathname = new URL(res.url).pathname;
      const base = pathname.split('/').pop();
      if (base && base.includes('.') && !base.includes('.php')) {
        filename = decodeURIComponent(base);
      }
    }

    const data = await res.arrayBuffer();
    return { filename: sanitizeName(filename), data };
  }

  // Main Export Pipeline
  async function startExportProcess() {
    if (typeof JSZip === 'undefined') {
      alert('JSZip library is missing. Please reload the page.');
      return;
    }

    const selectedCourseIds = Array.from(document.querySelectorAll('.umspec-course-cb:checked')).map(cb => cb.value);
    if (selectedCourseIds.length === 0) {
      alert('Please select at least one course to export.');
      return;
    }

    const selectedCats = new Set(Array.from(document.querySelectorAll('.umspec-cat-cb:checked')).map(cb => cb.value));
    if (selectedCats.size === 0) {
      alert('Please select at least one material category to include.');
      return;
    }

    isExporting = true;
    window.onbeforeunload = () => 'An export is currently in progress. Are you sure you want to exit?';

    const startBtn = document.getElementById('umspec-start-btn');
    startBtn.disabled = true;
    startBtn.innerHTML = `<span>⏳ Exporting...</span>`;

    const progressCard = document.getElementById('umspec-progress-card');
    progressCard.style.display = 'block';

    const fillEl = document.getElementById('umspec-progress-fill');
    const percentEl = document.getElementById('umspec-progress-percent');
    const statusEl = document.getElementById('umspec-progress-status');
    const footerStats = document.getElementById('umspec-footer-stats');

    const zip = new JSZip();
    let totalFiles = 0;
    let totalBytes = 0;
    const summaryList = [];

    const selectedCourses = detectedCourses.filter(c => selectedCourseIds.includes(c.id));

    try {
      for (let i = 0; i < selectedCourses.length; i++) {
        if (!isExporting) break;

        const course = selectedCourses[i];
        const statusBadge = document.getElementById(`umspec-status-${course.id}`);
        if (statusBadge) {
          statusBadge.innerText = 'Scanning...';
          statusBadge.style.color = '#1976d2';
        }

        statusEl.innerText = `Scanning course ${i + 1}/${selectedCourses.length}: ${course.fullName}...`;

        // 1. Fetch course page
        const cRes = await fetch(`https://spectrum.um.edu.my/course/view.php?id=${course.id}`, { credentials: 'include' });
        const cHtml = await cRes.text();
        const parser = new DOMParser();
        const cDoc = parser.parseFromString(cHtml, 'text/html');

        const itemsToDownload = [];
        const seenUrls = new Set();

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

            const cat = classifyCategory(actName, secName);
            if (!selectedCats.has(cat)) return;

            itemsToDownload.push({ name: actName, url: actUrl, type: modType, category: cat, section: secName });
          });
        });

        if (statusBadge) {
          statusBadge.innerText = `Downloading (${itemsToDownload.length})`;
          statusBadge.style.color = '#0284c7';
        }

        let courseDownloadedCount = 0;

        // 2. Download items
        for (let j = 0; j < itemsToDownload.length; j++) {
          if (!isExporting) break;

          const item = itemsToDownload[j];
          statusEl.innerText = `[${course.folderName}] (${j + 1}/${itemsToDownload.length}) ${item.name}`;
          
          const progressVal = Math.round(((i + (j / itemsToDownload.length)) / selectedCourses.length) * 100);
          fillEl.style.width = `${progressVal}%`;
          percentEl.innerText = `${progressVal}%`;

          try {
            if (item.type === 'folder') {
              const fRes = await fetch(item.url, { credentials: 'include' });
              const fHtml = await fRes.text();
              const fDoc = parser.parseFromString(fHtml, 'text/html');
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
            console.warn(`[UmSpec] Failed to fetch item: ${item.name}`, e);
          }
        }

        if (statusBadge) {
          statusBadge.innerText = `✅ Done (${courseDownloadedCount})`;
          statusBadge.style.color = '#16a34a';
        }

        summaryList.push(`* **${course.folderName}**: ${course.fullName} (${courseDownloadedCount} files)`);
      }

      // Add README.md inside ZIP
      const readmeContent = `# 📚 SPeCTRUM Course Materials Export\n\nGenerated on: ${new Date().toLocaleString()}\nTotal Files: ${totalFiles}\nTotal Size: ${(totalBytes / (1024 * 1024)).toFixed(2)} MB\n\n## Courses Included\n\n${summaryList.join('\n')}\n\n---\n*Exported seamlessly via UmSpec.*`;
      zip.file('README.md', readmeContent);

      // 3. Generate ZIP & Trigger Browser Download
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
      downloadLink.download = `SPeCTRUM_Export_${dateStr}.zip`;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 60000);

      statusEl.innerText = `✅ Export complete! Downloaded ${totalFiles} files (${(totalBytes / (1024 * 1024)).toFixed(1)} MB).`;
      footerStats.innerText = `Saved SPeCTRUM_Export_${dateStr}.zip`;
      startBtn.innerHTML = `<span>🎉 Completed</span>`;

    } catch (err) {
      console.error('[UmSpec] Export error:', err);
      statusEl.innerText = `❌ Error: ${err.message}`;
      alert(`Export failed: ${err.message}`);
    } finally {
      isExporting = false;
      window.onbeforeunload = null;
      startBtn.disabled = false;
    }
  }

  // Inject UI when SPeCTRUM page loads
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectTriggerButton);
  } else {
    injectTriggerButton();
  }

})();
