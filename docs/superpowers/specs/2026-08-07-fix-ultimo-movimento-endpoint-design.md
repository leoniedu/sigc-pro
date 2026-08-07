# Fix: Último Movimento's endpoint moved under /relatorio/filtrar — design

2026-08-07. Status: approved direction, pre-implementation.

## Root cause (verified against a live capture)

SIGC migrated the Último Movimento report from its own dedicated
endpoint onto the same generic `/relatorio/filtrar?slug=...` mechanism
Lista de Endereços already uses (`agenda-map.js`'s `filtrarUrl`, hardcoded
today to `slug=ListaEnderecos`). Three things changed simultaneously,
confirmed via a live curl capture (2026-08-07):

1. **URL.** Was `POST /UltimoMovimento/Filtrar` (plain path, no query
   string). Now `POST /relatorio/filtrar?slug=relatorio-ultimo-movimento`,
   behind the F5 gateway rewritten to
   `/f5-w-<hex>$$/relatorio/f5-h-$$/relatorio/filtrar?slug=relatorio-ultimo-movimento;F5_origin=<hex>&F5CH=I`
   — the same `/relatorio/f5-h-$$/relatorio/filtrar` doubled-segment
   shape `filtrarUrl`'s "full" fallback already builds for Lista de
   Endereços, just with a different slug.
2. **Filtro body.** `IdFiltro` was `''` (both call sites). Now must be
   `'relatorio-ultimo-movimento'` — matching the slug, same convention
   `filtroBody` already uses for Lista de Endereços (`IdFiltro:
   'ListaEnderecos'`).
3. **Response table.** Table id was `tb_ultimo_movimento`. Now
   `tableRelatorio` — the same id Lista de Endereços' own response uses
   (`parseEnderecosHtml`'s `#tableRelatorio`). No collision risk: each
   response is parsed independently in its own `DOMParser` document,
   never sharing a live DOM.
4. **Header labels changed too**, confirming this is a genuinely
   different report template, not just a URL rename. Live-captured
   header row: `#!Controle`, `!Domicílio`, `Entrevistador`, `Tipo
   Entrevista`, `Última Posição`, `Data`, `Observação`. `Controle` and
   `Domicílio` now carry a leading `#!`/`!` marker (confirmed stable,
   not a copy artifact) — likely a sortable/filterable-column
   convention in this report's grid widget. `normalizeLabel`
   (lowercase/trim/whitespace-collapse) does NOT strip these
   characters, so `'#!controle' !== 'controle'` — this is why
   `parseUltimoMovimentoTable`'s fail-closed header match currently
   fails silently (same failure mode as the previous Agência bug: no
   thrown error, `null` return, zero warnings, just always-empty data).

This breaks BOTH call sites that hit this endpoint:
- `agenda-map.js`'s `postUltimoMovimento` (per-Controle, `IdAgencia:
  '*'`, feeds the Guia do Dia's Entrevistador field).
- `ultimo-movimento-export.js`'s `fetchAgenciaReport` (per-agência,
  `Controle: '*'`, feeds the "CSV TODAS" advanced export).

Confirmed live for the per-agência shape only (your capture used
`IdAgencia: specific, Controle: '*'`). The per-Controle shape
(`IdAgencia: '*', Controle: specific`, `agenda-map.js`'s usage) is
assumed to work identically under the new URL/IdFiltro/table-id — same
endpoint, same report, only the two filtro fields that were already
wildcarded/specific before are unaffected by this migration. Flagged
for live verification after implementation, same as every other
network path in this codebase.

## Fix

### 1. Generalize `filtrarUrl` and `filtroBody` in `agenda-map.js` to take a slug

`filtrarUrl(origin, pathname, simple)` → `filtrarUrl(origin, pathname,
slug, simple)`, replacing the hardcoded `slug=ListaEnderecos` with the
parameter. Existing Lista de Endereços call sites pass `'ListaEnderecos'`
explicitly (behavior-preserving — this is a pure parametrization, not a
Lista de Endereços behavior change). `filtroBody(uf, controle)` similarly
takes an `idFiltro` parameter instead of the hardcoded `'ListaEnderecos'`
string, for the same reason.

A second, symmetric pair — `filtroBodyUltimoMovimento` — already exists
and stays as a distinct function (different field set: `IdAgencia`,
`IdEntrevistadores`, `IdTipoAcompanhamento`, no `TipoVisualizacao`), just
gets its `IdFiltro` value corrected from `''` to
`'relatorio-ultimo-movimento'`.

`postUltimoMovimento` (in `agenda-map.js`) is rewritten to build its URL
via the now-parametrized `filtrarUrl(origin, pathname,
'relatorio-ultimo-movimento', simple)` with the same two-mode
try-simple-then-full retry loop `postFiltrar` already uses, instead of
`window.__sigcPro.fetchViaGateway('/UltimoMovimento/Filtrar', ...)` — the
generic gateway helper can't produce this endpoint's URL shape (query
string plus the doubled `/relatorio` F5 fallback segment), so this call
site moves off it, mirroring `postFiltrar`'s own hand-built retry loop
instead. `postUltimoMovimento`'s response table lookup changes from
`doc.getElementById('tb_ultimo_movimento')` to
`doc.querySelector('#tableRelatorio')` — the same table id (and lookup
method) `parseEnderecosHtml` already uses in this file, since both
endpoints now emit the same generic report-table id.

### 2. Fix `parseUltimoMovimentoTable`'s header matching

`ULTIMO_MOVIMENTO_LABELS`'s values stay `'Controle'`/`'Entrevistador'`
(the marker is a rendering artifact of the header cell, not part of the
label's actual identity — SIGC's other reports don't carry it, and
tying the match to a temporary UI decoration would break again the next
time SIGC tweaks it). The match itself is made tolerant of a leading
`#`/`!` marker: before comparing, strip any leading run of `#`/`!`
characters from the header text, THEN run the existing
`normalizeLabel`. This is a small, targeted preprocessing step, not a
change to `normalizeLabel` itself (which is shared by every other
table-parsing call site in this codebase and must not silently start
stripping characters other reports may need verbatim).

### 3. Update `ultimo-movimento-export.js`'s own separate implementation

Same three fixes, independently, since this file has its own
`buildAgenciaFilterBody`/`fetchAgenciaReport`/`parseUltimoMovimentoHtml`/
`TABLE_ID` — it does not share code with `agenda-map.js`'s parser (each
maintains its own, per the existing architecture: this file needs the
full `{header, rows}` shape for CSV building, `agenda-map.js` needs a
`Map<controle, {entrevistador}>`). `buildAgenciaFilterBody`'s `IdFiltro`
corrected from `''` to `'relatorio-ultimo-movimento'`; `TABLE_ID`
changed from `'tb_ultimo_movimento'` to `'tableRelatorio'`; the fetch URL
moves off the plain `fetchViaGateway('/UltimoMovimento/Filtrar', ...)`
call onto the same `/relatorio/filtrar?slug=relatorio-ultimo-movimento`
two-mode retry shape.

