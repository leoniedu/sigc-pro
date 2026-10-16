// MAIN-world client for the history. It holds NO storage API: the database
// lives in the extension's own origin, owned by historico-worker.js and
// reached through historico-bridge.js (ISOLATED world). Every call is a
// request/reply pair on two attributes of <html>; see the bridge for why
// the DOM and not postMessage.
//
// Concurrency: the attributes are single slots, so two requests in flight
// would clobber each other. Calls are queued here: at most one is on the
// wire, the next is written once the previous reply has arrived.
//
// This directory is storage-sanctioned by scripts/check-privacy.sh and
// must never touch the network.
(function () {
  'use strict';

  if (window.__sigcProHistorico) return;

  const ATTR_REQ = 'data-sigc-pro-hist-req';
  const ATTR_REPLY = 'data-sigc-pro-hist-reply';

  let nextId = 1;
  let inFlight = null;
  const queue = [];

  // How long a call may wait for the ISOLATED side before giving up: the
  // bridge loads at document_start, so a missing answer means it is not
  // there (or the worker is stuck), and a button must not hang forever.
  // Overridable so the test proving an unreachable bridge REJECTS does not
  // sit through the real ceiling.
  let callTimeoutMs = 10000;
  let everSawReply = false;

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type !== 'attributes') continue;
      const raw = document.documentElement.getAttribute(ATTR_REPLY);
      if (!raw) continue;
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        continue;
      }
      everSawReply = true;
      if (!inFlight || msg.id !== inFlight.id) continue; // stale/foreign reply
      const { resolve, reject } = inFlight;
      inFlight = null;
      document.documentElement.removeAttribute(ATTR_REPLY);
      if ('error' in msg) reject(new Error(msg.error));
      else resolve(msg.result);
      pump();
    }
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: [ATTR_REPLY] });

  function pump() {
    if (inFlight || queue.length === 0) return;
    const next = queue.shift();
    inFlight = next;
    const timer = setTimeout(() => {
      if (!inFlight || inFlight.id !== next.id) return;
      inFlight = null;
      const motivo = everSawReply
        ? 'A extensão não respondeu a tempo (armazenamento ocupado ou travado).'
        : 'A extensão não respondeu (armazenamento do histórico indisponível).';
      next.reject(new Error(
        `${motivo} Recarregue a página; se persistir, recarregue a extensão em chrome://extensions.`));
      pump();
    }, callTimeoutMs);
    next.clearTimer = () => clearTimeout(timer);
    document.documentElement.setAttribute(
      ATTR_REQ,
      JSON.stringify({ id: next.id, method: next.method, args: next.args }),
    );
  }

  function call(method, ...args) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const entry = {
        id,
        method,
        args,
        resolve: (v) => { entry.clearTimer(); resolve(v); },
        reject: (e) => { entry.clearTimer(); reject(e); },
        clearTimer: () => {},
      };
      queue.push(entry);
      pump();
    });
  }

  window.__sigcProHistorico = {
    salvarExecucao: (rec) => call('salvarExecucao', rec),
    getResumo: (uf) => call('getResumo', uf),
    listar: (uf, todos) => call('listar', uf, !!todos),
    contar: () => call('contar'),
    limpar: () => call('limpar'),
    getPref: (key) => call('getPref', key),
    setPref: (key, value) => call('setPref', key, value),
    // Test seam: shortens the ceiling above.
    _setTimeoutMs: (ms) => { callTimeoutMs = ms; },
  };
})();
