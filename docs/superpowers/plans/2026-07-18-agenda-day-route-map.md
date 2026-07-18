# Agenda Day-Route Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an inline SVG day-route sketch to the Guia do Dia — a combined all-teams map on the Resumo tab and a per-team map on each team tab — built purely from the `enderecos` coordinates the guide already receives, with zero new network calls.

**Architecture:** All new code lives in the existing `extension/features/agenda-day-guide/agenda-day-guide.js` (no new file — this is the file that already owns `enderecos`-aware rendering). Four pure-function layers, each consumed by the next: (1) bounding-box + equirectangular projection, (2) an 8-color Okabe-Ito palette with per-equipe assignment, (3) an SVG string builder (dots, sequence numbers, time labels, route line, scale bar, north arrow, coordinate-less note) consuming 1+2, (4) two call sites wiring the SVG into `buildSummaryPanel` (combined) and `buildTeamPanel` (per-team), plus new CSS. Every new function is a no-op / renders nothing when there's nothing to plot, so the plain (no `enderecos`) guide stays byte-identical — the same guarantee every other `enderecos`-optional piece of this file already has.

**Tech Stack:** Vanilla ES2020, Chrome MV3 MAIN-world content scripts. `bun` for everything (node absent from PATH): syntax via `bun build --no-bundle`, throwaway mirror tests in `/tmp` (byte-identical copies of the pure helpers, `bun /tmp/<name>.js`, must print `ALL PASS` before the helpers are pasted verbatim into the real file). Spec: `docs/superpowers/specs/2026-07-18-agenda-day-route-map-design.md`.

## Global Constraints

- No new `<script>`, no external refs, no network calls — the guide stays a fully self-contained, printable HTML file (`docs/superpowers/specs/2026-07-16-agenda-day-guide-design.md`).
- Every new builder is a no-op (renders `''`) when there is nothing to plot; the plain Guia do Dia (no `enderecos`) output must stay byte-identical to today.
- Projection: equirectangular with longitude corrected by `cos(meanLat)` — `x = lon * cos(meanLat)`, `y = lat` (spec, Rendering).
- Team colors: fixed 8-color Okabe-Ito palette `#E69F00, #56B4E9, #009E73, #F0E442, #0072B2, #D55E00, #CC79A7, #000000`; teams sorted by name (same order `groupByEquipe` already produces) map to palette indices `0, 1, 2, …`, cycling with `% 8` past eight teams (spec, Team colors).
- Sequence numbers restart at 1 per row set (per team, and per team within the combined map) — never a single day-wide numbering (spec, Data).
- 1 plottable visit → dot only, no line. 0 plottable visits → no map section renders at all for that row set (spec, Rendering / Edge cases).
- Coordinate-less reserved visits (an `enderecos` entry with `zona`/`idZona` but null `lat`/`lon`, or no entry at all) are never silently dropped — listed under the map as "N visita(s) sem coordenadas válidas: <hora> <nome ou controle>" (spec, Edge cases).
- No interactivity: dots are plain `<circle>`/`<text>`, never wrapped in `<a>` (spec, Rendering).
- Lab tab never gets a map section (spec, Placement).
- `./scripts/check-privacy.sh` must stay clean after every task (no new APIs — this is pure string building, same posture as the rest of the file).
- Existing exact behavior/functions must not change: `groupByEquipe`, `computeStats`, `zonasUnion`, `slotInfo`, `zonaLabel`, `fmtCoord`, `chunkRoute`, `gmapsRouteUrl`, `buildSlotCard`, `buildDayGrid`, `TABLE_CSS`, `guideMeta`, `fileName`, `generate`, `window.__sigcPro.dayGuide` shape (`{ generate, diaViewActive }`).

---

### Task 1: Projection — bounding box and equirectangular fit

**Files:**
- Modify: `extension/features/agenda-day-guide/agenda-day-guide.js`

**Interfaces:**
- Consumes: nothing new (pure math over `{lat, lon}` point arrays).
- Produces (Task 3 relies on): `projectPoints(points, width, height, padding)` where `points` is `Array<{lat: number, lon: number}>` (length ≥ 1) and the function returns `{ projected: Array<{x: number, y: number}>, scaleBarKm: number, scaleBarPx: number }`. `projected[i]` corresponds to `points[i]` in order. `x`/`y` are SVG pixel coordinates already fit inside `[padding, width-padding] × [padding, height-padding]`, with `y` increasing downward (SVG convention) while north (`lat` increasing) is up. A single point centers in the viewport at a fixed default scale (no spread to fit).

- [ ] **Step 1: Write the failing mirror test**

Create `/tmp/agenda-day-route-map-test.js`:

