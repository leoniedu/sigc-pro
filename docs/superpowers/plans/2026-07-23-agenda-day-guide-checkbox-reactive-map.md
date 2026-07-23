# Checkbox-Reactive SVG Route Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Guia do Dia's SVG route map (team panel's own map, and Resumo's combined "Mapa do dia") dim unchecked stops and rebuild its connecting line to match the checkbox route selector's current selection, instead of staying static.

**Architecture:** All changes live in `extension/features/agenda-day-guide/agenda-day-guide.js`. A new pure helper `routeIdxMap(rowSets, enderecos)` — modeled on the existing `stopSequenceMap` — assigns each routable stop a single flat 0-based index (`Map<enderecoKey, idx>`) across a `rowSets` array (`Array<{rows}>`), so team panels and Resumo call it with the exact same array shape `buildRouteMapSvg` already receives, guaranteeing checkbox and dot indices agree by construction rather than by two independently-written counting loops staying in lockstep. `routeCheckboxInput` gains an `idx` parameter (rendered as `data-idx`). `buildRouteMapSvg` gains a `groupId` parameter and wraps each stop's dot elements in a `<g data-idx data-x data-y>`, gives its polyline a stable `id="route-line-<groupId>"`, and (for multi-set calls, i.e. Resumo) draws one combined neutral-grey polyline instead of one per set. The inline `<script>`'s existing `refreshGroup` function gains a redraw step that dims unchecked `<g>`s and rebuilds the polyline's `points` from checked ones — no new event listener.

**Tech Stack:** Vanilla ES2020, Chrome MV3 MAIN-world content script, no bundler. `bun:test` + `happy-dom` (`tests/agenda-day-guide-route-selector.test.js`, existing — extended); `bun build --no-bundle <file> --outfile=/dev/null` for syntax checks (node is absent from PATH). Spec: `docs/superpowers/specs/2026-07-23-agenda-day-guide-checkbox-reactive-map-design.md`. Amends: `docs/superpowers/specs/2026-07-22-agenda-day-guide-dynamic-route-design.md` and `docs/superpowers/specs/2026-07-18-agenda-day-route-map-design.md` (both already shipped).

## Global Constraints

- The map's projection, scale, dot positions, and visible sequence numbers (the digit drawn inside each circle) never change on toggle — no rescaling, no re-projection, no renumbering (spec, "What redraws, and what doesn't").
- Only two things change on toggle: a stop's dot elements drop to/return from reduced opacity, and the polyline's `points` rebuild to pass only through checked stops in time order (spec, same section).
- Below 2 checked stops in a group, no line is drawn at all — same threshold the live link already uses (spec, same section).
- The "N visita(s) sem coordenadas" note, scale bar, north arrow, and (Resumo) color legend are all unaffected by checkbox state (spec, same section).
- Resumo's map draws **one combined polyline** (not one per team) spanning every checked stop across all teams, in time order, colored neutral dark grey (`#333`). Dots keep their existing per-team color. Team panels (always one team) keep their line in that team's own color — unaffected by the Resumo change (spec, "Resumo: one polyline, not one per team").
- `data-idx` is a **script-only join key**, never rendered as visible text — distinct from the visible sequence number, which stays exactly as-is (spec, "Data attributes reaching the script").
- `data-idx` values are assigned by a **single flattened, cross-team running counter** — not reset per team/rowSet — and must be identical between a checkbox and its corresponding dot for the same stop, in both the team-panel and Resumo call sites (spec, same section).
- The map's redraw is added to the existing `refreshGroup(groupId)` function, not a new listener, and its dimming/line-rebuild step runs **before** `refreshGroup`'s existing early return on `< 2` checked (that early return only ever gated the link, not the map) (spec, "Script change").
- No `data-team` or other color-carrying attribute is added anywhere — dot color is already baked into each `<circle>`'s `fill` at build time (spec, "Data attributes reaching the script").
- `./scripts/check-privacy.sh` must stay clean after every task (no new network APIs — this is pure string/DOM building).
- Existing exact behavior/functions must not change except where this plan explicitly modifies them: `groupByEquipe`, `computeStats`, `zonasUnion`, `slotInfo`, `zonaLabel`, `fmtCoord`, `gmapsRouteUrl`, `enderecoKey`, `projectPoints`, `teamColor`, `stopLabel`, `stopSequenceMap`, `buildLegend`, `buildSlotCard`'s existing rendering (aside from threading the new `idx` parameter through to `routeCheckboxInput`), `routeCheckboxHtml`, `buildRouteSelector`'s existing rendering (aside from threading `idx`), `TABLE_CSS`, `guideMeta`, `fileName`, `generate`, `buildSummaryPanel`'s existing rendering (aside from threading `groupId`/index data into its `buildRouteMapSvg` call), `window.__sigcPro.dayGuide`'s existing keys (`generate`, `diaViewActive`, `buildRouteSelector`, `buildTeamPanel`, `buildSummaryPanel`, `buildGuideHtml`, `routeCheckboxInput`, `routeCheckboxHtml`, `buildSlotCard` — none removed, new keys may be added).

---

### Task 1: `routeIdxMap` helper, thread `data-idx` into checkboxes

**Files:**
- Modify: `extension/features/agenda-day-guide/agenda-day-guide.js` (add `routeIdxMap` near `stopSequenceMap`; modify `routeCheckboxInput`, `routeCheckboxHtml`, `buildRouteSelector`, `buildSlotCard`, `buildTeamPanel`, `buildSummaryPanel`)
- Test: `tests/agenda-day-guide-route-selector.test.js` (extend)

