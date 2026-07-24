// SIGC-PRO feature: advanced-flags settings. MAIN-world half of the
// settings feature — settings-relay.js (ISOLATED world) is the only file
// in this directory allowed to touch chrome.storage; this file never
// does, since chrome.* is unavailable in MAIN world. The two communicate
// via a CustomEvent on the shared DOM window (MAIN/ISOLATED worlds have
// separate `window` objects but the same document, and DOM event
// dispatch crosses that boundary): the relay reads chrome.storage once
// on page load and broadcasts it here — one-shot, read-only. Flags are
// changed via the extension's Options page (chrome.storage.local
// directly, full extension API access there), not from the SIGC page
// itself, so a flag flip takes effect on the SIGC page's next reload.
//
// Advanced flags gate features whose request pattern is riskier than the
// rest of the extension's read-only DOM access (e.g. ultimo-movimento-export's
// multi-agência fetch loop) — off by default, so the feature is invisible
// until a user deliberately opts in via the Options page.
// Spec: docs/superpowers/specs/2026-07-24-ultimo-movimento-multi-agencia-export-design.md
(function () {
  'use strict';

  const TAG = '[sigc-settings]';

  // In-memory cache of the last known flag values, populated once by
  // settings-relay.js's one-shot broadcast. Starts empty: every flag
  // defaults to false (isEnabled) until that broadcast lands, which
  // happens automatically on load — no feature should ever block
  // waiting for it, since "off by default" is itself a safe value.
  let flagsCache = {};

  window.addEventListener('sigc-pro-advanced-flags', (e) => {
    flagsCache = (e.detail && e.detail.flags) || {};
    console.log(`${TAG} flags loaded:`, flagsCache);
    if (window.__sigcPro && window.__sigcPro.recheckMounts) {
      window.__sigcPro.recheckMounts();
    }
  });

  function isEnabled(name) {
    return flagsCache[name] === true;
  }

  window.__sigcPro.settings = { isEnabled };
  console.log(`${TAG} settings runtime loaded.`);
})();
