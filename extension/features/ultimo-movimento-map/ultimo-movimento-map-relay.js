// SIGC-PRO feature: "Mapa" on Último Movimento — ISOLATED-world relay.
// ultimo-movimento-map.js runs in MAIN world (manifest.json), where
// chrome.* is unavailable — same constraint settings.js documents for its
// own storage read. This file is the only one in this directory allowed
// to touch chrome.runtime; it never touches window.__sigcPro (that object
// lives in MAIN world's separate `window`). It resolves the vendored
// Leaflet bundle's extension URLs once and hands them to
// ultimo-movimento-map.js via a CustomEvent on the shared DOM window
// (MAIN/ISOLATED worlds have separate `window` objects but the same
// document, and DOM event dispatch crosses that boundary — same trick
// settings-relay.js uses for its own broadcast). Fires eagerly at load,
// no waiting for anything, same as settings-relay.js.
// Spec: docs/superpowers/specs/2026-08-08-ultimo-movimento-mapa-design.md
(function () {
  'use strict';

  window.dispatchEvent(new CustomEvent('sigc-pro-leaflet-urls', {
    detail: {
      jsUrl: chrome.runtime.getURL('vendor/leaflet/leaflet.js'),
      cssUrl: chrome.runtime.getURL('vendor/leaflet/leaflet.css'),
    },
  }));
})();
