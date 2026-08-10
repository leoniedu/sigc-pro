// SIGC-PRO feature: "Mapa" on Último Movimento — ISOLATED-world relay.
// ultimo-movimento-map.js runs in MAIN world (manifest.json), where
// chrome.* is unavailable — same constraint settings.js documents for its
// own storage read. This file is the only one in this directory allowed
// to touch chrome.runtime; it never touches window.__sigcPro (that object
// lives in MAIN world's separate `window` — MAIN and ISOLATED worlds do
// NOT share `window`, only the DOM/`document` is shared between them).
//
// Stores the vendored Leaflet bundle's extension URLs as data-attributes
// on <html> (document.documentElement), not on window and not via a
// CustomEvent: an event fired here can be lost if ultimo-movimento-map.js
// hasn't attached its listener yet (both content scripts run at
// document_idle, but Chrome does not guarantee MAIN-world injection runs
// after ISOLATED-world injection — confirmed live, 2026-08-09, the
// event-based version silently missed every time). A DOM attribute has
// no such race: whichever script runs second simply reads what the first
// already wrote, and document.documentElement exists before either
// script's own body starts running.
// Spec: docs/superpowers/specs/2026-08-08-ultimo-movimento-mapa-design.md
(function () {
  'use strict';

  document.documentElement.dataset.sigcProLeafletJsUrl = chrome.runtime.getURL('vendor/leaflet/leaflet.js');
  document.documentElement.dataset.sigcProLeafletCssUrl = chrome.runtime.getURL('vendor/leaflet/leaflet.css');
})();
