# SIGC-PRO Extension — Design

Date: 2026-07-14
Status: approved

## Purpose

SIGC-PRO is an unofficial Chrome extension (Manifest V3) that adds quality-of-life
tweaks to IBGE SIGC (Sistema Integrado de Gestão da Coleta), in the spirit of
[SEI-PRO](https://sei-pro.github.io/sei-pro/) for SEI. It serves as a working
prototype to demonstrate improvements before proposing them to the official SIGC
development team.

First feature: customize the DataTables/pdfmake PDF export of the household
address list ("Lista de Endereços") — drop noisy columns, replace the title, and
promote constant-valued columns (e.g. Controle, Biomarcadores, Nome ZONA) to a
subtitle line.

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
│   ├── manifest.json          # MV3; content script on https://*.ibge.gov.br/*
│   ├── icons/                 # 16/48/128 px
│   └── features/
│       └── pdf-export/
│           └── pdf-export.js  # MAIN-world content script
├── docs/                      # GitHub Pages site (pt-BR), enabled later
│   └── index.html
└── README.md                  # pt-BR: o que é, aviso não-oficial, instalação
```

`pdf-export.js` is registered in `manifest.json` with `"world": "MAIN"`
(Chrome 111+) and `"run_at": "document_idle"`, so it can patch the page's
`window.pdfMake` directly — no injected `<script>` tags.

## Activation gate + pesquisa registry

The script only acts on real SIGC pages, resolved from the header element
`.header-sigc__title` (e.g. `SIGC - PNS2026`):

```js
const PESQUISAS = {
  PNS2026: {
    titlePattern: /SIGC\s*-\s*PNS2026/i,
    customTitle: 'Lista de Endereços — PNS 2026',
    columnsToKeep: [1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 14],
    columnsToHeader: [0, 16, 18],   // Controle, Biomarcadores, Nome ZONA
  },
};
```

v1 ships with the `PNS2026` entry only (values from the validated userscript).
New pesquisas are added as new entries with the same shape once their column
layouts are confirmed.

- The poll loop (200 ms, ~10 s max) waits for **both** `window.pdfMake` and a
  matching pesquisa; if either never appears, the script stays inert (no hook,
  no logging noise on other IBGE sites).
- The matched pesquisa's config drives the hook. Unknown pesquisa → inert.
- If a future pesquisa needs different *behavior* (not just different columns),
  its config entry gains a function then — not before.

## Feature logic (ported from userscript)

Hook `pdfMake.createPdf`, guarded by an idempotency flag, and apply in order:

1. `customizeTitle` — replace (or remove, if `customTitle: null`) the
   `style: 'title'` block at `content[0]`.
2. `addHeaderColumns` — read the **original** table columns listed in
   `columnsToHeader`, pick the first non-missing value per column
   (`MISSING_VALUES = ['-', '']`), warn on multiple distinct non-missing
   values, and insert a `subtitle`-styled line after the title.
3. `filterTableColumns` — keep only `columnsToKeep` (and matching `widths`).
   Guard: if the table has fewer columns than `max(columnsToKeep)`, skip the
   filter so other reports sharing the same export button are unaffected.

All three run inside a try/catch: any error logs and exports the PDF
unmodified. Console messages keep the `[sigc-pdf-tweak]` prefix.

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
3. Open a non-SIGC `*.ibge.gov.br` page → no hook installed, console silent.

No automated tests: the logic is DOM/pdfmake-bound and config-driven.