**Interfaces:**
- Consumes: `enderecoKey`, `slotInfo` (both already in the file, unchanged).
- Produces (Task 2 relies on this exact signature and on the `idx` values it assigns):
  `routeIdxMap(rowSets, enderecos)` — `rowSets` is `Array<{ rows: Array<row> }>` (the same shape, minus `color`, that `buildRouteMapSvg`'s `rowSets` parameter already has — a team panel passes `[{ rows: group.rows }]`, Resumo passes `groups.map((g) => ({ rows: g.rows }))`). Returns `Map<enderecoKey, idx>` where `idx` is a single 0-based counter incrementing across ALL sets in order (does not reset per set), assigned only to rows that are reserved AND have `slotInfo(...).lat != null` (routable) — exactly the same eligibility rule `stopSequenceMap`/`buildRouteMapSvg`'s `plottable` filter already use. A row that isn't in the map (open row, or reserved-but-not-routable) has no `idx`.
  `routeCheckboxInput(r, info, groupId, checked, idx)` — new 5th parameter, `idx` is a number or `null`/`undefined`. When `idx != null` AND the row is routable (`info && info.lat != null`), the returned `<input>` carries `data-idx="${idx}"` alongside its existing attributes. When `idx` is `null`/`undefined`, or the row is non-routable, no `data-idx` attribute is emitted (unchanged bare-disabled-input shape for non-routable rows).
  `routeCheckboxHtml(r, info, groupId, checked, idx)` — same new 5th parameter, passed straight through to `routeCheckboxInput`.

- [ ] **Step 1: Write the failing test for `routeIdxMap`**

Append to `tests/agenda-day-guide-route-selector.test.js`, after the `describe('routeCheckboxHtml', ...)` block's closing `});` (before `describe('buildTeamPanel route selector wiring', ...)`):

```js
describe('routeIdxMap', () => {
  test('single rowSet: 0-based index across routable rows only, in row order', () => {
    const { routeIdxMap } = window.__sigcPro.dayGuide;
    const rows = [
      row({ horaInicio: '09:00', controle: 'C1', domicilio: 'D1' }),
      row({ horaInicio: '10:00', controle: 'C2', domicilio: 'D2' }), // no coords below
      row({ horaInicio: '11:00', controle: 'C3', domicilio: 'D3' }),
    ];
    const enderecos = enderecosMap([
      ['C1', 'D1', -12.9, -38.5],
      ['C3', 'D3', -12.7, -38.3],
    ]);
    const map = routeIdxMap([{ rows }], enderecos);
    expect(map.get('C1|D1')).toBe(0);
    expect(map.has('C2|D2')).toBe(false); // no coords -> not routable -> no idx
    expect(map.get('C3|D3')).toBe(1);
  });

  test('multiple rowSets: counter is flat across sets, does not reset', () => {
    const { routeIdxMap } = window.__sigcPro.dayGuide;
    const rowsA = [row({ horaInicio: '09:00', controle: 'C1', domicilio: 'D1' })];
    const rowsB = [
      row({ horaInicio: '08:00', controle: 'C2', domicilio: 'D2' }),
      row({ horaInicio: '09:30', controle: 'C3', domicilio: 'D3' }),
    ];
    const enderecos = enderecosMap([
      ['C1', 'D1', -12.9, -38.5],
      ['C2', 'D2', -12.8, -38.4],
      ['C3', 'D3', -12.7, -38.3],
    ]);
    const map = routeIdxMap([{ rows: rowsA }, { rows: rowsB }], enderecos);
    expect(map.get('C1|D1')).toBe(0); // last stop of set A
    expect(map.get('C2|D2')).toBe(1); // first stop of set B, continues the counter
    expect(map.get('C3|D3')).toBe(2);
  });

  test('open (non-reserved) rows never get an idx', () => {
    const { routeIdxMap } = window.__sigcPro.dayGuide;
    const rows = [row({ reservado: false, controle: 'C1', domicilio: 'D1' })];
    const enderecos = enderecosMap([['C1', 'D1', -12.9, -38.5]]);
    const map = routeIdxMap([{ rows }], enderecos);
    expect(map.size).toBe(0);
  });

  test('no enderecos: nothing is routable, empty map', () => {
    const { routeIdxMap } = window.__sigcPro.dayGuide;
    const rows = [row({ controle: 'C1', domicilio: 'D1' })];
    const map = routeIdxMap([{ rows }], null);
    expect(map.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/agenda-day-guide-route-selector.test.js -t "routeIdxMap"`
Expected: FAIL — `routeIdxMap` is `undefined` (not yet exported).

- [ ] **Step 3: Implement `routeIdxMap`**

Add this function in `extension/features/agenda-day-guide/agenda-day-guide.js`, immediately after `stopSequenceMap` (which ends around line 272 with its closing `}`):

```js
  // enderecoKey -> single flat 0-based index across ALL rowSets' PLOTTABLE
  // (reserved + has coordinates) rows, in rowSets order then each set's own
  // row order — the counter does NOT reset per set. This is the join key
  // shared by a checkbox's data-idx and its dot's data-idx in
  // buildRouteMapSvg: both must walk identically-shaped rowSets in the
  // same order for the two to agree, so callers always pass the SAME
  // rowSets array (or an array built the same way) to both this function
  // and buildRouteMapSvg. Unlike stopSequenceMap (which restarts at 1 per
  // call, matching each dot's VISIBLE number), this index is never shown
  // to the user — it exists only for the inline script to match a
  // checkbox to its dot.
  function routeIdxMap(rowSets, enderecos) {
    const map = new Map();
    let idx = 0;
    rowSets.forEach((set) => {
      set.rows.forEach((r) => {
        const info = slotInfo(r, enderecos);
        if (info && info.lat != null) {
          map.set(enderecoKey(r), idx);
          idx += 1;
        }
      });
    });
    return map;
  }
```

- [ ] **Step 4: Expose `routeIdxMap` for tests**

Find the export line near the bottom of the file:

```js
  window.__sigcPro.dayGuide = { generate, diaViewActive, buildRouteSelector, buildTeamPanel, buildSummaryPanel, buildGuideHtml, routeCheckboxInput, routeCheckboxHtml, buildSlotCard };
```

Replace with:

```js
  window.__sigcPro.dayGuide = { generate, diaViewActive, buildRouteSelector, buildTeamPanel, buildSummaryPanel, buildGuideHtml, routeCheckboxInput, routeCheckboxHtml, buildSlotCard, routeIdxMap };
```

- [ ] **Step 5: Run test to verify `routeIdxMap` passes**

Run: `bun test tests/agenda-day-guide-route-selector.test.js -t "routeIdxMap"`
Expected: all 4 tests PASS.

- [ ] **Step 6: Write the failing tests for `data-idx` on checkboxes**

Append to `tests/agenda-day-guide-route-selector.test.js`, inside a new test appended to the existing `describe('routeCheckboxInput', ...)` block (find its closing `});` and insert before it):

```js
  test('idx provided and row is routable: carries data-idx', () => {
    const { routeCheckboxInput } = window.__sigcPro.dayGuide;
    const r = row({ controle: 'C1', domicilio: 'D1' });
    const info = { lat: -12.9, lon: -38.5, zona: null, idZona: null };
    const html = routeCheckboxInput(r, info, 'team-0', true, 3);
    expect(html).toContain('data-idx="3"');
  });

  test('idx omitted: no data-idx attribute', () => {
    const { routeCheckboxInput } = window.__sigcPro.dayGuide;
    const r = row({ controle: 'C1', domicilio: 'D1' });
    const info = { lat: -12.9, lon: -38.5, zona: null, idZona: null };
    const html = routeCheckboxInput(r, info, 'team-0', true);
    expect(html).not.toContain('data-idx');
  });

  test('non-routable row: idx is ignored, no data-idx even if provided', () => {
    const { routeCheckboxInput } = window.__sigcPro.dayGuide;
    const r = row({ controle: 'C1', domicilio: 'D1' });
    const html = routeCheckboxInput(r, null, 'team-0', true, 3);
    expect(html).not.toContain('data-idx');
  });
```

Then append this test to the existing `describe('routeCheckboxHtml', ...)` block (before its closing `});`):

```js
  test('idx passes through to the wrapped input', () => {
    const { routeCheckboxHtml } = window.__sigcPro.dayGuide;
    const r = row({ controle: 'C1', domicilio: 'D1' });
    const info = { lat: -12.9, lon: -38.5, zona: null, idZona: null };
    const html = routeCheckboxHtml(r, info, 'team-0', true, 5);
    expect(html).toContain('data-idx="5"');
  });
```

- [ ] **Step 7: Run test to verify it fails**

Run: `bun test tests/agenda-day-guide-route-selector.test.js -t "data-idx"`
Expected: FAIL — `routeCheckboxInput`/`routeCheckboxHtml` don't accept/emit `idx` yet.

- [ ] **Step 8: Thread `idx` through `routeCheckboxInput` and `routeCheckboxHtml`**

In `routeCheckboxInput` (around line 123), find:

```js
  function routeCheckboxInput(r, info, groupId, checked) {
    const e = escapeHtml;
    if (info && info.lat != null) {
      const checkedAttr = checked ? ' checked' : '';
      return `<input type="checkbox" class="route-chk" data-group="${e(groupId)}" ` +
        `data-lat="${info.lat.toFixed(6)}" data-lon="${info.lon.toFixed(6)}" ` +
        `data-name="${e(routeStopLabel(r))}"${checkedAttr}>`;
    }
    return '<input type="checkbox" disabled>';
  }
```

Replace with:

```js
  function routeCheckboxInput(r, info, groupId, checked, idx) {
    const e = escapeHtml;
    if (info && info.lat != null) {
      const checkedAttr = checked ? ' checked' : '';
      const idxAttr = idx != null ? ` data-idx="${idx}"` : '';
      return `<input type="checkbox" class="route-chk" data-group="${e(groupId)}" ` +
        `data-lat="${info.lat.toFixed(6)}" data-lon="${info.lon.toFixed(6)}" ` +
        `data-name="${e(routeStopLabel(r))}"${idxAttr}${checkedAttr}>`;
    }
    return '<input type="checkbox" disabled>';
  }
```

Then find `routeCheckboxHtml` (around line 138):

```js
  function routeCheckboxHtml(r, info, groupId, checked) {
    const e = escapeHtml;
    const label = routeStopLabel(r);
    // Displayed label adds the same Controle/Dom/Zona detail buildSlotCard
    // shows on the card itself, so a checked-off stop is identifiable
    // without cross-referencing the card above/below it.
    const zona = zonaLabel(info);
    const detail = [
      r.controle && `Controle: ${e(r.controle)}`,
      r.domicilio && `Dom: ${e(r.domicilio)}`,
      zona && `Zona: ${e(zona)}`,
    ].filter(Boolean).join(' &nbsp;·&nbsp; ');
    const display = detail ? `${e(label)} — ${detail}` : e(label);
    const input = routeCheckboxInput(r, info, groupId, checked);
    if (info && info.lat != null) {
      return `<label class="route-item">${input} ${display}</label>`;
    }
    return `<label class="route-item route-item-missing">${input} ${display} — sem coordenadas</label>`;
  }
```

Replace with:

```js
  function routeCheckboxHtml(r, info, groupId, checked, idx) {
    const e = escapeHtml;
    const label = routeStopLabel(r);
    // Displayed label adds the same Controle/Dom/Zona detail buildSlotCard
    // shows on the card itself, so a checked-off stop is identifiable
    // without cross-referencing the card above/below it.
    const zona = zonaLabel(info);
    const detail = [
      r.controle && `Controle: ${e(r.controle)}`,
      r.domicilio && `Dom: ${e(r.domicilio)}`,
      zona && `Zona: ${e(zona)}`,
    ].filter(Boolean).join(' &nbsp;·&nbsp; ');
    const display = detail ? `${e(label)} — ${detail}` : e(label);
    const input = routeCheckboxInput(r, info, groupId, checked, idx);
    if (info && info.lat != null) {
      return `<label class="route-item">${input} ${display}</label>`;
    }
    return `<label class="route-item route-item-missing">${input} ${display} — sem coordenadas</label>`;
  }
```

- [ ] **Step 9: Run test to verify it passes**

Run: `bun test tests/agenda-day-guide-route-selector.test.js -t "data-idx"`
Expected: all 4 tests PASS.

- [ ] **Step 10: Write the failing test for `buildRouteSelector` assigning idx from `routeIdxMap`**

Append to the existing `describe('buildRouteSelector', ...)` block (before its closing `});`):

```js
  test('assigns data-idx from a shared cross-team counter (flatMap-style call)', () => {
    const rows = [
      row({ horaInicio: '09:00', controle: 'C1', domicilio: 'D1' }),
      row({ horaInicio: '10:00', controle: 'C2', domicilio: 'D2' }),
    ];
    const enderecos = enderecosMap([
      ['C1', 'D1', -12.9, -38.5],
      ['C2', 'D2', -12.8, -38.4],
    ]);
    const html = buildRouteSelector(rows, enderecos, 'resumo', false);
    const idxA = html.indexOf('data-idx="0"');
    const idxB = html.indexOf('data-idx="1"');
    expect(idxA).toBeGreaterThan(-1);
    expect(idxB).toBeGreaterThan(-1);
    // idx 0 belongs to C1 (first in row order), idx 1 to C2.
    expect(html.indexOf('data-name="09:00')).toBeLessThan(html.indexOf('data-name="10:00'));
  });
```

- [ ] **Step 11: Run test to verify it fails**

Run: `bun test tests/agenda-day-guide-route-selector.test.js -t "shared cross-team counter"`
Expected: FAIL — `buildRouteSelector` doesn't compute/pass `idx` yet.

- [ ] **Step 12: Wire `routeIdxMap` into `buildRouteSelector`**

Find `buildRouteSelector` (around line 161):

```js
  function buildRouteSelector(rows, enderecos, groupId, defaultAllChecked) {
    const e = escapeHtml;
    const items = rows.filter((r) => r.reservado).map((r) =>
      routeCheckboxHtml(r, slotInfo(r, enderecos), groupId, defaultAllChecked)
    );
    if (items.length === 0) return '';
    return '<div class="route-selector">' +
      items.join('\n') +
      `<div class="rota-link" id="rota-link-${e(groupId)}"></div>` +
      '</div>';
  }
```

Replace with:

```js
  function buildRouteSelector(rows, enderecos, groupId, defaultAllChecked) {
    const e = escapeHtml;
    const idxMap = routeIdxMap([{ rows }], enderecos);
    const items = rows.filter((r) => r.reservado).map((r) =>
      routeCheckboxHtml(r, slotInfo(r, enderecos), groupId, defaultAllChecked, idxMap.get(enderecoKey(r)))
    );
    if (items.length === 0) return '';
    return '<div class="route-selector">' +
      items.join('\n') +
      `<div class="rota-link" id="rota-link-${e(groupId)}"></div>` +
      '</div>';
  }
```

Note: `buildRouteSelector` is called by `buildSummaryPanel` as `buildRouteSelector(groups.flatMap((g) => g.rows), enderecos, 'resumo', false)` — a single flat `rows` array, not a `groups`-shaped `rowSets` array. Wrapping it as `[{ rows }]` here (one set containing the already-flattened rows) still gives a flat 0-based counter across every row in that single set — which is what this call site needs — but this is a **different set boundary** than Task 2's `buildRouteMapSvg` call for Resumo, which will receive `groups.map((g) => ({ rows: g.rows }))` (multiple sets, one per team). Both produce the SAME per-row idx values for the SAME rows in the SAME order (the counter only cares about row order, not how many sets that order is split into) — flattening 3 teams' rows into one set or keeping them as 3 sets yields identical idx assignments as long as the overall row order is unchanged. Task 3's tests confirm this equivalence explicitly.

- [ ] **Step 13: Run test to verify it passes**

Run: `bun test tests/agenda-day-guide-route-selector.test.js -t "shared cross-team counter"`
Expected: PASS.

- [ ] **Step 14: Thread `idx` through `buildSlotCard` and `buildTeamPanel`**

Find `buildSlotCard` (around line 406), which currently starts:

```js
  function buildSlotCard(r, enderecos, seqMap, color, routeGroupId, checked) {
```

Change its signature and its one call to `routeCheckboxInput` (currently `const chk = \`${routeCheckboxInput(r, info, routeGroupId, checked)} \`;`):

```js
  function buildSlotCard(r, enderecos, seqMap, color, routeGroupId, checked, idx) {
```

and:

```js
    const chk = `${routeCheckboxInput(r, info, routeGroupId, checked, idx)} `;
```

Find `buildTeamPanel` (around line 461). Locate:

```js
    const seqMap = stopSequenceMap(group.rows, enderecos);
    const color = teamColor(colorIndex);
    const cards = group.rows.map((r, i) => {
      const edge = first === -1 || i < first || i > last;
      return !r.reservado && edge
        ? buildLivreEdgeRow(r)
        : buildSlotCard(r, enderecos, seqMap, color, routeGroupId, defaultChecked);
    });
```

Replace with:

```js
    const seqMap = stopSequenceMap(group.rows, enderecos);
    const idxMap = routeIdxMap([{ rows: group.rows }], enderecos);
    const color = teamColor(colorIndex);
    const cards = group.rows.map((r, i) => {
      const edge = first === -1 || i < first || i > last;
      return !r.reservado && edge
        ? buildLivreEdgeRow(r)
        : buildSlotCard(r, enderecos, seqMap, color, routeGroupId, defaultChecked, idxMap.get(enderecoKey(r)));
    });
```

- [ ] **Step 15: Write the failing test for `buildTeamPanel` assigning idx to cards**

Append to the existing `describe('buildTeamPanel route selector wiring', ...)` block (before its closing `});`):

```js
  test('each card carries data-idx matching its routable position', () => {
    const { buildTeamPanel } = window.__sigcPro.dayGuide;
    const rows = [row({ horaInicio: '09:00' }), row({ horaInicio: '10:00', controle: 'C2', domicilio: 'D2' })];
    const enderecos = enderecosMap([
      ['C1', 'D1', -12.9, -38.5],
      ['C2', 'D2', -12.8, -38.4],
    ]);
    const html = buildTeamPanel({ equipe: 'Equipe A', rows }, enderecos, 0);
    expect(html).toContain('data-idx="0"');
    expect(html).toContain('data-idx="1"');
    // idx 0 (09:00/C1) appears before idx 1 (10:00/C2) in document order.
    expect(html.indexOf('data-idx="0"')).toBeLessThan(html.indexOf('data-idx="1"'));
  });
```

- [ ] **Step 16: Run test to verify it fails, then passes**

Run: `bun test tests/agenda-day-guide-route-selector.test.js -t "matching its routable position"`
Expected: FAILs before Step 14's edit is complete testing-wise if run first; since Step 14 already applied the implementation, running now should PASS. (If practicing strict TDD red-green, run this test immediately after Step 15 and before Step 14 to see it fail, then apply Step 14 and re-run to see it pass — either ordering is acceptable since Step 14's code change is fully specified above.)

