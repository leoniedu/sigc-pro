// SIGC-PRO feature: "Mapa" on Último Movimento — see agenda-lookups.js for
// the sibling feature this reuses the join pattern from (opt-in
// same-origin fetch of Lista de Endereços, controle|domicilio keying).
//
// Agência-only (2026-08-10): the button mounts, and the click proceeds,
// only when the report is filtered to exactly ONE agência. That gate is
// what lets the coordinate lookup be a single agência-scoped request
// instead of one per Controle — see filteredAgencia and onMapaClick.
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
  // ultimo-movimento-export.js and agenda-lookups.js already parse. Returns
  // null (not throw) when a required header is missing, so a live SIGC
  // column rename fails closed with a clear message at the call site,
  // never a silent wrong-column join.
  //
  // Folds accents (agenda-lookups.js's stripAccents) and strips the "#!"
  // sort/filter decoration some SIGC report grids prepend to a header
  // (agenda-lookups.js's stripHeaderMarker) before comparing — same table,
  // same live quirks agenda-lookups.js's own parseUltimoMovimentoTable
  // already accounts for (confirmed live: "Domicílio" with the accent,
  // occasionally "#!Domicílio"). Matching the accented label constant
  // literally, with no folding, silently failed every header check here
  // and made this feature unusable on the real page (2026-08-09).
  function parseUltimoMovimentoRows(headers, rows) {
    const P = window.__sigcPro;
    const AM = window.__sigcProAgendaLookups;
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
  // agenda-lookups.js's tableToEnderecosMap (controle|domicilio ->
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
      const lat = info?.lat ?? null;
      const lon = info?.lon ?? null;
      const zona = info?.zona || '';
      const idZona = info?.idZona || '';
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

  // Agenda rows joined onto the already-coordinate-joined households, on
  // the same controle|domicilio key. Empty strings (never undefined) so
  // the renderers can write cells without guarding — the convention
  // lista-agenda.js's annotateRow established.
  function joinAgenda(joined, agendaIdx, todayIso) {
    const AM = window.__sigcProAgendaLookups;
    return (joined || []).map((r) => {
      const slots = (agendaIdx && agendaIdx.get(`${r.controle}|${r.domicilio}`)) || [];
      const ag = AM.pickAgendado(slots, todayIso);
      return {
        ...r,
        agendado: ag ? AM.fmtAgendado(ag.data, ag.hora) : '',
        agendadoOrdenavel: ag ? ag.ordenavel : '',
        futura: ag ? ag.futura : false,
      };
    });
  }

  const TIPO_COLUNA = {
    'Realizada': 'realizada',
    'Não Iniciada': 'naoIniciada',
    'Domicílio Fechado': 'domicilioFechado',
    'Recusa': 'recusa',
  };

  // joined: from joinAgenda (carries `agendado`). enderecosMap: the
  // agência-complete controle|domicilio -> {lat, lon, zona, idZona} map
  // (see joinEnderecos above) — seeded here FIRST, before folding in
  // `joined`, so a zona with addresses/coordinates but zero movimento
  // rows (nothing collected yet) still gets a bucket, all zeros, instead
  // of silently disappearing. Denominator throughout is selecionados:
  // the Lista de Endereços response is already selecionados-only, so no
  // extra filtering happens here.
  //
  // One output row per distinct idZona (from either source), plus
  // exactly one row with idZona===null aggregating every movimento row
  // whose temZona is false (non-biomarcador selecionados — see spec
  // "Selecionados without zona"). Never silently drops a movimento row:
  // every row in `joined` lands in exactly one output row.
  function aggregateZonas(joined, enderecosMap) {
    const byZona = new Map(); // key: idZona || special string
    const SEM_ZONA_KEY = '__SEM_ZONA__';
    const novoBucket = (idZona, nomeZona) => ({
      idZona, nomeZona,
      realizada: 0, naoIniciada: 0, domicilioFechado: 0, recusa: 0, outros: 0,
      totalDomicilios: 0, semCoordenadas: 0, agendados: 0, semAgendamento: 0,
    });

    (enderecosMap || new Map()).forEach((info) => {
      const id = info && info.idZona;
      if (!id) return;
      if (!byZona.has(id)) byZona.set(id, novoBucket(id, info.zona || id));
    });

    (joined || []).forEach((r) => {
      const key = r.temZona ? r.idZona : SEM_ZONA_KEY;
      if (!byZona.has(key)) {
        byZona.set(key, novoBucket(r.temZona ? r.idZona : null,
          r.temZona ? r.zona : 'Sem zona'));
      }
      const bucket = byZona.get(key);
      const coluna = TIPO_COLUNA[r.tipoEntrevista] || 'outros';
      bucket[coluna] += 1;
      bucket.totalDomicilios += 1;
      if (!r.temCoordenadas) bucket.semCoordenadas += 1;
      if (r.agendado) bucket.agendados += 1;
      else bucket.semAgendamento += 1;
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

  // slotsPorZona: Map(idZona -> [{isoDate, horas}]) already grouped by
  // agruparPorDia — see the window today..+2 weeks computation at the
  // onMapaClick call site. Rendered in its own cell via <details>, kept
  // deliberately apart from the Zona name cell's <a>: that click already
  // does something else (focus the map on this zona, wireZonaRowClicks),
  // and a <details> nested inside it would either steal that gesture or
  // silently do nothing when clicked.
  function buildZonasTableHtml(zonaRows, slotsPorZona) {
    const esc = window.__sigcPro.escapeHtml;
    const AM = window.__sigcProAgendaLookups;
    const slotsMap = slotsPorZona || new Map();
    const head =
      '<tr><th>Zona</th><th>Nome</th><th>Realizada</th><th>Não Iniciada</th>' +
      '<th>Dom. Fechado</th><th>Recusa</th><th>Outros</th><th>Total</th>' +
      '<th>Sem coordenadas</th><th>Agendados</th><th>Sem agendamento</th>' +
      '<th>Slots livres</th></tr>';
    const body = zonaRows.map((r) => {
      const clickable = zonaRowIsClickable(r);
      const zonaKey = r.idZona || '';
      const rowAttrs = clickable
        ? ` class="sigc-pro-zona-row-clickable" data-id-zona="${esc(zonaKey)}" title="Ver esta zona no mapa"`
        : '';
      // Link-style affordance for a clickable row's Zona cell — cursor:
      // pointer on the row alone wasn't a visible signal at rest, only
      // on hover.
      const zonaLabel = esc(r.idZona || '—');
      const zonaCell = clickable ? `<a href="#" class="sigc-pro-zona-link">${zonaLabel}</a>` : zonaLabel;
      // Rendered inline, NOT behind a <details>: the whole row is a click
      // target that jumps to the map, so a disclosure widget inside it was
      // unopenable — the row handler swallowed the summary's click and
      // switched tabs instead (reported 2026-08-12).
      const grupos = slotsMap.get(zonaKey) || [];
      const slotsCell = AM.buildSlotsLivresHtml(grupos);
      // Sorting a block of day/hour markup as text is meaningless; the
      // useful order is "which zona has the most capacity left", so the
      // sort key is the total number of open slots.
      const slotsCount = grupos.reduce((n, g) => n + ((g.horas && g.horas.length) || 0), 0);
      return (
        `<tr${rowAttrs}>` +
        `<td>${zonaCell}</td>` +
        `<td>${esc(r.nomeZona)}</td>` +
        `<td>${r.realizada}</td><td>${r.naoIniciada}</td>` +
        `<td>${r.domicilioFechado}</td><td>${r.recusa}</td><td>${r.outros}</td>` +
        `<td>${r.totalDomicilios}</td><td>${r.semCoordenadas}</td>` +
        `<td>${r.agendados}</td><td>${r.semAgendamento}</td>` +
        `<td class="sigc-pro-slots-cell" data-order="${slotsCount}">${slotsCell}</td>` +
        '</tr>'
      );
    }).join('');
    return `<table class="sigc-pro-zonas-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
  }

  // Household row columns: Controle+Domicílio, Agendado, Situação
  // (ultimaPosicao), Tipo (tipoEntrevista), Entrevistador, Data. There is
  // no street-address field on this row shape (see joinEnderecos/
  // joinAgenda) — the endereços map carries only {lat, lon, zona,
  // idZona}, no address — so Controle+Domicílio stands in as the row
  // identifier instead.
  function buildDomiciliosTabHtml(rows) {
    const esc = window.__sigcPro.escapeHtml;
    const dash = (v) => (v ? esc(v) : '—');
    const head =
      '<tr><th>Controle</th><th>Domicílio</th><th>Zona</th><th>Agendado</th>' +
      '<th>Situação</th><th>Tipo</th><th>Entrevistador</th><th>Data</th></tr>';
    const body = (rows || []).map((r) => {
      // data-order: the raw ISO timestamp, so DataTables sorts this column
      // chronologically instead of lexicographically on "dd/mm/yyyy HH:MM"
      // (which would put every 01/… together regardless of month or year).
      // Unscheduled rows sort last under either direction via the empty key.
      const agendadoCell = r.agendado
        ? `<span class="${r.futura ? 'sigc-pro-futura' : 'sigc-pro-passada'}">${esc(r.agendado)}</span>`
        : '—';
      const agendadoSort = esc(r.agendadoOrdenavel || '');
      return (
        '<tr>' +
        `<td>${dash(r.controle)}</td>` +
        `<td>${dash(r.domicilio)}</td>` +
        // The zona ID alone, not the full "ID - nome" label: the Zonas tab
        // carries the names, and this column exists to tell rows apart and
        // to sort/filter by zona, which the short ID does in far less width.
        `<td>${dash(r.idZona)}</td>` +
        `<td data-order="${agendadoSort}">${agendadoCell}</td>` +
        `<td>${dash(r.ultimaPosicao)}</td>` +
        `<td>${dash(r.tipoEntrevista)}</td>` +
        `<td>${dash(r.entrevistador)}</td>` +
        `<td>${dash(r.data)}</td>` +
        '</tr>'
      );
    }).join('');
    return `<table class="sigc-pro-domicilios-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
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
    .sigc-pro-zona-link { color: #0645ad; text-decoration: none; }
    .sigc-pro-zona-link:hover { text-decoration: underline; }
    .sigc-pro-zonas-hint { margin: 0 0 8px; font-size: 12px; color: #555; }
    .sigc-pro-controle-label span { font-size: 10px; font-weight: 600; color: #fff;
      padding: 1px 4px; border-radius: 3px; white-space: nowrap;
      box-shadow: 0 0 2px rgba(0,0,0,.6); }
    /* Domicílio number drawn over its status circle. Non-interactive, so
       clicks fall through to the circleMarker underneath; white text with
       a dark halo stays legible over every status color in the palette. */
    .sigc-pro-domicilio-num { pointer-events: none; }
    .sigc-pro-domicilio-num span { display: flex; align-items: center; justify-content: center;
      width: 18px; height: 18px; font-size: 10px; font-weight: 700; color: #fff;
      font-family: system-ui, sans-serif; line-height: 1;
      text-shadow: 0 0 2px rgba(0,0,0,.9), 0 0 3px rgba(0,0,0,.7); }
    .sigc-pro-status-legend { background: #fff; padding: 6px 8px; border-radius: 4px;
      font-size: 11px; line-height: 1.6; box-shadow: 0 0 4px rgba(0,0,0,.3); }
    .sigc-pro-domicilios-table { border-collapse: collapse; width: 100%; }
    .sigc-pro-domicilios-table th, .sigc-pro-domicilios-table td { border: 1px solid #ddd; padding: 4px 8px; text-align: left; }
    .sigc-pro-domicilios-table th { background: #f4f4f4; }
    .sigc-pro-futura { font-weight: 700; color: #161; }
    .sigc-pro-passada { color: #777; }
    /* Slots livres cell: inline, left-aligned against the numeric columns
       around it, and compact enough that a fortnight of open times still
       fits one table cell — one line per day, "dd/mm HH:MM HH:MM". */
    .sigc-pro-zonas-table td.sigc-pro-slots-cell { text-align: left; font-size: 11px;
      line-height: 1.5; min-width: 12rem; }
    .sigc-pro-slots-cell .sp-dia { white-space: nowrap; }
    .sigc-pro-slots-cell .sp-hora { display: inline-block; margin-right: .3rem; color: #333; }
    .sigc-pro-slots-cell .sp-livres-vazio { color: #888; margin: 0; }
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
    'SIGC-PRO: isto fará duas consultas ao próprio servidor do SIGC — a ' +
    'Lista de Endereços (coordenadas e zona) da agência filtrada e a ' +
    'agenda da UF. Nenhum dado sai do IBGE. Continuar?';

  // In-memory only (zero-storage guarantee): re-asked on every page
  // load, but not on every click within one.
  //
  // Parked on `window`, NOT in a plain closure variable: this file has no
  // re-entry guard (only sigc-common.js has one), so if the content
  // script is injected a second time into the same page — an extension
  // reload with the tab open, or a SIGC re-render — a second copy of this
  // IIFE runs with its own fresh `false`, and the user is asked to
  // consent again despite having just agreed. Reported live 2026-08-12
  // as "why do I have to click twice?". Shared state on window survives
  // that, exactly as window.__sigcPro itself does.
  const CONSENT_STATE_KEY = '__sigcProUltimoMovimentoMapConsent';
  const consentState = window[CONSENT_STATE_KEY] ||
    (window[CONSENT_STATE_KEY] = { fetch: false, tiles: false });

  const TILE_CONSENT_MSG =
    'SIGC-PRO: para desenhar o mapa, o navegador vai buscar imagens de ' +
    'mapa (tiles) de um servidor externo (OpenStreetMap), fora do SIGC. ' +
    'Continuar?';

  // Polls check() every 100ms for up to 20 attempts (~2s), stopping as
  // soon as it returns a truthy value. Shared by waitForLeafletUrls
  // (racing the relay's data-attributes on page load) and
  // focusZonaOnMap (racing the map's own async render after a Zonas-row
  // click) — same bounded-retry shape, only what happens on
  // success/timeout differs, via the two callbacks.
  function pollFor(check, { onFound, onTimeout }) {
    const found = check();
    if (found) { onFound(found); return; }
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      const value = check();
      if (value) {
        clearInterval(timer);
        onFound(value);
      } else if (attempts >= 20) {
        clearInterval(timer);
        if (onTimeout) onTimeout();
      }
    }, 100);
  }

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

  function buildPanelHtml(joined, zonaRows, slotsPorZona) {
    const zonasTable = buildZonasTableHtml(zonaRows, slotsPorZona);
    const domiciliosTable = buildDomiciliosTabHtml(joined);
    // Only shown when at least one row is actually clickable — no point
    // telling the user to click a zona if none have mapped coordinates.
    const zonasHint = zonaRows.some(zonaRowIsClickable)
      ? '<p class="sigc-pro-zonas-hint">Clique no nome de uma zona para vê-la no mapa.</p>'
      : '';
    return [
      // data-sigc-pro marks the whole subtree as ours, so sigc-common.js's
      // getDataTable() can exclude every table inside it from the "find
      // the page's report table" lookup.
      `<div id="${PANEL_ID}" class="sigc-pro-panel-overlay" data-sigc-pro>`,
      '  <div class="sigc-pro-panel-box">',
      '    <div class="sigc-pro-panel-bar">',
      '      <button type="button" class="sigc-pro-tab-btn sigc-pro-tab-active" data-tab="mapa">Mapa</button>',
      `      <button type="button" class="sigc-pro-tab-btn" data-tab="zonas">Zonas (${zonaRows.length})</button>`,
      `      <button type="button" class="sigc-pro-tab-btn" data-tab="domicilios">Domicílios (${joined.length})</button>`,
      '      <button type="button" class="sigc-pro-panel-close" title="Fechar">×</button>',
      '    </div>',
      '    <div id="sigc-pro-mapa-panel" class="sigc-pro-tab-panel sigc-pro-tab-panel-active">',
      '      <div id="sigc-pro-leaflet-map"></div>',
      '    </div>',
      '    <div id="sigc-pro-zonas-panel" class="sigc-pro-tab-panel">',
      `      ${zonasHint}`,
      `      ${zonasTable}`,
      '    </div>',
      '    <div id="sigc-pro-domicilios-panel" class="sigc-pro-tab-panel">',
      `      ${domiciliosTable}`,
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
    // shown, or the user declined tile consent earlier — the switchToTab
    // call above already triggered maybeLoadTiles, which is a no-op in
    // the declined-consent case, and its own declined-message UI is the
    // right feedback, so this poll just gives up quietly rather than
    // fighting that UI with a second message). mapInitialized only turns
    // true after renderLeafletMap has actually run.
    pollFor(() => currentMap, { onFound: (map) => map.fitBounds(coords, { padding: [20, 20] }) });
  }

  // SIGC's own page script auto-initializes DataTables over the tables it
  // finds in the document, and this panel's tables are injected into
  // document.body — so they get swept up and paged at the library's
  // 10-row default (confirmed live 2026-08-12: "Showing 1 to 10 of 90
  // entries" on the Domicílios tab).
  //
  // Rather than fight the initialization, adopt it: 50 rows is a far more
  // useful default for scanning an agência's households, and the library's
  // own "entries per page" selector still lets the user change it. A no-op
  // when DataTables never claimed these tables (then they simply render in
  // full, which is also fine).
  const PANEL_PAGE_LENGTH = 50;

  // DataTables ships English chrome; every other string in this panel is
  // Portuguese, so the table's own controls have to be too. Inlined rather
  // than fetched from DataTables' CDN language files — this extension makes
  // no third-party requests.
  const DT_PT_BR = {
    search: 'Filtrar:',
    lengthMenu: '_MENU_ linhas por página',
    info: 'Mostrando _START_ a _END_ de _TOTAL_ registros',
    infoEmpty: 'Nenhum registro',
    infoFiltered: '(filtrado de _MAX_ no total)',
    zeroRecords: 'Nenhum registro encontrado',
    emptyTable: 'Sem dados',
    paginate: { first: 'Primeira', last: 'Última', next: 'Próxima', previous: 'Anterior' },
  };

  function initPanelTables(panelEl) {
    const jq = window.jQuery || window.$;
    if (!jq || !jq.fn || !jq.fn.dataTable || !panelEl) return;
    panelEl.querySelectorAll('table').forEach((tbl) => {
      try {
        // Initialize deliberately rather than inheriting whatever SIGC's
        // own auto-init would do: that gave a 10-row default and no say
        // over sorting. Already-claimed tables (SIGC got there first) are
        // adjusted in place instead — re-initializing throws.
        if (jq.fn.dataTable.isDataTable(tbl)) {
          jq(tbl).DataTable().page.len(PANEL_PAGE_LENGTH).draw(false);
          return;
        }
        jq(tbl).DataTable({
          pageLength: PANEL_PAGE_LENGTH,
          lengthMenu: [[10, 25, 50, 100, -1], [10, 25, 50, 100, 'Todos']],
          order: [], // keep the order the panel built (zona/report order)
          language: DT_PT_BR,
        });
      } catch (err) {
        // A failed init is not fatal: the plain table still renders every
        // row, just without sorting or paging.
        console.warn(`${TAG} não foi possível inicializar a tabela:`, err);
      }
    });
  }

  function wireZonaRowClicks(panelEl, joined) {
    panelEl.querySelectorAll('.sigc-pro-zona-row-clickable').forEach((row) => {
      row.addEventListener('click', (event) => {
        event.preventDefault(); // the Zona cell's <a href="#"> would otherwise jump-scroll
        focusZonaOnMap(panelEl, joined, row.dataset.idZona || '');
      });
    });
  }

  // Reads ultimo-movimento-map-relay.js's data-attributes, polling
  // briefly in case this file's own script started running before the
  // relay's has (both run at document_idle, in either order — the
  // attribute has no listener to miss, so this only needs to cover the
  // instant right at page load, not the click itself, which happens long
  // after both scripts have run).
  function waitForLeafletUrls() {
    return new Promise((resolve, reject) => {
      pollFor(readLeafletUrls, {
        onFound: resolve,
        onTimeout: () => reject(new Error('URLs do Leaflet não chegaram do relay a tempo.')),
      });
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
  //
  // Shared on window (see CONSENT_STATE_KEY above) so a second injection
  // of this content script doesn't re-ask something already answered.
  let mapInitialized = false;
  // Guards against two calls in the same tick both passing the
  // mapInitialized check (mapInitialized only turns true AFTER the async
  // loadLeafletAssets() resolves) and each constructing a Leaflet map on
  // the same container — real Leaflet then throws "Map container is
  // already initialized." Set only after the consent block (a declined
  // consent must not leave this stuck true) and always cleared in
  // `finally` so a failed load can still be retried.
  let tileLoadInFlight = false;
  let pendingJoined = null;
  // Live Leaflet map instance, once rendered — lets a Zonas-tab row
  // click (see focusZonaOnMap below) call fitBounds without threading
  // the map object through every function in between. Cleared on
  // closePanel so a stale map from a previous open can never be
  // fitBounds'd after its container is gone.
  let currentMap = null;

  // Test-only seam, same pattern as resetFilteredAgencia above: this
  // module-level tile/consent state survives between test cases, so each
  // one that exercises maybeLoadTiles needs a clean starting point.
  function resetTileState() {
    consentState.tiles = false;
    mapInitialized = false;
    tileLoadInFlight = false;
    leafletLoadPromise = null;
  }

  async function maybeLoadTiles() {
    if (mapInitialized || tileLoadInFlight) return;
    const container = document.getElementById('sigc-pro-leaflet-map');
    if (!container) return;
    if (!consentState.tiles) {
      if (!confirm(TILE_CONSENT_MSG)) {
        container.innerHTML =
          '<p class="sigc-pro-map-declined">Mapa não carregado (tiles ' +
          'recusados). <button type="button" id="sigc-pro-retry-tiles">Tentar novamente</button></p>';
        const retry = document.getElementById('sigc-pro-retry-tiles');
        if (retry) retry.addEventListener('click', maybeLoadTiles);
        return;
      }
      consentState.tiles = true;
    }
    tileLoadInFlight = true;
    try {
      const L = await loadLeafletAssets();
      renderLeafletMap(L, container, pendingJoined || []);
      mapInitialized = true;
    } catch (err) {
      container.innerHTML = `<p class="sigc-pro-map-declined">Falha ao carregar o mapa: ${window.__sigcPro.escapeHtml(String(err && err.message || err))}</p>`;
    } finally {
      tileLoadInFlight = false;
    }
  }

  // A building with several domicílios shares one geocode in SIGC, so
  // their markers land exactly on top of each other and only the last one
  // drawn is clickable. Rather than collapse them into a count, fan the
  // group out onto a small ring around the shared point: every domicílio
  // keeps its own number, status color and popup. Rows are grouped by a
  // ~5 m threshold (COLOCATED_EPS_DEG below) so a jittered geocode of the
  // same building collapses together with the exact matches.
  const COLOCATED_EPS_DEG = 0.00005; // ~5.5 m in latitude
  const SPIDER_RADIUS_DEG = 0.00012; // ~13 m — visibly apart at street zoom

  function spiderfyRows(rows) {
    const groups = []; // [{ lat, lon, members: [row, ...] }]
    rows.forEach((r) => {
      const hit = groups.find((g) => (
        Math.abs(g.lat - r.lat) <= COLOCATED_EPS_DEG &&
        Math.abs(g.lon - r.lon) <= COLOCATED_EPS_DEG
      ));
      if (hit) hit.members.push(r);
      else groups.push({ lat: r.lat, lon: r.lon, members: [r] });
    });
    const out = [];
    groups.forEach((g) => {
      const n = g.members.length;
      g.members.forEach((r, i) => {
        // Longitude degrees shrink with latitude; scale so the ring reads
        // as a circle on screen rather than an ellipse.
        const lonScale = 1 / Math.max(0.15, Math.cos(g.lat * Math.PI / 180));
        const angle = (2 * Math.PI * i) / n;
        out.push(Object.assign({}, r, {
          lat: n === 1 ? r.lat : g.lat + SPIDER_RADIUS_DEG * Math.sin(angle),
          lon: n === 1 ? r.lon : g.lon + SPIDER_RADIUS_DEG * lonScale * Math.cos(angle),
          origLat: r.lat,
          origLon: r.lon,
          coLocated: n,
        }));
      });
    });
    return out;
  }

  // The text drawn inside a domicílio marker: the domicílio number, which
  // in practice is 1–2 digits and so fits the circle without truncation.
  function domicilioLabel(r) {
    return window.__sigcPro.escapeHtml(String(r.domicilio));
  }

  // Pure/testable: the marker popup body for one household row. The
  // Agendado line is entirely omitted (not blank) when there is none —
  // an empty "Agendado:" line would read as a broken lookup rather than
  // "not scheduled".
  function buildPopupHtml(r) {
    const esc = window.__sigcPro.escapeHtml;
    const gmapsUrl = window.__sigcPro.gmapsPontoUrl(r.lat, r.lon);
    const gmapsLine = gmapsUrl
      ? `<br><a href="${esc(gmapsUrl)}" target="_blank" rel="noopener">Ver no Google Maps</a>`
      : '';
    const agendadoLinha = r.agendado
      ? `<br>Agendado: <span class="${r.futura ? 'sigc-pro-futura' : 'sigc-pro-passada'}">` +
        `${esc(r.agendado)}</span>`
      : '';
    // Only shown when the marker was fanned out of a shared geocode, so
    // the user knows the ring is one address, not neighbouring ones.
    const coLocadoLinha = r.coLocated > 1
      ? `<br><em>${r.coLocated} domicílios neste mesmo ponto</em>`
      : '';
    return (
      `Controle: ${esc(r.controle)}<br>` +
      `Domicílio: ${esc(r.domicilio)}${coLocadoLinha}<br>` +
      `Entrevistador: ${esc(r.entrevistador)}<br>` +
      `Tipo: ${esc(r.tipoEntrevista)}<br>` +
      `Zona: ${esc(r.idZona || 'Sem zona')}` +
      agendadoLinha +
      gmapsLine
    );
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
    // Co-located rows are fanned onto a ring first (spiderfyRows), so the
    // markers below never sit exactly on top of one another and each
    // domicílio number stays readable and clickable.
    const bounds = [];
    spiderfyRows(withCoords).forEach((r) => {
      const color = statusColor(r);
      if (r.coLocated > 1) {
        // Thin leader line back to the true geocode, so the fan reads as
        // "these all live at that one point" rather than as separate
        // addresses scattered around it.
        L.polyline([[r.origLat, r.origLon], [r.lat, r.lon]], {
          color: '#666', weight: 1, opacity: 0.5, interactive: false,
        }).addTo(map);
      }
      const marker = L.circleMarker([r.lat, r.lon], {
        radius: 9, color, fillColor: color, fillOpacity: 0.8,
      }).addTo(map);
      // The number rides in its own non-interactive divIcon centered on
      // the circle — circleMarker itself cannot carry text.
      L.marker([r.lat, r.lon], {
        icon: L.divIcon({
          className: 'sigc-pro-domicilio-num',
          html: `<span>${domicilioLabel(r)}</span>`,
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        }),
        interactive: false,
      }).addTo(map);
      // gmapsPontoUrl (just pins the point — no turn-by-turn directions)
      // is always non-empty here (withCoords already filtered to
      // temCoordenadas rows), same outbound-link-only pattern
      // lista-agenda.js's own domicílio table uses (via the sibling
      // gmapsDestinoUrl) — a link the user clicks, never a request the
      // extension makes itself.
      // Popup and bounds both use the TRUE geocode, never the fanned ring
      // position: the Google Maps link must pin the real address, and the
      // fitBounds box must not be inflated by the fan offsets.
      marker.bindPopup(buildPopupHtml(Object.assign({}, r, { lat: r.origLat, lon: r.origLon })));
      bounds.push([r.origLat, r.origLon]);
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

  // The agência currently SELECTED in the filter form. Read off the same
  // kind of select2-dressed <select> ultimo-movimento-export.js reads
  // IdUf from: select2 keeps the real element in the DOM (visually
  // hidden, the "TODOS" text being a select2-rendered span), so .value
  // still works.
  //
  // '*' is the codebase's all-agências wildcard (buildAgenciaFilterBody)
  // and a blank is the placeholder shape fetchAgenciaList already drops;
  // both mean "not a single agência".
  //
  // This is the form's state, NOT the report's — see filteredAgencia.
  function selectedAgencia() {
    const s = document.getElementById('IdAgencia');
    const v = s ? String(s.value || '').trim() : '';
    return v === '*' ? '' : v;
  }

  // The agência the table ON SCREEN was actually filtered by, captured
  // when Filtrar is clicked. '' when the last Filtrar was a TODOS run,
  // or when no Filtrar has happened yet in this page's lifetime.
  //
  // Gating on this rather than on selectedAgencia() is the whole point:
  // changing the dropdown does NOT re-run the report, so the rendered
  // rows still belong to the previously submitted agência. Gating on
  // the live selector would show the button for an agência whose data
  // isn't on screen (and hide it for one whose data is), and Mapa's
  // single agência-scoped coordinate fetch would then be scoped to the
  // wrong agência entirely — a silent wrong-data join, not a visible
  // error.
  let filteredAgenciaValue = '';

  function filteredAgencia() {
    return filteredAgenciaValue;
  }

  function captureFilteredAgencia() {
    filteredAgenciaValue = selectedAgencia();
  }

  // Test-only seam: the module-level capture survives between test
  // cases, so each one needs a clean starting point.
  function resetFilteredAgencia() {
    filteredAgenciaValue = '';
    agenciaAdopted = false;
  }

  // Filtrar is a plain form-action button that re-renders the table in
  // place, so there's no navigation or load event to hook — the click
  // itself is the signal. Capture on the CAPTURE phase so it records the
  // value even if the page's own handler stops propagation, and record
  // it before the request goes out (the selector can't change between
  // the click and the response).
  //
  // Bound once, lazily: btnFiltrar exists from page load on Último
  // Movimento, but this file also loads on pages without it.
  let filtrarBound = false;

  function bindFiltrarCapture() {
    if (filtrarBound) return;
    const btn = document.getElementById('btnFiltrar');
    if (!btn) return;
    btn.addEventListener('click', captureFilteredAgencia, true);
    filtrarBound = true;
  }

  // Seeds the captured value from the selector when a report is ALREADY
  // rendered but no Filtrar click was ever observed.
  //
  // Without this the button silently never appeared (reported live
  // 2026-08-10: "doesn't show up until a reload"). captureFilteredAgencia
  // only ever ran on a click, so any report that was on screen before
  // this file's listener existed — SIGC restoring filter state, a back
  // navigation, or simply a Filtrar during the extension's own startup
  // — left filteredAgencia empty for the page's whole lifetime. The
  // "reload" that appeared to fix it actually just gave the user a
  // reason to click Filtrar again.
  //
  // Safe because it's a one-time seed: once anything has been captured
  // it never overwrites, so a Filtrar-captured value still wins over a
  // drifting selector, which is the property the gate exists for. On
  // arrival at a TODOS report it adopts '', leaving the gate closed.
  let agenciaAdopted = false;

  function adoptRenderedAgencia(hasTable) {
    if (agenciaAdopted || !hasTable) return;
    agenciaAdopted = true;
    if (!filteredAgenciaValue) filteredAgenciaValue = selectedAgencia();
  }

  // How many on-screen households the Lista de Endereços call returned
  // no entry for. Non-zero is not necessarily an error — a household can
  // legitimately lack coordinates — but a LARGE count after an
  // agência-scoped fetch suggests a truncated or paginated response,
  // which would otherwise be indistinguishable from ordinary missing
  // geocoding once joinEnderecos folds both into temCoordenadas:false.
  function missingEnderecoCount(movimentoMap, enderecosMap) {
    let missing = 0;
    movimentoMap.forEach((_row, key) => {
      if (!enderecosMap.has(key)) missing += 1;
    });
    return missing;
  }

  // Lista de Endereços cross-fetch — delegates entirely to
  // agenda-lookups.js's fetchEnderecosByAgencia(uf, agencia): ONE
  // request covering the whole agência, replacing the per-Controle loop
  // this used to make (one POST per Controle on screen, dozens on a
  // real report). The report here is always agência-scoped, so the
  // server can scope the same way — see the filteredAgencia gate.
  // This file never issues that request itself: the network call stays
  // inside agenda-lookups.js, the directory check-privacy.sh's
  // FETCH_DIRS already sanctions for it.
  async function onMapaClick(btn) {
    ensureCss();
    const movimentoMap = readUltimoMovimentoTable();
    if (!movimentoMap || movimentoMap.size === 0) {
      alert('SIGC-PRO: nenhum dado encontrado no relatório — rode um Filtrar primeiro.');
      return;
    }
    // Both preconditions are checked BEFORE the consent prompt: asking
    // permission for a request that then can't be made would train the
    // user to click through a prompt that didn't mean anything.
    const AM = window.__sigcProAgendaLookups;
    const uf = window.__sigcProUltimoMovimentoExportInternals &&
      window.__sigcProUltimoMovimentoExportInternals.getCurrentUf();
    if (!uf) {
      alert('SIGC-PRO: não foi possível identificar a UF atual.');
      return;
    }
    // Re-checked here, not just at mount: a Filtrar on TODOS clears this
    // between the mount tick and the click.
    const agencia = filteredAgencia();
    if (!agencia) {
      alert('SIGC-PRO: o Mapa só funciona com uma agência selecionada — ' +
        'escolha uma agência no filtro e rode Filtrar novamente.');
      return;
    }

    if (!consentState.fetch) {
      if (!confirm(FETCH_CONSENT_MSG)) return;
      consentState.fetch = true;
    }

    btn.disabled = true;
    try {
      // ONE call for the whole agência, not one per Controle: the report
      // is agência-scoped (guaranteed by the mount gate below), so the
      // server can scope the Lista de Endereços the same way.
      let enderecosMap = new Map();
      try {
        enderecosMap = await AM.fetchEnderecosByAgencia(uf, agencia);
      } catch (err) {
        console.warn(`${TAG} Lista de Endereços fetch failed:`, err);
        alert(`SIGC-PRO: não foi possível obter coordenadas (${err && err.message}); ` +
          'o mapa e a tabela de zonas serão exibidos sem coordenadas/zona.');
      }
      // A short response looks identical to ordinary missing geocoding
      // once joined, so say so rather than let it pass silently.
      const missing = missingEnderecoCount(movimentoMap, enderecosMap);
      if (enderecosMap.size > 0 && missing > 0) {
        console.warn(`${TAG} ${missing}/${movimentoMap.size} domicílio(s) sem entrada na Lista de Endereços.`);
        alert(`SIGC-PRO: ${missing} de ${movimentoMap.size} domicílio(s) não retornaram ` +
          'endereço na consulta e ficarão sem coordenadas/zona.');
      }
      const joined = joinEnderecos(movimentoMap, enderecosMap);

      // The agenda is an enrichment, not the feature's core (that's the
      // coordinate join above) — a rejected agenda fetch must never cost
      // the map. Falls back to an empty index, leaving every `agendado`
      // blank, same fail-open shape as the Lista de Endereços fetch above.
      let agendaIdx = new Map();
      let agendaSlots = [];
      try {
        const ano = new Date().getFullYear();
        const agenda = await AM.fetchAgendaSlots(
          uf, `${ano}-01-01T00:00:00`, `${ano + 1}-01-01T00:00:00`);
        agendaSlots = agenda.dados || [];
        agendaIdx = AM.indexByControle(agendaSlots);
      } catch (err) {
        console.warn(`${TAG} agenda fetch failed:`, err);
      }
      const todayIso = new Date().toISOString().slice(0, 10);
      const comAgenda = joinAgenda(joined, agendaIdx, todayIso);

      pendingJoined = comAgenda;
      const zonaRows = aggregateZonas(comAgenda, enderecosMap);

      // "Bookable now": today through +2 weeks, the same window
      // lista-agenda.js's own Slots Abertos treats as realistically
      // fillable — a slot months out would overstate capacity a zona
      // actually has.
      const minDateIso = todayIso;
      const fimDate = new Date();
      fimDate.setDate(fimDate.getDate() + 14);
      const fimIso = fimDate.toISOString().slice(0, 10);
      const slotsPorZona = new Map();
      zonaRows.forEach((z) => {
        const zonaKey = z.idZona || '';
        const livres = AM.slotsLivresDaJanela(agendaSlots, zonaKey, minDateIso, fimIso);
        slotsPorZona.set(zonaKey, AM.agruparPorDia(livres));
      });

      closePanel();
      document.body.insertAdjacentHTML('beforeend', buildPanelHtml(comAgenda, zonaRows, slotsPorZona));
      const panelEl = document.getElementById(PANEL_ID);
      wireTabs(panelEl);
      wireZonaRowClicks(panelEl, comAgenda);
      initPanelTables(panelEl);
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
      const sums = bucket.coords.reduce((acc, [la, lo]) => [acc[0] + la, acc[1] + lo], [0, 0]);
      const lat = sums[0] / bucket.coords.length;
      const lon = sums[1] / bucket.coords.length;
      const colorState = bucket.allDistribuido ? 'inactive' : (bucket.noneDistribuido ? 'active' : 'partial');
      out.push({ controle, lat, lon, colorState });
    });
    return out;
  }

  const TITLE_MAPA_ATIVO = 'Mapa de domicílios por zona (SIGC-PRO)';
  const TITLE_MAPA_SEM_AGENCIA =
    'Filtre por uma agência (e clique em Filtrar) para ver o mapa — ' +
    'um relatório de estado inteiro é grande demais para buscar coordenadas.';

  // Button stays VISIBLE either way — an absent button is
  // indistinguishable from a broken extension, the same rule
  // lista-agenda.js states. Now that Último Movimento is the only home
  // for this feature, "the button disappeared" is a worse failure than
  // it was when Lista de Endereços still carried AGENDA PRO.
  function atualizarEstadoBotaoMapa() {
    const btn = document.getElementById(BUTTON_ID);
    if (!btn) return;
    const ok = !!filteredAgencia();
    btn.disabled = !ok;
    btn.title = ok ? TITLE_MAPA_ATIVO : TITLE_MAPA_SEM_AGENCIA;
  }

  // Anchored to the DataTables toolbar (.dt-buttons), alongside CSV-pro
  // — not Filtrar/Cancelar — since Mapa needs the filtered table's rows
  // to do anything useful, same as CSV-pro itself; the toolbar only
  // exists once a Filtrar has actually rendered a table, so this button
  // (like CSV-pro) doesn't appear until then, unlike the earlier
  // Filtrar-anchored version which showed immediately with nothing to
  // act on yet.
  window.__sigcPro.mountWidget({
    id: BUTTON_ID,
    anchor: (ctx) => ctx.dtToolbar(),
    // Also requires that the report on screen was filtered by a single
    // agência — the captured Filtrar value, not the live dropdown, so
    // merely changing the selector doesn't flip the button's enabled
    // state while the old table is still displayed. Mapa's one
    // agência-scoped Lista de Endereços call can't cover a TODOS report,
    // so the button mounts disabled there rather than vanishing outright
    // — see atualizarEstadoBotaoMapa.
    //
    // The bind rides along on the mount tick: it's idempotent, and this
    // is already the one place guaranteed to run repeatedly on the page.
    when: () => {
      if (!onUltimoMovimento()) return false;
      bindFiltrarCapture();
      const hasTable = !!window.__sigcPro.getDataTable();
      adoptRenderedAgencia(hasTable);
      if (hasTable) atualizarEstadoBotaoMapa();
      return hasTable;
    },
    build: () => {
      const btn = window.__sigcPro.makeDtProButton({
        id: BUTTON_ID,
        // Every other makeDtProButton caller (KML-pro, CSV-pro, PDF-pro,
        // Agenda-pro) uses two lines — a single line left the text
        // sitting high/off-center in the box (confirmed visually), since
        // the button's vertical centering is tuned for two lines.
        lines: ['MAPA', 'PRO'],
        title: TITLE_MAPA_ATIVO,
        onClick: () => onMapaClick(btn),
      });
      // atualizarEstadoBotaoMapa() looks the button up by id in the DOM,
      // but build() runs BEFORE mountWidget inserts its return value —
      // set the initial state on btn directly instead of through that
      // lookup, or a freshly-mounted button would flash as enabled until
      // the next mount tick corrected it.
      const ok = !!filteredAgencia();
      btn.disabled = !ok;
      btn.title = ok ? TITLE_MAPA_ATIVO : TITLE_MAPA_SEM_AGENCIA;
      return btn;
    },
  });

  window.__sigcProUltimoMovimentoMapInternals = {
    parseUltimoMovimentoRows,
    joinEnderecos,
    joinAgenda,
    initPanelTables,
    PANEL_PAGE_LENGTH,
    aggregateZonas,
    zonaColor,
    statusColor,
    buildZonasTableHtml,
    buildDomiciliosTabHtml,
    buildPopupHtml,
    spiderfyRows,
    domicilioLabel,
    buildPanelHtml,
    onMapaClick,
    convexHull,
    controleCentroids,
    zonaRowIsClickable,
    selectedAgencia,
    filteredAgencia,
    captureFilteredAgencia,
    resetFilteredAgencia,
    resetTileState,
    adoptRenderedAgencia,
    missingEnderecoCount,
    atualizarEstadoBotaoMapa,
  };
})();
