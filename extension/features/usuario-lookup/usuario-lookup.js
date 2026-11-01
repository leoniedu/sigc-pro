// SIGC-PRO feature: usuário lookup — resolves a SIAPE to that user's
// cadastro (função, e-mail, telefone/celular, posto/agência) from the
// SIGC usuário module, for the Carta de notificação. One of the few
// directories allowed to make network requests — see
// scripts/check-privacy.sh (FETCH_DIRS). Two same-origin requests per
// lookup, both through the page's own F5 gateway, to the usuário
// module's backend (sigc-common's USUARIO_ORIGIN_HEX):
//   1. POST /usuario/Grid            — siape -> user id (HTML table)
//   2. GET  /usuario/EditarUsuario   — id -> cadastro form (HTML form)
// Nothing is stored: results live in a per-page Map for 60 seconds.
// Lives apart from carta-notificacao/ on purpose: a fetch-sanctioned
// directory may not assign a script source (which the PDF feature needs to load
// its vendored library), and a local-resource directory may not fetch.
// Spec: docs/superpowers/specs/2026-10-09-carta-notificacao-design.md
(function () {
  'use strict';

  const TAG = '[sigc-usuario-lookup]';
  const CACHE_TTL_MS = 60 * 1000;

  const P = () => window.__sigcPro;

  const GRID_PATH = '/usuario/Grid';
  const EDITAR_PATH = '/usuario/EditarUsuario';
  const REFERER_PATH = '/usuario/';

  // --- pure helpers ----------------------------------------------------

  const fold = (s) => String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/^[#!]+/, '')
    .trim().toLowerCase().replace(/\s+/g, ' ');

  // The Grid form body SIGC's own page posts, every filter blank except
  // Login (the SIAPE) and StatusUsuario. Captured live 2026-10-09.
  function gridBody(siape, codigoPesquisa) {
    const cp = codigoPesquisa || P().USUARIO_CODIGO_PESQUISA;
    return `CodigoPesquisa=${encodeURIComponent(cp)}&Nome=&IdUFSelecionada=` +
      '&IdPostoSelecionado=&IdFuncaoSelecionada=&Patrimonio=&UnidadeTrabalho=' +
      `&Login=${encodeURIComponent(String(siape ?? '').trim())}&StatusUsuario=true`;
  }

  function editarPath(id, codigoPesquisa) {
    const cp = codigoPesquisa || P().USUARIO_CODIGO_PESQUISA;
    return `${EDITAR_PATH}?codigoPesquisa=${encodeURIComponent(cp)}&id=${encodeURIComponent(String(id))}`;
  }

  function refererPath(codigoPesquisa) {
    const cp = codigoPesquisa || P().USUARIO_CODIGO_PESQUISA;
    return `${REFERER_PATH}?codigoPesquisa=${encodeURIComponent(cp)}`;
  }

  // Grid response -> { id, nome, siape, uf, funcao, posto } of the row
  // whose Matrícula IS the siape asked for (the module's Login filter
  // may be a prefix/contains search, and a neighbour's cadastro on a
  // letter is worse than none), or null when no row matches / the table
  // is empty (unknown SIAPE). Without a siape, the first row. Cells are
  // mapped by header text, never by position: the action columns come
  // and go with the viewer's permissions. The id is not a column — it
  // is the value of the row's action <button>s (all carry the same
  // value). Matrícula is the SIAPE, and is rejected where an IdUsuario
  // is expected.
  function parseGridHtml(html, siape) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const table = doc.querySelector('table');
    if (!table) return null;
    const ths = [...table.querySelectorAll('thead th')].map((th) => fold(th.textContent));
    if (ths.length === 0) return null;
    const wanted = String(siape ?? '').trim();
    for (const tr of table.querySelectorAll('tbody tr')) {
      const tds = [...tr.querySelectorAll('td')];
      // A "no records" row is a single colspan cell, not a user.
      if (tds.length < 2) continue;
      const col = (...labels) => {
        for (const l of labels) {
          const i = ths.indexOf(fold(l));
          if (i !== -1 && tds[i]) return tds[i].textContent.trim();
        }
        return '';
      };
      const btn = tr.querySelector('button[value], input[type="button"][value]');
      const rec = {
        id: btn ? String(btn.getAttribute('value') || '').trim() : '',
        nome: col('Nome'),
        siape: col('Matrícula', 'Matricula', 'Login', 'SIAPE'),
        uf: col('UF'),
        funcao: col('Função', 'Funcao', 'Cargo'),
        posto: col('Posto', 'Agência', 'Agencia', 'Unidade'),
      };
      if (!rec.id && !rec.nome) continue;
      if (wanted && rec.siape.replace(/\D/g, '') !== wanted.replace(/\D/g, '')) continue;
      return rec;
    }
    return null;
  }

  // Field candidates, by input name/id (case-insensitive, matched as a
  // whole token after stripping a model prefix like "Usuario.") and by
  // label text. The live form's exact names were not captured when this
  // parser was written — see the fixture's header — so both routes are
  // tried; a missing field is '' and never an error.
  const EDITAR_FIELDS = {
    nome: { names: ['nome', 'nomeusuario', 'nomecompleto'], labels: ['nome'] },
    siape: { names: ['login', 'siape', 'matricula'], labels: ['login', 'siape', 'matricula'] },
    email: { names: ['email', 'emailinstitucional', 'e-mail'], labels: ['e-mail', 'email', 'e-mail institucional'] },
    telefone: { names: ['telefone', 'fone', 'telefonefixo'], labels: ['telefone'] },
    celular: { names: ['celular', 'telefonecelular', 'celularpessoal'], labels: ['celular', 'telefone celular'] },
    funcao: { names: ['idfuncao', 'funcao', 'idfuncaoselecionada', 'cargo', 'idcargo'], labels: ['funcao', 'cargo'] },
    agencia: { names: ['idposto', 'posto', 'idpostoselecionado', 'agencia', 'idagencia', 'unidadetrabalho'], labels: ['posto', 'agencia', 'unidade de trabalho', 'posto/agencia'] },
  };

  function controlValue(el) {
    if (!el) return '';
    const tag = el.tagName.toLowerCase();
    if (tag === 'select') {
      // Only an explicit selection: a browser's implicit first option
      // ("Selecione") is not a value.
      const opt = el.querySelector('option[selected]');
      return opt ? opt.textContent.trim() : '';
    }
    const type = String(el.getAttribute('type') || '').toLowerCase();
    if (type === 'hidden' && tag === 'input') return String(el.getAttribute('value') || '').trim();
    return String(el.value ?? el.getAttribute('value') ?? '').trim();
  }

  function tokenOf(attr) {
    // "Usuario.Email" / "Usuario_Email" / "txtEmail" -> "email"
    const s = fold(attr).replace(/^(txt|sel|ddl|cbo)/, '');
    const parts = s.split(/[._]/);
    return parts[parts.length - 1].replace(/[^a-z0-9-]/g, '');
  }

  // The cadastro form, when the response also carries the layout's own
  // search boxes (a "Nome" filter, a "Login" filter): the form holding
  // the user's hidden Id, else the whole document.
  function editRoot(doc) {
    for (const form of doc.querySelectorAll('form')) {
      const hasId = [...form.querySelectorAll('input[type="hidden"]')]
        .some((el) => ['id', 'idusuario'].includes(tokenOf(el.getAttribute('name') || el.getAttribute('id'))) &&
          String(el.getAttribute('value') || '').trim());
      if (hasId) return form;
    }
    return doc;
  }

  function findByName(doc, names) {
    const controls = [...editRoot(doc).querySelectorAll('input, select, textarea')];
    for (const n of names) {
      const hit = controls.find((el) =>
        tokenOf(el.getAttribute('name')) === n || tokenOf(el.getAttribute('id')) === n);
      if (hit) return hit;
    }
    return null;
  }

  function findByLabel(doc, labels) {
    const wanted = labels.map(fold);
    for (const label of editRoot(doc).querySelectorAll('label')) {
      const t = fold(label.textContent).replace(/[:*]+$/, '').trim();
      if (!wanted.includes(t)) continue;
      const forId = label.getAttribute('for');
      let el = forId ? doc.getElementById(forId) : null;
      if (!el) el = label.querySelector('input, select, textarea');
      if (!el) {
        // Bootstrap-style: label then control in the same form-group.
        const group = label.parentElement;
        el = group && group.querySelector('input, select, textarea');
      }
      if (el) return el;
    }
    return null;
  }

  // EditarUsuario response -> cadastro record, every field '' when
  // absent. Never throws on markup it does not recognise.
  function parseEditarUsuarioHtml(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const out = {};
    for (const [key, spec] of Object.entries(EDITAR_FIELDS)) {
      const el = findByName(doc, spec.names) || findByLabel(doc, spec.labels);
      out[key] = controlValue(el);
    }
    return out;
  }

  // --- session detection ---------------------------------------------------------

  // The usuário module has its own session, separate from the report
  // pages'. Without one it does not answer the Grid: the gateway returns
  // the OpenID Connect "Working..." page — a form made only of hidden
  // inputs that a script submits to the SIGC authentication service
  // (confirmed live 2026-10-09) — or, further along, the login page.
  // Neither is followed here: logging in is the user's act, done by
  // opening the module in a tab (ErroAutenticacao.loginUrl). The lookup
  // only recognises the situation so the letter can say so.
  function isAuthRedirect(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    if (doc.querySelector('table')) return false;
    const form = doc.querySelector('form');
    if (!form) return false;
    const inputs = [...form.querySelectorAll('input, select, textarea, button')]
      .filter((el) => !el.closest('noscript'));
    return inputs.length > 0 && inputs.every((el) =>
      el.tagName === 'INPUT' && String(el.getAttribute('type') || '').toLowerCase() === 'hidden');
  }

  function isLoginPage(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    return Boolean(doc.querySelector('input[type="password"]'));
  }

  // Where the user logs in: the module's index through the same
  // gateway. A same-origin URL for the user (or a tab) to open; never
  // requested here.
  function loginUrl() {
    return P().usuarioGatewayUrl(location.origin, location.pathname, refererPath());
  }

  class ErroAutenticacao extends Error {
    constructor() {
      super('sessão do módulo de usuários do SIGC não iniciada');
      this.name = 'ErroAutenticacao';
      this.code = 'auth';
      this.loginUrl = loginUrl();
    }
  }

  // --- network ------------------------------------------------------------

  // `referrer`, not a Referer header: Referer is a forbidden header name
  // and the browser drops it silently (see agenda-lookups' postRelatorio).
  // The referrer is a same-origin URL — the usuário module's index page
  // through the same gateway prefix.
  function referrerUrl() {
    return P().usuarioGatewayUrl(location.origin, location.pathname, refererPath());
  }

  // redirect: 'manual' — a redirect (to the sign-in service, say) is
  // never followed by this code: it reads as "no session", and the
  // browser's own tab does the signing in (see carta-notificacao). The
  // response stays on location.origin by construction.
  async function fetchText(path, init) {
    const url = P().usuarioGatewayUrl(location.origin, location.pathname, path);
    const res = await fetch(url, {
      credentials: 'same-origin',
      referrer: referrerUrl(),
      redirect: 'manual',
      ...init,
      headers: P().proHeaders(init && init.headers),
    });
    if (res.type === 'opaqueredirect' || res.status === 0) throw new ErroAutenticacao();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }

  async function fetchGrid(siape) {
    return fetchText(GRID_PATH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: gridBody(siape),
    });
  }

  async function fetchEditar(id) {
    return fetchText(editarPath(id), {
      method: 'GET',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
  }

  // siape -> { id, nome, siape, funcao, email, telefone, celular, agencia }
  // or null (unknown SIAPE). Rejects on a network/HTTP failure — the
  // caller decides what a letter without a cadastro looks like.
  async function lookupUsuarioUncached(siape) {
    const gridHtml = await fetchGrid(siape);
    if (isAuthRedirect(gridHtml) || isLoginPage(gridHtml)) throw new ErroAutenticacao();
    const grid = parseGridHtml(gridHtml, siape);
    if (!grid || !grid.id) return null;
    const cad = parseEditarUsuarioHtml(await fetchEditar(grid.id));
    return {
      id: grid.id,
      // The Grid row was matched on the siape; its name is the verified
      // one. The form's is a fallback.
      nome: grid.nome || cad.nome || '',
      siape: String(siape).trim(),
      funcao: cad.funcao || grid.funcao || '',
      email: cad.email || '',
      telefone: cad.telefone || '',
      celular: cad.celular || '',
      agencia: cad.agencia || grid.posto || '',
    };
  }

  // In-memory, per page, per SIAPE, 60 seconds: a second click on the
  // same agent's households within a minute makes no request. The
  // promise is cached so two clicks in flight share one lookup; a
  // rejection is evicted so the next click retries.
  const cache = new Map();
  let now = () => Date.now();

  function lookupUsuario(siape) {
    const key = String(siape ?? '').trim();
    if (!key) return Promise.resolve(null);
    const hit = cache.get(key);
    if (hit && now() - hit.at < CACHE_TTL_MS) return hit.record;
    const record = lookupUsuarioUncached(key).catch((err) => {
      cache.delete(key);
      throw err;
    });
    cache.set(key, { at: now(), record });
    return record;
  }

  function resetUsuarioCache() { cache.clear(); }

  // Exposed for carta-notificacao.js (lookupUsuario) and for tests.
  window.__sigcProUsuarioLookup = {
    lookupUsuario,
    resetUsuarioCache,
    parseGridHtml,
    parseEditarUsuarioHtml,
    isAuthRedirect,
    isLoginPage,
    ErroAutenticacao,
    loginUrl,
    gridBody,
    editarPath,
    refererPath,
    referrerUrl,
    CACHE_TTL_MS,
    TAG,
    // test hook: override the clock
    _setNow(fn) { now = fn || (() => Date.now()); },
  };
})();
