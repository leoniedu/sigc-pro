# Gerenciamento da Coleta report (GERENCIAMENTO-PRO) — design

2026-10-15. Status: draft for review, pre-implementation.

## Purpose

SIGC's "Gerenciamento da Coleta" page (slug
`relatorio-aprov-coleta-gerencial`) returns one row per sample household
with the portal's own label for where it stands in the interview flow.
Its native grid shows only the rows of the submitted filter, with no
totals. This feature fetches the **whole UF** and presents the aggregates
the coordinators actually need — UF, município, agência — plus the
per-domicílio rows, filterable and exportable. No map.

## Pattern: whole UF, then filter inside the panel

Modelled on munic-pro (`situacao-report`), not on CSV TODAS.

- One explicit click. The request is always the whole UF: `IdMunicipio`,
  `IdAgencia`, `Controle`, `IdTipoAcompanhamento` are all `*`. The page's
  own filter selections are **ignored** (only `#IdUf` is read), and the
  panel says so.
- Município, agência and Bio are filters **inside the panel**, applied
  client-side to the in-memory rows. Switching them never re-requests.
- Why not pass the page's filters: the município and agência aggregates
  need the whole UF anyway; totals stay consistent across views; a UF is
  one request (below). Lista de Endereços already pulls a whole UF the same
  way (7,140 rows, no truncation).

### Why page detection is still needed

Not for the data — the fetch depends on nothing but the UF. Only to decide
**where the launcher button is mounted**, and to avoid mounting it on every
SIGC page (`mountWidget` needs a `when` and an `anchor`).

`#btnFiltrar` alone cannot identify the page: Último Movimento has the same
button (inside `div.card-footer > div.text-right`, after `#btnCancelarFiltro`).
The page's own slug does: `when` = `location.pathname` ends with
`/relatorio/relatorio-aprov-coleta-gerencial` **and** `#btnFiltrar` exists.
The anchor is `#btnFiltrar`, inserted `after` it, exactly as CSV TODAS does
on Último Movimento (`ctx.ultimoMovimentoFiltrarBtn()` already resolves it).
Mounting must not depend on a filter having been submitted.

## Measured data (pns.zonas, 2026-10-14/15)

Source: `output/questionarios/29/parquet/gerenciamento_coleta.parquet`
(BA, the only UF exported so far) and `movimento.parquet` for every UF
(same household set, per the pns.zonas notes).

**Grain.** `(controle, domicilio)` is unique in BA (7,140 rows). `controle`
is always 15 digits. 184 municípios (`substr(controle,1,7)`), 40 agências.
Rows per agência 45–690; rows per município 15–1,185.

**Size per UF** (households in movimento; MB = rows × BA's 6.8 MB/7,140,
an extrapolation, not a measurement):

| UF | rows | ≈ MB | municípios |
|---|---|---|---|
| 21 MA | 9,030 | 8.6 | 166 |
| 35 SP | 7,845 | 7.5 | 179 |
| 31 MG | 7,260 | 6.9 | 228 |
| 29 BA | 7,140 | 6.8 | 184 |
| smallest: 14 RR | 1,584 | 1.5 | 3 |

Largest UF is MA, not SP/MG: ≈ 9 MB of HTML. Total across 27 UFs is 139,532
households (the 133k fetched earlier predates later sample changes). So the
worst case is one ~9 MB response; no pagination, no streaming needed. The
HTML is parsed once with `DOMParser`, reduced to plain row objects, and the
document and string are dropped — only the rows are kept in the cache.

**Columns kept:** `controle, domicilio, id_uf, id_agencia, amostra_
biomarcadores (Sim/Não), ultima_posicao, status_coleta, situacao_entrevista,
andamento`. Município is derived; agência name comes from the `Agência`
column (`"290490200 - CACHOEIRA"`), code from `IdAgencia`.

