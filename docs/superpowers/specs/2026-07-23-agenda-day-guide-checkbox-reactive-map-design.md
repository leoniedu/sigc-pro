# Guia do Dia — checkbox-reactive SVG route map — design

2026-07-23. Status: approved, pre-implementation.

## Amendment to

[2026-07-22-agenda-day-guide-dynamic-route-design.md](2026-07-22-agenda-day-guide-dynamic-route-design.md)
(the checkbox route selector, already shipped) and
[2026-07-18-agenda-day-route-map-design.md](2026-07-18-agenda-day-route-map-design.md)
(the original SVG route map). The dynamic-route spec's "Not in scope"
section explicitly deferred this: *"Live-updating the per-team/day SVG
route maps as boxes are toggled — those stay static... Only the Google
Maps `<a>` link is dynamic."* This spec picks that up. Every other
decision in both prior specs — cap enforcement, live link logic,
default-checked rules, checkbox placement on cards, Resumo's always-
unchecked default — is unchanged and still governs.

## Purpose

The route checkboxes already drive a live Google Maps link. The SVG map
next to them (team panel's own map, and Resumo's combined "Mapa do
dia") stays static regardless of what's checked — it always shows every
routable stop, giving no visual confirmation of which stops are
actually in the route the link will open. This makes the map reflect
the same checkbox state the link already does.

## Scope

- **Team panels**: the team's own map (`buildRouteMapSvg` called with
  that team's reserved rows) redraws as its checkboxes change.
- **Resumo panel**: the combined "Mapa do dia" (`buildRouteMapSvg`
  called with every team's reserved rows, one color per team) redraws
  as the Resumo "Rota do dia" checkboxes change.
- **Lab tab**: unchanged — no map, no checkboxes, untouched.
- No change to cap enforcement, the live link's URL-building, or any
  default-checked rule — this spec only adds a map redraw alongside
  the link update already happening in `refreshGroup`.

## What redraws, and what doesn't

The map's projection, scale, dot positions, and sequence numbers are
computed once at build time and **never change** — no rescaling, no
re-projection, no renumbering. Only two things change on a checkbox
toggle:

1. **Dot opacity.** A stop's dot (circle + its two text labels: the
   sequence number and the time) drops to reduced opacity when its
   checkbox is unchecked, and returns to full opacity when checked.
   Color is untouched — a dimmed dot keeps its team's color, just
   fainter.
2. **The connecting line's shape.** The polyline is rebuilt to pass
   only through checked stops' dots, in their existing time order.
   Unchecked stops' dots are skipped entirely — they sit at their
   fixed position, dimmed, but the line does not visit them. Below 2
   checked stops, no line is drawn at all (same threshold as the link's
   own "hidden below 2 checked" rule).

Sequence numbers shown inside each dot are **never renumbered** — dot
"5" is always "5," whether checked or not, matching the fixed number
already printed on that visit's card (`stopSequenceMap`). This keeps
the card-to-dot correspondence stable regardless of checkbox state.

The "N visita(s) sem coordenadas" note below the map, the scale bar,
the north arrow, and (on Resumo) the color legend are **all unaffected**
— none of them relate to which routable stops are currently checked.

## Resumo: one polyline, not one per team

Today's Resumo map draws one polyline per team (one line per color).
This spec **replaces that with a single polyline** spanning every
currently-checked stop across all teams, in time order — matching the
single combined Google Maps link Resumo's "Rota do dia" already
produces. Dots keep their per-team color (still useful, and the legend
stays meaningful); the single combined line uses one neutral color
(dark grey) since it no longer belongs to any one team.

Team panels only ever have one team/one color to begin with, so this
change is invisible there: a team panel's polyline keeps that team's
own color, unaffected by Resumo's shift to a neutral line.

## Data attributes reaching the script

The inline `<script>` has no access to build-time closures (same
constraint the original spec already worked around for the URL-
building logic). To let it match a checkbox to its dot and rebuild the
line, both gain new `data-*` attributes:

- Each stop's dot elements (`<circle>` + its two `<text>` labels) are
  wrapped in a `<g data-idx="N" data-x="..." data-y="...">`, where `N`
  is a **single running counter across the whole map call**, assigned
  in the same flattened order `allPoints`/`projected` already use
  internally (`buildRouteMapSvg` iterates `rowSets` in order, and each
  set's `plottable` stops in their existing time order) — `N` does
  **not** reset per rowSet. This is a join key, **not** a coordinate —
  no float-formatting risk.
  - `data-x`/`data-y` are the dot's already-computed pixel coordinates
    (the same values used for `cx`/`cy`), so the script can rebuild
    the polyline's `points` without re-deriving any projection math.
  - No `data-team`/color-related attribute is added — dot color is
    already baked into the `<circle>`'s `fill` at build time, and (per
    the single-polyline decision above) the script never needs to know
    which team a dot belongs to.
  - The dot's **visible sequence number** (the digit drawn inside the
    circle, `stopSequenceMap`-derived, restarting at 1 per rowSet) is
    unrelated to `data-idx` and stays exactly as it is today — `data-idx`
    is a script-only join key, never rendered.
