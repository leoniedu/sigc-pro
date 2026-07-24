// SIGC-PRO feature: Último Movimento multi-agência CSV export. One of two
// files in this extension allowed to make network requests (the other is
// agenda-map/) — see scripts/check-privacy.sh. Gated behind the
// "ultimoMovimentoExport" advanced flag (off by default): loops every
// agência in the current UF, fetching /UltimoMovimento/Filtrar per
// agência (same payload shape as the standalone ultimo_movimento.py
// script this feature replaces), and downloads one combined CSV.
// Spec: docs/superpowers/specs/2026-07-24-ultimo-movimento-multi-agencia-export-design.md
(function () {
  'use strict';

  const TAG = '[sigc-ultimo-movimento-export]';
  const BUTTON_ID = 'sigc-pro-ultimo-movimento-export-button';
  const TABLE_ID = 'tb_ultimo_movimento';
  const REQUEST_DELAY_MS = 2000;

  // --- pure helpers ----------------------------------------------------

  // True on the Último Movimento report page: the table (once loaded) or
  // its container/filter form (before the user has filtered anything)
  // both use this id — SIGC renders the empty table shell up front.
  function onUltimoMovimento() {
    return !!document.getElementById(TABLE_ID);
  }

  // Mirrors ultimo_movimento.py's fetch_report_html filtro payload
  // exactly (IdFiltro left blank there too — confirmed against the
  // working script, not a placeholder).
  function buildAgenciaFilterBody(uf, agencia) {
    const filtro = {
      IdFiltro: '',
      IdUf: String(uf),
      IdAgencia: String(agencia),
      IdMunicipio: '*',
      Controle: '*',
      IdEntrevistadores: '*',
      IdTipoAcompanhamento: '*',
    };
    return 'filtro=' + encodeURIComponent(JSON.stringify(filtro));
  }

  // HTML fragment -> {header, rows} | null. DOMParser is inert — nothing
  // in the fetched markup can load resources or run handlers, same
  // guarantee agenda-map's parser relies on.
  function parseUltimoMovimentoHtml(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const table = doc.getElementById(TABLE_ID);
    if (!table) return null;
    const header = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    const rows = [...table.querySelectorAll('tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()));
    return { header, rows };
  }

  // Exposed only for tests — not part of the extension's runtime public
  // surface (window.__sigcPro), since these are internal to this one
  // feature and no other feature needs them.
  window.__sigcProUltimoMovimentoExportInternals = {
    onUltimoMovimento,
    buildAgenciaFilterBody,
    parseUltimoMovimentoHtml,
  };

  console.log(`${TAG} loaded.`);
})();
