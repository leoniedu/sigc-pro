# Mapa: Status Colors, Zona Hulls, Controle Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three visual layers to the Mapa tab's Leaflet map: marker
color driven by status (not zona), a convex-hull polygon per zona, and a
colored, always-visible label at each Controle's centroid.

**Architecture:** All additions land in the existing
`extension/features/ultimo-movimento-map/ultimo-movimento-map.js` (no
new file — this codebase's convention is one `.js` per feature
directory, even for larger files; see `agenda-map.js` at 520 lines,
`lista-agenda.js` at 900+). Each new piece of logic is a pure function
(status color lookup, convex hull, centroid + label-color rule),
unit-tested the same way `zonaColor`/`aggregateZonas` already are.
`renderLeafletMap` is extended to call these and add the two new Leaflet
layers (hulls, labels) alongside the existing marker layer.

**Tech Stack:** Vanilla JS, Leaflet (already vendored), Bun test runner.

## Global Constraints

- Marker color = status, replacing zona (spec §1): `ultimaPosicao ===
  'Distribuido'` → gray `#888888` (checked first, wins regardless of
  tipoEntrevista); else by `tipoEntrevista`: Realizada → `#009E73`,
  Recusa → `#D55E00`, Não Iniciada → `#F0E442`, Domicílio Fechado →
  `#56B4E9`, anything else → `#000000` (Outros).
- Zona hulls (spec §2): convex hull (hand-rolled Andrew's monotone
  chain) per zona (excluding "Sem zona"/`idZona` null-or-empty), using
  only rows with `temCoordenadas`. Rendered under markers, filled with
  `zonaColor(idZona)` at low opacity, higher-opacity border. Degenerate
  cases — 1 point, or ≤2 distinct points, or all-collinear — render as a
  small circle (1 point) or a thin capsule/polyline (2 points/collinear)
  in the same zona color, never nothing.
- No hull for "Sem zona" households.
- Controle labels (spec §3): one per distinct `controle`, at the
  centroid (plain average of lat/lon) of that Controle's
  valid-coordinate domicílios; no label if zero valid-coordinate rows.
  Label text = last 6 digits of the Controle number. Color: all rows'
  `ultimaPosicao === 'Distribuido'` → gray `#888888`; none → blue
  `#0072B2`; mixed → orange `#E69F00`. Always rendered, no zoom-based
  hiding (explicitly deferred).
- The three color palettes (marker-status, zona-hull, Controle-label)
  stay visually distinct — never reuse a marker-status color as a
  Controle-label color or vice versa.
- Status legend: fixed corner overlay listing the 6 marker-status
  colors, using the same `add_control`-style mechanism already used for
  the data-timestamp note. No separate legend for hull or label colors.
- Pure functions only for: status color, convex hull, centroid +
  label-color rule. Leaflet rendering itself (`L.polygon`, `L.circle`,
  `L.polyline`, tooltip placement) is manual-verification-only, per this
  feature's existing convention.
- No changes to the Zonas tab, consent flow, or data fetch/join/
  aggregate pipeline — rendering-layer-only addition.

---

## File Structure

- Modify: `extension/features/ultimo-movimento-map/ultimo-movimento-map.js`
  — add `statusColor`, `convexHull`, `controleCentroids` (or similarly
  named pure functions), and extend `renderLeafletMap` to draw hulls and
  labels alongside markers, plus the new status legend control.
- Test: `tests/ultimo-movimento-map.test.js` — unit tests for the three
  new pure functions.

## Interfaces produced (for reference across tasks)

- `statusColor(row) → string` (hex color). `row` is a `joined`-shape
  object (`{ultimaPosicao, tipoEntrevista, ...}` — only these two fields
  are read).
- `convexHull(points) → {type: 'polygon', points: Array<[lat, lon]>} | {type: 'circle', center: [lat, lon]} | {type: 'capsule', a: [lat, lon], b: [lat, lon]}`.
  `points` is `Array<[lat, lon]>`. Handles 0 points (returns `null`), 1
  point (circle), 2 points or all-collinear (capsule), ≥3
  non-collinear (polygon).
- `controleCentroids(joined) → Array<{controle, lat, lon, colorState}>`,
  one entry per distinct `controle` with ≥1 valid-coordinate row.
  `colorState` is one of `'inactive' | 'active' | 'partial'` (the
  gray/blue/orange rule). Caller maps `colorState` to its hex color
  constant.

