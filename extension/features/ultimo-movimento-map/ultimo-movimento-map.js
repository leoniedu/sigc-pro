// SIGC-PRO feature: "Mapa" on Último Movimento — see agenda-map.js for
// the sibling feature this reuses the join pattern from (opt-in
// same-origin fetch of Lista de Endereços, controle|domicilio keying).
// Spec: docs/superpowers/specs/2026-08-08-ultimo-movimento-mapa-design.md
(function () {
  'use strict';

  const TAG = '[sigc-ultimo-movimento-map]';

  const ULTIMO_MOVIMENTO_MAP_LABELS = {
    controle: 'Controle',
    domicilio: 'Domicílio',
    entrevistador: 'Entrevistador',
    tipoEntrevista: 'Tipo Entrevista',
    ultimaPosicao: 'Última Posição',
    data: 'Data',
  };

  // headers/rows: plain string arrays from #tableRelatorio, same shape
  // ultimo-movimento-export.js and agenda-map.js already parse. Returns
  // null (not throw) when a required header is missing, so a live SIGC
  // column rename fails closed with a clear message at the call site,
  // never a silent wrong-column join.
  //
  // Folds accents (agenda-map.js's stripAccents) and strips the "#!"
  // sort/filter decoration some SIGC report grids prepend to a header
  // (agenda-map.js's stripHeaderMarker) before comparing — same table,
  // same live quirks agenda-map.js's own parseUltimoMovimentoTable
  // already accounts for (confirmed live: "Domicílio" with the accent,
  // occasionally "#!Domicílio"). Matching the accented label constant
  // literally, with no folding, silently failed every header check here
  // and made this feature unusable on the real page (2026-08-09).
  function parseUltimoMovimentoRows(headers, rows) {
    const P = window.__sigcPro;
    const AM = window.__sigcProAgendaMapInternals;
    const idx = {};
    for (const key of Object.keys(ULTIMO_MOVIMENTO_MAP_LABELS)) {
      const expected = P.normalizeLabel(AM.stripAccents(ULTIMO_MOVIMENTO_MAP_LABELS[key]));
      const i = headers.findIndex(
        (h) => P.normalizeLabel(AM.stripAccents(AM.stripHeaderMarker(h))) === expected);
      if (i === -1) return null;
      idx[key] = i;
    }
    const map = new Map();
    rows.forEach((cells) => {
      const controle = String(cells[idx.controle] || '').trim();
      const domicilio = String(cells[idx.domicilio] || '').trim();
      if (!controle || !domicilio) return;
      map.set(`${controle}|${domicilio}`, {
        controle,
        domicilio,
        entrevistador: String(cells[idx.entrevistador] || '').trim(),
        tipoEntrevista: String(cells[idx.tipoEntrevista] || '').trim(),
        ultimaPosicao: String(cells[idx.ultimaPosicao] || '').trim(),
        data: String(cells[idx.data] || '').trim(),
      });
    });
    return map;
  }

  // movimentoMap: from parseUltimoMovimentoRows. enderecosMap: from
  // agenda-map.js's tableToEnderecosMap (controle|domicilio ->
  // {lat, lon, zona, idZona}, already selecionados-only per its
  // TipoVisualizacao:'S' filtro). A household absent from enderecosMap
  // (fetch gap, or declined consent upstream) is NOT dropped — it keeps
  // its Último Movimento data with temCoordenadas/temZona both false, so
  // the Zonas table's "sem coordenadas" count and "Sem zona" bucket stay
  // accurate instead of silently undercounting.
  function joinEnderecos(movimentoMap, enderecosMap) {
    const out = [];
    movimentoMap.forEach((row, key) => {
      const info = enderecosMap.get(key) || null;
      const lat = info && info.lat != null ? info.lat : null;
      const lon = info && info.lon != null ? info.lon : null;
      const zona = info && info.zona ? info.zona : '';
      const idZona = info && info.idZona ? info.idZona : '';
      out.push({
        ...row,
        lat,
        lon,
        zona,
        idZona,
        temCoordenadas: lat != null && lon != null,
        temZona: Boolean(idZona || zona),
      });
    });
    return out;
  }

  const TIPO_COLUNA = {
    'Realizada': 'realizada',
    'Não Iniciada': 'naoIniciada',
    'Domicílio Fechado': 'domicilioFechado',
    'Recusa': 'recusa',
  };

  // joined: from joinEnderecos. One output row per distinct idZona, plus
  // exactly one row with idZona===null aggregating every row whose
  // temZona is false (non-biomarcador selecionados — see spec
  // "Selecionados without zona"). Never silently drops a row: every
  // input row lands in exactly one output row.
  function aggregateZonas(joined) {
    const byZona = new Map(); // key: idZona || special string
    const SEM_ZONA_KEY = '__SEM_ZONA__';
    joined.forEach((r) => {
      const key = r.temZona ? r.idZona : SEM_ZONA_KEY;
      if (!byZona.has(key)) {
        byZona.set(key, {
          idZona: r.temZona ? r.idZona : null,
          nomeZona: r.temZona ? r.zona : 'Sem zona',
          realizada: 0, naoIniciada: 0, domicilioFechado: 0, recusa: 0, outros: 0,
          totalDomicilios: 0, semCoordenadas: 0,
        });
      }
      const bucket = byZona.get(key);
      const coluna = TIPO_COLUNA[r.tipoEntrevista] || 'outros';
      bucket[coluna] += 1;
      bucket.totalDomicilios += 1;
      if (!r.temCoordenadas) bucket.semCoordenadas += 1;
    });
    return Array.from(byZona.values());
  }

  const SEM_ZONA_COLOR = '#888888';
  // Categorical palette (Okabe-Ito, colorblind-safe — same family used
  // by the day-route SVG maps elsewhere in this extension), cycled by a
  // deterministic hash so the same idZona always gets the same color
  // within one render and across re-renders.
  const ZONA_PALETTE = [
    '#0072B2', '#D55E00', '#009E73', '#CC79A7',
    '#E69F00', '#56B4E9', '#F0E442', '#000000',
  ];

  function zonaColor(idZona) {
    if (!idZona) return SEM_ZONA_COLOR;
    let hash = 0;
    for (let i = 0; i < idZona.length; i += 1) {
      hash = (hash * 31 + idZona.charCodeAt(i)) | 0;
    }
    return ZONA_PALETTE[Math.abs(hash) % ZONA_PALETTE.length];
  }

  // Marker color = status (spec: docs/superpowers/specs/
  // 2026-08-09-mapa-status-zonas-controles-design.md §1), not zona —
  // zonaColor() is still used, but now only for the hull layer.
  // Okabe-Ito colorblind-safe hex values, assigned by semantic
  // convention here (unlike zonaColor's arbitrary hash) since status
  // carries real meaning a survey manager reads at a glance.
  const STATUS_INATIVO = '#888888';
  const STATUS_REALIZADA = '#009E73';
  const STATUS_RECUSA = '#D55E00';
  const STATUS_NAO_INICIADA = '#F0E442';
  const STATUS_FECHADO = '#56B4E9';
  const STATUS_OUTROS = '#000000';

  const STATUS_TIPO_COLOR = {
    'Realizada': STATUS_REALIZADA,
    'Recusa': STATUS_RECUSA,
    'Não Iniciada': STATUS_NAO_INICIADA,
    'Domicílio Fechado': STATUS_FECHADO,
  };

  function statusColor(row) {
    if (row.ultimaPosicao === 'Distribuido') return STATUS_INATIVO;
    return STATUS_TIPO_COLOR[row.tipoEntrevista] || STATUS_OUTROS;
  }

  // A zona row is clickable (opens the Mapa tab focused on that zona)
  // only when it has at least one domicílio WITH valid coordinates —
  // semCoordenadas < totalDomicilios. A row where every domicílio lacks
  // coordinates has nothing for fitBounds to focus on, so it's left
  // static rather than inviting a click that silently does nothing.
  function zonaRowIsClickable(r) {
    return r.totalDomicilios > r.semCoordenadas;
  }

  function buildZonasTableHtml(zonaRows) {
    const esc = window.__sigcPro.escapeHtml;
    const head =
      '<tr><th>Zona</th><th>Nome</th><th>Realizada</th><th>Não Iniciada</th>' +
      '<th>Dom. Fechado</th><th>Recusa</th><th>Outros</th><th>Total</th>' +
      '<th>Sem coordenadas</th></tr>';
    const body = zonaRows.map((r) => {
      const clickable = zonaRowIsClickable(r);
      const zonaKey = r.idZona || '';
      const rowAttrs = clickable
        ? ` class="sigc-pro-zona-row-clickable" data-id-zona="${esc(zonaKey)}" title="Ver esta zona no mapa"`
        : '';
      return (
        `<tr${rowAttrs}>` +
        `<td>${esc(r.idZona || '—')}</td>` +
        `<td>${esc(r.nomeZona)}</td>` +
        `<td>${r.realizada}</td><td>${r.naoIniciada}</td>` +
        `<td>${r.domicilioFechado}</td><td>${r.recusa}</td><td>${r.outros}</td>` +
        `<td>${r.totalDomicilios}</td><td>${r.semCoordenadas}</td>` +
        '</tr>'
      );
    }).join('');
    return `<table class="sigc-pro-zonas-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
  }

  const BUTTON_ID = 'sigc-pro-ultimo-movimento-map-btn';
  const PANEL_ID = 'sigc-pro-ultimo-movimento-map-panel';

  const PANEL_CSS = `
    #${PANEL_ID} { position: fixed; inset: 0; z-index: 999999;
      background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; }
    #${PANEL_ID} .sigc-pro-panel-box { background: #fff; width: 90vw; height: 85vh;
      border-radius: 6px; display: flex; flex-direction: column; overflow: hidden;
      font-family: system-ui, sans-serif; font-size: 13px; }
    #${PANEL_ID} .sigc-pro-panel-bar { display: flex; gap: 4px; background: #f4f4f4;
      border-bottom: 1px solid #ccc; padding: 4px; align-items: center; }
    #${PANEL_ID} .sigc-pro-tab-btn { padding: 8px 16px; border: 0; background: transparent;
      cursor: pointer; border-bottom: 3px solid transparent; }
    #${PANEL_ID} .sigc-pro-tab-active { background: #fff; border-bottom-color: #005a9c; font-weight: 600; }
    #${PANEL_ID} .sigc-pro-panel-close { margin-left: auto; border: 0; background: transparent;
      font-size: 20px; cursor: pointer; padding: 0 8px; }
    #${PANEL_ID} .sigc-pro-tab-panel { display: none; flex: 1; overflow: auto; }
    #${PANEL_ID} .sigc-pro-tab-panel-active { display: block; }
    #sigc-pro-leaflet-map { width: 100%; height: 100%; }
    .sigc-pro-zonas-table { border-collapse: collapse; width: 100%; }
    .sigc-pro-zonas-table th, .sigc-pro-zonas-table td { border: 1px solid #ddd; padding: 4px 8px; text-align: right; }
    .sigc-pro-zonas-table th:nth-child(-n+2), .sigc-pro-zonas-table td:nth-child(-n+2) { text-align: left; }
    .sigc-pro-zonas-table th { background: #f4f4f4; }
    .sigc-pro-zonas-table tr.sigc-pro-zona-row-clickable { cursor: pointer; }
    .sigc-pro-zonas-table tr.sigc-pro-zona-row-clickable:hover { background: #eef6ff; }
    .sigc-pro-controle-label span { font-size: 10px; font-weight: 600; color: #fff;
      padding: 1px 4px; border-radius: 3px; white-space: nowrap;
      box-shadow: 0 0 2px rgba(0,0,0,.6); }
    .sigc-pro-status-legend { background: #fff; padding: 6px 8px; border-radius: 4px;
      font-size: 11px; line-height: 1.6; box-shadow: 0 0 4px rgba(0,0,0,.3); }
  `;

  let cssInjected = false;
  function ensureCss() {
    if (cssInjected) return;
    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    document.head.appendChild(style);
    cssInjected = true;
  }

  const FETCH_CONSENT_MSG =
    'SIGC-PRO: isto buscará a Lista de Endereços (coordenadas e zona) ' +
    'para cada Controle do relatório, ao próprio servidor do SIGC. Continuar?';

  const TILE_CONSENT_MSG =
    'SIGC-PRO: para desenhar o mapa, o navegador vai buscar imagens de ' +
    'mapa (tiles) de um servidor externo (OpenStreetMap), fora do SIGC. ' +
    'Continuar?';

  // MAIN world has no chrome.* — ultimo-movimento-map-relay.js (ISOLATED
  // world) resolves the vendored Leaflet bundle's extension URLs and
  // writes them as data-attributes on <html>, which IS shared between
  // MAIN and ISOLATED worlds (window is not). Read directly, no cache
  // needed: the attributes are just there once the relay has run, in
  // either injection order — see waitForLeafletUrls() below for the
  // short retry-poll covering the (rare) case this file's own script
  // starts running before the relay's has. A CustomEvent-based version
  // of this was tried first and silently failed live: MAIN-world
  // injection is not guaranteed to happen after ISOLATED-world
  // injection, so the event could fire before this file's listener
  // existed to hear it (confirmed live, 2026-08-09).
  function readLeafletUrls() {
    const { sigcProLeafletJsUrl: jsUrl, sigcProLeafletCssUrl: cssUrl } = document.documentElement.dataset;
    return (jsUrl && cssUrl) ? { jsUrl, cssUrl } : null;
  }

  // Detects the Último Movimento report page the same way
  // ultimo-movimento-export.js does — reuse that detection rather than
  // reimplementing it, since both rely on the same page title/table id.
  function onUltimoMovimento() {
    return window.__sigcProUltimoMovimentoExportInternals &&
      window.__sigcProUltimoMovimentoExportInternals.onUltimoMovimento();
  }

  function buildPanelHtml(joined, zonaRows) {
    const zonasTable = buildZonasTableHtml(zonaRows);
    return [
      `<div id="${PANEL_ID}" class="sigc-pro-panel-overlay">`,
      '  <div class="sigc-pro-panel-box">',
      '    <div class="sigc-pro-panel-bar">',
      '      <button type="button" class="sigc-pro-tab-btn sigc-pro-tab-active" data-tab="mapa">Mapa</button>',
      `      <button type="button" class="sigc-pro-tab-btn" data-tab="zonas">Zonas (${zonaRows.length})</button>`,
      '      <button type="button" class="sigc-pro-panel-close" title="Fechar">×</button>',
      '    </div>',
      '    <div id="sigc-pro-mapa-panel" class="sigc-pro-tab-panel sigc-pro-tab-panel-active">',
      '      <div id="sigc-pro-leaflet-map"></div>',
      '    </div>',
      '    <div id="sigc-pro-zonas-panel" class="sigc-pro-tab-panel">',
      `      ${zonasTable}`,
      '    </div>',
      '  </div>',
      '</div>',
    ].join('\n');
  }

  function closePanel() {
    const el = document.getElementById(PANEL_ID);
    if (el) el.remove();
    currentMap = null;
  }

  // Shared by the tab-button clicks below and by a Zonas-row click
  // (see wireZonaRowClicks) — both need to switch the active tab, only
  // the row click also needs to run extra logic (fitBounds) afterward.
  function switchToTab(panelEl, tabName) {
    panelEl.querySelectorAll('.sigc-pro-tab-btn').forEach((b) => {
      b.classList.toggle('sigc-pro-tab-active', b.dataset.tab === tabName);
    });
    panelEl.querySelectorAll('.sigc-pro-tab-panel').forEach((p) => p.classList.remove('sigc-pro-tab-panel-active'));
    const target = document.getElementById(`sigc-pro-${tabName}-panel`);
    if (target) target.classList.add('sigc-pro-tab-panel-active');
    if (tabName === 'mapa') maybeLoadTiles();
  }

  function wireTabs(panelEl) {
    panelEl.querySelectorAll('.sigc-pro-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => switchToTab(panelEl, btn.dataset.tab));
    });
    panelEl.querySelector('.sigc-pro-panel-close').addEventListener('click', closePanel);
  }

  // Clicking a clickable Zonas row (see zonaRowIsClickable) switches to
  // the Mapa tab and pans/zooms to fit that zona's (or "Sem zona"'s,
  // idZona === '') mapped domicílios — the "open the map at this zone"
  // behavior. Computed fresh from `joined` rather than persisting hull
  // point arrays from renderLeafletMap: every clickable row has at
  // least one temCoordenadas domicílio (zonaRowIsClickable's condition
  // mirrors that), regardless of whether a hull was drawable for it.
  function focusZonaOnMap(panelEl, joined, idZona) {
    switchToTab(panelEl, 'mapa');
    const coords = joined
      .filter((r) => r.temCoordenadas && (r.idZona || '') === idZona)
      .map((r) => [r.lat, r.lon]);
    if (coords.length === 0) return;

    if (currentMap) {
      currentMap.fitBounds(coords, { padding: [20, 20] });
      return;
    }
    // Map not rendered yet (first time this panel's Mapa tab is being
    // shown, or the user declined tile consent earlier — maybeLoadTiles
    // is already a no-op in the latter case and its own declined-message
    // UI is the right feedback, so this poll just gives up quietly
    // rather than fighting that UI with a second message). Bounded poll,
    // same shape as waitForLeafletUrls' own — mapInitialized only turns
    // true after renderLeafletMap has actually run.
    maybeLoadTiles();
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (currentMap) {
        clearInterval(timer);
        currentMap.fitBounds(coords, { padding: [20, 20] });
      } else if (attempts >= 20) { // ~2s at 100ms
        clearInterval(timer);
      }
    }, 100);
  }

  function wireZonaRowClicks(panelEl, joined) {
    panelEl.querySelectorAll('.sigc-pro-zona-row-clickable').forEach((row) => {
      row.addEventListener('click', () => focusZonaOnMap(panelEl, joined, row.dataset.idZona || ''));
    });
  }

  // Reads ultimo-movimento-map-relay.js's data-attributes, polling
  // briefly in case this file's own script started running before the
  // relay's has (both run at document_idle, in either order — the
  // attribute has no listener to miss, so this only needs to cover the
  // instant right at page load, not the click itself, which happens long
  // after both scripts have run).
  function waitForLeafletUrls() {
    const urls = readLeafletUrls();
    if (urls) return Promise.resolve(urls);
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const timer = setInterval(() => {
        attempts += 1;
        const polled = readLeafletUrls();
        if (polled) {
          clearInterval(timer);
          resolve(polled);
        } else if (attempts >= 20) { // ~2s at 100ms
          clearInterval(timer);
          reject(new Error('URLs do Leaflet não chegaram do relay a tempo.'));
        }
      }, 100);
    });
  }

  // Injects Leaflet's CSS/JS from the vendored, web-accessible files on
  // first need (not at feature load) — avoids paying the load cost for
  // users who never click Mapa. Idempotent: a second call is a no-op.
  let leafletLoadPromise = null;
  function loadLeafletAssets() {
    if (leafletLoadPromise) return leafletLoadPromise;
    // urls is sourced only from readLeafletUrls() (document.documentElement's
    // data-sigc-pro-leaflet-*-url attributes — see readLeafletUrls above),
    // never anything else — keeps its provenance visible as a single,
    // consistently-named binding for check-privacy.sh's local-resource
    // scan.
    leafletLoadPromise = waitForLeafletUrls().then((urls) => new Promise((resolve, reject) => {
      if (!document.querySelector(`link[href="${urls.cssUrl}"]`)) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = urls.cssUrl;
        document.head.appendChild(link);
      }
      if (window.L) { resolve(window.L); return; }
      const script = document.createElement('script');
      script.src = urls.jsUrl;
      script.onload = () => resolve(window.L);
      script.onerror = () => reject(new Error('Falha ao carregar Leaflet.'));
      document.head.appendChild(script);
    })).catch((err) => {
      leafletLoadPromise = null; // allow a retry (e.g. via the panel's retry button) to re-poll
      throw err;
    });
    return leafletLoadPromise;
  }

  // Tile-specific consent, separate from the Lista de Endereços consent
  // — fires only once, on first attempt to actually paint the map (per
  // spec §Consent gates). Declining leaves the Mapa tab showing an
  // explanatory message with a retry button; the Zonas tab is
  // unaffected.
  let tilesConsented = false;
  let mapInitialized = false;
  let pendingJoined = null;
  // Live Leaflet map instance, once rendered — lets a Zonas-tab row
  // click (see focusZonaOnMap below) call fitBounds without threading
  // the map object through every function in between. Cleared on
  // closePanel so a stale map from a previous open can never be
  // fitBounds'd after its container is gone.
  let currentMap = null;

  async function maybeLoadTiles() {
    if (mapInitialized) return;
    const container = document.getElementById('sigc-pro-leaflet-map');
    if (!container) return;
    if (!tilesConsented) {
      if (!confirm(TILE_CONSENT_MSG)) {
        container.innerHTML =
          '<p class="sigc-pro-map-declined">Mapa não carregado (tiles ' +
          'recusados). <button type="button" id="sigc-pro-retry-tiles">Tentar novamente</button></p>';
        const retry = document.getElementById('sigc-pro-retry-tiles');
        if (retry) retry.addEventListener('click', maybeLoadTiles);
        return;
      }
      tilesConsented = true;
    }
    try {
      const L = await loadLeafletAssets();
      renderLeafletMap(L, container, pendingJoined || []);
      mapInitialized = true;
    } catch (err) {
      container.innerHTML = `<p class="sigc-pro-map-declined">Falha ao carregar o mapa: ${window.__sigcPro.escapeHtml(String(err && err.message || err))}</p>`;
    }
  }

  function renderLeafletMap(L, container, joined) {
    const withCoords = joined.filter((r) => r.temCoordenadas);
    const map = L.map(container);
    currentMap = map;
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);
    if (withCoords.length === 0) {
      map.setView([-14, -51], 4); // Brazil-wide fallback view
      addStatusLegend(L, map);
      return;
    }

    // --- Layer 1: zona hulls, drawn first so markers sit on top ------
    const byZona = new Map(); // idZona -> [[lat, lon], ...]
    withCoords.forEach((r) => {
      if (!r.idZona) return; // "Sem zona" gets no hull (spec §2)
      if (!byZona.has(r.idZona)) byZona.set(r.idZona, []);
      byZona.get(r.idZona).push([r.lat, r.lon]);
    });
    byZona.forEach((coords, idZona) => {
      const hull = convexHull(coords);
      if (!hull) return;
      const color = zonaColor(idZona);
      const zonaTooltip = window.__sigcPro.escapeHtml(idZona);
      if (hull.type === 'polygon') {
        L.polygon(hull.points, { color, weight: 2, fillColor: color, fillOpacity: 0.18 })
          .bindTooltip(zonaTooltip)
          .addTo(map);
      } else if (hull.type === 'capsule') {
        L.polyline([hull.a, hull.b], { color, weight: 10, opacity: 0.35, lineCap: 'round' })
          .bindTooltip(zonaTooltip)
          .addTo(map);
      } else if (hull.type === 'circle') {
        L.circle(hull.center, { radius: 30, color, fillColor: color, fillOpacity: 0.35 })
          .bindTooltip(zonaTooltip)
          .addTo(map);
      }
    });

    // --- Layer 2: domicílio markers, colored by status ---------------
    const bounds = [];
    withCoords.forEach((r) => {
      const color = statusColor(r);
      const marker = L.circleMarker([r.lat, r.lon], {
        radius: 6, color, fillColor: color, fillOpacity: 0.8,
      }).addTo(map);
      marker.bindPopup(
        `Controle: ${window.__sigcPro.escapeHtml(r.controle)}<br>` +
        `Domicílio: ${window.__sigcPro.escapeHtml(r.domicilio)}<br>` +
        `Entrevistador: ${window.__sigcPro.escapeHtml(r.entrevistador)}<br>` +
        `Tipo: ${window.__sigcPro.escapeHtml(r.tipoEntrevista)}<br>` +
        `Zona: ${window.__sigcPro.escapeHtml(r.idZona || 'Sem zona')}`
      );
      bounds.push([r.lat, r.lon]);
    });

    // --- Layer 3: Controle labels, always visible ---------------------
    // Muted purple/violet family, deliberately outside the Okabe-Ito set
    // ZONA_PALETTE and STATUS_* already exhaust — keeps Controle labels
    // visually distinct from both the status marker colors and the zona
    // hull colors (spec's distinct-palette requirement).
    const CONTROLE_LABEL_COLOR = {
      inactive: '#5C5C8A',
      active: '#4A148C',
      partial: '#AB47BC',
    };
    controleCentroids(joined).forEach(({ controle, lat, lon, colorState }) => {
      const shortId = String(controle).slice(-6);
      const color = CONTROLE_LABEL_COLOR[colorState];
      L.marker([lat, lon], {
        icon: L.divIcon({
          className: 'sigc-pro-controle-label',
          html: `<span style="background:${color};" title="${window.__sigcPro.escapeHtml(String(controle))}">${window.__sigcPro.escapeHtml(shortId)}</span>`,
          iconSize: null,
        }),
        interactive: false,
      }).addTo(map);
    });

    addStatusLegend(L, map);
    map.fitBounds(bounds, { padding: [20, 20] });
  }

  // Fixed corner legend for the 6 marker-status colors (spec: "Status
  // legend" section) — no separate legend for hull or Controle-label
  // colors, per the design's explicit scope decision. Takes L explicitly
  // (matching renderLeafletMap's own established style of receiving L as
  // a parameter) rather than closing over window.L.
  function addStatusLegend(L, map) {
    const entries = [
      ['Inativo (Distribuído)', STATUS_INATIVO],
      ['Realizada', STATUS_REALIZADA],
      ['Recusa', STATUS_RECUSA],
      ['Não Iniciada', STATUS_NAO_INICIADA],
      ['Domicílio Fechado', STATUS_FECHADO],
      ['Outros', STATUS_OUTROS],
    ];
    const div = L.DomUtil.create('div', 'sigc-pro-status-legend');
    div.innerHTML = entries.map(([label, color]) => (
      `<div><span style="display:inline-block;width:10px;height:10px;background:${color};margin-right:4px;"></span>${window.__sigcPro.escapeHtml(label)}</div>`
    )).join('');
    const control = L.control({ position: 'bottomleft' });
    control.onAdd = () => div;
    control.addTo(map);
  }

  // Reads via the DataTables JS API (window.__sigcPro.readDataTable),
  // not raw DOM tr/td scraping: DataTables only renders the CURRENT
  // page's rows into the DOM (25/50/100 entries per page), so a raw
  // querySelectorAll('tbody tr') silently missed every Controle not on
  // the visible page (confirmed live, 2026-08-09). readDataTable() reads
  // the table's full dataset (rows().data()), all pages, same helper
  // csv-export.js already relies on for exactly this reason — see its
  // own comment for the F5-gateway DOM-scraping caveat this also avoids.
  function readUltimoMovimentoTable() {
    const result = window.__sigcPro.readDataTable();
    if (!result) return null;
    return parseUltimoMovimentoRows(result.header, result.rows);
  }

  // Lista de Endereços cross-fetch — delegates entirely to agenda-map.js's
  // fetchEnderecos(uf, controles), a composed, cached, multi-Controle
  // helper (loops its private postFiltrar per uncached Controle, merges
  // results into one Map). This file never issues that request itself:
  // the network call stays inside agenda-map.js, the directory
  // check-privacy.sh's FETCH_DIRS already sanctions for it.
  async function onMapaClick(btn) {
    ensureCss();
    const movimentoMap = readUltimoMovimentoTable();
    if (!movimentoMap || movimentoMap.size === 0) {
      alert('SIGC-PRO: nenhum dado encontrado no relatório — rode um Filtrar primeiro.');
      return;
    }
    if (!confirm(FETCH_CONSENT_MSG)) return;

    const AM = window.__sigcProAgendaMapInternals;
    const uf = window.__sigcProUltimoMovimentoExportInternals &&
      window.__sigcProUltimoMovimentoExportInternals.getCurrentUf();
    if (!uf) {
      alert('SIGC-PRO: não foi possível identificar a UF atual.');
      return;
    }

    btn.disabled = true;
    try {
      const controles = [...new Set([...movimentoMap.keys()].map((k) => k.split('|')[0]))];
      let enderecosMap = new Map();
      try {
        enderecosMap = await AM.fetchEnderecos(uf, controles);
      } catch (err) {
        console.warn(`${TAG} Lista de Endereços fetch failed:`, err);
        alert(`SIGC-PRO: não foi possível obter coordenadas (${err && err.message}); ` +
          'o mapa e a tabela de zonas serão exibidos sem coordenadas/zona.');
      }
      const joined = joinEnderecos(movimentoMap, enderecosMap);
      pendingJoined = joined;
      const zonaRows = aggregateZonas(joined);

      closePanel();
      document.body.insertAdjacentHTML('beforeend', buildPanelHtml(joined, zonaRows));
      const panelEl = document.getElementById(PANEL_ID);
      wireTabs(panelEl);
      wireZonaRowClicks(panelEl, joined);
      mapInitialized = false;
      maybeLoadTiles();
    } finally {
      btn.disabled = false;
    }
  }

  // Convex hull over zona domicílio coordinates (spec §2). Hand-rolled
  // Andrew's monotone chain — no new vendored dependency, matches this
  // repo's "vendor only what you must, hand-roll small pure logic"
  // approach (same rationale as zonaColor's own hash-based assignment).
  // points: Array<[lat, lon]>. Degenerate inputs (0/1/2 points, or all
  // collinear) never return an empty/broken polygon — every zona with
  // at least one valid-coordinate domicílio gets SOME shape (spec: "no
  // zona with points renders nothing").
  function cross(o, a, b) {
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  }

  function convexHull(points) {
    // De-dup identical coordinates first — Andrew's monotone chain
    // assumes distinct points, and two identical rows (e.g. two
    // domicílios geocoded to the exact same address) must not count as
    // "2 points" for the polygon/capsule decision below.
    const uniq = [];
    const seen = new Set();
    points.forEach(([lat, lon]) => {
      const key = `${lat},${lon}`;
      if (!seen.has(key)) { seen.add(key); uniq.push([lat, lon]); }
    });

    if (uniq.length === 0) return null;
    if (uniq.length === 1) return { type: 'circle', center: uniq[0] };

    const sorted = [...uniq].sort((p, q) => (p[0] - q[0]) || (p[1] - q[1]));

    if (uniq.length === 2) {
      return { type: 'capsule', a: sorted[0], b: sorted[sorted.length - 1] };
    }

    const lower = [];
    for (const p of sorted) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
        lower.pop();
      }
      lower.push(p);
    }
    const upper = [];
    for (let i = sorted.length - 1; i >= 0; i -= 1) {
      const p = sorted[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
        upper.pop();
      }
      upper.push(p);
    }
    upper.pop();
    lower.pop();
    const hull = lower.concat(upper);

    // All points collinear: the hull-building loop above collapses to
    // just the two extremes (lower/upper both degenerate) — treat the
    // same as the 2-point case rather than a degenerate "polygon" with
    // <3 vertices.
    if (hull.length < 3) {
      return { type: 'capsule', a: sorted[0], b: sorted[sorted.length - 1] };
    }
    return { type: 'polygon', points: hull };
  }

  // Controle label centroid + active/inactive/partial color rule (spec
  // §3). colorState is computed over EVERY row for that Controle
  // (including rows without valid coordinates) — it's a fact about
  // fieldwork progress, not about geocoding success. The centroid
  // average, separately, only uses rows with temCoordenadas (nothing
  // else to average otherwise). A Controle with zero valid-coordinate
  // rows gets no entry at all — there's no point to center a label on.
  function controleCentroids(joined) {
    const byControle = new Map(); // controle -> { coords: [[lat,lon],...], allDistribuido, noneDistribuido }
    joined.forEach((r) => {
      if (!byControle.has(r.controle)) {
        byControle.set(r.controle, { coords: [], allDistribuido: true, noneDistribuido: true });
      }
      const bucket = byControle.get(r.controle);
      if (r.temCoordenadas) bucket.coords.push([r.lat, r.lon]);
      const isDistribuido = r.ultimaPosicao === 'Distribuido';
      if (!isDistribuido) bucket.allDistribuido = false;
      if (isDistribuido) bucket.noneDistribuido = false;
    });

    const out = [];
    byControle.forEach((bucket, controle) => {
      if (bucket.coords.length === 0) return;
      const lat = bucket.coords.reduce((sum, [la]) => sum + la, 0) / bucket.coords.length;
      const lon = bucket.coords.reduce((sum, [, lo]) => sum + lo, 0) / bucket.coords.length;
      const colorState = bucket.allDistribuido ? 'inactive' : (bucket.noneDistribuido ? 'active' : 'partial');
      out.push({ controle, lat, lon, colorState });
    });
    return out;
  }

  window.__sigcPro.mountWidget({
    id: BUTTON_ID,
    anchor: (ctx) => ctx.ultimoMovimentoFiltrarBtn(),
    insert: 'after',
    when: () => onUltimoMovimento(),
    build: () => {
      const btn = window.__sigcPro.makeSigcFormButton({
        id: BUTTON_ID,
        text: 'Mapa',
        title: 'Mapa de domicílios por zona (SIGC-PRO)',
        onClick: () => onMapaClick(btn),
      });
      return btn;
    },
  });

  window.__sigcProUltimoMovimentoMapInternals = {
    parseUltimoMovimentoRows,
    joinEnderecos,
    aggregateZonas,
    zonaColor,
    statusColor,
    buildZonasTableHtml,
    buildPanelHtml,
    onMapaClick,
    convexHull,
    controleCentroids,
    zonaRowIsClickable,
  };
})();
