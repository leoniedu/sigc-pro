# Agenda Map ("Guia + Mapa") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Guia + Mapa" button on the Agenda (Dia view) that fetches coordinates from SIGC's own Lista de Endereços endpoint (opt-in, same-origin) and generates the day guide with per-visit `geo:` links, per-team GPX, and chunked Google Maps route links.

**Architecture:** All network code is quarantined in a new `extension/features/agenda-map/agenda-map.js`; the privacy gate is reworked to prove `fetch(` exists nowhere else and that agenda-map contains no absolute URL (requests can only go to `location.origin`). `agenda-day-guide.js` gains coords-aware builders and exposes `window.__sigcPro.dayGuide.{generate, diaViewActive}` so agenda-map reuses the whole guide pipeline. Policy texts are updated in the same release.

**Tech Stack:** Vanilla ES2020, Chrome MV3 MAIN-world content scripts. `bun` for everything (node absent): syntax via `bun build --no-bundle`, throwaway mirror tests in /tmp. Spec: `docs/superpowers/specs/2026-07-16-agenda-map-design.md`.

## Global Constraints

- `fetch(` may exist ONLY under `extension/features/agenda-map/`. Every other privacy-gate API (XMLHttpRequest, sendBeacon, WebSocket, EventSource, RTCPeerConnection, importScripts, new Image, `.src =`, chrome.storage, localStorage, sessionStorage, indexedDB, document.cookie, eval(, new Function, import(, quoted "fetch") stays banned EVERYWHERE, including agenda-map.
- `extension/features/agenda-map/` must contain no literal `http://`/`https://` (not even in comments): its request URL is built from `location.origin` only.
- No persistence anywhere: consent lives in a plain variable, reset on page load.
- The generated guide stays `<script>`-free; `geo:`/`https:` `<a href>` links and `data:` URIs are allowed (nothing auto-fetches), all attribute values HTML-escaped.
- pt-BR UI strings. Never edit `extension/manifest.json`'s `version` (pre-commit hook bumps it; hook-generated manifest/dist/index.html changes in commits are expected).
- Commit per task; do NOT push. Mirror tests live in /tmp, never committed, byte-identical to feature code.

---

### Task 1: Privacy gate rework + tripwire self-test

**Files:**
- Modify: `scripts/check-privacy.sh`

**Interfaces:**
- Produces: gate semantics all later tasks rely on — full ban outside agenda-map; agenda-map allowed `fetch(` but nothing else and no absolute URLs.

- [ ] **Step 1: Rework the scan section**

In `scripts/check-privacy.sh`, replace the block from `PATTERN='fetch\(...'` through the first `fi` after `echo "PRIVACY GATE FAILED — request/storage APIs found in extension/:"` with:

```sh
# Blanket ban. extension/features/agenda-map/ is the single sanctioned
# exception, and only for fetch(): it queries SIGC's own server (same
# origin, opt-in, click-triggered — see
# docs/superpowers/specs/2026-07-16-agenda-map-design.md). Every other
# API stays banned there too, and agenda-map may not contain absolute
# URLs, so its requests physically cannot leave location.origin.
PATTERN='fetch\(|["'\''"]fetch["'\''"]|import\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|RTCPeerConnection|importScripts|new Image|\.src\s*=|chrome\.storage|localStorage|sessionStorage|indexedDB|document\.cookie|eval\(|new Function'
PATTERN_NOFETCH='import\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|RTCPeerConnection|importScripts|new Image|\.src\s*=|chrome\.storage|localStorage|sessionStorage|indexedDB|document\.cookie|eval\(|new Function'
URL_PATTERN='https?://'

if [ "$1" = "--staged" ]; then
  MATCHES=$(git grep --cached -nE "$PATTERN" -- extension/ ':!extension/features/agenda-map' 2>/dev/null)
  MAP_MATCHES=$(git grep --cached -nE "$PATTERN_NOFETCH" -- extension/features/agenda-map 2>/dev/null)
  MAP_URLS=$(git grep --cached -nE "$URL_PATTERN" -- extension/features/agenda-map 2>/dev/null)
else
  MATCHES=$(grep -rnE "$PATTERN" extension/ 2>/dev/null | grep -v '^extension/features/agenda-map/')
  MAP_MATCHES=$(grep -rnE "$PATTERN_NOFETCH" extension/features/agenda-map/ 2>/dev/null)
  MAP_URLS=$(grep -rnE "$URL_PATTERN" extension/features/agenda-map/ 2>/dev/null)
fi

if [ -n "$MATCHES" ]; then
  echo "PRIVACY GATE FAILED — request/storage APIs found outside agenda-map:" >&2
  echo "$MATCHES" >&2
  exit 1
fi
if [ -n "$MAP_MATCHES" ]; then
  echo "PRIVACY GATE FAILED — non-fetch request/storage APIs in agenda-map:" >&2
  echo "$MAP_MATCHES" >&2
  exit 1
fi
if [ -n "$MAP_URLS" ]; then
  echo "PRIVACY GATE FAILED — absolute URL in agenda-map (must use location.origin only):" >&2
  echo "$MAP_URLS" >&2
  exit 1
fi
```

Leave the store-URL gate section and the final `echo "privacy gate: CLEAN"` unchanged.

- [ ] **Step 2: Self-test the tripwire (all three failure modes + clean pass)**

```bash
cd /Users/eleon/github/sigc-pro
./scripts/check-privacy.sh                                    # expect: privacy gate: CLEAN
mkdir -p extension/features/agenda-map
echo 'fetch(x)' > extension/features/csv-export/EVIL.js
./scripts/check-privacy.sh; echo "exit=$?"                    # expect: FAILED …outside agenda-map, exit=1
rm extension/features/csv-export/EVIL.js
echo 'localStorage.x = 1' > extension/features/agenda-map/EVIL.js
./scripts/check-privacy.sh; echo "exit=$?"                    # expect: FAILED …non-fetch…, exit=1
echo '// see https://example.com' > extension/features/agenda-map/EVIL.js
./scripts/check-privacy.sh; echo "exit=$?"                    # expect: FAILED …absolute URL…, exit=1
echo 'fetch(u)' > extension/features/agenda-map/EVIL.js
./scripts/check-privacy.sh                                    # expect: privacy gate: CLEAN
rm extension/features/agenda-map/EVIL.js
```

All four expectations must hold before proceeding.

- [ ] **Step 3: Commit**

```bash
git add scripts/check-privacy.sh && \
git commit -m "feat: privacy gate carve-out — fetch only in agenda-map, no absolute URLs"
```

---

### Task 2: Day guide — coords-aware builders, route/GPX helpers, dayGuide export

**Files:**
- Modify: `extension/features/agenda-day-guide/agenda-day-guide.js`

**Interfaces:**
- Consumes: existing builders/wiring in the same file; `window.__sigcPro.slug`.
- Produces (Task 4 relies on): `window.__sigcPro.dayGuide = { generate, diaViewActive }` where `generate(coords)` runs the full gated export (`coords`: `Map<"controle|domicilio", {lat:number, lon:number}>` or `null` → output byte-identical to today). Internal helpers: `escapeXml`, `coordKey(r)`, `slotCoord(r, coords)`, `fmtCoord(p)`, `chunkRoute(points, maxStops=10)`, `gmapsRouteUrl(points)`, `buildGpx(points)`, `gpxDataUri(gpx)`.

- [ ] **Step 1: Write the failing mirror test**

Create `/tmp/agenda-map-guide-test.js` with byte-identical copies of `escapeHtml` (from the feature file) plus the Step-2 helpers below, then:

```js
let fail = 0;
const ok = (cond, label) => { if (!cond) { console.log(`FAIL ${label}`); fail++; } };
const eq = (got, want, label) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { console.log(`FAIL ${label}: got ${g} want ${w}`); fail++; }
};

const P = (lat, lon, name) => ({ lat, lon, name });

// chunkRoute: <=10 stays whole; legs share boundary stops
eq(chunkRoute([1,2,3], 10), [[1,2,3]], 'short route unsplit');
const pts = Array.from({ length: 14 }, (_, i) => i + 1);
eq(chunkRoute(pts, 10), [[1,2,3,4,5,6,7,8,9,10],[10,11,12,13,14]], '14 stops -> 10 + overlap 5');
eq(chunkRoute(Array.from({ length: 10 }, (_, i) => i), 10).length, 1, 'exactly 10 unsplit');
const legs19 = chunkRoute(Array.from({ length: 19 }, (_, i) => i + 1), 10);
eq(legs19, [[1,2,3,4,5,6,7,8,9,10],[10,11,12,13,14,15,16,17,18,19]], '19 stops -> two legs sharing 10');

// gmapsRouteUrl: waypoints = all but last, destination = last, pipe encoded
const url = gmapsRouteUrl([P(-12.5, -38.5), P(-12.6, -38.6), P(-12.7, -38.7)]);
ok(url.startsWith('https://www.google.com/maps/dir/?api=1&travelmode=driving'), 'gmaps base');
ok(url.includes(`waypoints=${encodeURIComponent('-12.500000,-38.500000|-12.600000,-38.600000')}`), 'waypoints piped+encoded');
ok(url.includes(`destination=${encodeURIComponent('-12.700000,-38.700000')}`), 'destination last');
ok(!gmapsRouteUrl([P(1, 2), P(3, 4)]).includes('waypoints=3'), 'two stops: 1 waypoint + destination');

// GPX: escaped names, one wpt per point, data URI self-contained
const gpx = buildGpx([P(-12.5, -38.5, '09:00 Maria & João')]);
ok(gpx.includes('lat="-12.500000" lon="-38.500000"'), 'wpt coords');
ok(gpx.includes('<name>09:00 Maria &amp; João</name>'), 'name xml-escaped');
ok((buildGpx([P(1,2,'a'), P(3,4,'b')]).match(/<wpt /g) || []).length === 2, 'one wpt per point');
ok(gpxDataUri(gpx).startsWith('data:application/gpx+xml;charset=utf-8,'), 'data uri form');

// coordKey / slotCoord
const coords = new Map([['C1|2', { lat: -12.5, lon: -38.5 }]]);
eq(coordKey({ controle: 'C1', domicilio: '2' }), 'C1|2', 'coordKey');
ok(slotCoord({ reservado: true, controle: 'C1', domicilio: '2' }, coords) !== null, 'hit');
ok(slotCoord({ reservado: false, controle: 'C1', domicilio: '2' }, coords) === null, 'open slot never linked');
ok(slotCoord({ reservado: true, controle: 'C9', domicilio: '9' }, coords) === null, 'miss -> null');
ok(slotCoord({ reservado: true, controle: 'C1', domicilio: '2' }, null) === null, 'null coords -> null');

console.log(fail === 0 ? 'ALL PASS' : `${fail} FAILURES`);
```

- [ ] **Step 2: Run it, iterate until ALL PASS**

Run: `bun /tmp/agenda-map-guide-test.js`
Expected: fails with `chunkRoute is not defined` until you add the helpers to the mirror; then `ALL PASS`. The helper code (final form, copy into the mirror AND, verbatim, into the feature file in Step 3):

```js
  // --- coordinates: geo links, Google Maps route, GPX ---------------
  // All optional: every builder below is a no-op when coords is null,
  // keeping the plain Guia do Dia byte-identical.

  function escapeXml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  }

  function coordKey(r) {
    return `${r.controle}|${r.domicilio}`;
  }

  function slotCoord(r, coords) {
    return (r.reservado && coords && coords.get(coordKey(r))) || null;
  }

  function fmtCoord(p) {
    return `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
  }

  // Splits a day into Google-Maps-sized legs (max 10 stops = 9 waypoints
  // + destination; origin omitted = the device's current location).
  // Consecutive legs share their boundary stop so navigation is seamless.
  function chunkRoute(points, maxStops) {
    const max = maxStops || 10;
    if (points.length <= max) return [points];
    const chunks = [];
    let start = 0;
    while (start < points.length - 1) {
      const end = Math.min(start + max, points.length);
      chunks.push(points.slice(start, end));
      if (end >= points.length) break;
      start = end - 1;
    }
    return chunks;
  }

  function gmapsRouteUrl(points) {
    const way = points.slice(0, -1).map(fmtCoord).join('|');
    const dest = fmtCoord(points[points.length - 1]);
    return 'https://www.google.com/maps/dir/?api=1&travelmode=driving' +
      (way ? `&waypoints=${encodeURIComponent(way)}` : '') +
      `&destination=${encodeURIComponent(dest)}`;
  }

  function buildGpx(points) {
    const wpts = points.map((p) =>
      `  <wpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"><name>${escapeXml(p.name)}</name></wpt>`);
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<gpx version="1.1" creator="SIGC-PRO" xmlns="http://www.topografix.com/GPX/1/1">',
      ...wpts,
      '</gpx>',
    ].join('\n');
  }

  function gpxDataUri(gpx) {
    return 'data:application/gpx+xml;charset=utf-8,' + encodeURIComponent(gpx);
  }
