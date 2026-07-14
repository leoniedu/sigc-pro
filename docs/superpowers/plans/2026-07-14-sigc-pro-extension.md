# SIGC-PRO Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chrome MV3 extension "SIGC-PRO" with two features for the SIGC Lista de Endereços: a tweaked pdfmake PDF export and a new KML export with Selecionado Sim/Não layers.

**Architecture:** Plain MV3, no build step. All content scripts run in the page's MAIN world on `https://*.ibge.gov.br/*`; `common/sigc-common.js` loads first and exposes `window.__sigcPro` (pesquisa registry + detection + shared poll loop + layout validation); each feature is one file under `extension/features/`.

**Tech Stack:** Vanilla JS (ES2020+), Chrome ≥111 (MV3 `world: "MAIN"`), the page's own pdfmake/DataTables/jQuery. No dependencies, no permissions beyond content-script matches.

**Spec:** `docs/superpowers/specs/2026-07-14-sigc-pro-extension-design.md`

## Global Constraints

- Manifest V3; content scripts with `"world": "MAIN"`, `"run_at": "document_idle"`, matches `https://*.ibge.gov.br/*`.
- Script load order in manifest `js` array: `common/sigc-common.js` first, then features.
- No build step, no npm, no external libraries, no extension permissions.
- Features must stay **inert** (no hooks, no buttons, no console noise) unless a pesquisa matches `.header-sigc__title` AND the table layout validates.
- Console prefixes: `[sigc-pro]` (common), `[sigc-pdf-tweak]` (PDF feature), `[sigc-kml-export]` (KML feature).
- All user-facing text (button labels, alerts, README, landing page) in pt-BR. Code identifiers and commit messages in English.
- Conventional commits, subject ≤72 chars.
- KML coordinates emitted as `longitude,latitude,0` (KML order), WGS84 assumed. Comma decimal separators accepted on input.
- Errors inside the pdfmake hook must never block the export: catch, log, export unmodified.
- No automated test suite (approved spec decision). Every task verifies with `node --check` / `python3 -m json.tool` syntax gates; a manual browser checklist closes the plan.

---

### Task 1: Extension scaffold (manifest + icons)

**Files:**
- Create: `extension/manifest.json`
- Create: `extension/icons/icon16.png`, `extension/icons/icon48.png`, `extension/icons/icon128.png`

**Interfaces:**
- Consumes: nothing.
- Produces: manifest entries `common/sigc-common.js`, `features/pdf-export/pdf-export.js`, `features/kml-export/kml-export.js` — Tasks 2–4 must create files at exactly those paths.

- [ ] **Step 1: Write `extension/manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "SIGC-PRO",
  "version": "0.1.0",
  "description": "Melhorias não oficiais para o SIGC (IBGE): ajustes na exportação de PDF e exportação KML da Lista de Endereços.",
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "content_scripts": [
    {
      "matches": ["https://*.ibge.gov.br/*"],
      "js": [
        "common/sigc-common.js",
        "features/pdf-export/pdf-export.js",
        "features/kml-export/kml-export.js"
      ],
      "run_at": "document_idle",
      "world": "MAIN"
    }
  ]
}
```

- [ ] **Step 2: Validate the JSON**

Run: `python3 -m json.tool extension/manifest.json > /dev/null && echo OK`
Expected: `OK`

- [ ] **Step 3: Generate placeholder icons (solid IBGE-blue squares, stdlib-only PNG writer)**

Write this to the scratchpad (not the repo) as `gen_icons.py` and run it from the repo root:

```python
import struct, zlib, os

def chunk(tag, data):
    return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

def solid_png(path, size, rgb):
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)
    row = b'\x00' + bytes(rgb) * size
    idat = zlib.compress(row * size)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', idat) + chunk(b'IEND', b''))

os.makedirs('extension/icons', exist_ok=True)
for s in (16, 48, 128):
    solid_png(f'extension/icons/icon{s}.png', s, (0, 90, 156))
print('icons written')
```

Run: `python3 <scratchpad>/gen_icons.py`
Expected: `icons written`, then `file extension/icons/icon128.png` reports `PNG image data, 128 x 128`.