---

### Task 1: Status color for markers

**Files:**
- Modify: `extension/features/ultimo-movimento-map/ultimo-movimento-map.js`
- Test: `tests/ultimo-movimento-map.test.js`

**Interfaces:**
- Consumes: nothing new (reads `row.ultimaPosicao`, `row.tipoEntrevista`
  — both already present on every `joined` row per Task 1 of the base
  Mapa plan).
- Produces: `statusColor(row) → string`, added to
  `window.__sigcProUltimoMovimentoMapInternals`.

- [ ] **Step 1: Write the failing tests**

```javascript
// append to tests/ultimo-movimento-map.test.js

describe('statusColor', () => {
  test('Distribuido wins regardless of tipoEntrevista', () => {
    expect(UM.statusColor({ ultimaPosicao: 'Distribuido', tipoEntrevista: 'Realizada' })).toBe('#888888');
    expect(UM.statusColor({ ultimaPosicao: 'Distribuido', tipoEntrevista: '' })).toBe('#888888');
  });

  test('Realizada -> green', () => {
    expect(UM.statusColor({ ultimaPosicao: 'Descarregado', tipoEntrevista: 'Realizada' })).toBe('#009E73');
  });

  test('Recusa -> red/orange', () => {
    expect(UM.statusColor({ ultimaPosicao: 'Descarregado', tipoEntrevista: 'Recusa' })).toBe('#D55E00');
  });

  test('Não Iniciada -> yellow', () => {
    expect(UM.statusColor({ ultimaPosicao: 'Descarregado', tipoEntrevista: 'Não Iniciada' })).toBe('#F0E442');
  });

  test('Domicílio Fechado -> sky-blue', () => {
    expect(UM.statusColor({ ultimaPosicao: 'Descarregado', tipoEntrevista: 'Domicílio Fechado' })).toBe('#56B4E9');
  });

  test('unrecognized tipoEntrevista -> black (Outros)', () => {
    expect(UM.statusColor({ ultimaPosicao: 'Descarregado', tipoEntrevista: 'Em condições de ser habitada' })).toBe('#000000');
    expect(UM.statusColor({ ultimaPosicao: 'Descarregado', tipoEntrevista: '' })).toBe('#000000');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/ultimo-movimento-map.test.js`
Expected: FAIL — `statusColor` not defined.

- [ ] **Step 3: Write the minimal implementation**

Add to `ultimo-movimento-map.js`, near `zonaColor` (same section — both
are marker-adjacent color functions):

```javascript
  // Marker color = status (spec: docs/superpowers/specs/
  // 2026-08-09-mapa-status-zonas-controles-design.md §1), not zona —
  // zonaColor() is still used, but now only for the hull layer.
  // Okabe-Ito colorblind-safe hex values, assigned by semantic
  // convention here (unlike zonaColor's arbitrary hash) since status
  // carries real meaning a survey manager reads at a glance.
  const STATUS_INATIVO = '#888888';
  const STATUS_REALIZADA = '#009E73';
  const STATUS_RECUSA = '#D55E00';
  const STATUS_NAO_INICIADA = '#F0E442';
  const STATUS_FECHADO = '#56B4E9';
  const STATUS_OUTROS = '#000000';

  const STATUS_TIPO_COLOR = {
    'Realizada': STATUS_REALIZADA,
    'Recusa': STATUS_RECUSA,
    'Não Iniciada': STATUS_NAO_INICIADA,
    'Domicílio Fechado': STATUS_FECHADO,
  };

  function statusColor(row) {
    if (row.ultimaPosicao === 'Distribuido') return STATUS_INATIVO;
    return STATUS_TIPO_COLOR[row.tipoEntrevista] || STATUS_OUTROS;
  }
```

Update the internals export to include `statusColor`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/ultimo-movimento-map.test.js`
Expected: PASS (6 new tests)

- [ ] **Step 5: Commit**

```bash
git add extension/features/ultimo-movimento-map/ultimo-movimento-map.js tests/ultimo-movimento-map.test.js
git commit -m "feat: add statusColor for Mapa markers"
```

---

### Task 2: Convex hull (pure geometry)

**Files:**
- Modify: `extension/features/ultimo-movimento-map/ultimo-movimento-map.js`
- Test: `tests/ultimo-movimento-map.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `convexHull(points) → {type, ...} | null`, added to
  `window.__sigcProUltimoMovimentoMapInternals`. Signature and return
  shape exactly as specified in "Interfaces produced" above.

