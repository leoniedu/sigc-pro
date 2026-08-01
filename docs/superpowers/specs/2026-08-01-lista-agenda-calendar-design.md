# Lista de Endereços agenda — maps, tipo de entrevista, free slots

Three additions to the AGENDA PRO export
(`2026-07-31-lista-agenda-design.md`). None needs a new network request:
every field comes from data already on screen or already fetched and
currently discarded.

1. **Google Maps link per domicílio** — from the Lista de Endereços'
   own Latitude/Longitude columns.
2. **Tipo de Entrevista column** — already in the Último Movimento
   response, currently parsed past.
3. **Free slots for the next 2 weeks** — per-turno counts as the
   headline, with the individual open slots listed beneath, from the
   `ObterSlots` response the existing free-slots line already uses.

## A calendar was designed and then rejected

An earlier draft of this spec specified a day × half-hour grid of the
zona's slots. It was dropped before implementation, for reasons worth
recording so it is not proposed again:

- **Occupied slots are already in the household table** below it in the
  same file. Rendering them a second time is duplication, not context.
- **The actual question is a count, not a grid**: "are there free slots,
  per turno, in the next two weeks?" A 14-day grid is a large, mostly
  empty artifact answering something you can read in one line.
- **Multiple equipes share a zona**, so a day × time grid needs a third
  axis (or anonymous stacking, which reads as duplicates). That cost
  buys nothing once the question is a count.

What replaces it — turno counts plus a list of the OPEN slots grouped by
day — keeps the useful half. The distinction that matters: a list of
bookable slots is what you read to pick one, where a grid of every slot
mostly re-renders the household table. It needs no `end` field and no
`resourceId`.

## 1. Google Maps link

Latitude and Longitude are columns 10 and 11 of the table on screen, so
this is a rendering change only.

The link goes **on the address text**, not in a new column: the table
already carries five columns and a sixth of repeated "abrir no mapa"
would be noise.

Rows whose coordinates do not parse render the address as plain text —
never a dead link. Use `window.__sigcPro.parseCoord` (already exported;
it handles the DMS forms SIGC emits and returns null on junk).

URL shape: reuse `gmapsRouteUrl`'s single-destination form —
`https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=<lat>,<lon>`.
See "Shared helpers" below; do not invent a different URL.

## 2. Tipo de Entrevista

Confirmed present in the live Último Movimento header, captured from the
browser console on 2026-07-31:

```
["Controle","Domicilio","Entrevistador","Tipo de Entrevista",
 "Última Posição","Data","Observação"]
```

`indexMovimento` gains one `acharColuna(header, 'Tipo de Entrevista')`
lookup alongside the existing four, carries the value through
`annotateRow`'s returned object, and the export renders it as a column
**next to Situação** — the two describe the same thing and read together.

Absent column ⇒ same treatment as the others: the household's value is
`''`, rendering as `—`. It joins the existing `colunasNaoEncontradas`
signal so a layout change still surfaces to the user rather than
silently emptying a column.

## 3. Free slots for the next 2 weeks

The panel and the export already carry a free-slots line per zona, e.g.
`29JDM8: 12 (3,0 ponderado)`. Two changes:

1. **Split it by turno** — Manhã (start before 13:00) and Tarde (13:00
   on), the same cut `agenda-slots-abertos.js` uses (`TARDE_FROM_MIN =
   13 * 60`). Reuse that boundary; do not restate the arithmetic, or the
   two features will drift.
2. **Bound it to the next 2 weeks** — from the prazo mínimo through
   today + 14 days. The current figure counts the whole fetched year,
   which overstates what is realistically bookable.

