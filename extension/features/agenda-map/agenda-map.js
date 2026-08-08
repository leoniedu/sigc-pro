// SIGC-PRO feature: "Guia + Mapa" — the ONLY file in this extension
// allowed to make a network request, and only to the SIGC server the
// user is already logged into (URL built from location.origin; the
// privacy gate rejects absolute URLs in this directory). Opt-in: each
// page load, the first click asks for confirmation before any request.
// It fetches the Lista de Endereços report per Controle (POST
// /relatorio/filtrar, an HTML fragment), extracts coordinates and each
// household's real zona (the Agenda slot text lists every zona from
// slot creation, even though a filled slot belongs to exactly one), and
// hands them to window.__sigcPro.dayGuide.generate(enderecos) — the same
// day-guide pipeline, now with geo links, route links and zona. Results
// are cached in memory per Controle for the page's lifetime (never
// persisted) so repeat clicks in one session don't re-fetch.
// Spec: docs/superpowers/specs/2026-07-16-agenda-map-design.md
(function () {
  'use strict';

  const TAG = '[sigc-agenda-map]';

  // --- pure helpers --------------------------------------------------

  // F5 BIG-IP URL-rewriting prefix ("/f5-w-<hex>$$"); the hex decodes to
  // the real backend origin. null on the direct host (e.g. via VPN).
  function f5Prefix(pathname) {
    const m = /^\/f5-w-([0-9a-f]+)\$\$/.exec(String(pathname || ''));
    return m ? { prefix: m[0], hex: m[1] } : null;
  }

  // simple=true: plain prefixed path. simple=false: replicate the shape
  // captured from the live gateway (f5-h-$$ segment + F5_origin/F5CH
  // params). postFiltrar tries simple first, then falls back. slug
  // selects which /relatorio/filtrar report to hit — SIGC serves both
  // Lista de Endereços (slug=ListaEnderecos) and, as of 2026-08-07,
  // Último Movimento (slug=relatorio-ultimo-movimento) through this
  // same generic endpoint.
  function filtrarUrl(origin, pathname, slug, simple) {
    const f5 = f5Prefix(pathname);
    if (!f5) return `${origin}/relatorio/filtrar?slug=${slug}`;
    return simple
      ? `${origin}${f5.prefix}/relatorio/filtrar?slug=${slug}`
      : `${origin}${f5.prefix}/relatorio/f5-h-$$/relatorio/filtrar?slug=${slug};F5_origin=${f5.hex}&F5CH=I`;
  }

  function filtroBody(uf, controle, idFiltro) {
    return 'filtro=' + encodeURIComponent(JSON.stringify({
      IdFiltro: idFiltro,
      IdUf: String(uf),
      IdAgencia: '*',
      IdMunicipio: '*',
      Controle: String(controle),
      TipoVisualizacao: 'S',
    }));
  }

  // headers/rows: plain string arrays from the response table. Columns
  // are resolved by label against LISTA_COMMON_LABELS (pesquisa-neutral:
  // the Agenda page has no report title to detect a pesquisa from), so a
  // backend column reorder can never silently join the wrong columns —
  // unknown headers return null (caller treats as failure).
  function tableToEnderecosMap(headers, rows) {
    const P = window.__sigcPro;
    const labels = P.LISTA_COMMON_LABELS;
    const idx = {};
    for (const key of Object.keys(labels)) {
      const i = headers.findIndex(
        (h) => P.normalizeLabel(h) === P.normalizeLabel(labels[key]));
      if (i === -1) return null;
      idx[key] = i;
    }
    const map = new Map();
    rows.forEach((cells) => {
      const controle = String(cells[idx.controle] || '').trim();
      const domicilio = String(cells[idx.nDomicilio] || '').trim();
      const lat = P.parseCoord(cells[idx.latitude]);
      const lon = P.parseCoord(cells[idx.longitude]);
      const zona = String(cells[idx.nomeZona] || '').trim();
      const idZona = String(cells[idx.idZona] || '').trim();
      const coordsOk = lat != null && lon != null;
      // Zona columns are only filled in for selecionado households —
      // fine here, since the filtro requests TipoVisualizacao 'S'
      // (selecionados only) and Agenda visits are always with
      // selecionados; empty zona cells just fall back to the slot text
      // in the guide. A household with zona but no valid coordinates
      // still gets an entry (lat/lon null): the guide can show its real
      // zona even when it can't map it.
      if (controle && domicilio && (coordsOk || zona || idZona)) {
        map.set(`${controle}|${domicilio}`, {
          lat: coordsOk ? lat : null,
          lon: coordsOk ? lon : null,
          zona,
          idZona,
        });
      }
    });
    return map;
  }

  // Response HTML fragment -> endereços map. DOMParser is inert: nothing
  // in the fetched markup can load resources or run handlers.
  function parseEnderecosHtml(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const table = doc.querySelector('#tableRelatorio');
    if (!table) return null;
    const headers = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    const rows = [...table.querySelectorAll('tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()));
    return tableToEnderecosMap(headers, rows);
  }

  // Último Movimento's own results table (#tableRelatorio, same generic
  // report-table id Lista de Endereços' own response uses — see
  // parseEnderecosHtml above; the two responses are parsed independently
  // and never share a live DOM, so there's no collision), resolved by
  // header label the same way tableToEnderecosMap resolves Lista de
  // Endereços — a live column reorder can never silently join the wrong
  // fields. Unlike Lista de Endereços this table isn't pesquisa-scoped
  // (Último Movimento has no per-pesquisa registry entry), so the labels
  // are matched directly rather than via LISTA_COMMON_LABELS.
  //
  // NO Agência column: confirmed against the live table (2026-08-06) —
  // its real headers are Controle/Domicilio/Entrevistador/Tipo de
  // Entrevista/Última Posição/Data/Observação. An earlier version of
  // this parser wrongly required Agência here, which made every
  // required-header check fail and silently zeroed out Entrevistador
  // too (fail-closed, no error, no warning). Agência is now sourced
  // separately from Relatório Distribuição — see
  // parseDistribuicaoTable below.
  //
  // Domicilio IS required (2026-08-08 fix): this table has one row PER
  // Domicílio under a Controle, each with its own Entrevistador — an
  // earlier version of this parser keyed its map by Controle alone, so
  // every row for the same Controle silently overwrote the previous
  // one and every household but the last in the table lost its real
  // Entrevistador (no error, present-only rendering hid the loss
  // entirely). Keying by controle|domicilio, the same convention
  // agenda-day-guide.js's enderecoKey already uses, fixes this.
  const ULTIMO_MOVIMENTO_LABELS = { controle: 'Controle', domicilio: 'Domicilio', entrevistador: 'Entrevistador' };

  // Strips a leading run of "#"/"!" characters some SIGC report grids
  // prepend to a sortable/filterable column's header text (confirmed
  // live 2026-08-07: "#!Controle", "!Domicílio") — a UI decoration, not
  // part of the label's identity, so it must not be baked into
  // ULTIMO_MOVIMENTO_LABELS itself (that would break the day this
  // decoration is toggled off again).
  function stripHeaderMarker(h) {
    return String(h ?? '').replace(/^[#!]+/, '');
  }

  // Folds any accented character to its unaccented base (NFD decompose +
  // strip combining marks) — same technique lista-agenda.js's normalizar
  // already uses, generalized here since ULTIMO_MOVIMENTO_LABELS mixes
  // accented live headers ("Domicílio") with an unaccented label
  // constant ("Domicilio"); a hardcoded 5-character fold would silently
  // miss any other accented character SIGC's next header variant uses.
  function stripAccents(s) {
    return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  function parseUltimoMovimentoTable(headers, rows) {
    const P = window.__sigcPro;
    const idx = {};
    for (const key of Object.keys(ULTIMO_MOVIMENTO_LABELS)) {
      const expected = P.normalizeLabel(stripAccents(ULTIMO_MOVIMENTO_LABELS[key]));
      const i = headers.findIndex((h) => P.normalizeLabel(stripAccents(stripHeaderMarker(h))) === expected);
      if (i === -1) return null;
      idx[key] = i;
    }
    const map = new Map();
    rows.forEach((cells) => {
      const controle = String(cells[idx.controle] || '').trim();
      if (!controle) return;
      const domicilio = String(cells[idx.domicilio] || '').trim();
      map.set(`${controle}|${domicilio}`, {
        entrevistador: String(cells[idx.entrevistador] || '').trim(),
      });
    });
    return map;
  }

  // Relatório Distribuição's own results table (#tb_distribuir),
  // resolved by header label the same way parseUltimoMovimentoTable
  // resolves Último Movimento. Real live headers (2026-08-06): Controle,
  // Município, Agência Sugerida, Agência Distribuida, Data Distribuição,
  // Usuário da Distribuição. Only "Agência Distribuida" (no accent on
  // "Distribuida" in the live markup — matched verbatim) is read — it
  // is the agência the household was actually assigned to, distinct
  // from "Agência Sugerida" (the system's suggestion, which the coord
  // may have overridden). Confusing the two would silently show the
  // wrong agência, so this table requires "Agência Distribuida"
  // specifically and never falls back to "Sugerida".
  const DISTRIBUICAO_LABELS = { controle: 'Controle', agencia: 'Agência Distribuida' };

  function parseDistribuicaoTable(headers, rows) {
    const P = window.__sigcPro;
    const idx = {};
    for (const key of Object.keys(DISTRIBUICAO_LABELS)) {
      const i = headers.findIndex(
        (h) => P.normalizeLabel(h) === P.normalizeLabel(DISTRIBUICAO_LABELS[key]));
      if (i === -1) return null;
      idx[key] = i;
    }
    const map = new Map();
    rows.forEach((cells) => {
      const controle = String(cells[idx.controle] || '').trim();
      if (!controle) return;
      map.set(controle, {
        agencia: String(cells[idx.agencia] || '').trim(),
      });
    });
    return map;
  }

  // enderecoKey is "controle|domicilio" (see agenda-day-guide.js's own
  // enderecoKey) — split on the FIRST "|" only, since a domicilio value
  // can theoretically contain no "|" itself (matches how the key was
  // built, string concatenation with a literal "|" separator).
  function controleFromKey(key) {
    return key.slice(0, key.indexOf('|'));
  }

  // New Map: every enderecos entry whose full controle|domicilio key
  // matches an entry in umMap gets entrevistador added (2026-08-08 fix:
  // umMap is now keyed the same way enderecos already is — see
  // parseUltimoMovimentoTable — since Último Movimento has one
  // Entrevistador per Domicílio, not one per Controle); entries with no
  // match pass through unchanged (never blocks the guide — see
  // buildSlotCard's existing present-only rendering).
  function mergeUltimoMovimento(enderecos, umMap) {
    const merged = new Map();
    enderecos.forEach((v, k) => {
      const um = umMap.get(k);
      merged.set(k, um ? { ...v, entrevistador: um.entrevistador } : v);
    });
    return merged;
  }

  // Same non-mutating, per-Controle merge contract as
  // mergeUltimoMovimento, adding agencia instead of entrevistador — kept
  // as a separate function rather than folding into
  // mergeUltimoMovimento since the two sources are independently
  // fallible with different key sets; one small function per source is
  // clearer than one juggling both.
  function mergeDistribuicao(enderecos, distMap) {
    const merged = new Map();
    enderecos.forEach((v, k) => {
      const dist = distMap.get(controleFromKey(k));
      merged.set(k, dist ? { ...v, agencia: dist.agencia } : v);
    });
    return merged;
  }

  // --- network (the sanctioned exception) -----------------------------

  // Tries the simple prefixed URL first, then the full captured F5 form
  // (identical on the direct host, where the Set collapses them).
  async function postFiltrar(uf, controle) {
    const urls = [...new Set([
      filtrarUrl(location.origin, location.pathname, 'ListaEnderecos', true),
      filtrarUrl(location.origin, location.pathname, 'ListaEnderecos', false),
    ])];
    let lastErr = new Error('sem resposta');
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: filtroBody(uf, controle, 'ListaEnderecos'),
        });
        if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); continue; }
        const map = parseEnderecosHtml(await res.text());
        if (map) return map;
        lastErr = new Error('tabela não reconhecida');
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }

  // In-memory only, reset on page load: avoids a redundant POST for a
  // Controle already fetched earlier in the same session (e.g. the user
  // regenerates the guide after fixing a slot).
  const enderecosCache = new Map(); // controle -> Map("controle|domicilio" -> {lat,lon,zona,idZona})

  // One sequential POST per distinct Controle not already cached
  // (typically 1-5 per day).
  async function fetchEnderecos(uf, controles) {
    const all = new Map();
    for (const c of controles) {
      if (!enderecosCache.has(c)) {
        enderecosCache.set(c, await postFiltrar(uf, c));
      }
      enderecosCache.get(c).forEach((v, k) => all.set(k, v));
    }
    return all;
  }

  const ULTIMO_MOVIMENTO_SLUG = 'relatorio-ultimo-movimento';

  function filtroBodyUltimoMovimento(uf, controle) {
    return 'filtro=' + encodeURIComponent(JSON.stringify({
      IdFiltro: ULTIMO_MOVIMENTO_SLUG,
      IdUf: String(uf),
      IdAgencia: '*',
      IdMunicipio: '*',
      Controle: String(controle),
      IdEntrevistadores: '*',
      IdTipoAcompanhamento: '*',
    }));
  }

  // As of 2026-08-07, Último Movimento is served through the same
  // generic /relatorio/filtrar?slug=... endpoint Lista de Endereços
  // already used — so this now needs the same simple/full two-mode F5
  // retry loop as postFiltrar, not the plain-path fetchViaGateway this
  // call used before the migration.
  async function postUltimoMovimento(uf, controle) {
    const urls = [...new Set([
      filtrarUrl(location.origin, location.pathname, ULTIMO_MOVIMENTO_SLUG, true),
      filtrarUrl(location.origin, location.pathname, ULTIMO_MOVIMENTO_SLUG, false),
    ])];
    let lastErr = new Error('sem resposta');
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: filtroBodyUltimoMovimento(uf, controle),
        });
        if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); continue; }
        const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
        const table = doc.querySelector('#tableRelatorio');
        if (!table) { lastErr = new Error('tabela não reconhecida'); continue; }
        const headers = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
        const rows = [...table.querySelectorAll('tbody tr')].map((tr) =>
          [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()));
        return parseUltimoMovimentoTable(headers, rows);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }

  // In-memory only, mirrors enderecosCache: controle -> Map(controle ->
  // {entrevistador}) | null (null = fetched, no usable table).
  const ultimoMovimentoCache = new Map();

  // One sequential POST per distinct Controle not already cached. A
  // failed or empty-table Controle is logged and skipped — never fatal
  // to the run, matching fetchEnderecos/postFiltrar's own failure mode.
  async function fetchUltimoMovimento(uf, controles) {
    const all = new Map();
    for (const c of controles) {
      if (!ultimoMovimentoCache.has(c)) {
        try {
          ultimoMovimentoCache.set(c, await postUltimoMovimento(uf, c));
        } catch (err) {
          console.warn(`${TAG} Último Movimento lookup for Controle ${c} failed:`, err);
          ultimoMovimentoCache.set(c, null);
        }
      }
      const result = ultimoMovimentoCache.get(c);
      if (result) result.forEach((v, k) => all.set(k, v));
    }
    return all;
  }

  function filtroBodyDistribuicao(uf, controle) {
    return 'filtro=' + encodeURIComponent(JSON.stringify({
      IdFiltro: '',
      IdUf: String(uf),
      IdMunicipio: '*',
      Controle: String(controle),
    }));
  }

  async function postDistribuicao(uf, controle) {
    const res = await window.__sigcPro.fetchViaGateway('/RelatorioDistribuicao/Filtrar', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: filtroBodyDistribuicao(uf, controle),
    });
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    const table = doc.getElementById('tb_distribuir');
    if (!table) return null;
    const headers = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    const rows = [...table.querySelectorAll('tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()));
    return parseDistribuicaoTable(headers, rows);
  }

  // In-memory only, mirrors ultimoMovimentoCache: controle ->
  // Map(controle -> {agencia}) | null.
  const distribuicaoCache = new Map();

  // One sequential POST per distinct Controle not already cached. Same
  // per-Controle failure isolation as fetchUltimoMovimento: one bad
  // Controle is logged and skipped, never fatal to the run.
  async function fetchDistribuicao(uf, controles) {
    const all = new Map();
    for (const c of controles) {
      if (!distribuicaoCache.has(c)) {
        try {
          distribuicaoCache.set(c, await postDistribuicao(uf, c));
        } catch (err) {
          console.warn(`${TAG} Distribuição lookup for Controle ${c} failed:`, err);
          distribuicaoCache.set(c, null);
        }
      }
      const result = distribuicaoCache.get(c);
      if (result) result.forEach((v, k) => all.set(k, v));
    }
    return all;
  }

  // --- UI --------------------------------------------------------------

  const BUTTON_ID = 'sigc-pro-agenda-mapa-button';

  // In-memory only (zero-storage guarantee): re-asked on every page load.
  let consentGiven = false;
  const CONSENT_MSG =
    'SIGC-PRO: isto fará uma consulta ao próprio servidor do SIGC para ' +
    'obter as coordenadas, zona, agência e entrevistador dos endereços. ' +
    'Nenhum dado sai do IBGE. Continuar?';

  // Declining is not a cancel: this is the only guide button, so a "não"
  // still produces the guide, just without the fetched coordinates and
  // zona — the same map-free artifact the standalone button used to make.
  async function exportGuideMap(btn) {
    let consentiu = consentGiven;
    if (!consentiu) {
      consentiu = confirm(CONSENT_MSG);
      if (consentiu) consentGiven = true;
    }
    const rows = window.__sigcPro.readAgendaSlots();
    if (rows.length === 0) {
      alert('SIGC-PRO: nenhum slot encontrado na agenda — confira se UF/dia já carregaram.');
      return;
    }
    const uf = window.__sigcPro.getAgendaUf().code;
    const controles = [...new Set(
      rows.filter((r) => r.reservado).map((r) => r.controle).filter(Boolean))];

    let enderecos = null;
    if (!consentiu) {
      // Silent: the user just answered the prompt, so an alert would only
      // restate their own choice back at them.
      console.log(`${TAG} consulta recusada — guia gerado sem mapa.`);
    } else if (uf && controles.length > 0) {
      btn.disabled = true;
      try {
        enderecos = await fetchEnderecos(uf, controles);
        console.log(`${TAG} ${enderecos.size} endereço(s) de ${controles.length} controle(s).`);
        const umMap = await fetchUltimoMovimento(uf, controles);
        enderecos = mergeUltimoMovimento(enderecos, umMap);
        console.log(`${TAG} ${umMap.size} controle(s) com entrevistador.`);
        const distMap = await fetchDistribuicao(uf, controles);
        enderecos = mergeDistribuicao(enderecos, distMap);
        console.log(`${TAG} ${distMap.size} controle(s) com agência.`);
      } catch (err) {
        alert(`SIGC-PRO: não foi possível obter coordenadas (${err && err.message}); ` +
          'o guia será gerado sem mapa.');
      } finally {
        btn.disabled = false;
      }
    } else {
      alert('SIGC-PRO: nenhum controle reservado no dia — o guia será gerado sem mapa.');
    }
    window.__sigcPro.dayGuide.generate(enderecos);
  }

  // Same Dia-only visibility as Guia do Dia. The old dayGuide-presence
  // poll is gone: manifest load order guarantees agenda-day-guide ran
  // first, and `when` re-checks it defensively each tick anyway.
  // exportGuideMap needs the button itself (to disable it during the
  // fetch) — taken from the click event.
  window.__sigcPro.mountWidget({
    id: BUTTON_ID,
    anchor: (ctx) => ctx.agendaChunk(),
    when: (ctx) =>
      ctx.onAgenda() && !!window.__sigcPro.dayGuide &&
      window.__sigcPro.dayGuide.diaViewActive(),
    build: () => {
      console.log(`${TAG} Guia do Dia button added.`);
      return window.__sigcPro.makeFcProButton({
        id: BUTTON_ID,
        text: 'Guia do Dia',
        title: 'Guia do dia por equipe, com mapa mediante consulta ao ' +
          'servidor do SIGC (SIGC-PRO)',
        onClick: (e) => exportGuideMap(e.currentTarget),
      });
    },
  });

  // Exposed only for tests — not part of the runtime public surface.
  window.__sigcProAgendaMapInternals = { parseUltimoMovimentoTable, mergeUltimoMovimento, parseDistribuicaoTable, mergeDistribuicao, filtrarUrl };
})();
