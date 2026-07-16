// SIGC-PRO shared runtime: pesquisa registry, page detection, poll loop,
// and table-layout validation. Loaded before all feature scripts (MAIN world).
(function () {
  'use strict';

  if (window.__sigcPro) return;

  const TAG = '[sigc-pro]';

  // One entry per pesquisa. `columns` describes the Lista de Endereços table
  // (0-based, left to right); `label` is the expected header text — features
  // refuse to act when labels don't match, so a SIGC layout change can't
  // silently shift data into the wrong column.
  const PESQUISAS = {
    PNS2026: {
      titlePattern: /SIGC\s*-\s*PNS2026/i,
      columns: {
        controle:      { index: 0,  label: 'Controle' },
        idCnefe:       { index: 1,  label: 'ID_CNEFE' },
        nDomicilio:    { index: 2,  label: 'N.º Domicilio' },
        quadra:        { index: 3,  label: 'Quadra' },
        face:          { index: 4,  label: 'Face' },
        logradouro:    { index: 5,  label: 'Logradouro' },
        numero:        { index: 6,  label: 'Número' },
        complemento:   { index: 7,  label: 'Complemento' },
        bairro:        { index: 8,  label: 'Bairro' },
        latitude:      { index: 9,  label: 'Latitude' },
        longitude:     { index: 10, label: 'Longitude' },
        telefone:      { index: 11, label: 'Telefone' },
        morador:       { index: 12, label: 'Morador' },
        situacao:      { index: 13, label: 'Situação' },
        selecionado:   { index: 14, label: 'Selecionado' },
        antropometria: { index: 15, label: 'Antropometria' },
        biomarcadores: { index: 16, label: 'Biomarcadores' },
        idZona:        { index: 17, label: 'ID Zona' },
        nomeZona:      { index: 18, label: 'Nome ZONA' },
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

  // Shared CSV building/download — used by csv-export and
  // agenda-csv-export (and any future CSV feature) so escaping, delimiter,
  // and BOM rules live in one place instead of being copy-pasted per file.
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

  function downloadFile(filename, text, mimeType) {
    // UTF-8 BOM so Excel doesn't mangle accented characters.
    const blob = new Blob(['﻿' + text], { type: mimeType || 'text/csv;charset=utf-8' });
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

  function isoToBr(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso || '');
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

  window.__sigcPro = {
    PESQUISAS,
    MISSING_VALUES,
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
    cellText,
    escapeCsvField,
    buildCsv,
    downloadFile,
    timestampSlug,
    slug,
    WEEKDAYS_PT,
    onAgendaPage,
    findAgendaToolbarChunk,
    parseAgendaSlotTitle,
    isoToBr,
    dateToIso,
    getAgendaEquipeNames,
    readAgendaSlots,
    agendaMinScheduleDate,
    // Set by pdf-export's own PDF-pro button before it programmatically
    // clicks the native PDF button; consumed (and cleared) by the pdfMake
    // hook, which rewrites the doc into listagem style only when this is
    // true. KML-pro/CSV-pro no longer ride the PDF click — they read table
    // data directly via getTableRows — so this flag is PDF-only now.
    pdfRebuildOnNext: false,
  };
  console.log(`${TAG} common runtime loaded.`);
})();