- [ ] **Step 4: Commit**

```bash
git add extension/manifest.json extension/icons
git commit -m "feat: MV3 extension scaffold (manifest + icons)"
```

---

### Task 2: `common/sigc-common.js` — pesquisa registry + shared helpers

**Files:**
- Create: `extension/common/sigc-common.js`

**Interfaces:**
- Consumes: nothing.
- Produces `window.__sigcPro` with:
  - `PESQUISAS: Record<string, PesquisaCfg>` where `PesquisaCfg = { titlePattern: RegExp, columns: Record<string, {index: number, label: string}>, pdf: { customTitle: string|null, columnsToKeep: number[], columnsToHeader: number[] } }`
  - `detectPesquisa(): ({id: string} & PesquisaCfg) | null`
  - `whenReady(prereqFn: () => any, callback: (pesquisa, prereq) => void): void` — polls every 200 ms, ~10 s max; fires once when a pesquisa matches AND `prereqFn()` returns truthy; passes both through.
  - `tableMatchesLayout(headerTexts: (string|null|undefined)[], columns): boolean` — tolerant compare (trim, collapse whitespace, case-insensitive) of every configured column label against `headerTexts[index]`.
  - `labelForIndex(columns, index: number): string|null`
  - `MISSING_VALUES: string[]` — `['-', '']`

- [ ] **Step 1: Write `extension/common/sigc-common.js`**

```js
// SIGC-PRO shared runtime: pesquisa registry, page detection, poll loop,
// and table-layout validation. Loaded before all feature scripts (MAIN world).
(function () {
  'use strict';

  if (window.__sigcPro) return;

  const TAG = '[sigc-pro]';

  // One entry per pesquisa. `columns` describes the Lista de Endereços table
  // (0-based, left to right); `label` is the expected header text — features
  // refuse to act when labels don't match, so a SIGC layout change can't
  // silently shift data into the wrong column.
  const PESQUISAS = {
    PNS2026: {
      titlePattern: /SIGC\s*-\s*PNS2026/i,
      columns: {
        controle:      { index: 0,  label: 'Controle' },
        idCnefe:       { index: 1,  label: 'ID_CNEFE' },
        nDomicilio:    { index: 2,  label: 'N.º Domicilio' },
        quadra:        { index: 3,  label: 'Quadra' },
        face:          { index: 4,  label: 'Face' },
        logradouro:    { index: 5,  label: 'Logradouro' },
        numero:        { index: 6,  label: 'Número' },
        complemento:   { index: 7,  label: 'Complemento' },
        bairro:        { index: 8,  label: 'Bairro' },
        latitude:      { index: 9,  label: 'Latitude' },
        longitude:     { index: 10, label: 'Longitude' },
        telefone:      { index: 11, label: 'Telefone' },
        morador:       { index: 12, label: 'Morador' },
        situacao:      { index: 13, label: 'Situação' },
        selecionado:   { index: 14, label: 'Selecionado' },
        antropometria: { index: 15, label: 'Antropometria' },
        biomarcadores: { index: 16, label: 'Biomarcadores' },
        idZona:        { index: 17, label: 'ID Zona' },
        nomeZona:      { index: 18, label: 'Nome ZONA' },
      },
      pdf: {
        customTitle: 'Lista de Endereços — PNS 2026',
        columnsToKeep: [1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 14],
        columnsToHeader: [0, 16, 18], // Controle, Biomarcadores, Nome ZONA
      },
    },
  };

  const MISSING_VALUES = ['-', ''];

  function normalizeLabel(s) {
    return String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function detectPesquisa() {
    const el = document.querySelector('.header-sigc__title');
    if (!el) return null;
    const text = el.textContent || '';
    for (const [id, cfg] of Object.entries(PESQUISAS)) {
      if (cfg.titlePattern.test(text)) return Object.assign({ id }, cfg);
    }
    return null;
  }

  // Fires callback(pesquisa, prereq) once, when a pesquisa matches AND
  // prereqFn() is truthy. Silent give-up after ~10 s keeps the extension
  // inert on non-SIGC IBGE pages.
  function whenReady(prereqFn, callback) {
    let attempts = 0;
    const tick = () => {
      const pesquisa = detectPesquisa();
      const prereq = pesquisa ? prereqFn() : null;
      if (pesquisa && prereq) {
        callback(pesquisa, prereq);
        return;
      }
      attempts += 1;
      if (attempts <= 50) setTimeout(tick, 200);
    };
    tick();
  }

  function tableMatchesLayout(headerTexts, columns) {
    return Object.values(columns).every(
      (c) => normalizeLabel(headerTexts[c.index]) === normalizeLabel(c.label)
    );
  }

  function labelForIndex(columns, index) {
    const entry = Object.values(columns).find((c) => c.index === index);
    return entry ? entry.label : null;
  }

  window.__sigcPro = {
    PESQUISAS,
    MISSING_VALUES,
    detectPesquisa,
    whenReady,
    tableMatchesLayout,
    labelForIndex,
  };
  console.log(`${TAG} common runtime loaded.`);
})();
```

