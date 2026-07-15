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

  // Finds the native PDF export button in the same toolbar as the KML button.
  function findPdfButton(toolbar) {
    return (
      toolbar.querySelector('.buttons-pdf') ||
      [...toolbar.querySelectorAll('button')].find(
        (b) => b.id !== BUTTON_ID && /pdf/i.test(`${b.className} ${b.textContent}`)
      ) ||
      null
    );
  }

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
        '<Icon><href>http://maps.google.com/mapfiles/kml/shapes/shaded_dot.png</href></Icon>' +
        '<hotSpot x="0.5" y="0.5" xunits="fraction" yunits="fraction"/></IconStyle>' +
        '<LabelStyle><scale>0.9</scale></LabelStyle></Style>',
      '    <Style id="nsel"><IconStyle><color>b3e9b456</color><scale>0.6</scale>' +
        '<Icon><href>http://maps.google.com/mapfiles/kml/shapes/shaded_dot.png</href></Icon>' +
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

  // One click, two files: triggers the native PDF export (which our
  // pdf-export hook tweaks as usual) and also receives the ORIGINAL pdfmake
  // table body from that hook to build the KML.
  function exportKml(pesquisa, toolbar) {
    const pdfBtn = findPdfButton(toolbar);
    if (!pdfBtn) {
      alert('SIGC-PRO: botão de PDF não encontrado — a exportação PDF+KML depende dele.');
      return;
    }
    if (!(window.pdfMake && window.pdfMake.__sigcProPdfTweak)) {
      alert('SIGC-PRO: componente de PDF ainda não carregou; tente novamente em alguns segundos.');
      return;
    }
    if (window.__sigcPro.kmlOnNextPdf) return; // export already in flight

    const timeout = setTimeout(() => {
      if (window.__sigcPro.kmlOnNextPdf) {
        window.__sigcPro.kmlOnNextPdf = null;
        console.warn(`${TAG} Timed out — PDF button click produced no pdfMake call.`);
        alert('SIGC-PRO: não foi possível gerar o KML (a exportação de PDF não respondeu).');
      }
    }, 8000);

    window.__sigcPro.kmlOnNextPdf = (body) => {
      clearTimeout(timeout);
      if (!body || body.length < 2) {
        alert('SIGC-PRO: a tabela está vazia ou não pôde ser lida.');
        return;
      }
      const asText = (c) => (c && c.text != null ? String(c.text).trim() : '');
      const header = body[0].map(asText);
      if (!window.__sigcPro.tableMatchesLayout(header, pesquisa.columns)) {
        alert('SIGC-PRO: o layout da tabela não corresponde ao esperado; exportação KML cancelada.');
        return;
      }
      const rows = body.slice(1).map((r) => r.map(asText));

      const { kml, skipped, total } = buildKml(pesquisa, rows);
      download(`${window.__sigcPro.exportFileBase(pesquisa, body)}.kml`, kml);

      console.log(`${TAG} KML exported: ${total} placemarks, ${skipped} skipped (source: pdf-capture).`);
      if (skipped > 0) {
        alert(`SIGC-PRO: ${skipped} endereço(s) sem coordenadas válidas ficaram fora do KML.`);
      }
    };

    pdfBtn.click();
  }

  function insertButton(pesquisa, toolbar) {
    if (document.getElementById(BUTTON_ID)) return;

    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    const sibling = toolbar.querySelector('button');
    btn.className = sibling ? sibling.className : 'dt-button';
    btn.innerHTML = '<span>PDF+KML</span>';
    btn.title = 'Exportar PDF e KML (SIGC-PRO)';
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
    () => document.body,
    (pesquisa) => {
      // SIGC builds and rebuilds the report view via in-app navigation
      // (e.g. opening another controle), so the toolbar can appear at any
      // time and is recreated without our button. Watch the DOM and insert
      // whenever a toolbar exists without it. insertButton is idempotent
      // and the getElementById guard keeps the observer cheap.
      const tryInsert = () => {
        if (document.getElementById(BUTTON_ID)) return;
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