- [ ] **Step 17: Wire `routeIdxMap` into `buildSummaryPanel`'s `buildRouteSelector` call context**

`buildSummaryPanel` already calls `buildRouteSelector(groups.flatMap((g) => g.rows), enderecos, 'resumo', false)` (unchanged by this task — `buildRouteSelector` now computes its own `idxMap` internally per Step 12, so no edit is needed in `buildSummaryPanel` for this task). Confirm this by reading the current file — no code change, this step is a checkpoint only.

Run: `grep -n "buildRouteSelector(groups.flatMap" extension/features/agenda-day-guide/agenda-day-guide.js`
Expected: one match, unchanged from before this task.

- [ ] **Step 18: Run the full existing test file**

Run: `bun test tests/agenda-day-guide-route-selector.test.js`
Expected: all tests PASS — every pre-existing test plus all tests added in this task.

- [ ] **Step 19: Syntax check**

Run: `bun build --no-bundle extension/features/agenda-day-guide/agenda-day-guide.js --outfile=/tmp/day-guide-check.js`
Expected: no output, exit code 0.

- [ ] **Step 20: Commit**

```bash
git add extension/features/agenda-day-guide/agenda-day-guide.js tests/agenda-day-guide-route-selector.test.js
git commit -m "feat: add routeIdxMap, thread data-idx into route checkboxes"
```

