// SIGC-PRO feature: the "Guia do Dia" button and the data lookups behind
// it. Despite the button's label this module draws NO map — it enriches
// the Agenda's already-rendered slots with data the Agenda page doesn't
// show, then hands the result to window.__sigcPro.dayGuide.generate(),
// which renders everything (including the SVG route map — see
// agenda-day-guide/route-map.js). Named features/agenda-map/ until
// 2026-08-10; renamed because "map" described the consumer, not this.
//
// It queries three SIGC reports, once per distinct Controle, and merges
// them by "controle|domicilio" (agenda-day-guide.js's enderecoKey):
//   - Lista de Endereços      -> lat/lon + each household's real zona
//                                (the Agenda slot text lists every zona
//                                from slot creation, though a filled
//                                slot belongs to exactly one)
//   - Último Movimento        -> entrevistador (one per Domicílio)
//   - Relatório Distribuição  -> agência distribuída
// Only the first is required: the other two fail soft per Controle, so a
// bad lookup degrades the guide instead of blocking it.
//
// This is one of the few files allowed to make a network request, and
// only to the SIGC server the user is already logged into (URL built
// from location.origin; the privacy gate rejects absolute URLs in this
// directory — see scripts/check-privacy.sh). Opt-in: each page load, the
// first click asks for confirmation before any request. Results are
// cached in memory per Controle for the page's lifetime (never
// persisted) so repeat clicks in one session don't re-fetch.
// Spec: docs/superpowers/specs/2026-07-16-agenda-map-design.md
(function () {
  'use strict';

  const TAG = '[sigc-agenda-lookups]';

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

  // '*' is SIGC's "all" wildcard for a filtro field, so scoping by
  // Controle and scoping by agência are the same request with the two
  // fields swapped: the Agenda path pins Controle and wildcards
  // IdAgencia, the Mapa path does the reverse (one call for a whole
  // agência instead of one per Controle).
  function filtroBody(uf, controle, idFiltro, agencia) {
    return 'filtro=' + encodeURIComponent(JSON.stringify({
      IdFiltro: idFiltro,
      IdUf: String(uf),
      IdAgencia: agencia ? String(agencia) : '*',
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
    const idx = resolveColumns(headers, P.LISTA_COMMON_LABELS, foldPlain);
    if (!idx) return null;
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

  // Response HTML fragment -> { headers, rows } of trimmed strings, or
  // null when the expected table isn't there. DOMParser is inert:
  // nothing in the fetched markup can load resources or run handlers.
  // All three reports below are read through this one function — their
  // responses are parsed independently and never share a live DOM, so
  // two of them using the same generic #tableRelatorio id can't collide.
  function readReportTable(html, selector) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const table = doc.querySelector(selector);
    if (!table) return null;
    return {
      headers: [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim()),
      rows: [...table.querySelectorAll('tbody tr')].map((tr) =>
        [...tr.querySelectorAll('td')].map((td) => td.textContent.trim())),
    };
  }

  // labels {key: 'Header Label'} -> {key: columnIndex}, or null if ANY
  // label is missing (callers treat null as "table not recognized", so a
  // backend column reorder can never silently join the wrong columns).
  // `fold` normalizes both sides before comparing; pass foldLive to also
  // absorb the live grid's accent/"#!" decoration.
  function resolveColumns(headers, labels, fold) {
    const idx = {};
    for (const key of Object.keys(labels)) {
      const expected = fold(labels[key]);
      const i = headers.findIndex((h) => fold(h) === expected);
      if (i === -1) return null;
      idx[key] = i;
    }
    return idx;
  }

  function parseEnderecosHtml(html) {
    const table = readReportTable(html, '#tableRelatorio');
    return table ? tableToEnderecosMap(table.headers, table.rows) : null;
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

  // Two header folds, differing only in how much live-grid decoration
  // they absorb. normalizeLabel itself is whitespace+lowercase only.
  //   foldLive  — also strips accents and the leading "#!" sort/filter
  //               marker; needed by Último Movimento, whose live headers
  //               show both ("#!Controle", "!Domicílio").
  //   foldPlain — normalizeLabel alone; Distribuição's headers are read
  //               verbatim off #tb_distribuir with no such decoration.
  // foldLive is a superset: it would match Distribuição's headers too.
  // The split is kept because each report is pinned to the fold its live
  // table was actually confirmed against, not to the loosest one.
  const foldLive = (s) =>
    window.__sigcPro.normalizeLabel(stripAccents(stripHeaderMarker(s)));
  const foldPlain = (s) => window.__sigcPro.normalizeLabel(s);

  function parseUltimoMovimentoTable(headers, rows) {
    const idx = resolveColumns(headers, ULTIMO_MOVIMENTO_LABELS, foldLive);
    if (!idx) return null;
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
    const idx = resolveColumns(headers, DISTRIBUICAO_LABELS, foldPlain);
    if (!idx) return null;
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

  const FORM_POST_HEADERS = {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'X-Requested-With': 'XMLHttpRequest',
  };

  // POSTs one /relatorio/filtrar report and parses its response.
  //
  // Tries the simple prefixed URL first, then the full captured F5 form
  // (identical on the direct host, where the Set collapses them), moving
  // on to the next URL on a transport error, a non-2xx, or an
  // unrecognized table, and throwing the last error if none worked.
  //
  // `parse` returns the report's Map, or null for "table not
  // recognized" — the signal to try the next URL rather than accept an
  // empty result. Both reports served by this endpoint (Lista de
  // Endereços and, since 2026-08-07, Último Movimento) go through here;
  // they differ only in slug, filtro body and parse.
  async function postRelatorio({ slug, body, parse }) {
    const urls = [...new Set([
      filtrarUrl(location.origin, location.pathname, slug, true),
      filtrarUrl(location.origin, location.pathname, slug, false),
    ])];
    let lastErr = new Error('sem resposta');
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          credentials: 'same-origin',
          headers: FORM_POST_HEADERS,
          body,
        });
        if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); continue; }
        const map = parse(await res.text());
        if (map) return map;
        lastErr = new Error('tabela não reconhecida');
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }

  function postFiltrar(uf, controle) {
    return postRelatorio({
      slug: 'ListaEnderecos',
      body: filtroBody(uf, controle, 'ListaEnderecos'),
      parse: parseEnderecosHtml,
    });
  }

  // Runs `post` once per distinct Controle not already in `cache`, then
  // flattens every result into one Map. Caches are in-memory only and
  // reset on page load (zero-storage guarantee); they exist so repeat
  // clicks in one session don't re-POST a Controle already fetched
  // (e.g. the user regenerates the guide after fixing a slot).
  // Sequential by design — typically 1-5 Controles per day, and the
  // SIGC backend is not something to fan out against.
  //
  // `label` selects the failure mode, which is the one real difference
  // between the three lookups:
  //   omitted — the lookup is REQUIRED (Lista de Endereços): errors
  //             propagate to the caller, which reports them and falls
  //             back to a map-free guide.
  //   given   — the lookup is OPTIONAL (Último Movimento,
  //             Distribuição): a failing Controle is logged under this
  //             label, cached as null so it isn't retried, and skipped.
  //             One bad Controle degrades the guide, never blocks it.
  async function fetchPerControle(cache, post, uf, controles, label) {
    const all = new Map();
    for (const c of controles) {
      if (!cache.has(c)) {
        if (!label) {
          cache.set(c, await post(uf, c));
        } else {
          try {
            cache.set(c, await post(uf, c));
          } catch (err) {
            console.warn(`${TAG} ${label} lookup for Controle ${c} failed:`, err);
            cache.set(c, null);
          }
        }
      }
      const result = cache.get(c);
      if (result) result.forEach((v, k) => all.set(k, v));
    }
    return all;
  }

  // controle -> Map("controle|domicilio" -> {lat,lon,zona,idZona})
  const enderecosCache = new Map();

  function fetchEnderecos(uf, controles) {
    return fetchPerControle(enderecosCache, postFiltrar, uf, controles);
  }

  // ONE Lista de Endereços call covering an entire agência, keyed the
  // same "controle|domicilio" way fetchEnderecos' per-Controle results
  // are — the caller joins them identically either way.
  //
  // Used by ultimo-movimento-map.js, whose report is agência-scoped:
  // fetching per Controle there meant one POST per Controle on screen
  // (dozens), where the server will scope by IdAgencia directly. It
  // takes the agência code rather than deriving it, because only the
  // caller knows the report on screen is actually scoped to it — see
  // that file's currentAgencia gate.
  //
  // Deliberately NOT cached: enderecosCache is keyed by Controle, and a
  // whole-agência result doesn't fit that shape. The call happens once
  // per Mapa click, which is already an explicit user action behind a
  // consent prompt.
  function fetchEnderecosByAgencia(uf, agencia) {
    return postRelatorio({
      slug: 'ListaEnderecos',
      body: filtroBody(uf, '*', 'ListaEnderecos', agencia),
      parse: parseEnderecosHtml,
    });
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
  // already used — hence the shared postRelatorio, rather than the
  // plain-path fetchViaGateway this call used before the migration.
  function postUltimoMovimento(uf, controle) {
    return postRelatorio({
      slug: ULTIMO_MOVIMENTO_SLUG,
      body: filtroBodyUltimoMovimento(uf, controle),
      parse: (html) => {
        const table = readReportTable(html, '#tableRelatorio');
        return table ? parseUltimoMovimentoTable(table.headers, table.rows) : null;
      },
    });
  }

  // controle -> Map("controle|domicilio" -> {entrevistador}) | null
  // (null = fetched, no usable table).
  const ultimoMovimentoCache = new Map();

  function fetchUltimoMovimento(uf, controles) {
    return fetchPerControle(
      ultimoMovimentoCache, postUltimoMovimento, uf, controles, 'Último Movimento');
  }

  function filtroBodyDistribuicao(uf, controle) {
    return 'filtro=' + encodeURIComponent(JSON.stringify({
      IdFiltro: '',
      IdUf: String(uf),
      IdMunicipio: '*',
      Controle: String(controle),
    }));
  }

  // Not a /relatorio/filtrar report: Distribuição has its own endpoint
  // and its own table id, so it goes through fetchViaGateway rather than
  // postRelatorio's slug + two-mode F5 retry.
  async function postDistribuicao(uf, controle) {
    const res = await window.__sigcPro.fetchViaGateway('/RelatorioDistribuicao/Filtrar', {
      method: 'POST',
      credentials: 'same-origin',
      headers: FORM_POST_HEADERS,
      body: filtroBodyDistribuicao(uf, controle),
    });
    const table = readReportTable(await res.text(), '#tb_distribuir');
    return table ? parseDistribuicaoTable(table.headers, table.rows) : null;
  }

  // controle -> Map(controle -> {agencia}) | null. Keyed by Controle
  // alone, unlike the other two — Distribuição is per-Controle data.
  const distribuicaoCache = new Map();

  function fetchDistribuicao(uf, controles) {
    return fetchPerControle(
      distribuicaoCache, postDistribuicao, uf, controles, 'Distribuição');
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
  // fetchEnderecos is the one exception: it's the real network call
  // (cached, multi-Controle, same-origin), reused as-is by
  // ultimo-movimento-map.js's own consent-gated fetch rather than
  // duplicating postFiltrar/parseEnderecosHtml in a second file — this
  // directory is where check-privacy.sh sanctions the fetch.
  // stripAccents/stripHeaderMarker are also reused directly by
  // ultimo-movimento-map.js's own #tableRelatorio parser (same table,
  // same live quirks — accented headers, "#!" sort/filter decoration)
  // rather than re-diverging a second copy of this fold.
  window.__sigcProAgendaLookups = { parseUltimoMovimentoTable, mergeUltimoMovimento, parseDistribuicaoTable, mergeDistribuicao, filtrarUrl, fetchEnderecos, fetchEnderecosByAgencia, stripAccents, stripHeaderMarker };
})();
