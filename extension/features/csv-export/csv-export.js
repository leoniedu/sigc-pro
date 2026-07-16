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

  // On the Lista de Endereços page (a recognized pesquisa), reuse the same
  // rich filename PDF-pro/KML-pro use (controle, selecionados/completos,
  // date) instead of the generic one — same table, same naming should
  // apply. Falls back to a generic name on any other SIGC report, since CSV
  // export has no pesquisa-specific column mapping to rely on there.
  function csvFileBase(rows) {
    const pesquisa = window.__sigcPro.detectPesquisa();
    if (pesquisa && window.__sigcPro.onListaEnderecos()) {
      try {
        return window.__sigcPro.exportFileBase(pesquisa, rows);
      } catch (e) {
        console.warn(`${TAG} Could not build Lista de Endereços filename, using generic:`, e);
      }
    }
    const { data, hora } = window.__sigcPro.timestampSlug();
    return `sigc-pro-export_${data}_${hora}`;
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

    const csv = window.__sigcPro.buildCsv(header, rows);
    window.__sigcPro.downloadFile(`${csvFileBase(rows)}.csv`, csv);
    console.log(`${TAG} CSV exported: ${rows.length} rows, ${header.length} columns.`);
  }

  function insertButton(toolbar) {
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
    btn.innerHTML = '<span>CSV<br>PRO</span>';
    btn.title = 'Exportar CSV (SIGC-PRO)';
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
