# Agenda map: opt-in coordinates fetch + Guia com Mapa — design

2026-07-16. Status: approved direction, pre-implementation.
Prereq reading: `2026-07-16-agenda-day-guide-design.md` (the guide this
extends).

## Purpose

Give the Guia do Dia navigation: per-visit `geo:` links and an optional
Google Maps route link. (A per-team GPX download was shipped and then
removed 2026-07-17: its `data:` URI link doesn't open from a printed/PDF
guide — most PDF viewers don't support non-`http(s)` link schemes — only
from the live HTML in a browser, which made it not worth the surface.)
Coordinates come from SIGC's own
Lista de Endereços endpoint via an **opt-in, click-triggered, same-origin
fetch** — the first and only network call in SIGC-PRO, deliberately
quarantined (decided 2026-07-17; the in-memory Lista→Agenda join was
rejected: requiring a prior Lista visit in the same session is a trap).

## Trust-posture changes (ship in the same release, or don't ship)

- `scripts/check-privacy.sh`: keep the blanket API ban but exempt exactly
  `extension/features/agenda-map/`; add a complementary check that
  `fetch(` appears nowhere else in `extension/` and that agenda-map
  contains no literal `http`/`https` URL (its request URL must be built
  from `location.origin`, so it physically cannot reach a third party).
- Privacy policy, Store listing, README, Pages: "nenhuma chamada de
  rede" becomes "nenhuma chamada de rede, exceto uma consulta opcional,
  acionada por clique, ao próprio servidor do SIGC (mesma sessão do
  usuário); nada é enviado a terceiros nem ao desenvolvedor".
- No new manifest permissions (MAIN-world same-origin fetch rides the
  page's session).

## UI

- New button **"Guia + Mapa"** on the Agenda toolbar, next to "Guia do
  Dia", same Dia-view-only visibility mechanics (shared with
  agenda-day-guide via the same insert/remove observer pattern).
- First click per page load: `confirm()` — "SIGC-PRO: isto fará uma
  consulta ao próprio servidor do SIGC para obter coordenadas dos
  endereços. Nenhum dado sai do IBGE. Continuar?" Accepted → remembered
  in a plain variable (never persisted). Declined → abort, no fetch.
- "Guia do Dia" (network-free) stays untouched.

## The fetch (features/agenda-map/agenda-map.js)

Captured request (2026-07-17, F5 gateway):

- `POST <origin><f5-prefix>/relatorio/f5-h-$$/relatorio/filtrar?slug=ListaEnderecos;F5_origin=<hex>&F5CH=I`
  where `<f5-prefix>` = `/f5-w-<hex>$$` and `<hex>` decodes to the real
  backend (`https://w3sigcpns2025.ibge.gov.br`).
- Headers: `Content-Type: application/x-www-form-urlencoded; charset=UTF-8`,
  `X-Requested-With: XMLHttpRequest`. Cookies ride automatically
  (same-origin).
- Body: `filtro=` + URL-encoded JSON
  `{"IdFiltro":"ListaEnderecos","IdUf":"<uf>","IdAgencia":"*","IdMunicipio":"*","Controle":"<controle>","TipoVisualizacao":"S"}`.
- Response: an HTML fragment containing `#tableRelatorio` with the full
  Lista de Endereços table (no pagination).

URL building: extract `f5-prefix` from `location.pathname`
(`/^\/f5-w-[0-9a-f]+\$\$/`). With a prefix, replicate the captured shape
(including the `f5-h-$$` segment and `F5_origin=<hex>` taken from the
prefix itself); without one (direct host, e.g. VPN), plain
`/relatorio/filtrar?slug=ListaEnderecos`. **Field test decides** whether
the simple prefixed form (`<prefix>/relatorio/filtrar?slug=…`) also
works — prefer it if so.