```js
let fail = 0;
const ok = (cond, label) => { if (!cond) { console.log(`FAIL ${label}`); fail++; } };
const approx = (got, want, tol, label) => {
  if (Math.abs(got - want) > tol) { console.log(`FAIL ${label}: got ${got} want ~${want}`); fail++; }
};

// --- projectPoints ---

// Single point: centers in viewport, no line/scale ambiguity.
{
  const { projected } = projectPoints([{ lat: -12.97, lon: -38.5 }], 480, 320, 20);
  ok(projected.length === 1, 'single point: one projected coord');
  approx(projected[0].x, 240, 1, 'single point centers x');
  approx(projected[0].y, 160, 1, 'single point centers y');
}

// Two points spread on both axes: fit inside padded viewport, north stays up
// (smaller lat -> larger y, since SVG y grows downward).
{
  const pts = [{ lat: -12.90, lon: -38.60 }, { lat: -13.00, lon: -38.50 }];
  const { projected } = projectPoints(pts, 480, 320, 20);
  ok(projected.every((p) => p.x >= 20 && p.x <= 460 && p.y >= 20 && p.y <= 300),
    'all points inside padded viewport');
  ok(projected[0].y < projected[1].y, 'more-negative (southern) lat has larger y (further down)');
  ok(projected[0].x < projected[1].x, 'more-negative (western) lon has smaller x (further left)');
}

// Longitude correction: at high |lat|, a degree of longitude covers less
// ground than a degree of latitude. Two points 0.1 deg apart in lon only,
// vs two points 0.1 deg apart in lat only, at the same |lat| ~ -13:
// the lon-only pair's projected x-span should be smaller than the
// lat-only pair's y-span (since cos(13deg) < 1).
{
  const lonPair = [{ lat: -13, lon: -38.5 }, { lat: -13, lon: -38.4 }];
  const latPair = [{ lat: -13, lon: -38.5 }, { lat: -12.9, lon: -38.5 }];
  const w = 1000, h = 1000, pad = 20; // square viewport isolates the correction
  const { projected: lonP } = projectPoints(lonPair, w, h, pad);
  const { projected: latP } = projectPoints(latPair, w, h, pad);
  const lonSpanPx = Math.abs(lonP[1].x - lonP[0].x);
  const latSpanPx = Math.abs(latP[1].y - latP[0].y);
  // Both pairs are independently fit to fill the same viewport, so this
  // test isolates the correction differently: fit BOTH pairs together in
  // one call and check the corrected aspect ratio directly instead.
}

// Direct check of the correction formula on a combined set: 4 points
// forming a lon-degree x lat-degree box; the corrected physical
// width:height ratio must be close to cos(meanLat), not 1.
{
  const meanLat = -13;
  const pts = [
    { lat: meanLat - 0.05, lon: -38.55 }, { lat: meanLat - 0.05, lon: -38.45 },
    { lat: meanLat + 0.05, lon: -38.55 }, { lat: meanLat + 0.05, lon: -38.45 },
  ];
  const w = 2000, h = 2000, pad = 0; // large square, no padding: projected
  // span in px is proportional to physical span, so the px aspect ratio
  // approximates the physical aspect ratio.
  const { projected } = projectPoints(pts, w, h, pad);
  const xs = projected.map((p) => p.x), ys = projected.map((p) => p.y);
  const xSpan = Math.max(...xs) - Math.min(...xs);
  const ySpan = Math.max(...ys) - Math.min(...ys);
  // Raw lon span = 0.1 deg, raw lat span = 0.1 deg -> corrected physical
  // lon span = 0.1 * cos(13deg) ~= 0.0974 deg-equivalent, lat span = 0.1.
  // Since projectPoints fits the corrected box into the square viewport
  // preserving aspect ratio, xSpan/ySpan ~= cos(13deg) ~= 0.9744.
  const expectedRatio = Math.cos(meanLat * Math.PI / 180) * -1 * -1; // cos(-13deg) == cos(13deg)
  approx(xSpan / ySpan, Math.abs(expectedRatio), 0.02, 'corrected aspect ratio ~= cos(meanLat)');
}

// scaleBarKm / scaleBarPx: present, positive, and scaleBarPx fits in the
// viewport (it's meant to be drawn as a short bar in a corner).
{
  const pts = [{ lat: -12.90, lon: -38.60 }, { lat: -13.00, lon: -38.50 }];
  const { scaleBarKm, scaleBarPx } = projectPoints(pts, 480, 320, 20);
  ok(scaleBarKm > 0, 'scaleBarKm positive');
  ok(scaleBarPx > 0 && scaleBarPx < 480, 'scaleBarPx positive and fits viewport width');
}

console.log(fail === 0 ? 'ALL PASS' : `${fail} FAILURES`);
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `bun /tmp/agenda-day-route-map-test.js`
Expected: `ReferenceError: Can't find variable: projectPoints` (or similar — the function doesn't exist in this scratch file yet).

- [ ] **Step 3: Implement `projectPoints` in the mirror test file**

Paste this at the top of `/tmp/agenda-day-route-map-test.js`, above the test code from Step 1:

```js
// Fits `points` (lat/lon) into an SVG-pixel box of `width`x`height` with
// `padding` on every side, using an equirectangular projection corrected
// for longitude compression at this latitude: physical x is proportional
// to lon * cos(meanLat), physical y to lat. A single point centers with a
// small fixed default span (nothing to fit a scale to). Also returns a
// friendly rounded scale-bar length (scaleBarKm) and its pixel width
// (scaleBarPx) for the caller to draw.
function projectPoints(points, width, height, padding) {
  const meanLat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const cosLat = Math.cos(meanLat * Math.PI / 180);
  // Physical-ish units: degrees, with longitude compressed by cosLat so
  // equal physical distances in lat and lon map to equal plot distances.
  const px = (p) => p.lon * cosLat;
  const py = (p) => p.lat;

  const innerW = width - 2 * padding;
  const innerH = height - 2 * padding;

  let minX, maxX, minY, maxY, spanX, spanY;
  if (points.length === 1) {
    // No spread to fit: center with a small fixed default span so the
    // single dot sits in the middle rather than at a degenerate corner.
    const DEFAULT_SPAN_DEG = 0.01; // ~1.1km of latitude, plenty for one dot
    const x0 = px(points[0]), y0 = py(points[0]);
    minX = x0 - DEFAULT_SPAN_DEG / 2; maxX = x0 + DEFAULT_SPAN_DEG / 2;
    minY = y0 - DEFAULT_SPAN_DEG / 2; maxY = y0 + DEFAULT_SPAN_DEG / 2;
  } else {
    const xs = points.map(px), ys = points.map(py);
    minX = Math.min(...xs); maxX = Math.max(...xs);
    minY = Math.min(...ys); maxY = Math.max(...ys);
  }
  spanX = maxX - minX || 1e-9;
  spanY = maxY - minY || 1e-9;

  // Preserve aspect ratio: scale by whichever axis is tighter, so the
  // sketch's shape isn't stretched to fill a non-matching viewport.
  const scale = Math.min(innerW / spanX, innerH / spanY);
  const usedW = spanX * scale, usedH = spanY * scale;
  const offX = padding + (innerW - usedW) / 2;
  const offY = padding + (innerH - usedH) / 2;

  const projected = points.map((p) => ({
    x: offX + (px(p) - minX) * scale,
    // y grows downward in SVG; lat grows northward, so flip.
    y: offY + (maxY - py(p)) * scale,
  }));

  // Scale bar: a friendly rounded real-world distance approximating a
  // fraction of the plotted span, converted back to pixels via the same
  // scale. 1 degree of latitude ~= 111.32 km.
  const KM_PER_DEG_LAT = 111.32;
  const spanKm = spanY * KM_PER_DEG_LAT;
  const targetKm = spanKm > 0 ? spanKm / 4 : 0.5;
  const NICE = [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 50, 100];
  const scaleBarKm = NICE.reduce((best, n) =>
    Math.abs(n - targetKm) < Math.abs(best - targetKm) ? n : best, NICE[0]);
  const scaleBarPx = (scaleBarKm / KM_PER_DEG_LAT) * scale;

  return { projected, scaleBarKm, scaleBarPx };
}
```

