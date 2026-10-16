# Guia do Dia: hide LIVRE cards and Zonas: line Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Team-panel tabs show only reserved visits (no LIVRE cards/rows,
no per-team "Zonas: A, B, C" line); the hora×equipe grid renders open
slots as blank `sem-slot` cells, same as marks with no slot at all.

**Architecture:** Two isolated edits in one file
(`extension/features/agenda-day-guide/agenda-day-guide.js`):
`buildTeamPanel` filters to reserved rows before building cards and drops
the `zonas` line; `buildDayGrid` filters each mark's matched slots to
reserved-only before deciding whether to render content or `sem-slot`.

**Tech Stack:** Vanilla JS (MV3 extension, MAIN-world content scripts),
`bun:test`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-06-guide-hide-livre-zonas-design.md`.
- `buildSlotCard` itself is UNCHANGED — its `!r.reservado` LIVRE-rendering branch stays; only callers stop feeding it non-reserved rows via `buildTeamPanel`.
- Numeric stats untouched: `computeStats`'s `livres` count, the team-panel "N livre(s)" stat text, the summary table's "Slots livres" row, the grid's `Livres`/`Ocupação` footer rows all stay exactly as-is.
- `zonaLabel`/`zonaFullLabel` (per-visit zona on a card's `ids` line, per-cell `Zona:` in the grid) are untouched — only the per-team *summary* "Zonas: A, B, C" line is removed.
- `buildRouteSelector`/`stopSequenceMap`/`routeIdxMap`/`buildRouteMapSvg` already filter to reserved rows — no change needed.
- CSS rules for the removed classes (`.livre-edge`, `.badge-livre`, `.card.livre`, `table.grid .grid-livre`) are left in place — not part of this change.
- A grid mark with a MIX of reserved and open slots for the same team must show only the reserved slot(s)' content — never a blank line or leftover LIVRE text for the dropped open slot.

---

## Task 1: Remove LIVRE cards and the Zonas: line from `buildTeamPanel`; blank open-only grid cells in `buildDayGrid`

**Files:**
- Modify: `extension/features/agenda-day-guide/agenda-day-guide.js:533-589` (`buildTeamPanel`)
- Modify: `extension/features/agenda-day-guide/agenda-day-guide.js:654-704` (`buildDayGrid`, the per-mark cell-building block)
- Modify: `tests/agenda-day-guide-lab-grid.test.js` (rewrite the one LIVRE-asserting test)
- Test: `tests/agenda-day-guide-team-panel.test.js` (new)
- Test: `tests/agenda-day-guide-lab-grid.test.js` (extended — grid open/mixed-slot coverage)

**Interfaces:**
- Consumes: existing `buildSlotCard(r, enderecos, seqMap, color, routeGroupId, checked, idx)`, `stopSequenceMap`, `routeIdxMap`, `enderecoKey`, `teamColor`, `buildRouteMapSvg` — all unchanged signatures.
- Produces: `buildTeamPanel(group, enderecos, colorIndex)` → same return type (HTML string), now omitting LIVRE cards/rows and the Zonas: line. `buildDayGrid(groups, lab, enderecos)` → same return type, open-only marks render `<td class="sem-slot"></td>`.

- [ ] **Step 1: Write the failing tests for `buildTeamPanel`**

Create `tests/agenda-day-guide-team-panel.test.js`:

```js
import { describe, test, expect } from 'bun:test';

await import('../extension/common/sigc-common.js');
await import('../extension/features/agenda-day-guide/agenda-day-guide.js');

const { buildTeamPanel } = window.__sigcPro.dayGuide;

function row({
  reservado = true, horaInicio = '09:00', horaFim = '09:30',
  nome = 'Fulano de Tal', controle = 'C1', domicilio = 'D1', zonas = '',
} = {}) {
  return { reservado, horaInicio, horaFim, nome, controle, domicilio, zonas, equipe: 'A' };
}