**`andamento` has 18 distinct labels in BA, not 15.** The gender variants
are separate labels, not "Homem/Mulher": `Homem selecionado a realizar`,
`Mulher selecionada a realizar` (and likewise `em andamento (partes 13 a
24)` and `com recusa (inicial ou durante entrevista)`). Counts (BA):
Finalizada sem Bio 2,959 · Não iniciada 2,421 · 25B realizada 504 · não
elegível 284 · Homem a realizar 222 · Mulher a realizar 210 · 25A recusa
125 · Todos em andamento 117 · 25A agendada 95 · 25B não realizada 51 · 25A
não agendada 45 · recusa interrompida 31 · Indefinido 29 · 25A outro
motivo 23 · Mulher em andamento 13 · Homem em andamento 6 · plus the two
`com recusa` variants. (The 2,958/2,422 in the original brief were an
earlier snapshot; acceptance numbers must be read at test time, never
hard-coded.)

**Other columns.** `amostra_biomarcadores`: Não 5,280 / Sim 1,860.
`status_coleta`: Finalizado 4,640 · Em andamento 1,437 · Não iniciado 1,063.
`ultima_posicao`: 6 values (Descarregado, Descarregado Parcialmente,
Distribuido, Enviado para Carga, Reentrevista, Supervisionado).
`situacao_entrevista`: 10 values.

**Invariants observed** (usable as data-quality checks, surfaced as
warnings, never as filters):
- `UPA sem Bio` never has `amostra = Sim` (0 of 2,959); `UPA com Bio e
  selecionado não elegível` and every `25A/25B` label always do.
- `Indefinido` never has `amostra = Sim`.
- `Não iniciada` splits Sim 563 / Não 1,858.

## Architecture

Three steps, each its own commit series. The first two are refactors
approved in review ("extract", "hoist") and touch working code; the suite
stays green after each.

### Step 1 — hoist the report POST into `common/`

Today the `/relatorio/filtrar` URL builder and POST loop exist twice
(`agenda-lookups.js` `filtrarUrl`/`postRelatorio`, and
`ultimo-movimento-export.js` `relatorioFiltrarUrl`/`fetchAgenciaReport`),
held together only by `tests/ultimo-movimento-url-parity.test.js`. Hoist
into `common/sigc-common.js` as:

- `relatorioFiltrarUrl(origin, pathname, slug, simple)`
- `postRelatorio({ slug, filtro, parse })`: tries the simple URL then the
  full F5 form, `credentials: 'same-origin'`, the form-post headers, and
  `referrer` (not a `Referer` header, which is forbidden and silently
  dropped) set to `{origin}{prefix}/relatorio/{slug}`. `parse` returns
  `null` for "table not recognised" → next URL.
- Both existing call sites migrate to it; the parity test is rewritten to
  pin the one builder against the captured URL shapes.

Side effect worth stating: `common/` is already fetch-sanctioned by
`scripts/check-privacy.sh`, so the **new feature directory needs no fetch
sanction and the privacy gate's `FETCH_DIRS` does not change**. The feature
only calls `window.__sigcPro.postRelatorio`.

Behaviour change to verify live: `ultimo-movimento-export` does not send a
`referrer` today; after migrating it will.

### Step 2 — extract the panel helpers into `common/sigc-panel.js`

