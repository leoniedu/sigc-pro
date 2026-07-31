# Lista de Endereços × Agenda — design

Annotate the Lista de Endereços (selecionados view) with scheduling data
pulled from the Agenda: whether each household has a scheduled interview,
and how many bookable slots remain in its zonas.

Two questions, one data source:

1. **Per household** — is there a scheduled interview (past or future),
   and when? Rendered as a new "Agendado" column.
2. **Per Controle** — how many future open slots are assigned to the
   zonas these households belong to? Rendered as a header line above the
   table, not a column: the Lista de Endereços is scoped to one Controle,
   so every row would repeat the same number.

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

This is the third module to contain `fetch(`. The privacy gate's
allowlist currently names two and a tripwire test asserts it; both need
updating, and that edit is a privacy decision to be argued in its own
commit — not a formality.

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

In-memory `Map` keyed by UF, holding the parsed slots plus a fetch
timestamp. **5-minute TTL**; a request after expiry refetches
transparently. Never persisted — the zero-storage guarantee holds.

A TTL is needed here where `agenda-map`'s per-Controle cache has none:
coordinates do not change within a page's life, but someone else booking
a slot makes these counts wrong.

## Failure modes

The feature is additive, so failures degrade to "no annotation" rather
than a broken page:

- **Fetch fails** — alert naming the reason; table untouched, no column
  added.
- **User declines the confirm** — nothing happens, no annotation.
- **Controle not found in the agenda** — `—`, same as not scheduled.
- **Row with a blank `ID Zona`** — contributes nothing to the zona index
  rather than being counted under an empty key.

## Testing

Unit tests against fixture JSON, following the existing pattern:

- The two index builders (by Controle, by zona ID).
- The open test (title with and without a `Controle:` line).
- The prazo filter, including the Friday +4 case.
- Weighted counts, including the suppression rule when nothing is shared.
- ID-Zona extraction against production-shaped entries.
- The live/past date choice for a household with both.

The fetch itself stays untested, as `agenda-map`'s does. This is a known
gap, recorded rather than papered over.

## Module

`extension/features/lista-agenda/lista-agenda.js`, registered in
`manifest.json` after `common/` and before the other Lista features. The
manifest load-order test covers the ordering contract.

Reused unchanged: `parseAgendaSlotTitle`, `parseZonaEntries`,
`agendaMinScheduleDate`, `f5Prefix`/URL shaping, `mountWidget`,
`makeDtProButton`, `escapeHtml`.

## Deliberately excluded

- **Writing to the agenda.** Read-only; booking stays in the portal.
- **The `status` enum.** Undocumented; the title test replaces it.
- **Auto-fetch on page load.** Consent first, always.
- **Persisting the cache.** Would break the zero-storage guarantee.
