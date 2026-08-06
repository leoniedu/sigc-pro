# Guia do Dia: zona nome + agência/entrevistador on the visit card — design

2026-08-06. Status: approved direction, pre-implementation.
Prereq reading: `2026-07-16-agenda-day-guide-design.md`,
`2026-07-16-agenda-map-design.md`,
`2026-07-24-ultimo-movimento-multi-agencia-export-design.md`.

## Purpose

Two additions to each RESERVADO visit card in the Guia do Dia:

1. **Zona nome** alongside the zona ID already shown (`Zona: 29A3OI` →
   `Zona: 29A3OI Nome-da-Zona`).
2. **Agência** and **Entrevistador**, e.g.:
   `Tel: (71)999093137 · Agência: 290570100 · Controle: 290570120000125 ·
   Dom: 14 · Zona: 29Z9XU Nome-da-Zona · Entrevistador: Fulano de Tal`

Both are opt-in, riding the existing "Guia + Mapa" consulta — no new
consent prompt, no new button.

## 1. Zona nome

`agenda-map.js`'s `tableToEnderecosMap` already captures `zona` (the
"Nome ZONA" column) into every endereço entry; `agenda-day-guide.js`
currently discards it — `zonaLabel(info)` returns `info.idZona` only.

Per the card-only decision below, the grid cells (`buildDayGrid`) stay
ID-only, so `zonaLabel` itself is unchanged (it still backs the grid).
A new `zonaFullLabel(info)` returns `` `${idZona} ${zona}`.trim() ``
(same shape `pdf-export.js` already builds for its own zona line) and
replaces the call to `zonaLabel` in exactly the two card-facing spots:
`buildSlotCard`'s `ids` line and `routeCheckboxHtml`'s stop detail. The
team-panel `Zonas:` summary line (`zonasUnion`) also switches to the
full label — it is drawn from the same per-visit data and reads
naturally with the nome attached.

No network change: this data is already fetched, just unused.

## 2. Agência + Entrevistador

### Data source

`/UltimoMovimento/Filtrar`, same endpoint `ultimo-movimento-export.js`
already calls per-agência. Confirmed against the live server: the same
endpoint also accepts `IdAgencia: '*'` with a specific `Controle`,
returning that Controle's row(s) with Agência and Entrevistador filled
in — so this is **one POST per distinct Controle in the day's rows**,
the same fetch shape `agenda-map.js` already uses for Lista de
Endereços (`postFiltrar(uf, controle)`), not a full-UF agência sweep.

Live column headers: `Controle`, `Agência`, `Entrevistador`.

### Shared helpers (dedup, not a new pattern)

`ultimo-movimento-export.js` and `agenda-map.js` each independently
implement the F5 gateway URL rewriting (`f5Prefix`/`gatewayUrl` /
`filtrarUrl`) — near-identical logic, already duplicated once. Adding a
third near-copy in `agenda-map.js` for this second endpoint isn't
worth a third duplicate: move the gateway helpers
(`f5Prefix`/`gatewayUrl`/`fetchViaGateway`) into `sigc-common.js` as
shared exports, and have both features call the shared version. Pure
refactor, no behavior change — covered by the existing gateway-URL unit
tests, moved along with the code.

`buildAgenciaFilterBody(uf, agencia)` stays put in
`ultimo-movimento-export.js` (it's a one-line object literal, not worth
extracting); `agenda-map.js` builds its own filtro body inline, mirroring
`filtroBody`'s existing style, with `IdAgencia: '*'` and the specific
Controle.

### Fetch + merge

New `fetchUltimoMovimento(uf, controles)` in `agenda-map.js`, same
per-Controle memory cache pattern as `fetchEnderecos` (a sibling
`Map` keyed by controle, never persisted). Parses the response table by
header label (`Controle`/`Agência`/`Entrevistador`), same
`normalizeLabel`-based matching `tableToEnderecosMap` uses — unknown
headers fail closed (skip that Controle, log + continue), matching
`postFiltrar`'s existing failure handling.

Merged into the same `enderecos` map `fetchEnderecos` already builds:
after both fetches complete, every `controle|domicilio` entry sharing a
Controle gets `agencia`/`entrevistador` fields added (`null` when that
Controle's lookup failed or returned nothing — cards already omit blank
fields line by line, so this degrades the same way a missing telefone
does today).

### Consent flow

No new prompt. The existing `CONSENT_MSG` click in `exportGuideMap`
now covers both queries — reworded to mention both:

> "SIGC-PRO: isto fará uma consulta ao próprio servidor do SIGC para
> obter as coordenadas, zona, agência e entrevistador dos endereços.
> Nenhum dado sai do IBGE. Continuar?"

Both fetches run together after "yes"; declining skips both, same as
today (map-free, now also agência/entrevistador-free — one flag, one
degradation path, not two).

`exportGuideMap` sequences: `fetchEnderecos` then
`fetchUltimoMovimento`, merging the second into the first's result
before calling `dayGuide.generate(enderecos)`. A failure in the second
fetch alerts and continues with agência/entrevistador blank, same
try/catch shape already wrapping `fetchEnderecos`.

### Card rendering

`buildSlotCard`'s `ids` line gains two segments, at this position
(confirmed order):

```
Tel: … · Agência: … · Controle: … · Dom: … · Zona: … · Entrevistador: …
```

Each new segment follows the existing pattern exactly — present-only
(`r.agencia && ...`), same `&nbsp;·&nbsp;` join, same `escapeHtml`.
Source is `slotInfo(r, enderecos)` (already resolved for zona), reading
`info.agencia`/`info.entrevistador` instead of new lookups.

## Out of scope

- No change to `ultimo-movimento-export.js`'s own behavior or its
  full-UF sweep — this is a separate, much narrower per-Controle query.
- Grid cells (`buildDayGrid`) unchanged — zona stays ID-only there, no
  agência/entrevistador added (card-only, per the earlier decision).
- No manifest/permission change: `agenda-map.js` is already the
  network-sanctioned file, already allowed by
  `scripts/check-privacy.sh`.

## Testing

- Pure-function tests (`tests/agenda-day-guide.test.js` or wherever
  `zonaLabel`/`buildSlotCard` are currently covered): `zonaFullLabel`
  with/without a nome; card ids line with/without agencia/entrevistador
  present.
- `tests/agenda-map.test.js`: new Último Movimento table parser, keyed
  merge into the endereços map, header-mismatch failure path.
- Gateway helper relocation: existing gateway-URL tests move to
  `sigc-common` coverage (or a shared test file), assertions unchanged.
- `fetchAgenciaReport`/`postFiltrar`/`fetchUltimoMovimento`/
  `exportGuideMap` stay manually-verified-only against the live server,
  consistent with every other network path in this codebase.