- Each routable checkbox gains a matching `data-idx="N"` attribute
  (alongside its existing `data-group`/`data-lat`/`data-lon`/
  `data-name`), where `N` uses the **identical flattened, cross-team
  running-counter scheme**: for a team panel (`buildTeamPanel`, one
  rowSet) this is simply the routable position within that team, same
  as today's per-set map numbering. For Resumo (`buildSummaryPanel`,
  one rowSet per team, combined into one flat checkbox list via
  `groups.flatMap((g) => g.rows)`), `N` must walk teams and their rows
  in the exact same order `buildRouteMapSvg`'s rowSets/plottable arrays
  do — both call sites already iterate `groups` in the same order, so
  a shared counting pass (e.g. a small helper both call, or the two
  call sites' loops kept in lockstep) is required so checkbox
  `data-idx="7"` and dot `data-idx="7"` always refer to the same stop,
  even when it's the 2nd stop of the 3rd team.
- The polyline itself gets a stable `id="route-line-<groupId>"` (same
  `<groupId>` namespacing already used for `data-group` and
  `rota-link-<groupId>`), so the script can target it directly.

## Script change

`refreshGroup(groupId)` (the existing function that already updates the
live link and enforces the cap) gains a new step, run unconditionally —
**before** its existing early return for `< 2` checked (that early
return only ever affected the link; the map must still update
regardless of link visibility):

1. Collect the group's checked boxes' `data-idx` values into a set.
2. For every `<g data-idx>` belonging to that group's map, toggle a
   `route-stop-dim` class depending on whether its `data-idx` is in
   the checked set.
3. Rebuild `#route-line-<groupId>`'s `points` attribute from the
   checked `<g>` elements' `data-x`/`data-y`, ordered by `data-idx`
   (already time order) — or clear/hide the line entirely below 2
   checked stops.

No new event listener — this is an addition to `refreshGroup`'s
existing body, so it fires on every `change` event already wired, and
once per group on initial page load (since `refreshGroup` already runs
once per group at load to paint the link's initial state).

## CSS

One new rule: `.route-stop-dim { opacity: .35; }`, applied to the `<g>`
wrapper so it cascades to the circle and both text labels in one
attribute change per stop.

## Print / `file://`

No new constraints beyond what the original feature already committed
to. The map's dimmed/full-opacity state and rebuilt line are live DOM
state at the moment of printing or reopening via `file://` — same as
the checkboxes' own checked state and the link's current href, which
already print/reopen correctly today.

## Not in scope

- Any change to the map's projection, scale bar, north arrow, or
  the color legend.
- Any change to cap enforcement or the live link's URL-building logic.
- Renumbering sequence numbers to route order.
- Lab tab (still no map).
- Re-fetching or re-deriving coordinates — this is a pure client-side
  redraw of already-rendered SVG elements.

## Testing

- Extend `tests/agenda-day-guide-route-selector.test.js`:
  `buildRouteMapSvg`-focused tests confirming each stop's `<g
  data-idx="N" data-x="..." data-y="...">` wrapper is present and `N`
  matches the routable-stop position; the polyline carries
  `id="route-line-<groupId>"`; Resumo's combined map produces exactly
  one polyline (not one per team) while team-panel maps keep their
  team's own line color.
  `buildRouteSelector`/`buildSlotCard`-focused tests confirming each
  routable checkbox's `data-idx` matches its corresponding dot's
  `data-idx` for the same stop, across both team-panel and Resumo call
  sites.
- Mirror-test the redraw's dot-dimming and line-rebuilding logic
  standalone in the test file (same documented pattern already used
  for `buildGmapsUrl`/cap-enforcement mirroring, since happy-dom does
  not reliably execute inline `<script>` tags), pinning: dimming toggles
  correctly based on `data-idx` set membership; the rebuilt line's
  points come only from checked stops, in `data-idx` order; below 2
  checked, the line is cleared.
- Manual field test on live Dia view before commit: check/uncheck
  stops on a team tab and confirm its map's dots dim/undim and the line
  reroutes; same on Resumo, confirming a single grey line spans
  checked stops across teams while dots keep their team colors; Ctrl+P
  a tab with some stops unchecked and confirm the printed map reflects
  the same dimmed/undimmed state visible on screen; reopen the
  downloaded `.html` via `file://` and confirm toggling still redraws
  the map there.