- [ ] **Step 1: Write the failing tests**

```javascript
// append to tests/ultimo-movimento-map.test.js

describe('convexHull', () => {
  test('0 points returns null', () => {
    expect(UM.convexHull([])).toBeNull();
  });

  test('1 point returns a circle centered on it', () => {
    const result = UM.convexHull([[10, 20]]);
    expect(result).toEqual({ type: 'circle', center: [10, 20] });
  });

  test('2 distinct points returns a capsule', () => {
    const result = UM.convexHull([[10, 20], [11, 21]]);
    expect(result).toEqual({ type: 'capsule', a: [10, 20], b: [11, 21] });
  });

  test('2 identical points (dedup to 1) returns a circle', () => {
    const result = UM.convexHull([[10, 20], [10, 20]]);
    expect(result).toEqual({ type: 'circle', center: [10, 20] });
  });

  test('3 collinear points returns a capsule between the extremes', () => {
    const result = UM.convexHull([[0, 0], [1, 1], [2, 2]]);
    expect(result.type).toBe('capsule');
    expect(result.a).toEqual([0, 0]);
    expect(result.b).toEqual([2, 2]);
  });

  test('3 non-collinear points returns a triangle polygon', () => {
    const result = UM.convexHull([[0, 0], [0, 2], [2, 0]]);
    expect(result.type).toBe('polygon');
    expect(result.points).toHaveLength(3);
    // every input point must be present in the hull for a triangle (all 3 are vertices)
    [[0, 0], [0, 2], [2, 0]].forEach((p) => {
      expect(result.points).toContainEqual(p);
    });
  });

  test('a point strictly inside the hull is excluded from the polygon', () => {
    const result = UM.convexHull([[0, 0], [0, 4], [4, 0], [4, 4], [2, 2]]);
    expect(result.type).toBe('polygon');
    expect(result.points).not.toContainEqual([2, 2]);
    expect(result.points).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/ultimo-movimento-map.test.js`
Expected: FAIL — `convexHull` not defined.

- [ ] **Step 3: Write the minimal implementation**

Add to `ultimo-movimento-map.js`:

```javascript
  // Convex hull over zona domicílio coordinates (spec §2). Hand-rolled
  // Andrew's monotone chain — no new vendored dependency, matches this
  // repo's "vendor only what you must, hand-roll small pure logic"
  // approach (same rationale as zonaColor's own hash-based assignment).
  // points: Array<[lat, lon]>. Degenerate inputs (0/1/2 points, or all
  // collinear) never return an empty/broken polygon — every zona with
  // at least one valid-coordinate domicílio gets SOME shape (spec: "no
  // zona with points renders nothing").
  function cross(o, a, b) {
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  }

  function convexHull(points) {
    // De-dup identical coordinates first — Andrew's monotone chain
    // assumes distinct points, and two identical rows (e.g. two
    // domicílios geocoded to the exact same address) must not count as
    // "2 points" for the polygon/capsule decision below.
    const uniq = [];
    const seen = new Set();
    points.forEach(([lat, lon]) => {
      const key = `${lat},${lon}`;
      if (!seen.has(key)) { seen.add(key); uniq.push([lat, lon]); }
    });

    if (uniq.length === 0) return null;
    if (uniq.length === 1) return { type: 'circle', center: uniq[0] };

    const sorted = [...uniq].sort((p, q) => (p[0] - q[0]) || (p[1] - q[1]));

    if (uniq.length === 2) {
      return { type: 'capsule', a: sorted[0], b: sorted[sorted.length - 1] };
    }

    const lower = [];
    for (const p of sorted) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
        lower.pop();
      }
      lower.push(p);
    }
    const upper = [];
    for (let i = sorted.length - 1; i >= 0; i -= 1) {
      const p = sorted[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
        upper.pop();
      }
      upper.push(p);
    }
    upper.pop();
    lower.pop();
    const hull = lower.concat(upper);

    // All points collinear: the hull-building loop above collapses to
    // just the two extremes (lower/upper both degenerate) — treat the
    // same as the 2-point case rather than a degenerate "polygon" with
    // <3 vertices.
    if (hull.length < 3) {
      return { type: 'capsule', a: sorted[0], b: sorted[sorted.length - 1] };
    }
    return { type: 'polygon', points: hull };
  }
```