```

- [ ] **Step 3: Add the helpers and thread `coords` through the builders**

In `extension/features/agenda-day-guide/agenda-day-guide.js`:

3a. Insert the Step-2 helper block right after `media1`'s closing `}` (before `// --- HTML builders`).

3b. `buildSlotCard(r)` → `buildSlotCard(r, coords)`. In the reserved branch, after the `r.endereco ? …` line of the returned array, insert:

```js
      (() => { const p = slotCoord(r, coords);
        return p ? `<div class="geo"><a href="geo:${fmtCoord(p)}">abrir no mapa</a></div>` : ''; })(),
```

3c. `buildTeamPanel(group)` → `buildTeamPanel(group, coords)`; the card map becomes
`return !r.reservado && edge ? buildLivreEdgeRow(r) : buildSlotCard(r, coords);`.
After the `const cards = …` statement, add:

```js
    // Route links only when >= 2 reserved visits have coordinates.
    // Tapping the Google Maps link sends that leg's coordinates to
    // Google — a deliberate user action, never automatic.
    const stops = group.rows
      .filter((r) => r.reservado)
      .map((r) => {
        const p = slotCoord(r, coords);
        return p ? { lat: p.lat, lon: p.lon, name: `${r.horaInicio} ${r.nome || r.controle}` } : null;
      })
      .filter(Boolean);
    let rota = '';
    if (stops.length >= 2) {
      const legs = chunkRoute(stops, 10);
      const links = legs.map((leg, i) =>
        `<a href="${e(gmapsRouteUrl(leg))}">Google Maps${legs.length > 1 ? ` ${i + 1}` : ''}</a>`);
      links.push(
        `<a href="${e(gpxDataUri(buildGpx(stops)))}" download="rota-${e(window.__sigcPro.slug(group.equipe))}.gpx">GPX</a>`);
      rota = `<div class="rota">Rota: ${links.join(' &nbsp;·&nbsp; ')}</div>`;
    }
```

