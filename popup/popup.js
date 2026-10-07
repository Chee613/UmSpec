/**
 * UmSpec - Extension Popup Script (Nothing OS 4.0 Pro Edition)
 */
document.addEventListener('DOMContentLoaded', async () => {
  const indicator = document.getElementById('status-indicator');
  const headerPulse = document.getElementById('header-pulse-dot');
  const tag = document.getElementById('status-tag');
  const title = document.getElementById('status-title');
  const desc = document.getElementById('status-desc');
  const actionBtn = document.getElementById('action-btn');

  // Solid Glyph SVGs from SVGRepo Glyph collection
  const GLYPH_DOWNLOAD = `<svg class="umspec-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>`;
  const GLYPH_EXTERNAL = `<svg class="umspec-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7zm-9 4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5h-2v5H5V9h5V7H5z"/></svg>`;

  // Query active tab
  let activeTab = null;
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tabs[0];
  } catch (err) {
    console.error('[UmSpec] Failed to query tab:', err);
  }

  const isSpectrum = Boolean(activeTab && activeTab.url && activeTab.url.includes('spectrum.um.edu.my'));

  if (isSpectrum) {
    if (indicator) indicator.classList.add('active');
    if (headerPulse) headerPulse.classList.add('active');
    if (tag) tag.innerText = 'STATUS // CONNECTED';
    if (title) title.innerText = 'CONNECTED TO SPeCTRUM';
    if (desc) desc.innerText = 'Session live • Ready for zero-touch export';

    if (actionBtn) {
      actionBtn.innerHTML = `${GLYPH_DOWNLOAD}<span>OPEN EXPORTER DIALOG</span>`;
      actionBtn.onclick = () => {
        chrome.scripting?.executeScript({
          target: { tabId: activeTab.id },
          func: () => {
            const btn = document.getElementById('umspec-trigger-btn');
            if (btn) btn.click();
          }
        });
        window.close();
      };
    }
  } else {
    if (indicator) indicator.classList.remove('active');
    if (headerPulse) headerPulse.classList.remove('active');
    if (tag) tag.innerText = 'STATUS // STANDBY';
    if (title) title.innerText = 'NOT ON SPeCTRUM';
    if (desc) desc.innerText = 'Open spectrum.um.edu.my to archive courses';

    if (actionBtn) {
      actionBtn.innerHTML = `${GLYPH_EXTERNAL}<span>OPEN SPECTRUM DASHBOARD</span>`;
      actionBtn.onclick = () => {
        chrome.tabs.create({ url: 'https://spectrum.um.edu.my/my/' });
        window.close();
      };
    }
  }
});