Update the internals export to include `convexHull`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/ultimo-movimento-map.test.js`
Expected: PASS (7 new tests)

- [ ] **Step 5: Commit**

```bash
git add extension/features/ultimo-movimento-map/ultimo-movimento-map.js tests/ultimo-movimento-map.test.js
git commit -m "feat: add convexHull for Mapa zona outlines"
```

---

### Task 3: Controle centroids + label color rule

**Files:**
- Modify: `extension/features/ultimo-movimento-map/ultimo-movimento-map.js`
- Test: `tests/ultimo-movimento-map.test.js`

**Interfaces:**
- Consumes: `joined` row shape (`{controle, lat, lon, ultimaPosicao, temCoordenadas, ...}`)
  — same shape `joinEnderecos` (base Mapa plan, Task 1) produces.
- Produces: `controleCentroids(joined) → Array<{controle, lat, lon, colorState}>`,
  added to `window.__sigcProUltimoMovimentoMapInternals`.

- [ ] **Step 1: Write the failing tests**

```javascript
// append to tests/ultimo-movimento-map.test.js

describe('controleCentroids', () => {
  test('averages lat/lon across a Controle\'s valid-coordinate rows', () => {
    const joined = [
      { controle: 'C1', domicilio: '1', lat: 0, lon: 0, ultimaPosicao: 'Descarregado', temCoordenadas: true },
      { controle: 'C1', domicilio: '2', lat: 2, lon: 4, ultimaPosicao: 'Descarregado', temCoordenadas: true },
    ];
    const result = UM.controleCentroids(joined);
    expect(result).toHaveLength(1);
    expect(result[0].controle).toBe('C1');
    expect(result[0].lat).toBe(1);
    expect(result[0].lon).toBe(2);
  });

  test('rows without valid coordinates are excluded from the average', () => {
    const joined = [
      { controle: 'C1', domicilio: '1', lat: 0, lon: 0, ultimaPosicao: 'Descarregado', temCoordenadas: true },
      { controle: 'C1', domicilio: '2', lat: null, lon: null, ultimaPosicao: 'Descarregado', temCoordenadas: false },
    ];
    const result = UM.controleCentroids(joined);
    expect(result[0].lat).toBe(0);
    expect(result[0].lon).toBe(0);
  });

  test('a Controle with zero valid-coordinate rows produces no entry', () => {
    const joined = [
      { controle: 'C1', domicilio: '1', lat: null, lon: null, ultimaPosicao: 'Descarregado', temCoordenadas: false },
    ];
    expect(UM.controleCentroids(joined)).toEqual([]);
  });

  test('colorState: all Distribuido -> inactive', () => {
    const joined = [
      { controle: 'C1', lat: 0, lon: 0, ultimaPosicao: 'Distribuido', temCoordenadas: true },
      { controle: 'C1', lat: 1, lon: 1, ultimaPosicao: 'Distribuido', temCoordenadas: true },
    ];
    expect(UM.controleCentroids(joined)[0].colorState).toBe('inactive');
  });

  test('colorState: none Distribuido -> active', () => {
    const joined = [
      { controle: 'C1', lat: 0, lon: 0, ultimaPosicao: 'Descarregado', temCoordenadas: true },
      { controle: 'C1', lat: 1, lon: 1, ultimaPosicao: 'Enviado para Carga', temCoordenadas: true },
    ];
    expect(UM.controleCentroids(joined)[0].colorState).toBe('active');
  });

  test('colorState: mixed -> partial', () => {
    const joined = [
      { controle: 'C1', lat: 0, lon: 0, ultimaPosicao: 'Distribuido', temCoordenadas: true },
      { controle: 'C1', lat: 1, lon: 1, ultimaPosicao: 'Descarregado', temCoordenadas: true },
    ];
    expect(UM.controleCentroids(joined)[0].colorState).toBe('partial');
  });

  test('colorState is computed over ALL rows for that Controle, even ones without coordinates', () => {
    // A Controle's active/inactive/partial status is a fact about its
    // fieldwork progress, not about which rows happened to geocode —
    // excluding uncoordinated rows from colorState (unlike the
    // centroid average, which must exclude them) would misreport a
    // Controle as "active" when an un-geocoded domicílio is still
    // Distribuido.
    const joined = [
      { controle: 'C1', lat: 0, lon: 0, ultimaPosicao: 'Descarregado', temCoordenadas: true },
      { controle: 'C1', lat: null, lon: null, ultimaPosicao: 'Distribuido', temCoordenadas: false },
    ];
    expect(UM.controleCentroids(joined)[0].colorState).toBe('partial');
  });

  test('multiple distinct Controles each get their own entry', () => {
    const joined = [
      { controle: 'C1', lat: 0, lon: 0, ultimaPosicao: 'Descarregado', temCoordenadas: true },
      { controle: 'C2', lat: 5, lon: 5, ultimaPosicao: 'Distribuido', temCoordenadas: true },
    ];
    const result = UM.controleCentroids(joined);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.controle).sort()).toEqual(['C1', 'C2']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/ultimo-movimento-map.test.js`
Expected: FAIL — `controleCentroids` not defined.

- [ ] **Step 3: Write the minimal implementation**

Add to `ultimo-movimento-map.js`:

```javascript
  // Controle label centroid + active/inactive/partial color rule (spec
  // §3). colorState is computed over EVERY row for that Controle
  // (including rows without valid coordinates) — it's a fact about
  // fieldwork progress, not about geocoding success. The centroid
  // average, separately, only uses rows with temCoordenadas (nothing
  // else to average otherwise). A Controle with zero valid-coordinate
  // rows gets no entry at all — there's no point to center a label on.
  function controleCentroids(joined) {
    const byControle = new Map(); // controle -> { coords: [[lat,lon],...], allDistribuido, noneDistribuido }
    joined.forEach((r) => {
      if (!byControle.has(r.controle)) {
        byControle.set(r.controle, { coords: [], allDistribuido: true, noneDistribuido: true });
      }
      const bucket = byControle.get(r.controle);
      if (r.temCoordenadas) bucket.coords.push([r.lat, r.lon]);
      const isDistribuido = r.ultimaPosicao === 'Distribuido';
      if (!isDistribuido) bucket.allDistribuido = false;
      if (isDistribuido) bucket.noneDistribuido = false;
    });

    const out = [];
    byControle.forEach((bucket, controle) => {
      if (bucket.coords.length === 0) return;
      const lat = bucket.coords.reduce((sum, [la]) => sum + la, 0) / bucket.coords.length;
      const lon = bucket.coords.reduce((sum, [, lo]) => sum + lo, 0) / bucket.coords.length;
      const colorState = bucket.allDistribuido ? 'inactive' : (bucket.noneDistribuido ? 'active' : 'partial');
      out.push({ controle, lat, lon, colorState });
    });
    return out;
  }
```

Update the internals export to include `controleCentroids`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/ultimo-movimento-map.test.js`
Expected: PASS (8 new tests)

- [ ] **Step 5: Commit**

```bash
git add extension/features/ultimo-movimento-map/ultimo-movimento-map.js tests/ultimo-movimento-map.test.js
git commit -m "feat: add controleCentroids for Mapa Controle labels"
```

---

### Task 4: Wire hulls, labels, and status legend into renderLeafletMap

**Files:**
- Modify: `extension/features/ultimo-movimento-map/ultimo-movimento-map.js`

**Interfaces:**
- Consumes: `statusColor` (Task 1), `convexHull` (Task 2),
  `controleCentroids` (Task 3), `zonaColor` (existing, base plan Task
  3), `window.__sigcPro.escapeHtml` (existing).
- Produces: no new testable interface — this task only changes
  `renderLeafletMap`'s Leaflet calls, which stay
  manual-verification-only per this feature's existing convention (the
  function itself is not unit-tested today either).

- [ ] **Step 1: Read the current `renderLeafletMap`**

```bash
grep -n "function renderLeafletMap" -A 30 extension/features/ultimo-movimento-map/ultimo-movimento-map.js
```

Confirm the exact current body before editing (shown in this plan's
File Structure discovery, but re-read live since Tasks 1-3 may have
shifted line numbers).

- [ ] **Step 2: Rewrite `renderLeafletMap` to add the three layers**

Replace the function body with:

```javascript
  function renderLeafletMap(L, container, joined) {
    const withCoords = joined.filter((r) => r.temCoordenadas);
    const map = L.map(container);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);
    if (withCoords.length === 0) {
      map.setView([-14, -51], 4); // Brazil-wide fallback view
      addStatusLegend(map);
      return;
    }

    // --- Layer 1: zona hulls, drawn first so markers sit on top ------
    const byZona = new Map(); // idZona -> [[lat, lon], ...]
    withCoords.forEach((r) => {
      if (!r.idZona) return; // "Sem zona" gets no hull (spec §2)
      if (!byZona.has(r.idZona)) byZona.set(r.idZona, []);
      byZona.get(r.idZona).push([r.lat, r.lon]);
    });
    byZona.forEach((coords, idZona) => {
      const hull = convexHull(coords);
      if (!hull) return;
      const color = zonaColor(idZona);
      if (hull.type === 'polygon') {
        L.polygon(hull.points, { color, weight: 2, fillColor: color, fillOpacity: 0.18 })
          .bindTooltip(window.__sigcPro.escapeHtml(idZona))
          .addTo(map);
      } else if (hull.type === 'capsule') {
        L.polyline([hull.a, hull.b], { color, weight: 10, opacity: 0.35, lineCap: 'round' })
          .bindTooltip(window.__sigcPro.escapeHtml(idZona))
          .addTo(map);
      } else if (hull.type === 'circle') {
        L.circle(hull.center, { radius: 30, color, fillColor: color, fillOpacity: 0.35 })
          .bindTooltip(window.__sigcPro.escapeHtml(idZona))
          .addTo(map);
      }
    });

    // --- Layer 2: domicílio markers, colored by status ---------------
    const bounds = [];
    withCoords.forEach((r) => {
      const color = statusColor(r);
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

    // --- Layer 3: Controle labels, always visible ---------------------
    const CONTROLE_LABEL_COLOR = {
      inactive: '#888888',
      active: '#0072B2',
      partial: '#E69F00',
    };
    controleCentroids(joined).forEach(({ controle, lat, lon, colorState }) => {
      const shortId = String(controle).slice(-6);
      const color = CONTROLE_LABEL_COLOR[colorState];
      L.marker([lat, lon], {
        icon: L.divIcon({
          className: 'sigc-pro-controle-label',
          html: `<span style="background:${color};" title="${window.__sigcPro.escapeHtml(String(controle))}">${window.__sigcPro.escapeHtml(shortId)}</span>`,
          iconSize: null,
        }),
        interactive: false,
      }).addTo(map);
    });

    addStatusLegend(map);
    map.fitBounds(bounds, { padding: [20, 20] });
  }

  // Fixed corner legend for the 6 marker-status colors (spec: "Status
  // legend" section) — no separate legend for hull or Controle-label
  // colors, per the design's explicit scope decision.
  function addStatusLegend(map) {
    const entries = [
      ['Inativo (Distribuído)', STATUS_INATIVO],
      ['Realizada', STATUS_REALIZADA],
      ['Recusa', STATUS_RECUSA],
      ['Não Iniciada', STATUS_NAO_INICIADA],
      ['Domicílio Fechado', STATUS_FECHADO],
      ['Outros', STATUS_OUTROS],
    ];
    const div = L.DomUtil.create('div', 'sigc-pro-status-legend');
    div.innerHTML = entries.map(([label, color]) => (
      `<div><span style="display:inline-block;width:10px;height:10px;background:${color};margin-right:4px;"></span>${window.__sigcPro.escapeHtml(label)}</div>`
    )).join('');
    const control = L.control({ position: 'bottomleft' });
    control.onAdd = () => div;
    control.addTo(map);
  }
```

Note: `withCoords.length === 0` early-return now also calls
`addStatusLegend(map)` before returning, so the legend still shows even
with zero mapped points (matches the spec's "always render the legend"
implication — the map still exists, just empty).

- [ ] **Step 3: Add minimal CSS for the Controle label and legend**

Find the existing `PANEL_CSS` constant (added in the base Mapa plan's
Task 6) and append:

```css
    .sigc-pro-controle-label span { font-size: 10px; font-weight: 600; color: #fff;
      padding: 1px 4px; border-radius: 3px; white-space: nowrap;
      box-shadow: 0 0 2px rgba(0,0,0,.6); }
    .sigc-pro-status-legend { background: #fff; padding: 6px 8px; border-radius: 4px;
      font-size: 11px; line-height: 1.6; box-shadow: 0 0 4px rgba(0,0,0,.3); }
```

- [ ] **Step 4: Run the full test suite**

Run: `bun test`
Expected: all tests PASS (no new tests in this task — see Interfaces
above — but Tasks 1-3's tests, and everything else, must still pass).

- [ ] **Step 5: Run the privacy gate**

Run: `sh scripts/check-privacy.sh` and `sh scripts/check-privacy.sh --staged`
Expected: both CLEAN. This task adds no new `.src=`/`.href=`/fetch/
storage calls, so no gate change is expected — if the gate fails,
something in this task's diff introduced a banned pattern; investigate
rather than modify the gate.

- [ ] **Step 6: Commit**

```bash
git add extension/features/ultimo-movimento-map/ultimo-movimento-map.js
git commit -m "feat: render zona hulls, Controle labels, status legend on Mapa"
```

---

### Task 5: Manual verification

**Files:** none (verification only).

- [ ] **Step 1: Manual verification checklist**

Load the unpacked extension in Chrome against a live SIGC session, on
the Último Movimento page, with data covering multiple zonas and at
least one Controle with mixed ultima_posicao values if possible:

1. Click Mapa, accept both consents (same flow as before).
2. Confirm markers are now colored by status, not zona — a Recusa
   domicílio should be visibly red/orange, Realizada green, and any
   still-Distribuído domicílio gray, regardless of which zona it's in.
3. Confirm each zona with ≥3 non-collinear points shows a filled outline
   polygon in that zona's color; a zona with fewer points shows a small
   circle or thin capsule instead — every zona with mapped points shows
   something.
4. Confirm "Sem zona" households have no hull/outline around them, only
   their (status-colored) marker.
5. Confirm a small colored label appears near each Controle's cluster of
   domicílios, showing the last 6 digits of the Controle number; hover
   or click to confirm the full Controle number is available.
6. Confirm label colors: a Controle where every domicílio is still
   Distribuído shows gray; one with no Distribuído domicílios shows
   blue; one with a mix shows orange.
7. Confirm the status legend (6 entries) appears in a fixed corner of
   the map and stays visible while panning/zooming.
8. Zoom out significantly (multiple zonas/Controles in view) — confirm
   labels/hulls still render (overlap at extreme zoom is expected/
   accepted per the design, not a bug to chase here).

- [ ] **Step 2: Report findings**

No commit for this task — if manual verification finds a bug, that's a
new, separate fix (out of this plan's scope to pre-write).

---

## Self-Review Notes

- **Spec coverage:** marker status color (Task 1), zona hulls with all
  three degenerate cases (Task 2 pure logic, Task 4 rendering), Controle
  centroids + 3-way color rule (Task 3 pure logic, Task 4 rendering),
  "Sem zona" excluded from hulls (Task 4's `if (!r.idZona) return`),
  status legend only — no hull/label legend (Task 4's `addStatusLegend`,
  no second legend function), no zoom-based label hiding (Task 4's
  labels are added unconditionally, no zoom listener) — every spec
  section maps to a task.
- **Placeholder scan:** no TBD/TODO; all color hex values, thresholds,
  and function signatures are concrete and copied from the spec's
  resolved decisions, not left open.
- **Type consistency:** `joined` row shape consumed by all three new
  functions (`statusColor`, the hull-grouping logic in Task 4,
  `controleCentroids`) matches the shape already established in the
  base Mapa plan (`{controle, domicilio, entrevistador, tipoEntrevista,
  ultimaPosicao, data, lat, lon, zona, idZona, temCoordenadas, temZona}`).
  `convexHull`'s return shape (`{type, ...}`) is used identically in its
  own tests (Task 2) and in `renderLeafletMap`'s consumption (Task 4).
  `controleCentroids`'s `colorState` enum (`'inactive'|'active'|'partial'`)
  is defined once in Task 3 and consumed by name in Task 4's
  `CONTROLE_LABEL_COLOR` lookup — no drift between the two.