describe('buildTeamPanel — LIVRE cards removed', () => {
  test('a team with only open slots produces no cards at all', () => {
    const group = { equipe: 'Equipe A', rows: [row({ reservado: false, zonas: '29_A' })] };
    const html = buildTeamPanel(group, null, 0);
    expect(html).not.toContain('LIVRE');
    expect(html).not.toContain('livre-edge');
    expect(html).not.toContain('class="card livre"');
  });

  test('a team mixing reserved and open slots shows only the reserved card', () => {
    const group = {
      equipe: 'Equipe A',
      rows: [
        row({ reservado: false, horaInicio: '08:00', horaFim: '08:30', zonas: '29_A' }),
        row({ reservado: true, horaInicio: '09:00', controle: 'C1', domicilio: 'D1' }),
        row({ reservado: false, horaInicio: '10:00', horaFim: '10:30', zonas: '29_A' }),
      ],
    };
    const html = buildTeamPanel(group, null, 0);
    expect(html).not.toContain('LIVRE');
    expect(html).not.toContain('livre-edge');
    expect(html).toContain('RESERVADO');
    expect(html).toContain('C1');
  });

  test('the Zonas: summary line never appears, even with distinct zonas across rows', () => {
    const group = {
      equipe: 'Equipe A',
      rows: [
        row({ reservado: true, controle: 'C1', domicilio: 'D1' }),
        row({ reservado: false, horaInicio: '08:00', horaFim: '08:30', zonas: '29_A 29_B' }),
      ],
    };
    const html = buildTeamPanel(group, null, 0);
    expect(html).not.toContain('Zonas:');
    expect(html).not.toContain('class="zonas"');
  });

  test('a fully-reserved team still renders its card(s) normally', () => {
    const group = { equipe: 'Equipe A', rows: [row({ reservado: true, controle: 'C1', domicilio: 'D1' })] };
    const html = buildTeamPanel(group, null, 0);
    expect(html).toContain('RESERVADO');
    expect(html).toContain('C1');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/agenda-day-guide-team-panel.test.js`
Expected: FAIL — `buildTeamPanel` currently still emits LIVRE rows/cards and the Zonas: line.

- [ ] **Step 3: Fix `buildTeamPanel`**

Replace the current function body (lines 533-589) with:

```js
  function buildTeamPanel(group, enderecos, colorIndex) {
    const e = escapeHtml;
    const s = computeStats(group.rows);
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
    const seqMap = stopSequenceMap(group.rows, enderecos);
    const idxMap = routeIdxMap([{ rows: group.rows }], enderecos);
    const color = teamColor(colorIndex);
    // Only reserved visits render as cards — open (LIVRE) slots are not
    // shown at all, per design decision 2026-08-06.
    const cards = group.rows.filter((r) => r.reservado).map((r) =>
      buildSlotCard(r, enderecos, seqMap, color, routeGroupId, defaultChecked, idxMap.get(enderecoKey(r)))
    );
    const teamMap = enderecos
      ? buildRouteMapSvg(
          [{ rows: group.rows.filter((r) => r.reservado), color: teamColor(colorIndex) }],
          enderecos, 480, 320, routeGroupId
        )
      : '';
    // Bare link placeholder (no checkbox list — checkboxes now live on
    // each card above). Sits right before the SVG map so the live link
    // and the visual route it feeds are next to each other.
    const rotaLink = `<div class="rota-link" id="rota-link-${e(routeGroupId)}"></div>`;
    return [
      `<h2>${e(group.equipe)}</h2>`,
      `<div class="teamstats">${statBits}</div>`,
      ...cards,
      rotaLink,
      teamMap,
    ].filter(Boolean).join('\n');
  }
```

(Note: `zonasUnion`, `buildLivreEdgeRow`, and the `first`/`last`/`edge`
index logic are no longer called from here. Before deleting the
`zonasUnion` and `buildLivreEdgeRow` function definitions themselves,
run `grep -n "zonasUnion(\|buildLivreEdgeRow("
extension/features/agenda-day-guide/agenda-day-guide.js` — if the only
matches left are the function definitions themselves (no other call
site), delete both function definitions as dead code. If grep turns up
another caller you didn't expect, leave them defined and note it in
your report instead of deleting.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/agenda-day-guide-team-panel.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing tests for `buildDayGrid`**

In `tests/agenda-day-guide-lab-grid.test.js`, replace the existing test
at line 154-159:

```js
  test('open slots still render LIVRE, not a name row', () => {
    const g = [{ equipe: 'Equipe A', rows: [row({ reservado: false })] }];
    const html = buildDayGrid(g, true);
    expect(html).toContain('LIVRE');
    expect(html).not.toContain('grid-nome');
  });
```

with:

```js
  test('open slots render as a blank sem-slot cell, not LIVRE', () => {
    const g = [{ equipe: 'Equipe A', rows: [row({ reservado: false })] }];
    const html = buildDayGrid(g, true);
    expect(html).not.toContain('LIVRE');
    expect(html).not.toContain('grid-nome');
    expect(html).toContain('class="sem-slot"');
  });

  test('a mark mixing one reserved and one open slot for the same team shows only the reserved content', () => {
    const g = [{
      equipe: 'Equipe A',
      rows: [
        row({ reservado: true, horaInicio: '09:05', controle: '2927408000123', domicilio: 'D1' }),
        row({ reservado: false, horaInicio: '09:20' }),
      ],
    }];
    const html = buildDayGrid(g, true);
    expect(html).not.toContain('LIVRE');
    expect(html).toContain('SALVADOR - BA');
  });
```

(The second test relies on both rows' start times — 09:05 and 09:20 —
rounding into the same 09:00 half-hour mark, matching this file's
existing `row()` fixture defaults and `municipioFromControle` behavior
already exercised elsewhere in this test file.)

- [ ] **Step 6: Run tests to verify they fail**

Run: `bun test tests/agenda-day-guide-lab-grid.test.js`
Expected: FAIL — `buildDayGrid` currently renders `LIVRE` text for open
slots instead of `sem-slot`, and the mixed-mark test would currently
show both a name row and a LIVRE line joined by `<br>`.

- [ ] **Step 7: Fix `buildDayGrid`**

In the per-mark cell-building block (currently lines 664-704 inside
`buildDayGrid`), change:

```js
      const cells = groups.map((g) => {
        const slots = g.rows.filter((r) => {
          const s = window.__sigcPro.toMin(r.horaInicio);
          return s != null && s - (s % 30) === t;
        });
        if (!slots.length) return '<td class="sem-slot"></td>';
        const conteudo = slots.map((r) => {
          const hora = `<span class="grid-hora">${e(r.horaInicio)}</span>`;
          if (!r.reservado) return `${hora} <span class="grid-livre">LIVRE</span>`;
```

to:

```js
      const cells = groups.map((g) => {
        // Open (non-reservado) slots are dropped from the grid entirely —
        // a mark whose only matches are open renders identically to a
        // mark with no slot at all for this team. A mark mixing reserved
        // and open slots (two starts rounding into the same half-hour)
        // shows only the reserved content.
        const slots = g.rows.filter((r) => {
          const s = window.__sigcPro.toMin(r.horaInicio);
          return s != null && s - (s % 30) === t && r.reservado;
        });
        if (!slots.length) return '<td class="sem-slot"></td>';
        const conteudo = slots.map((r) => {
          const hora = `<span class="grid-hora">${e(r.horaInicio)}</span>`;
```

(This removes the `if (!r.reservado) return ...LIVRE...` branch by
filtering it out upstream instead — `slots` now only ever contains
reserved rows, so every remaining `r` inside `conteudo`'s map is
reserved, matching the rest of that block's existing logic unchanged.)

- [ ] **Step 8: Run tests to verify they pass**

Run: `bun test tests/agenda-day-guide-lab-grid.test.js`
Expected: PASS, all tests in this file green (including the two new/
rewritten ones and every pre-existing test in the file, e.g. the
"shows the ID alone when both ID and name are present" zona tests,
which don't touch the reservado filter and must stay unaffected).

- [ ] **Step 9: Run the full test suite**

Run: `bun test`
Expected: PASS, all suites green. In particular
`tests/agenda-day-guide-route-selector.test.js`'s `LIVRE row: no
checkbox at all, unaffected by routeGroupId/checked` test (which calls
`buildSlotCard` directly, not through `buildTeamPanel`) must still
pass unchanged — confirming `buildSlotCard`'s own LIVRE branch was
correctly left alone per the Global Constraints.

- [ ] **Step 10: Run the privacy gate**

Run: `bash scripts/check-privacy.sh`
Expected: `privacy gate: CLEAN` — this task touches no network code.

- [ ] **Step 11: Commit**

```bash
git add extension/features/agenda-day-guide/agenda-day-guide.js tests/agenda-day-guide-team-panel.test.js tests/agenda-day-guide-lab-grid.test.js
git commit -m "feat: hide LIVRE cards and the Zonas: line from the day guide"
```

---

## Manual Verification (post-implementation, live server)

1. On the Agenda Dia view, generate "Guia do Dia" for a day with a mix
   of reserved and open slots.
2. Confirm each team tab shows only reserved-visit cards — no dashed
   "LIVRE" cards, no slim livre-edge rows, and no "Zonas: ..." line
   under the team stats.
3. Confirm the Resumo and Lab tabs' hora×equipe grid shows blank cells
   (matching the styling of marks with no slot at all) for any
   half-hour mark that only had open slots for a given team.
4. Confirm the "Slots livres: N" stat and occupancy percentage in the
   summary table are unchanged (still counting open slots numerically).
