// SIGC-PRO feature: Último Movimento multi-agência CSV export. One of two
// files in this extension allowed to make network requests (the other is
// agenda-map/) — see scripts/check-privacy.sh. Gated behind the
// "ultimoMovimentoExport" advanced flag (off by default): loops every
// agência in the current UF, fetching /relatorio/filtrar?slug=relatorio-
// ultimo-movimento per agência (same report SIGC's own UI hits; the
// standalone ultimo_movimento.py script this feature replaces predates
// this endpoint's 2026-08-07 migration), and downloads one combined CSV.
// Spec: docs/superpowers/specs/2026-07-24-ultimo-movimento-multi-agencia-export-design.md
(function () {
  'use strict';

  const TAG = '[sigc-ultimo-movimento-export]';
  const BUTTON_ID = 'sigc-pro-ultimo-movimento-export-button';
  const TABLE_ID = 'tableRelatorio';
  const REQUEST_DELAY_MS = 2000;

  // --- pure helpers ----------------------------------------------------

  // True on the Último Movimento report page, detected via the page
  // header's h6 title — same approach sigc-common's onListaEnderecos()
  // uses for its own page, including its accent-stripping (tolerates
  // SIGC ever rendering the title without the accent). Must be true
  // BEFORE the user clicks Filtrar (the button needs to appear right
  // away, next to Filtrar itself), so it can't depend on the results
  // table (#tableRelatorio), which only renders after a filter is
  // applied — confirmed against the live page.
  //
  // Checks for the phrase ANYWHERE in the h6 text (not strict equality):
  // the live page's h6 reads "Relatório Último Movimento", not the bare
  // "Último Movimento" this originally matched exactly — an equality
  // check against the live header silently never fires, hiding every
  // button anchored on this function (confirmed 2026-08-09, this
  // silently broke both the Mapa button and the ultimoMovimentoExport
  // flag's CSV TODAS button).
  function onUltimoMovimento() {
    return [...document.querySelectorAll('h6')].some(
      (h) => window.__sigcPro.normalizeLabel(h.textContent).replace(/[íú]/g, (c) => (c === 'í' ? 'i' : 'u'))
        .includes('ultimo movimento')
    );
  }

  // Mirrors ultimo_movimento.py's fetch_report_html filtro payload,
  // updated 2026-08-07 to match SIGC's move of this report onto the
  // generic /relatorio/filtrar?slug=relatorio-ultimo-movimento endpoint
  // (IdFiltro used to be blank when this hit its own dedicated
  // endpoint — confirmed against a live capture of the new shape).
  function buildAgenciaFilterBody(uf, agencia) {
    const filtro = {
      IdFiltro: 'relatorio-ultimo-movimento',
      IdUf: String(uf),
      IdAgencia: String(agencia),
      IdMunicipio: '*',
      Controle: '*',
      IdEntrevistadores: '*',
      IdTipoAcompanhamento: '*',
    };
    return 'filtro=' + encodeURIComponent(JSON.stringify(filtro));
  }

  // As of 2026-08-07, Último Movimento moved onto the same generic
  // /relatorio/filtrar?slug=... mechanism Lista de Endereços already
  // used (agenda-map.js has its own equivalent, filtrarUrl — this is a
  // deliberate small local duplicate, not shared: these two files have
  // no cross-file dependency by design, see this file's header
  // comment). simple=true: plain prefixed path. simple=false: the
  // fuller captured shape with a doubled /relatorio segment before
  // /f5-h-$$.
  function relatorioFiltrarUrl(origin, pathname, simple) {
    const f5 = window.__sigcPro.f5Prefix(pathname);
    const slug = 'relatorio-ultimo-movimento';
    if (!f5) return `${origin}/relatorio/filtrar?slug=${slug}`;
    return simple
      ? `${origin}${f5.prefix}/relatorio/filtrar?slug=${slug}`
      : `${origin}${f5.prefix}/relatorio/f5-h-$$/relatorio/filtrar?slug=${slug};F5_origin=${f5.hex}&F5CH=I`;
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

  // --- UF / agência-list reading ---------------------------------------

  // Último Movimento's own filter form has a UF <select id="IdUf">,
  // dressed up as a select2 combobox (the visible "29 - BAHIA" text is a
  // select2-rendered span, not the real element) — confirmed against the
  // live page. select2 keeps the original <select> in the DOM (just
  // visually hidden), so reading its .value directly still works.
  function getCurrentUf() {
    const s = document.getElementById('IdUf');
    return s ? s.value : '';
  }

  // Mirrors ultimo_movimento.py's get_agencias(): CarregarAgencias
  // returns {items: [{key, description}, ...]}; entries with a blank key
  // are placeholder options, dropped same as the script drops them.
  async function fetchAgenciaList(uf) {
    const res = await window.__sigcPro.fetchViaGateway(
      `/Filtro/CarregarAgencias?IdUf=${encodeURIComponent(uf)}`,
      { method: 'GET', credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } },
    );
    const data = await res.json();
    const items = (data && data.items) || [];
    return items.filter((it) => it && it.key && String(it.key).trim());
  }

  async function fetchAgenciaReport(uf, agencia) {
    const urls = [...new Set([
      relatorioFiltrarUrl(location.origin, location.pathname, true),
      relatorioFiltrarUrl(location.origin, location.pathname, false),
    ])];
    let lastErr = new Error('sem resposta');
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: buildAgenciaFilterBody(uf, agencia),
        });
        if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); continue; }
        return parseUltimoMovimentoHtml(await res.text());
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Sequential, REQUEST_DELAY_MS apart, one agência at a time — matches
  // ultimo_movimento.py's --delay default and keeps the request pattern
  // as far as possible from anything that could look like abuse of
  // SIGC's own infrastructure. A failed agência is logged and skipped,
  // never fatal to the run (mirrors the script's try/except + continue).
  // Returns { header, rows, failed } — rows are already tagged with
  // IdUf/IdAgencia/AgenciaDescricao, in that column order, matching the
  // script's df.insert(0/1/2, ...) order.
  async function collectAllAgencias(uf, agenciaList, onProgress) {
    let header = null;
    const rows = [];
    const failed = [];
    for (let i = 0; i < agenciaList.length; i += 1) {
      const { key: code, description = '' } = agenciaList[i];
      onProgress(i + 1, agenciaList.length);
      try {
        const result = await fetchAgenciaReport(uf, code);
        if (result && result.rows.length > 0) {
          if (!header) header = ['IdUf', 'IdAgencia', 'AgenciaDescricao', ...result.header];
          result.rows.forEach((r) => rows.push([uf, code, description, ...r]));
        }
      } catch (err) {
        console.warn(`${TAG} agência ${code} (${description}) failed:`, err);
        failed.push(`${code} (${description})`);
      }
      if (i < agenciaList.length - 1) await sleep(REQUEST_DELAY_MS);
    }
    return { header, rows, failed };
  }

  // --- UI ----------------------------------------------------------------

  const CONSENT_MSG =
    'SIGC-PRO: isto buscará o relatório Último Movimento de TODAS as ' +
    'agências da UF atual, uma de cada vez (pode levar alguns minutos). ' +
    'Cada requisição vai apenas ao próprio servidor do SIGC. Continuar?';

  async function exportAllAgencias(btn) {
    if (!confirm(CONSENT_MSG)) return;
    const uf = getCurrentUf();
    if (!uf) {
      alert('SIGC-PRO: não foi possível identificar a UF atual.');
      return;
    }

    btn.disabled = true;
    const originalLabel = btn.textContent;
    try {
      let agenciaList;
      try {
        agenciaList = await fetchAgenciaList(uf);
      } catch (err) {
        alert(`SIGC-PRO: não foi possível obter a lista de agências (${err && err.message}).`);
        return;
      }
      if (agenciaList.length === 0) {
        alert('SIGC-PRO: nenhuma agência encontrada para esta UF.');
        return;
      }

      const { header, rows, failed } = await collectAllAgencias(uf, agenciaList, (done, total) => {
        btn.textContent = `${done}/${total}`;
      });

      if (rows.length === 0) {
        alert('SIGC-PRO: nenhum dado coletado — nada para exportar.');
        return;
      }

      const csv = window.__sigcPro.buildCsv(header, rows);
      const { data, hora } = window.__sigcPro.timestampSlug();
      window.__sigcPro.downloadFile(`sigc-pro-ultimo-movimento_uf${uf}_${data}_${hora}.csv`, csv);
      console.log(`${TAG} exported ${rows.length} rows from ${agenciaList.length - failed.length}/${agenciaList.length} agências.`);

      if (failed.length > 0) {
        alert(`SIGC-PRO: exportação concluída com ${failed.length} agência(s) que falharam:\n${failed.join('\n')}`);
      }
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  }

  // Anchored to the Filtrar button itself (not the DataTables toolbar,
  // which only exists after a first Filtrar click) so the button is
  // visible immediately alongside Cancelar/Filtrar, matching their
  // styling — not the small DataTables icon-button style used by the
  // rest of the extension's report-table exports.
  window.__sigcPro.mountWidget({
    id: BUTTON_ID,
    anchor: (ctx) => ctx.ultimoMovimentoFiltrarBtn(),
    insert: 'after',
    when: () => onUltimoMovimento() &&
      window.__sigcPro.settings.isEnabled('ultimoMovimentoExport'),
    build: () => {
      console.log(`${TAG} multi-agência export button added.`);
      const btn = window.__sigcPro.makeSigcFormButton({
        id: BUTTON_ID,
        text: 'CSV TODAS',
        title: 'Exportar Último Movimento de todas as agências (SIGC-PRO, avançado)',
        onClick: () => exportAllAgencias(btn),
        small: true,
      });
      return btn;
    },
  });

  // Exposed only for tests — not part of the extension's runtime public
  // surface (window.__sigcPro), since these are internal to this one
  // feature and no other feature needs them.
  window.__sigcProUltimoMovimentoExportInternals = {
    onUltimoMovimento,
    buildAgenciaFilterBody,
    parseUltimoMovimentoHtml,
    getCurrentUf,
    relatorioFiltrarUrl,
  };

  // Exposed only for tests — collectAllAgencias is the row-tagging logic
  // the design's testing section calls out explicitly; everything else
  // in this block (fetchAgenciaList/fetchAgenciaReport/exportAllAgencias)
  // needs a live authenticated session and stays manually verified only
  // (Task 6), same as agenda-map's postFiltrar/fetchEnderecos today.
  window.__sigcProUltimoMovimentoExportInternals.collectAllAgencias = collectAllAgencias;

  console.log(`${TAG} loaded.`);
})();
