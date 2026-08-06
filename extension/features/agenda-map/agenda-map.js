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
  // params). postFiltrar tries simple first, then falls back.
  function filtrarUrl(origin, pathname, simple) {
    const f5 = f5Prefix(pathname);
    if (!f5) return `${origin}/relatorio/filtrar?slug=ListaEnderecos`;
    return simple
      ? `${origin}${f5.prefix}/relatorio/filtrar?slug=ListaEnderecos`
      : `${origin}${f5.prefix}/relatorio/f5-h-$$/relatorio/filtrar?slug=ListaEnderecos;F5_origin=${f5.hex}&F5CH=I`;
  }

  function filtroBody(uf, controle) {
    return 'filtro=' + encodeURIComponent(JSON.stringify({
      IdFiltro: 'ListaEnderecos',
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

  // Último Movimento's own results table (#tb_ultimo_movimento), resolved
  // by header label the same way tableToEnderecosMap resolves Lista de
  // Endereços — a live column reorder can never silently join the wrong
  // fields. Unlike Lista de Endereços this table isn't pesquisa-scoped
  // (Último Movimento has no per-pesquisa registry entry), so the three
  // labels are matched directly rather than via LISTA_COMMON_LABELS.
  const ULTIMO_MOVIMENTO_LABELS = { controle: 'Controle', agencia: 'Agência', entrevistador: 'Entrevistador' };

  function parseUltimoMovimentoTable(headers, rows) {
    const P = window.__sigcPro;
    const idx = {};
    for (const key of Object.keys(ULTIMO_MOVIMENTO_LABELS)) {
      const i = headers.findIndex(
        (h) => P.normalizeLabel(h) === P.normalizeLabel(ULTIMO_MOVIMENTO_LABELS[key]));
      if (i === -1) return null;
      idx[key] = i;
    }
    const map = new Map();
    rows.forEach((cells) => {
      const controle = String(cells[idx.controle] || '').trim();
      if (!controle) return;
      map.set(controle, {
        agencia: String(cells[idx.agencia] || '').trim(),
        entrevistador: String(cells[idx.entrevistador] || '').trim(),
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

  // New Map: every enderecos entry sharing a Controle present in umMap
  // gets agencia/entrevistador added; entries for controles with no
  // Último Movimento match pass through unchanged (never blocks the
  // guide — see buildSlotCard's existing present-only rendering).
  function mergeUltimoMovimento(enderecos, umMap) {
    const merged = new Map();
    enderecos.forEach((v, k) => {
      const um = umMap.get(controleFromKey(k));
      merged.set(k, um ? { ...v, agencia: um.agencia, entrevistador: um.entrevistador } : v);
    });
    return merged;
  }

  // --- network (the sanctioned exception) -----------------------------

  // Tries the simple prefixed URL first, then the full captured F5 form
  // (identical on the direct host, where the Set collapses them).
  async function postFiltrar(uf, controle) {
    const urls = [...new Set([
      filtrarUrl(location.origin, location.pathname, true),
      filtrarUrl(location.origin, location.pathname, false),
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
          body: filtroBody(uf, controle),
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

  function filtroBodyUltimoMovimento(uf, controle) {
    return 'filtro=' + encodeURIComponent(JSON.stringify({
      IdFiltro: '',
      IdUf: String(uf),
      IdAgencia: '*',
      IdMunicipio: '*',
      Controle: String(controle),
      IdEntrevistadores: '*',
      IdTipoAcompanhamento: '*',
    }));
  }

  async function postUltimoMovimento(uf, controle) {
    const res = await window.__sigcPro.fetchViaGateway('/UltimoMovimento/Filtrar', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: filtroBodyUltimoMovimento(uf, controle),
    });
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    const table = doc.getElementById('tb_ultimo_movimento');
    if (!table) return null;
    const headers = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    const rows = [...table.querySelectorAll('tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()));
    return parseUltimoMovimentoTable(headers, rows);
  }

  // In-memory only, mirrors enderecosCache: controle -> Map(controle ->
  // {agencia, entrevistador}) | null (null = fetched, no usable table).
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
        console.log(`${TAG} ${umMap.size} controle(s) com agência/entrevistador.`);
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
  window.__sigcProAgendaMapInternals = { parseUltimoMovimentoTable, mergeUltimoMovimento };
})();
