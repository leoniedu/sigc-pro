# Lista de Endereços × Agenda + Último Movimento — design

Annotate the Lista de Endereços (selecionados view) with data the page
does not carry: whether each household has a scheduled interview, where
it stands in collection, and how many bookable slots remain in its zonas.

Three questions, two sources:

1. **Per household** — is there a scheduled interview (past or future),
   and when? Rendered as a new "Agendado" column. *(Agenda)*
2. **Per household** — where does collection stand? Rendered as
   "Situação" and "Transmissão" columns. *(Último Movimento)*
3. **Per Controle** — how many future open slots are assigned to the
   zonas these households belong to? Rendered as a header line above the
   table, not a column: the Lista de Endereços is scoped to one Controle,
   so every row would repeat the same number. *(Agenda)*

Both sources key on **(Controle, Domicílio)**, the same key the table's
rows use, so the two annotations join cleanly onto one row.

## The endpoint

`GET /AdministracaoAgenda/ObterSlots?idUf=&start=&end=&semana=true&idEquipe=`

Returns JSON — no rendered calendar needed, which is what makes this
feature possible from the Lista de Endereços page at all. Every existing
agenda feature reads FullCalendar DOM, which exists only on the Agenda
page.

Prior art: `pns.zonas/R/sigc_agendamentos.R` (`fetch_agendamentos`), a
working client for this endpoint. Two things carry over from it:

- **Build the query string by hand.** Percent-encoding the `$$` in the F5
  path segments turns the URL into a 404. The R client documents this as
  a deliberate departure from its usual query builder.
- **Required headers:** `X-Requested-With: XMLHttpRequest` and
  `Referer: <base>/AdministracaoAgenda`.

The endpoint sits behind the same `f5-h-$$` rewrite `agenda-map.js`
already handles; reuse `f5Prefix`/URL-shape logic rather than re-deriving
it.

