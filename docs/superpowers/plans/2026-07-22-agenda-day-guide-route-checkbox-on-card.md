# Merge Route Checkbox Onto Team-Panel Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Guia do Dia's team-panel route checkboxes from a standalone list above the cards onto each visit card itself, so a user never has to cross-reference a list item against a card to know which stop it controls.

**Architecture:** All changes live in `extension/features/agenda-day-guide/agenda-day-guide.js`. A new shared helper `routeCheckboxHtml(r, info, groupId, checked)` extracts the per-row checkbox-`<label>`-building logic already inside `buildRouteSelector`; both `buildRouteSelector` (used only by Resumo from here on) and `buildSlotCard` (team panels) call it, so the `data-*` attribute shape, escaping, and disabled/non-routable handling exist in exactly one place. `buildSlotCard` gains two parameters and renders the checkbox inline in its `.hora` line. `buildTeamPanel` stops building a checkbox list and instead threads per-row checked state into each card, moving the `rota-link` placeholder to just before the team's SVG map.

**Tech Stack:** Vanilla ES2020, Chrome MV3 MAIN-world content script, no bundler. `bun:test` + `happy-dom` (`tests/agenda-day-guide-route-selector.test.js`, already exists — extended, not replaced); `bun build --no-bundle <file> --outfile=/dev/null` for syntax checks (node is absent from PATH). Spec: `docs/superpowers/specs/2026-07-22-agenda-day-guide-route-checkbox-on-card-design.md`. Amends: `docs/superpowers/specs/2026-07-22-agenda-day-guide-dynamic-route-design.md` (already shipped).

## Global Constraints

- Resumo panel (`buildSummaryPanel`) is **unchanged** — same signature, same output shape, same tests passing unmodified (spec, Scope).
- Lab tab is untouched — no route selector, no script hooks (spec, Scope; inherited from the original feature).
- The inline `<script>` (live link + 9-cap enforcement) added by the original feature gets **zero changes** — it locates checkboxes via `.route-chk[data-group="<id>"]` and the link target via `#rota-link-<id>`, independent of DOM position (spec, "Inline `<script>`").
- Non-routable reserved rows render a disabled, unchecked checkbox at the same position a routable row's checkbox would occupy — no extra note text on the card (spec, "Non-routable reserved rows").
- LIVRE (open) rows never get a checkbox — unchanged from today (spec, "Checkbox placement on the card").
- `routeGroupId` for a team panel stays `team-<colorIndex>` — same string the original feature already uses (spec, "Data flow / interfaces").
- The `checked` parameter only takes effect for routable reserved rows; non-routable reserved rows always render unchecked+disabled regardless of its value, and LIVRE rows render no checkbox regardless of its value (spec, "Data flow / interfaces").
- `buildRouteSelector`'s existing signature and behavior for Resumo's call site must not change (spec, "Data flow / interfaces").
- `./scripts/check-privacy.sh` must stay clean after every task (no new network APIs — this is pure string/DOM building).
- Existing exact behavior/functions must not change except where this plan explicitly modifies them: `groupByEquipe`, `computeStats`, `zonasUnion`, `slotInfo`, `zonaLabel`, `fmtCoord`, `gmapsRouteUrl`, `buildDayGrid`, `buildRouteMapSvg`, `buildLegend`, `stopSequenceMap`, `teamColor`, `TABLE_CSS`, `guideMeta`, `fileName`, `generate`, `buildSummaryPanel`, `buildGuideHtml`'s inline `<script>` content, `window.__sigcPro.dayGuide`'s existing keys (`generate`, `diaViewActive`, `buildRouteSelector`, `buildTeamPanel`, `buildSummaryPanel`, `buildGuideHtml` — none removed, new keys may be added).

---

### Task 1: Extract `routeCheckboxHtml` shared helper, rewire `buildRouteSelector` to use it

