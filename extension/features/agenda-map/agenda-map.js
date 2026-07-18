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
  // are resolved by label against the shared PESQUISAS registry, so a
  // backend column reorder can never silently join the wrong columns —
  // unknown headers return null (caller treats as failure).
  function tableToEnderecosMap(headers, rows) {
    const P = window.__sigcPro;
    const cols = P.PESQUISAS.PNS2026.columns;
    const idx = {};
    for (const key of ['controle', 'nDomicilio', 'latitude', 'longitude', 'nomeZona']) {
      const i = headers.findIndex(
        (h) => P.normalizeLabel(h) === P.normalizeLabel(cols[key].label));
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
      const coordsOk = lat != null && lon != null;
      // Zona is only filled in for selecionado households — fine here,
      // since the filtro requests TipoVisualizacao 'S' (selecionados
      // only) and Agenda visits are always with selecionados; an empty
      // zona cell just falls back to the slot text in the guide.
      // A household with zona but no valid coordinates still gets an
      // entry (lat/lon null): the guide can show its real zona even
      // when it can't map it.
      if (controle && domicilio && (coordsOk || zona)) {
        map.set(`${controle}|${domicilio}`, {
          lat: coordsOk ? lat : null,
          lon: coordsOk ? lon : null,
          zona,
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
  const enderecosCache = new Map(); // controle -> Map("controle|domicilio" -> {lat,lon,zona})

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

  // --- UI --------------------------------------------------------------

  const BUTTON_ID = 'sigc-pro-agenda-mapa-button';

  // In-memory only (zero-storage guarantee): re-asked on every page load.
  let consentGiven = false;
  const CONSENT_MSG =
    'SIGC-PRO: isto fará uma consulta ao próprio servidor do SIGC para ' +
    'obter as coordenadas dos endereços. Nenhum dado sai do IBGE. Continuar?';

  async function exportGuideMap(btn) {
    if (!consentGiven) {
      if (!confirm(CONSENT_MSG)) return;
      consentGiven = true;
    }
    const rows = window.__sigcPro.readAgendaSlots();
    if (rows.length === 0) {
      alert('SIGC-PRO: nenhum slot encontrado na agenda — confira se UF/dia já carregaram.');
      return;
    }
    const ufSelect = document.getElementById('selectUf');
    const uf = ufSelect ? ufSelect.value : '';
    const controles = [...new Set(
      rows.filter((r) => r.reservado).map((r) => r.controle).filter(Boolean))];

    let enderecos = null;
    if (uf && controles.length > 0) {
      btn.disabled = true;
      try {
        enderecos = await fetchEnderecos(uf, controles);
        console.log(`${TAG} ${enderecos.size} endereço(s) de ${controles.length} controle(s).`);
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

  function insertButton(chunk) {
    if (document.getElementById(BUTTON_ID)) return;
    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    btn.className = 'fc-button fc-button-primary';
    btn.textContent = 'Guia + Mapa';
    btn.title = 'Guia do dia com mapa — faz uma consulta ao servidor do SIGC (SIGC-PRO)';
    btn.style.background = '#005a9c';
    btn.style.borderColor = '#005a9c';
    btn.style.marginLeft = '4px';
    btn.addEventListener('click', () => { exportGuideMap(btn); });
    chunk.appendChild(btn);
    console.log(`${TAG} Guia + Mapa button added.`);
  }

  // Same Dia-only visibility as Guia do Dia, reusing its detector.
  window.__sigcPro.whenReadyGeneric(
    () => window.__sigcPro.onAgendaPage() && window.__sigcPro.findAgendaToolbarChunk() &&
      window.__sigcPro.dayGuide,
    () => {
      const tryUpdate = () => {
        const existing = document.getElementById(BUTTON_ID);
        const chunk = window.__sigcPro.findAgendaToolbarChunk();
        if (window.__sigcPro.onAgendaPage() && chunk && window.__sigcPro.dayGuide.diaViewActive()) {
          if (!existing) insertButton(chunk);
        } else if (existing) {
          existing.remove();
        }
      };
      tryUpdate();
      new MutationObserver(tryUpdate).observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class'],
      });
    }
  );
})();
