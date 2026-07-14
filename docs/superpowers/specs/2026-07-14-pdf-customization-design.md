# PDF Customization — Design (quick)

Date: 2026-07-14
Status: draft (not yet scheduled)
Depends on: `2026-07-14-sigc-pro-extension-design.md` (PDF+KML hook architecture)

## Idea

The pdf-export hook owns the full pdfmake document definition, so PDF output
is stylable per cell. Extend the per-pesquisa `pdf` config with declarative
styling instead of hardcoding tweaks.

## Capabilities to expose (config-driven)

```js
pdf: {
  customTitle: '…',
  columnsToKeep: [...],
  columnsToHeader: [...],
  pageOrientation: 'landscape',        // optional; default portrait
  columnStyles: {                      // by ORIGINAL column index
    1:  { fontSize: 7 },               // ID_CNEFE smaller
    2:  { bold: true },                // Nº Domicílio bold
  },
  mapLink: {                           // clickable map link per row
    onColumn: 5,                       // logradouro cell becomes the link
    template: 'https://www.openstreetmap.org/?mlat={lat}&mlon={lon}&zoom=18',
    // {lat}/{lon} filled from the latitude/longitude columns (decimal,
    // converted from DMS by the shared parseCoord) BEFORE trimming, so the
    // link works even though those columns are dropped from the table.
    style: { color: '#005a9c', decoration: 'underline' },
  },
}
```

## Implementation notes

- Apply `columnStyles`/`mapLink` in the hook between `addHeaderColumns` and
  `filterTableColumns` (needs original indexes; link needs lat/lon before
  trimming). Spread style props onto each cell object.
- `parseCoord` moves from kml-export to `sigc-common.js` (shared by both
  features).
- Links are inert at generation time — clicking in the PDF viewer is the
  user's action (same privacy analysis as KML balloon links).
- Font FAMILY is fixed (Roboto embedded in SIGC's pdfmake bundle); sizes,
  bold/italics, colors are free.
- Header/footer functions (page numbers, print date) are cheap to add via
  `doc.footer = (page, total) => …` if wanted.

## Out of scope

- New typefaces (would require shipping a vfs — bloat, YAGNI).
- Options UI; stays code-config per pesquisa.