and add `rota,` to the returned array right after the `zonas.length ? …` line.

3d. `buildGuideHtml(meta, groups, allRows)` → `buildGuideHtml(meta, groups, allRows, coords)`; the panels line becomes `...groups.map((g) => ({ label: g.equipe, html: buildTeamPanel(g, coords) })),`.

3e. In the inline CSS, after the `.livre-edge { … }` line add:

```css
a { color: #005a9c; }
.geo, .rota { font-size: .92rem; margin-top: .1rem; }
```

and extend the print rule to `@media print { .tabs, .geo, .rota { display: none; } }` (links are useless on paper).

3f. Rewire the bottom: rename `exportGuide` to `generate(coords)`, changing only the signature and the build call (`const html = buildGuideHtml(meta, groups, rows, coords || null);`); keep alerts/logging identical. Then:

```js
  function exportGuide() {
    generate(null);
  }
```

(the button keeps calling `exportGuide`), and inside the `whenReadyGeneric` callback — or right before it, still inside the IIFE — add:

```js
  // Consumed by agenda-map ("Guia + Mapa"): same pipeline, plus coords.
  window.__sigcPro.dayGuide = { generate, diaViewActive };
```

- [ ] **Step 4: Verify**

```bash
bun /tmp/agenda-map-guide-test.js && \
bun build --no-bundle extension/features/agenda-day-guide/agenda-day-guide.js > /dev/null && \
echo SYNTAX-OK && ./scripts/check-privacy.sh
```
Expected: `ALL PASS`, `SYNTAX-OK`, `privacy gate: CLEAN` (the Google Maps literal URL lives in day-guide, which is allowed — only agenda-map bans absolute URLs).

