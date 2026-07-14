# SIGC-PRO Extension — Design

Date: 2026-07-14
Status: approved

## Purpose

SIGC-PRO is an unofficial Chrome extension (Manifest V3) that adds quality-of-life
tweaks to IBGE SIGC (Sistema Integrado de Gestão da Coleta), in the spirit of
[SEI-PRO](https://sei-pro.github.io/sei-pro/) for SEI. It serves as a working
prototype to demonstrate improvements before proposing them to the official SIGC
development team.

v1 features, both on the household address list ("Lista de Endereços"):

1. **PDF export tweak** — customize the DataTables/pdfmake PDF export: drop
   noisy columns, replace the title, and promote constant-valued columns
   (e.g. Controle, Biomarcadores, Nome ZONA) to a subtitle line.
2. **KML export** — new export button that downloads the address list as a
   .kml with separate layers for Selecionado = Sim / Não.

## Decisions

- **Distribution:** unpacked / developer mode (folder or .zip from GitHub). No
  Web Store publishing for now.
- **Configuration:** fixed in code. No options page or popup in v1.
- **Hosts:** content script matches `https://*.ibge.gov.br/*`; actual activation
  is gated by page detection (below).
- **Repo:** stays private for now. GitHub Pages site files are built but Pages
  is only enabled when the repo goes public.
- **Pesquisa handling:** one feature script shared by all pesquisas, with a
  per-pesquisa config registry — not one script per pesquisa.

## Architecture

Plain MV3 extension, no build step.

```
sigc-pro/
├── extension/
│   ├── manifest.json          # MV3; content scripts on https://*.ibge.gov.br/*
│   ├── icons/                 # 16/48/128 px
│   ├── common/
│   │   └── sigc-common.js     # pesquisa gate + registry, window.__sigcPro
│   └── features/
│       ├── pdf-export/
│       │   └── pdf-export.js
│       └── kml-export/
│           └── kml-export.js
├── docs/                      # GitHub Pages site (pt-BR), enabled later
│   └── index.html
└── README.md                  # pt-BR: o que é, aviso não-oficial, instalação
```

All scripts are registered in `manifest.json` with `"world": "MAIN"`
(Chrome 111+) and `"run_at": "document_idle"`, `sigc-common.js` first so it
can define `window.__sigcPro` (pesquisa detection + registry) before the
feature scripts run. MAIN world lets features patch the page's
`window.pdfMake` and use its DataTables API directly — no injected
`<script>` tags.

## Activation gate + pesquisa registry (`common/sigc-common.js`)

Features only act on real SIGC pages, resolved from the header element
`.header-sigc__title` (e.g. `SIGC - PNS2026`). The registry and detection live
in `sigc-common.js`, exposed as `window.__sigcPro`:

```js
const PESQUISAS = {
  PNS2026: {
    titlePattern: /SIGC\s*-\s*PNS2026/i,
    // Column layout of the Lista de Endereços table (0-based), shared by
    // both features. `label` is the expected header text: features validate
    // labels before acting and go inert (console warning) on mismatch, so a
    // reordered/inserted column in a SIGC update can't silently shift data.
    columns: {
      controle:     { index: 0,  label: 'Controle' },
      idCnefe:      { index: 1,  label: 'ID_CNEFE' },
      nDomicilio:   { index: 2,  label: 'N.º Domicilio' },
      quadra:       { index: 3,  label: 'Quadra' },
      face:         { index: 4,  label: 'Face' },
      logradouro:   { index: 5,  label: 'Logradouro' },
      numero:       { index: 6,  label: 'Número' },
      complemento:  { index: 7,  label: 'Complemento' },
      bairro:       { index: 8,  label: 'Bairro' },
      latitude:     { index: 9,  label: 'Latitude' },
      longitude:    { index: 10, label: 'Longitude' },
      telefone:     { index: 11, label: 'Telefone' },
      morador:      { index: 12, label: 'Morador' },
      situacao:     { index: 13, label: 'Situação' },
      selecionado:  { index: 14, label: 'Selecionado' },
      antropometria:{ index: 15, label: 'Antropometria' },
      biomarcadores:{ index: 16, label: 'Biomarcadores' },
      idZona:       { index: 17, label: 'ID Zona' },
      nomeZona:     { index: 18, label: 'Nome ZONA' },
    },
    pdf: {
      customTitle: 'Lista de Endereços — PNS 2026',
      columnsToKeep: [1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 14],
      columnsToHeader: [0, 16, 18], // Controle, Biomarcadores, Nome ZONA
    },
  },
};
```

v1 ships with the `PNS2026` entry only (values from the validated userscript).
New pesquisas are added as new entries with the same shape once their column
layouts are confirmed.

- `__sigcPro.whenReady(prereqFn, callback)` implements the shared poll loop
  (200 ms, ~10 s max): it fires only when **both** a pesquisa matches and the
  feature's prerequisite is satisfied (`window.pdfMake` for PDF; the
  DataTables toolbar for KML). If either never appears, the feature stays
  inert (no hook, no button, no logging noise on other IBGE sites).
- Label validation is tolerant (trim, case-insensitive, collapse whitespace);
  the exact expected strings are confirmed against the live table during
  implementation.
- The matched pesquisa's config drives each feature. Unknown pesquisa → inert.
- If a future pesquisa needs different *behavior* (not just different columns),
  its config entry gains a function then — not before.

## Feature: KML export (`features/kml-export/kml-export.js`)

