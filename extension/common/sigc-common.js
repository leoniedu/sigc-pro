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
    // Cell data may contain HTML; reduce to text.
    const div = document.createElement('div');
    div.innerHTML = String(v ?? '');
    return (div.textContent || '').trim();
  }

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

  // Shared export filename (no extension) built from the ORIGINAL pdfmake
  // table body: lista-enderecos-<pesquisa>_<controle>_<tipo>_<data>.
  // tipo = "selecionados" when every row has Selecionado = Sim (the report
  // was requested filtered), otherwise "completos".
  function exportFileBase(pesquisa, body) {
    const cols = pesquisa.columns;
    const rows = body.slice(1);
    const val = (r, i) => (r[i] && r[i].text != null ? String(r[i].text).trim() : '');

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
    tableMatchesLayout,
    exportFileBase,
    parseCoord,
    // Set by kml-export before it programmatically clicks the native PDF
    // button; consumed (and cleared) by the pdf-export hook, which passes the
    // ORIGINAL pdfmake table body to it and then lets the PDF proceed
    // normally — one click yields both the (tweaked) PDF and the KML.
    kmlOnNextPdf: null,
  };
  console.log(`${TAG} common runtime loaded.`);
})();