- [ ] **Step 4: Run it, iterate until ALL PASS**

Run: `bun /tmp/agenda-day-route-map-test.js`
Expected: `ALL PASS`. If the aspect-ratio test fails, check the sign/order in `expectedRatio` and that `px`/`py` are applied consistently in both the span computation and the projection.

- [ ] **Step 5: Paste `projectPoints` into the real file**

In `extension/features/agenda-day-guide/agenda-day-guide.js`, insert the function verbatim (identical to the Step 3 code block above, including its comment) right after the closing `}` of `gmapsRouteUrl` (currently ending at line 123) and before the `// --- HTML builders ------------------------------------------------` comment (currently line 125). Add a new section comment directly above it:

```js
  // --- SVG day-route map ----------------------------------------------
  // Spec: docs/superpowers/specs/2026-07-18-agenda-day-route-map-design.md

```

- [ ] **Step 6: Syntax check**

Run: `bun build --no-bundle extension/features/agenda-day-guide/agenda-day-guide.js`
Expected: no errors (bun prints the bundled-but-not-bundled output; a parse error would show `error: ...`).

- [ ] **Step 7: Commit**

```bash
git add extension/features/agenda-day-guide/agenda-day-guide.js
git commit -m "feat: add point-projection math for the day-route SVG map"
```

---

### Task 2: Team color palette

**Files:**
- Modify: `extension/features/agenda-day-guide/agenda-day-guide.js`

