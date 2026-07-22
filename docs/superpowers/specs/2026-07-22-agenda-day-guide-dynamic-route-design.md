# Guia do Dia — dynamic route selection — design

2026-07-22. Status: approved, pre-implementation.

## Purpose

Today's "Rota" links in the Guia do Dia are pre-baked: every reserved,
geocoded visit on a team is included, split into fixed Google Maps legs
of up to 9 waypoints. The user can't drop a stop (a cancelled visit, a
detour) without editing the URL by hand. This adds a checkbox per stop
so the user picks which visits go into the route, with the Google Maps
link updating live as they check/uncheck.

## Amendment to the original design

The original Guia do Dia spec
([2026-07-16-agenda-day-guide-design.md](2026-07-16-agenda-day-guide-design.md))
states the output has **"No JS"** — CSS-only tabs, so the file works
even where scripts are blocked. This feature reverses that constraint:
the guide now ships one inline `<script>` block, added once near
`</body>`. It stays self-contained (no external refs, no network) and
still opens correctly from `file://` and prints correctly — only
environments that block inline scripts entirely lose the live route
links (the rest of the guide, including the checkboxes' checked state,
still renders and still prints).

## Scope

- **Team panels** (`buildTeamPanel`): the existing auto-built "Rota:"
  link is replaced by a checkbox per reserved+geocoded stop plus a
  single live route link. Scoped to that team only.
- **Resumo panel** (`buildSummaryPanel`): new "Rota do dia" section —
  today Resumo has no route link at all. Checkbox per reserved+geocoded
  stop across *all* teams combined, time-ordered, plus one live
  combined route link.
- **Lab tab**: unchanged — no route selector, consistent with it never
  getting a map today.
- Resumo's selection and each team's selection are **fully independent
  state** — checking a stop in one never affects its checkbox elsewhere.
  No cross-group syncing.

## Coordinate data reaching the script

The inline `<script>` cannot call back into the extension's build-time
closures — it only has the DOM it's handed. Each checkbox's `<input>`
carries its stop's coordinates and label as `data-*` attributes
(`data-lat`, `data-lon`, `data-name`), read by the `change` handler to
rebuild the group's URL. No separate JS array literal — the DOM is the
only data source, keeping each checkbox self-describing.

## Stop eligibility and non-routable stops

A reserved visit with no coordinates still gets a row in its route
selector: a **disabled, unchecked checkbox** labeled with its time/name
plus a "sem coordenadas" note, consistent with the SVG map's existing
handling of coordinate-less visits. This keeps the selector's row count
matching the panel's card count — nothing silently missing with no
explanation. These rows are permanently excluded from the 9-cap count
and from the route link; they can never become checked.

## Cross-team order (Resumo only)

Resumo's combined selector lists stops in **original row order** — the
order `readAgendaSlots()` / `groupByEquipe()` already produce (teams in
name order, each team's own rows in time order) — not a global re-sort
by `horaInicio`. This is a stable, already-available order requiring no
new sort/tiebreak logic; two stops that happen to share a `horaInicio`
across different teams keep their teams' relative (name-sorted) order.

## Layout placement

The checkbox list + live route link render as one standalone block
where the old auto-built "Rota:" line was — above the cards on team
panels, and as Resumo's new "Rota do dia" section (placed before "Mapa
do dia"). Cards themselves are untouched; checkboxes are not
interleaved into them.

## gmapsRouteUrl: intentional duplication

The build-time `gmapsRouteUrl` (used for each visit's static "abrir no
mapa" pin) is unchanged and stays build-time. The live route link uses
a small standalone copy of the same URL-building logic written directly
in the inline `<script>`. Two copies of a stable, rarely-changing URL
format is an accepted tradeoff against the added complexity of routing
every static per-visit pin through the runtime script.

## Stop cap: 9, no more chunking

`chunkRoute` (splits a route into multiple Google Maps legs when a team
has more than 9 waypoints) is **removed**. Every route selector — team
or Resumo — is capped at 9 checked stops, producing exactly one Google
Maps link (or none, below 2 checked). There is no multi-leg fallback
for larger selections; the user manages the cap themselves via the
checkboxes.

## Default checkbox state

- **Resumo "Rota do dia"**: always starts with **nothing checked**,
  regardless of how many stops exist. The combined day route is
  always an intentional, opt-in selection.
- **Team panels**: unchanged from today's implicit behavior —
  - reserved+geocoded stop count ≤ 9 → **all checked** by default,
    matching today's auto-route (the link itself only appears once ≥ 2
    are checked, same as today's ≥ 2 rule below).
  - reserved+geocoded stop count > 9 → **none checked** by default
    (today this case auto-chunked into multiple legs; chunking is
    gone, so the user must pick their own ≤9 stops).

## Cap enforcement

Each selector group (one team, or Resumo) enforces its own 9-stop cap
live:

- While fewer than 9 boxes in the group are checked, all boxes in that
  group are enabled.
- The moment a 9th box is checked, every other unchecked box in that
  group becomes `disabled` (visually greyed out).
- The moment the checked count drops back below 9 (any box unchecked),
  all of that group's boxes are re-enabled.
- No error message or alert — the disabled state is the only feedback,
  matching the guide's existing quiet, no-popup style.

## Live route link

Per selector group:

- 0–1 checked stops → route link hidden/blank (matches today's "only
  shown when ≥ 2 reserved visits have coordinates" rule).
- 2–9 checked stops → one `<a>` link, built from the checked stops in
  their original time order, using the same URL shape as today's
  `gmapsRouteUrl` (all but the last checked stop become `waypoints`,
  the last becomes `destination`). This URL-building logic is ported
  into the inline `<script>` as plain JS (the generated file has no
  access to the extension's closures at open time).
- Recomputed on every checkbox `change` event within that group only.

## Not in scope

- Syncing Resumo's selection with any team tab's selection, or vice
  versa.
- Live-updating the per-team/day SVG route maps as boxes are
  toggled — those stay static, still showing the full team/day as
  today. Only the Google Maps `<a>` link is dynamic.
- Lab tab changes.
- Any change to which stops are *checkable* (still: reserved visits
  with non-null coordinates from the `enderecos` join — coordinate-less
  reserved visits appear only as disabled, informational rows, per
  "Stop eligibility and non-routable stops" above).

## Testing

- Pure builders (`buildRouteSelector` HTML fragment, checkbox
  checked/disabled defaults for the ≤9/>9 team cases, Resumo's
  always-empty default, non-routable stops rendering
  disabled-with-note) covered by a new bun test file for this feature
  (no existing day-guide test file to extend — none currently exists).
- The inline script's URL-building function extracted as a small pure
  function within the script for the cap/link logic to stay testable
  in isolation before inlining, if practical; otherwise manual
  verification.
- Manual field test on live Dia view before commit: check/uncheck
  stops on a team tab and on Resumo, confirm the link updates and the
  cap disables boxes at 9, in Chrome.