Per click: distinct `Controle`s of the day's **reserved** slots → one
sequential POST each (typically 1–5). Parse each response with
`DOMParser` (inert), locate `#tableRelatorio`, resolve columns **by
header label** (normalized-label match against the existing
`PESQUISAS.PNS2026.columns` labels; indexes not assumed), and build
`Map("controle|domicilio" -> { lat, lon, zona, idZona })` via the existing
`parseCoord` (handles `13 28 41.5514 S` / `39 06 20.4723 O`). `zona` and
`idZona` (added 2026-07-18) are the table's Nome ZONA / ID Zona — the
household's real zona, unlike the Agenda slot text, which lists every
zona from slot creation; the guide shows them together as "id nome",
the same shape the slot text uses.
Zona is only filled for selecionados, which is exactly what the filtro
requests (`TipoVisualizacao: "S"`). A household with zona but invalid
coordinates keeps an entry with `lat`/`lon` null.

Failures (HTTP error, missing table, header mismatch, zero coords):
alert once — "não foi possível obter coordenadas (…); o guia será gerado
sem mapa" — and fall through to the plain guide. A per-row miss just
omits that card's link.

As shipped, the fetch (`fetchEnderecos`, né `fetchCoords` — renamed
2026-07-18 when entries gained `zona` and nullable coordinates) stays
private to agenda-map, which calls
`window.__sigcPro.dayGuide.generate(enderecos)` directly — nothing is
exposed on `__sigcPro` (an `agendaMap.fetchCoords` export was planned
here; add it only when a second consumer appears, e.g. the future
travel-sanity check). All other code stays fetch-free.

## Guide integration (agenda-day-guide.js)

`buildGuideHtml`/`buildSlotCard`/`buildTeamPanel` accept an optional
`coords` map (absent = current output, byte-identical):

- **Reserved card**: appends
  `<a class="geo" href="geo:<lat>,<lon>">abrir no mapa</a>` when
  `coords` has `controle|domicilio` with valid lat/lon. `geo:` fetches
  nothing; on the phone it opens the user's map app (offline apps
  included). Also shows `Zona: <real zona>` (2026-07-18) on the card's
  ids row, and the team panel's Zonas line uses the real zona for
  reserved slots (open slots keep the slot-text list — they can still
  be filled from any of those zonas).
- **Team panel "Rota" row** (only when ≥2 reserved visits have coords):
  - `Google Maps`: `https://www.google.com/maps/dir/?api=1&travelmode=driving&waypoints=<v1>%7C…%7C<vn-1>&destination=<vn>` —
    visits in time order, origin omitted (= current location), max 9
    waypoints + destination; longer days chunked into sequential legs
    ("Rota 1", "Rota 2"), each leg starting at the previous leg's end.
    Documented trade-off: tapping sends the leg's coordinates to Google —
    a deliberate user action, never automatic (stance recorded
    2026-07-16: no third-party map queries in normal flow).
  - ~~`GPX`~~ — removed 2026-07-17 (see Purpose above).
- The guide file itself remains `<script>`-free and self-contained.

## Out of scope

- Inline SVG route sketch; travel-sanity check in Verificar Slots
  (future, both feasible on the same coords map).
- Open-slot mapping (no household → no coordinate).
- Caching across page loads/reloads (in-memory per-Controle caching
  across repeat clicks within one page load was added post-launch).

## Testing

- Pure parts (filtro body builder, F5 URL builder from sample pathnames,
  response-table parsing on a saved HTML fixture from the capture, join,
  geo/route/GPX builders, waypoint chunking at 9+1) via bun mirror
  tests.
- Privacy gate: new complementary checks must pass and must FAIL when a
  `fetch(` is planted outside agenda-map (test the tripwire itself).
- Live field test: both URL forms, multi-controle day, coordinate-less
  household (missing lat/lon cells), declined consent path.

Status 2026-07-17: the tripwire self-test shipped as
`scripts/test-privacy-gate.sh` (pre-commit runs it whenever the gate or
the self-test changes). The bun mirror tests were not written — the pure
parts were validated manually during the live field test.
