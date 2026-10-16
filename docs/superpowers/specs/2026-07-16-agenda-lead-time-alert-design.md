# Agenda Lead-Time Alert — Design (quick)

Date: 2026-07-16
Status: draft
Depends on: `2026-07-16-agenda-csv-export-design.md` (`readAgendaSlots()`,
Agenda gating, FullCalendar DOM shape)

## Problem

Coordinators create open (unbooked) slots ahead of time via "Criar Slot".
Field logistics need minimum advance notice to actually fill one — 3
calendar days, or 4 if today is a Friday. An open slot dated inside that
window is effectively dead: nobody can staff/assign it in time, but
nothing in SIGC flags that. Coordinators want a way to spot these.

## Decisions (coordination, 2026-07-16)

Asked three questions before building; answers shape everything below:

1. **UI**: standalone button, not folded into CSV-PRO's download flow. The
   check is useful independent of ever exporting a CSV, and shouldn't slow
   down or gate the export for people who don't care about it.
2. **Weekend rule**: no special case beyond Friday. Sat/Sun use the same
   plain `+3` as any other non-Friday day (so Sat -> Tue, Sun -> Wed) —
   simplest option, revisit only if it turns out wrong in practice.
3. **Scope**: open (unbooked) slots only. Already-reserved slots inside
   the window are *not* flagged, even though one could argue a reservation
   that close to today is also a scheduling mistake — out of scope for
   this pass.

## Rule

`window.__sigcPro.agendaMinScheduleDate(refDate)` (sigc-common.js):
`refDate`'s calendar date + 3 days, or +4 if `refDate.getDay() === 5`
(Friday). Verified against a full week:

| refDate (weekday) | minDate     |
|--------------------|-------------|
| Sun 07-12          | Wed 07-15   |
| Mon 07-13          | Thu 07-16   |
| Tue 07-14          | Fri 07-17   |
| Wed 07-15          | Sat 07-18   |
| Thu 07-16          | Sun 07-19   |
| Fri 07-17          | **Tue 07-21** (+4) |
| Sat 07-18          | Tue 07-21   |

A slot is a violation if `slot.isoDate < minDateIso` (string-compared —
safe since both are `YYYY-MM-DD`) **and** `!slot.reservado`. `minDate`
itself is allowed (matches the "if Monday, Thursday on" example from the
request — Thursday itself is fine, only Mon/Tue/Wed are excluded).

## Data source

`window.__sigcPro.readAgendaSlots()` — the same already-rendered-DOM read
`agenda-csv-export.js` uses (no network calls; see the CSV export design
doc for how that's confirmed reliable). Each row now carries `reservado`
(`el.className.includes('evento-reservado')`), added to `sigc-common.js`
specifically so this feature could filter without re-touching the DOM.
Confirmed live: unbooked slots exist as `.fc-timegrid-event` without that
class, title only `"Zonas: …"`.

## UI

New `fc-button fc-button-primary` (SIGC-PRO blue) button, "Verificar
Prazo", inserted into the same `.fc-toolbar-chunk` as CSV-PRO (via the
shared `findAgendaToolbarChunk()`), same idempotent-insert +
`MutationObserver` re-insertion pattern (FullCalendar's toolbar is
virtual-DOM diffed and can drop foreign buttons on view/date navigation).

Click -> `alert()` (not a custom modal — matches the existing "tabela não
encontrada" / "tabela está vazia" alerts elsewhere in SIGC-PRO) showing:

```
SIGC-PRO — Prazo mínimo para novos agendamentos

Hoje: 16/07/2026 (quinta-feira)
Só é possível agendar a partir de: 19/07/2026 (domingo)

8 slot(s) aberto(s) antes do prazo mínimo:
  • 23/06/2026 07:00-07:50 — Bio Lab equipe 1 — 29001001 - Lab 1 Oeste, 29001002 - 29001002
  • …
```

or, with no violations, a one-line confirmation (count of open/total slots
in the current view) so a clean check is still visibly a check, not
silence. Listed violations capped at 15 with a "+N more" tail — an
`alert()` with hundreds of lines is unusable.

## Verified live (test env, 2026-07-16, "today" = Thursday)

Currently loaded week: 13 total slots, 8 open (unbooked), 5 reserved.
`minDateIso` computed as `2026-07-19` (+3, since Thursday isn't Friday).
All 8 open slots dated `2026-06-23` (leftover test data, now in the past)
correctly flagged as violations; the 5 reserved slots correctly excluded
regardless of date.

## Out of scope

- Flagging reserved slots inside the window (coordination decision above).
- Any UI beyond a plain `alert()` (no persistent banner/highlight on the
  calendar itself) — revisit if an `alert()` proves too easy to miss/
  dismiss in practice.
- Configurable lead-time rule (hardcoded 3/4-day logic) — would move to
  `PESQUISAS`-style config if it turns out to vary by pesquisa/UF.
