// Service worker: the owner of the history database.
//
// It runs on the extension's own origin, so there is ONE history for every
// portal host, and it survives clearing the portal's site data (the usual
// fix for an F5 login loop). Content scripts cannot open it themselves —
// their IndexedDB is the portal's. historico-bridge.js forwards every
// request here with chrome.runtime.sendMessage, which needs no manifest
// permission.
//
// A module worker, loading the shared code with a static import: the
// classic worker's script loader is on the privacy gate's banned list.
//
// This directory is storage-sanctioned by scripts/check-privacy.sh and
// must never touch the network.
import './historico-db.js';

const DB = globalThis.__sigcProHistoricoDb.criarDb(indexedDB);

const METHODS = {
  salvarExecucao: DB.salvarExecucao,
  getResumo: DB.getResumo,
  listar: DB.listar,
  contar: DB.contar,
  limpar: DB.limpar,
  getPref: DB.getPref,
  setPref: DB.setPref,
};

function handleMessage(msg, sender, sendResponse) {
  if (!msg || msg.sigcPro !== 'historico') return false;
  const fn = METHODS[msg.method];
  if (typeof fn !== 'function') {
    sendResponse({ error: `Método desconhecido: ${msg.method}` });
    return false;
  }
  Promise.resolve()
    .then(() => fn(...(msg.args || [])))
    .then((result) => sendResponse({ result }))
    .catch((err) => sendResponse({ error: String((err && err.message) || err) }));
  // Keeps the channel open for the async reply.
  return true;
}

chrome.runtime.onMessage.addListener(handleMessage);

globalThis.__sigcProHistoricoWorker = { handleMessage, METHODS };