- [ ] **Step 2: Syntax check**

Run: `node --check extension/common/sigc-common.js && echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add extension/common/sigc-common.js
git commit -m "feat: shared runtime (pesquisa registry, whenReady, layout guard)"
```

---

### Task 3: `features/pdf-export/pdf-export.js` — PDF export tweak

**Files:**
- Create: `extension/features/pdf-export/pdf-export.js`

**Interfaces:**
- Consumes: `window.__sigcPro.{whenReady, tableMatchesLayout, labelForIndex, MISSING_VALUES}` (Task 2); page-provided `window.pdfMake.createPdf(doc)`.
- Produces: nothing consumed by other tasks. Patches `pdfMake.createPdf`; idempotency flag `window.pdfMake.__sigcProPdfTweak`.

Behavior (ported from the validated userscript, adapted to per-pesquisa config):
title replace/remove → subtitle from `columnsToHeader` (reads ORIGINAL columns; non-constant columns render `label: vários (N)`) → column filter to `columnsToKeep`. Whole hook wrapped in try/catch: on any error, log and export unmodified. Layout guard: if the pdfmake table's header row doesn't match the pesquisa's `columns` labels, skip all transforms (protects other reports sharing the export button).

- [ ] **Step 1: Write `extension/features/pdf-export/pdf-export.js`**

```js
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

    tableContent.table.body = body.map((row) => keep.map((i) => row[i]));
    if (Array.isArray(tableContent.table.widths)) {
      tableContent.table.widths = keep.map((i) => tableContent.table.widths[i]);
    }

    console.log(`${TAG} PDF columns trimmed: ${totalCols} -> ${keep.length}`);
  }

  function installHook(pesquisa, pdfMake) {
    if (pdfMake.__sigcProPdfTweak) return;

    const originalCreatePdf = pdfMake.createPdf;
    pdfMake.createPdf = function (doc) {
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
        console.error(`${TAG} Error while tweaking PDF doc, exporting unmodified:`, e);
      }
      return originalCreatePdf.call(this, doc);
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
```

- [ ] **Step 2: Syntax check**

Run: `node --check extension/features/pdf-export/pdf-export.js && echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add extension/features/pdf-export/pdf-export.js
git commit -m "feat: PDF export tweak for Lista de Enderecos"
```

---

### Task 4: `features/kml-export/kml-export.js` — KML export button

**Files:**
- Create: `extension/features/kml-export/kml-export.js`

**Interfaces:**
- Consumes: `window.__sigcPro.{whenReady, tableMatchesLayout, MISSING_VALUES}` (Task 2); page-provided jQuery DataTables (`window.jQuery`), `.dt-buttons` toolbar.
- Produces: nothing consumed by other tasks. Injects button `#sigc-pro-kml-button`; downloads `lista-enderecos-<pesquisaId>.kml`.

