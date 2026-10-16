# Mapa: status-colored markers, zona hulls, Controle labels — design

2026-08-09. Status: approved direction, pre-implementation.
Prereq reading: `2026-08-08-ultimo-movimento-mapa-design.md` (the base
Mapa/Zonas feature this extends).

## Purpose

The shipped Mapa tab colors every domicílio marker by zona and shows
status (tipo de entrevista, última posição) only inside each marker's
popup, on click. A survey manager scanning the map for "where are the
recusas," "which units are still inactive," or "which Controle is this"
currently has to click every marker one at a time — there's no
at-a-glance visual signal for any of that.

This adds three independent visual layers on top of the existing map,
each answering one of those questions without a click:

1. **Marker color = status**, not zona (Recusa/Realizada/Não
   Iniciada/Fechado/inactive/outros — a manager can now see outcome
   distribution across the whole map at a glance).
2. **Zona hull polygons** — a convex-hull outline per zona, colored by
   the existing `zonaColor()`, so zona geography (previously only
   visible via marker color) is still visible as an area, not lost by
   repurposing marker color for status.
3. **Controle labels** — a small, always-visible, colored text label at
   each Controle's centroid, so "where are the Controles" and "which
   Controles are still fully inactive" are visible without hovering
   individual domicílios.

## 1. Marker color: status, not zona

New `statusColor(row)` function, replacing `zonaColor()` at the marker
call site (`zonaColor()` itself is untouched — it's reused by the new
hull layer instead).

Precedence, evaluated per domicílio row (`{ultimaPosicao, tipoEntrevista, ...}`):

1. `ultimaPosicao === 'Distribuido'` → **gray** (`#888888`) — inactive,
   nothing sent to the field yet, regardless of `tipoEntrevista`.
2. Otherwise, bucket by `tipoEntrevista` (same values `aggregateZonas`'s
   `TIPO_COLUNA` already buckets, extended with real colors instead of
   just a column name):
   - `Realizada` → `#009E73` (green)
   - `Recusa` → `#D55E00` (red/orange)
   - `Não Iniciada` → `#F0E442` (yellow)
   - `Domicílio Fechado` → `#56B4E9` (sky-blue)
   - anything else (e.g. the live-confirmed `"Em condições de ser
     habitada"`, or any future SIGC status not in this list) → `#000000`
     (Outros/black)

All six colors are the existing Okabe-Ito palette values already used
elsewhere in this codebase (`ZONA_PALETTE`, `agenda-day-guide.js`'s SVG
maps) — colorblind-safe, and picked here for their conventional
semantic association (red≈bad, green≈good) rather than assigned by hash
like `zonaColor()` is.

Marker popup content is unchanged (still shows Controle, Domicílio,
Entrevistador, Tipo, Zona on click).

## 2. Zona hull polygons

New layer, rendered *before* markers (so markers sit visually on top of
the fill).

For each zona present in `joined` (grouping by `idZona`, excluding
"Sem zona" — `idZona === null`/empty), compute the convex hull of that
zona's domicílios' `[lat, lon]` coordinates (only rows with
`temCoordenadas`), using a hand-rolled Andrew's monotone chain
algorithm — a pure function over a plain coordinate array, no new
vendored dependency (matches this repo's existing "vendor only what you
must, otherwise hand-roll small pure logic" approach, e.g. `zonaColor`'s
own hash-based color assignment).

Render as an `L.polygon` filled with that zona's `zonaColor(idZona)`,
low fill-opacity (e.g. 0.15–0.2) so it reads as an area highlight, not a
solid block; polygon *border* uses the same color at higher opacity for
a visible outline. Clicking a hull shows a small tooltip/popup with the
zona's idZona + nome (same identity shown in the Zonas tab and in each
marker's own popup) — this is the only place zona identity is
discoverable on the map now that marker color no longer carries it.

**Degenerate cases** (a zona with too few points, or all-collinear
points, for a real polygon):
- 1 point → a small filled circle (`L.circle`, fixed small radius, e.g.
  30m) in the zona color, centered on that point.
- 2 points, or ≥3 points all collinear → a thin capsule/line buffer
  between the extreme points, in the zona color (a rendering detail —
  a `L.polyline` with a wide `weight` reads as a capsule without needing
  real buffer geometry).

Every zona with at least one valid-coordinate domicílio gets *some*
shape; a zona with zero valid coordinates gets nothing (consistent with
markers, which already exclude rows lacking coordinates).

"Sem zona" households get no hull — they're not a geographic area, and
a hull spanning every non-biomarcador household across the whole
coverage area would be large and not meaningful. They still render as
markers (status-colored, same as every other marker).

## 3. Controle labels

New layer: one label per distinct `controle` value present in `joined`
(regardless of zona/status), positioned at the centroid — simple
average of `lat`/`lon` — of that Controle's domicílios with valid
coordinates. A Controle with zero valid-coordinate domicílios gets no
label (nothing to center it on).

**Label content:** the last 6 digits of the Controle number (e.g.
`291920705000415` → `000415`) — full Controles are 15 digits and would
clutter the map; the full number is available via the label element's
`title` attribute (native browser tooltip) or a click. Rendered as a
Leaflet permanent tooltip/divIcon (always visible, not hover-only —
"sticky" per the requirement), small font, positioned to avoid
obscuring the centroid's own marker where reasonably possible (offset
above the point).

**Label color** — a three-way rule over that Controle's domicílios'
`ultimaPosicao` values, independent of both the marker-status and
zona-hull color schemes (deliberately distinct palette so the three
layers don't visually blend into each other):
- Every domicílio is `Distribuido` → **gray** (`#888888`) — inactive.
- No domicílio is `Distribuido` → **blue** (`#0072B2`) — active.
- Mixed (some `Distribuido`, some not) → **orange** (`#E69F00`) —
  partial.

**Zoom behavior:** labels always render, no zoom-based hiding or
clustering. The Último Movimento report is normally already filtered to
one Estado + Município (and often one Agência) before Filtrar is run, so
the practical Controle count per view is expected to stay small in
practice; zoom-based hiding is explicitly deferred until real usage
shows it's needed (YAGNI).

## Status legend

A fixed, always-visible corner overlay (same `add_control`-style
mechanism the map already uses for its data-timestamp note) listing the
six marker status colors with labels. No separate legend for hull colors
(zona) or label colors (Controle active/inactive/partial) — those three
values (gray/blue/orange) are few enough, and explained clearly enough
by hover/click, to not need dedicated legend entries in this version.

## Testing

Pure functions — `statusColor(row)`, the convex-hull algorithm (given a
coordinate array, returns hull points or a degenerate-case shape
descriptor), and the Controle-centroid + label-color computation (given
a Controle's rows, returns `{lat, lon, colorState}`) — are all
unit-testable the same way `zonaColor`/`aggregateZonas` already are:
plain-data in, plain-data out, no DOM/Leaflet involved. Leaflet-specific
rendering (`L.polygon`, `L.circle`, `L.polyline`, tooltip placement)
stays manual-verification-only, consistent with the rest of this
feature's map-rendering code.

## Out of scope (this version)

- Zoom-based label hiding/clustering (deferred, YAGNI until proven
  needed).
- A dedicated on-map legend for hull or Controle-label colors.
- Any change to the Zonas tab, the consent flow, or the underlying
  data-fetch/join/aggregate pipeline from the base Mapa feature — this
  is a rendering-layer addition only.
