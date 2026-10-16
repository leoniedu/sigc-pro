# Guia do Dia: hide LIVRE cards and the Zonas: list — design

2026-08-06. Status: approved direction, pre-implementation.

## Purpose

Simplify the Guia do Dia's team-panel tabs and hora×equipe grid to show
only reserved visits — open (LIVRE) slots and the per-team "Zonas: A, B,
C" summary line are noise the user no longer wants on the printed guide.
Numeric stats (occupancy %, "Slots livres: N") are untouched — this is a
display change, not a data change.

## Scope

Three call sites, confirmed during design:

1. **Team-panel cards** (`buildTeamPanel`) — currently every row
   (reserved or open) becomes either a slim `buildLivreEdgeRow` (open
   slots before the first / after the last visit) or a full
   `buildSlotCard` (reserved visits, and open slots *between* two
   visits, shown at full weight as route information). All LIVRE
   variants go away; only reserved visits render as cards.
2. **Team `Zonas:` summary line** (`buildTeamPanel`, right after the
   stats line) — removed entirely, along with the `zonasUnion` call
   that feeds it.
3. **Hora×equipe grid** (`buildDayGrid`, both the Resumo and Lab
   variants) — a mark whose only slots are open renders as a blank
   `sem-slot` cell, identical to a mark with no slot at all for that
   team. A mark with a MIX of reserved and open slots (two slots'
   start times can round into the same 30-minute mark) shows only the
   reserved slot(s); the open one is simply dropped from that cell's
   content, never contributing empty markup.

## Out of scope

- `buildSlotCard` itself is unchanged — it still has a LIVRE-rendering
  branch (`!r.reservado`), used by existing tests
  (`tests/agenda-day-guide-route-selector.test.js`). Nothing calls that
  branch anymore after this change (team panels only pass reserved rows
  in), but the branch stays — removing it isn't required by the ask and
  keeps `buildSlotCard` a general-purpose function rather than one
  quietly assuming its caller pre-filters.
- Numeric stats are untouched: `computeStats`'s `livres` count, the
  team-panel stat line's "N livre(s)", the summary table's "Slots
  livres" row, and the grid's `Livres`/`Ocupação` footer rows all stay
  exactly as they are.
- `zonaLabel`/`zonaFullLabel` (per-visit zona shown on a reserved card's
  `ids` line, and per-cell `Zona:` in the grid) are a different feature
  entirely — untouched. Only the per-team *summary* "Zonas: A, B, C"
  line goes away.
- `buildRouteSelector`, `stopSequenceMap`, `routeIdxMap`,
  `buildRouteMapSvg` already filter to reserved rows only — no change
  needed there.
- The `.livre-edge`, `.badge-livre`, `.card.livre`, `table.grid
  .grid-livre` CSS rules become dead (no HTML ever gets those classes
  again) but are left in the stylesheet — pruning unused CSS is a
  separate cleanup, not part of this ask.

## Implementation shape

- `buildTeamPanel`: the `cards` array becomes
  `group.rows.filter((r) => r.reservado).map((r, i) => buildSlotCard(...))`.
  The `first`/`last`/`edge` index-finding logic (only needed to decide
  slim-edge-row vs. full-card for open slots) is removed as dead code.
  `seqMap`/`idxMap` (route sequencing) are computed from `group.rows` as
  today — they already only assign sequence numbers to routable
  *reserved* rows internally, so filtering the `cards` list doesn't
  change their numbering.
- `buildTeamPanel`: drop the `zonas`/`zonasUnion` line and its
  conditional render.
- `buildDayGrid`: the per-mark `slots` array (rows whose rounded start
  falls in this mark) gets reserved-filtered before building `conteudo`:
  if the reserved-only subset is empty, render `<td
  class="sem-slot"></td>`; otherwise build `conteudo` from that
  subset only (dropping the existing `!r.reservado` branch that
  produces the LIVRE text).

## Testing

- `tests/agenda-day-guide-lab-grid.test.js`: `open slots still render
  LIVRE, not a name row` (line 154) is rewritten to assert the
  opposite — a team with only an open slot in a mark renders
  `sem-slot`, no `LIVRE` text, no `grid-nome`.
- New coverage for `buildTeamPanel`: a team with only open slots
  produces no cards at all (empty output, not even a livre-edge row); a
  team mixing reserved and open slots shows only the reserved card(s);
  the `Zonas:` line never appears regardless of how many distinct
  zonas the team's rows would have produced.
- New coverage for `buildDayGrid`: a mark with only an open slot for a
  team renders identically to a mark with no slot for that team
  (`sem-slot`, no content); a mark mixing one reserved and one open
  slot for the same team shows only the reserved slot's content.
- Existing `tests/agenda-day-guide-route-selector.test.js` LIVRE-row
  test (line 267, exercises `buildSlotCard` directly, not through
  `buildTeamPanel`) is unaffected — `buildSlotCard`'s own LIVRE branch
  is out of scope, per above.
