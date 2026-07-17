// SIGC-PRO feature: "Guia + Mapa" — the ONLY file in this extension
// allowed to make a network request, and only to the SIGC server the
// user is already logged into (URL built from location.origin; the
// privacy gate rejects absolute URLs in this directory). Opt-in: each
// page load, the first click asks for confirmation before any request.
// It fetches the Lista de Endereços report per Controle (POST
// /relatorio/filtrar, an HTML fragment), extracts coordinates, and
// hands them to window.__sigcPro.dayGuide.generate(coords) — the same
// day-guide pipeline, now with geo links, GPX, and route links.
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
  function tableToCoordsMap(headers, rows) {
    const P = window.__sigcPro;
    const cols = P.PESQUISAS.PNS2026.columns;
    const idx = {};
    for (const key of ['controle', 'nDomicilio', 'latitude', 'longitude']) {
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
      if (controle && domicilio && lat != null && lon != null) {
        map.set(`${controle}|${domicilio}`, { lat, lon });
      }
    });
    return map;
  }

  // Response HTML fragment -> coords map. DOMParser is inert: nothing
  // in the fetched markup can load resources or run handlers.
  function parseEnderecosHtml(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const table = doc.querySelector('#tableRelatorio');
    if (!table) return null;
    const headers = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    const rows = [...table.querySelectorAll('tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()));
    return tableToCoordsMap(headers, rows);
  }
})();