- [ ] **Step 5: Commit**

```bash
git add extension/features/agenda-day-guide/ && \
git commit -m "feat: day guide accepts coords — geo links, GPX, Google Maps route"
```

---

### Task 3: agenda-map pure builders (URL, body, table→coords)

**Files:**
- Modify: `extension/common/sigc-common.js` (export `normalizeLabel` — one line in the export block, after `MISSING_VALUES,`)
- Create: `extension/features/agenda-map/agenda-map.js`

**Interfaces:**
- Consumes: `window.__sigcPro.{PESQUISAS, normalizeLabel, parseCoord}`.
- Produces (private, Task 4 uses): `f5Prefix(pathname) -> {prefix, hex}|null`, `filtrarUrl(origin, pathname, simple) -> string`, `filtroBody(uf, controle) -> string`, `tableToCoordsMap(headers, rows) -> Map|null` (pure), `parseEnderecosHtml(html) -> Map|null` (DOMParser wrapper).

- [ ] **Step 1: Write the failing mirror test**

Create `/tmp/agenda-map-parse-test.js`. Mirror `f5Prefix`, `filtrarUrl`, `filtroBody`, `tableToCoordsMap` from Step 3 below, with these stand-ins for the `window.__sigcPro` dependencies (copied from sigc-common.js so behavior matches):

```js
const normalizeLabel = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
function parseCoord(v) {
  const s = String(v ?? '').trim();
  if (s === '' || s === '-') return null;
  const dms = s.match(/^(-?\d{1,3})[°\s]+(\d{1,2})['\s]+(\d{1,2}(?:[.,]\d+)?)["\s]*([NSEWO])?$/i);
  if (dms) {
    const deg = Math.abs(parseInt(dms[1], 10));
    const min = parseInt(dms[2], 10);
    const sec = Number(dms[3].replace(',', '.'));
    if (!Number.isFinite(sec) || min >= 60 || sec >= 60) return null;
    let value = deg + min / 60 + sec / 3600;
    const hemi = (dms[4] || '').toUpperCase();
    if (hemi === 'S' || hemi === 'W' || hemi === 'O' || dms[1].startsWith('-')) value = -value;
    return value;
  }
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
const COLS = { controle: { label: 'Controle' }, nDomicilio: { label: 'N.º Domicilio' },
  latitude: { label: 'Latitude' }, longitude: { label: 'Longitude' } };
```

(in the mirror, `tableToCoordsMap` reads `COLS`/`normalizeLabel`/`parseCoord` directly; in the feature file they come from `window.__sigcPro` — that is the ONLY allowed difference). Then assertions:

```js
let fail = 0;
const ok = (cond, label) => { if (!cond) { console.log(`FAIL ${label}`); fail++; } };
const eq = (got, want, label) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { console.log(`FAIL ${label}: got ${g} want ${w}`); fail++; }
};

// f5Prefix
const HEX = '68747470733a2f2f773373696763706e73323032352e696267652e676f762e6272';
eq(f5Prefix(`/f5-w-${HEX}$$/relatorio/AdministracaoAgenda`), { prefix: `/f5-w-${HEX}$$`, hex: HEX }, 'prefix extracted');
eq(f5Prefix('/relatorio/AdministracaoAgenda'), null, 'no prefix on direct host');

// filtrarUrl
const O = 'https://portalweb.ibge.gov.br';
eq(filtrarUrl(O, `/f5-w-${HEX}$$/x`, true), `${O}/f5-w-${HEX}$$/relatorio/filtrar?slug=ListaEnderecos`, 'simple prefixed form');
eq(filtrarUrl(O, `/f5-w-${HEX}$$/x`, false),
   `${O}/f5-w-${HEX}$$/relatorio/f5-h-$$/relatorio/filtrar?slug=ListaEnderecos;F5_origin=${HEX}&F5CH=I`, 'full F5 form');
eq(filtrarUrl(O, '/x', true), `${O}/relatorio/filtrar?slug=ListaEnderecos`, 'direct host form');
eq(filtrarUrl(O, '/x', false), `${O}/relatorio/filtrar?slug=ListaEnderecos`, 'direct host ignores simple flag');

// filtroBody — must match the captured request byte-for-byte
eq(filtroBody('29', '292100505000029'),
   'filtro=' + encodeURIComponent('{"IdFiltro":"ListaEnderecos","IdUf":"29","IdAgencia":"*","IdMunicipio":"*","Controle":"292100505000029","TipoVisualizacao":"S"}'),
   'filtro body matches capture');

// tableToCoordsMap — headers from the captured response, order-independent
const HEADERS = ['Controle', 'ID_CNEFE', 'N.º Domicilio', 'Quadra', 'Face', 'Logradouro', 'Número',
  'Complemento', 'Bairro', 'Latitude', 'Longitude', 'Telefone', 'Morador', 'Situação',
  'Selecionado', 'Antropometria', 'Biomarcadores', 'ID Zona', 'Nome ZONA'];
const row = (c, d, lat, lon) => { const r = new Array(19).fill(''); r[0] = c; r[2] = d; r[9] = lat; r[10] = lon; return r; };
const m = tableToCoordsMap(HEADERS, [
  row('29X', '2', '13 28 41.5514 S', '39 06 20.4723 O'),
  row('29X', '3', '', ''),                       // missing coords -> skipped
  row('', '4', '1 0 0 S', '1 0 0 O'),            // missing controle -> skipped
]);
ok(m.size === 1, 'only complete rows kept');
const p = m.get('29X|2');
ok(p && Math.abs(p.lat - (-(13 + 28 / 60 + 41.5514 / 3600))) < 1e-9, 'DMS S -> negative decimal');
ok(p && Math.abs(p.lon - (-(39 + 6 / 60 + 20.4723 / 3600))) < 1e-9, 'DMS O -> negative decimal');

// column resolution is by label: shuffled headers still work
const SHUF = ['Latitude', 'Controle', 'Longitude', 'N.º Domicilio'];
const m2 = tableToCoordsMap(SHUF, [['13 28 41.5514 S', 'C9', '39 06 20.4723 O', '7']]);
ok(m2 && m2.has('C9|7'), 'label-based column resolution');

// header mismatch -> null (never a wrong-column join)
ok(tableToCoordsMap(['Foo', 'Bar'], []) === null, 'unknown headers -> null');

console.log(fail === 0 ? 'ALL PASS' : `${fail} FAILURES`);
```

- [ ] **Step 2: Run until ALL PASS**

Run: `bun /tmp/agenda-map-parse-test.js` — iterate on the mirror functions until `ALL PASS`.

- [ ] **Step 3: Create the feature file**

Add `normalizeLabel,` to sigc-common.js's `window.__sigcPro = {` export block (immediately after `MISSING_VALUES,`).

Create `extension/features/agenda-map/agenda-map.js`:

```js
// SIGC-PRO feature: "Guia + Mapa" — the ONLY file in this extension
// allowed to make a network request, and only to the SIGC server the
// user is already logged into (URL built from location.origin; the
// privacy gate rejects absolute URLs in this directory). Opt-in: each
// page load, the first click asks for confirmation before any request.
// It fetches the Lista de Endereços report per Controle (POST
// /relatorio/filtrar, an HTML fragment), extracts coordinates, and
// hands them to window.__sigcPro.dayGuide.generate(coords) — the same
// day-guide pipeline, now with geo links, GPX, and route links.
// Spec: docs/superpowers/specs/2026-07-16-agenda-map-design.md
(function () {
  'use strict';

  const TAG = '[sigc-agenda-map]';

  // --- pure helpers --------------------------------------------------

  // F5 BIG-IP URL-rewriting prefix ("/f5-w-<hex>$$"); the hex decodes to
  // the real backend origin. null on the direct host (e.g. via VPN).
  function f5Prefix(pathname) {
    const m = /^\/f5-w-([0-9a-f]+)\$\$/.exec(String(pathname || ''));
    return m ? { prefix: m[0], hex: m[1] } : null;
  }

  // simple=true: plain prefixed path. simple=false: replicate the shape
  // captured from the live gateway (f5-h-$$ segment + F5_origin/F5CH
  // params). postFiltrar tries simple first, then falls back.
  function filtrarUrl(origin, pathname, simple) {
    const f5 = f5Prefix(pathname);
    if (!f5) return `${origin}/relatorio/filtrar?slug=ListaEnderecos`;
    return simple
      ? `${origin}${f5.prefix}/relatorio/filtrar?slug=ListaEnderecos`
      : `${origin}${f5.prefix}/relatorio/f5-h-$$/relatorio/filtrar?slug=ListaEnderecos;F5_origin=${f5.hex}&F5CH=I`;
  }

  function filtroBody(uf, controle) {
    return 'filtro=' + encodeURIComponent(JSON.stringify({
      IdFiltro: 'ListaEnderecos',
      IdUf: String(uf),
      IdAgencia: '*',
      IdMunicipio: '*',
      Controle: String(controle),
      TipoVisualizacao: 'S',
    }));
  }

  // headers/rows: plain string arrays from the response table. Columns
  // are resolved by label against the shared PESQUISAS registry, so a
  // backend column reorder can never silently join the wrong columns —
  // unknown headers return null (caller treats as failure).
  function tableToCoordsMap(headers, rows) {
    const P = window.__sigcPro;
    const cols = P.PESQUISAS.PNS2026.columns;
    const idx = {};
    for (const key of ['controle', 'nDomicilio', 'latitude', 'longitude']) {
      const i = headers.findIndex(
        (h) => P.normalizeLabel(h) === P.normalizeLabel(cols[key].label));
      if (i === -1) return null;
      idx[key] = i;
    }
    const map = new Map();
    rows.forEach((cells) => {
      const controle = String(cells[idx.controle] || '').trim();
      const domicilio = String(cells[idx.nDomicilio] || '').trim();
      const lat = P.parseCoord(cells[idx.latitude]);
      const lon = P.parseCoord(cells[idx.longitude]);
      if (controle && domicilio && lat != null && lon != null) {
        map.set(`${controle}|${domicilio}`, { lat, lon });
      }
    });
    return map;
  }

  // Response HTML fragment -> coords map. DOMParser is inert: nothing
  // in the fetched markup can load resources or run handlers.
  function parseEnderecosHtml(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const table = doc.querySelector('#tableRelatorio');
    if (!table) return null;
    const headers = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    const rows = [...table.querySelectorAll('tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()));
    return tableToCoordsMap(headers, rows);
  }
})();
```

Confirm the four pure functions are byte-identical to the mirror except the declared `window.__sigcPro` indirection in `tableToCoordsMap`.

- [ ] **Step 4: Verify**

```bash
bun build --no-bundle extension/features/agenda-map/agenda-map.js > /dev/null && \
echo SYNTAX-OK && ./scripts/check-privacy.sh && \
bun build --no-bundle extension/common/sigc-common.js > /dev/null && echo COMMON-OK
```
Expected: `SYNTAX-OK`, `privacy gate: CLEAN` (no fetch yet, no URLs), `COMMON-OK`.

- [ ] **Step 5: Commit**

```bash
git add extension/ && \
git commit -m "feat: agenda-map pure builders — F5 URL, filtro body, coords parsing"
```

---

### Task 4: agenda-map fetch, consent, button, manifest

**Files:**
- Modify: `extension/features/agenda-map/agenda-map.js` (append before `})();`)
- Modify: `extension/manifest.json`

**Interfaces:**
- Consumes: Task 3 helpers; `window.__sigcPro.{readAgendaSlots, onAgendaPage, findAgendaToolbarChunk, whenReadyGeneric, dayGuide.generate, dayGuide.diaViewActive}`.
- Produces: the user-visible feature.

- [ ] **Step 1: Append the network + UI wiring**

