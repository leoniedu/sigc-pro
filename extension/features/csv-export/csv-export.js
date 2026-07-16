// SIGC-PRO feature: CSV export via the DataTables JS API, working around a
// portalweb bug where the native CSV/Excel buttons throw off-VPN (F5's
// bot-defense script breaks window.MouseEvent globally; DataTables' html5
// export uses it to trigger the download — confirmed to also break
// DataTables' own button().trigger() API, so no client-side workaround can
// call the native export path directly). The native buttons work over VPN
// and may start working generally once IBGE fixes it, so they're left as-is
// — this just adds an independent CSV-pro button alongside them.
//
// Unlike kml-export/pdf-export, this is schema-agnostic and NOT limited to
// the Lista de Endereços report: it exports whatever columns/rows the
// current page's DataTable has, so it's reusable across any SIGC report.
(function () {
  'use strict';

  const TAG = '[sigc-csv-export]';
  const BUTTON_ID = 'sigc-pro-csv-button';

  function escapeCsvField(s) {
    const v = String(s ?? '');
    return /[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }

  // pt-BR Excel expects `;`-delimited CSV (comma is the decimal separator
  // in that locale, so comma-delimited CSVs misparse on import).
  function buildCsv(header, rows) {
    const lines = [header, ...rows].map((r) => r.map(escapeCsvField).join(';'));
    return lines.join('\r\n') + '\r\n';
  }

  function download(filename, text) {
    // UTF-8 BOM so Excel doesn't mangle accented characters.
    const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function exportCsv() {
    const result = window.__sigcPro.readDataTable();
    if (!result) {
      alert('SIGC-PRO: tabela não encontrada — a exportação CSV depende dela.');
      return;
    }
    const { header, rows } = result;
    if (rows.length === 0) {
      alert('SIGC-PRO: a tabela está vazia.');
      return;
    }

    const csv = buildCsv(header, rows);
    const data = new Date().toISOString().slice(0, 10);
    const hora = new Date().toTimeString().slice(0, 8).replace(/:/g, '');
    download(`sigc-pro-export_${data}_${hora}.csv`, csv);
    console.log(`${TAG} CSV exported: ${rows.length} rows, ${header.length} columns.`);
  }

  function insertButton(toolbar) {
    if (document.getElementById(BUTTON_ID)) return;

    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    const sibling = toolbar.querySelector('button');
    btn.className = sibling ? sibling.className : 'dt-button';
    btn.innerHTML = '<span>CSV-pro</span>';
    btn.title = 'Exportar CSV (SIGC-PRO)';
    btn.style.background = '#005a9c';
    btn.style.borderColor = '#005a9c';
    btn.style.color = '#fff';
    btn.style.fontWeight = '600';
    btn.style.fontSize = '0.65em';
    btn.addEventListener('click', exportCsv);
    toolbar.appendChild(btn);

    console.log(`${TAG} CSV-pro button added.`);
  }

  // Generic gate: activates wherever a DataTables Buttons toolbar and a live
  // DataTable both exist, on ANY SIGC report — not limited to Lista de
  // Endereços or a recognized pesquisa, since CSV export is schema-agnostic.
  window.__sigcPro.whenReadyGeneric(
    () => document.querySelector('.dt-buttons') && window.__sigcPro.getDataTable(),
    () => {
      const tryInsert = () => {
        if (document.getElementById(BUTTON_ID)) return;
        const toolbar = document.querySelector('.dt-buttons');
        if (toolbar && window.__sigcPro.getDataTable()) insertButton(toolbar);
      };
      tryInsert();
      new MutationObserver(tryInsert).observe(document.body, {
        childList: true,
        subtree: true,
      });
    }
  );
})();
