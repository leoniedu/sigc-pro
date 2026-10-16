// SIGC-PRO shared panel helpers: DataTables setup (PT-BR chrome, a filter
// box under each heading), swapping a panel table, and reading a RENDERED
// table back out as CSV rows. Extracted from ultimo-movimento-map.js so a
// second report panel (Gerenciamento da Coleta) does not copy them; the map
// consumes them from window.__sigcPro.panel and re-exports the ones its
// tests pin.
//
// Loads after sigc-common.js, which assigns window.__sigcPro wholesale. No
// network, no storage: pure DOM and the page's own jQuery/DataTables.
(function () {
  'use strict';

  const TAG = '[sigc-panel]';

  // Drawn wherever a cell has no value: a genuinely empty <td> reads as
  // a rendering fault rather than as "nothing here". Named because the
  // CSV export has to recognise it to strip it back out again — see
  // celulaParaTexto.
  const PLACEHOLDER_VAZIO = '—';

  // Control columns (map pin, Carta button) hold controls, not data: the
  // CSV drops them and the per-column filter row gives them no box.
  const CSV_COLS_IGNORADAS = ['sigc-pro-zona-pin-col', 'sigc-pro-carta-col'];

  // Swaps a panel's table for freshly built markup, taking DataTables
  // down first. DataTables wraps the table in a container holding the
  // length selector, filter box, info line and pagination; replacing only
  // the <table> leaves that container behind, and since the new table is
  // no longer a DataTable, initPanelTables initialises it and nests a
  // SECOND container inside the first. Every reload then stacked one more
  // "50 linhas por página" and one more pagination block.
  function substituirTabela(painel, html) {
    const tabela = painel && painel.querySelector('table');
    if (!tabela) return;
    const jq = window.jQuery || window.$;
    if (jq && jq.fn && jq.fn.dataTable && jq.fn.dataTable.isDataTable &&
        jq.fn.dataTable.isDataTable(tabela)) {
      try {
        jq(tabela).DataTable().destroy();
      } catch (err) {
        // A failed destroy is not fatal — the replacement below still
        // happens; at worst the chrome is rebuilt rather than reused.
        console.warn(`${TAG} não foi possível destruir a DataTable:`, err);
      }
    }
    // Replace the WRAPPER when one survived destroy(): a wrapper left in
    // the DOM keeps its own length selector, filter box and pagination,
    // and the freshly built table would sit inside it with a second set.
    const alvo = tabela.closest('.dataTables_wrapper, .dt-container, .dt-wrapper') || tabela;
    alvo.outerHTML = html;
  }


  // --- CSV export per tab ----------------------------------------------
  //
  // Read from the RENDERED table, not re-derived from the row objects.
  // The two variants show different columns, so a CSV built from its own
  // code path would drift from the table sitting next to the button —
  // and the whole promise of this feature is "what you see, in a file".
  //
  // Goes through the DataTables API when the table is initialized:
  // DataTables renders only the current page into the DOM, so scraping
  // tbody would silently export 25 rows out of hundreds. Same reason
  // readUltimoMovimentoTable() reads the report that way.
  function celulaParaTexto(td) {
    // Cells that opt in export their sort key instead of their text.
    // "Prazo" renders the WORD "Vencido" once the deadline has passed —
    // how long ago changes nothing about what to do — but a spreadsheet
    // cannot sort on a word mixed into a column of day counts. The
    // export carries the number, so sorting survives the round trip.
    //
    // Read from the cell's own content, not from data-order: DataTables
    // strips attributes off the rows it hands back, so the attribute is
    // there only for rows that happen to be rendered. The span is part
    // of the cell and survives either path.
    const num = td.querySelector && td.querySelector('.sigc-pro-prazo-num, .sigc-pro-csv-valor');
    if (num) return String(num.textContent || '').trim();
    // Whitespace-collapsed: the Slots livres cell is a block of per-day
    // markup whose newlines would otherwise break the CSV row.
    const texto = String(td.textContent || '').replace(/\s+/g, ' ').trim();
    // The em-dash is a RENDERING choice — a blank cell in the HTML table
    // reads as broken markup, so "nothing here" is drawn. A CSV wants
    // the opposite: "—" in Prazo, Amostras or Slots livres makes every
    // reader type the whole column as text, so R and pandas get a string
    // column instead of numbers with NAs. Only a cell that is NOTHING
    // BUT the placeholder blanks; an em-dash inside real text stays.
    return texto === PLACEHOLDER_VAZIO ? '' : texto;
  }

  // A cell as DataTables hands it back: the INNER html of the <td>, with
  // the attributes gone — so `data-order` is unreachable and the Prazo
  // column would export "Vencido" as text. The wrapper restores a real
  // <td> the same reader can handle, taking the attributes from the
  // corresponding header cell's own <td> when one is rendered.
  //
  // DOMParser is inert: it never fetches or runs anything, so parsing
  // live table content keeps the zero-network guarantee.
  //
  // A cell carrying data-order is stored ORTHOGONALLY: DataTables hands
  // back {display, sort, filter, type} rather than a string, and
  // String() on it yields "[object Object]". That hit exactly the three
  // columns that use data-order — Prazo, Agendado and Coleta — so the
  // display form is unwrapped before parsing. `display` is the cell's
  // real inner HTML, which is what the reader below expects; the hidden
  // sort span rides inside it, so Prazo still exports its number.
  function conteudoDaCelula(html) {
    if (html == null) return '';
    if (typeof html === 'object') {
      const orto = html.display !== undefined ? html.display
        : html._ !== undefined ? html._
          : html.filter !== undefined ? html.filter
            : html.sort;
      return orto == null ? '' : String(orto);
    }
    return String(html);
  }

  function celulaHtmlParaTexto(html, atributos) {
    const attrs = atributos || '';
    const doc = new DOMParser().parseFromString(
      `<table><tbody><tr><td ${attrs}>${conteudoDaCelula(html)}` +
      '</td></tr></tbody></table>', 'text/html');
    const td = doc.querySelector('td');
    return td ? celulaParaTexto(td) : '';
  }

  // Every row, not just the rendered page. DataTables keeps the full
  // dataset in rows().data() while the DOM holds only the current page —
  // reading tbody (or rows().nodes(), which yields only RENDERED nodes)
  // exported 50 rows out of hundreds. Same API readDataTable() uses, for
  // exactly this reason.
  //
  // Returns rows of live <td> nodes. The DataTables path rebuilds them
  // from the dataset, borrowing each column's attributes from the first
  // rendered row so class/data-order survive for the off-page rows too.
  function linhasDaTabela(tabela) {
    const jq = window.jQuery || window.$;
    if (jq && jq.fn && jq.fn.dataTable && jq.fn.dataTable.isDataTable &&
        jq.fn.dataTable.isDataTable(tabela)) {
      try {
        // search:'applied' — the CSV must be what the filters left, now
        // that a box under every heading makes filter-then-export the
        // obvious move. rows() defaults to {search:'none'}, so the
        // export silently ignored both the per-column boxes and the
        // global Filtrar. page:'all' keeps the off-page rows that the
        // default already gave us: filtering must narrow the file, not
        // paging.
        const dados = jq(tabela).DataTable()
          .rows({ search: 'applied', page: 'all', order: 'current' })
          .data().toArray();
        const modelo = [...tabela.querySelectorAll('tbody tr')][0];
        const attrsPorColuna = modelo
          ? [...modelo.querySelectorAll('td')].map((td) =>
            [...td.attributes].filter((a) => a.name !== 'data-order')
              .map((a) => `${a.name}="${a.value.replace(/"/g, '&quot;')}"`).join(' '))
          : [];
        return dados.map((linha) => Array.from(linha).map((celula, i) => ({
          html: celula, attrs: attrsPorColuna[i] || '',
        })));
      } catch (err) {
        // Fall through to the DOM: a partial export beats none, and the
        // caller has no way to act on this failure.
        console.warn(`${TAG} DataTables rows() falhou, lendo o DOM:`, err);
      }
    }
    return [...tabela.querySelectorAll('tbody tr')].map(
      (tr) => [...tr.querySelectorAll('td')]);
  }

  function tabelaParaCsv(tabela) {
    if (!tabela) return null;
    // First row only: the filter row is in the thead too, and its boxes
    // are controls, not headings.
    const ths = [...tabela.querySelectorAll('thead tr:first-child th')];
    // The pin column is a control, not data — exporting a 📍 glyph as a
    // field would be noise in every row.
    const manter = ths.map((th) => !CSV_COLS_IGNORADAS.some((c) => th.classList.contains(c)));
    const header = ths.filter((_, i) => manter[i]).map(celulaParaTexto);
    const rows = linhasDaTabela(tabela).map((celulas) =>
      celulas.filter((_, i) => manter[i] !== false).map((c) =>
        (c && c.html !== undefined
          ? celulaHtmlParaTexto(c.html, c.attrs)
          : celulaParaTexto(c))));
    return { header, rows };
  }


  // SIGC's own page script auto-initializes DataTables over the tables it
  // finds in the document, and this panel's tables are injected into
  // document.body — so they get swept up and paged at the library's
  // 10-row default (confirmed live 2026-08-12: "Showing 1 to 10 of 90
  // entries" on the Domicílios tab).
  //
  // Rather than fight the initialization, adopt it: 50 rows is a far more
  // useful default for scanning an agência's households, and the library's
  // own "entries per page" selector still lets the user change it. A no-op
  // when DataTables never claimed these tables (then they simply render in
  // full, which is also fine).
  const PANEL_PAGE_LENGTH = 50;

  // DataTables ships English chrome; every other string in this panel is
  // Portuguese, so the table's own controls have to be too. Inlined rather
  // than fetched from DataTables' CDN language files — this extension makes
  // no third-party requests.
  const DT_PT_BR = {
    search: 'Filtrar:',
    lengthMenu: '_MENU_ linhas por página',
    info: 'Mostrando _START_ a _END_ de _TOTAL_ registros',
    infoEmpty: 'Nenhum registro',
    infoFiltered: '(filtrado de _MAX_ no total)',
    zeroRecords: 'Nenhum registro encontrado',
    emptyTable: 'Sem dados',
    paginate: { first: 'Primeira', last: 'Última', next: 'Próxima', previous: 'Anterior' },
  };

  // Every body row must have as many cells as the header has columns.
  // An empty table passes: no rows, nothing to disagree.
  function colunasBatem(tabela) {
    const nCols = tabela.querySelectorAll('thead tr:first-child th').length;
    if (nCols === 0) return false;
    return [...tabela.querySelectorAll('tbody tr')].every(
      (tr) => tr.querySelectorAll('td').length === nCols);
  }

  // A text box under each heading, filtering that column alone. The
  // global "Filtrar:" box ANDs its terms across the whole row, so
  // "pendente Z1" matched any row mentioning either — it cannot express
  // "pendentes IN zona Z1", which is the question the panel is for. Both
  // stay: the global box is still the way to find a controle anywhere.
  //
  // Built in the thead rather than a tfoot so the boxes sit against the
  // headings they belong to. That puts them inside DataTables' sorting
  // target, hence the stopPropagation below.
  const FILTRO_ROW_CLASS = 'sigc-pro-filtro-row';

  function buildFiltroRow(tabela) {
    // Idempotent: initPanelTables runs again on every slots reload, and
    // a second row would stack a dead set of boxes over the live ones.
    if (tabela.querySelector(`.${FILTRO_ROW_CLASS}`)) return null;
    const thead = tabela.querySelector('thead');
    const ths = [...tabela.querySelectorAll('thead tr:first-child th')];
    if (!thead || ths.length === 0) return null;
    const tr = document.createElement('tr');
    tr.className = FILTRO_ROW_CLASS;
    ths.forEach((th) => {
      const cell = document.createElement('th');
      // The pin and Carta columns hold controls, not data — the same
      // reason the CSV export drops them. A box there would filter on
      // nothing.
      if (!CSV_COLS_IGNORADAS.some((c) => th.classList.contains(c))) {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'sigc-pro-filtro-col';
        // The heading text, so a screen reader hears which column this
        // box belongs to — the visual association is position alone.
        const rotulo = String(th.textContent || '').replace(/\s+/g, ' ').trim();
        input.setAttribute('aria-label', `Filtrar ${rotulo}`);
        input.title = `Filtrar por ${rotulo}`;
        cell.appendChild(input);
      }
      tr.appendChild(cell);
    });
    thead.appendChild(tr);
    return tr;
  }

  // Wired through the DataTables API rather than the DOM: column().search()
  // respects the table's own dataset, so filtering works on off-page rows
  // exactly as the global box does.
  // dt is the instance the caller already holds: asking jQuery for it a
  // second time is a wasted lookup on every table, every reload.
  function wireFiltroRow(dt, tr) {
    if (!tr) return;
    // The boxes are an enhancement: a DataTables without the columns()
    // API leaves the table sorted and paged, just unfiltered per column.
    // Losing initialization entirely would cost far more.
    if (!dt || typeof dt.columns !== 'function') {
      tr.remove();
      return;
    }
    // Indexed by CELL, not by input: the pin column contributes a cell
    // with no box, so an inputs[] array is one short from there on and
    // every later column would filter its left-hand neighbour.
    const celulas = [...tr.children];
    // Sorting is bound to the header CELL, so a click to focus a box —
    // or a keystroke inside it — would re-sort the column underneath.
    tr.addEventListener('click', (e) => e.stopPropagation());
    let coluna = 0;
    dt.columns().every(function each () {
      const idx = typeof this.index === 'function' ? this.index() : coluna;
      coluna += 1;
      const celula = celulas[idx];
      const input = celula && celula.querySelector('input');
      if (!input) return;
      input.addEventListener('input', () => {
        // Only redraw when the term actually changed: DataTables redraws
        // the whole table on search(), and arrow keys fire input events
        // on some browsers.
        if (this.search() === input.value) return;
        this.search(input.value).draw();
      });
    });
  }

  // `skip`: CSS selector of tables left alone. The map panel's Entenda
  // glossary is prose in a table: sorting it would scramble a reading order
  // chosen to follow the collection pipeline, and a search box over twelve
  // static rows invites the reader to treat documentation as data.
  function initPanelTables(panelEl, { skip } = {}) {
    const jq = window.jQuery || window.$;
    if (!jq || !jq.fn || !jq.fn.dataTable || !panelEl) return;
    panelEl.querySelectorAll('table').forEach((tbl) => {
      if (skip && tbl.matches(skip)) return;
      // DataTables reports a column-count mismatch through its own
      // alert(), NOT a thrown error, so the try/catch below cannot
      // contain it — the user just gets a modal. The only defence is
      // never handing it a table whose body disagrees with its header.
      //
      // Our builders keep the two in step by construction (each column is
      // gated by the same flag in header and body, and there are tests
      // for that), so this is a backstop against a future edit, not a
      // known case. Refusing to initialize costs sorting and paging;
      // showing an undismissable dialog costs the whole page.
      try {
        // Initialize deliberately rather than inheriting whatever SIGC's
        // own auto-init would do: that gave a 10-row default and no say
        // over sorting. Already-claimed tables (SIGC got there first) are
        // adjusted in place instead — re-initializing throws.
        //
        // A header may declare its column type (data-sigc-type="num"). Left
        // to auto-detection, a column of "12,3%" cells is typed as text.
        const columnDefs = [...tbl.querySelectorAll('thead tr:first-child th')]
          .map((th, i) => (th.dataset && th.dataset.sigcType
            ? { targets: i, type: th.dataset.sigcType, render: renderNumerico } : null))
          .filter(Boolean);
        // The column check guards CONSTRUCTION only: an already-claimed
        // table has been through DataTables' validation once, and
        // adjusting its page length cannot raise the mismatch alert.
        //
        // A claimed table whose columns declare a type is rebuilt instead:
        // SIGC's script got there first with its own options, and the type
        // cannot be changed on a live instance. Tables that declare none
        // keep the adjust-in-place path.
        if (jq.fn.dataTable.isDataTable(tbl) && columnDefs.length) {
          jq(tbl).DataTable().destroy();
        }
        if (jq.fn.dataTable.isDataTable(tbl)) {
          const dtExistente = jq(tbl).DataTable();
          dtExistente.page.len(PANEL_PAGE_LENGTH).draw(false);
          wireFiltroRow(dtExistente, buildFiltroRow(tbl));
          return;
        }
        if (!colunasBatem(tbl)) {
          console.warn(`${TAG} tabela com contagem de colunas inconsistente; ` +
            'não inicializada no DataTables.');
          return;
        }
        // BEFORE the filter row exists, so colunasBatem's header count and
        // DataTables' own column detection both see the original thead.
        const dt = jq(tbl).DataTable({
          columnDefs,
          pageLength: PANEL_PAGE_LENGTH,
          lengthMenu: [[10, 25, 50, 100, -1], [10, 25, 50, 100, 'Todos']],
          order: [], // keep the order the panel built (zona/report order)
          language: DT_PT_BR,
          // The filter row is ours, not a heading: without this
          // DataTables reads the second row as part of the header and
          // binds sorting to the boxes themselves.
          orderCellsTop: true,
        });
        wireFiltroRow(dt, buildFiltroRow(tbl));
      } catch (err) {
        // A failed init is not fatal: the plain table still renders every
        // row, just without sorting or paging.
        console.warn(`${TAG} não foi possível inicializar a tabela:`, err);
      }
    });
  }


  // Sort/type value of a numeric cell, read out of the cell itself:
  // "12,5%" -> 12.5, "1.234" -> 1.234 never matters here since counts are
  // plain digits. The decimal separator is a comma in pt-BR and a dot in a
  // sort key, and "%" is text: left to DataTables' own detection, the
  // column is typed as text (integers first, then every decimal), and a
  // plain parseFloat would read "12,5" as 12. Independent of data-order,
  // which not every DataTables build honours for type detection.
  function valorNumerico(celula) {
    const html = celula && typeof celula === 'object'
      ? (celula.display !== undefined ? celula.display : celula._)
      : celula;
    const m = /\d+(?:[.,]\d+)?/.exec(String(html ?? '').replace(/<[^>]*>/g, ''));
    return m ? Number(m[0].replace(',', '.')) : -1;
  }

  // columns.render for a numeric column: the number for sorting and type
  // detection, the cell untouched for display and filtering.
  function renderNumerico(dado, tipo) {
    return tipo === 'sort' || tipo === 'type' ? valorNumerico(dado) : dado;
  }

  // Takes every DataTable inside `raiz` down, so the markup can be replaced
  // wholesale without stacking a second wrapper (length selector, filter
  // box, pagination) on every rebuild — see substituirTabela.
  function destruirTabelas(raiz) {
    const jq = window.jQuery || window.$;
    if (!raiz || !jq || !jq.fn || !jq.fn.dataTable || !jq.fn.dataTable.isDataTable) return;
    raiz.querySelectorAll('table').forEach((tbl) => {
      if (!jq.fn.dataTable.isDataTable(tbl)) return;
      try {
        jq(tbl).DataTable().destroy();
      } catch (err) {
        console.warn(`${TAG} não foi possível destruir a DataTable:`, err);
      }
    });
  }

  window.__sigcPro.panel = {
    PLACEHOLDER_VAZIO,
    PANEL_PAGE_LENGTH,
    DT_PT_BR,
    substituirTabela,
    destruirTabelas,
    valorNumerico,
    renderNumerico,
    celulaParaTexto,
    conteudoDaCelula,
    celulaHtmlParaTexto,
    linhasDaTabela,
    tabelaParaCsv,
    colunasBatem,
    buildFiltroRow,
    wireFiltroRow,
    initPanelTables,
  };
  console.log(`${TAG} loaded.`);
})();
