# Lista de Endereços agenda — maps, tipo de entrevista, calendar

Three additions to the AGENDA PRO export
(`2026-07-31-lista-agenda-design.md`). None needs a new network request:
every field comes from data already on screen or already fetched and
currently discarded.

1. **Google Maps link per domicílio** — from the Lista de Endereços'
   own Latitude/Longitude columns.
2. **Tipo de Entrevista column** — already in the Último Movimento
   response, currently parsed past.
3. **Calendar of the zona's slots** — from the same `ObterSlots`
   response the free-slot counts already use.

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

## 3. Calendar

**One zona per Controle.** Confirmed by the user, and it removes the
ambiguity the free-slots summary has to live with: the calendar shows
*the* slots for these households, not a merge across zonas.

The existing code collects zona IDs into a `Set` and sorts them. That is
harmless with one element and is **not** to be restructured as part of
this change.

### Range and filtering

- **Range:** today → +14 days.
- **Free slots** appear only from the prazo mínimo onward — +3 days, +4
  on Fridays so the horizon clears the weekend. A free slot before the
  cutoff cannot be filled, so showing it would advertise capacity that
  does not exist.
- **Filled slots appear across the whole range, including the next 3
  days.** This asymmetry is deliberate: a filled slot is a real
  appointment somebody must keep. Hiding it would make the coming days
  look empty when they are the busiest.

Use `window.__sigcPro.agendaMinScheduleDate` for the cutoff — the same
function Verificar Slots, Slots Abertos and the free-slot counts already
call, so the four cannot drift apart.

### Two states

- **livre** — free and bookable now.
- **preenchido** — filled; shows the household (Controle/Domicílio) so
  the reader can see who holds it.

No third "unbookable" state: those slots are omitted entirely, per the
rule above.

### Shape and placement

A **days × half-hour-marks grid** in the downloaded file, placed **above
the household table** — it is the booking-decision view; the table is
the reference.

Note the axis differs from `agenda-day-guide`'s `buildDayGrid`, which is
one day × equipes. This is many days × time. The grid *logic* is
therefore not reusable, but its half-hour-mark treatment is the
established pattern and should be followed: slot starts do not
necessarily align to :00/:30, so each slot lands in the mark containing
its start and the cell shows the real start time.

### Data

No new fetch. `ObterSlots` already carries what is needed, but
`parseSlots` currently keeps only `{start, isoDate, controle, domicilio,
zonas, aberto}`. The calendar also needs **`end`**, to render a slot's
time span.

Retaining `end` is a one-field change at the parse boundary and carries
nothing personal — it is a timestamp. The privacy narrowing rule is
unchanged: name, sex, birth date, address and telephone are still
discarded there and must never be retained.

## Shared helpers — reduce duplication while here

`toMin(hhmm)` — parse "HH:MM" to minutes — is currently duplicated in
`agenda-slots-abertos.js:49` and `agenda-day-guide.js:642`. This feature
would be the **third** copy.

**Move it to `sigc-common.js` and export it**, updating both existing
call sites. It is pure, trivially testable, and already proven identical
in both copies. Its companion `fmtMin` (minutes back to "HH:MM") lives
only in the day guide today; move it too if the calendar needs it, so
the pair stays together.

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
- Calendar: a free slot before the cutoff is omitted; a **filled** slot
  before the cutoff is KEPT; the cutoff date itself counts as bookable;
  slots outside the 14-day window are omitted; a slot whose start does
  not align to :00/:30 lands in the containing mark with its real time
  shown.
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
