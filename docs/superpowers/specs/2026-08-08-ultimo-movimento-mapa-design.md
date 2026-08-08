# Último Movimento: Mapa + Zonas panel — design

2026-08-08. Status: approved direction, pre-implementation.
Prereq reading: `2026-07-16-agenda-map-design.md`,
`2026-08-07-fix-ultimo-movimento-endpoint-design.md`.
Inspiration (external, not ported): `map_ultimo_movimento.R` in
`pns.zonas` — an offline R/OSRM tool with no bearing on this feature's
data sources or scope; see "What this is not" below.

## Purpose

A "Mapa" button on the Último Movimento report page opens a panel with
two tabs — **Mapa** (per-domicílio markers on a Leaflet map, grouped by
zona) and **Zonas** (a summary table, one row per zona) — built entirely
from data the extension can fetch live from the SIGC session. No
standalone file is produced; the panel renders in-page.

## What this is not

`map_ultimo_movimento.R` groups by real driving-corridor zone polygons
computed offline by OSRM (`plan_corredores.R`), pulls UPA↔Setor and
lab-address reference data from local files and a Teams-hosted Excel
sheet, and publishes to OneDrive. None of that is available to a browser
extension and none of it is in scope here. This feature has no
corridors, no OSRM, no offline reference files, and no publishing step —
it groups by the `zona`/`idZona` values already present on selecionado
households in Lista de Endereços, same as `agenda-map.js` does today.

## Data sources

1. **Último Movimento table** (`#tableRelatorio`), read directly from
   the page DOM — the report is already loaded when the button appears,
   so this is not a network call. Same parsing `ultimo-movimento-export.js`
   already does: Controle, Domicilio, Entrevistador, Tipo de Entrevista,
   Última Posição, Data.
2. **Lista de Endereços**, same-origin `/relatorio/filtrar` POST, one
   request per Controle — reuses `agenda-map.js`'s `tableToEnderecosMap`
   verbatim. Requests `TipoVisualizacao: 'S'` (selecionados only), so
   this is inherently selecionados-only; no separate filtering needed.
   Returns `controle|domicilio → {lat, lon, zona, idZona}`.
3. Joined by `controle|domicilio`, the same key convention used
   throughout (`agenda-day-guide.js`'s `enderecoKey`,
   `ultimo-movimento-export.js`'s per-Domicílio fix).

No Agenda cross-fetch in this version (no slots/capacity columns) —
explicitly deferred, not forgotten.

## Consent gates (two, separate, sequential)

1. **Same-origin SIGC fetch** (Lista de Endereços cross-fetch): reuses
   the existing opt-in confirm pattern from `agenda-map.js` — fires once,
   before the first `/relatorio/filtrar` request for Lista de Endereços.
2. **Map tiles** (OpenStreetMap or equivalent, third-party host): a
   **separate** confirm, scoped narrowly to the first tile request —
   not bundled with gate 1, and not implied by clicking the Mapa button
   itself. Declining does not cancel the feature: the Zonas tab still
   renders (no tiles involved), and the Mapa tab shows an explanatory
   message with a way to retry.

This keeps sigc-pro's same-origin-only network stance intact for gate 1
and treats the genuinely new category — a third-party host — as its own
explicit decision.

## Selecionados without zona

Some selecionado households have no biomarcador and therefore no zona
(`zona`/`idZona` both empty in Lista de Endereços). These are NOT
dropped:

- **Zonas table**: a `Sem zona` row aggregates them, same columns as
  every other row.
- **Mapa tab**: their markers render in a visually distinct style (e.g.
  gray, unfilled) rather than the zona color scale, provided they have
  valid coordinates.

Households with no valid coordinates (either because Lista de Endereços
had none, or the row failed to join) are excluded from the map but still
counted in the Zonas table under a "sem coordenadas" column, so the
gap is visible rather than silent.

## Zonas table columns

One row per zona (plus one `Sem zona` row): zona (idZona + nome),
counts per `tipo_de_entrevista` (Realizada, Não Iniciada, Domicílio
Fechado, Recusa, outros), total domicílios, domicílios sem coordenadas.

Explicitly out of scope for this version (needs the Agenda cross-fetch,
deferred): slots livres/agendados, setor/agência rollups (no
setor↔UPA mapping is available client-side).

## Mapa tab

Leaflet, bundled as a static asset (first third-party JS library in this
extension — no CDN load, matching the "no baked-in third-party requests
except tiles, and tiles are gated" stance). One marker per domicílio
(not UPA/zona centroid — precision over the R script's aggregation,
per explicit direction), colored by zona (categorical palette, distinct
"sem zona" style per above). Marker popup: Controle, Domicílio,
Entrevistador, Tipo de Entrevista, zona.

## Trigger

New button next to CSV-pro / CSV TODAS on the Último Movimento page,
same visual style (small blue button) as the rest of sigc-pro's
injected controls.

## Out of scope (this version)

- Agenda slots/capacity in the Zonas table.
- Setor/agência rollups.
- Zone-outline destaque (dashed borders for under-capacity zones) — no
  capacity data without Agenda.
- Any offline/reference-file data (UPA↔Setor, lab addresses,
  `pns_referencia`) — none of it is reachable from the browser and none
  of it is required for this scope.
- Standalone HTML export / OneDrive publish — the panel is in-page only.

## Testing

Follows existing feature test conventions (see
`tests/agenda-map*.test.js` if present, else `ultimo-movimento-export`
tests): pure-function unit tests for the join/aggregation logic
(zona grouping, sem-zona bucket, sem-coordenadas counting), DOM-level
tests for button injection and tab rendering, no live-network tests.
