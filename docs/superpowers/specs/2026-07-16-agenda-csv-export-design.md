# Agenda CSV Export — Design (quick)

Date: 2026-07-16
Status: draft
Depends on: `2026-07-14-sigc-pro-extension-design.md` (privacy gate,
`whenReadyGeneric`), `2026-07-15-csv-export-design.md` (CSV build/escape/
download conventions)

## Problem

`AdministracaoAgenda` (Coordenação > Distribuição > Administrar Agenda)
shows a weekly/daily calendar of collection slots per equipe. There's no
way to get that data out as a spreadsheet — coordinators want a CSV of
every slot currently on screen, including the per-slot details (Controle,
Domicílio, endereço, etc.) that SIGC only exposes as a free-text blob
inside each event's title.

## Data source — no network calls, same constraint as every other feature

SIGC-PRO makes zero outbound requests by design (README, `scripts/
check-privacy.sh` — a pre-commit/CI gate that fails the build if `fetch(`,
`XMLHttpRequest`, etc. appear anywhere in `extension/`). The calendar is
populated by `AdministracaoAgenda/ObterSlots?idUf=…&start=…&end=…&semana=…
&idEquipe=…`, fired by the page itself whenever the UF/date range/view
changes. Re-issuing that call from the extension (even read-only) would
violate the gate and the "no data leaves your computer beyond what SIGC
itself already sent" guarantee — so, like `csv-export.js` reading the
DataTables API instead of re-fetching a report, this feature reads the
**already-rendered calendar DOM**, built from data the page already
fetched. The exported CSV always matches exactly what's on screen; to
export a different week/UF/equipe, the user changes the view (as normal)
and clicks the button again.

