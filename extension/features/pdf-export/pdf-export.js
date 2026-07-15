// SIGC-PRO feature: rebuild the Lista de Endereços PDF in the classic IBGE
// listagem style (landscape, two-line entries, big Nº Domicílio) for exports
// triggered by the PDF+KML button. The native PDF button stays untouched.
(function () {
  'use strict';

  const TAG = '[sigc-pdf-tweak]';

  function findTableContent(doc) {
    return doc.content.find((c) => c && c.table && Array.isArray(c.table.body));
  }

  function headerTexts(tableContent) {
    const headerRow = tableContent.table.body[0] || [];
    return headerRow.map((cell) => cell && cell.text);
  }

  // Replaces the DataTables-generated doc with a PNAD-listagem-style layout:
  //   LISTA DE ENDEREÇOS - SELECIONADOS|COMPLETA   CONTROLE x • SITUAÇÃO ...
  //   Q/F | Endereço / Morador / Telefone | Lat/Lon | Nº (big)
  // Two lines per entry (Lat over Lon), hairline rule between entries,
  // page header repeated on every page, "Pág. X de Y" / "Gerado em" footer.
  function rebuildAsListagem(doc, pesquisa, body) {
    const { MISSING_VALUES } = window.__sigcPro;
    const cols = pesquisa.columns;
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

    const tbody = [
      [
        { text: 'Q/F', style: 'th' },
        { text: 'Endereço / Morador / Telefone', style: 'th' },
        { text: 'Lat/Lon', style: 'th', alignment: 'right' },
        { text: 'Nº', style: 'th', alignment: 'center' },
      ],
    ];

    rows.forEach((r) => {
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
        { text: `${val(r, cols.quadra)}/${val(r, cols.face)}`, style: 'td' },
        { text: endereco, style: 'td' },
        { text: val(r, cols.latitude), style: 'td', alignment: 'right', noWrap: true },
        {
          text: val(r, cols.nDomicilio),
          rowSpan: 2,
          fontSize: 16,
          bold: true,
          alignment: 'center',
          margin: [0, 3, 0, 0],
        },
      ]);
      tbody.push([
        { text: '', style: 'td2' },
        { text: linha2, style: 'td2' },
        { text: val(r, cols.longitude), style: 'td2', alignment: 'right', noWrap: true },
        {},
      ]);
    });

    doc.pageOrientation = 'landscape';
    doc.pageMargins = [24, 46, 24, 32];
    // Repeated on EVERY page (pdfmake page header, not a content block).
    doc.header = () => ({
      columns: [
        { text: `LISTA DE ENDEREÇOS - ${tipo}`, style: 'hdr' },
        {
          text:
            `CONTROLE: ${controle}   •   SITUAÇÃO: ${situacao}   •   ` +
            `BIOMARCADORES: ${bio}   •   ZONA: ${zona}`,
          style: 'hdr',
          alignment: 'right',
        },
      ],
      margin: [24, 16, 24, 0],
    });
    doc.content = [
      {
        table: { headerRows: 1, widths: [42, '*', 80, 42], body: tbody },
        layout: {
          hLineWidth: (i) => (i <= 1 ? 0.8 : i % 2 === 1 ? 0.4 : 0),
          vLineWidth: () => 0,
          paddingTop: (i) => (i > 0 && i % 2 === 0 ? 0 : 2),
          paddingBottom: (i) => (i > 0 && i % 2 === 1 ? 0 : 2),
          paddingLeft: () => 3,
          paddingRight: () => 3,
        },
      },
    ];
    doc.styles = {
      hdr: { fontSize: 10, bold: true },
      th: { fontSize: 7.5, bold: true },
      td: { fontSize: 7.5 },
      td2: { fontSize: 6.5, color: '#444444' },
    };
    doc.defaultStyle = { fontSize: 7.5 };

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

  function installHook(pesquisa, pdfMake) {
    if (pdfMake.__sigcProPdfTweak) return;

    const originalCreatePdf = pdfMake.createPdf;
    pdfMake.createPdf = function (doc) {
      // The listagem rebuild applies ONLY to exports triggered by the
      // PDF+KML button (which sets kmlOnNextPdf). The native PDF button
      // stays completely original.
      const emitKml = window.__sigcPro.kmlOnNextPdf;
      if (typeof emitKml !== 'function') {
        return originalCreatePdf.call(this, doc);
      }
      window.__sigcPro.kmlOnNextPdf = null;

      // Hand the KML builder the ORIGINAL table body, then rebuild the PDF.
      let body = null;
      try {
        const tableContent = doc && Array.isArray(doc.content) && findTableContent(doc);
        if (
          tableContent &&
          window.__sigcPro.tableMatchesLayout(headerTexts(tableContent), pesquisa.columns)
        ) {
          body = tableContent.table.body;
        } else if (tableContent) {
          console.warn(
            `${TAG} Table header doesn't match the ${pesquisa.id} Lista de Endereços layout — exporting unmodified.`
          );
        }
      } catch (e) {
        console.error(`${TAG} KML data extraction failed:`, e);
      }
      try {
        emitKml(body);
      } catch (e) {
        console.error(`${TAG} KML callback failed:`, e);
      }

      if (body) {
        try {
          rebuildAsListagem(doc, pesquisa, body);
        } catch (e) {
          console.error(`${TAG} Error while rebuilding PDF doc, exporting as-is:`, e);
        }
      }

      const pdf = originalCreatePdf.call(this, doc);
      // Give the PDF the same descriptive filename as the KML (controle,
      // selecionados/completos, date).
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

  window.__sigcPro.whenReady(
    () =>
      window.pdfMake && typeof window.pdfMake.createPdf === 'function'
        ? window.pdfMake
        : null,
    installHook
  );
})();
