# Guia do Dia Dynamic Route Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Guia do Dia's pre-baked, auto-chunked "Rota:" links with a checkbox-per-stop selector (one per team panel, one combined on Resumo) whose Google Maps link updates live as the user checks/unchecks stops, capped at 9 stops per route.

**Architecture:** All changes live in the existing `extension/features/agenda-day-guide/agenda-day-guide.js`. Three layers: (1) a pure HTML-fragment builder `buildRouteSelector(stops, groupId)` that renders the checkboxes + placeholder link markup, consuming a normalized stop list; (2) call-site changes in `buildTeamPanel` (replacing the old auto-`rota` block) and `buildSummaryPanel` (new "Rota do dia" section, combining every team's stops in existing row order); (3) one inline `<script>` block appended into `buildGuideHtml`'s output, containing a small standalone copy of the Google Maps URL-building logic and a `change`-event handler that recomputes each group's link and enforces the 9-cap. `chunkRoute` is deleted — no more multi-leg splitting. New pure builders are exposed on `window.__sigcPro.dayGuide` for testing, following the file's existing minimal test-surface pattern.

**Tech Stack:** Vanilla ES2020, Chrome MV3 MAIN-world content script, no bundler. `bun:test` + `happy-dom` for pure-function tests (`tests/*.test.js`, matching `tests/sigc-common-helpers.test.js`); `bun build --no-bundle <file> --outfile=/dev/null` for syntax checks (node is absent from PATH). Spec: `docs/superpowers/specs/2026-07-22-agenda-day-guide-dynamic-route-design.md`. Original guide spec (amended by this feature): `docs/superpowers/specs/2026-07-16-agenda-day-guide-design.md`.

## Global Constraints

- The guide gains exactly one inline `<script>` block (no external refs, no network) — this reverses the original "No JS" constraint for this one file only; the block must not break `file://` opening or `Ctrl+P` printing (spec, Amendment).
- Every route selector (each team panel, and Resumo's combined one) is capped at 9 checked stops; `chunkRoute` and all multi-leg link rendering are removed entirely (spec, Stop cap).
- Team panel default state: reserved+geocoded stop count ≤ 9 → all checked; > 9 → none checked. Resumo's combined selector always starts with nothing checked, regardless of count (spec, Default checkbox state).
- Cap enforcement is live and per-group: at 9 checked, remaining unchecked boxes in that group become `disabled`; dropping below 9 re-enables them. No alerts (spec, Cap enforcement).
- Route link per group: hidden/blank at 0–1 checked stops; one `<a>` built from checked stops in their original time order at 2–9 (spec, Live route link).
- Coordinate-less reserved visits get a disabled, unchecked, permanently-excluded checkbox row labeled with time/name plus "sem coordenadas" — never silently omitted from the selector (spec, Stop eligibility).
- Each checkbox `<input>` carries `data-lat`, `data-lon`, `data-name` — the inline script's only data source, no separate array literal (spec, Coordinate data reaching the script).
- Resumo's combined selector lists stops in existing row order (`groupByEquipe`'s name-sorted teams, each team's own rows already time-sorted) — no new cross-team sort (spec, Cross-team order).
- Checkbox list + link render as one standalone block where the old `rota` div was (team panels) / before "Mapa do dia" (Resumo) — never interleaved into slot cards (spec, Layout placement).
- `gmapsRouteUrl` (build-time, used by each visit's static "abrir no mapa" pin) stays exactly as-is; the live link uses an intentionally separate, standalone URL-building copy inside the inline script (spec, gmapsRouteUrl duplication).
- Resumo's selection state and every team's selection state are fully independent — no cross-group syncing, ever (spec, Scope).
- Lab tab is untouched: no route selector, no script hooks added to it.
- `./scripts/check-privacy.sh` must stay clean after every task (no new network APIs — this is pure string/DOM building).
- Existing exact behavior/functions must not change except where this plan explicitly modifies them: `groupByEquipe`, `computeStats`, `zonasUnion`, `slotInfo`, `zonaLabel`, `fmtCoord`, `gmapsRouteUrl`, `buildSlotCard`, `buildDayGrid`, `buildRouteMapSvg`, `buildLegend`, `stopSequenceMap`, `teamColor`, `TABLE_CSS`, `guideMeta`, `fileName`, `generate`, `window.__sigcPro.dayGuide`'s existing `{ generate, diaViewActive }` keys (new keys may be added, none removed).

---

### Task 1: Delete `chunkRoute` and its call site

**Files:**
- Modify: `extension/features/agenda-day-guide/agenda-day-guide.js:101-116` (delete `chunkRoute`), `extension/features/agenda-day-guide/agenda-day-guide.js:437-454` (remove old `rota` block from `buildTeamPanel`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `buildTeamPanel` no longer emits a `rota` variable or a `.rota` div; the `stops` computation stays (Task 3 reuses `stops`'s shape, extended for non-routable rows).

- [ ] **Step 1: Remove `chunkRoute`**

Delete lines 101-116 of `extension/features/agenda-day-guide/agenda-day-guide.js`:

```js
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

```

Leave `gmapsRouteUrl` (the function right after it) untouched.

- [ ] **Step 2: Remove the old auto-`rota` block from `buildTeamPanel`**

In `buildTeamPanel`, replace:

```js
    // Route links only when >= 2 reserved visits have coordinates.
    // Tapping the Google Maps link sends that leg's coordinates to
    // Google — a deliberate user action, never automatic.
    const stops = group.rows
      .filter((r) => r.reservado)
      .map((r) => {
        const p = slotInfo(r, enderecos);
        return p && p.lat != null
          ? { lat: p.lat, lon: p.lon, name: `${r.horaInicio} ${r.nome || r.controle}` } : null;
      })
      .filter(Boolean);
    let rota = '';
    if (stops.length >= 2) {
      const legs = chunkRoute(stops, 10);
      const links = legs.map((leg, i) =>
        `<a href="${e(gmapsRouteUrl(leg))}">Google Maps${legs.length > 1 ? ` ${i + 1}` : ''}</a>`);
      rota = `<div class="rota">Rota: ${links.join(' &nbsp;·&nbsp; ')}</div>`;
    }
```

with:

```js
    // Task 3 replaces this with buildRouteSelector's stop list + markup.
```

(This is a temporary marker — Task 3 fills it in. Leaving `buildTeamPanel` briefly non-compiling here is expected; Step 3 below fixes the dangling `rota` reference so the file still parses at the end of this task.)

Then find the return statement further down:

```js
    return [
      `<h2>${e(group.equipe)}</h2>`,
      `<div class="teamstats">${statBits}</div>`,
      zonas.length ? `<div class="zonas">Zonas: ${zonas.map(e).join(', ')}</div>` : '',
      rota,
      ...cards,
      teamMap,
    ].filter(Boolean).join('\n');
```

and change `rota,` to `''` (blank placeholder, so the array stays valid until Task 3):

```js
    return [
      `<h2>${e(group.equipe)}</h2>`,
      `<div class="teamstats">${statBits}</div>`,
      zonas.length ? `<div class="zonas">Zonas: ${zonas.map(e).join(', ')}</div>` : '',
      '',
      ...cards,
      teamMap,
    ].filter(Boolean).join('\n');
```

- [ ] **Step 3: Syntax check**

Run: `bun build --no-bundle extension/features/agenda-day-guide/agenda-day-guide.js --outfile=/tmp/day-guide-check.js`
Expected: no output, exit code 0 (file still parses — `chunkRoute` is gone, its only call site is gone, nothing else references it).

- [ ] **Step 4: Commit**

```bash
git add extension/features/agenda-day-guide/agenda-day-guide.js
git commit -m "refactor: remove chunkRoute ahead of dynamic route selector"
```

---

### Task 2: `buildRouteSelector` — pure HTML fragment builder

**Files:**
- Modify: `extension/features/agenda-day-guide/agenda-day-guide.js` (add function near `gmapsRouteUrl`, after Task 1's edits)
- Test: `tests/agenda-day-guide-route-selector.test.js` (new)

**Interfaces:**
- Consumes: `slotInfo`, `enderecoKey`, `escapeHtml` (all already in the file).
- Produces (Task 3 relies on this exact signature):
  `buildRouteSelector(rows, enderecos, groupId)` where `rows` is the group's full row array (team's `group.rows`, or Resumo's flattened all-teams row array — both already in the right display order per spec), `enderecos` is the same map/null every other builder in this file receives, and `groupId` is a string used to namespace element `id`s/`name`s (e.g. `"team-0"`, `"resumo"`) so multiple selectors can coexist in one document without ID collisions. Returns an HTML string: one `<label>` per **reserved** row (routable rows get an enabled checkbox; non-routable reserved rows get a disabled, unchecked checkbox with a "sem coordenadas" note) followed by a `<div class="rota-link" id="rota-link-<groupId>"></div>` placeholder for the live link. Open (non-reserved) rows are skipped entirely — this selector only ever lists reserved visits.
  Checkbox `checked` default: computed inside `buildRouteSelector` itself from a `defaultAllChecked` boolean parameter — `buildRouteSelector(rows, enderecos, groupId, defaultAllChecked)`. When `defaultAllChecked` is `true`, every *routable* reserved row starts checked (routable count must independently be ≤ 9 for this to be called with `true` — the caller decides, per Task 3/4). When `false`, every routable row starts unchecked. Non-routable rows are always unchecked+disabled regardless of this flag.
  Each enabled/checkable `<input>` carries: `class="route-chk"`, `data-group="<groupId>"`, `data-lat`, `data-lon` (both `toFixed(6)`), `data-name` (escaped `hora + nome-or-controle`, same label shape as the old `stops.map` in Task 1's deleted block).

- [ ] **Step 1: Write the failing test**

Create `tests/agenda-day-guide-route-selector.test.js`:

```js
import { describe, test, expect } from 'bun:test';

await import('../extension/common/sigc-common.js');
await import('../extension/features/agenda-day-guide/agenda-day-guide.js');
const { buildRouteSelector } = window.__sigcPro.dayGuide;

function row({ reservado = true, horaInicio = '09:00', nome = 'Fulano', controle = 'C1', domicilio = 'D1' } = {}) {
  return { reservado, horaInicio, horaFim: '09:30', nome, controle, domicilio, equipe: 'A' };
}

function enderecosMap(entries) {
  // entries: [[controle, domicilio, lat, lon], ...]
  const m = new Map();
  entries.forEach(([controle, domicilio, lat, lon]) => {
    m.set(`${controle}|${domicilio}`, { lat, lon, zona: null, idZona: null });
  });
  return m;
}

describe('buildRouteSelector', () => {
  test('routable reserved rows get an enabled checkbox with data-lat/lon/name', () => {
    const rows = [row()];
    const enderecos = enderecosMap([['C1', 'D1', -12.9, -38.5]]);
    const html = buildRouteSelector(rows, enderecos, 'team-0', true);
    expect(html).toContain('class="route-chk"');
    expect(html).toContain('data-group="team-0"');
    expect(html).toContain('data-lat="-12.900000"');
    expect(html).toContain('data-lon="-38.500000"');
    expect(html).toContain('checked');
    expect(html).not.toContain('disabled');
  });

  test('non-routable reserved row: disabled, unchecked, "sem coordenadas" note', () => {
    const rows = [row()];
    const html = buildRouteSelector(rows, null, 'team-0', true);
    expect(html).toContain('disabled');
    expect(html).not.toMatch(/route-chk[^>]*checked/);
    expect(html).toContain('sem coordenadas');
  });

  test('open (non-reserved) rows are skipped entirely', () => {
    const rows = [row({ reservado: false })];
    const html = buildRouteSelector(rows, null, 'team-0', true);
    expect(html).not.toContain('route-chk');
  });

  test('defaultAllChecked=false starts routable rows unchecked', () => {
    const rows = [row()];
    const enderecos = enderecosMap([['C1', 'D1', -12.9, -38.5]]);
    const html = buildRouteSelector(rows, enderecos, 'team-0', false);
    expect(html).not.toMatch(/route-chk[^>]*checked/);
  });

  test('always includes a rota-link placeholder namespaced by groupId', () => {
    const html = buildRouteSelector([row()], null, 'resumo', false);
    expect(html).toContain('id="rota-link-resumo"');
  });

  test('escapes stop names', () => {
    const rows = [row({ nome: '<script>alert(1)</script>' })];
    const enderecos = enderecosMap([['C1', 'D1', -12.9, -38.5]]);
    const html = buildRouteSelector(rows, enderecos, 'team-0', true);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/agenda-day-guide-route-selector.test.js`
Expected: FAIL — `buildRouteSelector` is undefined (`window.__sigcPro.dayGuide.buildRouteSelector` doesn't exist yet).

- [ ] **Step 3: Implement `buildRouteSelector`**

Add this function in `extension/features/agenda-day-guide/agenda-day-guide.js`, right after `gmapsRouteUrl` (which Task 1 left untouched):

```js
  // One checkbox per RESERVED row in `rows` (open rows are skipped). Routable
  // rows (slotInfo has lat/lon) get an enabled checkbox seeded from
  // defaultAllChecked; non-routable reserved rows get a permanently disabled,
  // unchecked row with a "sem coordenadas" note — present so the selector's
  // row count never silently drops a visit the panel's cards still show.
  // groupId namespaces data-group (read by the inline script) and the
  // trailing rota-link placeholder's id, so multiple independent selectors
  // (Resumo + each team) can coexist without id/state collisions.
  function buildRouteSelector(rows, enderecos, groupId, defaultAllChecked) {
    const e = escapeHtml;
    const items = rows.filter((r) => r.reservado).map((r) => {
      const info = slotInfo(r, enderecos);
      const label = `${r.horaInicio} ${r.nome || r.controle}`;
      if (info && info.lat != null) {
        const checkedAttr = defaultAllChecked ? ' checked' : '';
        return '<label class="route-item">' +
          `<input type="checkbox" class="route-chk" data-group="${e(groupId)}" ` +
          `data-lat="${info.lat.toFixed(6)}" data-lon="${info.lon.toFixed(6)}" ` +
          `data-name="${e(label)}"${checkedAttr}> ${e(label)}` +
          '</label>';
      }
      return '<label class="route-item route-item-missing">' +
        `<input type="checkbox" disabled> ${e(label)} — sem coordenadas` +
        '</label>';
    });
    if (items.length === 0) return '';
    return '<div class="route-selector">' +
      items.join('\n') +
      `<div class="rota-link" id="rota-link-${e(groupId)}"></div>` +
      '</div>';
  }
```

- [ ] **Step 4: Expose `buildRouteSelector` for tests**

Find the existing export line near the bottom of the file:

```js
  window.__sigcPro.dayGuide = { generate, diaViewActive };
```

Replace with:

```js
  window.__sigcPro.dayGuide = { generate, diaViewActive, buildRouteSelector };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/agenda-day-guide-route-selector.test.js`
Expected: all 6 tests PASS.

- [ ] **Step 6: Syntax check the whole file**

Run: `bun build --no-bundle extension/features/agenda-day-guide/agenda-day-guide.js --outfile=/tmp/day-guide-check.js`
Expected: no output, exit code 0.

- [ ] **Step 7: Commit**

```bash
git add extension/features/agenda-day-guide/agenda-day-guide.js tests/agenda-day-guide-route-selector.test.js
git commit -m "feat: add buildRouteSelector for per-stop route checkboxes"
```

---

### Task 3: Wire `buildRouteSelector` into `buildTeamPanel`

**Files:**
- Modify: `extension/features/agenda-day-guide/agenda-day-guide.js` (`buildTeamPanel`)
- Test: `tests/agenda-day-guide-route-selector.test.js` (extend)

**Interfaces:**
- Consumes: `buildRouteSelector(rows, enderecos, groupId, defaultAllChecked)` from Task 2.
- Produces: `buildTeamPanel(group, enderecos, colorIndex)`'s output now contains a `route-selector` block (via `buildRouteSelector`) in place of the placeholder `''` Task 1 left, positioned exactly where the old `rota` div was (before the cards). `groupId` for a team panel is `"team-<colorIndex>"`.

- [ ] **Step 1: Write the failing test**

Append to `tests/agenda-day-guide-route-selector.test.js`:

```js
describe('buildTeamPanel route selector wiring', () => {
  test('<=9 routable stops: all checked by default, groupId is team-<colorIndex>', () => {
    const { buildTeamPanel } = window.__sigcPro.dayGuide;
    const rows = [row({ horaInicio: '09:00' }), row({ horaInicio: '10:00', controle: 'C2', domicilio: 'D2' })];
    const enderecos = enderecosMap([
      ['C1', 'D1', -12.9, -38.5],
      ['C2', 'D2', -12.8, -38.4],
    ]);
    const html = buildTeamPanel({ equipe: 'Equipe A', rows }, enderecos, 0);
    expect(html).toContain('data-group="team-0"');
    expect((html.match(/checked/g) || []).length).toBe(2);
    expect(html).not.toContain('class="rota"'); // old block gone
    // Selector block sits where the old rota div was: before the cards,
    // i.e. before the first slot card's endereco div.
    expect(html.indexOf('route-selector')).toBeLessThan(html.indexOf('class="card"'));
  });

  test('>9 routable stops: none checked by default', () => {
    const { buildTeamPanel } = window.__sigcPro.dayGuide;
    const entries = [];
    const rows = [];
    for (let i = 0; i < 10; i++) {
      const controle = `C${i}`;
      rows.push(row({ horaInicio: `0${i}:00`.slice(-5), controle, domicilio: 'D1' }));
      entries.push([controle, 'D1', -12.9 + i * 0.01, -38.5]);
    }
    const enderecos = enderecosMap(entries);
    const html = buildTeamPanel({ equipe: 'Equipe A', rows }, enderecos, 0);
    expect(html).not.toContain('checked');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/agenda-day-guide-route-selector.test.js`
Expected: FAIL — `buildTeamPanel` not yet exported, and the wiring isn't in place.

- [ ] **Step 3: Wire the selector into `buildTeamPanel`**

Locate the marker Task 1 left:

```js
    // Task 3 replaces this with buildRouteSelector's stop list + markup.
```

Replace it with:

```js
    // Routable count decides the default: <=9 -> all checked (matches
    // yesterday's auto-route), >9 -> none checked (chunking is gone, the
    // user must pick their own <=9 stops). Non-routable rows never count
    // toward this and are always rendered disabled by buildRouteSelector.
    const routableCount = group.rows.filter((r) => {
      if (!r.reservado) return false;
      const info = slotInfo(r, enderecos);
      return info && info.lat != null;
    }).length;
    const routeSelector = buildRouteSelector(
      group.rows, enderecos, `team-${colorIndex}`, routableCount <= 9
    );
```

Then update the return statement — replace the `''` placeholder with `routeSelector`:

```js
    return [
      `<h2>${e(group.equipe)}</h2>`,
      `<div class="teamstats">${statBits}</div>`,
      zonas.length ? `<div class="zonas">Zonas: ${zonas.map(e).join(', ')}</div>` : '',
      routeSelector,
      ...cards,
      teamMap,
    ].filter(Boolean).join('\n');
```

- [ ] **Step 4: Expose `buildTeamPanel` for tests**

Update the export line:

```js
  window.__sigcPro.dayGuide = { generate, diaViewActive, buildRouteSelector };
```

to:

```js
  window.__sigcPro.dayGuide = { generate, diaViewActive, buildRouteSelector, buildTeamPanel };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/agenda-day-guide-route-selector.test.js`
Expected: all 8 tests PASS.

- [ ] **Step 6: Syntax check**

Run: `bun build --no-bundle extension/features/agenda-day-guide/agenda-day-guide.js --outfile=/tmp/day-guide-check.js`
Expected: no output, exit code 0.

- [ ] **Step 7: Commit**

```bash
git add extension/features/agenda-day-guide/agenda-day-guide.js tests/agenda-day-guide-route-selector.test.js
git commit -m "feat: wire route selector into team panels, default-state rule"
```

---

### Task 4: Wire a combined selector into `buildSummaryPanel` (Resumo)

**Files:**
- Modify: `extension/features/agenda-day-guide/agenda-day-guide.js` (`buildSummaryPanel`)
- Test: `tests/agenda-day-guide-route-selector.test.js` (extend)

**Interfaces:**
- Consumes: `buildRouteSelector` (Task 2).
- Produces: `buildSummaryPanel(groups, allRows, lab, enderecos)`'s non-lab output gains a "Rota do dia" section, `groupId = "resumo"`, placed before "Mapa do dia". Stops are every team's rows flattened in `groups`' existing order (`groups.flatMap((g) => g.rows)`) — no re-sort. Always `defaultAllChecked = false`, unconditionally (Resumo never auto-checks, regardless of count). Lab panel (`lab === true`) gets no selector at all, matching its existing no-map rule.

- [ ] **Step 1: Write the failing test**

Append to `tests/agenda-day-guide-route-selector.test.js`:

```js
describe('buildSummaryPanel route selector wiring', () => {
  test('Resumo combines all teams, always starts unchecked, groupId is resumo', () => {
    const { buildSummaryPanel } = window.__sigcPro.dayGuide;
    const groups = [
      { equipe: 'Equipe A', rows: [row({ horaInicio: '09:00', controle: 'C1', domicilio: 'D1' })] },
      { equipe: 'Equipe B', rows: [row({ horaInicio: '08:00', controle: 'C2', domicilio: 'D2' })] },
    ];
    const allRows = groups.flatMap((g) => g.rows);
    const enderecos = enderecosMap([
      ['C1', 'D1', -12.9, -38.5],
      ['C2', 'D2', -12.8, -38.4],
    ]);
    const html = buildSummaryPanel(groups, allRows, false, enderecos);
    expect(html).toContain('data-group="resumo"');
    expect(html).not.toContain('checked'); // unconditionally unchecked
    expect(html).toContain('Rota do dia');
    // both teams' stops present, in groups' existing order (A's 09:00 before B's 08:00)
    const idxA = html.indexOf('data-name="09:00');
    const idxB = html.indexOf('data-name="08:00');
    expect(idxA).toBeGreaterThan(-1);
    expect(idxB).toBeGreaterThan(idxA);
  });

  test('Rota do dia section placed before Mapa do dia', () => {
    const { buildSummaryPanel } = window.__sigcPro.dayGuide;
    const groups = [{ equipe: 'Equipe A', rows: [row({ controle: 'C1', domicilio: 'D1' })] }];
    const enderecos = enderecosMap([['C1', 'D1', -12.9, -38.5]]);
    const html = buildSummaryPanel(groups, groups[0].rows, false, enderecos);
    expect(html.indexOf('Rota do dia')).toBeLessThan(html.indexOf('Mapa do dia'));
  });

  test('Lab panel gets no route selector', () => {
    const { buildSummaryPanel } = window.__sigcPro.dayGuide;
    const groups = [{ equipe: 'Equipe A', rows: [row({ controle: 'C1', domicilio: 'D1' })] }];
    const enderecos = enderecosMap([['C1', 'D1', -12.9, -38.5]]);
    const html = buildSummaryPanel(groups, groups[0].rows, true, enderecos);
    expect(html).not.toContain('Rota do dia');
    expect(html).not.toContain('route-selector');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/agenda-day-guide-route-selector.test.js`
Expected: FAIL — `buildSummaryPanel` not yet exported and Resumo has no route section.

- [ ] **Step 3: Wire the combined selector into `buildSummaryPanel`**

In `buildSummaryPanel`, right before the existing `routeMap` computation, add:

```js
    // Combined day route: every team's rows in groups' existing order (name-
    // sorted teams, each team's own rows already time-sorted) — no new
    // cross-team sort. Always starts unchecked: the day route is always an
    // intentional, opt-in selection, unlike a single team's default-all-
    // checked rule in buildTeamPanel.
    const routeSelector = !lab
      ? buildRouteSelector(groups.flatMap((g) => g.rows), enderecos, 'resumo', false)
      : '';
    const rotaSection = routeSelector
      ? ['<h3>Rota do dia</h3>', routeSelector].join('\n')
      : '';
```

Then update the final return array to insert `rotaSection` before `routeMap`:

```js
    return [
      `<h2>${e(titulo)}</h2>`,
      `<table class="stats">\n${linhas}\n</table>`,
      '<h3>Slots do dia</h3>',
      buildDayGrid(groups, lab),
      rotaSection,
      routeMap,
    ].filter(Boolean).join('\n');
```

- [ ] **Step 4: Expose `buildSummaryPanel` for tests**

Update the export line:

```js
  window.__sigcPro.dayGuide = { generate, diaViewActive, buildRouteSelector, buildTeamPanel };
```

to:

```js
  window.__sigcPro.dayGuide = { generate, diaViewActive, buildRouteSelector, buildTeamPanel, buildSummaryPanel };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/agenda-day-guide-route-selector.test.js`
Expected: all 11 tests PASS.

- [ ] **Step 6: Syntax check**

Run: `bun build --no-bundle extension/features/agenda-day-guide/agenda-day-guide.js --outfile=/tmp/day-guide-check.js`
Expected: no output, exit code 0.

- [ ] **Step 7: Commit**

```bash
git add extension/features/agenda-day-guide/agenda-day-guide.js tests/agenda-day-guide-route-selector.test.js
git commit -m "feat: add combined Rota do dia section to Resumo panel"
```

---

### Task 5: Inline `<script>` — live link + cap enforcement

**Files:**
- Modify: `extension/features/agenda-day-guide/agenda-day-guide.js` (`buildGuideHtml`)
- Test: `tests/agenda-day-guide-route-selector.test.js` (extend — DOM-level test of the script's logic, since happy-dom executes inline `<script>` tags parsed via `innerHTML`/`document.write`-style insertion is unreliable; instead the script's core function is duplicated verbatim into a test to pin its behavior, exactly mirroring how `buildRouteMapSvg`'s projection math was pinned in earlier plans before being embedded)

**Interfaces:**
- Consumes: DOM structure from Tasks 2-4 (`input.route-chk[data-group][data-lat][data-lon][data-name]`, `div.rota-link#rota-link-<groupId>`).
- Produces: `buildGuideHtml`'s returned HTML string gains one `<script>` block before `</body>`. No new exported JS function — the script is a literal string template within `buildGuideHtml`, per the spec's "no separate JS array literal, DOM is the only data source" and "duplication is intentional" decisions. This task's test instead asserts on a standalone copy of the script's pure `buildGmapsUrl` helper (defined identically both inside the template string and inside the test) to keep the URL-building logic covered without executing embedded `<script>` tags in happy-dom.

- [ ] **Step 1: Write the failing test**

Append to `tests/agenda-day-guide-route-selector.test.js`:

```js
describe('inline script is present and shaped correctly', () => {
  test('buildGuideHtml embeds exactly one <script> block before </body>', () => {
    const { buildGuideHtml } = window.__sigcPro.dayGuide;
    const groups = [{ equipe: 'Equipe A', rows: [row({ controle: 'C1', domicilio: 'D1' })] }];
    const enderecos = enderecosMap([['C1', 'D1', -12.9, -38.5]]);
    const meta = { uf: 'BA', dataBr: '22/07/2026', diaSemana: 'quarta-feira', geradoEm: '22/07/2026 10:00' };
    const html = buildGuideHtml(meta, groups, groups[0].rows, enderecos);
    const scriptCount = (html.match(/<script>/g) || []).length;
    expect(scriptCount).toBe(1);
    expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('</body>'));
    expect(html).toContain('route-chk');
    expect(html).toContain('rota-link-');
  });

  test('Resumo and a team panel use distinct data-group values (independent state)', () => {
    const { buildGuideHtml } = window.__sigcPro.dayGuide;
    const groups = [{ equipe: 'Equipe A', rows: [row({ controle: 'C1', domicilio: 'D1' })] }];
    const enderecos = enderecosMap([['C1', 'D1', -12.9, -38.5]]);
    const meta = { uf: 'BA', dataBr: '22/07/2026', diaSemana: 'quarta-feira', geradoEm: '22/07/2026 10:00' };
    const html = buildGuideHtml(meta, groups, groups[0].rows, enderecos);
    expect(html).toContain('data-group="resumo"');
    expect(html).toContain('data-group="team-0"');
    // Each group has its own rota-link placeholder id -> refreshGroup's
    // querySelectorAll scoping (data-group="<id>") can never cross groups.
    expect(html).toContain('id="rota-link-resumo"');
    expect(html).toContain('id="rota-link-team-0"');
  });

  test('the embedded script builds the same URL shape as gmapsRouteUrl (mirrored logic)', () => {
    // Mirrors the inline script's buildGmapsUrl exactly (Step 3 below) so the
    // URL-building logic is covered without executing <script> in happy-dom.
    function buildGmapsUrl(stops) {
      const fmt = (s) => `${Number(s.lat).toFixed(6)},${Number(s.lon).toFixed(6)}`;
      const way = stops.slice(0, -1).map(fmt).join('|');
      const dest = fmt(stops[stops.length - 1]);
      return 'https://www.google.com/maps/dir/?api=1&travelmode=driving' +
        (way ? `&waypoints=${encodeURIComponent(way)}` : '') +
        `&destination=${encodeURIComponent(dest)}`;
    }
    const url = buildGmapsUrl([{ lat: -12.9, lon: -38.5 }, { lat: -12.8, lon: -38.4 }]);
    expect(url).toBe(
      'https://www.google.com/maps/dir/?api=1&travelmode=driving' +
      `&waypoints=${encodeURIComponent('-12.900000,-38.500000')}` +
      `&destination=${encodeURIComponent('-12.800000,-38.400000')}`
    );
  });

  test('cap enforcement logic (mirrored): disables at 9 checked, re-enables below 9', () => {
    // Mirrors refreshGroup's cap-enforcement branch exactly (Step 3 below).
    // happy-dom doesn't reliably execute inline <script> tags inserted via
    // innerHTML, so this pins the same logic standalone, same pattern as
    // the URL-building mirror test above.
    function applyCap(boxes) {
      const checked = boxes.filter((b) => b.checked);
      boxes.forEach((b) => {
        if (!b.checked) b.disabled = checked.length >= 9;
      });
    }
    // 9 checked, 1 unchecked -> the unchecked one gets disabled.
    const nineChecked = Array.from({ length: 9 }, () => ({ checked: true, disabled: false }));
    const tenth = { checked: false, disabled: false };
    applyCap([...nineChecked, tenth]);
    expect(tenth.disabled).toBe(true);

    // Drop to 8 checked -> everyone (including a previously-disabled box)
    // is re-enabled.
    nineChecked[0].checked = false;
    applyCap([...nineChecked, tenth]);
    expect(tenth.disabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/agenda-day-guide-route-selector.test.js`
Expected: FAIL — first test fails, no `<script>` in `buildGuideHtml`'s output yet (the mirrored-logic tests pass trivially since they don't touch the real file yet — that's fine, they're pinning the shape ahead of Step 3).

- [ ] **Step 3: Add the inline `<script>` to `buildGuideHtml`**

In `buildGuideHtml`, locate the final template literal's closing:

```js
${sections}
</main>
</body>
</html>
`;
```

Replace with:

```js
${sections}
</main>
<script>
(function () {
  'use strict';
  // Standalone copy of gmapsRouteUrl's URL shape — the generated file has
  // no access to the extension's build-time closures, so this is an
  // intentional duplicate (spec: gmapsRouteUrl duplication). Keeps the
  // per-visit static "abrir no mapa" pins untouched at build time.
  function buildGmapsUrl(stops) {
    var fmt = function (s) { return s.lat.toFixed(6) + ',' + s.lon.toFixed(6); };
    var way = stops.slice(0, -1).map(fmt).join('|');
    var dest = fmt(stops[stops.length - 1]);
    return 'https://www.google.com/maps/dir/?api=1&travelmode=driving' +
      (way ? '&waypoints=' + encodeURIComponent(way) : '') +
      '&destination=' + encodeURIComponent(dest);
  }

  function refreshGroup(groupId) {
    var boxes = document.querySelectorAll('.route-chk[data-group="' + groupId + '"]');
    var checked = [];
    boxes.forEach(function (b) { if (b.checked) checked.push(b); });
    // Cap enforcement: at 9 checked, disable the rest; below 9, re-enable.
    boxes.forEach(function (b) {
      if (!b.checked) b.disabled = checked.length >= 9;
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

  document.addEventListener('change', function (ev) {
    if (!ev.target.classList || !ev.target.classList.contains('route-chk')) return;
    refreshGroup(ev.target.dataset.group);
  });

  // Initial paint: every group present in the document gets its link
  // computed once on load, matching whatever defaultAllChecked produced.
  var groups = new Set();
  document.querySelectorAll('.route-chk[data-group]').forEach(function (b) {
    groups.add(b.dataset.group);
  });
  groups.forEach(refreshGroup);
})();
</script>
</body>
</html>
`;
```

- [ ] **Step 4: Expose `buildGuideHtml` for tests**

Update the export line:

```js
  window.__sigcPro.dayGuide = { generate, diaViewActive, buildRouteSelector, buildTeamPanel, buildSummaryPanel };
```

to:

```js
  window.__sigcPro.dayGuide = { generate, diaViewActive, buildRouteSelector, buildTeamPanel, buildSummaryPanel, buildGuideHtml };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/agenda-day-guide-route-selector.test.js`
Expected: all 15 tests PASS.

- [ ] **Step 6: Syntax check**

Run: `bun build --no-bundle extension/features/agenda-day-guide/agenda-day-guide.js --outfile=/tmp/day-guide-check.js`
Expected: no output, exit code 0.

- [ ] **Step 7: Run the full test suite**

Run: `bun test`
Expected: all tests across all files PASS, no regressions in `button-factories.test.js`, `mount-widget.test.js`, `sigc-common-helpers.test.js`, `smoke.test.js`.

- [ ] **Step 8: Privacy gate**

Run: `./scripts/check-privacy.sh`
Expected: clean (no new network APIs — the script only touches the DOM and builds strings).

- [ ] **Step 9: Commit**

```bash
git add extension/features/agenda-day-guide/agenda-day-guide.js tests/agenda-day-guide-route-selector.test.js
git commit -m "feat: live-updating Google Maps link with 9-stop cap enforcement"
```

---

### Task 6: CSS for the selector, and manual field verification

**Files:**
- Modify: `extension/features/agenda-day-guide/agenda-day-guide.js` (`<style>` block inside `buildGuideHtml`)

**Interfaces:**
- Consumes: `.route-selector`, `.route-item`, `.route-item-missing`, `.rota-link` class names from Tasks 2-4.
- Produces: nothing consumed by later tasks — this is the last task.

- [ ] **Step 1: Add CSS rules**

In `buildGuideHtml`'s `<style>` block, find:

```css
.geo, .rota { font-size: .92rem; margin-top: .1rem; }
```

Replace with:

```css
.geo, .rota { font-size: .92rem; margin-top: .1rem; }
.route-selector { border: 1px solid #d0d7de; border-radius: 6px; padding: .5rem .8rem; margin: .5rem 0; font-size: .9rem; }
.route-item { display: block; padding: .1rem 0; }
.route-item input { margin-right: .4rem; }
.route-item-missing { color: #8a8f98; }
.rota-link { margin-top: .4rem; font-size: .92rem; }
```

- [ ] **Step 2: Syntax check**

Run: `bun build --no-bundle extension/features/agenda-day-guide/agenda-day-guide.js --outfile=/tmp/day-guide-check.js`
Expected: no output, exit code 0.

- [ ] **Step 3: Run the full test suite**

Run: `bun test`
Expected: all tests PASS (CSS-only change, no test should be affected, but confirming no accidental breakage from the edit).

- [ ] **Step 4: Manual field test**

Load the unpacked extension in Chrome (`chrome://extensions` → Load unpacked → `extension/`), open the Agenda's Dia view with at least one team with ≥ 2 reserved+geocoded visits, click "Guia do Dia" (or "Guia + Mapa" from `agenda-map.js` if `enderecos` coverage is needed), open the downloaded HTML file:

- Confirm the team tab shows a checkbox list where "Rota:" used to be, all checked (if ≤ 9 routable stops) with a "Google Maps" link already showing.
- Uncheck a stop; confirm the link's waypoints update (inspect the href) without a page reload.
- Uncheck down to 1 or 0; confirm the link disappears.
- On a team with > 9 routable stops (or a synthetic test file), confirm all start unchecked and checking a 9th disables the rest; unchecking one re-enables them.
- Switch to Resumo; confirm "Rota do dia" appears above "Mapa do dia" with every team's stops listed, all unchecked by default.
- Check 2+ stops in Resumo and confirm its link updates independently of any team tab's selections (switch to a team tab, confirm its checkboxes are unaffected).
- Ctrl+P on a team tab and on Resumo; confirm the guide still prints cleanly (checkbox state is visually present, no layout breakage).
- Re-open the downloaded `.html` file directly via `file://` (double-click, not through the extension) to confirm the inline script still runs there (checking a box still updates its link).

- [ ] **Step 5: Commit**

```bash
git add extension/features/agenda-day-guide/agenda-day-guide.js
git commit -m "style: add route selector CSS"
```

---

## Post-plan cleanup

- Update `extension/features/agenda-day-guide/agenda-day-guide.js`'s top-of-file doc comment (lines 1-14): remove "no `<script>`" from the description and add a line noting the live route-selector script, mirroring how the original spec's Amendment section documents the reversal.
- Update `docs/ROADMAP.md` if it lists the old auto-chunked "Rota:" behavior as a known limitation (grep for "chunkRoute" or "Rota" mentions before closing out).