From `ultimo-movimento-map.js` (4,138 lines), the parts that are not about
the map: PT-BR DataTables init and per-table setup (`initPanelTables`),
the per-column filter row (`colunasBatem`, `buildFiltroRow`,
`wireFiltroRow`), table→rows→CSV (`celulaParaTexto`, `conteudoDaCelula`,
`celulaHtmlParaTexto`, `linhasDaTabela`, `tabelaParaCsv`), table swap with
DataTables teardown (`substituirTabela`), and generic tab switching
(`switchToTab`, `wireTabs`'s generic half). Map-specific code
(`focusZonaOnMap`, `wireCartaButtons`, `recarregarSlots`) stays. Exposed on
`window.__sigcPro`; the map file consumes it from there. Existing map tests
are the regression guard. `manifest.json` load order (checked by
`manifest-load-order.test.js`): `sigc-common` → `sigc-panel` → features.

### Step 3 — the feature: `extension/features/gerenciamento-coleta/`

| File | Responsibility |
|---|---|
| `gerenciamento-parse.js` | HTML → `{rows, warnings}` (pure given a DOM) |
| `gerenciamento-aggregate.js` | rows + scope → summary, município, agência tables (pure) |
| `gerenciamento-report.js` | launcher, cache, panel, tabs, exports |

#### Fetch

`POST` via `postRelatorio` with
`{"IdFiltro":"relatorio-aprov-coleta-gerencial","IdUf":"<uf>","IdAgencia":"*","IdMunicipio":"*","Controle":"*","IdTipoAcompanhamento":"*"}`
as `filtro=<url-encoded JSON>`. Tipo Acompanhamento is always `*` (1/2/3
return subsets and its option loader 404s). UF is `#IdUf`'s value, falling
back to the UF in `#filtroJson`; no UF → alert and stop. URLs are built as
strings: URL-encoding helpers escape the `$$` and the portal answers 404,
and the `;` between the slug and `F5_origin` is part of the shape.

#### Parse

- Table is `#tableRelatorio`, found with `DOMParser`. **No table = zero
  rows**, not an error (the portal's answer for an empty scope).
- Header prefixes (`^`, `@`, `#!`, `!`) are stripped with `/^[#!^@]+/`, then
  accent-folded and `normalizeLabel`'d. **Fail closed**: a required header
  missing → `null` (try next URL, then a visible "tabela não reconhecida"),
  never a positional guess.
- `domicilio`: `String(parseInt(x, 10))` (`"03"` → `"3"`), the form every
  other report in this repo and pns.zonas uses.
- `municipio`: `controle.slice(0, 7)`, named via `common/municipios.js`.
- `agencia`: code from the `IdAgencia` column; name from `"code - NAME"`.
  Disagreement between the two is a warning.
- Duplicate `(controle, domicilio)`: the first row is kept, repeats are
  discarded and the panel warns — a repeat would be counted twice in every
  total.

#### Aggregation

All from the in-memory rows, recomputed on every scope change (≤ 9k rows;
no memoisation needed).

- **Scope:** agência (cascades the município list), município, Bio
  (Todos/Sim/Não). Applied to every tab. The UF total is always shown
  beside the scoped total ("1.240 de 7.140").
- **Resumo:** counts of `andamento`, with Bio split; the same for
  `status_coleta`, `situacao_entrevista`, `ultima_posicao`, and
  `amostra_biomarcadores`.
- **Município / Agência tables:** one row per município (agência), columns
  = stage buckets plus total; Bio/non-Bio split as a column group; each
  cell the count, with % of the row total on a toggle. Sortable.
- **Domicílios:** every row in scope, per-column filter boxes, sortable.

**Stage buckets** (derived in code, shown above the raw labels; proposed,
to confirm). Refusals are **never merged across stages**, because a refusal
before the questionnaire is finished and a refusal of the biomarker
collection are different operational problems (different people act on
them):

| Bucket | `andamento` labels |
|---|---|
| Não iniciada | Não iniciada |
| Todos os moradores em andamento | Todos os moradores em andamento |
| Selecionado(a) a realizar | Homem/Mulher selecionado(a) a realizar |
| Selecionado(a) em andamento | Homem/Mulher selecionado(a) em andamento (partes 13 a 24) |
| **Recusa no questionário** | Todos os moradores iniciada e interrompida por recusa; Homem/Mulher selecionado(a) com recusa (inicial ou durante entrevista) |
| Finalizada | Finalizada completa … UPA sem Bio; … UPA com Bio e selecionado não elegível |
| Bio 25A — agendada | 25A agendada |
| **Bio 25A — não agendada** | 25A não agendada |
| **Recusa Bio (25A)** | 25A (Bio) não iniciada por recusa |
| Bio 25A — outro motivo | 25A não iniciada por outro motivo |
| Bio 25B | 25B realizada; 25B não realizada |
| Indefinido | Indefinido |

A third refusal exists outside `andamento`: `situacao_entrevista = Recusa do
domicílio` (274 in BA; 192 of them have `andamento = Não iniciada`, i.e. the
household refused before any interview). It stays in the `situacao_entrevista`
breakdown and gets its own column in the Município/Agência tables, labelled
*Recusa do domicílio*, so the three refusal kinds read side by side and are
never summed. Raw `andamento` labels stay available as the finest grain in
every table (a toggle, not a replacement).

**Unknown labels.** A label not in the known set is never dropped or
folded: it gets its own column/row after the known ones, flagged *novo*, is
counted in a visible warning ("2 rótulos novos de andamento: …"), and lands
in bucket *Outros*. Invariant: for every table, the sum of its cells equals
the scoped row count. The same rule applies to `status_coleta`,
`situacao_entrevista` and `ultima_posicao`.

#### Cache and refresh

In-memory `Map` keyed by UF, 5-minute TTL (the Agenda cache's policy), no
storage (sigc-pro's gate bans it everywhere). The panel header shows
"dados de HH:MM" and an **Atualizar** button that bypasses the cache.
Opening the panel inside the TTL costs no request. The only request
is the one the user's click causes, to SIGC's own origin, so no
confirmation dialog (CSV TODAS confirms because it makes N requests).

#### Launcher and panel

A small form button inserted right after `#btnFiltrar` (`makeSigcFormButton`,
as CSV TODAS), labelled "GEREN-PRO".
Panel: tabs Resumo / Município / Agência / Domicílios, scope bar on top,
warnings strip, Atualizar, CSV of the current tab (existing
`buildCsv`/`downloadFile`; blanks, not em-dashes, as the other exports).

#### Privacy

Same-origin request only; no names, addresses or phones in this report —
`controle` + `domicilio` are household identifiers, already in every other
export. Nothing stored, nothing sent elsewhere. Privacy policy and manual
get a paragraph; no policy change in substance.

## Tests

bun + happy-dom, `tests/gerenciamento-*.test.js`, fixture
`tests/fixtures/gerenciamento-coleta.html`.

- **Fixture is synthetic**, in the recorded shape: real column headers with
  prefixes (`^UF, @IdUf, Agência, ^@IdAgencia, #!Controle, !Domicílio, …`),
  ~30 rows with fabricated controles (real município codes, invented
  sequence digits), covering all 18 known `andamento` labels, both Bio
  values, and one row with an unknown label. Real controles stay out of the
  repo.
- Parse: prefix stripping; `"03"` → `"3"`; município from controle;
  agência code/name split and mismatch warning; empty response (no table)
  → zero rows; missing required header → `null`; duplicate key warning.
- Aggregate: sum of every table's cells equals scoped rows; agência rows
  sum to UF; município rows sum to UF; scope cascade; unknown label gets
  its column, is flagged, and keeps the sum invariant; Bio split.
- Fetch: URL shape against the captured URL (`;F5_origin=` and unescaped
  `$$`), body JSON, `referrer`, simple→full fallback, `null` parse → next
  URL.
- Cache: second open inside TTL makes no request; Atualizar does.
- Hoist: the rewritten parity test; both migrated features' existing tests.
- Extract: existing map/panel tests unchanged and green.
- `manifest-load-order.test.js` and `scripts/test-privacy-gate.sh` pass
  unchanged (no new fetch directory).

**Manual acceptance (BA, live):** panel UF total equals the native grid's
row count for the same UF (7,140 at the time of writing); Sim equals the
Último Movimento Bio count (1,860); stage and label counts match
`gerenciamento_coleta.parquet` for the same moment.

## Not in scope

- History / progression over time. sigc-pro keeps no storage by design;
  pns.zonas already keeps the SCD history of this table on the R side. If
  the panel should show progression, that belongs in a sister extension
  with storage (munic-pro's reasoning), or in a snapshot download/import —
  a separate decision.
- Entrevistador, zona, coordinates, the Carta de notificação.
- The Tipo Acompanhamento filter.

## Open questions

Resolved 2026-10-15: anchor is `#btnFiltrar` (page DOM supplied; detection by
slug, above); point-in-time view is enough for now; the `referrer` added to
CSV TODAS is acceptable provided it does not affect the Chrome Web Store
review (it changes no permission, host or data-handling statement; same-origin
request headers only); the `#filtroJson` fallback for UF is enough.

Also resolved: `#IdUf` is confirmed (the page renders select2's
`select2-IdUf-container`, "29 - BAHIA", over the hidden `<select id="IdUf">`
whose `.value` is the UF, same as Último Movimento); 25A *não agendada* is
its own bucket. No open questions remain except the final bucket wording,
which is settled at review of the implementation.

Update 2026-10-15: counts and percentages are a single "Valores" switch
(Contagem / % da linha), not a checkbox adding both to every cell; in the %
view Domicílios stays a count and the CSV carries the bare percentage.
Homem and Mulher share one stage column; the raw-label toggle separates them.

## Revision 2026-10-15 (after first use)

Supersedes the earlier tab, bucket and scope descriptions above.

- **Tabs:** Domicílios (opens first) · Município · Agência. No Resumo tab: it
  did not pay off. Warnings (new labels, odd Bio values) sit in a strip above
  the tabs.
- **Columns:** one per portal `andamento` label present in the scope — known
  labels in funnel order (Mulher after Homem), unknown ones after, flagged
  *novo*. The stage buckets are gone: the portal labels are what the
  coordinators read. The household refusal (`situacao_entrevista = Recusa do
  domicílio`) stays a separate column, never summed with the others.
- **"Não iniciada"** is shown as **Sem entrevista iniciada**, with a tooltip.
  In BA (2,429 rows) it holds both households not yet visited (Distribuído,
  baixada no DMC, agendado) and those already closed out without an interview
  (fechado, vago/uso ocasional, recusa do domicílio, fora de âmbito, outro
  motivo): "no part of the questionnaire started", not "not yet visited".
- **Scope:** only Amostra Bio (Todas/Sim/Não). The agência and município
  selectors above the tables were dropped (the per-column filters cover
  them). With Bio filtered, the Bio Sim/Não columns and the Amostra Bio
  column are hidden as redundant.
- **Domicílios** carries the município name (the code is in the Controle).
- **Valores:** Contagem / % da linha. Numeric headers declare
  `data-sigc-type="num"` so DataTables does not auto-detect "12,3%" cells as
  text (which sorted "100" before "33,3" in some columns only).
- **Cache:** unchanged, in memory, 5 minutes, Atualizar bypasses it.
- **Sort keys:** `data-order` values are fixed-width and zero-padded
  (`033.3333`, `100.0000`, `0000123`), so they sort correctly whether
  DataTables types the column numeric or text. Verified against DataTables
  1.10.22: with a text-typed column, plain numeric keys sort
  `0 1 100 12,5 33,3 5 50 7 9`; padded keys sort `0 1 5 7 9 12,5 33,3 50 100`.
  A claimed table (initialised first by the page's own script) whose headers
  declare a type is destroyed and rebuilt so the type applies.
  Second layer, verified the same way: with only the displayed text
  ("12,5%"), DataTables 1.10.22 auto-types the column as text and sorts
  `0 1 5 7 9 50 100 12,5 12,9 33,1 33,3` (integers first, decimals after —
  right for a column of whole percentages, wrong otherwise), and forcing
  `type: 'num'` alone sorts worse. The shared panel therefore gives every
  `data-sigc-type="num"` column a `render` that returns the number read from
  the cell for sort/type (comma or dot, `%` ignored) and the cell untouched
  for display/filter, so sorting no longer depends on `data-order` being
  honoured.
