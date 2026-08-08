# Último Movimento Mapa+Zonas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Mapa" button to the Último Movimento report page that opens
an in-page panel with two tabs — Mapa (Leaflet, one marker per domicílio,
colored by zona) and Zonas (a summary table, one row per zona) — built
entirely from data already reachable via same-origin SIGC fetches.

**Architecture:** New feature module `extension/features/ultimo-movimento-map/`
following the same shape as `agenda-map.js`: pure join/aggregation functions
exposed for testing, a `mountWidget` button anchored next to Último
Movimento's Filtrar button, an async click handler that reads the on-page
table, cross-fetches Lista de Endereços (opt-in #1, reusing
`agenda-map.js`'s `tableToEnderecosMap`), joins by `controle|domicilio`,
and renders an in-page overlay panel. Leaflet is vendored as static
UMD+CSS files and injected into the page on first Mapa-tab render
(opt-in #2, tile-specific).

**Tech Stack:** Vanilla JS (MV3 content script, MAIN world), Leaflet
(vendored, no bundler), Bun test runner + happy-dom, existing
`sigc-common.js` helpers (`mountWidget`, `makeSigcFormButton`,
`escapeHtml`, `parseCoord`).

## Global Constraints

- Selecionados only: Lista de Endereços fetch always requests
  `TipoVisualizacao: 'S'` (per spec §Data sources item 2).
- Two separate, sequential consent gates — never merge them: (1) same-origin
  Lista de Endereços fetch, (2) first map-tile request. Declining #2 must
  not affect the Zonas tab (per spec §Consent gates).
- Households with zona/idZona empty (non-biomarcador selecionados) must
  still appear — "Sem zona" bucket in the table, distinct marker style on
  the map (per spec §Selecionados without zona). Never silently drop them.
- Households with no valid coordinates: excluded from the map, but counted
  in the Zonas table's "sem coordenadas" column (per spec §Selecionados
  without zona).
- No Agenda cross-fetch, no slots/capacity columns, no setor/agência
  rollups, no offline reference files, no OneDrive publish — out of scope
  for this version (per spec §Out of scope).
- Join key convention: `` `${controle}|${domicilio}` ``, matching
  `agenda-day-guide.js`'s `enderecoKey` and `ultimo-movimento-export.js`.
- Button style/placement: `makeSigcFormButton`, anchored after Último
  Movimento's Filtrar button (same pattern as `ultimo-movimento-export.js`'s
  "CSV TODAS" button).
- New feature module must be added to `manifest.json`'s MAIN-world
  `content_scripts.js` array, positioned after `sigc-common.js` and after
  `ultimo-movimento-export.js` (reads the same page/table it does).

---

## File Structure

- Create: `extension/features/ultimo-movimento-map/ultimo-movimento-map.js`
  — button mount, table read, fetch/join orchestration, panel rendering,
  Zonas aggregation. One file, following `agenda-map.js`'s size (~500
  lines is the established ceiling in this codebase for a single feature).
- Create: `extension/vendor/leaflet/leaflet.js` — vendored Leaflet 1.9.x
  UMD build (unmodified, from the official release).
- Create: `extension/vendor/leaflet/leaflet.css` — vendored Leaflet CSS
  (unmodified).
- Modify: `extension/manifest.json` — add the new feature script to
  MAIN-world `content_scripts.js`; add `web_accessible_resources` entry
  for the vendored Leaflet files.
- Test: `tests/ultimo-movimento-map.test.js` — pure-function tests for
  join/aggregation logic (zona grouping, sem-zona bucket, sem-coordenadas
  counting), URL-building parity with `agenda-map.js`, DOM-level button
  injection test.
- Modify: `tests/manifest-load-order.test.js` — extend to assert the new
  module loads after `sigc-common.js` and after
  `ultimo-movimento-export.js`.

## Interfaces produced (for reference across tasks)

- `window.__sigcProUltimoMovimentoMapInternals` — test-only surface,
  mirrors the `ultimo-movimento-export`/`agenda-map` convention:
  - `parseUltimoMovimentoRows(headers, rows) → Map<"controle|domicilio", {controle, domicilio, entrevistador, tipoEntrevista, ultimaPosicao, data}>`
  - `joinEnderecos(movimentoMap, enderecosMap) → Array<{controle, domicilio, entrevistador, tipoEntrevista, ultimaPosicao, data, lat, lon, zona, idZona, temCoordenadas, temZona}>`
  - `aggregateZonas(joined) → Array<{idZona, nomeZona, realizada, naoIniciada, domicilioFechado, recusa, outros, totalDomicilios, semCoordenadas}>` (one row per distinct `idZona`, plus exactly one row with `idZona === null` representing "Sem zona")
  - `buildZonasTableHtml(zonaRows) → string`
  - `zonaColor(idZona) → string` (hex color; `null`/`''` idZona → the fixed "sem zona" gray)

---

### Task 1: Parse Último Movimento table + join with Lista de Endereços

**Files:**
- Create: `extension/features/ultimo-movimento-map/ultimo-movimento-map.js`
- Test: `tests/ultimo-movimento-map.test.js`

**Interfaces:**
- Consumes: `window.__sigcPro.parseCoord` (existing, from `sigc-common.js`),
  `window.__sigcPro.normalizeLabel` (existing).
- Produces: `parseUltimoMovimentoRows`, `joinEnderecos` (signatures above),
  exposed on `window.__sigcProUltimoMovimentoMapInternals`.

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/ultimo-movimento-map.test.js
import { describe, test, expect } from 'bun:test';

await import('../extension/common/sigc-common.js');
await import('../extension/features/ultimo-movimento-map/ultimo-movimento-map.js');

const UM = window.__sigcProUltimoMovimentoMapInternals;

