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
  - reserved+geocoded stop count ≤ 9 → **all checked** by default
    (route link shows immediately, matching today's auto-route).
  - reserved+geocoded stop count > 9 → **none checked** by default
    (today this case auto-chunked into multiple legs; chunking is
    gone, so the user must pick their own ≤9 stops).

## Cap enforcement

Each selector group (one team, or Resumo) enforces its own 9-stop cap
live:

- While fewer than 9 boxes in the group are checked, all boxes in that
  group are enabled.
- The moment a 9th box is checked, every other unchecked box in that
  group becomes `disabled` (visually greyed out) until the user
  unchecks one.
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
- Any change to which stops are eligible (still: reserved visits with
  non-null coordinates from the `enderecos` join).

## Testing

- Pure builders (`buildRouteSelector` HTML fragment, checkbox
  checked/disabled defaults for the ≤9/>9 team cases, Resumo's
  always-empty default) mirrored in a bun scratch test, same pattern
  as the existing day-guide tests.
- The inline script's URL-building function extracted as a small pure
  function within the script for the cap/link logic to stay testable
  in isolation before inlining, if practical; otherwise manual
  verification.
- Manual field test on live Dia view before commit: check/uncheck
  stops on a team tab and on Resumo, confirm the link updates and the
  cap disables boxes at 9, in Chrome.