Behavior: button next to the existing export buttons (class copied from a sibling so it matches SIGC's styling). On click: read rows via DataTables API `rows({ search: 'applied' })` (DOM-table fallback, warned, visible page only) → validate header labels → build KML with two `<Folder>`s split on `selecionado === 'Sim'` (green pins / red pins) → Blob download. Coordinates `lon,lat,0`; comma decimals accepted; rows without valid coordinates skipped, counted, and alerted (pt-BR) if any.

- [ ] **Step 1: Write `extension/features/kml-export/kml-export.js`**

```js
// SIGC-PRO feature: export the Lista de Endereços as KML with separate
// layers for Selecionado = Sim / Não. Adds a button next to the existing
// DataTables export buttons.
(function () {
  'use strict';

  const TAG = '[sigc-kml-export]';
  const BUTTON_ID = 'sigc-pro-kml-button';

  function escapeXml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function cellText(v) {
    // DataTables cell data may contain HTML; reduce to text.
    const div = document.createElement('div');
    div.innerHTML = String(v ?? '');
    return (div.textContent || '').trim();
  }

  function parseCoord(v) {
    const s = cellText(v).replace(',', '.');
    if (s === '' || window.__sigcPro.MISSING_VALUES.includes(s)) return null;
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  }

  // Returns { header: string[], rows: string[][], source: 'api'|'dom' } or null.
  function readTable() {
    const tableEl = document.querySelector('table.dataTable');
    const jq = window.jQuery || window.$;

    if (
      tableEl &&
      jq &&
      jq.fn &&
      jq.fn.dataTable &&
      jq.fn.dataTable.isDataTable(tableEl)
    ) {
      const dt = jq(tableEl).DataTable();
      const header = dt
        .columns()
        .header()
        .toArray()
        .map((h) => (h.textContent || '').trim());
      const rows = dt
        .rows({ search: 'applied' })
        .data()
        .toArray()
        .map((r) => Array.from(r).map(cellText));
      return { header, rows, source: 'api' };
    }

    if (tableEl) {
      console.warn(`${TAG} DataTables API unavailable — falling back to DOM (visible page only).`);
      const header = [...tableEl.querySelectorAll('thead th')].map((th) =>
        (th.textContent || '').trim()
      );
      const rows = [...tableEl.querySelectorAll('tbody tr')].map((tr) =>
        [...tr.querySelectorAll('td')].map((td) => (td.textContent || '').trim())
      );
      return { header, rows, source: 'dom' };
    }

    return null;
  }

  function placemark(row, cols) {
    const get = (key) => row[cols[key].index] ?? '';
    const lat = parseCoord(get('latitude'));
    const lon = parseCoord(get('longitude'));
    if (lat === null || lon === null) return null;

    const name = `Dom. ${get('nDomicilio')} — ${get('logradouro')}, ${get('numero')}`;
    const fields = [
      ['Controle', 'controle'],
      ['ID_CNEFE', 'idCnefe'],
      ['Quadra', 'quadra'],
      ['Face', 'face'],
      ['Complemento', 'complemento'],
      ['Bairro', 'bairro'],
      ['Telefone', 'telefone'],
      ['Morador', 'morador'],
      ['Situação', 'situacao'],
    ];
    const description = fields
      .map(([label, key]) => `<b>${escapeXml(label)}:</b> ${escapeXml(get(key))}`)
      .join('<br/>');

    return [
      '      <Placemark>',
      `        <name>${escapeXml(name)}</name>`,
      `        <description><![CDATA[${description}]]></description>`,
      `        <styleUrl>#${get('selecionado') === 'Sim' ? 'sel' : 'nsel'}</styleUrl>`,
      // KML coordinate order is longitude,latitude,altitude (WGS84).
      `        <Point><coordinates>${lon},${lat},0</coordinates></Point>`,
      '      </Placemark>',
    ].join('\n');
  }

  function buildKml(pesquisa, rows) {
    const cols = pesquisa.columns;
    const selected = [];
    const notSelected = [];
    let skipped = 0;

    rows.forEach((row) => {
      const pm = placemark(row, cols);
      if (pm === null) {
        skipped += 1;
        return;
      }
      (row[cols.selecionado.index] === 'Sim' ? selected : notSelected).push(pm);
    });

    const folder = (name, marks) =>
      [`    <Folder>`, `      <name>${escapeXml(name)}</name>`, ...marks, `    </Folder>`].join('\n');

    const kml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<kml xmlns="http://www.opengis.net/kml/2.2">',
      '  <Document>',
      `    <name>Lista de Endereços — ${escapeXml(pesquisa.id)}</name>`,
      // KML colors are aabbggrr.
      '    <Style id="sel"><IconStyle><color>ff00b400</color></IconStyle></Style>',
      '    <Style id="nsel"><IconStyle><color>ff2222dd</color></IconStyle></Style>',
      folder(`Selecionados (${selected.length})`, selected),
      folder(`Não selecionados (${notSelected.length})`, notSelected),
      '  </Document>',
      '</kml>',
      '',
    ].join('\n');

    return { kml, skipped, total: selected.length + notSelected.length };
  }

  function download(filename, text) {
    const blob = new Blob([text], { type: 'application/vnd.google-earth.kml+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function exportKml(pesquisa) {
    const data = readTable();
    if (!data) {
      alert('SIGC-PRO: tabela de endereços não encontrada nesta página.');
      return;
    }
    if (!window.__sigcPro.tableMatchesLayout(data.header, pesquisa.columns)) {
      console.warn(`${TAG} Table header doesn't match the ${pesquisa.id} layout — aborting.`);
      alert('SIGC-PRO: o layout da tabela não corresponde ao esperado; exportação KML cancelada.');
      return;
    }

    const { kml, skipped, total } = buildKml(pesquisa, data.rows);
    download(`lista-enderecos-${pesquisa.id.toLowerCase()}.kml`, kml);

    console.log(`${TAG} KML exported: ${total} placemarks, ${skipped} skipped (source: ${data.source}).`);
    if (skipped > 0) {
      alert(`SIGC-PRO: ${skipped} endereço(s) sem coordenadas válidas ficaram fora do KML.`);
    }
  }

  function insertButton(pesquisa, toolbar) {
    if (document.getElementById(BUTTON_ID)) return;

    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    const sibling = toolbar.querySelector('button');
    btn.className = sibling ? sibling.className : 'dt-button';
    btn.innerHTML = '<span>KML</span>';
    btn.title = 'Exportar KML (SIGC-PRO)';
    btn.addEventListener('click', () => exportKml(pesquisa));
    toolbar.appendChild(btn);

    console.log(`${TAG} KML button added (${pesquisa.id}).`);
  }

  window.__sigcPro.whenReady(
    () => document.querySelector('.dt-buttons'),
    insertButton
  );
})();
```

- [ ] **Step 2: Syntax check**

Run: `node --check extension/features/kml-export/kml-export.js && echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add extension/features/kml-export/kml-export.js
git commit -m "feat: KML export with Selecionado Sim/Nao layers"
```

---

### Task 5: Docs — `README.md`, `docs/index.html`, `docs/PRIVACY_POLICY.html`

**Files:**
- Create: `README.md`
- Create: `docs/index.html`
- Create: `docs/PRIVACY_POLICY.html`

**Interfaces:**
- Consumes: feature behavior from Tasks 3–4 (described, not imported).
- Produces: nothing consumed by other tasks. `docs/index.html` must be self-contained (inline CSS, no external assets) so GitHub Pages works the day the repo goes public.

- [ ] **Step 1: Write `README.md`**

```markdown
# SIGC-PRO

