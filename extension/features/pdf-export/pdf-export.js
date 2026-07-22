// SIGC-PRO feature: rebuild the Lista de Endereços PDF in the classic IBGE
// listagem style (landscape, two-line entries, big Nº Domicílio) for exports
// triggered by the PDF-pro button. The native PDF button stays untouched.
(function () {
  'use strict';

  const TAG = '[sigc-pdf-tweak]';
  const BUTTON_ID = 'sigc-pro-pdf-button';

  // Finds the native PDF export button in the same toolbar as our buttons.
  function findPdfButton(toolbar) {
    return (
      toolbar.querySelector('.buttons-pdf') ||
      [...toolbar.querySelectorAll('button')].find(
        (b) => !b.id.startsWith('sigc-pro-') && /pdf/i.test(`${b.className} ${b.textContent}`)
      ) ||
      null
    );
  }

  function findTableContent(doc) {
    return doc.content.find((c) => c && c.table && Array.isArray(c.table.body));
  }

  function headerTexts(tableContent) {
    const headerRow = tableContent.table.body[0] || [];
    return headerRow.map((cell) => cell && cell.text);
  }

  // pesquisa.columns describes the LIVE table (read via the DataTables JS
  // API), which includes SIGC's icon-only "lupa" column. DataTables'
  // Buttons PDF export omits that column entirely (nothing to render for
  // an icon), so pdfMake's doc.content table is one column narrower, every
  // other column shifted back by 1. Same labels, same relative order —
  // only the index differs — so derive it instead of hand-maintaining a
  // second near-duplicate map.
  function pdfColumns(liveColumns) {
    const shifted = {};
    for (const [k, c] of Object.entries(liveColumns)) {
      shifted[k] = { index: c.index - 1, label: c.label };
    }
    return shifted;
  }

  // Replaces the DataTables-generated doc with a PNAD-listagem-style layout:
  //   LISTA DE ENDEREÇOS - SELECIONADOS|COMPLETA   CONTROLE x • SITUAÇÃO ...
  //   Q/F | Endereço / Morador / Telefone | Lat/Lon | Nº (big)
  // Two lines per entry (Lat over Lon), hairline rule between entries,
  // page header repeated on every page, "Pág. X de Y" / "Gerado em" footer.
  function rebuildAsListagem(doc, pesquisa, body) {
    const { MISSING_VALUES } = window.__sigcPro;
    const cols = pdfColumns(pesquisa.columns);
    const rows = body.slice(1);
    const val = (r, c) => (r[c.index] && r[c.index].text != null ? String(r[c.index].text).trim() : '');
    const present = (s) => s && !MISSING_VALUES.includes(s);

    // Report-constant column: first non-missing value, or "vários (N)" when
    // rows genuinely differ (same semantics as the old subtitle logic).
    const constVal = (c) => {
      const values = rows.map((r) => val(r, c));
      const distinct = new Set(values.filter(present));
      if (distinct.size > 1) {
        console.warn(`${TAG} "${c.label}" varies within the report — header shows "vários".`);
        return `vários (${distinct.size})`;
      }
      return values.find(present) ?? MISSING_VALUES[0];
    };

    const controle = constVal(cols.controle);
    const situacao = constVal(cols.situacao);
    const bio = constVal(cols.biomarcadores);
    const zona = `${constVal(cols.idZona)} ${constVal(cols.nomeZona)}`.trim();
    const allSim = rows.length > 0 && rows.every((r) => val(r, cols.selecionado) === 'Sim');
    const tipo = allSim ? 'SELECIONADOS' : 'COMPLETA';
    const nSelecionados = rows.filter((r) => val(r, cols.selecionado) === 'Sim').length;

    const listTable = (listRows) => {
      const tbody = [
        [
          { text: 'Nº', style: 'th', alignment: 'center' },
          { text: 'Q/F', style: 'th' },
          { text: 'Endereço / Morador / Telefone', style: 'th' },
        ],
      ];

      listRows.forEach((r) => {
        const endereco = [cols.logradouro, cols.numero, cols.complemento, cols.bairro]
          .map((c) => val(r, c))
          .filter(present)
          .join(', ');
        const linha2 = [
          `ID_CNEFE ${val(r, cols.idCnefe)}`,
          present(val(r, cols.morador)) ? `MORADOR: ${val(r, cols.morador)}` : '',
          present(val(r, cols.telefone)) ? `TEL: ${val(r, cols.telefone)}` : '',
        ]
          .filter(Boolean)
          .join('   •   ');

        tbody.push([
          {
            text: present(val(r, cols.nDomicilio)) ? val(r, cols.nDomicilio) : '',
            rowSpan: 2,
            fontSize: 12,
            bold: true,
            alignment: 'center',
            margin: [0, 2, 0, 0],
          },
          { text: `${val(r, cols.quadra)}/${val(r, cols.face)}`, style: 'td' },
          { text: endereco, style: 'td' },
        ]);
        tbody.push([
          {},
          { text: '', style: 'td2' },
          { text: linha2, style: 'td2' },
        ]);
      });

      return {
        table: { headerRows: 1, widths: [32, 42, '*'], body: tbody },
        layout: {
          hLineWidth: (i) => (i <= 1 ? 0.8 : i % 2 === 1 ? 0.4 : 0),
          vLineWidth: () => 0,
          paddingTop: (i) => (i > 0 && i % 2 === 0 ? 0 : 2),
          paddingBottom: (i) => (i > 0 && i % 2 === 1 ? 0 : 2),
          paddingLeft: () => 3,
          paddingRight: () => 3,
          // Zebra shading per ENTRY (each entry spans two table rows).
          fillColor: (i) => (i > 0 && Math.floor((i - 1) / 2) % 2 === 1 ? '#efefef' : null),
        },
      };
    };

    doc.pageOrientation = 'portrait';
    doc.pageMargins = [24, 62, 24, 32];
    // Repeated on EVERY page (pdfmake page header, not a content block).
    // Labels bold, values regular.
    doc.header = () => ({
      text: [
        { text: 'CONTROLE: ', bold: true },
        `${controle} • `,
        { text: 'SITUAÇÃO: ', bold: true },
        `${situacao} • `,
        { text: 'BIOMARCADORES: ', bold: true },
        `${bio}\n`,
        { text: 'ZONA: ', bold: true },
        `${zona} • `,
        { text: 'Nº DE SELECIONADOS: ', bold: true },
        `${nSelecionados}`,
      ],
      style: 'hdr',
      margin: [24, 14, 24, 0],
    });
    // Like the PNAD listagem: selecionados first, a blank page, then the
    // full list. Single-section export when the report is already
    // selecionados-only (or has no selected rows to lead with).
    const selRows = rows.filter((r) => val(r, cols.selecionado) === 'Sim');
    if (tipo === 'COMPLETA' && selRows.length > 0) {
      doc.content = [
        { text: 'SELECIONADOS', style: 'section' },
        listTable(selRows),
        { text: '', pageBreak: 'before' }, // blank separator page
        { text: 'COMPLETA', style: 'section', pageBreak: 'before' },
        listTable(rows),
      ];
    } else {
      doc.content = [
        { text: tipo, style: 'section' },
        listTable(rows),
      ];
    }
    doc.styles = {
      hdr: { fontSize: 10 },
      section: { fontSize: 9, bold: true, margin: [0, 0, 0, 4] },
      th: { fontSize: 8, bold: true },
      td: { fontSize: 8 },
      td2: { fontSize: 7, color: '#444444' },
    };
    doc.defaultStyle = { fontSize: 8 };

    const gerado = new Date().toLocaleString('pt-BR');
    doc.footer = (page, total) => ({
      columns: [
        { text: `Pág. ${page} de ${total}`, fontSize: 7 },
        { text: `Gerado em ${gerado}`, fontSize: 7, alignment: 'right' },
      ],
      margin: [24, 8, 24, 0],
    });

    console.log(`${TAG} PDF rebuilt as listagem (${rows.length} endereços, ${tipo}).`);
  }

  // Set by the PDF-pro button just before it clicks the native PDF button;
  // read (and cleared) by the pdfMake hook below. Module-local: both ends
  // live in this file, only the call stack in between is foreign.
  let rebuildOnNext = false;

  function installHook(pesquisa, pdfMake) {
    if (pdfMake.__sigcProPdfTweak) return;

    const originalCreatePdf = pdfMake.createPdf;
    pdfMake.createPdf = function (doc) {
      // The listagem rebuild applies ONLY to exports triggered by the
      // PDF-pro button (which sets rebuildOnNext). The native PDF button
      // stays completely original.
      if (!rebuildOnNext) {
        return originalCreatePdf.call(this, doc);
      }
      rebuildOnNext = false;

      let body = null;
      try {
        const tableContent = doc && Array.isArray(doc.content) && findTableContent(doc);
        if (
          tableContent &&
          window.__sigcPro.tableMatchesLayout(headerTexts(tableContent), pdfColumns(pesquisa.columns))
        ) {
          body = tableContent.table.body;
        } else if (tableContent) {
          console.warn(
            `${TAG} Table header doesn't match the ${pesquisa.id} Lista de Endereços layout — exporting unmodified.`
          );
        }
      } catch (e) {
        console.error(`${TAG} Table extraction failed:`, e);
      }

      if (body) {
        try {
          rebuildAsListagem(doc, pesquisa, body);
        } catch (e) {
          console.error(`${TAG} Error while rebuilding PDF doc, exporting as-is:`, e);
        }
      }

      const pdf = originalCreatePdf.call(this, doc);
      if (body) {
        try {
          const base = window.__sigcPro.exportFileBase(pesquisa, body);
          const originalDownload = pdf.download.bind(pdf);
          pdf.download = (name, cb, opts) => originalDownload(`${base}.pdf`, cb, opts);
        } catch (e) {
          console.error(`${TAG} Could not set PDF filename:`, e);
        }
      }
      return pdf;
    };
    pdfMake.__sigcProPdfTweak = true;
    console.log(`${TAG} Hook installed on pdfMake.createPdf (${pesquisa.id}).`);
  }

  // The listagem layout's header prints a single CONTROLE value and its
  // pageBreak/section logic assumes one report — mixing controles just
  // silently produced a misleading "vários (N)" header. Refuse up front
  // instead, before ever clicking the native button.
  function hasSingleControle(pesquisa) {
    const result = window.__sigcPro.getTableRows(pesquisa);
    if (!result) return true; // let the native click path surface the real error
    const cols = pesquisa.columns;
    const val = (r) => (r[cols.controle.index] ?? '').trim();
    const controles = new Set(result.rows.map(val).filter(Boolean));
    return controles.size <= 1;
  }

  // Sets the rebuild flag and clicks the native PDF button — pdfMake's own
  // createPdf call is the only reliable way to trigger PDF generation, and
  // clicking the native button (proven safe — unaffected by the F5
  // MouseEvent bug that broke native CSV/Excel) is the only proven way to
  // reach it without reimplementing DataTables' own PDF button config.
  function exportPdf(toolbar, pesquisa) {
    const pdfBtn = findPdfButton(toolbar);
    if (!pdfBtn) {
      alert('SIGC-PRO: botão de PDF não encontrado — o PDF-pro depende dele.');
      return;
    }
    if (!(window.pdfMake && window.pdfMake.__sigcProPdfTweak)) {
      alert('SIGC-PRO: componente de PDF ainda não carregou; tente novamente em alguns segundos.');
      return;
    }
    if (!hasSingleControle(pesquisa)) {
      alert(
        'SIGC-PRO: o PDF-pro só funciona com um único Controle por vez. Filtre a lista para um Controle antes de exportar.'
      );
      return;
    }
    rebuildOnNext = true;
    pdfBtn.click();
  }

  // pdfMake prereq + pesquisa gate kept (whenReady): the hook must be
  // installed before the button is usable. exportPdf needs the toolbar
  // to find the native PDF button — derived from the clicked button
  // itself, since build() no longer receives the toolbar.
  window.__sigcPro.whenReady(
    () =>
      window.pdfMake && typeof window.pdfMake.createPdf === 'function'
        ? window.pdfMake
        : null,
    (pesquisa, pdfMake) => {
      installHook(pesquisa, pdfMake);
      window.__sigcPro.mountWidget({
        id: BUTTON_ID,
        anchor: (ctx) => ctx.dtToolbar(),
        when: (ctx) => ctx.onLista(),
        build: () => {
          console.log(`${TAG} PDF-pro button added.`);
          return window.__sigcPro.makeDtProButton({
            id: BUTTON_ID,
            lines: ['PDF', 'PRO'],
            title: 'Exportar PDF no formato listagem (SIGC-PRO)',
            onClick: (e) =>
              exportPdf(e.currentTarget.closest('.dt-buttons'), pesquisa),
          });
        },
      });
    }
  );
})();