```js
  // --- network (the sanctioned exception) -----------------------------

  // Tries the simple prefixed URL first, then the full captured F5 form
  // (identical on the direct host, where the Set collapses them).
  async function postFiltrar(uf, controle) {
    const urls = [...new Set([
      filtrarUrl(location.origin, location.pathname, true),
      filtrarUrl(location.origin, location.pathname, false),
    ])];
    let lastErr = new Error('sem resposta');
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: filtroBody(uf, controle),
        });
        if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); continue; }
        const map = parseEnderecosHtml(await res.text());
        if (map) return map;
        lastErr = new Error('tabela não reconhecida');
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }

  // One sequential POST per distinct Controle (typically 1-5 per day).
  async function fetchCoords(uf, controles) {
    const all = new Map();
    for (const c of controles) {
      (await postFiltrar(uf, c)).forEach((v, k) => all.set(k, v));
    }
    return all;
  }

  // --- UI --------------------------------------------------------------

  const BUTTON_ID = 'sigc-pro-agenda-mapa-button';

  // In-memory only (zero-storage guarantee): re-asked on every page load.
  let consentGiven = false;
  const CONSENT_MSG =
    'SIGC-PRO: isto fará uma consulta ao próprio servidor do SIGC para ' +
    'obter as coordenadas dos endereços. Nenhum dado sai do IBGE. Continuar?';

  async function exportGuideMap(btn) {
    if (!consentGiven) {
      if (!confirm(CONSENT_MSG)) return;
      consentGiven = true;
    }
    const rows = window.__sigcPro.readAgendaSlots();
    if (rows.length === 0) {
      alert('SIGC-PRO: nenhum slot encontrado na agenda — confira se UF/dia já carregaram.');
      return;
    }
    const ufSelect = document.getElementById('selectUf');
    const uf = ufSelect ? ufSelect.value : '';
    const controles = [...new Set(
      rows.filter((r) => r.reservado).map((r) => r.controle).filter(Boolean))];

    let coords = null;
    if (uf && controles.length > 0) {
      btn.disabled = true;
      try {
        coords = await fetchCoords(uf, controles);
        console.log(`${TAG} ${coords.size} coordenada(s) de ${controles.length} controle(s).`);
      } catch (err) {
        alert(`SIGC-PRO: não foi possível obter coordenadas (${err && err.message}); ` +
          'o guia será gerado sem mapa.');
      } finally {
        btn.disabled = false;
      }
    } else {
      alert('SIGC-PRO: nenhum controle reservado no dia — o guia será gerado sem mapa.');
    }
    window.__sigcPro.dayGuide.generate(coords);
  }

  function insertButton(chunk) {
    if (document.getElementById(BUTTON_ID)) return;
    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    btn.className = 'fc-button fc-button-primary';
    btn.textContent = 'Guia + Mapa';
    btn.title = 'Guia do dia com mapa — faz uma consulta ao servidor do SIGC (SIGC-PRO)';
    btn.style.background = '#005a9c';
    btn.style.borderColor = '#005a9c';
    btn.style.marginLeft = '4px';
    btn.addEventListener('click', () => { exportGuideMap(btn); });
    chunk.appendChild(btn);
    console.log(`${TAG} Guia + Mapa button added.`);
  }

  // Same Dia-only visibility as Guia do Dia, reusing its detector.
  window.__sigcPro.whenReadyGeneric(
    () => window.__sigcPro.onAgendaPage() && window.__sigcPro.findAgendaToolbarChunk() &&
      window.__sigcPro.dayGuide,
    () => {
      const tryUpdate = () => {
        const existing = document.getElementById(BUTTON_ID);
        const chunk = window.__sigcPro.findAgendaToolbarChunk();
        if (window.__sigcPro.onAgendaPage() && chunk && window.__sigcPro.dayGuide.diaViewActive()) {
          if (!existing) insertButton(chunk);
        } else if (existing) {
          existing.remove();
        }
      };
      tryUpdate();
      new MutationObserver(tryUpdate).observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class'],
      });
    }
  );
```

- [ ] **Step 2: Register in the manifest**

`content_scripts[0].js` gains `"features/agenda-map/agenda-map.js"` as the last entry (after `agenda-day-guide`). Do not touch `version`.

- [ ] **Step 3: Verify**

```bash
bun build --no-bundle extension/features/agenda-map/agenda-map.js > /dev/null && \
echo SYNTAX-OK && ./scripts/check-privacy.sh
```
Expected: `SYNTAX-OK`, `privacy gate: CLEAN` (fetch is inside agenda-map; no absolute URLs there).

- [ ] **Step 4: Live verification (needs SIGC access — hand to the user if the executor has none)**

1. Reload extension, open Agenda, Dia view: both "Guia do Dia" and "Guia + Mapa" buttons appear; Semana: both disappear.
2. Click "Guia + Mapa": consent dialog appears exactly once per page load; declining downloads nothing.
3. Accepting: DevTools Network shows only POSTs to `<origin>…/relatorio/filtrar` (one per distinct controle), nothing else.
4. Downloaded guide: visit cards show "abrir no mapa" (tap on a phone opens the map app at the point); team panels with ≥2 located visits show "Rota: Google Maps · GPX"; GPX imports into Organic Maps/OsmAnd; Google Maps link opens the route with visits in time order.
5. "Guia do Dia" (plain) still produces the same output as before, zero requests.
6. Note in the report which URL form worked (simple vs full F5) — if simple works through the gateway, a follow-up commit may drop the fallback.

- [ ] **Step 5: Commit**

```bash
git add extension/ && \
git commit -m "feat: Guia + Mapa — opt-in same-origin coordinates fetch"
```

---

### Task 5: Policy texts, Pages, ROADMAP

**Files:**
- Modify: `docs/PRIVACY_POLICY.html`, `README.md`, `docs/store-listing.md`, `docs/index.html`, `ROADMAP.md`