---

### Task 2: `data-idx`/`data-x`/`data-y` on map dots, single combined polyline for multi-set calls

**Files:**
- Modify: `extension/features/agenda-day-guide/agenda-day-guide.js` (`buildRouteMapSvg`, its two call sites in `buildTeamPanel` and `buildSummaryPanel`)
- Test: `tests/agenda-day-guide-route-selector.test.js` (extend)

**Interfaces:**
- Consumes: `routeIdxMap` (Task 1), `enderecoKey`, `projectPoints`, `escapeHtml` (all already in the file or from Task 1).
- Produces (Task 3 relies on these exact shapes):
  `buildRouteMapSvg(rowSets, enderecos, width, height, groupId)` — new 5th parameter. Every plottable stop's `<circle>` + its two `<text>` labels are now wrapped in `<g data-idx="N" data-x="X" data-y="Y">...</g>`, where `N` comes from `routeIdxMap([...same rowSets...], enderecos)` looked up by that row's `enderecoKey`, and `X`/`Y` are the same `toFixed(1)` pixel values already used for `cx`/`cy`. When `rowSets.length === 1` (team panel), behavior is otherwise unchanged: one polyline in that set's own color. When `rowSets.length > 1` (Resumo), instead of one polyline per set, exactly ONE polyline is drawn spanning every plottable stop across all sets, in flattened order, colored `#333` (neutral, not any team's color); dots keep their own set's color, unaffected. The polyline (when drawn) carries `id="route-line-${groupId}"`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/agenda-day-guide-route-selector.test.js`, in a new `describe` block after `describe('routeIdxMap', ...)` (before `describe('buildTeamPanel route selector wiring', ...)`):