**Interfaces:**
- Consumes: nothing new.
- Produces (Task 3/4 rely on): `TEAM_COLORS` (a module-level `const` array of 8 hex strings), and `teamColor(equipeIndex)` where `equipeIndex` is the 0-based index of a team within the already-sorted `groups` array (`groupByEquipe`'s output order) and the return value is one of the 8 hex strings, cycling with `% 8`.

- [ ] **Step 1: Write the failing mirror test**

Append to `/tmp/agenda-day-route-map-test.js` (same file as Task 1 — keep accumulating in one mirror file for this feature):

```js
// --- teamColor ---

ok(typeof TEAM_COLORS !== 'undefined' && TEAM_COLORS.length === 8, 'TEAM_COLORS has 8 entries');
ok(new Set(TEAM_COLORS).size === 8, 'TEAM_COLORS entries are all distinct');
ok(teamColor(0) === TEAM_COLORS[0], 'index 0 -> first color');
ok(teamColor(7) === TEAM_COLORS[7], 'index 7 -> last color');
ok(teamColor(8) === TEAM_COLORS[0], 'index 8 wraps to first color (cycling)');
ok(teamColor(9) === TEAM_COLORS[1], 'index 9 wraps to second color');
```

Re-run the full accumulated `console.log(fail === 0 ? 'ALL PASS' : ...)` block only once at the very end of the file — move that line (and the `let fail = 0` / `ok`/`approx` declarations) so they still bookend the whole file: `let fail = 0` and the `ok`/`approx` helpers stay at the top (already there from Task 1), and the final `console.log(...)` line stays at the very bottom, after this new block.

- [ ] **Step 2: Run it, confirm it fails**

Run: `bun /tmp/agenda-day-route-map-test.js`
Expected: `ReferenceError: Can't find variable: TEAM_COLORS`.

- [ ] **Step 3: Implement in the mirror test file**

Add above the Task 2 test block from Step 1:

```js
// Okabe-Ito colorblind-safe 8-color palette (same design system as
// KML export's vermillion/sky-blue pair, extended to the full set here
// since more than 2 teams need distinguishing on the combined map).
const TEAM_COLORS = [
  '#E69F00', '#56B4E9', '#009E73', '#F0E442',
  '#0072B2', '#D55E00', '#CC79A7', '#000000',
];

// equipeIndex: 0-based position of a team within groupByEquipe's
// already-name-sorted output. Cycles past 8 teams.
function teamColor(equipeIndex) {
  return TEAM_COLORS[equipeIndex % TEAM_COLORS.length];
}
```

- [ ] **Step 4: Run it, iterate until ALL PASS**

Run: `bun /tmp/agenda-day-route-map-test.js`
Expected: `ALL PASS`.

- [ ] **Step 5: Paste into the real file**

In `extension/features/agenda-day-guide/agenda-day-guide.js`, insert `TEAM_COLORS` and `teamColor` verbatim (Step 3 code, including its comments) directly after `projectPoints`'s closing `}` (added in Task 1, Step 5).

- [ ] **Step 6: Syntax check**

Run: `bun build --no-bundle extension/features/agenda-day-guide/agenda-day-guide.js`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add extension/features/agenda-day-guide/agenda-day-guide.js
git commit -m "feat: add Okabe-Ito team color palette for the day-route SVG map"
```

---

### Task 3: SVG builder — markers, route, scale bar, north arrow, coordinate-less note

**Files:**
- Modify: `extension/features/agenda-day-guide/agenda-day-guide.js`

**Interfaces:**
- Consumes: `projectPoints` and `teamColor`/`TEAM_COLORS` (Tasks 1–2); `slotInfo(r, enderecos)` and `enderecoKey`/`fmtCoord`-style shape (existing, lines 82–98) — a row `r` is plottable when `slotInfo(r, enderecos)` returns an object with `lat != null`; `escapeHtml` (existing, line 127); `window.__sigcPro.escapeHtml` transitively.
- Produces (Task 4 relies on): `buildRouteMapSvg(rowSets, width, height)` where `rowSets` is `Array<{ rows: Array<row>, color: string }>` (each entry is one team's already-filtered reserved rows in time order, paired with its color — the combined map passes multiple entries, a per-team map passes exactly one) and `enderecos` is threaded in via a second parameter: `buildRouteMapSvg(rowSets, enderecos, width, height)`. Returns a `string` — either a complete `<div class="route-map">...</div>` block (SVG + optional coordinate-less note + optional legend-less styling hook) or `''` when there is nothing plottable in ANY row set. Also produces `buildLegend(groups)` returning a `string` (possibly `''`) of `<span>` swatches for the combined map, consumed only by Task 4.

- [ ] **Step 1: Write the failing mirror test**

Append to `/tmp/agenda-day-route-map-test.js` (before the final `console.log(fail === 0 ...)` line):

```js
// --- buildRouteMapSvg ---

// Minimal fakes: slotInfo/enderecos shape and escapeHtml, matching the
// real file's contracts (slotInfo returns null for non-reserved rows or
// missing entries; escapeHtml is the same char-map used everywhere else
// in this file).
function fakeEscapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const escapeHtml = fakeEscapeHtml; // shadow for the pasted-verbatim builder below
function slotInfo(r, enderecos) {
  return (r.reservado && enderecos && enderecos.get(`${r.controle}|${r.domicilio}`)) || null;
}

const rowA1 = { reservado: true, controle: 'C1', domicilio: '01', horaInicio: '08:15', nome: 'Maria' };
const rowA2 = { reservado: true, controle: 'C1', domicilio: '02', horaInicio: '10:20', nome: 'João' };
const rowNoCoord = { reservado: true, controle: 'C1', domicilio: '03', horaInicio: '14:05', nome: 'Rita' };
const enderecos = new Map([
  ['C1|01', { lat: -12.90, lon: -38.60, zona: 'Z1', idZona: '1' }],
  ['C1|02', { lat: -12.95, lon: -38.55, zona: 'Z1', idZona: '1' }],
  ['C1|03', { lat: null, lon: null, zona: 'Z2', idZona: '2' }],
]);

// Zero plottable rows across all sets -> no section at all.
ok(buildRouteMapSvg([{ rows: [], color: '#E69F00' }], enderecos, 480, 320) === '',
  'empty row set -> empty string');
ok(buildRouteMapSvg([{ rows: [rowNoCoord], color: '#E69F00' }], enderecos, 480, 320) === '',
  'only coordinate-less rows -> empty string (nothing plottable, so no section)');

// One plottable row: dot only, no <line>/<polyline>, numbered 1.
{
  const svg = buildRouteMapSvg([{ rows: [rowA1], color: '#E69F00' }], enderecos, 480, 320);
  ok(svg.includes('<svg'), 'one plottable row -> svg rendered');
  ok(!/<polyline/.test(svg), 'one plottable row -> no route line');
  ok(/>1</.test(svg) || svg.includes('>1<'), 'single dot numbered 1');
  ok(svg.includes('08:15'), 'time label present');
}

// Two plottable rows: route line present, numbered 1 and 2, in time order.
{
  const svg = buildRouteMapSvg([{ rows: [rowA1, rowA2], color: '#E69F00' }], enderecos, 480, 320);
  ok(/<polyline/.test(svg), 'two plottable rows -> route line present');
  ok(svg.includes('>1<') || />1</.test(svg), 'first stop numbered 1');
  ok(svg.includes('>2<') || />2</.test(svg), 'second stop numbered 2');
}

// Coordinate-less row included alongside plottable ones: noted below the
// map, not silently dropped, and not plotted as a dot.
{
  const svg = buildRouteMapSvg([{ rows: [rowA1, rowA2, rowNoCoord], color: '#E69F00' }], enderecos, 480, 320);
  ok(svg.includes('sem coordenadas'), 'coordinate-less note present');
  ok(svg.includes('14:05'), 'coordinate-less note includes the visit\'s time');
  ok(svg.includes('Rita'), 'coordinate-less note includes the visit\'s name');
  ok(!/>3</.test(svg), 'coordinate-less row is not numbered/plotted as a third dot');
}

// No <a> anywhere in the output (no interactivity on the dots).
{
  const svg = buildRouteMapSvg([{ rows: [rowA1, rowA2], color: '#E69F00' }], enderecos, 480, 320);
  ok(!svg.includes('<a '), 'no <a> tags in the map svg (purely visual)');
}

// Multiple row sets (combined-map shape): each set's own color appears,
// each set numbers its own stops starting at 1.
{
  const rowB1 = { reservado: true, controle: 'C2', domicilio: '01', horaInicio: '09:00', nome: 'Ana' };
  const enderecos2 = new Map([...enderecos, ['C2|01', { lat: -12.80, lon: -38.40, zona: 'Z3', idZona: '3' }]]);
  const svg = buildRouteMapSvg(
    [{ rows: [rowA1, rowA2], color: '#E69F00' }, { rows: [rowB1], color: '#56B4E9' }],
    enderecos2, 640, 420
  );
  ok(svg.includes('#E69F00'), 'first team color present');
  ok(svg.includes('#56B4E9'), 'second team color present');
  ok((svg.match(/>1</g) || []).length >= 2, 'both sets restart numbering at 1');
}

// buildLegend
{
  const groups = [{ equipe: '29_Ana_Bela_1' }, { equipe: '29_Caio_Deo_1' }];
  const legend = buildLegend(groups);
  ok(legend.includes('29_Ana_Bela_1'), 'legend includes first team name');
  ok(legend.includes('29_Caio_Deo_1'), 'legend includes second team name');
  ok(legend.includes(TEAM_COLORS[0]) && legend.includes(TEAM_COLORS[1]), 'legend uses team colors');
}
ok(buildLegend([]) === '', 'empty groups -> empty legend');
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `bun /tmp/agenda-day-route-map-test.js`
Expected: `ReferenceError: Can't find variable: buildRouteMapSvg`.

- [ ] **Step 3: Implement in the mirror test file**

Add above the Task 3 test block from Step 1 (below the Task 1/2 helpers already in the file):

```js
// One plottable stop: { seq, hora, label, x, y } for an svg dot; label is
// the escaped name-or-controle fallback used in the coordinate-less note
// too, so both stay consistent.
function stopLabel(r) {
  return r.nome || r.controle || '';
}

// rowSets: Array<{ rows: Array<row>, color: string }>, each already this
// team's reserved rows in time order. Builds one shared projection across
// ALL plottable points from every set (so a combined map's teams share
// one coordinate frame), then draws each set's dots/line in its color,
// each set numbered independently starting at 1. Rows whose slotInfo has
// no usable lat/lon are excluded from plotting and listed in a single
// combined coordinate-less note below the map (never silently dropped).
function buildRouteMapSvg(rowSets, enderecos, width, height) {
  const PADDING = 28;
  const plottableSets = rowSets.map((set) => {
    const plottable = [];
    const missing = [];
    set.rows.forEach((r) => {
      const info = slotInfo(r, enderecos);
      if (info && info.lat != null) {
        plottable.push({ lat: info.lat, lon: info.lon, hora: r.horaInicio, label: stopLabel(r) });
      } else {
        missing.push(r);
      }
    });
    return { plottable, missing, color: set.color };
  });

  const allPoints = plottableSets.flatMap((s) => s.plottable);
  if (allPoints.length === 0) return '';

  const { projected, scaleBarKm, scaleBarPx } = projectPoints(allPoints, width, height, PADDING);

  // Walk projected in the same flattened order to hand each set back its
  // own slice (projectPoints doesn't know about sets, only points).
  let cursor = 0;
  const svgParts = [];
  plottableSets.forEach((set) => {
    const pts = projected.slice(cursor, cursor + set.plottable.length);
    cursor += set.plottable.length;
    if (pts.length === 0) return;

    if (pts.length >= 2) {
      const line = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
      svgParts.push(
        `<polyline points="${line}" fill="none" stroke="${set.color}" stroke-width="1.5" opacity="0.7"/>`
      );
    }

    pts.forEach((p, i) => {
      const stop = set.plottable[i];
      const seq = i + 1;
      svgParts.push(
        `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="9" fill="${set.color}" stroke="#fff" stroke-width="1.5"/>` +
        `<text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" text-anchor="middle" dominant-baseline="central" ` +
          `font-size="9" font-weight="700" fill="#fff">${seq}</text>` +
        `<text x="${p.x.toFixed(1)}" y="${(p.y + 20).toFixed(1)}" text-anchor="middle" ` +
          `font-size="9" fill="#333">${escapeHtml(stop.hora)}</text>`
      );
    });
  });

  // Scale bar: bottom-left corner.
  const barX = PADDING, barY = height - 12;
  svgParts.push(
    `<line x1="${barX}" y1="${barY}" x2="${(barX + scaleBarPx).toFixed(1)}" y2="${barY}" stroke="#333" stroke-width="1.5"/>` +
    `<text x="${barX}" y="${barY - 4}" font-size="9" fill="#333">${scaleBarKm} km</text>`
  );

  // North arrow: top-right corner. The projection keeps lat-increasing
  // "up" by construction, so a fixed arrow is legitimate here.
  const arrowX = width - PADDING, arrowY = PADDING;
  svgParts.push(
    `<text x="${arrowX}" y="${arrowY}" text-anchor="middle" font-size="11" font-weight="700" fill="#333">N ↑</text>`
  );

  const svg = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" ` +
    `style="border:1px solid #d0d7de;background:#fff;max-width:100%;">${svgParts.join('')}</svg>`;

  const allMissing = plottableSets.flatMap((s) => s.missing);
  const missingNote = allMissing.length
    ? `<div class="route-map-missing">${allMissing.length} visita(s) sem coordenadas válidas: ` +
      allMissing.map((r) => `${escapeHtml(r.horaInicio)} ${escapeHtml(stopLabel(r))}`).join(', ') +
      '</div>'
    : '';

  return `<div class="route-map">${svg}${missingNote}</div>`;
}

