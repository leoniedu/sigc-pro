// SIGC-PRO feature: tweak the DataTables/pdfmake PDF export of the
// Lista de Endereços (trim columns, custom title, constant columns
// promoted to a subtitle line). Config lives in __sigcPro.PESQUISAS[..].pdf.
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

  function customizeTitle(doc, pdfCfg) {
    const titleItem = doc.content[0];
    const looksLikeTitle =
      titleItem && typeof titleItem.text === 'string' && titleItem.style === 'title';
    if (!looksLikeTitle) return;

    if (pdfCfg.customTitle === null) {
      doc.content.shift();
      console.log(`${TAG} Title block removed.`);
    } else {
      titleItem.text = pdfCfg.customTitle;
      console.log(`${TAG} Title set to:`, pdfCfg.customTitle);
    }
  }

  function addHeaderColumns(doc, pesquisa) {
    const { MISSING_VALUES, labelForIndex } = window.__sigcPro;
    const pdfCfg = pesquisa.pdf;
    if (!pdfCfg.columnsToHeader || pdfCfg.columnsToHeader.length === 0) return;

    // Reads the ORIGINAL table (runs before filterTableColumns), so indexes
    // may reference columns that are not kept in the table at all.
    const tableContent = findTableContent(doc);
    if (!tableContent) return;

    const body = tableContent.table.body;
    if (body.length < 2) return; // need header row + at least one data row

    const dataRows = body.slice(1);
    const parts = [];

    pdfCfg.columnsToHeader.forEach((i) => {
      const label = labelForIndex(pesquisa.columns, i);
      if (!label) {
        console.warn(`${TAG} columnsToHeader index ${i} not in columns map — skipping.`);
        return;
      }

      const columnValues = dataRows.map((row) =>
        row[i] ? String(row[i].text).trim() : ''
      );
      const firstValue =
        columnValues.find((v) => v && !MISSING_VALUES.includes(v)) ?? MISSING_VALUES[0];

      const distinctNonMissing = new Set(
        columnValues.filter((v) => v && !MISSING_VALUES.includes(v))
      );

      let value = firstValue;
      if (distinctNonMissing.size > 1) {
        // Not actually constant: a single value would misrepresent the rows.
        value = `vários (${distinctNonMissing.size})`;
        console.warn(
          `${TAG} "${label}" (index ${i}) has ${distinctNonMissing.size} distinct non-missing values ` +
            `(${[...distinctNonMissing].join(', ')}) — subtitle shows "${value}".`
        );
      }

      parts.push(`${label}: ${value}`);
    });

    if (parts.length === 0) return;

    const subtitleBlock = {
      text: parts.join('   •   '),
      style: 'subtitle',
      margin: [0, 0, 0, 8],
    };

    const titleIndex = doc.content.findIndex((c) => c && c.style === 'title');
    doc.content.splice(titleIndex >= 0 ? titleIndex + 1 : 0, 0, subtitleBlock);

    doc.styles = doc.styles || {};
    doc.styles.subtitle =
      doc.styles.subtitle || { fontSize: 10, italics: true, color: '#555555' };

    console.log(`${TAG} Subtitle added:`, subtitleBlock.text);
  }

  function filterTableColumns(doc, pesquisa) {
    const tableContent = findTableContent(doc);
    if (!tableContent) {
      console.warn(`${TAG} No table found in PDF doc — skipping column filter.`);
      return;
    }

    const keep = pesquisa.pdf.columnsToKeep;
    const body = tableContent.table.body;
    const totalCols = body[0] ? body[0].length : 0;

    tableContent.table.body = body.map((row) => keep.map((i) => row[i] ?? { text: '' }));
    if (Array.isArray(tableContent.table.widths)) {
      tableContent.table.widths = keep.map((i) => tableContent.table.widths[i]);
    }

    console.log(`${TAG} PDF columns trimmed: ${totalCols} -> ${keep.length}`);
  }

  function installHook(pesquisa, pdfMake) {
    if (pdfMake.__sigcProPdfTweak) return;

    const originalCreatePdf = pdfMake.createPdf;
    pdfMake.createPdf = function (doc) {
      // Tweaks apply ONLY to exports triggered by the PDF+KML button (which
      // sets kmlOnNextPdf). The native PDF button stays completely original.
      const emitKml = window.__sigcPro.kmlOnNextPdf;
      if (typeof emitKml !== 'function') {
        return originalCreatePdf.call(this, doc);
      }
      window.__sigcPro.kmlOnNextPdf = null;

      // Hand the KML builder the ORIGINAL table body (before any trimming),
      // then continue with the tweaks and normal PDF generation.
      let body = null;
      try {
        const tableContent = doc && Array.isArray(doc.content) && findTableContent(doc);
        body = tableContent ? tableContent.table.body : null;
      } catch (e) {
        console.error(`${TAG} KML data extraction failed:`, e);
      }
      try {
        emitKml(body);
      } catch (e) {
        console.error(`${TAG} KML callback failed:`, e);
      }

      try {
        const tableContent = doc && Array.isArray(doc.content) && findTableContent(doc);
        if (
          tableContent &&
          window.__sigcPro.tableMatchesLayout(headerTexts(tableContent), pesquisa.columns)
        ) {
          customizeTitle(doc, pesquisa.pdf);
          addHeaderColumns(doc, pesquisa); // reads original columns; must run before trimming
          filterTableColumns(doc, pesquisa);
        } else if (tableContent) {
          console.warn(
            `${TAG} Table header doesn't match the ${pesquisa.id} Lista de Endereços layout — exporting unmodified.`
          );
        }
      } catch (e) {
        console.error(`${TAG} Error while tweaking PDF doc, exporting as-is:`, e);
      }

      const pdf = originalCreatePdf.call(this, doc);
      // Give the PDF the same descriptive filename as the KML (controle,
      // selecionados/completos, date). Only PDF+KML exports reach this point.
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