```js
describe('buildRouteMapSvg data-idx/data-x/data-y and polyline id', () => {
  test('single rowSet (team panel shape): each dot wrapped in <g data-idx data-x data-y>, matches routeIdxMap', () => {
    const { buildRouteMapSvg, routeIdxMap } = window.__sigcPro.dayGuide;
    const rows = [
      row({ horaInicio: '09:00', controle: 'C1', domicilio: 'D1' }),
      row({ horaInicio: '10:00', controle: 'C2', domicilio: 'D2' }),
    ];
    const enderecos = enderecosMap([
      ['C1', 'D1', -12.9, -38.5],
      ['C2', 'D2', -12.8, -38.4],
    ]);
    const rowSets = [{ rows, color: '#E69F00' }];
    const idxMap = routeIdxMap(rowSets, enderecos);
    const svg = buildRouteMapSvg(rowSets, enderecos, 480, 320, 'team-0');
    expect(svg).toContain(`<g data-idx="${idxMap.get('C1|D1')}"`);
    expect(svg).toContain(`<g data-idx="${idxMap.get('C2|D2')}"`);
    expect(svg).toMatch(/<g data-idx="0" data-x="[\d.]+" data-y="[\d.]+">/);
  });

  test('single rowSet: polyline carries id="route-line-<groupId>" and keeps the set color', () => {
    const { buildRouteMapSvg } = window.__sigcPro.dayGuide;
    const rows = [
      row({ horaInicio: '09:00', controle: 'C1', domicilio: 'D1' }),
      row({ horaInicio: '10:00', controle: 'C2', domicilio: 'D2' }),
    ];
    const enderecos = enderecosMap([
      ['C1', 'D1', -12.9, -38.5],
      ['C2', 'D2', -12.8, -38.4],
    ]);
    const svg = buildRouteMapSvg([{ rows, color: '#E69F00' }], enderecos, 480, 320, 'team-0');
    expect(svg).toContain('id="route-line-team-0"');
    expect(svg).toContain('stroke="#E69F00"');
  });

  test('multiple rowSets (Resumo shape): exactly one polyline, neutral color, not per-set', () => {
    const { buildRouteMapSvg } = window.__sigcPro.dayGuide;
    const rowsA = [row({ horaInicio: '09:00', controle: 'C1', domicilio: 'D1' })];
    const rowsB = [row({ horaInicio: '10:00', controle: 'C2', domicilio: 'D2' })];
    const enderecos = enderecosMap([
      ['C1', 'D1', -12.9, -38.5],
      ['C2', 'D2', -12.8, -38.4],
    ]);
    const svg = buildRouteMapSvg(
      [{ rows: rowsA, color: '#E69F00' }, { rows: rowsB, color: '#56B4E9' }],
      enderecos, 640, 420, 'resumo'
    );
    const polylineCount = (svg.match(/<polyline/g) || []).length;
    expect(polylineCount).toBe(1);
    expect(svg).toContain('id="route-line-resumo"');
    expect(svg).toContain('stroke="#333"');
    // Dots still keep their own set's color.
    expect(svg).toContain('fill="#E69F00"');
    expect(svg).toContain('fill="#56B4E9"');
  });

  test('multiple rowSets: data-idx is a flat counter, does not reset at the second set', () => {
    const { buildRouteMapSvg, routeIdxMap } = window.__sigcPro.dayGuide;
    const rowsA = [row({ horaInicio: '09:00', controle: 'C1', domicilio: 'D1' })];
    const rowsB = [row({ horaInicio: '10:00', controle: 'C2', domicilio: 'D2' })];
    const enderecos = enderecosMap([
      ['C1', 'D1', -12.9, -38.5],
      ['C2', 'D2', -12.8, -38.4],
    ]);
    const rowSets = [{ rows: rowsA, color: '#E69F00' }, { rows: rowsB, color: '#56B4E9' }];
    const idxMap = routeIdxMap(rowSets, enderecos);
    expect(idxMap.get('C1|D1')).toBe(0);
    expect(idxMap.get('C2|D2')).toBe(1);
    const svg = buildRouteMapSvg(rowSets, enderecos, 640, 420, 'resumo');
    expect(svg).toContain('<g data-idx="0"');
    expect(svg).toContain('<g data-idx="1"');
  });

  test('visible sequence number is unaffected by data-idx (still restarts at 1 per set)', () => {
    const { buildRouteMapSvg } = window.__sigcPro.dayGuide;
    const rowsA = [row({ horaInicio: '09:00', controle: 'C1', domicilio: 'D1' })];
    const rowsB = [row({ horaInicio: '10:00', controle: 'C2', domicilio: 'D2' })];
    const enderecos = enderecosMap([
      ['C1', 'D1', -12.9, -38.5],
      ['C2', 'D2', -12.8, -38.4],
    ]);
    const svg = buildRouteMapSvg(
      [{ rows: rowsA, color: '#E69F00' }, { rows: rowsB, color: '#56B4E9' }],
      enderecos, 640, 420, 'resumo'
    );
    // Both sets' first (and only) dot shows visible number "1" — unrelated
    // to the flat data-idx counter used above (0 and 1 respectively).
    const oneCount = (svg.match(/>1<\/text>/g) || []).length;
    expect(oneCount).toBe(2);
  });

  test('below 2 checked-equivalent plottable points in a set, still draws that single dot with its <g> wrapper (no polyline)', () => {
    const { buildRouteMapSvg } = window.__sigcPro.dayGuide;
    const rows = [row({ horaInicio: '09:00', controle: 'C1', domicilio: 'D1' })];
    const enderecos = enderecosMap([['C1', 'D1', -12.9, -38.5]]);
    const svg = buildRouteMapSvg([{ rows, color: '#E69F00' }], enderecos, 480, 320, 'team-0');
    expect(svg).toContain('<g data-idx="0"');
    expect(svg).not.toContain('<polyline');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/agenda-day-guide-route-selector.test.js -t "buildRouteMapSvg data-idx"`
Expected: FAIL — `buildRouteMapSvg` doesn't accept a `groupId` parameter or emit `<g>`/`data-idx`/`data-x`/`data-y`/`id="route-line-..."` yet, and still draws one polyline per set.

- [ ] **Step 3: Rewrite `buildRouteMapSvg`**

Find the current function (starts around line 281):

