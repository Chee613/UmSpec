// UmSpec Popup Script
document.addEventListener('DOMContentLoaded', async () => {
  const indicator = document.getElementById('status-indicator');
  const title = document.getElementById('status-title');
  const desc = document.getElementById('status-desc');
  const actionBtn = document.getElementById('action-btn');

  // Query active tab
  let activeTab = null;
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tabs[0];
  } catch (err) {
    console.error('Failed to query tab:', err);
  }

  const isSpectrum = activeTab && activeTab.url && activeTab.url.includes('spectrum.um.edu.my');

  if (isSpectrum) {
    indicator.classList.add('active');
    title.innerText = 'Connected to SPeCTRUM';
    desc.innerText = 'SPeCTRUM tab detected';
    actionBtn.innerText = '✨ Open Exporter Dialog';
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
  } else {
    indicator.classList.remove('active');
    title.innerText = 'Not on SPeCTRUM';
    desc.innerText = 'Open SPeCTRUM to export courses';
    actionBtn.innerText = '🌐 Open SPeCTRUM Dashboard';
    actionBtn.onclick = () => {
      chrome.tabs.create({ url: 'https://spectrum.um.edu.my/my/' });
      window.close();
    };
  }
});
