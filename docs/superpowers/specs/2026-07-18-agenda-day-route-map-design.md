# Agenda day-route map: inline SVG sketch — design

2026-07-18. Status: approved direction, pre-implementation.
Prereq reading: `2026-07-16-agenda-map-design.md` (the `enderecos` map
this consumes) and `2026-07-16-agenda-day-guide-design.md` (the guide
this extends). Supersedes that spec's "Inline SVG route sketch" item
under Out of scope.

## Purpose

Guia + Mapa already gives per-visit `geo:` links and a Google Maps route
link, but neither answers "what does the whole day actually look like"
at a glance — clustering vs. outliers, whether the visit order zigzags,
which team covers which area. A real basemap (tiles) is not an option:
loading tiles means a request to a third-party server on every guide
view, which the privacy gate bans outright and which the map spec's
recorded stance (2026-07-16: "no third-party map queries in normal
flow") rules out. An inline SVG sketch, plotted purely from the
coordinates the guide already has in memory, needs zero network calls
and stays inside the existing zero-`<script>`, self-contained-HTML
constraint.

## Placement

No new tab, no new button. Each existing tab (except Lab) gets its own
map section, appended below that tab's existing content:

- **Resumo tab**: a combined map — every team's reserved, coordinate-
  having visits overlaid, one color per team — below the existing
  "Slots do dia" grid.
- **Each team tab**: that team's own map — only its visits, in its
  assigned color — below its visit cards (and above the coordinate-less
  note, if any; see Edge cases).
- **Lab tab**: no map. It stays the privacy-stripped, laboratory-
  shareable view (truncated Controle, no personal data) and a route
  sketch adds no value there while adding a section to keep in sync.

Both map kinds are absent (section not rendered) when `enderecos` is
null — i.e. the plain Guia do Dia (no Guia + Mapa fetch) is unaffected,
matching every other `enderecos`-optional piece of the guide.

## Data

No new fetch. Both map builders read the same `enderecos` map
(`"controle|domicilio" -> {lat, lon, zona, idZona}`) and `groups`
(`[{equipe, rows}]`) the guide already has in `buildGuideHtml`.

For a given row set (all reserved rows for combined, one team's reserved
rows for per-team), a visit is **plottable** when its `enderecos` entry
has non-null `lat`/`lon`; visits are ordered by `horaInicio` (rows
already arrive time-sorted per `2026-07-16-agenda-day-guide-design.md`).
Sequence numbers are assigned per row set, starting at 1 — so a team's
own map and its slice of the combined map both number 1..N for that
team, restarting each time.

## Team colors

Each equipe is assigned one color from a fixed 8-color Okabe-Ito
palette (colorblind-safe; same design system as KML export's
vermillion/sky-blue pair, extended to the full set here since more than
2 teams need distinguishing):

```
#E69F00 (orange)   #56B4E9 (sky blue)   #009E73 (bluish green)
#F0E442 (yellow)   #0072B2 (blue)       #D55E00 (vermillion)
#CC79A7 (reddish purple)   #000000 (black)
```

Assignment: teams sorted by name (the same order `groupByEquipe` already
produces) map to palette indices `0, 1, 2, …`, cycling with `% 8` past
eight teams. A team's color is identical on its own tab's map and on the
combined Resumo map — a stable visual identity for that team throughout
the guide. The Resumo map includes a small text legend (`● equipe`, one
line per team, using the same colors) so the combined map is readable
without cross-referencing the tabs.

## Rendering

Plain inline `<svg>`, no `<script>`, no external refs, normal document
flow (prints correctly per-tab like the rest of the guide).

**Projection**: equirectangular with a latitude correction — at Bahia's
latitude (~13°S) a degree of longitude covers measurably less ground
than a degree of latitude, so plotting raw lat/lon 1:1 would visibly
skew angles/shapes. Correction: `x = lon * cos(meanLat)`, `y = lat`
(sign/scale flipped as needed so north is up and the box fits the
viewport), where `meanLat` is the mean latitude of the plotted set.

**Viewport**: fixed size per map kind — team maps smaller (e.g.
480×320), the combined Resumo map wider (e.g. 640×420) since it usually
has more points spread further apart. Fit the projected points to the
viewport with padding (so edge dots and their labels aren't clipped);
a single point centers with a fixed default zoom (there's no spread to
fit).

**Markers**: filled circle per plottable visit, in the row's team
color; the sequence number centered inside (or immediately beside, if
the circle is too small to hold two digits legibly) the circle; the
visit's start time (`horaInicio`) as a small text label offset below
the circle. Labels are not collision-avoided — with 8-10 close-together
stops some overlap is possible; acceptable for a sketch (YAGNI for v1,
matches the "sketch, not cartography" framing below).

**Route line**: a thin polyline connecting the plottable visits in time
order, same color as the dots, drawn behind them. 1 plottable visit ⇒
dot only, no line (matches the existing Rota-row threshold: routes need
≥2 stops). 0 plottable visits ⇒ no map section at all for that row set
(nothing to plot, nothing to say).

**Scale bar**: a short horizontal bar in a corner labeled with a
friendly rounded distance (100 m / 500 m / 1 km / 5 km / …), computed
from the plotted box's real-world width using the same equirectangular
approximation as the projection (adequate at this scale; no need for
haversine precision on a sketch).

**North arrow**: a small fixed "N ↑" glyph in a corner — legitimate
here (not decorative smoke) because the projection keeps true north
"up" by construction.

**No interactivity**: dots are plain `<circle>`/`<text>`, no `<a>`
wrapping them. The `geo:` link and the Rota row's Google Maps link
already exist in the card / team-panel just above the map; duplicating
them as clickable dots would risk overlapping tap targets for no real
gain.

## Edge cases

- **Coordinate-less reserved visit** (an `enderecos` entry exists with
  `zona`/`idZona` but null `lat`/`lon`, or no entry at all for that
  `controle|domicilio`): excluded from plotting, never silently
  dropped — listed in a small text line directly under the map, e.g.
  "1 visita sem coordenadas válidas: 14:05 João" (reusing each row's
  `horaInicio` + `nome || controle` fallback, the same fallback pattern
  used elsewhere in the guide). Zero such visits ⇒ no line.
- **Zero plottable visits** for a row set: no map section renders at
  all (not an empty box) — falls through to just the coordinate-less
  note, if any, or nothing.
- **One plottable visit**: map renders with a single centered dot,
  numbered "1", no line, no scale-bar ambiguity (a fixed default
  viewport zoom is used since there's no spread to compute a scale
  from).

## What this is not

A sketch, not a map: no streets, no basemap, no claim of cartographic
accuracy beyond "these points are roughly here, in this relative
arrangement, this far apart." For actual navigation, the existing
`geo:` links (open the phone's map app) and the Rota row's Google Maps
link (deliberate click, sends that leg's coordinates to Google — the
stance recorded 2026-07-16 in the map spec) remain the tools of record.

## Out of scope

- Basemap tiles / any imagery (ruled out by the privacy gate and the
  no-third-party-queries stance — see Purpose).
- Clickable/interactive dots (see Rendering — no interactivity).
- Label collision avoidance for dense clusters (YAGNI for v1).
- Open-slot mapping (no household → no coordinate, same as the rest of
  the map integration).
- A standalone on-Agenda-page dialog/overlay version (considered during
  brainstorming; the guide-tab placement was chosen instead — see
  Placement).

## Testing

- Pure parts (bounding-box computation, the `lon * cos(meanLat)`
  projection, palette assignment/cycling, scale-bar rounding, the
  plottable/coordinate-less split) via bun mirror tests, same pattern as
  the rest of the day-guide's pure helpers.
- Visual smoke test: render a sample guide (multi-team, one
  coordinate-less visit, one single-visit team) to a scratch HTML file
  and open it in a browser — check dot placement, line order, legend
  colors, scale bar, and print preview (one team per printed page, map
  included).
- Privacy gate must stay clean (no new APIs; pure SVG string building,
  same as the rest of `agenda-day-guide.js`).
- Live field test: a real multi-team Guia + Mapa day, confirming the
  Resumo and per-team maps render sensibly against real coordinate
  spread and that Lab tab has no map section.