Confirmed live (test env, `SIGC - PNS2026`, UF Bahia, week of 2026-07-05):
the calendar is FullCalendar's **resource time-grid** view
(`fc-resourceTimeGridWeek`/`fc-resourceTimeGridDay`, i.e. the premium
resource plugin — self-hosted under `lib/fullcalendar/`, not from FC's own
CDN). One `Calendar` instance renders one grid; each column is
`.fc-timegrid-col[data-resource-id][data-date]` (resource = equipe uuid,
matching `#selectEquipes`'s `<option value>`; date = `YYYY-MM-DD`), and
each reserved slot is a descendant `.fc-timegrid-event.evento-reservado`.
The instance itself isn't reachable from a content script (no exposed
global — internal to the page's bundle), so events are read via DOM
traversal rather than a `getEvents()`-style API call, same posture as
`readDataTable()` not touching pdfMake/DataTables internals it doesn't
need.

## Slot fields — parsing the title blob

Each event's `.fc-event-title` is plain text (not HTML), one `Label:
value` pair per line, e.g. (real test-env sample):

```
Zonas: 29001001 - Lab 1 Oeste, 29001002 - 29001002
Controle: 292740805060337
Domicílio: 1
Nome:  - 
Sexo:  - 
Dt. Nascimento:  - 
Endereço: RUA RODOLFO COELHO CAVALCANTI, Nº: 237: - Compl: APARTAMENTO 303 PREDIO B  - SALVADOR
Telefone: 
Observação: são Francisco do conde
```

Observations that shaped the parser:

- An empty field isn't an empty line — SIGC renders it as literal `" - "`,
  which trims down to `-`. Reuses `window.__sigcPro.MISSING_VALUES`
  (`['-', '']`) so this collapses to blank, same sentinel used everywhere
  else in SIGC-PRO (e.g. `parseCoord`).
- `Idade` only appears when `Dt. Nascimento` is filled (server computes it;
  the line is just absent otherwise) — parsing is key/value by line, not
  positional, so an optional line doesn't shift anything.
- `Endereço`'s value itself contains extra `:` (`Nº: 237:`, `Compl:`) —
  splitting only on the **first** `:` per line handles this correctly.
  Deliberately **not** sub-parsed into logradouro/número/complemento/
  bairro columns (unlike the Lista de Endereços table, which has those as
  separate DataTable columns): the title's address formatting has enough
  quirks (e.g. that trailing `Nº: 237:`) that decomposing it would be
  guessing at an undocumented template. One raw `Endereço` column is more
  honest and just as usable.
- Confirmed stable across different equipes/dias in the test data — same
  9-10 labels, same order, only `Idade` conditional.

## Column mapping (event -> row)

- **Data**: the containing column's `data-date` (`YYYY-MM-DD` -> `DD/MM/
  YYYY`).
- **Equipe**: the column's `data-resource-id`, looked up against the
  calendar's own resource header cells (`[data-resource-id].fc-col-header-
  cell`), falling back to `#selectEquipes`'s `<option>` text if a header
  cell is missing for some resource.
- **Hora Início / Hora Fim**: `.fc-event-time` text (`"08:00 - 08:40"`),
  split on `-`.
- Everything else: parsed from `.fc-event-title` as above.

Rows are sorted by date, then hora início, then equipe — DOM order roughly
follows column layout already, but this makes it deterministic regardless
of how FullCalendar orders resources internally.

## Gating

Per the feature request, this isn't limited to one `ibge.gov.br` host or
one pesquisa (unlike Lista de Endereços' PDF/KML, which validate against
`PESQUISAS.PNS2026`): it activates on **any** page whose
`location.pathname` ends with `/AdministracaoAgenda` (case-insensitive,
trailing slash tolerated) — confirmed this holds even behind the F5 proxy
rewrite (`location.pathname` is the *decoded* logical path, e.g.
`/f5-w-<base64>$$/AdministracaoAgenda`). Button insertion additionally
requires FullCalendar's own Dia/Semana view-switch buttons to exist
(`whenReadyGeneric`, same never-give-up polling `csv-export.js` uses,
since the calendar can take a moment to render after UF selection).

## Button + re-insertion

Inserted into the same `.fc-toolbar-chunk` FullCalendar renders its own
Dia/Semana/"Habilitar Exclusão em Massa" buttons into, styled with FC's own
`fc-button fc-button-primary` classes (correct box metrics for free) plus
the SIGC-PRO blue override, same reasoning `csv-export.js` uses for
`dt-btn-icon`.

FullCalendar's toolbar is virtual-DOM diffed (Preact-based), so it can
rebuild on view/date navigation and silently drop a foreign button — the
same failure mode noted in `ROADMAP.md` for the Lista de Endereços
toolbar. Same fix: idempotent insert (`getElementById` guard) + a
`MutationObserver` on `document.body` re-inserting whenever needed.

## CSV format

Same conventions as `csv-export.js`: `;`-delimited (pt-BR Excel), RFC
4180-style quoting via the now-shared `window.__sigcPro.escapeCsvField`/
`buildCsv`/`downloadFile` (moved from `csv-export.js` into
`sigc-common.js` as part of this change, since a second CSV feature made
the duplication worth removing), UTF-8 BOM.

Header (pt-BR, matches the on-screen labels where the title uses them):
`Data;Equipe;Hora Início;Hora Fim;Controle;Domicílio;Nome;Sexo;Dt.
Nascimento;Idade;Endereço;Telefone;Zonas;Observação`

Filename: `sigc-pro-agenda_<uf>_<período-do-cabeçalho>_<hora>.csv` — UF
from `#selectUf`'s selected option text, período straight from
`.fc-toolbar-title` (e.g. `12/07/2026 – 18/07/2026`), both slugified
(diacritics stripped, non-alphanumerics -> `-`).

## Component layout

```
extension/features/agenda-csv-export/agenda-csv-export.js   # new
extension/common/sigc-common.js                              # + buildCsv/escapeCsvField/downloadFile (shared)
extension/features/csv-export/csv-export.js                   # now calls the shared helpers instead of its own copies
```

## Out of scope

- Multi-week aggregation (fetching weeks beyond what's currently loaded) —
  would require a new network call, which the privacy gate forbids; the
  user navigates + re-exports per week/day instead, same as CSV-pro export
  scope on other reports.
- Sub-parsing `Endereço` into separate columns (see above).

## Addendum 2026-07-16: open slots also export, and are distinguishable

Corrected after further testing: open/unbooked slots (created via "Criar
Slot", not yet matched to an address) **do** render as discrete
`.fc-timegrid-event` elements — they're just missing the `evento-reservado`
class, and their title is only `"Zonas: …"` (no Controle/Domicílio/Nome/
etc., since nothing's assigned yet). `readAgendaSlots()` picks these up
too (matching "all the slots"), and now tags each row with a `reservado`
boolean so callers can filter either way — used by
`agenda-lead-time-alert.js` (see
`2026-07-16-agenda-lead-time-alert-design.md`) to isolate just the open
ones.

`onAgendaPage`, `findAgendaToolbarChunk`, `parseAgendaSlotTitle` (renamed
from `parseSlotTitle`), `isoToBr`, `getAgendaEquipeNames` (renamed from
`buildEquipeNames`), and `readAgendaSlots` itself moved from
`agenda-csv-export.js` into `sigc-common.js` at this point, once a second
Agenda feature needed the same reading logic — same rationale as the CSV
helpers move in the original design above.