Extensão de navegador (Chrome, Manifest V3) com melhorias **não oficiais**
para o SIGC — Sistema Integrado de Gestão da Coleta (IBGE), no espírito do
[SEI-PRO](https://sei-pro.github.io/sei-pro/) para o SEI.

> ⚠️ **Aviso:** projeto independente, sem vínculo com o IBGE. As
> funcionalidades são protótipos para demonstração à equipe de
> desenvolvimento oficial do SIGC. Use por sua conta e risco.

## Funcionalidades

Na **Lista de Endereços** (PNS 2026):

- **PDF melhorado** — a exportação de PDF passa a ocultar colunas pouco
  úteis em campo, usa um título customizado e move colunas de valor
  constante (Controle, Biomarcadores, Nome ZONA) para uma linha de
  subtítulo.
- **Exportação KML** — novo botão "KML" ao lado dos botões de exportação,
  que baixa os endereços como arquivo KML (Google Earth / Maps) com camadas
  separadas para **Selecionado = Sim** (verde) e **Não** (vermelho).
  Endereços sem coordenadas válidas são contados e informados.

A extensão só age em páginas do SIGC (detectadas pelo cabeçalho
`SIGC - PNS2026`) e valida o layout da tabela antes de qualquer alteração —
em qualquer outra página do domínio `ibge.gov.br` ela permanece inativa.

## Instalação (modo desenvolvedor)

1. Baixe este repositório (`Code > Download ZIP`) e descompacte, ou
   `git clone`.
2. No Chrome, abra `chrome://extensions`.
3. Ative **Modo do desenvolvedor** (canto superior direito).
4. Clique em **Carregar sem compactação** e selecione a pasta `extension/`
   deste repositório.
5. Abra a Lista de Endereços no SIGC e exporte o PDF ou clique no botão
   **KML**.

Requer Chrome 111 ou superior.

## Configuração

Não há tela de opções: os ajustes (colunas mantidas no PDF, colunas
promovidas ao subtítulo, título) ficam em
`extension/common/sigc-common.js`, na entrada da pesquisa em `PESQUISAS`.
Novas pesquisas são adicionadas como novas entradas no mesmo formato.

## Privacidade

**Nenhum dado sai do seu computador.** A extensão não solicita nenhuma
permissão do navegador, não faz nenhuma chamada de rede, não armazena nada
(nem `localStorage`) e não tem código remoto — o arquivo KML é gerado em
memória e salvo localmente. Detalhes em
[PRIVACY_POLICY](docs/PRIVACY_POLICY.html).

## Licença

MIT.
```

- [ ] **Step 2: Write `docs/index.html`**

```html
<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SIGC-PRO — melhorias não oficiais para o SIGC (IBGE)</title>
<style>
  :root { --blue: #005a9c; --ink: #1a1a1a; --muted: #555; --bg: #f6f8fa; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 16px/1.6 -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--ink); background: #fff; }
  header { background: var(--blue); color: #fff; padding: 3rem 1rem 2.5rem; text-align: center; }
  header h1 { margin: 0 0 .3rem; font-size: 2.4rem; letter-spacing: .02em; }
  header p { margin: 0; opacity: .9; }
  main { max-width: 46rem; margin: 0 auto; padding: 2rem 1rem 4rem; }
  .aviso { background: #fff8e1; border: 1px solid #e6c96b; border-radius: 8px; padding: .8rem 1rem; margin: 1.5rem 0; font-size: .95rem; }
  h2 { color: var(--blue); margin-top: 2.2rem; }
  .card { background: var(--bg); border: 1px solid #e1e4e8; border-radius: 8px; padding: 1rem 1.2rem; margin: 1rem 0; }
  .card h3 { margin: 0 0 .4rem; font-size: 1.05rem; }
  .card p { margin: 0; color: var(--muted); }
  ol li { margin: .4rem 0; }
  code { background: var(--bg); border: 1px solid #e1e4e8; border-radius: 4px; padding: .1rem .35rem; font-size: .9em; }
  footer { text-align: center; color: var(--muted); font-size: .85rem; padding: 2rem 1rem; border-top: 1px solid #e1e4e8; }
  a { color: var(--blue); }
</style>
</head>
<body>
<header>
  <h1>SIGC-PRO</h1>
  <p>Melhorias não oficiais para o SIGC — Sistema Integrado de Gestão da Coleta (IBGE)</p>
</header>
<main>
  <div class="aviso">⚠️ Projeto independente, sem vínculo com o IBGE. Funcionalidades
  em caráter de protótipo, para demonstração à equipe oficial do SIGC.</div>

  <h2>Funcionalidades</h2>
  <div class="card">
    <h3>📄 PDF melhorado — Lista de Endereços</h3>
    <p>Oculta colunas pouco úteis em campo, aplica título customizado e move
    colunas constantes (Controle, Biomarcadores, Nome ZONA) para uma linha de
    subtítulo no PDF exportado.</p>
  </div>
  <div class="card">
    <h3>🗺️ Exportação KML — Lista de Endereços</h3>
    <p>Novo botão "KML" junto aos botões de exportação: baixa os endereços em
    KML (Google Earth / Maps) com camadas separadas para Selecionado = Sim
    (verde) e Não (vermelho).</p>
  </div>

  <h2>Instalação (modo desenvolvedor)</h2>
  <ol>
    <li>Baixe o repositório e descompacte (ou <code>git clone</code>).</li>
    <li>No Chrome, abra <code>chrome://extensions</code>.</li>
    <li>Ative o <strong>Modo do desenvolvedor</strong>.</li>
    <li>Clique em <strong>Carregar sem compactação</strong> e selecione a pasta <code>extension/</code>.</li>
    <li>Abra a Lista de Endereços no SIGC e use o PDF ou o botão <strong>KML</strong>.</li>
  </ol>
  <p>Requer Chrome 111+. A extensão só age em páginas do SIGC e valida o
  layout da tabela antes de alterar qualquer coisa.</p>
</main>
<footer>SIGC-PRO · projeto não oficial · MIT · <a href="PRIVACY_POLICY.html">Política de Privacidade</a></footer>
</body>
</html>
```

- [ ] **Step 3: Write `docs/PRIVACY_POLICY.html`**

```html
<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SIGC-PRO — Política de Privacidade</title>
<style>
  :root { --blue: #005a9c; --ink: #1a1a1a; --muted: #555; --bg: #f6f8fa; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 16px/1.6 -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--ink); background: #fff; }
  header { background: var(--blue); color: #fff; padding: 2rem 1rem; text-align: center; }
  header h1 { margin: 0; font-size: 1.6rem; }
  main { max-width: 46rem; margin: 0 auto; padding: 2rem 1rem 4rem; }
  h2 { color: var(--blue); margin-top: 2rem; font-size: 1.15rem; }
  .destaque { background: var(--bg); border-left: 4px solid var(--blue); padding: .8rem 1rem; margin: 1.5rem 0; }
  code { background: var(--bg); border: 1px solid #e1e4e8; border-radius: 4px; padding: .1rem .35rem; font-size: .9em; }
  footer { text-align: center; color: var(--muted); font-size: .85rem; padding: 2rem 1rem; border-top: 1px solid #e1e4e8; }
  a { color: var(--blue); }
</style>
</head>
<body>
<header><h1>SIGC-PRO — Política de Privacidade</h1></header>
<main>
  <p><em>Última atualização: 14 de julho de 2026.</em></p>

  <div class="destaque"><strong>Resumo: o SIGC-PRO NÃO coleta, NÃO transmite e
  NÃO armazena nenhum dado — pessoal ou não. Nenhuma informação sai do seu
  computador.</strong></div>

  <h2>1. O que a extensão faz</h2>
  <p>O SIGC-PRO opera exclusivamente dentro das páginas do SIGC já abertas no
  seu navegador: ajusta o PDF gerado pela própria página e converte a tabela de
  endereços em um arquivo KML salvo localmente, pelo mecanismo padrão de
  download do navegador.</p>

  <h2>2. Coleta e transmissão de dados</h2>
  <p>Nenhuma. O código não contém chamadas de rede (<code>fetch</code>,
  <code>XMLHttpRequest</code>, <code>sendBeacon</code>, <code>WebSocket</code>)
  nem carrega recursos externos. Não há telemetria, análise de uso ou
  qualquer integração com serviços de terceiros.</p>

  <h2>3. Armazenamento</h2>
  <p>Nenhum. A extensão não usa <code>chrome.storage</code>,
  <code>localStorage</code>, cookies ou IndexedDB. O arquivo KML é gerado em
  memória e gravado apenas onde você escolher salvá-lo.</p>

  <h2>4. Permissões do navegador</h2>
  <p>A extensão não solicita nenhuma permissão especial — o manifesto declara
  apenas em quais páginas (<code>*.ibge.gov.br</code>) seus scripts são
  executados. Isso pode ser verificado em <code>chrome://extensions</code>
  (&ldquo;Nenhuma permissão especial&rdquo;) e no arquivo
  <code>manifest.json</code>.</p>

  <h2>5. Código aberto e auditoria</h2>
  <p>Todo o código executável são três arquivos JavaScript publicados neste
  repositório. O Manifest V3 do Chrome proíbe código remoto: o que está no
  repositório é exatamente o que roda no navegador.</p>

  <h2>6. LGPD</h2>
  <p>Como não há coleta ou tratamento de dados pessoais pela extensão, não há
  operações sujeitas à Lei Geral de Proteção de Dados (Lei nº 13.709/2018)
  realizadas pelo SIGC-PRO. Os dados exibidos nas páginas do SIGC permanecem
  sob a governança do IBGE e das políticas de acesso do próprio sistema.</p>

  <h2>7. Alterações nesta política</h2>
  <p>Qualquer mudança futura (por exemplo, se alguma funcionalidade passar a
  usar armazenamento local) será refletida nesta página e no histórico do
  repositório antes de ser distribuída.</p>

  <h2>8. Contato</h2>
  <p>Dúvidas e reportes: abra uma <em>issue</em> no repositório do projeto no
  GitHub.</p>
</main>
<footer>SIGC-PRO · projeto não oficial, sem vínculo com o IBGE ·
<a href="index.html">página inicial</a></footer>
</body>
</html>
```

- [ ] **Step 4: Sanity-check the HTML files**

Run: `python3 -c "
from html.parser import HTMLParser
for f in ('docs/index.html', 'docs/PRIVACY_POLICY.html'):
    HTMLParser().feed(open(f).read())
print('OK')"`
Expected: `OK`

- [ ] **Step 5: Privacy gate — verify the extension code has no network/storage APIs**

Run: `grep -rnE 'fetch\(|XMLHttpRequest|sendBeacon|WebSocket|chrome\.storage|localStorage|indexedDB|document\.cookie' extension/ && echo VIOLATION || echo CLEAN`
Expected: `CLEAN`
(Also run this before any future release.)

- [ ] **Step 6: Commit**

```bash
git add README.md docs/index.html docs/PRIVACY_POLICY.html
git commit -m "docs: pt-BR README, landing page, and privacy policy"
```

---

### Task 6: Manual verification (user, in the browser)

**Files:** none (checklist only — requires SIGC access, so the user runs it).

- [ ] Load unpacked (`chrome://extensions` → Carregar sem compactação → `extension/`); no manifest errors.
- [ ] Open a non-SIGC `*.ibge.gov.br` page: console shows only `[sigc-pro] common runtime loaded.` — no hook, no KML button.
- [ ] Open the Lista de Endereços in SIGC PNS: console shows the hook-installed and button-added messages.
- [ ] Export PDF: columns trimmed to the 11 configured, custom title, subtitle line with Controle/Biomarcadores/Nome ZONA.
- [ ] Export PDF from a different report sharing the button: unmodified, console warns about layout mismatch.
- [ ] Click KML: file downloads; in Google Earth / geojson.io, two layers (Selecionados green / Não selecionados red), pins on the correct addresses (i.e., in Brazil — validates lon,lat order), balloons show the address fields.
- [ ] Placemark count matches the table's "Mostrando X de Y" total (validates client-side-table assumption). If it only matches the visible page, SIGC is server-side paginated — stop and report.
- [ ] Filter the table, export KML again: only filtered rows.
- [ ] Filter/paginate several times: still exactly one KML button.
- [ ] Rows with missing coordinates: alert reports the skipped count.
- [ ] If any expected header label differs from the config (feature stays inert with a `Column mismatch` warning), correct the `label` values in `sigc-common.js` to the live table's text and retest.
