// SIGC-PRO feature: export the Lista de Endereços as KML with separate
// layers for Selecionado = Sim / Não. Adds a button next to the existing
// DataTables export buttons.
(function () {
  'use strict';

  const TAG = '[sigc-kml-export]';
  const BUTTON_ID = 'sigc-pro-kml-button';

  // Shared escaper covers XML too (it emits the numeric &#39; entity,
  // valid in both HTML and XML).
  const escapeXml = (s) => window.__sigcPro.escapeHtml(s);

  function placemark(row, cols) {
    const get = (key) => row[cols[key].index] ?? '';
    const lat = window.__sigcPro.parseCoord(get('latitude'));
    const lon = window.__sigcPro.parseCoord(get('longitude'));
    if (lat === null || lon === null) return null;

    // Short labels keep Google Earth readable: selected households show
    // their Nº Domicílio; the rest show no label (details in the balloon).
    const nDom = String(get('nDomicilio')).trim();
    const selecionado = get('selecionado') === 'Sim';
    const name = selecionado && nDom && !window.__sigcPro.MISSING_VALUES.includes(nDom) ? nDom : '';
    const fields = [
      ['Endereço', 'logradouro'],
      ['Número', 'numero'],
      ['Controle', 'controle'],
      ['ID_CNEFE', 'idCnefe'],
      ['Quadra', 'quadra'],
      ['Face', 'face'],
      ['Complemento', 'complemento'],
      ['Bairro', 'bairro'],
      ['Telefone', 'telefone'],
      ['Morador', 'morador'],
      ['Situação', 'situacao'],
    ];
    const description = fields
      .map(([label, key]) => `<b>${escapeXml(label)}:</b> ${escapeXml(get(key))}`)
      .join('<br/>');

    return [
      '      <Placemark>',
      `        <name>${escapeXml(name)}</name>`,
      `        <description><![CDATA[${description}]]></description>`,
      `        <styleUrl>#${get('selecionado') === 'Sim' ? 'sel' : 'nsel'}</styleUrl>`,
      // KML coordinate order is longitude,latitude,altitude (WGS84).
      `        <Point><coordinates>${lon},${lat},0</coordinates></Point>`,
      '      </Placemark>',
    ].join('\n');
  }

  function buildKml(pesquisa, rows) {
    const cols = pesquisa.columns;
    const selected = [];
    const notSelected = [];
    let skipped = 0;

    rows.forEach((row) => {
      const pm = placemark(row, cols);
      if (pm === null) {
        skipped += 1;
        return;
      }
      (row[cols.selecionado.index] === 'Sim' ? selected : notSelected).push(pm);
    });

    const folder = (name, marks) =>
      [`    <Folder>`, `      <name>${escapeXml(name)}</name>`, ...marks, `    </Folder>`].join('\n');

    const kml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<kml xmlns="http://www.opengis.net/kml/2.2">',
      '  <Document>',
      `    <name>Lista de Endereços — ${escapeXml(pesquisa.id)}</name>`,
      // KML colors are aabbggrr.
      // Dots instead of pushpins: centered on the coordinate and far less
      // busy in dense areas. Icons come from the standard KML palette,
      // resolved by the viewer (Google Earth).
      // Okabe-Ito colorblind-safe pair (KML colors are aabbggrr):
      // selected = vermillion #D55E00 (attention), non-selected = sky blue
      // #56B4E9 at ~70% opacity (context).
      '    <Style id="sel"><IconStyle><color>ff005ed5</color><scale>1.0</scale>' +
        '<Icon><href>https://maps.google.com/mapfiles/kml/shapes/shaded_dot.png</href></Icon>' +
        '<hotSpot x="0.5" y="0.5" xunits="fraction" yunits="fraction"/></IconStyle>' +
        '<LabelStyle><scale>0.9</scale></LabelStyle></Style>',
      '    <Style id="nsel"><IconStyle><color>b3e9b456</color><scale>0.6</scale>' +
        '<Icon><href>https://maps.google.com/mapfiles/kml/shapes/shaded_dot.png</href></Icon>' +
        '<hotSpot x="0.5" y="0.5" xunits="fraction" yunits="fraction"/></IconStyle>' +
        '<LabelStyle><scale>0</scale></LabelStyle></Style>',
      folder(`Selecionados (${selected.length})`, selected),
      folder(`Não selecionados (${notSelected.length})`, notSelected),
      '  </Document>',
      '</kml>',
      '',
    ].join('\n');

    return { kml, skipped, total: selected.length + notSelected.length };
  }

  // Reads the table directly via the DataTables API (no PDF click needed —
  // confirmed reliable under the F5 gateway; see sigc-common.js
  // getTableRows). Validated against pesquisa.columns before building.
  function exportKml(pesquisa) {
    const result = window.__sigcPro.getTableRows(pesquisa);
    if (!result) {
      alert('SIGC-PRO: não foi possível ler a tabela (não encontrada, ou layout inesperado).');
      return;
    }
    const { rows } = result;
    if (rows.length === 0) {
      alert('SIGC-PRO: a tabela está vazia.');
      return;
    }

    const { kml, skipped, total } = buildKml(pesquisa, rows);
    // No BOM: KML is XML with its own encoding declaration.
    window.__sigcPro.downloadFile(`${window.__sigcPro.exportFileBase(pesquisa, rows)}.kml`, kml,
      'application/vnd.google-earth.kml+xml', { bom: false });

    console.log(`${TAG} KML exported: ${total} placemarks, ${skipped} skipped.`);
    if (skipped > 0) {
      alert(`SIGC-PRO: ${skipped} endereço(s) sem coordenadas válidas ficaram fora do KML.`);
    }
  }

  function insertButton(pesquisa, toolbar) {
    if (document.getElementById(BUTTON_ID)) return;

    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    // Same classes as SIGC's own icon buttons (dt-btn-icon etc.) — their
    // CSS controls the exact box metrics (size, padding, vertical
    // position) that keep native buttons aligned with each other. Matching
    // pixel values by hand kept drifting; reusing the classes guarantees
    // identical alignment since it's the same rules. We only override
    // color and font to make ours read as SIGC-PRO, not layout.
    btn.className = 'dt-button buttons-html5 dt-btn-icon';
    btn.innerHTML = '<span>KML<br>PRO</span>';
    btn.title = 'Exportar KML (SIGC-PRO)';
    btn.style.background = '#005a9c';
    btn.style.borderColor = '#005a9c';
    btn.style.color = '#fff';
    btn.style.fontWeight = '700';
    btn.style.fontSize = '7px';
    btn.style.lineHeight = '1.15';
    btn.style.textAlign = 'center';
    btn.style.textTransform = 'uppercase';
    // The native icon glyph is small/fixed-size; our two-line text label is
    // wider, so the class's width: auto grows to fit it. Pin box dimensions
    // only (not display/align-items, which broke vertical alignment before)
    // to force the same square footprint as the icon buttons.
    btn.style.width = '36px';
    btn.style.minWidth = '36px';
    btn.style.maxWidth = '36px';
    btn.style.borderRadius = '4px';
    btn.addEventListener('click', () => exportKml(pesquisa));
    toolbar.appendChild(btn);

    console.log(`${TAG} KML-pro button added (${pesquisa.id}).`);
  }

  window.__sigcPro.whenReady(
    () => document.body,
    (pesquisa) => {
      // SIGC builds and rebuilds the report view via in-app navigation
      // (e.g. opening another controle), so the toolbar can appear at any
      // time and is recreated without our button. Watch the DOM and insert
      // whenever a toolbar exists without it — but only on the Lista de
      // Endereços page, since in-app navigation can leave for other SIGC
      // pages without a full reload. insertButton is idempotent and the
      // getElementById guard keeps the observer cheap.
      const tryInsert = () => {
        // O(1) button-exists check first: it neutralizes the steady-state
        // cost of this tick, which otherwise scans every <h6> per mutation.
        if (document.getElementById(BUTTON_ID)) return;
        if (!window.__sigcPro.onListaEnderecos()) return;
        const toolbar = document.querySelector('.dt-buttons');
        if (toolbar) insertButton(pesquisa, toolbar);
      };
      tryInsert();
      new MutationObserver(tryInsert).observe(document.body, {
        childList: true,
        subtree: true,
      });
    }
  );
})();
