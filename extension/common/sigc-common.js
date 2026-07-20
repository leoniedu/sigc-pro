// SIGC-PRO shared runtime: pesquisa registry, page detection, poll loop,
// and table-layout validation. Loaded before all feature scripts (MAIN world).
(function () {
  'use strict';

  if (window.__sigcPro) return;

  const TAG = '[sigc-pro]';

  // Column labels every pesquisa's Lista de Endereços is expected to
  // share. agenda-map resolves fetched-response columns against THESE
  // (the Agenda page has no report title to detectPesquisa against), so
  // it must never depend on any single pesquisa's registry entry — that
  // would silently pin it to the wrong survey once a second one exists.
  const LISTA_COMMON_LABELS = {
    controle: 'Controle',
    nDomicilio: 'N.º Domicilio',
    latitude: 'Latitude',
    longitude: 'Longitude',
    idZona: 'ID Zona',
    nomeZona: 'Nome ZONA',
  };

  // One entry per pesquisa. `columns` describes the Lista de Endereços table
  // (0-based, left to right); `label` is the expected header text — features
  // refuse to act when labels don't match, so a SIGC layout change can't
  // silently shift data into the wrong column.
  const PESQUISAS = {
    PNS2026: {
      titlePattern: /SIGC\s*-\s*PNS2026/i,
      columns: {
        controle:      { index: 0,  label: LISTA_COMMON_LABELS.controle },
        idCnefe:       { index: 1,  label: 'ID_CNEFE' },
        nDomicilio:    { index: 2,  label: LISTA_COMMON_LABELS.nDomicilio },
        quadra:        { index: 3,  label: 'Quadra' },
        face:          { index: 4,  label: 'Face' },
        logradouro:    { index: 5,  label: 'Logradouro' },
        numero:        { index: 6,  label: 'Número' },
        complemento:   { index: 7,  label: 'Complemento' },
        bairro:        { index: 8,  label: 'Bairro' },
        latitude:      { index: 9,  label: LISTA_COMMON_LABELS.latitude },
        longitude:     { index: 10, label: LISTA_COMMON_LABELS.longitude },
        telefone:      { index: 11, label: 'Telefone' },
        morador:       { index: 12, label: 'Morador' },
        situacao:      { index: 13, label: 'Situação' },
        selecionado:   { index: 14, label: 'Selecionado' },
        antropometria: { index: 15, label: 'Antropometria' },
        biomarcadores: { index: 16, label: 'Biomarcadores' },
        idZona:        { index: 17, label: LISTA_COMMON_LABELS.idZona },
        nomeZona:      { index: 18, label: LISTA_COMMON_LABELS.nomeZona },
      },
    },
  };

  const MISSING_VALUES = ['-', ''];

  function normalizeLabel(s) {
    return String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function detectPesquisa() {
    const el = document.querySelector('.header-sigc__title');
    if (!el) return null;
    const text = el.textContent || '';
    for (const [id, cfg] of Object.entries(PESQUISAS)) {
      if (cfg.titlePattern.test(text)) return Object.assign({ id }, cfg);
    }
    return null;
  }

  // True only on the Lista de Endereços page. KML/PDF export are meaningless
  // elsewhere in SIGC, so features gate on this before touching the DOM.
  function onListaEnderecos() {
    return [...document.querySelectorAll('h6')].some(
      (h) => normalizeLabel(h.textContent).replace(/[çã]/g, (c) => (c === 'ç' ? 'c' : 'a')) ===
        'lista de enderecos'
    );
  }

  // Fires callback(pesquisa, prereq) once, when a pesquisa matches, the
  // current page is the Lista de Endereços, AND prereqFn() is truthy.
  // Silent give-up after ~10 s keeps the extension inert on non-SIGC IBGE
  // pages and on other SIGC pages within a matching pesquisa.
  function whenReady(prereqFn, callback) {
    let attempts = 0;
    const tick = () => {
      const pesquisa = detectPesquisa();
      const prereq = pesquisa && onListaEnderecos() ? prereqFn() : null;
      if (pesquisa && prereq) {
        callback(pesquisa, prereq);
        return;
      }
      attempts += 1;
      if (attempts <= 50) setTimeout(tick, 200);
    };
    tick();
  }

  // Like whenReady, but with no pesquisa/page requirement — for features
  // that work on any SIGC report (e.g. generic CSV export). Fires
  // callback(prereq) once prereqFn() is truthy. Unlike whenReady, this never
  // gives up: every SIGC report has a table eventually, so a slow AJAX load
  // (past whenReady's 10 s pesquisa-detection window) should still resolve
  // instead of leaving the button missing until a reload.
  function whenReadyGeneric(prereqFn, callback) {
    const tick = () => {
      const prereq = prereqFn();
      if (prereq) {
        callback(prereq);
        return;
      }
      setTimeout(tick, 200);
    };
    tick();
  }

  // Returns the page's live DataTables instance, or null if jQuery,
  // DataTables, or a table isn't present/initialized yet.
  function getDataTable() {
    const jq = window.jQuery || window.$;
    if (!jq || !jq.fn || !jq.fn.dataTable) return null;
    const table = jq('table').DataTable();
    if (!table || !table.table || table.table().node() == null) return null;
    return table;
  }

  // Reads the full current-table dataset (all pages) via the DataTables JS
  // API — reliable under the F5 gateway (confirmed: row count matches
  // "Showing X of Y", stable across pagination/sort, unlike raw DOM
  // scraping of table/tr/td which the gateway's cloning made unreliable).
  // Returns { rows, header } (plain strings, HTML stripped) or null if no
  // table is available.
  function readDataTable() {
    const table = getDataTable();
    if (!table) return null;
    const header = table.columns().header().toArray().map((h) => h.textContent.trim());
    const rows = table.rows().data().toArray().map((r) => Array.from(r).map((c) => cellText(c)));
    return { rows, header };
  }

  // Lista de Endereços-specific: readDataTable() plus validation against
  // pesquisa.columns. Returns { rows, header } or null (table unavailable,
  // or header doesn't match — mismatch is logged by tableMatchesLayout).
  function getTableRows(pesquisa) {
    const result = readDataTable();
    if (!result) return null;
    if (!tableMatchesLayout(result.header, pesquisa.columns)) return null;
    return result;
  }

  function tableMatchesLayout(headerTexts, columns) {
    const mismatches = Object.entries(columns).filter(
      ([, c]) => normalizeLabel(headerTexts[c.index]) !== normalizeLabel(c.label)
    );
    if (mismatches.length > 0) {
      console.warn(
        `${TAG} Layout mismatch:`,
        mismatches
          .map(([k, c]) => `${k}[${c.index}] expected "${c.label}" got "${headerTexts[c.index] ?? ''}"`)
          .join('; '),
        '| live headers:',
        JSON.stringify(headerTexts)
      );
      return false;
    }
    return true;
  }

  function cellText(v) {
    // Cell data may contain HTML; reduce to text. DOMParser is inert —
    // unlike innerHTML on a detached div, it never fetches resources or
    // runs handlers (e.g. <img src onerror>), keeping the zero-network
    // guarantee independent of table contents.
    const doc = new DOMParser().parseFromString(String(v ?? ''), 'text/html');
    return (doc.body.textContent || '').trim();
  }

  // CSV building/download shared via buildCsv/downloadFile, so escaping,
  // delimiter, and BOM rules live in one place.
  function escapeCsvField(s) {
    let v = String(s ?? '');
    // Excel formula-injection guard: a leading = + - @ or tab makes Excel
    // evaluate the field. Prefix a quote unless the field is a plain
    // number (keeps negative coordinates numeric on import).
    if (/^[=+\-@\t\r]/.test(v) && !/^-?\d+(?:[.,]\d+)?$/.test(v)) v = "'" + v;
    return /[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }

  // pt-BR Excel expects `;`-delimited CSV (comma is the decimal separator
  // in that locale, so comma-delimited CSVs misparse on import).
  function buildCsv(header, rows) {
    const lines = [header, ...rows].map((r) => r.map(escapeCsvField).join(';'));
    return lines.join('\r\n') + '\r\n';
  }

  function downloadFile(filename, text, mimeType, opts) {
    // UTF-8 BOM so Excel doesn't mangle accented CSVs; pass
    // { bom: false } for formats that declare their own encoding (KML/XML).
    const bom = !(opts && opts.bom === false);
    const blob = new Blob([bom ? '﻿' + text : text], { type: mimeType || 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // { data: 'YYYY-MM-DD', hora: 'HHMMSS' } for the current instant — shared
  // by every feature's fallback/generic filename builder (csv-export,
  // agenda-csv-export), so the format stays identical across them.
  function timestampSlug() {
    const now = new Date();
    return {
      data: now.toISOString().slice(0, 10),
      hora: now.toTimeString().slice(0, 8).replace(/:/g, ''),
    };
  }

  // Filename-safe slug: deaccented, non-alphanumerics collapsed to "-".
  // Shared by agenda-csv-export and agenda-day-guide filename builders.
  function slug(s) {
    return String(s ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
  }

  // Index = Date.getDay(). Shared by agenda-slot-checks (alert dates) and
  // agenda-day-guide (guide header).
  const WEEKDAYS_PT = [
    'domingo', 'segunda-feira', 'terça-feira', 'quarta-feira',
    'quinta-feira', 'sexta-feira', 'sábado',
  ];

  // Parses a coordinate cell to signed decimal degrees, or null.
  // SIGC shows DMS: "dd mm ss.sss S" (also tolerates °'" marks; hemisphere
  // N/S/E/W, plus O = Oeste). Decimal seconds may use comma. Plain decimal
  // values (dot or comma) are accepted too.
  function parseCoord(v) {
    const s = cellText(v);
    if (s === '' || MISSING_VALUES.includes(s)) return null;

    const dms = s.match(
      /^(-?\d{1,3})[°\s]+(\d{1,2})['\s]+(\d{1,2}(?:[.,]\d+)?)["\s]*([NSEWO])?$/i
    );
    if (dms) {
      const deg = Math.abs(parseInt(dms[1], 10));
      const min = parseInt(dms[2], 10);
      const sec = Number(dms[3].replace(',', '.'));
      if (!Number.isFinite(sec) || min >= 60 || sec >= 60) return null;
      let value = deg + min / 60 + sec / 3600;
      const hemi = (dms[4] || '').toUpperCase();
      if (hemi === 'S' || hemi === 'W' || hemi === 'O' || dms[1].startsWith('-')) value = -value;
      return value;
    }

    const n = Number(s.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }

  // --- Agenda (AdministracaoAgenda) shared reading -------------------
  // Used by both agenda-csv-export and agenda-slot-checks, which both
  // need "every slot in the currently rendered calendar, parsed" — kept
  // here so the DOM-reading/title-parsing logic exists in exactly one
  // place. See docs/superpowers/specs/2026-07-16-agenda-csv-export-design.md
  // for how these were reverse-engineered against the live FullCalendar
  // resource-timegrid markup.

  // Matches any ibge.gov.br page (through the F5 proxy or not) whose
  // logical path ends with /AdministracaoAgenda. Query strings/F5 routing
  // suffixes live in location.search, not location.pathname.
  function onAgendaPage() {
    return /\/AdministracaoAgenda\/?$/i.test(location.pathname);
  }

  // The FullCalendar toolbar always renders both view-switch buttons
  // (Dia/Semana), whichever is active — used both as the "agenda is ready"
  // signal and as the anchor Agenda features insert their buttons next to.
  function findAgendaToolbarChunk() {
    const viewBtn = document.querySelector(
      '.fc-resourceTimeGridWeek-button, .fc-resourceTimeGridDay-button, ' +
        '.fc-timeGridWeek-button, .fc-timeGridDay-button'
    );
    return viewBtn ? viewBtn.closest('.fc-toolbar-chunk') : null;
  }

  // "Label: value" per line -> { Label: value }. Empty/placeholder values
  // ("-" after trim) are dropped so callers can just `|| ''`.
  function parseAgendaSlotTitle(text) {
    const fields = {};
    String(text ?? '').split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      const sep = trimmed.indexOf(':');
      if (sep === -1) return;
      const label = trimmed.slice(0, sep).trim();
      const value = trimmed.slice(sep + 1).trim();
      if (!MISSING_VALUES.includes(value)) fields[label] = value;
    });
    return fields;
  }

  // Minimal HTML escaper; the numeric &#39; entity is valid in XML too,
  // so the KML export shares it as its XML escaper.
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Comma-separated Zonas field -> individual entries, e.g.
  // "29.3.03.03 29_Linus_Pituba, 29.3.02.03 29_Linus_Pituba" -> two
  // entries, each "código nome". Entries are kept whole; callers that
  // match against the equipe do so on the entry's tail, so the code
  // format never needs parsing.
  function parseZonaEntries(zonas) {
    return String(zonas ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  }

  function isoToBr(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso || '');
  }

  // UF <select> on the Agenda page: option 0 is the placeholder. `code`
  // is the option value (used in request bodies), `name` the visible
  // text (used in filenames and headers).
  function getAgendaUf() {
    const s = document.getElementById('selectUf');
    return {
      code: s ? s.value : '',
      name: s && s.selectedIndex > 0 ? s.options[s.selectedIndex].text.trim() : '',
    };
  }

  // idEquipe (uuid) -> team name. Prefers the calendar's own resource
  // header cells (what's actually on screen); falls back to the Equipes
  // <select> options in case a header cell is missing for some resource.
  function getAgendaEquipeNames() {
    const names = {};
    document.querySelectorAll('[data-resource-id].fc-col-header-cell').forEach((el) => {
      const id = el.getAttribute('data-resource-id');
      if (id && !names[id]) names[id] = el.textContent.trim();
    });
    const select = document.getElementById('selectEquipes');
    if (select) {
      Array.from(select.options).forEach((o) => {
        if (o.value && !names[o.value]) names[o.value] = o.text.trim();
      });
    }
    return names;
  }

  // Reads every slot currently rendered in the calendar — both reserved
  // (evento-reservado, has Controle/Domicílio/Nome/…) and open/unbooked
  // (title is just "Zonas: …", no patient assigned yet). `reservado`
  // lets callers filter either way without re-touching the DOM. Returns
  // [] if the calendar has no events (empty week/day, or nothing loaded
  // yet) — never throws.
  function readAgendaSlots() {
    const root = document.getElementById('calendar') || document;
    const events = Array.from(root.querySelectorAll('.fc-timegrid-event'));
    if (events.length === 0) return [];

    const equipeNames = getAgendaEquipeNames();

    const rows = events.map((el) => {
      const col = el.closest('.fc-timegrid-col[data-date]');
      const isoDate = col ? col.getAttribute('data-date') || '' : '';
      const resourceId = col ? col.getAttribute('data-resource-id') || '' : '';
      const equipe = equipeNames[resourceId] || resourceId;

      const timeEl = el.querySelector('.fc-event-time');
      const [horaInicio, horaFim] = (timeEl ? timeEl.textContent : '')
        .split('-')
        .map((s) => s.trim());

      const titleEl = el.querySelector('.fc-event-title');
      const f = parseAgendaSlotTitle(titleEl ? titleEl.textContent : '');

      return {
        isoDate,
        data: isoToBr(isoDate),
        equipe,
        resourceId,
        reservado: el.className.includes('evento-reservado'),
        horaInicio: horaInicio || '',
        horaFim: horaFim || '',
        controle: f['Controle'] || '',
        domicilio: f['Domicílio'] || '',
        nome: f['Nome'] || '',
        sexo: f['Sexo'] || '',
        dtNascimento: f['Dt. Nascimento'] || '',
        idade: f['Idade'] || '',
        endereco: f['Endereço'] || '',
        telefone: f['Telefone'] || '',
        zonas: f['Zonas'] || '',
        observacao: f['Observação'] || '',
      };
    });

    rows.sort((a, b) =>
      a.isoDate.localeCompare(b.isoDate) ||
      a.horaInicio.localeCompare(b.horaInicio) ||
      a.equipe.localeCompare(b.equipe)
    );
    return rows;
  }

  // Minimum date (Date, local midnight) a new slot could still realistically
  // be scheduled for, counting forward from refDate: +3 calendar days, or
  // +4 if refDate is a Friday (coordination decided Sat/Sun get no special
  // treatment — just the plain +3 rule). Used to flag open slots that fall
  // inside a window too close to today to still be actionable.
  function agendaMinScheduleDate(refDate) {
    const base = refDate instanceof Date ? refDate : new Date();
    const offsetDays = base.getDay() === 5 ? 4 : 3; // 5 = Friday
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    d.setDate(d.getDate() + offsetDays);
    return d;
  }

  function dateToIso(d) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // Shared export filename (no extension):
  // lista-enderecos-<pesquisa>_<controle>_<tipo>_<data>.
  // tipo = "selecionados" when every row has Selecionado = Sim (the report
  // was requested filtered), otherwise "completos".
  // Accepts either the ORIGINAL pdfmake table body (rows of {text} cells,
  // header row included — pass the full `body`) or plain-string rows from
  // the DataTables API (no header row — pass `rows` directly).
  function exportFileBase(pesquisa, bodyOrRows) {
    const cols = pesquisa.columns;
    const looksLikeBody = bodyOrRows[0] && bodyOrRows[0][0] && typeof bodyOrRows[0][0] === 'object';
    const rows = looksLikeBody ? bodyOrRows.slice(1) : bodyOrRows;
    const val = (r, i) => {
      const c = r[i];
      if (c && typeof c === 'object' && c.text != null) return String(c.text).trim();
      return c != null ? String(c).trim() : '';
    };

    const controles = [...new Set(rows.map((r) => val(r, cols.controle.index)).filter(Boolean))];
    const controle = controles.length === 1 ? controles[0] : 'varios-controles';

    const allSim =
      rows.length > 0 && rows.every((r) => val(r, cols.selecionado.index) === 'Sim');
    const tipo = allSim ? 'selecionados' : 'completos';

    const data = new Date().toISOString().slice(0, 10);
    return `lista-enderecos-${pesquisa.id.toLowerCase()}_${controle}_${tipo}_${data}`;
  }

  // --- shared widget mounting ----------------------------------------
  // ONE registry + ONE MutationObserver on document.body for every
  // SIGC-PRO widget, replacing the per-feature observers (7+ of them,
  // each fanning out on every DOM mutation on busy FullCalendar/
  // DataTables pages). Every mount is insert-or-remove: each tick, a
  // widget exists iff its anchor exists and its `when` gate passes, so
  // toolbar re-renders that wipe a widget are healed on the next batch
  // and SPA-navigating away removes it.
  const mounts = [];
  let mountObserver = null;

  // Per-batch context: memoizes the lookups several mounts share, so a
  // batch costs one document-wide query per lookup, not one per mount.
  function makeTickCtx() {
    const memo = new Map();
    const once = (key, fn) => {
      if (!memo.has(key)) memo.set(key, fn());
      return memo.get(key);
    };
    return {
      dtToolbar: () => once('dtToolbar', () => document.querySelector('.dt-buttons')),
      agendaChunk: () => once('agendaChunk', findAgendaToolbarChunk),
      onLista: () => once('onLista', onListaEnderecos),
      onAgenda: () => once('onAgenda', onAgendaPage),
    };
  }

  // try/catch per mount: one broken mount must never break the others —
  // the isolation the per-feature IIFEs used to provide.
  function tickMount(m, ctx) {
    try {
      const existing = document.getElementById(m.id);
      const anchorEl = m.anchor(ctx);
      const ok = anchorEl && (!m.when || m.when(ctx));
      if (ok && !existing) anchorEl.appendChild(m.build());
      else if (!ok && existing) existing.remove();
    } catch (err) {
      console.warn(`${TAG} mount "${m.id}" tick failed:`, err);
    }
  }

  function tickAllMounts() {
    const ctx = makeTickCtx();
    mounts.forEach((m) => tickMount(m, ctx));
  }

  // { id, anchor: (ctx) => Element|null, when?: (ctx) => bool,
  //   build: () => Element }. Registers the widget, ticks it once
  // immediately (covers already-loaded pages), and lazily starts the
  // shared observer. The union config (childList + subtree + class
  // attributes) serves every mount — class attributes because the
  // Dia/Semana toggle flips fc-button-active without re-rendering the
  // toolbar; ticks are cheap (memoized ctx + O(1) getElementById), so
  // the extra firings don't matter.
  function mountWidget(spec) {
    mounts.push(spec);
    tickMount(spec, makeTickCtx());
    if (!mountObserver) {
      mountObserver = new MutationObserver(tickAllMounts);
      mountObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class'],
      });
    }
  }

  // --- SIGC-PRO button factories --------------------------------------
  // The two toolbar button styles used across features, each defined
  // exactly once (previously copy-pasted 3× each).

  // DataTables toolbar button (Lista de Endereços). Same classes as
  // SIGC's own icon buttons (dt-btn-icon etc.) — their CSS controls the
  // exact box metrics (size, padding, vertical position) that keep
  // native buttons aligned with each other. Matching pixel values by
  // hand kept drifting; reusing the classes guarantees identical
  // alignment since it's the same rules. We only override color and
  // font to make ours read as SIGC-PRO, not layout.
  function makeDtProButton({ id, lines, title, onClick }) {
    const btn = document.createElement('button');
    btn.id = id;
    btn.type = 'button';
    btn.className = 'dt-button buttons-html5 dt-btn-icon';
    const span = document.createElement('span');
    lines.forEach((line, i) => {
      if (i > 0) span.appendChild(document.createElement('br'));
      span.appendChild(document.createTextNode(line));
    });
    btn.appendChild(span);
    btn.title = title;
    btn.style.background = '#005a9c';
    btn.style.borderColor = '#005a9c';
    btn.style.color = '#fff';
    btn.style.fontWeight = '700';
    btn.style.fontSize = '7px';
    btn.style.lineHeight = '1.15';
    btn.style.textAlign = 'center';
    btn.style.textTransform = 'uppercase';
    // The native icon glyph is small/fixed-size; our two-line text label
    // is wider, so the class's width: auto grows to fit it. Pin box
    // dimensions only (not display/align-items, which broke vertical
    // alignment before) to force the same square footprint as the icon
    // buttons.
    btn.style.width = '36px';
    btn.style.minWidth = '36px';
    btn.style.maxWidth = '36px';
    btn.style.borderRadius = '4px';
    btn.addEventListener('click', onClick);
    return btn;
  }

  // FullCalendar toolbar button (Agenda). FullCalendar's own button
  // classes give correct box metrics/spacing next to Dia/Semana; only
  // color is overridden to read as SIGC-PRO. id/onClick optional: the
  // date-picker composes this inside a wrapper that owns the widget id
  // and wires its own listeners.
  function makeFcProButton({ id, text, title, onClick }) {
    const btn = document.createElement('button');
    if (id) btn.id = id;
    btn.type = 'button';
    btn.className = 'fc-button fc-button-primary';
    btn.textContent = text;
    btn.title = title;
    btn.style.background = '#005a9c';
    btn.style.borderColor = '#005a9c';
    btn.style.marginLeft = '4px';
    if (onClick) btn.addEventListener('click', onClick);
    return btn;
  }

  // Note: agenda-day-guide additionally injects `dayGuide` (generate /
  // diaViewActive) onto this object at load time, consumed by agenda-map;
  // manifest load order guarantees day-guide runs first.
  window.__sigcPro = {
    PESQUISAS,
    LISTA_COMMON_LABELS,
    MISSING_VALUES,
    normalizeLabel,
    detectPesquisa,
    onListaEnderecos,
    whenReady,
    whenReadyGeneric,
    tableMatchesLayout,
    getDataTable,
    readDataTable,
    getTableRows,
    exportFileBase,
    parseCoord,
    escapeHtml,
    buildCsv,
    downloadFile,
    timestampSlug,
    slug,
    WEEKDAYS_PT,
    onAgendaPage,
    findAgendaToolbarChunk,
    parseZonaEntries,
    isoToBr,
    dateToIso,
    getAgendaUf,
    readAgendaSlots,
    agendaMinScheduleDate,
    mountWidget,
    makeDtProButton,
    makeFcProButton,
  };
  console.log(`${TAG} common runtime loaded.`);
})();