`agenda-map.js` and `ultimo-movimento-export.js` are two independent,
sanctioned network files with no cross-file dependency today (see each
file's own header comment) — introducing one now, just to reuse a URL
builder, would be new architectural coupling outside this fix's scope.
Instead, `ultimo-movimento-export.js` gets its own small local
`filtrarUrl`-shaped two-mode URL builder, parametrized the same way.
This is a deliberate small duplicate, not an oversight: it mirrors this
codebase's existing precedent of sharing `f5Prefix`/`gatewayUrl` (moved
into `sigc-common.js`) specifically because those were byte-identical
duplicates, while `filtrarUrl`'s `/relatorio/filtrar` URL shape stays
local to each file that needs it, since the two files' fetch call sites
evolve independently and aren't byte-identical today.

`onUltimoMovimento()` (page-detection via h6 title) is untouched — it
detects the page the user is ALREADY on, unrelated to the report-fetch
endpoint that changed.

## Out of scope

- `getCurrentUf()`, `fetchAgenciaList` (`/Filtro/CarregarAgencias`,
  unaffected, different endpoint), `collectAllAgencias`,
  `exportAllAgencias` — untouched.
- `mergeUltimoMovimento`, `parseDistribuicaoTable`, `mergeDistribuicao`,
  `fetchDistribuicao`/`postDistribuicao` (Relatório Distribuição) —
  untouched; this fix is scoped to Último Movimento only. (Distribuição
  was captured live only yesterday and has no evidence of having moved.)
- `buildSlotCard`/card rendering — untouched, consumes whatever
  `parseUltimoMovimentoTable` hands it, unaware of the fetch mechanics.

## Testing

- `filtrarUrl`: existing tests (if any target the 3-arg shape) or new
  tests covering the 4-arg shape with two different slugs
  (`'ListaEnderecos'` and `'relatorio-ultimo-movimento'`), confirming
  Lista de Endereços' URL is unchanged and the new slug produces the
  expected URL for both `simple` modes.
- `parseUltimoMovimentoTable`: new test using the exact live header row
  (`#!Controle`, `!Domicílio`, `Entrevistador`, `Tipo Entrevista`,
  `Última Posição`, `Data`, `Observação`) — the same regression-guard
  pattern used for the previous Último Movimento bug, this time pinning
  the NEW live shape. Existing tests using the old unmarked
  `'Controle'`/`'Entrevistador'` headers must also still pass (marker
  is optional-tolerant, not required).
- `ultimo-movimento-export.js`: `buildAgenciaFilterBody`'s `IdFiltro`
  assertion updated to `'relatorio-ultimo-movimento'`;
  `parseUltimoMovimentoHtml`'s table-id test updated to
  `tableRelatorio`; any new URL-builder function gets the same
  simple/full two-mode test coverage `filtrarUrl`'s tests already have.
- Both files' actual network-calling functions
  (`postUltimoMovimento`/`fetchAgenciaReport`) stay manually-verified-only,
  per existing project convention.

## Manual verification (live server, after implementation)

1. Guia do Dia: confirm the console shows a non-zero "controle(s) com
   entrevistador" count again, and a card shows a real Entrevistador
   value.
2. "CSV TODAS" (advanced flag): confirm the export still produces rows
   with real Entrevistador/Situação data, not an empty CSV.
3. Confirm the per-Controle shape (`agenda-map.js`, `IdAgencia: '*'`)
   genuinely still works under the new endpoint — this is the one
   assumption in this spec not directly confirmed by the capture.
