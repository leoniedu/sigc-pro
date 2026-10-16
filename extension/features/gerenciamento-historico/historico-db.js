// The history database itself: every IndexedDB operation, in one place.
// GEREN-PRO keeps, per UF and per day, the agência-level counts of the
// Gerenciamento da Coleta report (never a household), so the Histórico tab
// can show how each agência moves from week to week.
// Spec: docs/superpowers/specs/2026-10-15-gerenciamento-historico-design.md
//
// Where it runs decides whose database it is. Content scripts — MAIN and
// ISOLATED world alike — get the PORTAL's origin for IndexedDB, which
// differs between portalweb and portalweb2 and is erased by clearing the
// portal's site data; the extension's own origin is reachable only from
// its service worker. So the live history is opened by historico-worker.js
// alone. criarDb(factory) binds every operation to one IDBFactory, which
// is how the tests use fake-indexeddb.
//
// Written against globalThis rather than window: it also loads in the
// service worker, which has no window.
//
// This directory is storage-sanctioned by scripts/check-privacy.sh and
// must never touch the network.
(function () {
  'use strict';

  if (globalThis.__sigcProHistoricoDb) return;

  const DB_NAME = 'sigc-pro-historico';
  const DB_VERSION = 1;
  const STORE_EXECUCOES = 'execucoes';
  const STORE_PREFS = 'prefs';

  function promisify(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  function criarDb(factory) {
    function abrir() {
      return new Promise((resolve, reject) => {
        const req = factory.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE_EXECUCOES)) {
            // One record per UF per day: key "<uf>|<yyyy-mm-dd>", so the
            // last run of a day replaces the earlier ones and growth stays
            // bounded at one record per UF per day.
            const s = db.createObjectStore(STORE_EXECUCOES, { keyPath: 'chave' });
            s.createIndex('uf', 'uf');
          }
          if (!db.objectStoreNames.contains(STORE_PREFS)) {
            db.createObjectStore(STORE_PREFS, { keyPath: 'key' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }

    // Runs `fn(store...)` in one transaction and closes the connection.
    async function comTx(stores, modo, fn) {
      const db = await abrir();
      try {
        const tx = db.transaction(stores, modo);
        const resultado = await fn(...[].concat(stores).map((s) => tx.objectStore(s)));
        if (modo === 'readwrite') await txDone(tx);
        return resultado;
      } finally {
        db.close();
      }
    }

    // Replaces any earlier run of the same UF and day.
    function salvarExecucao(rec) {
      if (!rec || !rec.uf || !rec.dia) return Promise.reject(new Error('execução sem uf/dia.'));
      const completo = { ...rec, chave: `${rec.uf}|${rec.dia}` };
      return comTx(STORE_EXECUCOES, 'readwrite', (s) => promisify(s.put(completo)));
    }

    // Light listing for the short-response guard: no counts.
    async function getResumo(uf) {
      const todas = await comTx(STORE_EXECUCOES, 'readonly',
        (s) => promisify(s.index('uf').getAll(uf)));
      return todas
        .map((r) => ({ chave: r.chave, dia: r.dia, run_ts: r.run_ts, total: r.total }))
        .sort((a, b) => a.dia.localeCompare(b.dia));
    }

    // The runs of a UF, oldest first. By default only what the tab can show:
    // the last run of each ISO week (`semana`, set when the run is built)
    // plus the two most recent days, which the tab shows one by one. That
    // keeps the reply that crosses the bridge — one DOM attribute — small
    // however long the history grows. `todos` returns every day, for the CSV
    // export.
    async function listar(uf, todos) {
      const todas = (await comTx(STORE_EXECUCOES, 'readonly',
        (s) => promisify(s.index('uf').getAll(uf)))).sort((a, b) => a.dia.localeCompare(b.dia));
      if (todos) return todas;
      const escolhidas = new Map();
      todas.forEach((r) => escolhidas.set(r.semana || r.dia, r));       // later days win
      todas.slice(-2).forEach((r) => escolhidas.set(r.chave, r));
      return [...new Map([...escolhidas.values()].map((r) => [r.chave, r])).values()]
        .sort((a, b) => a.dia.localeCompare(b.dia));
    }

    // { execucoes, ufs } across the whole database, for the confirmation
    // of "Limpar histórico".
    async function contar() {
      const todas = await comTx(STORE_EXECUCOES, 'readonly',
        (s) => promisify(s.getAll()));
      return { execucoes: todas.length, ufs: [...new Set(todas.map((r) => r.uf))].sort() };
    }

    // Every run of every UF. Preferences (the panel's remembered choices)
    // are not history and stay.
    function limpar() {
      return comTx(STORE_EXECUCOES, 'readwrite', (s) => promisify(s.clear()));
    }

    async function getPref(key) {
      const r = await comTx(STORE_PREFS, 'readonly', (s) => promisify(s.get(key)));
      return r ? r.value : null;
    }

    function setPref(key, value) {
      return comTx(STORE_PREFS, 'readwrite', (s) => promisify(s.put({ key, value })));
    }

    return { salvarExecucao, getResumo, listar, contar, limpar, getPref, setPref };
  }

  globalThis.__sigcProHistoricoDb = { criarDb, DB_NAME };
})();