Adds a "KML" button next to the existing DataTables export buttons on the
Lista de Endereços; clicking it downloads the list as
`lista-enderecos-{pesquisa}.kml`.

- **Rows:** the exact rows the PDF export sees, by riding the native PDF
  pipeline. The button is labeled **PDF+KML**: it sets
  `__sigcPro.kmlOnNextPdf` and programmatically clicks the native PDF
  button; the pdf-export hook hands the callback the ORIGINAL pdfmake table
  body (all rows, real header texts) and then lets the tweaked PDF proceed
  normally — one click downloads both files. This sidesteps DOM scraping
  entirely (SIGC behind the F5 gateway renders the visible table with
  header/body clones that made DOM reads unreliable) and needs no
  jQuery/DataTables API access. An 8 s timeout clears the flag and alerts if
  the click never reaches pdfMake. PDF-only remains available via the native
  button.
- **Button idempotency:** the button gets a fixed `id`; injection checks for
  it first, so redraws can't stack duplicates. (No MutationObserver
  re-insertion unless testing shows DataTables actually rebuilds the toolbar.)
- **Layers:** two `<Folder>`s split on the `selecionado` column:
  "Selecionados" (green pin style) and "Não selecionados" (red pin style).
  Values other than `Sim` go to the Não selecionados folder.
- **Placemarks:** name `Dom. {nDomicilio} — {logradouro}, {numero}`;
  description balloon (CDATA HTML) with Controle, ID_CNEFE, Quadra, Face,
  Complemento, Bairro, Telefone, Morador, Situação. Coordinates from the
  latitude/longitude columns, accepting comma decimal separators, emitted as
  `longitude,latitude,0` (KML order), assumed WGS84 (SIGC/CNEFE standard).
  Rows without valid coordinates are skipped and counted; the count is
  reported in the console and in an alert if nonzero.
- **Download:** Blob + temporary `<a download>` — no extension permissions
  needed. All XML text is escaped.
- Column indexes come from the pesquisa's `columns` map; the same
  column-count guard as the PDF feature protects other tables.

## Feature: PDF export tweak (ported from userscript)

Hook `pdfMake.createPdf`, guarded by an idempotency flag, and apply in order:

1. `customizeTitle` — replace (or remove, if `customTitle: null`) the
   `style: 'title'` block at `content[0]`.
2. `addHeaderColumns` — read the **original** table columns listed in
   `columnsToHeader`, pick the first non-missing value per column
   (`MISSING_VALUES = ['-', '']`), and insert a `subtitle`-styled line after
   the title. If a column has multiple distinct non-missing values, show
   `label: vários (N)` instead of a misleading single value (plus the
   console warning). *(Deviation from the userscript, which showed the first
   value.)*
3. `filterTableColumns` — keep only `columnsToKeep` (and matching `widths`).
   Guard: header-label validation (against the pesquisa `columns` map) plus
   the column-count check; on failure, skip the filter so other reports
   sharing the same export button are unaffected.

All three run inside a try/catch: any error logs and exports the PDF
unmodified. Console messages keep the `[sigc-pdf-tweak]` prefix.

## Privacy

Guarantee: no data leaves the user's computer, ever. Enforced by design, not
just policy:

- **Zero extension permissions** — the manifest requests none (`permissions`
  absent; content-script `matches` only). Chrome's extension page shows "no
  special permissions", user-verifiable.
- **Zero network calls in code** — no `fetch`, `XMLHttpRequest`,
  `sendBeacon`, `WebSocket`, no remote assets. The KML file is built in
  memory and saved via `Blob` + `<a download>` — a purely local download.
- **Zero storage** — v1 keeps nothing, not even `localStorage`.
- **No background worker, no remote code** (MV3 forbids remote code anyway);
  the three shipped JS files are the entire executable surface, auditable in
  the open repo.
- **Repo privacy gate** — `scripts/check-privacy.sh` greps `extension/` for
  network/storage APIs (`fetch`, XHR, `sendBeacon`, WebSocket, EventSource,
  `.src =`, storage, `eval`); enforced as an obligatory pre-commit hook
  (`.githooks/pre-commit`, activated per clone with
  `git config core.hooksPath .githooks`).
- `docs/PRIVACY_POLICY.html` (pt-BR, modeled on SEI-PRO's) states the above
  plus LGPD note and contact; linked from README and the landing page.

## Docs (pt-BR, SEI-PRO style)

- `README.md`: what SIGC-PRO is, "extensão não oficial, sem vínculo com o
  IBGE" disclaimer, developer-mode install steps, feature list, how to adjust
  the per-pesquisa config.
- `docs/index.html`: self-contained landing page mirroring the README, ready
  for GitHub Pages when the repo goes public.

## Testing

Manual, v1:

1. Load unpacked, open Lista de Endereços in SIGC PNS, export PDF → columns
   trimmed, custom title, subtitle line present.
2. Export a different report on the same site → unmodified (column guard).
3. Open a non-SIGC `*.ibge.gov.br` page → no hook installed, no KML button,
   console silent.
4. Click the KML button → file downloads; opened in Google Earth / geojson.io
   it shows two layers (Selecionados / Não selecionados) with correct pin
   positions and balloon data; rows without coordinates are reported.
5. Filter the table, export KML again → only filtered rows present. Confirm
   the KML placemark count matches the table's "Mostrando X de Y" total
   (validates the client-side-table assumption).
6. Filter/paginate several times → still exactly one KML button.

No automated tests: the logic is DOM/pdfmake-bound and config-driven.