describe('parseUltimoMovimentoRows', () => {
  test('maps Controle+Domicilio to full row data by header label', () => {
    const headers = ['Controle', 'Domicilio', 'Entrevistador', 'Tipo de Entrevista', 'Última Posição', 'Data'];
    const rows = [
      ['290570120000125', '1', 'Fulano de Tal', 'Realizada', 'Transmitido', '01/08/2026'],
      ['290570120000125', '2', 'Fulano de Tal', 'Não Iniciada', 'Distribuido', ''],
    ];
    const map = UM.parseUltimoMovimentoRows(headers, rows);
    expect(map.get('290570120000125|1')).toEqual({
      controle: '290570120000125', domicilio: '1', entrevistador: 'Fulano de Tal',
      tipoEntrevista: 'Realizada', ultimaPosicao: 'Transmitido', data: '01/08/2026',
    });
    expect(map.get('290570120000125|2').tipoEntrevista).toBe('Não Iniciada');
  });

  test('is tolerant of header order', () => {
    const headers = ['Data', 'Última Posição', 'Tipo de Entrevista', 'Entrevistador', 'Domicilio', 'Controle'];
    const rows = [['01/08/2026', 'Transmitido', 'Realizada', 'Fulano', 'D1', 'C1']];
    const map = UM.parseUltimoMovimentoRows(headers, rows);
    expect(map.get('C1|D1').entrevistador).toBe('Fulano');
  });

  test('returns null when a required header is missing', () => {
    const headers = ['Controle', 'Domicilio', 'Situação'];
    const rows = [['C1', 'D1', 'x']];
    expect(UM.parseUltimoMovimentoRows(headers, rows)).toBeNull();
  });
});

