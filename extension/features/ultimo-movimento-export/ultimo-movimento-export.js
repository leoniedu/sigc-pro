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

  // True on the Último Movimento report page, detected via the page
  // header's h6 title — same approach sigc-common's onListaEnderecos()
  // uses for its own page, including its accent-stripping (tolerates
  // SIGC ever rendering the title without the accent). Must be true
  // BEFORE the user clicks Filtrar (the button needs to appear right
  // away, next to Filtrar itself), so it can't depend on the results
  // table (#tb_ultimo_movimento), which only renders after a filter is
  // applied — confirmed against the live page.
  function onUltimoMovimento() {
    return [...document.querySelectorAll('h6')].some(
      (h) => window.__sigcPro.normalizeLabel(h.textContent).replace(/[íú]/g, (c) => (c === 'í' ? 'i' : 'u')) ===
        'ultimo movimento'
    );
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

  // --- F5 gateway URL handling ------------------------------------------
  // portalweb sits behind an F5 BIG-IP proxy that rewrites every path to
  // "/f5-w-<hex>$$/<original path>" (the hex is the real backend origin,
  // hex-encoded) when accessed off-VPN — confirmed live: a plain
  // location.origin + path request fails outright ("Failed to fetch",
  // not even an HTTP error) because it bypasses the gateway's rewriting.
  // Same mechanism agenda-map.js already solved for a different endpoint
  // (see its f5Prefix/filtrarUrl); duplicated here in parametrized form
  // (arbitrary path, not just one) since this feature calls two different
  // endpoints. On the direct host (e.g. via VPN), f5Prefix returns null
  // and the plain path is used, matching agenda-map's fallback.
  function f5Prefix(pathname) {
    const m = /^\/f5-w-([0-9a-f]+)\$\$/.exec(String(pathname || ''));
    return m ? { prefix: m[0], hex: m[1] } : null;
  }

  // simple=true: plain prefixed path. simple=false: replicate the fuller
  // shape captured from the live gateway (f5-h-$$ segment + F5_origin/
  // F5CH params), same fallback agenda-map's postFiltrar tries second.
  function gatewayUrl(origin, pathname, path, simple) {
    const f5 = f5Prefix(pathname);
    if (!f5) return `${origin}${path}`;
    return simple
      ? `${origin}${f5.prefix}${path}`
      : `${origin}${f5.prefix}/f5-h-$$${path};F5_origin=${f5.hex}&F5CH=I`;
  }

  // Tries the simple prefixed URL first, then the full captured F5 form —
  // same two-attempt strategy as agenda-map's postFiltrar, since which
  // form the live gateway actually needs isn't knowable in advance.
  async function fetchViaGateway(path, options) {
    const urls = [...new Set([
      gatewayUrl(location.origin, location.pathname, path, true),
      gatewayUrl(location.origin, location.pathname, path, false),
    ])];
    let lastErr = new Error('sem resposta');
    for (const url of urls) {
      try {
        const res = await fetch(url, options);
        if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); continue; }
        return res;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
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
    const res = await fetchViaGateway(
      `/Filtro/CarregarAgencias?IdUf=${encodeURIComponent(uf)}`,
      { method: 'GET', credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } },
    );
    const data = await res.json();
    const items = (data && data.items) || [];
    return items.filter((it) => it && it.key && String(it.key).trim());
  }

  async function fetchAgenciaReport(uf, agencia) {
    const res = await fetchViaGateway('/UltimoMovimento/Filtrar', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: buildAgenciaFilterBody(uf, agencia),
    });
    return parseUltimoMovimentoHtml(await res.text());
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
    f5Prefix,
    gatewayUrl,
  };

  // Exposed only for tests — collectAllAgencias is the row-tagging logic
  // the design's testing section calls out explicitly; everything else
  // in this block (fetchAgenciaList/fetchAgenciaReport/exportAllAgencias)
  // needs a live authenticated session and stays manually verified only
  // (Task 6), same as agenda-map's postFiltrar/fetchEnderecos today.
  window.__sigcProUltimoMovimentoExportInternals.collectAllAgencias = collectAllAgencias;

  console.log(`${TAG} loaded.`);
})();
