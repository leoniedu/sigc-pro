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
      pdf: {
        customTitle: 'Lista de Endereços — PNS 2026',
        columnsToKeep: [1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 14],
        columnsToHeader: [0, 16, 18], // Controle, Biomarcadores, Nome ZONA
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

  // Fires callback(pesquisa, prereq) once, when a pesquisa matches AND
  // prereqFn() is truthy. Silent give-up after ~10 s keeps the extension
  // inert on non-SIGC IBGE pages.
  function whenReady(prereqFn, callback) {
    let attempts = 0;
    const tick = () => {
      const pesquisa = detectPesquisa();
      const prereq = pesquisa ? prereqFn() : null;
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

  function labelForIndex(columns, index) {
    const entry = Object.values(columns).find((c) => c.index === index);
    return entry ? entry.label : null;
  }

  window.__sigcPro = {
    PESQUISAS,
    MISSING_VALUES,
    detectPesquisa,
    whenReady,
    tableMatchesLayout,
    labelForIndex,
  };
  console.log(`${TAG} common runtime loaded.`);
})();