Rendered shape (Portuguese, matching the existing line's register):

```
Slots livres (a partir de 04/08, próximas 2 semanas) · dados de 09:31
29JDM8 — Manhã: 7   Tarde: 5   Total: 12
```

**The window must be stated**, since bounding it changes a number the
user has been reading. A count that silently shrank would look like
capacity disappearing.

The weighted figure keeps its existing suppression rule: shown only
where a zona's slots are shared, because elsewhere it merely repeats the
whole count.

### The slots themselves, listed under the summary

The turno counts answer "is there room?". The list answers "when?" — and
the two belong together, the counts as the headline and the slots as the
detail.

**Only OPEN slots appear.** Filled ones are already in the household
table below; listing them again is the duplication that sank the
calendar.

Grouped by day, times beneath each date — it scans naturally for "when
this week?" and a fortnight stays a short block rather than a wall:

```
Slots livres (a partir de 04/08, próximas 2 semanas) · dados de 09:31
29JDM8 — Manhã: 7   Tarde: 5   Total: 12

ter 04/08   09:00  09:30  14:00
qua 05/08   08:30  09:00
sex 07/08   13:30
```

Same window and same filter as the counts, from the same
`slotsLivresDaJanela` selection — the summary must never disagree with
the list beneath it. Both are derived from one function, not two.

### Equipes are deliberately not shown

Several teams can serve one zona, and `resourceId` identifies them in
the response — but it is a uuid, and the only place it resolves to a
readable name is the Agenda page's own calendar headers and
`#selectEquipes`, **neither of which exists on the Lista de Endereços**.
`getAgendaEquipeNames` returns `{}` there.

So `resourceId` stays discarded and the parse boundary is unchanged.

The consequence, accepted deliberately: two teams free at the same
date and time render as two identical lines. That reads as a duplicate
but is not one — two lines mean two bookable slots, and the count above
agrees. With one zona per Controle over a fortnight this is rare, and
showing a uuid to disambiguate it would cost every reader clarity to
serve an uncommon case.

### Data

`indexZonaLivres` already counts free slots per zona with the prazo
filter applied. It gains a turno split and an upper date bound. No new
field at the parse boundary — `start` is already retained, and `end`,
`resourceId` and the rest stay discarded.

## Shared helpers — reduce duplication while here

`toMin(hhmm)` — parse "HH:MM" to minutes — is currently duplicated in
`agenda-slots-abertos.js:49` and `agenda-day-guide.js:642`. This feature
would be the **third** copy.

**Move it to `sigc-common.js` and export it**, updating both existing
call sites. It is pure, trivially testable, and already proven identical
in both copies. Move its companion `fmtMin` (minutes back to "HH:MM",
day guide only) alongside it so the pair stays together, even though the
turno split needs only `toMin` — splitting them across two homes is how
the next duplicate gets written.

Do **not** move these while here:

- **`gmapsRouteUrl`** — the day guide's copy handles multi-point routes
  with waypoints; this feature needs only a single destination. Write
  the one-line destination URL locally rather than exporting a
  route-builder for a non-route use. The generated day guide already
  keeps its own standalone copy for the same reason.
- **The F5 gateway helpers** — deliberately duplicated, see the previous
  spec: moving them into `sigc-common.js` would place fetch-adjacent
  code outside the privacy gate's sanctioned directories.

## Testing

Pure functions, following the existing pattern:

- Maps link: renders for valid coordinates, renders plain text (no
  anchor) for missing or unparseable ones, and the URL contains the
  coordinates.
- Tipo de Entrevista: present in the index and the rendered table;
  absent column joins `colunasNaoEncontradas`.
- Turno counts: a slot starting before 13:00 counts as Manhã and 13:00
  on as Tarde; the 13:00 boundary itself is Tarde; a free slot before
  the prazo mínimo is excluded; the prazo date itself counts; a slot
  beyond today + 14 days is excluded; Manhã + Tarde equals the total.
- Slot list: only open slots appear (a filled one in the window is
  excluded); slots group under their date in chronological order, times
  ascending within a day; a day with no open slots renders no heading;
  the listed slot count equals the summary's total, since both derive
  from one selection.
- `toMin` after the move: covered in the common helpers test, and both
  existing features' suites still pass unchanged.

The export document's existing contract tests still apply — no
`http://` or `https://` reference except the Google Maps links, which
are now a deliberate exception and must be asserted as the only ones.

## Note on the self-contained rule

The exported file has, until now, contained **no external references at
all**, asserted by a test. The Maps links change that: they are external
URLs.

They are **links, not loaded resources** — nothing is fetched when the
file opens, no request leaves the machine until the user clicks one, and
clicking is an explicit navigation to Google Maps. The day guide already
does exactly this and its privacy documentation covers it.

The test asserting "no http(s) reference" must be tightened rather than
deleted: assert that the only external URLs are `google.com/maps` links,
so a CDN or font import still fails the suite.