**Range:** current year start → next year start (the R client's default).
One UF-wide call answers both questions. "Scheduled whenever, past or
future" requires the full year; a narrower window would silently miss
older interviews.

### Response fields used

Per slot: `start`, `title`, and nothing else. `id`, `end`, `resourceId`,
`status` and `backgroundColor` are read past and discarded.

`title` is the same newline-separated `"Label: value"` blob the Agenda
DOM carries, so `parseAgendaSlotTitle` handles it unchanged. Fields used:
`Controle`, `Domicílio`, `Zonas`.

### Personal data

The response carries name, sex, birth date, address and telephone per
slot — **more** personal data than the coordinates fetch this extension
already makes. Discard everything except Controle, Domicílio, Zonas and
start **at the parse boundary**, so no richer object is ever held in
memory or reachable from a later change.

This is the third module to contain `fetch(`, and it makes **two**
requests. The privacy gate's allowlist currently names two modules and a
tripwire test asserts it; both need updating, and that edit is a privacy
decision to be argued in its own commit — not a formality.

Weigh it on what actually changes. Neither request reaches a new host or
a new endpoint family: both go to the SIGC's own origin, inside the
user's existing session, and `/relatorio/filtrar` is already called by
two shipped features. What is new is **breadth** — `ObterSlots` returns a
UF-wide year of slots, where every prior fetch was scoped to one Controle
— and that breadth is why the response must be narrowed at the parse
boundary rather than held whole.

## The second source: Último Movimento

`POST /relatorio/filtrar` with the Último Movimento payload — the same
endpoint family the extension already calls, reached through the same
`fetchViaGateway` helper.

**One request per Controle, not per agência.** The multi-agência export
loops one request per agência with a 2-second gap, which is why it hides
behind an off-by-default flag. This is a single request: the existing
`buildAgenciaFilterBody` already builds a `filtro` object whose
`Controle` field is hardcoded to `'*'`; setting it to the real Controle
returns every domicílio of that Controle in one response. Nothing else
about the payload changes.

`parseUltimoMovimentoHtml` parses the response unchanged (DOMParser,
inert — nothing in the fetched markup can load resources or run
handlers).

**Fields used:** `ultima_posicao` (the status) and `data_transmissao`,
keyed by `(controle, domicilio)`. The column vocabulary comes from
`pns.zonas/R/sigc_movimento_db.R`, which persists exactly:
`controle, domicilio, tipo_entrevista, ultima_posicao, data_transmissao,
id_uf, id_agencia`.

### Reusing the gateway helper

`ultimo-movimento-export.js` already generalised the F5 handling:
`gatewayUrl(origin, pathname, path, simple)` takes an **arbitrary path**,
precisely because that feature calls two endpoints. Both fetches here use
it — `ObterSlots` included — rather than duplicating F5 logic a third
time. The two-attempt strategy (simple prefixed path, then the fuller
`f5-h-$$` form) carries over unchanged, since which form the live gateway
needs is not knowable in advance.

Extracting the helper into `sigc-common.js` is the obvious tidy-up, but
it moves code across the privacy gate's module boundaries and belongs in
its own commit, not this one.

## Open vs reserved

An open slot's title has **no `Controle:` line**. That is the test.

The calendar DOM distinguishes open slots by the CSS class
`evento-reservado`, which does not exist in JSON. The R client captures a
numeric `status` field but never decodes its values, and neither repo
documents them — so `status` is deliberately unused rather than guessed
at. A wrong enum mapping would silently invert every count.

## Zona matching

Exact string match on the ID Zona, present on both sides:

- **Row:** Lista de Endereços column 18, `ID Zona` (e.g. `29JDM8`).
- **Slot:** leading token of each entry in the `Zonas` field, e.g.
  `Zonas: 29JDM8 - 29.2.01.02 29_Linus_Lauro, 29LR9E - 29.2.01.01
  29_Linus_Lauro` → `29JDM8`, `29LR9E`.

Split entries with `parseZonaEntries` (comma), then take the part before
the first `" - "`. `zonaSortKey` already isolates the remainder for
sorting; the ID is the complement of that split.

## Counting free slots

A slot counts as free when it is **open** (no `Controle:` line) **and**
starts on or after the prazo mínimo — +3 days, +4 on Fridays. Call
`agendaMinScheduleDate`, the same function Verificar Slots and Slots
Abertos use, so the three cannot drift apart.

### Weighted counts

A slot listing several zonas is shared. Report the **whole count** as the
headline, and the weighted share (`1/n_zonas` per slot) **only where a
zona's slots are actually shared** — the same suppression rule Slots
Abertos uses for its grey line.

Rationale: in Slots Abertos, weighting exists so zona rows reconcile with
a TOTAL row. There is no TOTAL row here, so the weighted figure has no
arithmetic to protect; it carries information only about contention. In a
per-Controle view the competing zonas are off-screen, so an unconditional
weighted number would be unreadable — a reader cannot tell whether the
competition is real or theoretical. Showing it only where sharing exists
means it appears exactly when it says something.

## Presentation

### "Agendado" column

One column appended to the DataTable. Value: the scheduled date for that
row's Controle + Domicílio, or `—`.

A household may be scheduled more than once over time, but **only one
schedule is live at any point**. So: show the live (future) date when one
exists; otherwise the most recent past date, visually distinguished so a
completed interview does not read as an upcoming appointment. No
"(+n)" multiplicity marker is needed.

`—` means "nothing booked", which is also what an unmatched Controle
produces. The two are indistinguishable and that is correct.

### "Situação" and "Transmissão" columns

Two further appended columns, from Último Movimento, matched on the same
`(Controle, Domicílio)` key:

- **Situação** — `ultima_posicao` verbatim. Not abbreviated or
  re-worded: it is the portal's own vocabulary, and paraphrasing a status
  someone acts on invites a wrong reading.
- **Transmissão** — `data_transmissao`, or `—`. Split from Situação
  rather than combined into one cell, since the date is meaningful only
  for some positions and a combined cell would imply otherwise.

Same `—`-means-absent rule as the Agendado column. A household present in
the table but missing from the movement report has not moved yet, which
`—` states correctly.

**Appended at the end**, never inserted. Column indexes 0–19 stay intact,
which matters:

- **PDF/KML** read fixed indexes from `pesquisa.columns` — unaffected by
  an appended column.
- **CSV** reads the live table generically and will therefore *gain* the
  new column in its output. Intended, but verify.

The PDF export already carries a shifted-column workaround from an
earlier column-index change, so column positions are load-bearing in this
codebase. Appending is the safe choice; the exports still need checking
against the new column set.

### "Slots livres" header

A summary line above the table, listing only the zonas this Controle's
households actually belong to (collected from the rows' `ID Zona`), not
the whole UF:

```
Slots livres (a partir de 03/08) · dados de 09:31
29JDM8 29_Linus_Lauro: 12 (3,0 ponderado)   29LR9E …: 4   29TBAN …: 0
```

The fetch time is shown so a stale count is self-explaining — copied from
the R client's `sigc_stamp`/`sigc_fetched_at`. A wrong free-slot count
leads to a real double-booking, so staleness must be visible.

## Gating

**Selecionados view only.** This is a correctness requirement, not a
preference: `agenda-map.js` documents that zona columns are populated
only for selecionado households. On the completos view `ID Zona` is blank
for non-selecionados, so the zona index would silently under-count.

**Click + confirm**, no request on page load. The confirm message must
describe what this fetch actually does — it queries the agenda for the
whole UF and year, a broader request than the per-Controle coordinates
fetch, and the wording should not imply otherwise.

## Caching

Two caches, because the two sources go stale for different reasons and
at different rates. Both in-memory, never persisted — the zero-storage
guarantee holds.

- **Agenda** — keyed by UF, **5-minute TTL**. Someone else booking a slot
  makes the free-slot counts wrong, and that can happen at any moment.
- **Último Movimento** — keyed by Controle, **5-minute TTL** as well, but
  tracked separately with its own timestamp. Movement status changes when
  a field team transmits, not continuously.

A TTL is needed here where `agenda-map`'s per-Controle cache has none:
coordinates do not change within a page's life, but both of these do.

Each cache carries its own fetch time, and the header line shows both
when they differ — one timestamp covering two independently-aged sources
would be a lie about whichever is older.

## Failure modes

The feature is additive, so failures degrade to "no annotation" rather
than a broken page:

- **User declines the confirm** — nothing happens, no annotation.
- **Controle not found in the agenda** — `—`, same as not scheduled.
- **Row with a blank `ID Zona`** — contributes nothing to the zona index
  rather than being counted under an empty key.

**One source fails, the other succeeds** — annotate with what did arrive
rather than discarding both. The two fetches are independent, so a failed
Último Movimento request must not cost the user their Agendado column.
The failed source's columns show `—` and the header names which source
failed, so an all-`—` column is never mistaken for "nothing scheduled".

**Both fail** — alert naming the reasons; table untouched, no columns
added.

This is the main reason the two fetches run independently rather than
inside one `Promise.all` that rejects as a unit.

## Testing

Unit tests against fixture JSON, following the existing pattern:

- The index builders (agenda by Controle, agenda by zona ID, movimento by
  Controle+Domicílio).
- The open test (title with and without a `Controle:` line).
- The prazo filter, including the Friday +4 case.
- Weighted counts, including the suppression rule when nothing is shared.
- ID-Zona extraction against production-shaped entries.
- The live/past date choice for a household with both.
- The `Controle: '*'` → real-Controle payload change, asserted against
  the existing `buildAgenciaFilterBody` shape.
- Partial failure: one source's index empty, the other populated, still
  annotates the rows it can.

The fetch itself stays untested, as `agenda-map`'s does. This is a known
gap, recorded rather than papered over.

## Module

`extension/features/lista-agenda/lista-agenda.js`, registered in
`manifest.json` after `common/` and before the other Lista features. The
manifest load-order test covers the ordering contract.

Reused unchanged: `parseAgendaSlotTitle`, `parseZonaEntries`,
`agendaMinScheduleDate`, `gatewayUrl`/`fetchViaGateway` (the
arbitrary-path F5 helpers from `ultimo-movimento-export.js`),
`parseUltimoMovimentoHtml`, `buildAgenciaFilterBody` (with `Controle`
set to the real value), `mountWidget`, `makeDtProButton`, `escapeHtml`.

### Internal seams

Build this as three stages with explicit boundaries, not one straight
line from fetch to DOM. Two sources land at once and a third rendering is
already anticipated, so the seams carry real weight:

1. **Acquire** — one function per source, returning parsed plain objects.
   Knows about URLs, headers and the F5 rewrite; knows nothing about the
   table. The two run independently so either can fail alone.
2. **Index** — pure functions from parsed responses to lookup maps
   (agenda by Controle, agenda by zona ID, movimento by
   Controle+Domicílio). No DOM, no network. This is where the unit tests
   live.
3. **Render** — reads indexes, writes the columns and the header line.
   Takes indexes as arguments rather than fetching for itself, and
   tolerates an empty index (that is the partial-failure path).

The annotation applied to a row is an object
(`{ agendado, situacao, transmissao }`), not a bare string, so a further
source adds a key rather than changing the column-writing signature.

## Deliberately excluded

- **Writing to the agenda.** Read-only; booking stays in the portal.
- **The `status` enum.** Undocumented; the title test replaces it.
- **Auto-fetch on page load.** Consent first, always.
- **Persisting the cache.** Would break the zero-storage guarantee.

## Possible follow-up (deferred, not scoped)

### Calendar of open slots

A date-grid view of when the free slots actually are, rather than only
how many. Free-slot counts naturally provoke "yes, but when?", so this
is the likeliest next addition.

Needs **no new fetch**: the same `ObterSlots` response already carries
every open slot's `start`. Purely a third rendering off an index this
spec already builds — which is what the render seam above is for.

Note it partly duplicates the portal's own Agenda page; the reason it
would belong here is that the user is on the Lista de Endereços and does
not want to leave it. A real justification, but a narrow one — worth
confirming against use before building.

## What is proven vs inferred

`ObterSlots` is well established, from two independent directions:

- **`2026-07-16-agenda-csv-export-design.md`, in this repo.** Names the
  endpoint and its query parameters, confirmed live (test env,
  `SIGC - PNS2026`, UF Bahia, week of 2026-07-05). Its addendum settles
  the key question here: an open slot's title is **only** `"Zonas: …"` —
  no Controle, Domicílio or Nome, since nothing is assigned yet. That is
  exactly the open-vs-reserved test this design uses, verified by
  testing rather than inferred.
- **`pns.zonas/R/sigc_agendamentos.R`.** Working code against real
  responses: the hand-built query string, the XHR/Referer headers, and
  the field names (`id`, `start`, `end`, `resourceId`, `status`,
  `backgroundColor`, `title`).

The title blob's grammar is likewise documented from a real sample:
`Label: value` per line, split on the **first** colon only (`Endereço`
contains more), empty fields rendered as a literal `" - "` that
`MISSING_VALUES` collapses, `Idade` present only when `Dt. Nascimento`
is. `parseAgendaSlotTitle` already implements all of it.

**One residual inference:** those title samples are from the rendered
DOM. The R client parses the JSON `title` with the same grammar, so the
two are near-certainly identical strings — the DOM title is populated
from this response — but a JSON open-slot title has not been eyeballed
directly. Worth one look while wiring up the fetch; not a design risk.

The F5 path from this context is unconfirmed, but `fetchViaGateway`'s
two-attempt strategy exists for exactly that uncertainty.

## Reversing a prior decision

`2026-07-16-agenda-csv-export-design.md` considered calling `ObterSlots`
and **deliberately declined**, on the grounds that re-issuing the call
would violate the privacy gate and the "no data leaves your computer
beyond what SIGC itself already sent" guarantee. `agenda-csv-export`
reads rendered DOM specifically to avoid it.

That reasoning is not binding today — the guarantee has since moved, and
two shipped features make same-origin fetches under a click-and-confirm
posture the July 16 design did not have. But this spec reverses a
documented decision rather than filling a gap, and the reversal should be
argued explicitly in the implementing commit:

- The original objection was to fetching **at all**; the extension now
  fetches, behind consent, and says so in its privacy policy.
- The July 16 alternative (read rendered DOM) is unavailable here: there
  is no calendar on the Lista de Endereços page. The choice is fetch or
  drop the feature, not fetch or scrape.
- What genuinely changes is **breadth** — a UF-wide year, where every
  prior fetch was Controle-scoped. That is the part to justify, and why
  the response is narrowed at the parse boundary.
