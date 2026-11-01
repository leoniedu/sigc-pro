// ISOLATED-world relay between the page and the history database.
//
// The panel runs in the MAIN world (it reuses the page's own jQuery and
// DataTables and its authenticated session), which has no chrome.runtime.
// This script runs in the ISOLATED world, which does, and relays each
// request to historico-worker.js — the service worker that owns the
// database. It opens NO database itself.
//
// Why not postMessage: the portal is served through F5 BIG-IP APM's
// JavaScript rewriting layer, which wraps the page's own globals; a
// postMessage round trip between the two worlds does not reliably survive
// it (confirmed in munic-pro, which has the same portal). Both worlds
// share `document`, and a DOM attribute has no delivery race, so the
// request/response travels on two attributes of <html> — the approach
// ultimo-movimento-map-relay.js already uses for its URLs.
//
// Loads at document_start on every page of the three portal hosts; off the
// report page it only waits, and nothing is opened until a request arrives.
//
// This directory is storage-sanctioned by scripts/check-privacy.sh and
// must never touch the network.
(function () {
  'use strict';

  if (window.__sigcProHistoricoBridge) return;

  // Each attribute is a SINGLE slot holding the CURRENT in-flight
  // request/reply; historico-client.js never has two requests on the wire.
  const ATTR_REQ = 'data-sigc-pro-hist-req';
  const ATTR_REPLY = 'data-sigc-pro-hist-reply';

  // The only methods the page may call. The transport is a DOM attribute, so
  // any script running in the page could write it (as it could read the
  // counts off the report itself): there is no authentication to add. What
  // this guards is the surface — a fixed list of methods, none of which
  // takes a key, a store name or a query — and what it holds, which is
  // per-agência counts the page already shows, never a household.
  const METHOD_NAMES = [
    'salvarExecucao', 'getResumo', 'listar', 'contar', 'limpar', 'getPref', 'setPref',
  ];

  function viaWorker(method, args) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ sigcPro: 'historico', method, args }, (resp) => {
        const err = chrome.runtime.lastError;
        if (err) { reject(new Error(err.message)); return; }
        if (!resp) { reject(new Error('o service worker não respondeu.')); return; }
        if ('error' in resp) reject(new Error(resp.error));
        else resolve(resp.result);
      });
    });
  }

  function writeReply(payload) {
    document.documentElement.setAttribute(ATTR_REPLY, JSON.stringify(payload));
  }

  function handleRequest(msg) {
    // Cleared as soon as it is read, so the NEXT request may carry the exact
    // same JSON and still produce a DOM mutation (setAttribute with an
    // unchanged value fires nothing).
    document.documentElement.removeAttribute(ATTR_REQ);

    const { id, method, args } = msg;
    if (!METHOD_NAMES.includes(method)) {
      writeReply({ id, error: `Método desconhecido: ${method}` });
      return;
    }
    viaWorker(method, args || [])
      .then((result) => writeReply({ id, result }))
      .catch((err) => writeReply({ id, error: String((err && err.message) || err) }));
  }

  // A MutationObserver on <html>'s attributes, filtered to the one request
  // attribute, rather than a 'message' listener: it fires regardless of
  // whatever the page's rewriter does to window-level events.
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type !== 'attributes') continue;
      const raw = document.documentElement.getAttribute(ATTR_REQ);
      if (!raw) continue;
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        continue; // not one of ours / malformed — ignore rather than throw
      }
      handleRequest(msg);
    }
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: [ATTR_REQ] });

  window.__sigcProHistoricoBridge = { ATTR_REQ, ATTR_REPLY, METHOD_NAMES };
})();