// Small color-key legend for the combined Resumo map: one swatch + name
// per team, in groups' existing (name-sorted) order.
function buildLegend(groups) {
  if (groups.length === 0) return '';
  const items = groups.map((g, i) =>
    `<span class="route-map-legend-item"><span class="route-map-swatch" style="background:${teamColor(i)}"></span>${escapeHtml(g.equipe)}</span>`
  ).join('');
  return `<div class="route-map-legend">${items}</div>`;
}
```

- [ ] **Step 4: Run it, iterate until ALL PASS**

Run: `bun /tmp/agenda-day-route-map-test.js`
Expected: `ALL PASS`. Common issues: the `>1<`/`>2<` regex assertions are sensitive to exact tag structure — if they fail, check the actual printed SVG snippet (add a temporary `console.log(svg)` above the assertion) and adjust either the test's matcher or the builder's text-node structure so the sequence number is unambiguously present as text content.

- [ ] **Step 5: Paste into the real file**

In `extension/features/agenda-day-guide/agenda-day-guide.js`:

5a. Insert `stopLabel`, `buildRouteMapSvg`, and `buildLegend` verbatim (Step 3 code, including comments) directly after `teamColor`'s closing `}` (added in Task 2, Step 5) — these are the last functions in the `// --- SVG day-route map` section, right before `// --- HTML builders`.

