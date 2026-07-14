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
    const s = cellText(v).replace(',', '.');
    if (s === '' || window.__sigcPro.MISSING_VALUES.includes(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  // Returns { header: string[], rows: string[][], source: 'api'|'dom' } or null.
  function readTable() {
    const tableEl = document.querySelector('table.dataTable');
    const jq = window.jQuery || window.$;

    if (
      tableEl &&
      jq &&
      jq.fn &&
      jq.fn.dataTable &&
      jq.fn.dataTable.isDataTable(tableEl)
    ) {
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

    if (tableEl) {
      console.warn(`${TAG} DataTables API unavailable — falling back to DOM (visible page only).`);
      const header = [...tableEl.querySelectorAll('thead th')].map((th) =>
        (th.textContent || '').trim()
      );
      const rows = [...tableEl.querySelectorAll('tbody tr')].map((tr) =>
        [...tr.querySelectorAll('td')].map((td) => (td.textContent || '').trim())
      );
      return { header, rows, source: 'dom' };
    }

    return null;
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

  function exportKml(pesquisa) {
    const data = readTable();
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
    btn.addEventListener('click', () => exportKml(pesquisa));
    toolbar.appendChild(btn);

    console.log(`${TAG} KML button added (${pesquisa.id}).`);
  }

  window.__sigcPro.whenReady(
    () => document.querySelector('.dt-buttons'),
    insertButton
  );
})();
