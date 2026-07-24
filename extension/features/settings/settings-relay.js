// SIGC-PRO feature: advanced-flags settings. ISOLATED-world half — the
// only file in this extension allowed to touch chrome.storage (see
// scripts/check-privacy.sh). Never touches window.__sigcPro (that object
// lives in MAIN world's separate `window`); communicates with
// settings.js purely via CustomEvents on the shared DOM window.
// Spec: docs/superpowers/specs/2026-07-24-ultimo-movimento-multi-agencia-export-design.md
(function () {
  'use strict';

  const STORAGE_KEY = 'advancedFlags';

  function broadcast(flags) {
    window.dispatchEvent(new CustomEvent('sigc-pro-advanced-flags', {
      detail: { flags: flags || {} },
    }));
  }

  chrome.storage.local.get([STORAGE_KEY], (result) => {
    broadcast(result && result[STORAGE_KEY]);
  });

  window.addEventListener('sigc-pro-set-advanced-flag', (e) => {
    const { name, value } = e.detail || {};
    if (!name) return;
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      const flags = Object.assign({}, result && result[STORAGE_KEY], { [name]: value });
      chrome.storage.local.set({ [STORAGE_KEY]: flags }, () => broadcast(flags));
    });
  });
})();
