// SIGC-PRO feature: export the Lista de Endereços as KML with separate
// layers for Selecionado = Sim / Não. Adds a button next to the existing
// DataTables export buttons.
(function () {
  'use strict';

  const TAG = '[sigc-kml-export]';
  const BUTTON_ID = 'sigc-pro-kml-button';

  function escapeXml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function cellText(v) {
    // DataTables cell data may contain HTML; reduce to text.
    const div = document.createElement('div');
    div.innerHTML = String(v ?? '');
    return (div.textContent || '').trim();
  }

  function parseCoord(v) {
    const s = cellText(v);
    if (s === '' || window.__sigcPro.MISSING_VALUES.includes(s)) return null;

    // SIGC shows DMS: "dd mm ss.sss S" (also tolerates °'" marks; hemisphere
    // N/S/E/W, plus O = Oeste). Decimal seconds may use comma.
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

  // Returns { header: string[], rows: string[][], source: 'api'|'dom' } or null.
  // Scoped to the toolbar's own .dataTables_wrapper so the button always acts
  // on its table. In DataTables scroll mode the wrapper holds header/body
  // CLONES of the table; only the original is registered with the API, so we
  // pick tables by isDataTable() instead of the .dataTable class.
  function readTable(toolbar) {
    const scope = (toolbar && toolbar.closest('.dataTables_wrapper')) || document;
    const jq = window.jQuery || window.$;

    if (jq && jq.fn && jq.fn.dataTable) {
      const tableEl = [...scope.querySelectorAll('table')].find((t) =>
        jq.fn.dataTable.isDataTable(t)
      );
      if (tableEl) {
        const dt = jq(tableEl).DataTable();
        const header = dt
          .columns()
          .header()
          .toArray()
          .map((h) => (h.textContent || '').trim());
        const rows = dt
          .rows({ search: 'applied' })
          .data()
          .toArray()
          .map((r) => Array.from(r).map(cellText));
        return { header, rows, source: 'api' };
      }
    }

    // DOM fallback. Scroll mode splits the table into clones, so don't trust
    // any single element: take headers from whichever table has non-empty
    // thead text, and rows from whichever has the most tbody rows.
    let tables = [...scope.querySelectorAll('table')];
    if (tables.length === 0 && scope !== document) tables = [...document.querySelectorAll('table')];
    if (tables.length === 0) return null;

    console.warn(`${TAG} DataTables API unavailable — falling back to DOM (visible page only).`);
    console.warn(
      `${TAG} diagnostics:`,
      JSON.stringify({
        jquery: !!(window.jQuery || window.$),
        dtPlugin: !!(jq && jq.fn && jq.fn.dataTable),
        tablesInScope: tables.length,
        perTable: tables.map((t) => ({
          cls: t.className,
          ths: t.querySelectorAll('thead th').length,
          rows: t.querySelectorAll('tbody tr').length,
        })),
      })
    );

    const headEl = tables.find((t) =>
      [...t.querySelectorAll('thead th')].some((th) => (th.textContent || '').trim())
    );
    const bodyEl = tables.reduce(
      (best, t) =>
        t.querySelectorAll('tbody tr').length >
        (best ? best.querySelectorAll('tbody tr').length : 0)
          ? t
          : best,
      null
    );
    if (!headEl || !bodyEl) return null;

    const header = [...headEl.querySelectorAll('thead th')].map((th) =>
      (th.textContent || '').trim()
    );
    const rows = [...bodyEl.querySelectorAll('tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => (td.textContent || '').trim())
    );
    return { header, rows, source: 'dom' };
  }

  function placemark(row, cols) {
    const get = (key) => row[cols[key].index] ?? '';
    const lat = parseCoord(get('latitude'));
    const lon = parseCoord(get('longitude'));
    if (lat === null || lon === null) return null;

    const name = `Dom. ${get('nDomicilio')} — ${get('logradouro')}, ${get('numero')}`;
    const fields = [
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
      '    <Style id="sel"><IconStyle><color>ff00b400</color></IconStyle></Style>',
      '    <Style id="nsel"><IconStyle><color>ff2222dd</color></IconStyle></Style>',
      folder(`Selecionados (${selected.length})`, selected),
      folder(`Não selecionados (${notSelected.length})`, notSelected),
      '  </Document>',
      '</kml>',
      '',
    ].join('\n');

    return { kml, skipped, total: selected.length + notSelected.length };
  }

  function download(filename, text) {
    const blob = new Blob([text], { type: 'application/vnd.google-earth.kml+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function exportKml(pesquisa, toolbar) {
    const data = readTable(toolbar);
    if (!data) {
      alert('SIGC-PRO: tabela de endereços não encontrada nesta página.');
      return;
    }
    if (!window.__sigcPro.tableMatchesLayout(data.header, pesquisa.columns)) {
      console.warn(`${TAG} Table header doesn't match the ${pesquisa.id} layout — aborting.`);
      alert('SIGC-PRO: o layout da tabela não corresponde ao esperado; exportação KML cancelada.');
      return;
    }

    const { kml, skipped, total } = buildKml(pesquisa, data.rows);
    download(`lista-enderecos-${pesquisa.id.toLowerCase()}.kml`, kml);

    console.log(`${TAG} KML exported: ${total} placemarks, ${skipped} skipped (source: ${data.source}).`);
    if (skipped > 0) {
      alert(`SIGC-PRO: ${skipped} endereço(s) sem coordenadas válidas ficaram fora do KML.`);
    }
  }

  function insertButton(pesquisa, toolbar) {
    if (document.getElementById(BUTTON_ID)) return;

    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    const sibling = toolbar.querySelector('button');
    btn.className = sibling ? sibling.className : 'dt-button';
    btn.innerHTML = '<span>KML</span>';
    btn.title = 'Exportar KML (SIGC-PRO)';
    // Match the sibling export buttons' shape (via the copied class) but in
    // SIGC-PRO blue, so it reads as an add-on rather than a native button.
    btn.style.background = '#005a9c';
    btn.style.borderColor = '#005a9c';
    btn.style.color = '#fff';
    btn.style.fontWeight = '600';
    btn.addEventListener('click', () => exportKml(pesquisa, toolbar));
    toolbar.appendChild(btn);

    console.log(`${TAG} KML button added (${pesquisa.id}).`);
  }

  window.__sigcPro.whenReady(
    () => document.querySelector('.dt-buttons'),
    insertButton
  );
})();
