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

  // Generic: mounts wherever a DataTables Buttons toolbar and a live
  // DataTable both exist, on ANY SIGC report — not limited to Lista de
  // Endereços or a recognized pesquisa, since CSV export is
  // schema-agnostic. The shared observer replaces the old 200 ms poll:
  // the toolbar appearing IS a DOM mutation.
  window.__sigcPro.mountWidget({
    id: BUTTON_ID,
    anchor: (ctx) => ctx.dtToolbar(),
    when: () => !!window.__sigcPro.getDataTable(),
    build: () => {
      console.log(`${TAG} CSV-pro button added.`);
      return window.__sigcPro.makeDtProButton({
        id: BUTTON_ID,
        lines: ['CSV', 'PRO'],
        title: 'Exportar CSV (SIGC-PRO)',
        onClick: exportCsv,
      });
    },
  });
})();