**Files:**
- Modify: `extension/features/agenda-day-guide/agenda-day-guide.js:118-150` (replace `buildRouteSelector`'s body, add `routeCheckboxHtml` above it)
- Test: `tests/agenda-day-guide-route-selector.test.js` (existing `describe('buildRouteSelector', ...)` block must still pass unmodified — this task is a pure refactor of `buildRouteSelector`'s internals)

**Interfaces:**
- Consumes: `escapeHtml`, `slotInfo`, `zonaLabel` (all already in the file, unchanged).
- Produces (Task 2 relies on these exact signatures):
  - `routeCheckboxInput(r, info, groupId, checked)` — the bare `<input type="checkbox" ...>` tag only (enabled+`data-*` when routable, `disabled` when not). This is the piece `buildSlotCard` (Task 2) embeds directly into a card's `.hora` line — no string-parsing of a larger fragment needed.
  - `routeCheckboxHtml(r, info, groupId, checked)` — wraps `routeCheckboxInput`'s output in the full `<label class="route-item">...</label>` (or `route-item route-item-missing` when non-routable) that `buildRouteSelector` needs for Resumo's standalone list. Byte-identical to the markup `buildRouteSelector` produces today per row.
  - Both take the same four arguments: `r` is one row (reserved; caller's responsibility to filter), `info` is `slotInfo(r, enderecos)`'s result (may be `null`/have `lat == null`), `groupId` is the `data-group` string, `checked` is a boolean only honored when `info && info.lat != null`.

- [ ] **Step 1: Read current behavior to pin the refactor's target output**

Current `buildRouteSelector` (lines 118-150):

```js
  function buildRouteSelector(rows, enderecos, groupId, defaultAllChecked) {
    const e = escapeHtml;
    const items = rows.filter((r) => r.reservado).map((r) => {
      const info = slotInfo(r, enderecos);
      const label = `${r.horaInicio} ${r.nome || r.controle}`;
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
      if (info && info.lat != null) {
        const checkedAttr = defaultAllChecked ? ' checked' : '';
        return '<label class="route-item">' +
          `<input type="checkbox" class="route-chk" data-group="${e(groupId)}" ` +
          `data-lat="${info.lat.toFixed(6)}" data-lon="${info.lon.toFixed(6)}" ` +
          `data-name="${e(label)}"${checkedAttr}> ${display}` +
          '</label>';
      }
      return '<label class="route-item route-item-missing">' +
        `<input type="checkbox" disabled> ${display} — sem coordenadas` +
        '</label>';
    });
    if (items.length === 0) return '';
    return '<div class="route-selector">' +
      items.join('\n') +
      `<div class="rota-link" id="rota-link-${e(groupId)}"></div>` +
      '</div>';
  }
```

Note the per-row body (everything computing `label`/`zona`/`detail`/`display` and building the `<input>`/`<label>`) is exactly what becomes `routeCheckboxInput` and `routeCheckboxHtml`.

- [ ] **Step 2: Replace with the extracted helpers + a `buildRouteSelector` that calls them**

Replace lines 118-150 with:

```js
  // Builds the bare checkbox <input> for a RESERVED row. Routable rows
  // (info has lat/lon) get an enabled checkbox with data-lat/lon/name,
  // seeded from `checked`; non-routable rows get a permanently disabled,
  // unchecked <input> with no data-* attributes. Used directly by
  // buildSlotCard (team-panel cards) and wrapped by routeCheckboxHtml
  // (Resumo's standalone list) — the data-* attribute shape and escaping
  // exist in exactly one place either way.
  function routeCheckboxInput(r, info, groupId, checked) {
    const e = escapeHtml;
    if (info && info.lat != null) {
      const label = `${r.horaInicio} ${r.nome || r.controle}`;
      const checkedAttr = checked ? ' checked' : '';
      return `<input type="checkbox" class="route-chk" data-group="${e(groupId)}" ` +
        `data-lat="${info.lat.toFixed(6)}" data-lon="${info.lon.toFixed(6)}" ` +
        `data-name="${e(label)}"${checkedAttr}>`;
    }
    return '<input type="checkbox" disabled>';
  }

  // Wraps routeCheckboxInput in the <label> Resumo's standalone list
  // needs: the checkbox plus a text description of the stop (time, name,
  // Controle/Dom/Zona) and, for non-routable rows, a "sem coordenadas"
  // note — present so the list's row count never silently drops a visit.
  function routeCheckboxHtml(r, info, groupId, checked) {
    const e = escapeHtml;
    const label = `${r.horaInicio} ${r.nome || r.controle}`;
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

  // groupId namespaces data-group (read by the inline script) and the
  // trailing rota-link placeholder's id, so multiple independent selectors
  // (Resumo + each team) can coexist without id/state collisions.
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

- [ ] **Step 3: Expose `routeCheckboxInput` and `routeCheckboxHtml` for tests**

Find the export line near the bottom of the file:

```js
  window.__sigcPro.dayGuide = { generate, diaViewActive, buildRouteSelector, buildTeamPanel, buildSummaryPanel, buildGuideHtml };
```

Replace with:

```js
  window.__sigcPro.dayGuide = { generate, diaViewActive, buildRouteSelector, buildTeamPanel, buildSummaryPanel, buildGuideHtml, routeCheckboxInput, routeCheckboxHtml };
```

- [ ] **Step 4: Run the existing `buildRouteSelector` tests to confirm the refactor is behavior-preserving**

Run: `bun test tests/agenda-day-guide-route-selector.test.js -t "buildRouteSelector"`
Expected: all 7 tests in the `describe('buildRouteSelector', ...)` block PASS unmodified (this is a pure refactor — no test in this block should need editing).

- [ ] **Step 5: Write new failing tests for `routeCheckboxInput` and `routeCheckboxHtml` directly**

Append to `tests/agenda-day-guide-route-selector.test.js`, after the `describe('buildRouteSelector', ...)` block's closing `});` (before `describe('buildTeamPanel route selector wiring', ...)`):

```js
describe('routeCheckboxInput', () => {
  test('routable row: enabled checkbox with data-lat/lon/name, no label wrapper', () => {
    const { routeCheckboxInput } = window.__sigcPro.dayGuide;
    const r = row({ horaInicio: '09:00', nome: 'Maria Silva', controle: 'C1', domicilio: 'D1' });
    const info = { lat: -12.9, lon: -38.5, zona: null, idZona: null };
    const html = routeCheckboxInput(r, info, 'team-0', true);
    expect(html).toContain('class="route-chk"');
    expect(html).toContain('data-group="team-0"');
    expect(html).toContain('data-lat="-12.900000"');
    expect(html).toContain('data-lon="-38.500000"');
    expect(html).toContain('data-name="09:00 Maria Silva"');
    expect(html).toContain('checked');
    expect(html).not.toContain('<label');
    expect(html).not.toContain('sem coordenadas');
  });

  test('routable row, checked=false: no checked attribute', () => {
    const { routeCheckboxInput } = window.__sigcPro.dayGuide;
    const r = row();
    const info = { lat: -12.9, lon: -38.5, zona: null, idZona: null };
    const html = routeCheckboxInput(r, info, 'team-0', false);
    expect(html).not.toContain('checked');
  });

  test('non-routable row (info null): bare disabled checkbox, no data-* attributes', () => {
    const { routeCheckboxInput } = window.__sigcPro.dayGuide;
    const r = row();
    const html = routeCheckboxInput(r, null, 'team-0', true);
    expect(html).toBe('<input type="checkbox" disabled>');
  });

  test('non-routable row (info present but lat null): bare disabled checkbox', () => {
    const { routeCheckboxInput } = window.__sigcPro.dayGuide;
    const r = row();
    const info = { lat: null, lon: null, zona: null, idZona: null };
    const html = routeCheckboxInput(r, info, 'team-0', true);
    expect(html).toBe('<input type="checkbox" disabled>');
  });

  test('escapes stop name in data-name', () => {
    const { routeCheckboxInput } = window.__sigcPro.dayGuide;
    const r = row({ nome: '<script>alert(1)</script>' });
    const info = { lat: -12.9, lon: -38.5, zona: null, idZona: null };
    const html = routeCheckboxInput(r, info, 'team-0', true);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('routeCheckboxHtml', () => {
  test('routable row: enabled checkbox with data-lat/lon/name and detail text', () => {
    const { routeCheckboxHtml } = window.__sigcPro.dayGuide;
    const r = row({ horaInicio: '09:00', nome: 'Maria Silva', controle: 'C1', domicilio: 'D1' });
    const info = { lat: -12.9, lon: -38.5, zona: 'Centro', idZona: '12' };
    const html = routeCheckboxHtml(r, info, 'team-0', true);
    expect(html).toContain('class="route-chk"');
    expect(html).toContain('data-group="team-0"');
    expect(html).toContain('data-lat="-12.900000"');
    expect(html).toContain('data-lon="-38.500000"');
    expect(html).toContain('data-name="09:00 Maria Silva"');
    expect(html).toContain('checked');
    expect(html).toContain('Controle: C1 &nbsp;·&nbsp; Dom: D1 &nbsp;·&nbsp; Zona: 12 Centro');
  });

  test('routable row, checked=false: no checked attribute', () => {
    const { routeCheckboxHtml } = window.__sigcPro.dayGuide;
    const r = row();
    const info = { lat: -12.9, lon: -38.5, zona: null, idZona: null };
    const html = routeCheckboxHtml(r, info, 'team-0', false);
    expect(html).not.toMatch(/route-chk[^>]*checked/);
  });

  test('non-routable row (info null): disabled, unchecked, "sem coordenadas" note', () => {
    const { routeCheckboxHtml } = window.__sigcPro.dayGuide;
    const r = row();
    const html = routeCheckboxHtml(r, null, 'team-0', true);
    expect(html).toContain('disabled');
    expect(html).not.toMatch(/route-chk[^>]*checked/);
    expect(html).toContain('sem coordenadas');
  });

  test('non-routable row (info present but lat null): disabled, unchecked', () => {
    const { routeCheckboxHtml } = window.__sigcPro.dayGuide;
    const r = row();
    const info = { lat: null, lon: null, zona: null, idZona: null };
    const html = routeCheckboxHtml(r, info, 'team-0', true);
    expect(html).toContain('disabled');
    expect(html).toContain('sem coordenadas');
  });

  test('escapes stop name in both data-name and display text', () => {
    const { routeCheckboxHtml } = window.__sigcPro.dayGuide;
    const r = row({ nome: '<script>alert(1)</script>' });
    const info = { lat: -12.9, lon: -38.5, zona: null, idZona: null };
    const html = routeCheckboxHtml(r, info, 'team-0', true);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `bun test tests/agenda-day-guide-route-selector.test.js -t "routeCheckbox"`
Expected: FAIL — `routeCheckboxInput`/`routeCheckboxHtml` are `undefined` (not yet exported) until Step 3 above is applied. Since Steps 2-3 are already done by this point in the task, this step instead confirms the 10 new tests PASS. Run it after Step 3, expect PASS.

- [ ] **Step 7: Run the full existing test file**

Run: `bun test tests/agenda-day-guide-route-selector.test.js`
Expected: all tests PASS (7 `buildRouteSelector` + 5 new `routeCheckboxInput` + 5 new `routeCheckboxHtml` + existing `buildTeamPanel`/`buildSummaryPanel`/inline-script describe blocks, all passing — this task changes no behavior any of those blocks observe).

- [ ] **Step 8: Syntax check**

Run: `bun build --no-bundle extension/features/agenda-day-guide/agenda-day-guide.js --outfile=/tmp/day-guide-check.js`
Expected: no output, exit code 0.

- [ ] **Step 9: Commit**

```bash
git add extension/features/agenda-day-guide/agenda-day-guide.js tests/agenda-day-guide-route-selector.test.js
git commit -m "refactor: extract routeCheckboxHtml from buildRouteSelector"
```

---

### Task 2: Wire the checkbox into `buildSlotCard`, update `buildTeamPanel`

**Files:**
- Modify: `extension/features/agenda-day-guide/agenda-day-guide.js:385-437` (`buildSlotCard`), `extension/features/agenda-day-guide/agenda-day-guide.js:439-489` (`buildTeamPanel`)
- Test: `tests/agenda-day-guide-route-selector.test.js` (extend; also fix two now-stale assertions in the existing `buildTeamPanel route selector wiring` describe block)

**Interfaces:**
- Consumes: `routeCheckboxInput(r, info, groupId, checked)` from Task 1.
- Produces: `buildSlotCard(r, enderecos, seqMap, color, routeGroupId, checked)` — two new trailing parameters. For reserved rows, the `.hora` line gains `routeCheckboxInput`'s bare `<input>` markup immediately before the time. LIVRE rows ignore both new parameters entirely (unchanged output). `buildTeamPanel(group, enderecos, colorIndex)`'s signature is unchanged, but its returned HTML no longer contains a `.route-selector`/`.route-item` block — only a bare `<div class="rota-link" id="rota-link-team-<colorIndex>"></div>` positioned immediately before the SVG map.

- [ ] **Step 1: Write the failing tests**

Append to `tests/agenda-day-guide-route-selector.test.js`, inside a new `describe` block after the `routeCheckboxHtml` block added in Task 1 (before `describe('buildTeamPanel route selector wiring', ...)`):

```js
describe('buildSlotCard route checkbox', () => {
  test('routable reserved row: checkbox appears in the .hora line, before the time', () => {
    const { buildSlotCard } = window.__sigcPro.dayGuide;
    const r = row({ horaInicio: '09:00', controle: 'C1', domicilio: 'D1' });
    const enderecos = enderecosMap([['C1', 'D1', -12.9, -38.5]]);
    const html = buildSlotCard(r, enderecos, null, '#005a9c', 'team-0', true);
    expect(html).toContain('class="route-chk"');
    expect(html).toContain('data-group="team-0"');
    expect(html).toContain('checked');
    const horaIdx = html.indexOf('class="hora"');
    const chkIdx = html.indexOf('route-chk');
    const timeIdx = html.indexOf('09:00', horaIdx);
    expect(chkIdx).toBeGreaterThan(horaIdx);
    expect(chkIdx).toBeLessThan(timeIdx);
  });

  test('routable reserved row, checked=false: checkbox present but unchecked', () => {
    const { buildSlotCard } = window.__sigcPro.dayGuide;
    const r = row({ controle: 'C1', domicilio: 'D1' });
    const enderecos = enderecosMap([['C1', 'D1', -12.9, -38.5]]);
    const html = buildSlotCard(r, enderecos, null, '#005a9c', 'team-0', false);
    expect(html).toContain('class="route-chk"');
    expect(html).not.toMatch(/route-chk[^>]*checked/);
  });

  test('non-routable reserved row: disabled unchecked checkbox, no extra note text', () => {
    const { buildSlotCard } = window.__sigcPro.dayGuide;
    const r = row({ controle: 'C1', domicilio: 'D1' });
    const html = buildSlotCard(r, null, null, '#005a9c', 'team-0', true);
    expect(html).toContain('type="checkbox" disabled');
    expect(html).not.toContain('sem coordenadas');
  });

  test('LIVRE row: no checkbox at all, unaffected by routeGroupId/checked', () => {
    const { buildSlotCard } = window.__sigcPro.dayGuide;
    const r = row({ reservado: false });
    const html = buildSlotCard(r, null, null, '#005a9c', 'team-0', true);
    expect(html).not.toContain('route-chk');
    expect(html).not.toContain('checkbox');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/agenda-day-guide-route-selector.test.js -t "buildSlotCard route checkbox"`
Expected: FAIL — `buildSlotCard` is not yet exported on `window.__sigcPro.dayGuide`, and the two new parameters don't exist yet.

- [ ] **Step 3: Wire the checkbox into `buildSlotCard`**

Current `buildSlotCard` (lines 385-437):

```js
  function buildSlotCard(r, enderecos, seqMap, color) {
    const e = escapeHtml;
    const hora = `${e(r.horaInicio)}–${e(r.horaFim)}`;
    if (!r.reservado) {
      return [
        '<div class="card livre">',
        `<div class="hora">${hora} <span class="badge badge-livre">LIVRE</span></div>`,
        r.zonas ? `<div class="zonas">Zonas: ${e(r.zonas)}</div>` : '',
        '</div>',
      ].filter(Boolean).join('\n');
    }

    const detalhes = [r.sexo && e(r.sexo), r.idade && `${e(r.idade)} anos`]
      .filter(Boolean).join(', ');
    const nasc = r.dtNascimento ? `(${e(r.dtNascimento)})` : '';
    const partes = [
      r.nome ? `<strong>${e(r.nome)}</strong>` : '',
      [detalhes, nasc].filter(Boolean).join(' '),
    ].filter(Boolean);
    const morador = partes.length
      ? `<div class="morador">${partes.join(' — ')}</div>`
      : '';
    const info = slotInfo(r, enderecos);
    const zona = zonaLabel(info);
    const ids = [
      r.telefone && `Tel: ${e(r.telefone)}`,
      r.controle && `Controle: ${e(r.controle)}`,
      r.domicilio && `Dom: ${e(r.domicilio)}`,
      zona && `Zona: ${e(zona)}`,
    ].filter(Boolean).join(' &nbsp;·&nbsp; ');
    // Matches the number and color of the visit's dot in the map below
    // (same per-set sequence, computed by stopSequenceMap) — absent when
    // the visit has no valid coordinates, since it has no dot to match.
    const seq = seqMap && seqMap.get(enderecoKey(r));
    const seqBadge = seq != null
      ? `<span class="badge badge-seq" style="background:${e(color || '#005a9c')}">${seq}</span> ` : '';

    return [
      '<div class="card">',
      `<div class="hora">${hora} ${seqBadge}<span class="badge">RESERVADO</span></div>`,
      r.endereco ? `<div class="endereco">${e(r.endereco)}</div>` : '',
      info && info.lat != null
        // Same Google Maps driving-directions link the Rota row uses
        // (gmapsRouteUrl degrades to a plain destination pin for one
        // point) — geo: links don't reliably open on desktop Chrome,
        // where field users read this guide.
        ? `<div class="geo"><a href="${e(gmapsRouteUrl([info]))}">abrir no mapa</a></div>` : '',
      morador,
      ids ? `<div class="ids">${ids}</div>` : '',
      r.observacao ? `<div class="obs">Obs: ${e(r.observacao)}</div>` : '',
      '</div>',
    ].filter(Boolean).join('\n');
  }
```

Replace with:

```js
  function buildSlotCard(r, enderecos, seqMap, color, routeGroupId, checked) {
    const e = escapeHtml;
    const hora = `${e(r.horaInicio)}–${e(r.horaFim)}`;
    if (!r.reservado) {
      return [
        '<div class="card livre">',
        `<div class="hora">${hora} <span class="badge badge-livre">LIVRE</span></div>`,
        r.zonas ? `<div class="zonas">Zonas: ${e(r.zonas)}</div>` : '',
        '</div>',
      ].filter(Boolean).join('\n');
    }

    const detalhes = [r.sexo && e(r.sexo), r.idade && `${e(r.idade)} anos`]
      .filter(Boolean).join(', ');
    const nasc = r.dtNascimento ? `(${e(r.dtNascimento)})` : '';
    const partes = [
      r.nome ? `<strong>${e(r.nome)}</strong>` : '',
      [detalhes, nasc].filter(Boolean).join(' '),
    ].filter(Boolean);
    const morador = partes.length
      ? `<div class="morador">${partes.join(' — ')}</div>`
      : '';
    const info = slotInfo(r, enderecos);
    const zona = zonaLabel(info);
    const ids = [
      r.telefone && `Tel: ${e(r.telefone)}`,
      r.controle && `Controle: ${e(r.controle)}`,
      r.domicilio && `Dom: ${e(r.domicilio)}`,
      zona && `Zona: ${e(zona)}`,
    ].filter(Boolean).join(' &nbsp;·&nbsp; ');
    // Matches the number and color of the visit's dot in the map below
    // (same per-set sequence, computed by stopSequenceMap) — absent when
    // the visit has no valid coordinates, since it has no dot to match.
    const seq = seqMap && seqMap.get(enderecoKey(r));
    const seqBadge = seq != null
      ? `<span class="badge badge-seq" style="background:${e(color || '#005a9c')}">${seq}</span> ` : '';
    const chk = `${routeCheckboxInput(r, info, routeGroupId, checked)} `;

    return [
      '<div class="card">',
      `<div class="hora">${chk}${hora} ${seqBadge}<span class="badge">RESERVADO</span></div>`,
      r.endereco ? `<div class="endereco">${e(r.endereco)}</div>` : '',
      info && info.lat != null
        // Same Google Maps driving-directions link the Rota row uses
        // (gmapsRouteUrl degrades to a plain destination pin for one
        // point) — geo: links don't reliably open on desktop Chrome,
        // where field users read this guide.
        ? `<div class="geo"><a href="${e(gmapsRouteUrl([info]))}">abrir no mapa</a></div>` : '',
      morador,
      ids ? `<div class="ids">${ids}</div>` : '',
      r.observacao ? `<div class="obs">Obs: ${e(r.observacao)}</div>` : '',
      '</div>',
    ].filter(Boolean).join('\n');
  }
```

- [ ] **Step 4: Update `buildTeamPanel`'s wiring**

Current `buildTeamPanel` (lines 439-489):

```js
  function buildTeamPanel(group, enderecos, colorIndex) {
    const e = escapeHtml;
    const s = computeStats(group.rows);
    const zonas = zonasUnion(group.rows, enderecos);
    const statBits = [
      `${s.reservados} reservado(s) × ${s.livres} livre(s)`,
      s.ocupacaoPct != null ? `ocupação ${s.ocupacaoPct}%` : null,
      s.primeiro ? `primeiro ${e(s.primeiro.hora)}` : null,
      s.ultimo ? `último ${e(s.ultimo.hora)}` : null,
      s.controles.length ? `${s.controles.length} controle(s) distinto(s)` : null,
    ].filter(Boolean).join(' &nbsp;·&nbsp; ');
    // Open slots outside the reserved span (before the first visit,
    // after the last, or the whole day when nothing is reserved) render
    // as slim livre-edge rows; open slots between visits get full card
    // weight via buildSlotCard.
    const first = group.rows.findIndex((r) => r.reservado);
    const last = group.rows.length - 1 -
      [...group.rows].reverse().findIndex((r) => r.reservado);
    const seqMap = stopSequenceMap(group.rows, enderecos);
    const color = teamColor(colorIndex);
    const cards = group.rows.map((r, i) => {
      const edge = first === -1 || i < first || i > last;
      return !r.reservado && edge ? buildLivreEdgeRow(r) : buildSlotCard(r, enderecos, seqMap, color);
    });
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
    const teamMap = enderecos
      ? buildRouteMapSvg(
          [{ rows: group.rows.filter((r) => r.reservado), color: teamColor(colorIndex) }],
          enderecos, 480, 320
        )
      : '';
    return [
      `<h2>${e(group.equipe)}</h2>`,
      `<div class="teamstats">${statBits}</div>`,
      zonas.length ? `<div class="zonas">Zonas: ${zonas.map(e).join(', ')}</div>` : '',
      routeSelector,
      ...cards,
      teamMap,
    ].filter(Boolean).join('\n');
  }
```

Replace with:

```js
  function buildTeamPanel(group, enderecos, colorIndex) {
    const e = escapeHtml;
    const s = computeStats(group.rows);
    const zonas = zonasUnion(group.rows, enderecos);
    const statBits = [
      `${s.reservados} reservado(s) × ${s.livres} livre(s)`,
      s.ocupacaoPct != null ? `ocupação ${s.ocupacaoPct}%` : null,
      s.primeiro ? `primeiro ${e(s.primeiro.hora)}` : null,
      s.ultimo ? `último ${e(s.ultimo.hora)}` : null,
      s.controles.length ? `${s.controles.length} controle(s) distinto(s)` : null,
    ].filter(Boolean).join(' &nbsp;·&nbsp; ');
    // Routable count decides the default: <=9 -> all checked (matches
    // the original auto-route), >9 -> none checked (chunking is gone, the
    // user must pick their own <=9 stops). Non-routable rows never count
    // toward this and always render a disabled checkbox on their card.
    const routableCount = group.rows.filter((r) => {
      if (!r.reservado) return false;
      const info = slotInfo(r, enderecos);
      return info && info.lat != null;
    }).length;
    const routeGroupId = `team-${colorIndex}`;
    const defaultChecked = routableCount <= 9;
    // Open slots outside the reserved span (before the first visit,
    // after the last, or the whole day when nothing is reserved) render
    // as slim livre-edge rows; open slots between visits get full card
    // weight via buildSlotCard.
    const first = group.rows.findIndex((r) => r.reservado);
    const last = group.rows.length - 1 -
      [...group.rows].reverse().findIndex((r) => r.reservado);
    const seqMap = stopSequenceMap(group.rows, enderecos);
    const color = teamColor(colorIndex);
    const cards = group.rows.map((r, i) => {
      const edge = first === -1 || i < first || i > last;
      return !r.reservado && edge
        ? buildLivreEdgeRow(r)
        : buildSlotCard(r, enderecos, seqMap, color, routeGroupId, defaultChecked);
    });
    const teamMap = enderecos
      ? buildRouteMapSvg(
          [{ rows: group.rows.filter((r) => r.reservado), color: teamColor(colorIndex) }],
          enderecos, 480, 320
        )
      : '';
    // Bare link placeholder (no checkbox list — checkboxes now live on
    // each card above). Sits right before the SVG map so the live link
    // and the visual route it feeds are next to each other.
    const rotaLink = `<div class="rota-link" id="rota-link-${e(routeGroupId)}"></div>`;
    return [
      `<h2>${e(group.equipe)}</h2>`,
      `<div class="teamstats">${statBits}</div>`,
      zonas.length ? `<div class="zonas">Zonas: ${zonas.map(e).join(', ')}</div>` : '',
      ...cards,
      rotaLink,
      teamMap,
    ].filter(Boolean).join('\n');
  }
```

- [ ] **Step 5: Expose `buildSlotCard` for tests**

Update the export line:

```js
  window.__sigcPro.dayGuide = { generate, diaViewActive, buildRouteSelector, buildTeamPanel, buildSummaryPanel, buildGuideHtml, routeCheckboxInput, routeCheckboxHtml };
```

to:

```js
  window.__sigcPro.dayGuide = { generate, diaViewActive, buildRouteSelector, buildTeamPanel, buildSummaryPanel, buildGuideHtml, routeCheckboxInput, routeCheckboxHtml, buildSlotCard };
```

- [ ] **Step 6: Fix the two now-stale assertions in the existing `buildTeamPanel route selector wiring` describe block**

These two tests (already in the file, from the original feature) assert the old standalone-list-before-cards layout, which this task removes. Find:

```js
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
```

Replace with:

```js
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
    expect(html).not.toContain('class="rota"'); // old auto-route block gone
    expect(html).not.toContain('route-selector'); // standalone list gone too
    // Checkbox sits inside each card's .hora line, not in a separate block.
    const chkIdx = html.indexOf('route-chk');
    const cardIdx = html.indexOf('class="card"');
    expect(chkIdx).toBeGreaterThan(cardIdx);
    // Link placeholder still exists, now positioned after all cards.
    const lastCardIdx = html.lastIndexOf('class="card"');
    const linkIdx = html.indexOf('rota-link-team-0');
    expect(linkIdx).toBeGreaterThan(lastCardIdx);
  });
```

Then find:

```js
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
```

This test needs no changes — `checked` still must not appear anywhere in the output, regardless of whether checkboxes live in a list or on cards. Leave it as-is.

- [ ] **Step 7: Run test to verify everything passes**

Run: `bun test tests/agenda-day-guide-route-selector.test.js`
Expected: all tests PASS — the new `buildSlotCard route checkbox` block, the two updated `buildTeamPanel` tests, and every `buildSummaryPanel`/inline-script test unmodified and still green (confirms Resumo is untouched, per the Global Constraints).

- [ ] **Step 8: Syntax check**

Run: `bun build --no-bundle extension/features/agenda-day-guide/agenda-day-guide.js --outfile=/tmp/day-guide-check.js`
Expected: no output, exit code 0.

- [ ] **Step 9: Run the full project test suite**

Run: `bun test`
Expected: all tests across all files PASS, no regressions in `button-factories.test.js`, `mount-widget.test.js`, `sigc-common-helpers.test.js`, `smoke.test.js`.

- [ ] **Step 10: Privacy gate**

Run: `./scripts/check-privacy.sh`
Expected: clean (no new network APIs — pure string/DOM building).

- [ ] **Step 11: Commit**

```bash
git add extension/features/agenda-day-guide/agenda-day-guide.js tests/agenda-day-guide-route-selector.test.js
git commit -m "feat: move team-panel route checkbox onto each visit card"
```

---

### Task 3: CSS for the on-card checkbox, and manual field verification

**Files:**
- Modify: `extension/features/agenda-day-guide/agenda-day-guide.js` (`<style>` block inside `buildGuideHtml`, around line 638-654)

**Interfaces:**
- Consumes: `.hora .route-chk` (new rule, scoped to this context only — does not affect Resumo's `.route-item input` styling).
- Produces: nothing consumed by later tasks — this is the last task.

- [ ] **Step 1: Add a CSS rule scoping checkbox spacing to the card's `.hora` line**

In `buildGuideHtml`'s `<style>` block, find:

```css
.card .hora { font-weight: 600; }
```

Replace with:

```css
.card .hora { font-weight: 600; }
.card .hora .route-chk { margin-right: .4rem; font-weight: normal; }
```

(`font-weight: normal` keeps the checkbox's own rendering unaffected by `.hora`'s bold — browsers don't visually bold checkboxes, but this makes the intent explicit and matches the same defensive pattern already used elsewhere in this stylesheet.)

- [ ] **Step 2: Syntax check**

Run: `bun build --no-bundle extension/features/agenda-day-guide/agenda-day-guide.js --outfile=/tmp/day-guide-check.js`
Expected: no output, exit code 0.

- [ ] **Step 3: Run the full test suite**

Run: `bun test`
Expected: all tests PASS (CSS-only change, no test should be affected, but confirming no accidental breakage from the edit).

- [ ] **Step 4: Manual field test**

Load the unpacked extension in Chrome (`chrome://extensions` → Load unpacked → `extension/`), open the Agenda's Dia view with at least one team with ≥ 2 reserved+geocoded visits, click "Guia + Mapa", open the downloaded HTML file:

- Confirm each reserved card's `.hora` line now shows a checkbox before the time, and there is no standalone checkbox list above the cards on any team tab.
- Confirm the live Google Maps link now renders just above the team's SVG route map (after all cards), and still updates live as cards' checkboxes are checked/unchecked.
- Confirm a coordinate-less reserved visit's card shows a disabled, unchecked checkbox (no extra "sem coordenadas" text beyond what the card already omits — the "abrir no mapa" link stays absent as it always was).
- Confirm checking a 9th stop on a team disables the remaining unchecked cards' checkboxes on that same team; unchecking one re-enables them.
- Switch to Resumo: confirm "Rota do dia" is completely unchanged — still a standalone checkbox list above "Mapa do dia", not affected by this change.
- Ctrl+P on a team tab; confirm the guide still prints cleanly with the checkbox inline on each card's header line, no layout breakage.
- Re-open the downloaded `.html` file directly via `file://` (double-click, not through the extension) to confirm the inline script still runs there (checking a card's box still updates the team's link).

- [ ] **Step 5: Commit**

```bash
git add extension/features/agenda-day-guide/agenda-day-guide.js
git commit -m "style: scope checkbox spacing to card .hora line"
```

---

## Post-plan cleanup

- Update `docs/superpowers/specs/2026-07-22-agenda-day-guide-dynamic-route-design.md`'s "Layout placement" section to note it's superseded for team panels by
  `docs/superpowers/specs/2026-07-22-agenda-day-guide-route-checkbox-on-card-design.md` — mirroring how earlier specs in this project cross-reference their amendments.
