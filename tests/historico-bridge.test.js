import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { IDBFactory } from 'fake-indexeddb';

// Both scripts are loaded into the SAME window here, as the browser never
// does: MAIN and ISOLATED are different JS realms that do NOT share window
// globals, but DO share `document` — the one thing this exercises. The
// client (MAIN) holds no storage API; every call is a request/reply pair
// on <html> attributes, answered by the bridge through the worker's real
// message handler and a real (fake-indexeddb) database.
// The attribute transport rides on MutationObserver, which every browser
// delivers reliably but happy-dom drops intermittently (a notification for
// an attribute write simply never arrives, about one run in three). This
// file tests OUR logic — queueing, relaying, error paths — so it observes
// the two attributes with a small deterministic stand-in, installed only
// while the scripts under test register their observers.
const registrados = [];
const raiz = document.documentElement;
const setReal = raiz.setAttribute.bind(raiz);
const removeReal = raiz.removeAttribute.bind(raiz);
const avisar = (nome) => registrados.forEach((o) => {
  if (o.filtro.includes(nome)) queueMicrotask(() => o.cb([{ type: 'attributes', attributeName: nome }], o));
});
raiz.setAttribute = (nome, valor) => { setReal(nome, valor); avisar(nome); };
raiz.removeAttribute = (nome) => { removeReal(nome); avisar(nome); };
const MOReal = globalThis.MutationObserver;
globalThis.MutationObserver = class {
  constructor(cb) { this.cb = cb; this.filtro = []; }
  observe(alvo, opts) { this.filtro = opts.attributeFilter || []; registrados.push(this); }
  disconnect() {}
};
await import('../extension/features/gerenciamento-historico/historico-db.js');
globalThis.indexedDB = new IDBFactory();
globalThis.chrome = globalThis.chrome || {};
let ouvinte = null;
globalThis.chrome.runtime = {
  lastError: undefined,
  onMessage: { addListener: (fn) => { ouvinte = fn; } },
  // A round trip to the worker's handler. The reply is delivered on a later
  // task, as Chrome does between a content script and the service worker.
  sendMessage: (msg, cb) => {
    const manteve = ouvinte(msg, {}, (resp) => setTimeout(() => cb(resp), 0));
    if (manteve === false) setTimeout(() => cb(undefined), 0);
  },
};
await import('../extension/features/gerenciamento-historico/historico-worker.js');
await import('../extension/features/gerenciamento-historico/historico-bridge.js');
await import('../extension/features/gerenciamento-historico/historico-client.js');
globalThis.MutationObserver = MOReal;
const H = window.__sigcProHistorico;

const rec = (uf, dia, total = 5) => ({ uf, dia, run_ts: 1, total, agencias: {}, contagens: [], recusaDomicilio: [] });

beforeEach(async () => { await H.limpar(); });

describe('client -> bridge -> worker -> database', () => {
  test('saves and lists through the DOM attributes', async () => {
    await H.salvarExecucao(rec('29', '2026-10-15', 7));
    const lista = await H.listar('29');
    expect(lista).toHaveLength(1);
    expect(lista[0].total).toBe(7);
    expect(await H.getResumo('29')).toEqual([{ chave: '29|2026-10-15', dia: '2026-10-15', run_ts: 1, total: 7 }]);
  });

  test('listar crosses the bridge as one run per week unless every day is asked for', async () => {
    const r = (dia, semana) => ({ ...rec('29', dia), semana });
    for (const [dia, semana] of [['2026-10-05', '2026-W41'], ['2026-10-07', '2026-W41'], ['2026-10-12', '2026-W42'],
      ['2026-10-14', '2026-W42'], ['2026-10-16', '2026-W42']]) await H.salvarExecucao(r(dia, semana));
    // last of week 41, then the two most recent days
    expect((await H.listar('29')).map((x) => x.dia)).toEqual(['2026-10-07', '2026-10-14', '2026-10-16']);
    expect(await H.listar('29', true)).toHaveLength(5);
  });

  test('the same call twice in a row still works (the slot is cleared between)', async () => {
    expect(await H.contar()).toEqual({ execucoes: 0, ufs: [] });
    expect(await H.contar()).toEqual({ execucoes: 0, ufs: [] });
  });

  test('concurrent calls are queued, not clobbered', async () => {
    const out = await Promise.all([
      H.salvarExecucao(rec('29', '2026-10-14')),
      H.salvarExecucao(rec('29', '2026-10-15')),
      H.salvarExecucao(rec('31', '2026-10-15')),
    ]);
    expect(out).toHaveLength(3);
    expect(await H.contar()).toEqual({ execucoes: 3, ufs: ['29', '31'] });
  });

  test('prefs and limpar', async () => {
    await H.setPref('metrica', 'concluido');
    expect(await H.getPref('metrica')).toBe('concluido');
    await H.salvarExecucao(rec('29', '2026-10-15'));
    await H.limpar();
    expect(await H.contar()).toEqual({ execucoes: 0, ufs: [] });
  });

  test('a database error comes back as a rejected promise', async () => {
    await expect(H.salvarExecucao({ dia: '2026-10-15' })).rejects.toThrow('sem uf/dia');
  });

  test('the attributes are left clean afterwards', async () => {
    await H.contar();
    expect(document.documentElement.getAttribute('data-sigc-pro-hist-req')).toBeNull();
    expect(document.documentElement.getAttribute('data-sigc-pro-hist-reply')).toBeNull();
  });
});

describe('the bridge only relays what it allows', () => {
  test('an unknown method is refused with a clear error', async () => {
    const B = window.__sigcProHistoricoBridge;
    expect(B.METHOD_NAMES).not.toContain('apagarBanco');
    document.documentElement.setAttribute(B.ATTR_REQ, JSON.stringify({ id: 9001, method: 'apagarBanco', args: [] }));
    await new Promise((r) => setTimeout(r, 0));
    const reply = JSON.parse(document.documentElement.getAttribute(B.ATTR_REPLY));
    expect(reply).toEqual({ id: 9001, error: 'Método desconhecido: apagarBanco' });
    document.documentElement.removeAttribute(B.ATTR_REPLY);
  });
});

describe('an unreachable bridge rejects instead of hanging', () => {
  test('no reply within the ceiling', async () => {
    const real = chrome.runtime.sendMessage;
    chrome.runtime.sendMessage = () => {};   // the worker never answers
    H._setTimeoutMs(30);
    await expect(H.contar()).rejects.toThrow('não respondeu');
    H._setTimeoutMs(10000);
    chrome.runtime.sendMessage = real;
  });
});

describe('source shape: who may touch storage', () => {
  const ler = (f) => Bun.file(new URL(`../extension/features/gerenciamento-historico/${f}`, import.meta.url)).text();
  const semComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  test('only the db file and the worker name indexedDB; client, bridge and the tab never do', async () => {
    for (const f of ['historico-client.js', 'historico-bridge.js', 'historico-agregar.js', 'historico-view.js']) {
      const src = semComentarios(await ler(f));
      expect(src).not.toMatch(/indexedDB/);
      expect(src).not.toMatch(/chrome\.storage|localStorage|sessionStorage/);
    }
    expect(semComentarios(await ler('historico-worker.js'))).toMatch(/indexedDB/);
  });

  test('nothing in the directory touches the network', async () => {
    for (const f of ['historico-db.js', 'historico-worker.js', 'historico-bridge.js', 'historico-client.js', 'historico-agregar.js', 'historico-view.js']) {
      expect(semComentarios(await ler(f))).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon|WebSocket|importScripts/);
    }
  });
});