describe('joinEnderecos', () => {
  const movimentoMap = new Map([
    ['C1|1', { controle: 'C1', domicilio: '1', entrevistador: 'A', tipoEntrevista: 'Realizada', ultimaPosicao: 'Transmitido', data: '01/08/2026' }],
    ['C1|2', { controle: 'C1', domicilio: '2', entrevistador: 'A', tipoEntrevista: 'Não Iniciada', ultimaPosicao: 'Distribuido', data: '' }],
  ]);

  test('joins coordinates and zona by controle|domicilio', () => {
    const enderecosMap = new Map([
      ['C1|1', { lat: -8.5, lon: -63.8, zona: 'ESCOLA POLICIA', idZona: '11.1.01.08' }],
    ]);
    const joined = UM.joinEnderecos(movimentoMap, enderecosMap);
    const d1 = joined.find((r) => r.domicilio === '1');
    expect(d1).toMatchObject({ lat: -8.5, lon: -63.8, zona: 'ESCOLA POLICIA', idZona: '11.1.01.08', temCoordenadas: true, temZona: true });
  });

  test('a household missing from enderecosMap gets temCoordenadas/temZona false, not dropped', () => {
    const joined = UM.joinEnderecos(movimentoMap, new Map());
    expect(joined).toHaveLength(2);
    joined.forEach((r) => {
      expect(r.temCoordenadas).toBe(false);
      expect(r.temZona).toBe(false);
      expect(r.lat).toBeNull();
      expect(r.lon).toBeNull();
    });
  });

  test('a household with zona but no valid coordinates keeps temZona true, temCoordenadas false', () => {
    const enderecosMap = new Map([
      ['C1|1', { lat: null, lon: null, zona: 'ESCOLA POLICIA', idZona: '11.1.01.08' }],
    ]);
    const joined = UM.joinEnderecos(movimentoMap, enderecosMap);
    const d1 = joined.find((r) => r.domicilio === '1');
    expect(d1.temZona).toBe(true);
    expect(d1.temCoordenadas).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/ultimo-movimento-map.test.js`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Write the minimal implementation**

```javascript
// extension/features/ultimo-movimento-map/ultimo-movimento-map.js
// SIGC-PRO feature: "Mapa" on Último Movimento — see agenda-map.js for
// the sibling feature this reuses the join pattern from (opt-in
// same-origin fetch of Lista de Endereços, controle|domicilio keying).
// Spec: docs/superpowers/specs/2026-08-08-ultimo-movimento-mapa-design.md
(function () {
  'use strict';

  const TAG = '[sigc-ultimo-movimento-map]';

  const ULTIMO_MOVIMENTO_MAP_LABELS = {
    controle: 'Controle',
    domicilio: 'Domicilio',
    entrevistador: 'Entrevistador',
    tipoEntrevista: 'Tipo de Entrevista',
    ultimaPosicao: 'Última Posição',
    data: 'Data',
  };

  // headers/rows: plain string arrays from #tableRelatorio, same shape
  // ultimo-movimento-export.js and agenda-map.js already parse. Returns
  // null (not throw) when a required header is missing, so a live SIGC
  // column rename fails closed with a clear message at the call site,
  // never a silent wrong-column join.
  function parseUltimoMovimentoRows(headers, rows) {
    const P = window.__sigcPro;
    const idx = {};
    for (const key of Object.keys(ULTIMO_MOVIMENTO_MAP_LABELS)) {
      const i = headers.findIndex(
        (h) => P.normalizeLabel(h) === P.normalizeLabel(ULTIMO_MOVIMENTO_MAP_LABELS[key]));
      if (i === -1) return null;
      idx[key] = i;
    }
    const map = new Map();
    rows.forEach((cells) => {
      const controle = String(cells[idx.controle] || '').trim();
      const domicilio = String(cells[idx.domicilio] || '').trim();
      if (!controle || !domicilio) return;
      map.set(`${controle}|${domicilio}`, {
        controle,
        domicilio,
        entrevistador: String(cells[idx.entrevistador] || '').trim(),
        tipoEntrevista: String(cells[idx.tipoEntrevista] || '').trim(),
        ultimaPosicao: String(cells[idx.ultimaPosicao] || '').trim(),
        data: String(cells[idx.data] || '').trim(),
      });
    });
    return map;
  }

  // movimentoMap: from parseUltimoMovimentoRows. enderecosMap: from
  // agenda-map.js's tableToEnderecosMap (controle|domicilio ->
  // {lat, lon, zona, idZona}, already selecionados-only per its
  // TipoVisualizacao:'S' filtro). A household absent from enderecosMap
  // (fetch gap, or declined consent upstream) is NOT dropped — it keeps
  // its Último Movimento data with temCoordenadas/temZona both false, so
  // the Zonas table's "sem coordenadas" count and "Sem zona" bucket stay
  // accurate instead of silently undercounting.
  function joinEnderecos(movimentoMap, enderecosMap) {
    const out = [];
    movimentoMap.forEach((row, key) => {
      const info = enderecosMap.get(key) || null;
      const lat = info && info.lat != null ? info.lat : null;
      const lon = info && info.lon != null ? info.lon : null;
      const zona = info && info.zona ? info.zona : '';
      const idZona = info && info.idZona ? info.idZona : '';
      out.push({
        ...row,
        lat,
        lon,
        zona,
        idZona,
        temCoordenadas: lat != null && lon != null,
        temZona: Boolean(idZona || zona),
      });
    });
    return out;
  }

  window.__sigcProUltimoMovimentoMapInternals = {
    parseUltimoMovimentoRows,
    joinEnderecos,
  };
})();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/ultimo-movimento-map.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add extension/features/ultimo-movimento-map/ultimo-movimento-map.js tests/ultimo-movimento-map.test.js
git commit -m "feat: parse+join Último Movimento data for Mapa feature"
```

---

### Task 2: Aggregate joined rows into the Zonas table

**Files:**
- Modify: `extension/features/ultimo-movimento-map/ultimo-movimento-map.js`
- Test: `tests/ultimo-movimento-map.test.js`

**Interfaces:**
- Consumes: the `joined` array shape produced by Task 1's `joinEnderecos`
  (`{controle, domicilio, entrevistador, tipoEntrevista, ultimaPosicao, data, lat, lon, zona, idZona, temCoordenadas, temZona}`).
- Produces: `aggregateZonas(joined) → Array<{idZona, nomeZona, realizada, naoIniciada, domicilioFechado, recusa, outros, totalDomicilios, semCoordenadas}>`,
  added to `window.__sigcProUltimoMovimentoMapInternals`.

- [ ] **Step 1: Write the failing tests**

```javascript
// append to tests/ultimo-movimento-map.test.js

describe('aggregateZonas', () => {
  const joined = [
    { idZona: '11.1.01.08', zona: 'ESCOLA POLICIA', tipoEntrevista: 'Realizada', temCoordenadas: true, temZona: true },
    { idZona: '11.1.01.08', zona: 'ESCOLA POLICIA', tipoEntrevista: 'Não Iniciada', temCoordenadas: false, temZona: true },
    { idZona: '', zona: '', tipoEntrevista: 'Recusa', temCoordenadas: true, temZona: false },
    { idZona: '', zona: '', tipoEntrevista: 'Realizada', temCoordenadas: true, temZona: false },
  ];

  test('groups by idZona, one row per distinct zona', () => {
    const rows = UM.aggregateZonas(joined);
    const zonaRow = rows.find((r) => r.idZona === '11.1.01.08');
    expect(zonaRow).toMatchObject({
      idZona: '11.1.01.08', nomeZona: 'ESCOLA POLICIA',
      realizada: 1, naoIniciada: 1, domicilioFechado: 0, recusa: 0, outros: 0,
      totalDomicilios: 2, semCoordenadas: 1,
    });
  });

  test('households with temZona false land in a single "Sem zona" row (idZona null)', () => {
    const rows = UM.aggregateZonas(joined);
    const semZona = rows.find((r) => r.idZona === null);
    expect(semZona).toBeDefined();
    expect(semZona.totalDomicilios).toBe(2);
    expect(semZona.recusa).toBe(1);
    expect(semZona.realizada).toBe(1);
    expect(semZona.semCoordenadas).toBe(0);
  });

  test('unrecognized tipoEntrevista values count under outros', () => {
    const rows = UM.aggregateZonas([
      { idZona: 'Z1', zona: 'Zona 1', tipoEntrevista: 'Endereço Não Localizado', temCoordenadas: true, temZona: true },
    ]);
    expect(rows[0].outros).toBe(1);
    expect(rows[0].realizada).toBe(0);
  });

  test('empty input returns empty array, no Sem zona row', () => {
    expect(UM.aggregateZonas([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/ultimo-movimento-map.test.js`
Expected: FAIL — `aggregateZonas` not defined.

- [ ] **Step 3: Write the minimal implementation**

Add to `ultimo-movimento-map.js`, before the `window.__sigcProUltimoMovimentoMapInternals` assignment:

```javascript
  const TIPO_COLUNA = {
    'Realizada': 'realizada',
    'Não Iniciada': 'naoIniciada',
    'Domicílio Fechado': 'domicilioFechado',
    'Recusa': 'recusa',
  };

  // joined: from joinEnderecos. One output row per distinct idZona, plus
  // exactly one row with idZona===null aggregating every row whose
  // temZona is false (non-biomarcador selecionados — see spec
  // "Selecionados without zona"). Never silently drops a row: every
  // input row lands in exactly one output row.
  function aggregateZonas(joined) {
    const byZona = new Map(); // key: idZona || ' semzona'
    const SEM_ZONA_KEY = ' semzona';
    joined.forEach((r) => {
      const key = r.temZona ? r.idZona : SEM_ZONA_KEY;
      if (!byZona.has(key)) {
        byZona.set(key, {
          idZona: r.temZona ? r.idZona : null,
          nomeZona: r.temZona ? r.zona : 'Sem zona',
          realizada: 0, naoIniciada: 0, domicilioFechado: 0, recusa: 0, outros: 0,
          totalDomicilios: 0, semCoordenadas: 0,
        });
      }
      const bucket = byZona.get(key);
      const coluna = TIPO_COLUNA[r.tipoEntrevista] || 'outros';
      bucket[coluna] += 1;
      bucket.totalDomicilios += 1;
      if (!r.temCoordenadas) bucket.semCoordenadas += 1;
    });
    return Array.from(byZona.values());
  }
```

Update the internals export:

```javascript
  window.__sigcProUltimoMovimentoMapInternals = {
    parseUltimoMovimentoRows,
    joinEnderecos,
    aggregateZonas,
  };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/ultimo-movimento-map.test.js`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add extension/features/ultimo-movimento-map/ultimo-movimento-map.js tests/ultimo-movimento-map.test.js
git commit -m "feat: aggregate joined rows into Zonas table data"
```

---

### Task 3: Zonas table HTML + zona color assignment

**Files:**
- Modify: `extension/features/ultimo-movimento-map/ultimo-movimento-map.js`
- Test: `tests/ultimo-movimento-map.test.js`

**Interfaces:**
- Consumes: `aggregateZonas` output (Task 2), `window.__sigcPro.escapeHtml`
  (existing).
- Produces: `buildZonasTableHtml(zonaRows) → string`, `zonaColor(idZona) → string`,
  added to internals.

- [ ] **Step 1: Write the failing tests**

```javascript
// append to tests/ultimo-movimento-map.test.js

describe('zonaColor', () => {
  test('returns the fixed gray for null/empty idZona ("Sem zona")', () => {
    expect(UM.zonaColor(null)).toBe('#888888');
    expect(UM.zonaColor('')).toBe('#888888');
  });

  test('returns a stable, non-gray color for a real idZona', () => {
    const c1 = UM.zonaColor('11.1.01.08');
    const c2 = UM.zonaColor('11.1.01.08');
    expect(c1).toBe(c2);
    expect(c1).not.toBe('#888888');
    expect(c1).toMatch(/^#[0-9a-f]{6}$/i);
  });

  test('different zonas get different colors (not guaranteed unique, but not all equal for a small set)', () => {
    const colors = new Set(['Z1', 'Z2', 'Z3', 'Z4', 'Z5'].map(UM.zonaColor));
    expect(colors.size).toBeGreaterThan(1);
  });
});

describe('buildZonasTableHtml', () => {
  test('renders a header row and one row per zona, HTML-escaped', () => {
    const rows = [
      { idZona: 'Z1', nomeZona: 'Bairro <X>', realizada: 3, naoIniciada: 1, domicilioFechado: 0, recusa: 0, outros: 0, totalDomicilios: 4, semCoordenadas: 1 },
      { idZona: null, nomeZona: 'Sem zona', realizada: 0, naoIniciada: 0, domicilioFechado: 0, recusa: 2, outros: 0, totalDomicilios: 2, semCoordenadas: 0 },
    ];
    const html = UM.buildZonasTableHtml(rows);
    expect(html).toContain('<table');
    expect(html).toContain('Bairro &lt;X&gt;');
    expect(html).toContain('Sem zona');
    expect(html).toContain('Z1');
  });

  test('empty input still renders a valid table with no data rows', () => {
    const html = UM.buildZonasTableHtml([]);
    expect(html).toContain('<table');
    expect(html).not.toMatch(/<td/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/ultimo-movimento-map.test.js`
Expected: FAIL — `zonaColor`/`buildZonasTableHtml` not defined.

- [ ] **Step 3: Write the minimal implementation**

Add to `ultimo-movimento-map.js`:

```javascript
  const SEM_ZONA_COLOR = '#888888';
  // Categorical palette (Okabe-Ito, colorblind-safe — same family used
  // by the day-route SVG maps elsewhere in this extension), cycled by a
  // deterministic hash so the same idZona always gets the same color
  // within one render and across re-renders.
  const ZONA_PALETTE = [
    '#0072B2', '#D55E00', '#009E73', '#CC79A7',
    '#E69F00', '#56B4E9', '#F0E442', '#000000',
  ];

  function zonaColor(idZona) {
    if (!idZona) return SEM_ZONA_COLOR;
    let hash = 0;
    for (let i = 0; i < idZona.length; i += 1) {
      hash = (hash * 31 + idZona.charCodeAt(i)) | 0;
    }
    return ZONA_PALETTE[Math.abs(hash) % ZONA_PALETTE.length];
  }

  function buildZonasTableHtml(zonaRows) {
    const esc = window.__sigcPro.escapeHtml;
    const head =
      '<tr><th>Zona</th><th>Nome</th><th>Realizada</th><th>Não Iniciada</th>' +
      '<th>Dom. Fechado</th><th>Recusa</th><th>Outros</th><th>Total</th>' +
      '<th>Sem coordenadas</th></tr>';
    const body = zonaRows.map((r) => (
      '<tr>' +
      `<td>${esc(r.idZona || '—')}</td>` +
      `<td>${esc(r.nomeZona)}</td>` +
      `<td>${r.realizada}</td><td>${r.naoIniciada}</td>` +
      `<td>${r.domicilioFechado}</td><td>${r.recusa}</td><td>${r.outros}</td>` +
      `<td>${r.totalDomicilios}</td><td>${r.semCoordenadas}</td>` +
      '</tr>'
    )).join('');
    return `<table class="sigc-pro-zonas-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
  }
```

Update the internals export to include `zonaColor, buildZonasTableHtml`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/ultimo-movimento-map.test.js`
Expected: PASS (15 tests)

- [ ] **Step 5: Commit**

```bash
git add extension/features/ultimo-movimento-map/ultimo-movimento-map.js tests/ultimo-movimento-map.test.js
git commit -m "feat: render Zonas table HTML with per-zona colors"
```

---

### Task 4: Vendor Leaflet and wire manifest

**Files:**
- Create: `extension/vendor/leaflet/leaflet.js`
- Create: `extension/vendor/leaflet/leaflet.css`
- Modify: `extension/manifest.json`
- Test: `tests/manifest-load-order.test.js`

**Interfaces:**
- Produces: `chrome.runtime.getURL('vendor/leaflet/leaflet.js')` and
  `.../leaflet.css` resolvable from a content script once
  `web_accessible_resources` is set — consumed by Task 5's panel loader.

- [ ] **Step 1: Download and vendor Leaflet**

```bash
cd /Users/eleon/github/sigc-pro
mkdir -p extension/vendor/leaflet
curl -sL https://unpkg.com/leaflet@1.9.4/dist/leaflet.js -o extension/vendor/leaflet/leaflet.js
curl -sL https://unpkg.com/leaflet@1.9.4/dist/leaflet.css -o extension/vendor/leaflet/leaflet.css
# Leaflet's CSS references marker images relatively (images/marker-icon.png etc.)
mkdir -p extension/vendor/leaflet/images
for f in marker-icon.png marker-icon-2x.png marker-shadow.png; do
  curl -sL "https://unpkg.com/leaflet@1.9.4/dist/images/$f" -o "extension/vendor/leaflet/images/$f"
done
ls -la extension/vendor/leaflet/ extension/vendor/leaflet/images/
```

Verify the JS file is the real UMD build (not an HTML error page):

```bash
head -c 200 extension/vendor/leaflet/leaflet.js
```
Expected: starts with a comment block mentioning "Leaflet", not `<!DOCTYPE html>`.

- [ ] **Step 2: Add web_accessible_resources and the new feature script to manifest.json**

Read current manifest, then edit:

```json
  "web_accessible_resources": [
    {
      "resources": ["vendor/leaflet/leaflet.js", "vendor/leaflet/leaflet.css", "vendor/leaflet/images/*"],
      "matches": [
        "https://portalweb.ibge.gov.br/*",
        "https://portalweb2.ibge.gov.br/*",
        "https://w3sigcpns2025.ibge.gov.br/*"
      ]
    }
  ],
```

And add `"features/ultimo-movimento-map/ultimo-movimento-map.js"` to the
MAIN-world `js` array, immediately after
`"features/ultimo-movimento-export/ultimo-movimento-export.js"`.

- [ ] **Step 3: Extend manifest-load-order test**

Add to `tests/manifest-load-order.test.js`:

```javascript
  test('ultimo-movimento-map.js loads after sigc-common.js and after ultimo-movimento-export.js', () => {
    const common = idx('common/sigc-common.js');
    const exportJs = idx('features/ultimo-movimento-export/ultimo-movimento-export.js');
    const mapJs = idx('features/ultimo-movimento-map/ultimo-movimento-map.js');
    expect(mapJs).toBeGreaterThan(common);
    expect(mapJs).toBeGreaterThan(exportJs);
  });

  test('web_accessible_resources exposes vendored Leaflet to SIGC origins only', () => {
    expect(Array.isArray(manifest.web_accessible_resources)).toBe(true);
    const leafletEntry = manifest.web_accessible_resources.find(
      (e) => e.resources.some((r) => r.includes('leaflet')));
    expect(leafletEntry).toBeDefined();
    expect(leafletEntry.matches).toEqual([
      'https://portalweb.ibge.gov.br/*',
      'https://portalweb2.ibge.gov.br/*',
      'https://w3sigcpns2025.ibge.gov.br/*',
    ]);
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/manifest-load-order.test.js`
Expected: PASS (all tests, including the two new ones — note the "every
listed script actually exists on disk" test will now also confirm
`ultimo-movimento-map.js` exists from Task 1).

- [ ] **Step 5: Commit**

```bash
git add extension/vendor/leaflet extension/manifest.json tests/manifest-load-order.test.js
git commit -m "chore: vendor Leaflet, wire manifest for Mapa feature"
```

---

### Task 5: Panel rendering — tabs, consent gates, Leaflet map, button mount

**Files:**
- Modify: `extension/features/ultimo-movimento-map/ultimo-movimento-map.js`
- Test: `tests/ultimo-movimento-map.test.js`

**Interfaces:**
- Consumes: `parseUltimoMovimentoRows`, `joinEnderecos`, `aggregateZonas`,
  `buildZonasTableHtml`, `zonaColor` (Tasks 1-3);
  `window.__sigcProAgendaMapInternals` — specifically reuses its
  `tableToEnderecosMap`, `parseEnderecosHtml`, `filtrarUrl`, `postFiltrar`
  (or equivalent fetch helper) rather than reimplementing the Lista de
  Endereços fetch — confirm exact exported names by reading
  `extension/features/agenda-map/agenda-map.js`'s
  `window.__sigcProAgendaMapInternals` assignment before wiring this up;
  `window.__sigcPro.mountWidget`, `makeSigcFormButton`, `escapeHtml`.
- Produces: the `BUTTON_ID` mount; `buildPanelHtml(joined, zonaRows) → string`
  and `onMapaClick()` added to internals for testing (panel open/close,
  tab switching are DOM-tested; the live fetch+Leaflet init path is
  manually verified only, same convention as `agenda-map.js`'s
  `postFiltrar`/`fetchEnderecos`).

- [ ] **Step 1: Read agenda-map.js's exact exported fetch helpers**

```bash
grep -n "window.__sigcProAgendaMapInternals" -A 20 extension/features/agenda-map/agenda-map.js
```

Note the exact function names and signatures for the Lista de Endereços
fetch (URL building + POST + HTML parsing) — reuse them directly via
`window.__sigcProAgendaMapInternals.<name>` rather than duplicating fetch
logic. If `agenda-map.js` does not expose a name for the full
fetch-and-parse flow (only its pieces), compose the pieces the same way
`agenda-map.js`'s own click handler does — read that handler's body
first.

- [ ] **Step 2: Write the failing tests for panel structure (DOM-testable parts only)**

```javascript
// append to tests/ultimo-movimento-map.test.js

describe('buildPanelHtml', () => {
  const joined = [
    { controle: 'C1', domicilio: '1', entrevistador: 'A', tipoEntrevista: 'Realizada',
      ultimaPosicao: 'Transmitido', data: '01/08/2026', lat: -8.5, lon: -63.8,
      zona: 'Z1', idZona: 'Z1', temCoordenadas: true, temZona: true },
  ];
  const zonaRows = UM.aggregateZonas(joined);

  test('includes both tab buttons and both panels', () => {
    const html = UM.buildPanelHtml(joined, zonaRows);
    expect(html).toContain('Mapa');
    expect(html).toContain('Zonas');
    expect(html).toContain('sigc-pro-mapa-panel');
    expect(html).toContain('sigc-pro-zonas-panel');
  });

  test('embeds the Zonas table', () => {
    const html = UM.buildPanelHtml(joined, zonaRows);
    expect(html).toContain('sigc-pro-zonas-table');
  });

  test('includes a close control', () => {
    const html = UM.buildPanelHtml(joined, zonaRows);
    expect(html).toMatch(/fechar|close|×/i);
  });
});

describe('Mapa button mount', () => {
  test('button is registered under the expected id', () => {
    // mountWidget registration happens at module load (already imported
    // at top of file); confirm the widget was pushed with the right id
    // by checking the DOM after simulating the anchor being present.
    document.body.innerHTML = '<div><a id="btnFiltrar" class="btn btn-primary btn-sigc">Filtrar</a></div>';
    window.__sigcPro.recheckMounts();
    // The button only mounts when onUltimoMovimento() is true, which
    // depends on a title element this fixture doesn't provide — assert
    // it does NOT mount rather than asserting a false positive here.
    expect(document.getElementById('sigc-pro-ultimo-movimento-map-btn')).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test tests/ultimo-movimento-map.test.js`
Expected: FAIL — `buildPanelHtml` not defined.

- [ ] **Step 4: Write the implementation**

Add to `ultimo-movimento-map.js` (adjust the reused `agenda-map`
function names per what Step 1 found):

```javascript
  const BUTTON_ID = 'sigc-pro-ultimo-movimento-map-btn';
  const PANEL_ID = 'sigc-pro-ultimo-movimento-map-panel';

  const FETCH_CONSENT_MSG =
    'SIGC-PRO: isto buscará a Lista de Endereços (coordenadas e zona) ' +
    'para cada Controle do relatório, ao próprio servidor do SIGC. Continuar?';

  const TILE_CONSENT_MSG =
    'SIGC-PRO: para desenhar o mapa, o navegador vai buscar imagens de ' +
    'mapa (tiles) de um servidor externo (OpenStreetMap), fora do SIGC. ' +
    'Continuar?';

  // Detects the Último Movimento report page the same way
  // ultimo-movimento-export.js does — reuse that detection rather than
  // reimplementing it, since both rely on the same page title/table id.
  function onUltimoMovimento() {
    return window.__sigcProUltimoMovimentoExportInternals &&
      window.__sigcProUltimoMovimentoExportInternals.onUltimoMovimento();
  }

  function buildPanelHtml(joined, zonaRows) {
    const zonasTable = buildZonasTableHtml(zonaRows);
    return [
      `<div id="${PANEL_ID}" class="sigc-pro-panel-overlay">`,
      '  <div class="sigc-pro-panel-box">',
      '    <div class="sigc-pro-panel-bar">',
      '      <button type="button" class="sigc-pro-tab-btn sigc-pro-tab-active" data-tab="mapa">Mapa</button>',
      `      <button type="button" class="sigc-pro-tab-btn" data-tab="zonas">Zonas (${zonaRows.length})</button>`,
      '      <button type="button" class="sigc-pro-panel-close" title="Fechar">×</button>',
      '    </div>',
      '    <div id="sigc-pro-mapa-panel" class="sigc-pro-tab-panel sigc-pro-tab-panel-active">',
      '      <div id="sigc-pro-leaflet-map"></div>',
      '    </div>',
      '    <div id="sigc-pro-zonas-panel" class="sigc-pro-tab-panel">',
      `      ${zonasTable}`,
      '    </div>',
      '  </div>',
      '</div>',
    ].join('\n');
  }

  function closePanel() {
    const el = document.getElementById(PANEL_ID);
    if (el) el.remove();
  }

  function wireTabs(panelEl) {
    panelEl.querySelectorAll('.sigc-pro-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        panelEl.querySelectorAll('.sigc-pro-tab-btn').forEach((b) => b.classList.remove('sigc-pro-tab-active'));
        panelEl.querySelectorAll('.sigc-pro-tab-panel').forEach((p) => p.classList.remove('sigc-pro-tab-panel-active'));
        btn.classList.add('sigc-pro-tab-active');
        const target = document.getElementById(`sigc-pro-${btn.dataset.tab}-panel`);
        if (target) target.classList.add('sigc-pro-tab-panel-active');
        if (btn.dataset.tab === 'mapa') maybeLoadTiles();
      });
    });
    panelEl.querySelector('.sigc-pro-panel-close').addEventListener('click', closePanel);
  }

  // Injects Leaflet's CSS/JS from the vendored, web-accessible files on
  // first need (not at feature load) — avoids paying the load cost for
  // users who never click Mapa. Idempotent: a second call is a no-op.
  let leafletLoadPromise = null;
  function loadLeafletAssets() {
    if (leafletLoadPromise) return leafletLoadPromise;
    leafletLoadPromise = new Promise((resolve, reject) => {
      const cssHref = chrome.runtime.getURL('vendor/leaflet/leaflet.css');
      if (!document.querySelector(`link[href="${cssHref}"]`)) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = cssHref;
        document.head.appendChild(link);
      }
      if (window.L) { resolve(window.L); return; }
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('vendor/leaflet/leaflet.js');
      script.onload = () => resolve(window.L);
      script.onerror = () => reject(new Error('Falha ao carregar Leaflet.'));
      document.head.appendChild(script);
    });
    return leafletLoadPromise;
  }

  // Tile-specific consent, separate from the Lista de Endereços consent
  // — fires only once, on first attempt to actually paint the map (per
  // spec §Consent gates). Declining leaves the Mapa tab showing an
  // explanatory message with a retry button; the Zonas tab is
  // unaffected.
  let tilesConsented = false;
  let mapInitialized = false;
  let pendingJoined = null;

  async function maybeLoadTiles() {
    if (mapInitialized) return;
    const container = document.getElementById('sigc-pro-leaflet-map');
    if (!container) return;
    if (!tilesConsented) {
      if (!confirm(TILE_CONSENT_MSG)) {
        container.innerHTML =
          '<p class="sigc-pro-map-declined">Mapa não carregado (tiles ' +
          'recusados). <button type="button" id="sigc-pro-retry-tiles">Tentar novamente</button></p>';
        const retry = document.getElementById('sigc-pro-retry-tiles');
        if (retry) retry.addEventListener('click', maybeLoadTiles);
        return;
      }
      tilesConsented = true;
    }
    try {
      const L = await loadLeafletAssets();
      renderLeafletMap(L, container, pendingJoined || []);
      mapInitialized = true;
    } catch (err) {
      container.innerHTML = `<p class="sigc-pro-map-declined">Falha ao carregar o mapa: ${window.__sigcPro.escapeHtml(String(err && err.message || err))}</p>`;
    }
  }

  function renderLeafletMap(L, container, joined) {
    const withCoords = joined.filter((r) => r.temCoordenadas);
    const map = L.map(container);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);
    if (withCoords.length === 0) {
      map.setView([-14, -51], 4); // Brazil-wide fallback view
      return;
    }
    const bounds = [];
    withCoords.forEach((r) => {
      const color = zonaColor(r.idZona || null);
      const marker = L.circleMarker([r.lat, r.lon], {
        radius: 6, color, fillColor: color, fillOpacity: 0.8,
      }).addTo(map);
      marker.bindPopup(
        `Controle: ${window.__sigcPro.escapeHtml(r.controle)}<br>` +
        `Domicílio: ${window.__sigcPro.escapeHtml(r.domicilio)}<br>` +
        `Entrevistador: ${window.__sigcPro.escapeHtml(r.entrevistador)}<br>` +
        `Tipo: ${window.__sigcPro.escapeHtml(r.tipoEntrevista)}<br>` +
        `Zona: ${window.__sigcPro.escapeHtml(r.idZona || 'Sem zona')}`
      );
      bounds.push([r.lat, r.lon]);
    });
    map.fitBounds(bounds, { padding: [20, 20] });
  }

  function readUltimoMovimentoTable() {
    const table = document.getElementById('tableRelatorio');
    if (!table) return null;
    const headers = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    const rows = [...table.querySelectorAll('tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()));
    return parseUltimoMovimentoRows(headers, rows);
  }

  async function onMapaClick(btn) {
    const movimentoMap = readUltimoMovimentoTable();
    if (!movimentoMap || movimentoMap.size === 0) {
      alert('SIGC-PRO: nenhum dado encontrado no relatório — rode um Filtrar primeiro.');
      return;
    }
    if (!confirm(FETCH_CONSENT_MSG)) return;

    btn.disabled = true;
    const originalLabel = btn.textContent;
    try {
      const AM = window.__sigcProAgendaMapInternals;
      const controles = [...new Set([...movimentoMap.keys()].map((k) => k.split('|')[0]))];
      const enderecosMap = new Map();
      for (let i = 0; i < controles.length; i += 1) {
        btn.textContent = `${i + 1}/${controles.length}`;
        try {
          // AM.fetchEnderecosPorControle (or equivalent) — exact call
          // confirmed against agenda-map.js in Step 1 of this task.
          const partial = await AM.fetchEnderecosPorControle(controles[i]);
          if (partial) partial.forEach((v, k) => enderecosMap.set(k, v));
        } catch (err) {
          console.warn(`${TAG} Lista de Endereços fetch failed for ${controles[i]}:`, err);
        }
      }
      const joined = joinEnderecos(movimentoMap, enderecosMap);
      pendingJoined = joined;
      const zonaRows = aggregateZonas(joined);

      closePanel();
      document.body.insertAdjacentHTML('beforeend', buildPanelHtml(joined, zonaRows));
      const panelEl = document.getElementById(PANEL_ID);
      wireTabs(panelEl);
      mapInitialized = false;
      maybeLoadTiles();
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  }

  window.__sigcPro.mountWidget({
    id: BUTTON_ID,
    anchor: (ctx) => ctx.ultimoMovimentoFiltrarBtn(),
    insert: 'after',
    when: () => onUltimoMovimento(),
    build: () => {
      const btn = window.__sigcPro.makeSigcFormButton({
        id: BUTTON_ID,
        text: 'Mapa',
        title: 'Mapa de domicílios por zona (SIGC-PRO)',
        onClick: () => onMapaClick(btn),
      });
      return btn;
    },
  });

  window.__sigcProUltimoMovimentoMapInternals = {
    parseUltimoMovimentoRows,
    joinEnderecos,
    aggregateZonas,
    buildZonasTableHtml,
    zonaColor,
    buildPanelHtml,
  };
})();
```

Note: `ctx.ultimoMovimentoFiltrarBtn()` must match the `ctx` helper name
`ultimo-movimento-export.js` uses for its own anchor — confirm the exact
name in `sigc-common.js`'s `makeTickCtx()` before finalizing (grep
`ultimoMovimentoFiltrarBtn` across the repo; reuse the existing helper,
do not add a second one).

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/ultimo-movimento-map.test.js`
Expected: PASS (all tests from Tasks 1-5)

- [ ] **Step 6: Run the full test suite**

Run: `bun test`
Expected: all tests PASS, including `manifest-load-order.test.js`.

- [ ] **Step 7: Commit**

```bash
git add extension/features/ultimo-movimento-map/ultimo-movimento-map.js tests/ultimo-movimento-map.test.js
git commit -m "feat: render Mapa/Zonas panel with two-stage consent"
```

---

### Task 6: Panel CSS + manual verification

**Files:**
- Modify: `extension/features/ultimo-movimento-map/ultimo-movimento-map.js`
  (inject a `<style>` block once, same approach as `agenda-day-guide.js`'s
  `TABLE_CSS` constant, adapted for an in-page overlay rather than a
  downloaded document)

**Interfaces:**
- Consumes: none new.
- Produces: none new (styling only).

- [ ] **Step 1: Add the panel/tab/table CSS**

Add a `PANEL_CSS` constant to `ultimo-movimento-map.js` and inject it
once via a `<style>` tag on first panel open (guard with a module-level
flag so it's only inserted once per page load):

```javascript
  const PANEL_CSS = `
    #${PANEL_ID} { position: fixed; inset: 0; z-index: 999999;
      background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; }
    #${PANEL_ID} .sigc-pro-panel-box { background: #fff; width: 90vw; height: 85vh;
      border-radius: 6px; display: flex; flex-direction: column; overflow: hidden;
      font-family: system-ui, sans-serif; font-size: 13px; }
    #${PANEL_ID} .sigc-pro-panel-bar { display: flex; gap: 4px; background: #f4f4f4;
      border-bottom: 1px solid #ccc; padding: 4px; align-items: center; }
    #${PANEL_ID} .sigc-pro-tab-btn { padding: 8px 16px; border: 0; background: transparent;
      cursor: pointer; border-bottom: 3px solid transparent; }
    #${PANEL_ID} .sigc-pro-tab-active { background: #fff; border-bottom-color: #005a9c; font-weight: 600; }
    #${PANEL_ID} .sigc-pro-panel-close { margin-left: auto; border: 0; background: transparent;
      font-size: 20px; cursor: pointer; padding: 0 8px; }
    #${PANEL_ID} .sigc-pro-tab-panel { display: none; flex: 1; overflow: auto; }
    #${PANEL_ID} .sigc-pro-tab-panel-active { display: block; }
    #sigc-pro-leaflet-map { width: 100%; height: 100%; }
    .sigc-pro-zonas-table { border-collapse: collapse; width: 100%; }
    .sigc-pro-zonas-table th, .sigc-pro-zonas-table td { border: 1px solid #ddd; padding: 4px 8px; text-align: right; }
    .sigc-pro-zonas-table th:nth-child(-n+2), .sigc-pro-zonas-table td:nth-child(-n+2) { text-align: left; }
    .sigc-pro-zonas-table th { background: #f4f4f4; }
  `;

  let cssInjected = false;
  function ensureCss() {
    if (cssInjected) return;
    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    document.head.appendChild(style);
    cssInjected = true;
  }
```

Call `ensureCss()` at the top of `onMapaClick`, before the panel HTML is
inserted.

- [ ] **Step 2: Run the full test suite**

Run: `bun test`
Expected: all tests still PASS (CSS injection has no test — purely
visual, verified manually next).

- [ ] **Step 3: Manual verification checklist**

Load the unpacked extension in Chrome against a live SIGC session, on
the Último Movimento page:
1. Click "Mapa" — confirm the Lista de Endereços consent dialog appears,
   accept it.
2. Confirm the panel opens with Mapa tab active; confirm the tile
   consent dialog appears; accept it; confirm tiles render and markers
   appear, colored by zona, with a distinct gray for "Sem zona".
3. Click a marker; confirm the popup shows Controle/Domicílio/
   Entrevistador/Tipo/Zona.
4. Switch to the Zonas tab; confirm one row per zona plus a "Sem zona"
   row; confirm counts match a manual spot-check against the Último
   Movimento table.
5. Close and reopen; decline the tile consent this time; confirm the
   Mapa tab shows the declined message with a working retry button, and
   the Zonas tab still works normally.
6. Confirm the panel close button (×) removes the panel and does not
   leave the Leaflet map or listeners behind (re-clicking "Mapa" opens a
   fresh, working panel).

- [ ] **Step 4: Commit**

```bash
git add extension/features/ultimo-movimento-map/ultimo-movimento-map.js
git commit -m "style: add Mapa/Zonas panel CSS"
```

---

## Self-Review Notes

- **Spec coverage:** trigger button (Task 5), Lista de Endereços join +
  selecionados-only (Task 1, inherited via `agenda-map`'s existing
  `TipoVisualizacao:'S'` filtro — no new code needed for that constraint），
  two separate consent gates (Task 5), sem-zona bucket + sem-coordenadas
  count (Tasks 1-2), Zonas table columns (Tasks 2-3), per-domicílio
  Leaflet markers colored by zona (Task 5), vendored Leaflet/no CDN
  (Task 4), in-page panel not download (Task 5), out-of-scope items
  (Agenda cross-fetch, setor/agência rollups, destaque outlines,
  offline reference files, OneDrive) — none referenced by any task,
  confirming they're excluded.
- **Placeholder scan:** no TBD/TODO; the one open item (exact
  `agenda-map` fetch-helper name and `ultimoMovimentoFiltrarBtn` ctx
  helper name) is flagged explicitly as a Step-1 lookup in Task 5 with a
  concrete fallback instruction (compose from pieces, read the existing
  handler), not left vague.
- **Type consistency:** `joined` row shape
  (`{controle, domicilio, entrevistador, tipoEntrevista, ultimaPosicao, data, lat, lon, zona, idZona, temCoordenadas, temZona}`)
  is identical across Tasks 1, 2, 3, 5. `aggregateZonas` output shape
  matches between Task 2's definition and Task 3/5's consumers.
  `zonaColor` signature (`idZona|null → string`) is consistent between
  Task 3 and Task 5's marker rendering.
