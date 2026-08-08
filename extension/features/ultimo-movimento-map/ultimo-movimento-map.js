// SIGC-PRO feature: "Mapa" on Último Movimento — see agenda-map.js for
// the sibling feature this reuses the join pattern from (opt-in
// same-origin fetch of Lista de Endereços, controle|domicilio keying).
// Spec: docs/superpowers/specs/2026-08-08-ultimo-movimento-mapa-design.md
(function () {
  'use strict';

  const TAG = '[sigc-ultimo-movimento-map]';

  const ULTIMO_MOVIMENTO_MAP_LABELS = {
    controle: 'Controle',
    domicilio: 'Domicilio',
    entrevistador: 'Entrevistador',
    tipoEntrevista: 'Tipo de Entrevista',
    ultimaPosicao: 'Última Posição',
    data: 'Data',
  };

  // headers/rows: plain string arrays from #tableRelatorio, same shape
  // ultimo-movimento-export.js and agenda-map.js already parse. Returns
  // null (not throw) when a required header is missing, so a live SIGC
  // column rename fails closed with a clear message at the call site,
  // never a silent wrong-column join.
  function parseUltimoMovimentoRows(headers, rows) {
    const P = window.__sigcPro;
    const idx = {};
    for (const key of Object.keys(ULTIMO_MOVIMENTO_MAP_LABELS)) {
      const i = headers.findIndex(
        (h) => P.normalizeLabel(h) === P.normalizeLabel(ULTIMO_MOVIMENTO_MAP_LABELS[key]));
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

  function buildZonasTableHtml(zonaRows) {
    const esc = window.__sigcPro.escapeHtml;
    const head =
      '<tr><th>Zona</th><th>Nome</th><th>Realizada</th><th>Não Iniciada</th>' +
      '<th>Dom. Fechado</th><th>Recusa</th><th>Outros</th><th>Total</th>' +
      '<th>Sem coordenadas</th></tr>';
    const body = zonaRows.map((r) => (
      '<tr>' +
      `<td>${esc(r.idZona || '—')}</td>` +
      `<td>${esc(r.nomeZona)}</td>` +
      `<td>${r.realizada}</td><td>${r.naoIniciada}</td>` +
      `<td>${r.domicilioFechado}</td><td>${r.recusa}</td><td>${r.outros}</td>` +
      `<td>${r.totalDomicilios}</td><td>${r.semCoordenadas}</td>` +
      '</tr>'
    )).join('');
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
  // world) resolves the vendored Leaflet bundle's extension URLs once and
  // broadcasts them here, same one-shot-cache shape settings.js uses for
  // flagsCache. Starts null: loadLeafletAssets() below tolerates the
  // (very unlikely, given both content scripts run at document_idle and
  // the relay does no async work before dispatching) case where a click
  // races ahead of the relay's event.
  let leafletUrls = null;
  window.addEventListener('sigc-pro-leaflet-urls', (e) => {
    leafletUrls = (e.detail && e.detail.jsUrl && e.detail.cssUrl) ? e.detail : null;
  });

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
  }

  function wireTabs(panelEl) {
    panelEl.querySelectorAll('.sigc-pro-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        panelEl.querySelectorAll('.sigc-pro-tab-btn').forEach((b) => b.classList.remove('sigc-pro-tab-active'));
        panelEl.querySelectorAll('.sigc-pro-tab-panel').forEach((p) => p.classList.remove('sigc-pro-tab-panel-active'));
        btn.classList.add('sigc-pro-tab-active');
        const target = document.getElementById(`sigc-pro-${btn.dataset.tab}-panel`);
        if (target) target.classList.add('sigc-pro-tab-panel-active');
        if (btn.dataset.tab === 'mapa') maybeLoadTiles();
      });
    });
    panelEl.querySelector('.sigc-pro-panel-close').addEventListener('click', closePanel);
  }

  // Waits briefly for ultimo-movimento-map-relay.js's one-shot broadcast,
  // in case a click races ahead of it — both content scripts run at
  // document_idle and the relay does no async work before dispatching, so
  // this should resolve on the first check in practice; the short poll is
  // just a safety margin, not a real ordering dependency.
  function waitForLeafletUrls() {
    if (leafletUrls) return Promise.resolve(leafletUrls);
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const timer = setInterval(() => {
        attempts += 1;
        if (leafletUrls) {
          clearInterval(timer);
          resolve(leafletUrls);
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
    // waitForLeafletUrls() only resolves once module-level leafletUrls is
    // truthy (see above), so it's read directly here rather than via the
    // resolved value — keeps its provenance (assigned only from the
    // sigc-pro-leaflet-urls event's .detail) visible as a single,
    // consistently-named variable for check-privacy.sh's local-resource
    // scan, instead of a renamed .then() parameter.
    leafletLoadPromise = waitForLeafletUrls().then(() => new Promise((resolve, reject) => {
      if (!document.querySelector(`link[href="${leafletUrls.cssUrl}"]`)) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = leafletUrls.cssUrl;
        document.head.appendChild(link);
      }
      if (window.L) { resolve(window.L); return; }
      const script = document.createElement('script');
      script.src = leafletUrls.jsUrl;
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
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);
    if (withCoords.length === 0) {
      map.setView([-14, -51], 4); // Brazil-wide fallback view
      return;
    }
    const bounds = [];
    withCoords.forEach((r) => {
      const color = zonaColor(r.idZona || null);
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
    map.fitBounds(bounds, { padding: [20, 20] });
  }

  function readUltimoMovimentoTable() {
    const table = document.getElementById('tableRelatorio');
    if (!table) return null;
    const headers = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    const rows = [...table.querySelectorAll('tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()));
    return parseUltimoMovimentoRows(headers, rows);
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
    const originalLabel = btn.textContent;
    try {
      const controles = [...new Set([...movimentoMap.keys()].map((k) => k.split('|')[0]))];
      let enderecosMap = new Map();
      try {
        enderecosMap = await AM.fetchEnderecos(uf, controles);
      } catch (err) {
        console.warn(`${TAG} Lista de Endereços fetch failed:`, err);
      }
      const joined = joinEnderecos(movimentoMap, enderecosMap);
      pendingJoined = joined;
      const zonaRows = aggregateZonas(joined);

      closePanel();
      document.body.insertAdjacentHTML('beforeend', buildPanelHtml(joined, zonaRows));
      const panelEl = document.getElementById(PANEL_ID);
      wireTabs(panelEl);
      mapInitialized = false;
      maybeLoadTiles();
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
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
    buildZonasTableHtml,
    buildPanelHtml,
    onMapaClick,
  };
})();