```js
  function buildRouteMapSvg(rowSets, enderecos, width, height) {
    const PADDING = 28;
    const plottableSets = rowSets.map((set) => {
      const plottable = [];
      const missing = [];
      set.rows.forEach((r) => {
        const info = slotInfo(r, enderecos);
        if (info && info.lat != null) {
          plottable.push({ lat: info.lat, lon: info.lon, hora: r.horaInicio });
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
        const hora = set.plottable[i].hora;
        const seq = i + 1;
        svgParts.push(
          `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="9" fill="${set.color}" stroke="#fff" stroke-width="1.5"/>` +
          `<text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" text-anchor="middle" dominant-baseline="central" ` +
            `font-size="9" font-weight="700" fill="#fff">${seq}</text>` +
          `<text x="${p.x.toFixed(1)}" y="${(p.y + 20).toFixed(1)}" text-anchor="middle" ` +
            `font-size="9" fill="#333">${escapeHtml(hora)}</text>`
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
```

Replace with:

```js
  function buildRouteMapSvg(rowSets, enderecos, width, height, groupId) {
    const PADDING = 28;
    const idxMap = routeIdxMap(rowSets, enderecos);
    const plottableSets = rowSets.map((set) => {
      const plottable = [];
      const missing = [];
      set.rows.forEach((r) => {
        const info = slotInfo(r, enderecos);
        if (info && info.lat != null) {
          plottable.push({ lat: info.lat, lon: info.lon, hora: r.horaInicio, idx: idxMap.get(enderecoKey(r)) });
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
    // Combined-across-sets ordered point list, used to draw ONE polyline
    // spanning every plottable stop (in flattened order) regardless of how
    // many rowSets were passed in. A single-set caller (team panel) still
    // gets one line in that set's own color; a multi-set caller (Resumo)
    // gets one neutral-colored line instead of one per team — the route
    // link built by the inline script is already a single combined link,
    // so the static line matches it from the start.
    const allProjectedInOrder = [];
    plottableSets.forEach((set) => {
      const pts = projected.slice(cursor, cursor + set.plottable.length);
      cursor += set.plottable.length;
      if (pts.length === 0) return;

      pts.forEach((p, i) => {
        allProjectedInOrder.push(p);
        const hora = set.plottable[i].hora;
        const idx = set.plottable[i].idx;
        const seq = i + 1;
        svgParts.push(
          `<g data-idx="${idx}" data-x="${p.x.toFixed(1)}" data-y="${p.y.toFixed(1)}">` +
          `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="9" fill="${set.color}" stroke="#fff" stroke-width="1.5"/>` +
          `<text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" text-anchor="middle" dominant-baseline="central" ` +
            `font-size="9" font-weight="700" fill="#fff">${seq}</text>` +
          `<text x="${p.x.toFixed(1)}" y="${(p.y + 20).toFixed(1)}" text-anchor="middle" ` +
            `font-size="9" fill="#333">${escapeHtml(hora)}</text>` +
          '</g>'
        );
      });
    });

    if (allProjectedInOrder.length >= 2) {
      const line = allProjectedInOrder.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
      const lineColor = plottableSets.length > 1 ? '#333' : plottableSets[0].color;
      // Prepended so dots/labels draw on top of the line, unchanged from
      // the original per-set drawing order.
      svgParts.unshift(
        `<polyline id="route-line-${escapeHtml(groupId)}" points="${line}" fill="none" ` +
          `stroke="${lineColor}" stroke-width="1.5" opacity="0.7"/>`
      );
    }

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
```

Note the behavior change captured by this rewrite: previously a single-set call with exactly 1 plottable point drew no polyline (`pts.length >= 2` gated per-set); now the same single-set, single-point case still draws no polyline (`allProjectedInOrder.length >= 2` is the same threshold, just computed across the flattened list) — for a single set this is identical to the old per-set check, so single-set (team panel) behavior is unchanged except for the added `<g>` wrapper and `id` attribute. The only actual behavior change is for multi-set (Resumo) calls, which is the intended change per this task.

- [ ] **Step 4: Update both call sites to pass `groupId`**

In `buildTeamPanel` (around line 498), find:

```js
    const teamMap = enderecos
      ? buildRouteMapSvg(
          [{ rows: group.rows.filter((r) => r.reservado), color: teamColor(colorIndex) }],
          enderecos, 480, 320
        )
      : '';
```

Replace with:

```js
    const teamMap = enderecos
      ? buildRouteMapSvg(
          [{ rows: group.rows.filter((r) => r.reservado), color: teamColor(colorIndex) }],
          enderecos, 480, 320, routeGroupId
        )
      : '';
```

In `buildSummaryPanel` (around line 556), find:

```js
          buildRouteMapSvg(
            groups.map((g, i) => ({ rows: g.rows.filter((r) => r.reservado), color: teamColor(i) })),
            enderecos, 640, 420
          ),
```

Replace with:

```js
          buildRouteMapSvg(
            groups.map((g, i) => ({ rows: g.rows.filter((r) => r.reservado), color: teamColor(i) })),
            enderecos, 640, 420, 'resumo'
          ),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/agenda-day-guide-route-selector.test.js -t "buildRouteMapSvg data-idx"`
Expected: all 6 tests PASS.

- [ ] **Step 6: Run the full existing test file**

Run: `bun test tests/agenda-day-guide-route-selector.test.js`
Expected: all tests PASS, including every pre-existing test from before this task (team panel/Resumo map rendering, legend, missing-coordinates note — none of that behavior changed for the single-set case, and Resumo's multi-polyline-to-single-polyline change is exactly what this task's new tests pin).

- [ ] **Step 7: Syntax check**

Run: `bun build --no-bundle extension/features/agenda-day-guide/agenda-day-guide.js --outfile=/tmp/day-guide-check.js`
Expected: no output, exit code 0.

- [ ] **Step 8: Commit**

```bash
git add extension/features/agenda-day-guide/agenda-day-guide.js tests/agenda-day-guide-route-selector.test.js
git commit -m "feat: wrap map dots in data-idx groups, single combined Resumo line"
```

---

### Task 3: Inline `<script>` redraw logic + CSS

**Files:**
- Modify: `extension/features/agenda-day-guide/agenda-day-guide.js` (`buildGuideHtml`'s inline `<script>` template, `<style>` block)
- Test: `tests/agenda-day-guide-route-selector.test.js` (extend — mirrored-logic pattern, same as the original feature's cap-enforcement/URL-building tests, since happy-dom does not reliably execute inline `<script>` tags)

**Interfaces:**
- Consumes: DOM structure from Tasks 1-2 (`input.route-chk[data-group][data-idx]`, `g[data-idx][data-x][data-y]`, `polyline#route-line-<groupId>`).
- Produces: `refreshGroup(groupId)`'s existing behavior (link update, cap enforcement) is unchanged; it gains a redraw step for the group's map, run before its existing `if (checked.length < 2) { ...; return; }` branch. No new exported JS function — same as the original feature's script, this is a literal string template within `buildGuideHtml`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/agenda-day-guide-route-selector.test.js`, inside the existing `describe('inline script is present and shaped correctly', ...)` block (find its closing `});` and insert before it):

```js
  test('buildGuideHtml output contains data-idx groups and a route-line id, matching checkboxes', () => {
    const { buildGuideHtml } = window.__sigcPro.dayGuide;
    const groups = [{ equipe: 'Equipe A', rows: [row({ controle: 'C1', domicilio: 'D1' })] }];
    const enderecos = enderecosMap([['C1', 'D1', -12.9, -38.5]]);
    const meta = { uf: 'BA', dataBr: '22/07/2026', diaSemana: 'quarta-feira', geradoEm: '22/07/2026 10:00' };
    const html = buildGuideHtml(meta, groups, groups[0].rows, enderecos);
    expect(html).toMatch(/<g data-idx="\d+" data-x="[\d.]+" data-y="[\d.]+">/);
    expect(html).toContain('route-chk');
    expect(html).toMatch(/data-idx="\d+"/);
  });

  test('map redraw logic (mirrored): dims unchecked stops, rebuilds line from checked ones in idx order', () => {
    // Mirrors refreshGroup's new map-redraw step exactly (Task 3 Step 3
    // below). happy-dom doesn't reliably execute inline <script> tags
    // inserted via innerHTML, so this pins the same logic standalone,
    // same pattern as the cap-enforcement/URL-building mirror tests
    // already in this file.
    function redrawMap(groupId, checkedIdxSet, allStopGs) {
      var checkedStops = [];
      allStopGs.forEach(function (g) {
        var idx = g.dataset.idx;
        if (checkedIdxSet.has(idx)) {
          g.dimmed = false;
          checkedStops.push(g);
        } else {
          g.dimmed = true;
        }
      });
      checkedStops.sort(function (a, b) { return Number(a.dataset.idx) - Number(b.dataset.idx); });
      if (checkedStops.length < 2) return { points: null };
      var points = checkedStops.map(function (g) {
        return g.dataset.x + ',' + g.dataset.y;
      }).join(' ');
      return { points: points };
    }

    var gs = [
      { dataset: { idx: '0', x: '10.0', y: '20.0' } },
      { dataset: { idx: '1', x: '30.0', y: '40.0' } },
      { dataset: { idx: '2', x: '50.0', y: '60.0' } },
    ];

    // Only idx 0 and 2 checked -> idx 1 stays dimmed, line skips it.
    var result = redrawMap('team-0', new Set(['0', '2']), gs);
    expect(gs[0].dimmed).toBe(false);
    expect(gs[1].dimmed).toBe(true);
    expect(gs[2].dimmed).toBe(false);
    expect(result.points).toBe('10.0,20.0 50.0,60.0');

    // Below 2 checked -> no line.
    var result2 = redrawMap('team-0', new Set(['0']), gs);
    expect(result2.points).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/agenda-day-guide-route-selector.test.js -t "data-idx groups and a route-line id"`
Expected: FAIL — `buildGuideHtml`'s output doesn't yet contain `<g data-idx>` wrappers threaded all the way from Tasks 1-2's changes into a full `generate`/`buildGuideHtml` call. (The mirrored-logic test passes trivially since it doesn't touch the real script yet — that's fine, it's pinning the shape ahead of Step 3.)

Note: if this test fails only because `<g data-idx...>` isn't present, but Tasks 1-2 are already complete and committed, re-verify Task 2's Step 4 wiring — `buildGuideHtml` calls `buildTeamPanel`/`buildSummaryPanel` internally, so Task 2's `groupId` threading should already make this pass without further changes here. If it fails for that reason, this step is confirming Tasks 1-2 composed correctly, not introducing new production code.

- [ ] **Step 3: Add the redraw step to `refreshGroup`**

Find the inline `<script>` block's `refreshGroup` function (inside `buildGuideHtml`, around the script template):

```js
  function refreshGroup(groupId) {
    var boxes = document.querySelectorAll('.route-chk[data-group="' + groupId + '"]');
    var checked = [];
    boxes.forEach(function (b) { if (b.checked) checked.push(b); });
    // Cap enforcement: at MAX_STOPS checked, disable the rest; below it, re-enable.
    boxes.forEach(function (b) {
      if (!b.checked) b.disabled = checked.length >= MAX_STOPS;
    });
    var link = document.getElementById('rota-link-' + groupId);
    if (!link) return;
    if (checked.length < 2) {
      link.innerHTML = '';
      return;
    }
    var stops = checked.map(function (b) {
      return { lat: parseFloat(b.dataset.lat), lon: parseFloat(b.dataset.lon) };
    });
    var url = buildGmapsUrl(stops);
    link.innerHTML = '<a href="' + url.replace(/"/g, '&quot;') + '">Google Maps</a>';
  }
```

Replace with:

```js
  function refreshGroup(groupId) {
    var boxes = document.querySelectorAll('.route-chk[data-group="' + groupId + '"]');
    var checked = [];
    boxes.forEach(function (b) { if (b.checked) checked.push(b); });
    // Cap enforcement: at MAX_STOPS checked, disable the rest; below it, re-enable.
    boxes.forEach(function (b) {
      if (!b.checked) b.disabled = checked.length >= MAX_STOPS;
    });

    // Map redraw: dim unchecked stops, rebuild the line from checked ones
    // in data-idx order (already time order). Runs regardless of the
    // link's own visibility rule below — the map has no "hidden below 2"
    // state of its own for dots, only for the line.
    var checkedIdx = new Set(checked.map(function (b) { return b.dataset.idx; }));
    var stopGs = document.querySelectorAll('.route-map g[data-idx]');
    var checkedGs = [];
    stopGs.forEach(function (g) {
      if (checkedIdx.has(g.dataset.idx)) {
        g.classList.remove('route-stop-dim');
        checkedGs.push(g);
      } else {
        g.classList.add('route-stop-dim');
      }
    });
    var line = document.getElementById('route-line-' + groupId);
    if (line) {
      if (checkedGs.length >= 2) {
        checkedGs.sort(function (a, b) { return Number(a.dataset.idx) - Number(b.dataset.idx); });
        var points = checkedGs.map(function (g) {
          return g.dataset.x + ',' + g.dataset.y;
        }).join(' ');
        line.setAttribute('points', points);
        line.style.display = '';
      } else {
        line.style.display = 'none';
      }
    }

    var link = document.getElementById('rota-link-' + groupId);
    if (!link) return;
    if (checked.length < 2) {
      link.innerHTML = '';
      return;
    }
    var stops = checked.map(function (b) {
      return { lat: parseFloat(b.dataset.lat), lon: parseFloat(b.dataset.lon) };
    });
    var url = buildGmapsUrl(stops);
    link.innerHTML = '<a href="' + url.replace(/"/g, '&quot;') + '">Google Maps</a>';
  }
```

Note `document.querySelectorAll('.route-map g[data-idx]')` is scoped by `.route-map` only, not by `groupId` — a document can have multiple `.route-map` blocks (one per team tab, plus Resumo's), but each `<g data-idx>`'s `data-idx` values are only unique WITHIN one map (Task 1/2's counters are per-`buildRouteMapSvg`-call, i.e. per group), so a team's map and Resumo's map can both have a `<g data-idx="0">` without collision as long as this query only ever needs to match `groupId`'s own map. Since `refreshGroup(groupId)` is called once per checkbox's own group, and each panel/tab's map is inside that same panel's `<section>` — but the query above is NOT scoped to the group's panel section, so it will incorrectly match every `.route-map g[data-idx]` in the whole document. Fix: scope the query using the polyline's sibling relationship instead — locate the group's own map by finding it relative to `line` (found via `getElementById('route-line-' + groupId)`, which IS uniquely scoped since the polyline's `id` is globally unique per groupId), then query `g[data-idx]` within that same `<svg>`.

Revise the redraw block above: replace

```js
    var checkedIdx = new Set(checked.map(function (b) { return b.dataset.idx; }));
    var stopGs = document.querySelectorAll('.route-map g[data-idx]');
    var checkedGs = [];
    stopGs.forEach(function (g) {
      if (checkedIdx.has(g.dataset.idx)) {
        g.classList.remove('route-stop-dim');
        checkedGs.push(g);
      } else {
        g.classList.add('route-stop-dim');
      }
    });
    var line = document.getElementById('route-line-' + groupId);
    if (line) {
      if (checkedGs.length >= 2) {
```

with:

```js
    var line = document.getElementById('route-line-' + groupId);
    var svg = line ? line.closest('svg') : null;
    if (svg) {
      var checkedIdx = new Set(checked.map(function (b) { return b.dataset.idx; }));
      var stopGs = svg.querySelectorAll('g[data-idx]');
      var checkedGs = [];
      stopGs.forEach(function (g) {
        if (checkedIdx.has(g.dataset.idx)) {
          g.classList.remove('route-stop-dim');
          checkedGs.push(g);
        } else {
          g.classList.add('route-stop-dim');
        }
      });
      if (checkedGs.length >= 2) {
```

and adjust the closing braces accordingly so the full corrected `refreshGroup` reads:

```js
  function refreshGroup(groupId) {
    var boxes = document.querySelectorAll('.route-chk[data-group="' + groupId + '"]');
    var checked = [];
    boxes.forEach(function (b) { if (b.checked) checked.push(b); });
    // Cap enforcement: at MAX_STOPS checked, disable the rest; below it, re-enable.
    boxes.forEach(function (b) {
      if (!b.checked) b.disabled = checked.length >= MAX_STOPS;
    });

    // Map redraw: dim unchecked stops, rebuild the line from checked ones
    // in data-idx order (already time order). Runs regardless of the
    // link's own visibility rule below — the map has no "hidden below 2"
    // state of its own for dots, only for the line. Scoped to this
    // group's own <svg> (found via its uniquely-id'd polyline) since
    // data-idx values are only unique within one map, not document-wide.
    var line = document.getElementById('route-line-' + groupId);
    var svg = line ? line.closest('svg') : null;
    if (svg) {
      var checkedIdx = new Set(checked.map(function (b) { return b.dataset.idx; }));
      var stopGs = svg.querySelectorAll('g[data-idx]');
      var checkedGs = [];
      stopGs.forEach(function (g) {
        if (checkedIdx.has(g.dataset.idx)) {
          g.classList.remove('route-stop-dim');
          checkedGs.push(g);
        } else {
          g.classList.add('route-stop-dim');
        }
      });
      if (checkedGs.length >= 2) {
        checkedGs.sort(function (a, b) { return Number(a.dataset.idx) - Number(b.dataset.idx); });
        var points = checkedGs.map(function (g) {
          return g.dataset.x + ',' + g.dataset.y;
        }).join(' ');
        line.setAttribute('points', points);
        line.style.display = '';
      } else {
        line.style.display = 'none';
      }
    }

    var link = document.getElementById('rota-link-' + groupId);
    if (!link) return;
    if (checked.length < 2) {
      link.innerHTML = '';
      return;
    }
    var stops = checked.map(function (b) {
      return { lat: parseFloat(b.dataset.lat), lon: parseFloat(b.dataset.lon) };
    });
    var url = buildGmapsUrl(stops);
    link.innerHTML = '<a href="' + url.replace(/"/g, '&quot;') + '">Google Maps</a>';
  }
```

Use this final version (with the `svg`-scoped query) as the actual code to write into the file — the intermediate unscoped version above is shown only to explain why the fix is needed, not to be committed.

A team panel with 0 plottable stops (`teamMap` is `''`, no `<svg>` rendered) or a team's map skipped because `enderecos` is `null` (`teamMap` is `''`) means `document.getElementById('route-line-' + groupId)` returns `null` for that group — `svg` stays `null`, the whole map-redraw block is skipped, and the function proceeds to the link logic exactly as before. No error, no crash.

- [ ] **Step 4: Add the CSS rule**

In `buildGuideHtml`'s `<style>` block, find:

```css
.route-map-swatch { display: inline-block; width: .7rem; height: .7rem; border-radius: 2px; }
```

Replace with:

```css
.route-map-swatch { display: inline-block; width: .7rem; height: .7rem; border-radius: 2px; }
.route-stop-dim { opacity: .35; }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/agenda-day-guide-route-selector.test.js`
Expected: all tests PASS, including both tests added in Step 1.

- [ ] **Step 6: Syntax check**

Run: `bun build --no-bundle extension/features/agenda-day-guide/agenda-day-guide.js --outfile=/tmp/day-guide-check.js`
Expected: no output, exit code 0.

- [ ] **Step 7: Run the full project test suite**

Run: `bun test`
Expected: all tests across all files PASS, no regressions in `button-factories.test.js`, `mount-widget.test.js`, `sigc-common-helpers.test.js`, `smoke.test.js`.

- [ ] **Step 8: Privacy gate**

Run: `./scripts/check-privacy.sh`
Expected: clean (no new network APIs — the script only touches the DOM and SVG attributes).

- [ ] **Step 9: Commit**

```bash
git add extension/features/agenda-day-guide/agenda-day-guide.js tests/agenda-day-guide-route-selector.test.js
git commit -m "feat: redraw SVG route map on checkbox toggle"
```

---

## Post-plan cleanup

- Update `docs/superpowers/specs/2026-07-22-agenda-day-guide-dynamic-route-design.md`'s "Not in scope" section (which currently says the SVG map "stays static... Only the Google Maps `<a>` link is dynamic") to note this is now superseded by
  `docs/superpowers/specs/2026-07-23-agenda-day-guide-checkbox-reactive-map-design.md`, mirroring how the checkbox-on-card plan's cleanup cross-referenced its own supersession.
- Update `docs/superpowers/specs/2026-07-18-agenda-day-route-map-design.md` similarly if it describes the map as static, for the same reason.
- Manual field test on live Dia view before considering this plan fully closed (per the design spec's "Testing" section): check/uncheck stops on a team tab and confirm its map's dots dim/undim and the line reroutes; same on Resumo, confirming a single grey line spans checked stops across teams while dots keep their team colors; Ctrl+P a tab with some stops unchecked and confirm the printed map reflects the same dimmed/undimmed state visible on screen; reopen the downloaded `.html` via `file://` and confirm toggling still redraws the map there.