The invariant: after this task, no repo text claims "nenhuma chamada de rede" without the exception, and the exception is described identically everywhere: *uma consulta opcional, acionada por clique e confirmada pelo usuário, ao próprio servidor do SIGC (mesma sessão); nada é enviado a terceiros nem ao desenvolvedor.*

- [ ] **Step 1: PRIVACY_POLICY.html**

- Update `Última atualização:` to `17 de julho de 2026`.
- `destaque` box: replace the sentence with: `Resumo: o SIGC-PRO NÃO coleta, NÃO transmite e NÃO armazena nenhum dado para o desenvolvedor ou para terceiros. A única comunicação de rede é uma consulta opcional, acionada por clique e confirmada pelo usuário, ao próprio servidor do SIGC — dentro da sessão já autenticada. Nenhuma informação sai do circuito usuário–IBGE.`
- Section "2. Coleta e transmissão de dados": replace the paragraph with: `Quase nenhuma. O recurso opcional “Guia + Mapa” faz, somente quando o usuário clica e confirma, uma requisição ao próprio servidor do SIGC (mesma origem da página) para obter as coordenadas dos endereços do dia; a resposta é processada localmente e nada é retransmitido. Fora isso, o código não contém chamadas de rede nem carrega recursos externos — a verificação automática do repositório (scripts/check-privacy.sh) garante que requisições só podem existir nesse único módulo e só para a própria origem. Não há telemetria, análise de uso ou qualquer integração com serviços de terceiros.`
- Section "5.": replace `Todo o código executável são três arquivos JavaScript publicados neste repositório.` with `Todo o código executável são os arquivos JavaScript publicados neste repositório.` (count was stale).

- [ ] **Step 2: README.md (## Privacidade section)**

Replace `não faz nenhuma chamada de rede` with `não faz chamadas de rede — exceto o recurso opcional “Guia + Mapa”, que consulta o próprio servidor do SIGC mediante clique e confirmação (nada vai a terceiros)`. In the sentence about the gate (`que introduza APIs de rede ou armazenamento em 'extension/'`), append: ` (exceção única e auditada: 'fetch' em 'features/agenda-map/', que não pode conter URLs absolutas)`.

- [ ] **Step 3: docs/store-listing.md**

Same substitution as README for the `não faz nenhuma chamada de rede` sentence. Leave the short description (line 6) unchanged — "sem coleta de dados" remains true.

- [ ] **Step 4: docs/index.html**

- In the Guia do Dia card, append to the paragraph: ` Com o botão <strong>Guia + Mapa</strong> (opcional, mediante confirmação), o guia inclui links de navegação (geo:), rota no Google Maps e arquivo GPX — obtendo as coordenadas do próprio servidor do SIGC.`
- In the closing privacy paragraph, replace `não pede nenhuma permissão: nenhuma chamada de rede, nenhum armazenamento` with `não pede nenhuma permissão e não armazena nada; a única chamada de rede é a consulta opcional do Guia + Mapa ao próprio servidor do SIGC, mediante clique e confirmação`.
- Do not touch the `versão x.y.z` marker.

- [ ] **Step 5: ROADMAP.md**

Add to `## Done (v0.1.x)`, after the Guia do Dia entry:

```markdown
- [x] Agenda "Guia + Mapa": opt-in coordinates fetch from SIGC's own
      /relatorio/filtrar (same-origin, click+confirm, quarantined in
      features/agenda-map/ by the reworked privacy gate) feeding the day
      guide with geo: links, per-team GPX (data: URI), and chunked
      Google Maps route links (`2026-07-16-agenda-map-design.md`)
```

- [ ] **Step 6: Verify and commit**

```bash
./scripts/check-privacy.sh && \
grep -rn "nenhuma chamada de rede" README.md docs/ | grep -v "única chamada" ; echo "grep exit $? (1 = no stale claims, good)"
git add docs/ README.md ROADMAP.md && \
git commit -m "docs: privacy texts updated for the Guia + Mapa opt-in fetch"
```

---

## Self-review notes

- Spec coverage: gate rework + tripwire (Task 1), guide integration incl. geo/GPX/route + print hiding (Task 2), URL/body/parsing with label-based columns and captured-request fidelity (Task 3), consent/fetch/button/manifest + live checklist incl. URL-form question (Task 4), policy texts everywhere the claim exists (Task 5). Out-of-scope items (SVG sketch, travel-sanity, caching) not implemented anywhere.
- Interface names consistent: `dayGuide.generate/diaViewActive` produced in Task 2, consumed in Task 4; `filtrarUrl/filtroBody/tableToCoordsMap/parseEnderecosHtml` produced Task 3, consumed Task 4.
- Gate ordering: Task 1 lands the carve-out before Task 4 introduces `fetch(`, so every intermediate commit passes the pre-commit hook.
- The mirror-vs-feature `window.__sigcPro` indirection in Task 3 is declared explicitly as the only allowed difference.
