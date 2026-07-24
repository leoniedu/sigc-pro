// SIGC-PRO Options page script. Runs as a regular extension page (not a
// content script), so it has full extension API access — chrome.storage
// directly, no MAIN/ISOLATED relay needed here. Writes are read back on
// each SIGC page's next load by settings-relay.js.
(function () {
  'use strict';

  const STORAGE_KEY = 'advancedFlags';
  const FLAG_IDS = ['ultimoMovimentoExport'];

  const statusEl = document.getElementById('status');
  let statusTimer = null;

  function showSaved() {
    statusEl.textContent = 'Salvo.';
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { statusEl.textContent = ''; }, 1500);
  }

  chrome.storage.local.get([STORAGE_KEY], (result) => {
    const flags = (result && result[STORAGE_KEY]) || {};
    FLAG_IDS.forEach((name) => {
      const el = document.getElementById(`flag-${name}`);
      if (el) el.checked = flags[name] === true;
    });
  });

  FLAG_IDS.forEach((name) => {
    const el = document.getElementById(`flag-${name}`);
    if (!el) return;
    el.addEventListener('change', () => {
      chrome.storage.local.get([STORAGE_KEY], (result) => {
        const flags = Object.assign({}, result && result[STORAGE_KEY], { [name]: el.checked });
        chrome.storage.local.set({ [STORAGE_KEY]: flags }, showSaved);
      });
    });
  });
})();