5b. Remove the mirror-only shadow `const escapeHtml = fakeEscapeHtml;` and the mirror-only `slotInfo` re-definition from what you paste — the real file already has both (`escapeHtml` at line 127, `slotInfo` at line 86). Only paste `stopLabel`, `buildRouteMapSvg`, `buildLegend`.

- [ ] **Step 6: Syntax check**

Run: `bun build --no-bundle extension/features/agenda-day-guide/agenda-day-guide.js`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add extension/features/agenda-day-guide/agenda-day-guide.js
git commit -m "feat: add SVG route-map and legend builders for the day guide"
```

---

### Task 4: Wire into the guide — Resumo combined map, per-team maps, CSS, manual verification

**Files:**
- Modify: `extension/features/agenda-day-guide/agenda-day-guide.js`

**Interfaces:**
- Consumes: `buildRouteMapSvg`, `buildLegend` (Task 3); existing `buildSummaryPanel(groups, allRows, lab)` (line 256), `buildTeamPanel(group, enderecos)` (line 207), `TABLE_CSS` (line 130), `buildGuideHtml` (line 338).
- Produces: no new public interface — this is the integration task. `window.__sigcPro.dayGuide` shape is unchanged (`{ generate, diaViewActive }`).

- [ ] **Step 1: Thread `enderecos` into `buildSummaryPanel` and call the combined map**

In `extension/features/agenda-day-guide/agenda-day-guide.js`, change the `buildSummaryPanel` signature and its Resumo-only additions. Current signature (line 256):

```js
  function buildSummaryPanel(groups, allRows, lab) {
```

New signature and body — replace the function's `return [...]` (lines 276–282) with a version that adds the map only when `!lab` and `enderecos` is present:

```js
  function buildSummaryPanel(groups, allRows, lab, enderecos) {
```

(keep the rest of the function body — `e`, `day`, `comReserva`, `titulo`, `linhas` — unchanged; only the final `return` changes). Replace:

```js
    return [
      `<h2>${e(titulo)}</h2>`,
      `<table class="stats">\n${linhas}\n</table>`,
      '<h3>Slots do dia</h3>',
      buildDayGrid(groups, lab),
    ].join('\n');
  }
```

with:

```js
    // Combined day-route map: every team's reserved, coordinate-having
    // visits overlaid, one color per team. Lab tab (the shareable,
    // privacy-stripped view) never gets a map — see spec Placement.
    const routeMap = !lab && enderecos
      ? [
          '<h3>Mapa do dia</h3>',
          buildLegend(groups),
          buildRouteMapSvg(
            groups.map((g, i) => ({ rows: g.rows.filter((r) => r.reservado), color: teamColor(i) })),
            enderecos, 640, 420
          ),
        ].filter(Boolean).join('\n')
      : '';
    return [
      `<h2>${e(titulo)}</h2>`,
      `<table class="stats">\n${linhas}\n</table>`,
      '<h3>Slots do dia</h3>',
      buildDayGrid(groups, lab),
      routeMap,
    ].filter(Boolean).join('\n');
  }
```

- [ ] **Step 2: Call the per-team map from `buildTeamPanel`**

In the same file, `buildTeamPanel` (line 207) already computes `stops` for the Google Maps route link (lines 232–239). After the existing `rota` block (lines 240–246), and before the function's final `return` (lines 247–254), add the per-team map using the SAME `group` index the team appears at in `groups` — but `buildTeamPanel` only receives `group`, not its index or the full `groups` array. Change the signature to accept the index:

Current (line 207):
```js
  function buildTeamPanel(group, enderecos) {
```

New:
```js
  function buildTeamPanel(group, enderecos, colorIndex) {
```

Then, immediately before the function's final `return [...]` (currently lines 247–254), insert:

```js
    const teamMap = enderecos
      ? buildRouteMapSvg(
          [{ rows: group.rows.filter((r) => r.reservado), color: teamColor(colorIndex) }],
          enderecos, 480, 320
        )
      : '';
```

And change the final `return` (lines 247–254) from:

```js
    return [
      `<h2>${e(group.equipe)}</h2>`,
      `<div class="teamstats">${statBits}</div>`,
      zonas.length ? `<div class="zonas">Zonas: ${zonas.map(e).join(', ')}</div>` : '',
      rota,
      ...cards,
    ].filter(Boolean).join('\n');
  }
```

to:

```js
    return [
      `<h2>${e(group.equipe)}</h2>`,
      `<div class="teamstats">${statBits}</div>`,
      zonas.length ? `<div class="zonas">Zonas: ${zonas.map(e).join(', ')}</div>` : '',
      rota,
      ...cards,
      teamMap,
    ].filter(Boolean).join('\n');
  }
```

- [ ] **Step 3: Update the three call sites in `buildGuideHtml`**

`buildGuideHtml` (line 338) currently builds `panels` like this (lines 343–347):

```js
    const panels = [
      { label: 'Resumo', html: buildSummaryPanel(groups, allRows) },
      { label: 'Lab', html: buildSummaryPanel(groups, allRows, true) },
      ...groups.map((g) => ({ label: g.equipe, html: buildTeamPanel(g, enderecos) })),
    ];
```

Change to:

```js
    const panels = [
      { label: 'Resumo', html: buildSummaryPanel(groups, allRows, false, enderecos) },
      { label: 'Lab', html: buildSummaryPanel(groups, allRows, true, enderecos) },
      ...groups.map((g, i) => ({ label: g.equipe, html: buildTeamPanel(g, enderecos, i) })),
    ];
