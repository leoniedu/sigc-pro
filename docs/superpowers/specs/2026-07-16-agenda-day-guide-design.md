# Agenda Day Guide ("Guia do Dia") — design

2026-07-16. Status: approved, pre-implementation.

## Purpose

Give each field team a printable one-page guide for a day of Agenda
visits: addresses, filled and empty slots, morador details (nome, sexo,
idade), telefone, Controle/Domicílio, observação — plus a coordinator's
summary. Generated entirely from the already-rendered FullCalendar DOM
(via `readAgendaSlots()`), keeping SIGC-PRO's zero-permission,
zero-network guarantee.

## UI & gating

- New feature `extension/features/agenda-day-guide/agenda-day-guide.js`,
  registered after the other agenda features in `manifest.json`.
- Button **"Guia do Dia"** on the Agenda toolbar chunk, same classes,
  colors, idempotent insert + MutationObserver re-insert as CSV-PRO /
  Verificar Slots.
- **Dia view only** (decided): if the active view isn't Dia (no
  `.fc-resourceTimeGridDay-button.fc-button-active` /
  `.fc-timeGridDay-button.fc-button-active`), alert asking the user to
  switch to the Dia view and stop.
- No rendered slots → same "nenhum slot encontrado" alert as CSV-PRO.

## Data flow

`readAgendaSlots()` (sigc-common.js, unchanged) → rows already sorted by
time → group by `equipe` (teams sorted by name) → compute stats → render
HTML string → `downloadFile(name, html, 'text/html;charset=utf-8')`.
No new DOM reading beyond what the button gating needs; the guide's date
comes from the rendered rows' `isoDate` (all identical in Dia view).

## Output file

One self-contained `.html` download. Hard constraints:

- **No network**: inline CSS only, no fonts, no images, no external
  refs. Opens correctly from `file://`.
- **No JS**: tabs are CSS-only (hidden `<input type="radio">` per tab +
  `<label>` bar + `:checked` sibling selectors), so the file works even
  where scripts are blocked.
- **All values HTML-escaped** (new local `escapeHtml`); fields in
  `MISSING_VALUES` are omitted, not rendered as "-".

### Structure

1. **Header**: "SIGC-PRO — Guia do Dia", UF (from `#selectUf`, as in
   agenda-csv-export), date (dd/mm/aaaa + weekday), generation
   timestamp.
2. **Tab "Resumo"** (first, default-selected) — day-level stats:
   - equipes ativas (≥1 slot) and equipes com reserva (≥1 reservado)
   - agendamentos (reservados), livres, total, taxa de ocupação (%)
   - primeiro agendamento (hora + equipe) and último (hora + equipe),
     reserved slots only
   - controles distintos (reserved slots)
   - média de agendamentos por equipe ativa; média de agendamentos por
     controle distinto
   - per-equipe table: equipe · reservados · livres · ocupação %
3. **One tab per equipe**, team name as tab label:
   - stat line above the cards: reservados × livres, ocupação %,
     primeiro/último agendamento (hora), controles distintos, zonas
     (union of the team's slot zonas)
   - **cards per slot, ordered by time** (approved mockup):
     - reserved: `hora início–fim` + RESERVADO badge; endereço
       prominent; `nome — sexo, idade (dt. nascimento)`; telefone;
       Controle/Domicílio; observação
     - open: slim `hora início–fim — LIVRE` row

### Print

`@media print`: hide the tab label bar; only the `:checked` tab's panel
prints. Ctrl+P on a team's tab → clean per-team PDF via the browser; on
the Resumo tab → coordinator overview page.

## Filename

`sigc-pro-guia_<uf>_<dd-mm-aaaa>_<data>_<hora>.html` — `<dd-mm-aaaa>` is
the guide's day; `<data>_<hora>` the generation timestamp via
`timestampSlug()`. `slug()` moves from agenda-csv-export.js to
sigc-common.js (exported on `window.__sigcPro`) now that two features
need it — same move `timestampSlug()` already made. agenda-csv-export.js
drops its local copy.

## Edge cases

- Semana view → alert, no file.
- Zero slots → alert, no file.
- Equipe with only open slots → tab still rendered (all-LIVRE day is
  information too); "equipes com reserva" stat distinguishes it.
- Missing morador fields (open slot data leaking into a reserved title,
  absent telefone, etc.) → omitted line by line, card never breaks.
- Stats divisions guard against zero denominators (no reserved slots →
  "—" for first/last/averages).

## Testing

- Pure builders (`groupByEquipe`, stats computation, card/tab/summary
  HTML fragments, `escapeHtml`) mirrored in a bun scratch test, same
  pattern as the slot-checks tests: escaping, grouping, stat math with
  zero-denominator edges, LIVRE vs RESERVADO rendering.
- Manual field test on live Dia view before commit; verify tabs and
  print output in Chrome (screen + Ctrl+P).
- Privacy gate must stay clean (no new APIs; `downloadFile` reuse).

## Out of scope

- Semana-view guides, per-day file splitting (decided against).
- Coordinates/maps (agenda DOM has none; see zona↔Lista join idea in
  ROADMAP "Later").
- pdfMake PDF generation (availability on the Agenda page unverified;
  browser print covers it).
