# CSV Export + Decoupling PDF/KML — Design (quick)

Date: 2026-07-15
Status: draft
Depends on: `2026-07-14-sigc-pro-extension-design.md` (pesquisa registry, `whenReady`, page gating)
Supersedes: the PDF+KML combined-button design in the above doc

## Problem

Portalweb's F5 bot-defense script (`cache-fm-Modern.js`) globally breaks the
`MouseEvent` constructor on the page. DataTables' native CSV/Excel export
(html5 buttons) simulates its download via `new MouseEvent(...)`, so both
buttons throw and produce nothing. Confirmed:

- Happens with the extension fully disabled — not something we caused.
- Happens even when triggered through DataTables' own JS API
  (`$('table').DataTable().button('.buttons-csv').trigger()`), bypassing any
  click entirely — the crash is inside DataTables' own export code, not in
  event dispatch we control. No client-side workaround can call the native
  export path without hitting this.
- The native PDF button and pdfMake are unaffected (pdfmake doesn't use
  `MouseEvent`).

## Data access — the constraint that shaped the original design, and why it's now relaxed

The original PDF+KML design deliberately avoided reading the DataTable/DOM
directly: "SIGC behind the F5 gateway renders the visible table with
header/body clones that made DOM reads unreliable." That's why KML rides the
pdfMake hook (piggybacking a native PDF button click) instead of reading the
table itself — riding the hook was the one proven-reliable way to get
clone-free data.

Before this redesign, we tested the DataTables **JS API** specifically
(not raw DOM scraping) directly against the live gateway-served page:

- `$('table').DataTable().rows().data().length` matches the "Showing X to Y
  of **Z** entries" count.
- Still matches after changing page length and after sorting a column.
- `$('table').DataTable().columns().header().toArray().map(h =>
  h.textContent.trim())` returns a clean, non-duplicated 19-item array.

This confirms the DataTables API — reading through DataTables' own internal
state, not the rendered/possibly-cloned DOM nodes — holds up under the F5
gateway, unlike the raw `<td>` scraping that motivated the original
workaround. This unlocks decoupling: KML and CSV no longer need to piggyback
a PDF click to get reliable data.

**PDF-pro is the one exception.** It doesn't just need data, it needs
`pdfMake.createPdf` to actually run and render a PDF. The only proven way to
trigger that is still clicking the native PDF button (DataTables' own PDF
button config builds the initial `doc`, which our hook then intercepts and
rewrites into listagem style). PDF-pro keeps that mechanism; KML-pro and
CSV-pro drop it in favor of the DataTables API.

## Target: three independent buttons

Toolbar ends up with, alongside the untouched native PDF/CSV/Excel buttons
(hidden or left as-is — see below): **PDF-pro**, **CSV-pro**, **KML-pro**.
Each is a standalone, one-click export — no more "one click, two files."
Smaller/more compact button styling than the current combined button
(roughly half the current font size).

- **Native PDF button**: stays untouched and visible (per decision — unlike
  CSV/Excel, whose native buttons are permanently broken and hidden).
- **Native CSV/Excel buttons**: hidden (`display: none`) — permanently
  broken under F5, no point leaving them live in the toolbar.

### PDF-pro

Behaves like today's PDF-half of PDF+KML, minus the KML side-effect:
- Sets a rebuild-only flag (renamed from the KML-coupled `kmlOnNextPdf`) and
  clicks the *native* PDF button.
- `pdf-export.js`'s `pdfMake.createPdf` hook checks this flag: if set,
  rewrite `doc` into listagem style as it does today; consume KML data
  separately (see below) only if KML-pro's own flag is *also* set — i.e. the
  hook must independently support "rebuild the PDF" and "hand off table data
  for KML," each triggerable without the other.
- Native PDF button clicks (real, from the user) still produce the
  unmodified, original PDF — completely untouched, as today.

### KML-pro

- Reads rows via `$('table').DataTable().rows().data()` directly — no PDF
  click involved.
- Validates headers via `window.__sigcPro.tableMatchesLayout()` against
  `columns().header()` text before building anything; aborts with an alert
  on mismatch (same guard style as today).
- Builds the KML exactly as `buildKml()` does today; same two-folder
  (Selecionados / Não selecionados) structure, same placemark styling.
- Downloads via `Blob` + `<a>.click()` (unaffected by the F5 bug, as today).

### CSV-pro

- Same data path as KML-pro: `$('table').DataTable().rows().data()` +
  `tableMatchesLayout` guard.
- Builds a semicolon-delimited CSV (`;`) — matches pt-BR Excel's default
  locale (comma is the decimal separator there, so comma-delimited CSVs
  misparse on import). Header row uses each column's `label`.
- Escape per RFC 4180: wrap a field in `"…"` and double any `"` inside it
  when the field contains `;`, `"`, or a newline.
- Downloads via `Blob` + `<a>.click()`.

### Shared: filename

`window.__sigcPro.exportFileBase()` currently expects `body`-shaped rows
(`[{text}, ...]`, pdfmake's cell format) because it was only ever fed
pdfMake's own table body. KML-pro/CSV-pro's rows are plain strings from the
DataTables API. Rather than adapt every caller, `exportFileBase` gains
tolerance for plain-string rows (checking `typeof cell === 'string'` vs
`cell.text`) so both data sources produce the same filename format without
duplicating the logic.

## `sigc-common.js` changes

- `kmlOnNextPdf` is renamed/reworked into two independent flags (or one flag
  carrying a small options object, e.g. `{ rebuild: bool, emitKml: fn|null
  }`) — exact shape decided at implementation time, but the key behavioral
  requirement is: PDF-pro rebuild and KML data-capture must be settable and
  consumable independently by the `pdfMake.createPdf` hook.
- `exportFileBase` accepts both pdfmake-cell rows and plain-string rows (see
  above).

## Component layout

```
extension/features/
├── pdf-export/pdf-export.js      # hook logic updated for decoupled flags
├── kml-export/kml-export.js      # rewritten: DataTables API, own button
└── csv-export/csv-export.js      # new: DataTables API, own button
```

Each feature file keeps inserting its own button into the shared
`.dt-buttons` toolbar (idempotent insert + `MutationObserver`, same pattern
as today), gated to the Lista de Endereços page via `whenReady` /
`onListaEnderecos()`.

## Styling

PDF-pro / CSV-pro / KML-pro buttons: same SIGC-PRO blue background as
today's button, but roughly half the current font size — exact px TBD
visually during implementation, matched against the native buttons' sizing
so the toolbar doesn't look mismatched.

## Out of scope

- Real `.xlsx` generation (CSV opens fine in Excel).
- Reporting the F5 bug upstream to portalweb administrators.
- Removing/hiding the native PDF button (explicitly kept, per decision).
