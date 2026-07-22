# Guia do Dia — merge route checkbox onto visit cards (team panels) — design

2026-07-22. Status: approved, pre-implementation.

## Amendment to

[2026-07-22-agenda-day-guide-dynamic-route-design.md](2026-07-22-agenda-day-guide-dynamic-route-design.md)
(the dynamic route selector, already shipped). That spec's "Layout
placement" section put each team's checkbox list in a standalone block
above the cards. This amends team panels only: the checkbox moves onto
each `buildSlotCard`, and the standalone list disappears from team
panels. Every other decision in the original spec — cap enforcement,
live link logic, default-checked rules, coordinate data via `data-*`
attributes, Resumo's behavior — is unchanged and still governs.

## Purpose

Today a team panel shows two separate things: a checkbox list (one
route-selector block above the cards) and the cards themselves (one per
slot, already showing name/Controle/Dom/Zona). A user has to look
up/down between the list and the cards to know which checkbox
corresponds to which visit. Putting the checkbox directly on its card
removes that cross-referencing.

## Scope

- **Team panels** (`buildTeamPanel` / `buildSlotCard`): the standalone
  checkbox list above the cards is removed. Each reserved slot's own
  card gets a checkbox.
- **Resumo panel** (`buildSummaryPanel`): **unchanged**. It has no
  per-visit cards (only the day grid table), so its combined "Rota do
  dia" checkbox list stays exactly as shipped.
- **Lab tab**: unchanged, as before — no route selector.
- The live link's target (a `rota-link` placeholder div) moves too: from
  above the cards to immediately before the team's SVG route map, at the
  bottom of the panel. The link's own behavior (visibility rule, cap
  enforcement, URL building) does not change.

## Checkbox placement on the card

Inside `buildSlotCard`'s `.hora` line, **before the time**, for reserved
rows only:

```
☐ 09:00–09:30  [2]  RESERVADO
```

Open (LIVRE) rows get no checkbox — unchanged from today, where open
rows were never part of the route selector either.

## Non-routable reserved rows (no coordinates)

Today's standalone list renders these as a disabled, unchecked row with
a "sem coordenadas" note. On the card, the same visit becomes a
disabled, unchecked checkbox in the same `.hora`-line position — no
extra note text, since the card already omits the "abrir no mapa" link
for coordinate-less visits, which is the existing signal for "no map
data here." This keeps the checkbox slot present at a consistent
position across every reserved card (routable or not), so the user
never wonders why one card's checkbox is simply absent.

## Data flow / interfaces

- `buildSlotCard` gains two parameters:
  `buildSlotCard(r, enderecos, seqMap, color, routeGroupId, checked)`.
  - `routeGroupId`: same `team-<colorIndex>` string used today —
    unchanged meaning, just now threaded one level deeper.
  - `checked`: boolean, the per-row default-checked state. Only takes
    effect for routable reserved rows; non-routable reserved rows always
    render unchecked+disabled regardless of `checked`'s value, and
    LIVRE rows render no checkbox at all regardless of `checked`'s
    value.
  - For non-reserved (LIVRE) rows `routeGroupId`/`checked` are unused
    (no checkbox rendered).
- `buildRouteSelector`'s checkbox-`<label>`-building logic (attributes:
  `class="route-chk"`, `data-group`, `data-lat`, `data-lon`,
  `data-name`, escaping, disabled/non-routable handling) is extracted
  into a small shared helper so `buildSlotCard` and `buildRouteSelector`
  (still used by Resumo) do not duplicate that logic. `buildRouteSelector`
  itself keeps its existing signature and behavior — Resumo's call site
  requires no changes.
- `buildTeamPanel`:
  - Keeps computing `routableCount` and `defaultAllChecked` exactly as
    today (`routableCount <= 9`).
  - No longer calls `buildRouteSelector` to build a checkbox list.
    Instead passes `routeGroupId` and each row's `checked` value
    (`defaultAllChecked` when the row is routable; irrelevant/unused
    otherwise) into `buildSlotCard` when building `cards`.
  - Emits a bare link placeholder,
    `<div class="rota-link" id="rota-link-team-<colorIndex>"></div>`,
    with no surrounding `.route-selector`/checkbox markup, positioned
    immediately before `teamMap` (the SVG route map) in the panel's
    returned HTML — replacing the old `routeSelector` slot above the
    cards.

## Inline `<script>` (live link, cap enforcement)

**No changes.** The script (added in the original feature, Task 5)
already locates checkboxes via `.route-chk[data-group="<id>"]`
(`querySelectorAll`) and the link target via
`#rota-link-<id>` (`getElementById`) — both independent of where in the
DOM those elements physically sit. Cap enforcement, the 9-stop limit,
link visibility thresholds, and the standalone `gmapsRouteUrl` copy are
all unaffected by this change.

## CSS

- `.route-selector`, `.route-item`, `.route-item-missing` stay in the
  stylesheet unchanged — Resumo still uses them.
- `.rota-link` stays unchanged (still the link's container, wherever it
  sits).
- New: a small rule so the checkbox aligns cleanly at the start of the
  `.hora` line (e.g. `margin-right`), reusing the existing `.route-chk`
  class already used for cap/link script targeting — no new class
  needed purely for card placement, but a `.hora .route-chk` rule scopes
  the spacing rule to this specific context without affecting Resumo's
  list-item checkboxes.

## Print / `file://`

No new constraints beyond what the original feature already committed
to (single inline script, works offline, prints cleanly). Checkbox
position moving from a standalone block to inline on each card is a
pure layout change — same elements, same script, different DOM parent.

## Not in scope

- Any change to Resumo's layout, behavior, or checkbox list.
- Any change to cap enforcement, live-link URL building, or default
  fully-checked/unchecked rules — those are inherited unchanged from the
  original spec.
- Any change to the SVG route map itself (still static, still shows the
  full team regardless of checkbox state, per the original spec's "Not
  in scope").
- Lab tab.

## Testing

- Extend the existing route-selector test file
  (`tests/agenda-day-guide-route-selector.test.js`) or add a
  `buildSlotCard`-focused one: routable reserved row gets an enabled
  checkbox with correct `data-*` attributes at the expected
  `checked`/unchecked default; non-routable reserved row gets a
  disabled, unchecked checkbox; LIVRE rows get no checkbox.
  `buildTeamPanel`-level test: `<=9`/`>9` default-checked threshold
  still holds, now expressed per-card instead of per-list-item; old
  `.route-selector`/`.route-item` markup no longer appears in a team
  panel's output; the `rota-link` div still exists, now positioned
  immediately before the SVG map's markup instead of before the cards.
- Resumo's existing tests (`buildSummaryPanel` route selector wiring)
  should require no changes — confirms the amendment is correctly
  scoped to team panels only.
- Manual field test on live Dia view: confirm each card's checkbox
  reflects/drives the same live link and cap behavior as before,
  confirm the link now renders just above the team's route map, confirm
  print layout still looks reasonable with the checkbox inline on the
  card's header line.
