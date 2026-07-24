// SIGC-PRO feature: advanced-flags settings. ISOLATED-world half — the
// only content-script file in this extension allowed to touch
// chrome.storage (see scripts/check-privacy.sh; options.js also touches
// it, but that's an extension page, not a content script, and has full
// extension API access regardless). Never touches window.__sigcPro (that
// object lives in MAIN world's separate `window`); hands the current
// flags to settings.js via a single CustomEvent on the shared DOM
// window, read once at page load. Flags are changed on the Options page
// (chrome.storage.local directly), not from here — this file is
// read-only.
// Spec: docs/superpowers/specs/2026-07-24-ultimo-movimento-multi-agencia-export-design.md
(function () {
  'use strict';

  const STORAGE_KEY = 'advancedFlags';

  chrome.storage.local.get([STORAGE_KEY], (result) => {
    window.dispatchEvent(new CustomEvent('sigc-pro-advanced-flags', {
      detail: { flags: (result && result[STORAGE_KEY]) || {} },
    }));
  });
})();