```

(The Lab call still passes `enderecos` positionally for signature consistency, but `buildSummaryPanel`'s `!lab && enderecos` guard from Step 1 means the Lab panel never actually renders a map — this matches the Global Constraint that Lab never gets one.)

- [ ] **Step 4: Add CSS for the map elements**

In the same file, `buildGuideHtml`'s inline `<style>` block currently ends its custom rules with (line 388, just before `${TABLE_CSS}`):

```js
.teamstats { color: #333; margin: .2rem 0 .4rem; font-size: .92rem; }
${TABLE_CSS}
```

Change to:

```js
.teamstats { color: #333; margin: .2rem 0 .4rem; font-size: .92rem; }
.route-map { margin: .6rem 0; page-break-inside: avoid; }
.route-map-missing { color: #666; font-size: .85rem; margin-top: .3rem; }
.route-map-legend { display: flex; flex-wrap: wrap; gap: .6rem; margin: .4rem 0; font-size: .85rem; }
.route-map-legend-item { display: inline-flex; align-items: center; gap: .3rem; }
.route-map-swatch { display: inline-block; width: .7rem; height: .7rem; border-radius: 2px; }
${TABLE_CSS}
```

- [ ] **Step 5: Syntax check**

Run: `bun build --no-bundle extension/features/agenda-day-guide/agenda-day-guide.js`
Expected: no errors.

- [ ] **Step 6: Privacy gate**

Run: `./scripts/check-privacy.sh`
Expected: `privacy gate: CLEAN` (this task adds no new APIs — pure string building, same as every other builder in this file).

- [ ] **Step 7: Byte-identical check — plain guide unaffected**

Create `/tmp/agenda-day-route-map-smoke.mjs`:

```js
// Loads the real content script with stubbed window/document, generates
// the guide with enderecos = null (plain path) and with a small
// multi-team enderecos map (mapped path), and checks:
// 1. The plain-path Resumo panel has no route-map section at all.
// 2. The mapped-path Resumo panel has a combined map + legend with both
//    team colors, and per-team panels each have their own map.
// 3. The Lab panel never has a route-map section, even when enderecos
//    is present.
// 4. Print preview sanity: no <script> tags anywhere in the output.

const slot = (equipe, hi, hf, reservado, extra = {}) => ({
  equipe, horaInicio: hi, horaFim: hf, reservado,
  controle: '', domicilio: '', nome: '', sexo: '', idade: '',
  dtNascimento: '', endereco: '', telefone: '', zonas: '', observacao: '',
  isoDate: '2026-07-18', ...extra,
});

const rows = [
  slot('29_Ana_Bela_1', '08:15', '10:15', true, { controle: '2900123450011', domicilio: '01', nome: 'Maria', endereco: 'Rua A, 10' }),
  slot('29_Ana_Bela_1', '14:05', '16:05', true, { controle: '2900543210011', domicilio: '03', nome: 'João', endereco: 'Rua B, 22' }),
  slot('29_Caio_Deo_1', '09:00', '11:00', true, { controle: '2900998870011', domicilio: '02', nome: 'Rita', endereco: 'Av. C, 5' }),
];

const enderecos = new Map([
  ['2900123450011|01', { lat: -12.90, lon: -38.60, zona: '29_Ana_Bela', idZona: '29.3.01.01' }],
  ['2900543210011|03', { lat: -12.95, lon: -38.55, zona: '29_Ana_Bela', idZona: '29.3.01.02' }],
  ['2900998870011|02', { lat: -12.80, lon: -38.40, zona: '29_Caio_Deo', idZona: '29.3.02.01' }],
]);

let out = null;
globalThis.window = {
  __sigcPro: {
    readAgendaSlots: () => rows,
    timestampSlug: () => ({ data: '18-07-2026', hora: '120000' }),
    isoToBr: (iso) => (iso ? '18/07/2026' : ''),
    WEEKDAYS_PT: ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'],
    slug: (s) => String(s).toLowerCase().replace(/\W+/g, '-'),
    downloadFile: (name, content) => { out = { name, content }; },
    whenReadyGeneric: () => {},
    onAgendaPage: () => true,
    findAgendaToolbarChunk: () => null,
    parseZonaEntries: (z) => String(z ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    escapeHtml: (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    getAgendaUf: () => ({ code: '', name: '' }),
  },
};
globalThis.document = { querySelector: () => ({}), getElementById: () => null };
globalThis.alert = (m) => { throw new Error('alert: ' + m); };

await import('/Users/eleon/github/sigc-pro/extension/features/agenda-day-guide/agenda-day-guide.js');

let fail = 0;
const ok = (cond, label) => { if (!cond) { console.log(`FAIL ${label}`); fail++; } };

window.__sigcPro.dayGuide.generate(null);
const plain = out.content;
ok(!plain.includes('route-map'), 'plain guide (no enderecos): no route-map anywhere');

out = null;
window.__sigcPro.dayGuide.generate(enderecos);
const mapped = out.content;
await Bun.write('/tmp/agenda-day-route-map-sample.html', mapped);

const resumoPanel = mapped.match(/id="panel-0">[\s\S]*?<\/section>/)[0];
ok(resumoPanel.includes('route-map-legend'), 'Resumo panel has the combined-map legend');
ok(resumoPanel.includes('#E69F00') && resumoPanel.includes('#56B4E9'),
  'Resumo legend/map uses both team colors (first two palette entries)');

const labPanel = mapped.match(/id="panel-1">[\s\S]*?<\/section>/)[0];
ok(!labPanel.includes('route-map'), 'Lab panel has no route-map section even with enderecos present');

const teamPanels = [...mapped.matchAll(/id="panel-\d">[\s\S]*?<\/section>/g)].slice(2);
ok(teamPanels.length === 2, 'two team panels present');
teamPanels.forEach((p, i) => ok(p[0].includes('<svg'), `team panel ${i} has its own map svg`));

ok(!mapped.includes('<script'), 'no <script> tags anywhere in the generated guide');
ok(!/<a[^>]*>\s*<circle/.test(mapped), 'no <a> wrapping a <circle> (dots stay non-interactive)');

console.log(fail === 0 ? 'SMOKE ALL PASS' : `${fail} SMOKE FAILURES`);
```

Note: `TEAM_COLORS` is module-private inside the content script's IIFE (not on `window.__sigcPro`), which is why the script above hardcodes the two expected hex values (`#E69F00`, `#56B4E9` — the first two palette entries) instead of importing the constant.

- [ ] **Step 8: Run the smoke test**

Run: `bun /tmp/agenda-day-route-map-smoke.mjs`
Expected: `SMOKE ALL PASS`. If a panel-matching regex fails, print the relevant panel substring and adjust the assertion — the guide's actual tab order is `Resumo, Lab, <team1>, <team2>, ...` (see `buildGuideHtml`'s `panels` array from Task 3, Step 3), so `panel-0` = Resumo, `panel-1` = Lab, `panel-2`/`panel-3` = the two teams (sorted by name: `29_Ana_Bela_1` before `29_Caio_Deo_1`).

- [ ] **Step 9: Visual smoke test**

Open `/tmp/agenda-day-route-map-sample.html` in a browser (the smoke test wrote it in Step 8). Check:
- Resumo tab: legend shows two colored swatches with team names, combined map below the slot grid shows all 3 visits as colored dots with time labels, numbers restart at 1 per team, a route line connects Ana Bela's two visits (Caio Deo's single visit has no line).
- Each team tab: its own map appears below its visit cards, same color as its legend swatch on Resumo, numbered starting at 1.
- Lab tab: no map anywhere.
- Ctrl+P print preview: each tab still prints as one page with its content (including the map) visible; the tab bar itself is hidden in print (existing `@media print { .tabs { display: none; } }` rule, unchanged).

- [ ] **Step 10: Commit**

```bash
git add extension/features/agenda-day-guide/agenda-day-guide.js
git commit -m "feat: wire day-route SVG map into Resumo and team tabs"
```

---

### Task 5: Documentation

**Files:**
- Modify: `docs/superpowers/specs/2026-07-18-agenda-day-route-map-design.md`
- Modify: `docs/index.html`
- Modify: `LEIA-ME.txt`
- Modify: `ROADMAP.md`

**Interfaces:**
- Consumes: nothing (docs only).
- Produces: nothing consumed by later tasks (this is the last task).

- [ ] **Step 1: Mark the spec as implemented**

In `docs/superpowers/specs/2026-07-18-agenda-day-route-map-design.md`, change the status line (line 3) from:

```
2026-07-18. Status: approved direction, pre-implementation.
```

to:

```
2026-07-18. Status: implemented 2026-07-18.
```

- [ ] **Step 2: Update the Guia do Dia feature card**

In `docs/index.html`, find the Guia do Dia card (`<h3>🗒️ Guia do Dia — Agenda</h3>`, currently ending with the sentence about the Lab tab). Append one clause to that paragraph, right before the closing `</p>`:

Find:
```
A aba <strong>Lab</strong> repete o resumo em versão compartilhável com o laboratório: Controle truncado aos 11 primeiros dígitos, sem domicílio nem dados pessoais.</p>
```

Replace with:
```
A aba <strong>Lab</strong> repete o resumo em versão compartilhável com o laboratório: Controle truncado aos 11 primeiros dígitos, sem domicílio nem dados pessoais. Com o Guia + Mapa, cada aba (exceto Lab) também mostra um mapa-esquema (SVG, sem imagens de mapa) com a rota do dia — visitas numeradas na ordem de horário, uma cor por equipe.</p>
```

- [ ] **Step 3: Update LEIA-ME.txt**

In `LEIA-ME.txt`, find the "Guia + Mapa (opcional)" bullet:

```
  * Guia + Mapa (opcional) — o mesmo guia, com links de navegação (geo:),
    rota no Google Maps e a zona real de cada visita; para isso, mediante
    clique e confirmação, consulta o próprio servidor do SIGC (nada vai a
    terceiros).
```

Replace with:

```
  * Guia + Mapa (opcional) — o mesmo guia, com links de navegação (geo:),
    rota no Google Maps, a zona real de cada visita e um mapa-esquema
    (SVG, sem imagens externas) da rota do dia em cada aba; para isso,
    mediante clique e confirmação, consulta o próprio servidor do SIGC
    (nada vai a terceiros).
```

- [ ] **Step 4: Add a ROADMAP Done entry**

In `ROADMAP.md`, find the existing "Guia + Mapa" done item (the one referencing `2026-07-16-agenda-map-design.md`) and add a new bullet directly after it, before the "Real icon" line:

```
- [x] Guia + Mapa: inline SVG day-route sketch on Resumo (combined, all
      teams, colored legend) and each team tab (its own visits) — numbered
      stops in visit order, start-time labels, scale bar, north arrow, no
      tiles/imagery/network; Lab tab stays map-free
      (`2026-07-18-agenda-day-route-map-design.md`)
```

- [ ] **Step 5: Verify no stale references**

Run: `grep -rn "Inline SVG route sketch" docs/superpowers/specs/2026-07-16-agenda-map-design.md`
Expected: one match, in the "Out of scope" section — leave it as historical record (the new spec's header already says "Supersedes that spec's ... item", so no edit needed there).

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-07-18-agenda-day-route-map-design.md docs/index.html LEIA-ME.txt ROADMAP.md
git commit -m "docs: document the day-route SVG map feature"
```

---

## Post-plan: live field test (requires SIGC access, not part of task commits)

After Task 5, live-test on a real multi-team Agenda day with Guia + Mapa:
- Combined Resumo map renders sensibly against real coordinate spread (not just the synthetic 3-point sample).
- Each team's own map matches its Resumo legend color.
- A day with a genuinely coordinate-less household (bad/missing lat-lon in the real Lista de Endereços response) shows the "sem coordenadas válidas" note instead of crashing or silently omitting it.
- A day with only one team, or a team with only one reserved visit, renders a single-dot map with no route line and no scale-bar division-by-zero artifacts.
- Ctrl+P on a team tab still prints one clean page including its map.
- Lab tab confirmed map-free.
