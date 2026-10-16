# Shared button layer — design

**Date:** 2026-07-19
**Status:** implemented

## Problem

Eight feature files (pdf-export, kml-export, csv-export, agenda-csv-export,
agenda-slot-checks, agenda-date-picker, agenda-day-guide, agenda-map) each
hand-roll the same button-mounting ritual: a `BUTTON_ID`-guarded
`insertButton`, a `tryInsert`/`tryUpdate` closure, and a private
`new MutationObserver(tick).observe(document.body, { childList: true,
subtree: true, ... })`. Consequences:

- **~270 duplicated lines**, including two styling blocks copy-pasted 3×
  each (the DataTables 36px `dt-btn-icon` block in kml/csv/pdf and the
  FullCalendar `fc-button-primary` block in the Agenda features), with an
  8-line explanatory comment pasted verbatim.
- **Performance:** 7+ independent observers all watch `document.body` with
  `subtree: true`. On a busy FullCalendar/DataTables page every DOM
  mutation anywhere fans out to every observer; the removable mounts
  (day-guide, agenda-map, date-picker) run document-wide `querySelector`s
  on every tick with no O(1) early exit.
- **Two mount variants** (insert-only vs insert-or-remove) that differ
  only in whether the tick has a removal branch.

## Decisions (with user)

1. **Fidelity: unify semantics.** One observer config and one tick cadence
   for all mounts. Acceptable deltas: dt buttons also tick on class-attribute
   mutations (harmless behind the O(1) exit); kml/pdf keep their pesquisa
   ready-gate but adopt the shared observer; every mount becomes
   insert-or-remove.
2. **Migration: one pass.** Shared layer plus all 8 features converted in a
   single version bump; old and new patterns never coexist in a store build.
3. **Architecture: registry + single body observer** (over container-scoped
   observers, which need meta-observer reattach machinery, and over
   styling-dedup-only, which skips the perf fix).

## Design

All new code lives in `extension/common/sigc-common.js`, exported on
`window.__sigcPro` like the existing helpers.

### mountWidget

```js
mountWidget({
  id,      // element id; doubles as the O(1) existence probe
  anchor,  // (ctx) => Element|null — where to append; null = not ready
  when,    // (ctx) => bool — optional extra gate (default: always true)
  build,   // () => Element — called only when inserting
})
```

Registers the mount, runs one immediate tick for it, and lazily starts the
shared observer on first registration.

### Tick semantics (every mount, every dispatch)

```js
const existing = document.getElementById(id);
const a = anchor(ctx);
const ok = a && when(ctx);
if (ok && !existing) a.appendChild(build());
else if (!ok && existing) existing.remove();
```

This is the insert/insert-or-remove collapse: everything is
insert-or-remove. Former insert-only features gain explicit removal (e.g.
KML/PDF-pro now remove themselves when `onListaEnderecos()` goes false
instead of relying on toolbar destruction) — strictly more correct.

### Shared observer + tick context

One `MutationObserver` on `document.body` with the union config
`{ childList: true, subtree: true, attributes: true, attributeFilter:
['class'] }`. Each mutation batch runs a single dispatch loop over all
registered mounts.

`ctx` is a fresh per-batch object with lazy memoized getters, so shared
lookups run at most once per batch regardless of how many mounts use them:

- `ctx.dtToolbar()` — `document.querySelector('.dt-buttons')`
- `ctx.agendaChunk()` — `findAgendaToolbarChunk()`
- `ctx.onLista()` — `onListaEnderecos()`
- `ctx.onAgenda()` — `onAgendaPage()`

### Button factories

Own the two copy-pasted styling blocks exactly once (single home for the
8-line alignment comment):

```js
makeDtProButton({ id, lines, title, onClick })
  // lines: ['KML','PRO'] → 36px dt-button buttons-html5 dt-btn-icon,
  // #005a9c, 7px font, pinned 36px box, 4px radius
makeFcProButton({ id, text, title, onClick })
  // fc-button fc-button-primary, #005a9c, 4px left margin
```

`build` may return any element: agenda-date-picker's `build` composes a
`makeFcProButton` (no margin, emoji label, custom padding overrides where
needed) inside its wrap span together with the hidden `<input type="date">`.

### Ready-gates

- The `whenReadyGeneric` 200 ms polls disappear for the six features whose
  prereqs are pure DOM — the observer sees the anchor appear, and the
  registration-time tick covers already-loaded pages.
- `whenReady` (pesquisa detection, 10 s give-up) stays for kml/pdf;
  pdf-export additionally keeps its `pdfMake` polling and `installHook`
  call. Both call `mountWidget` inside the `whenReady` callback.
- agenda-map drops its `dayGuide`-presence poll: manifest load order
  guarantees agenda-day-guide runs first, so the check moves into `when`.

## Migration map

| Feature | anchor | when | build | ready-gate kept |
|---|---|---|---|---|
| csv-export | `ctx.dtToolbar()` | `getDataTable()` present | `makeDtProButton` | none |
| kml-export | `ctx.dtToolbar()` | `ctx.onLista()` | `makeDtProButton` | `whenReady` (pesquisa) |
| pdf-export | `ctx.dtToolbar()` | `ctx.onLista()` | `makeDtProButton` | `whenReady` (pesquisa + pdfMake); `installHook` unchanged |
| agenda-csv-export | `ctx.agendaChunk()` | — | `makeFcProButton` | none |
| agenda-slot-checks | `ctx.agendaChunk()` | — | `makeFcProButton` | none |
| agenda-date-picker | `.fc-toolbar-title` | — | wrap span (fc button + hidden date input) | none |
| agenda-day-guide | `ctx.agendaChunk()` | `diaViewActive()` | `makeFcProButton` | none |
| agenda-map | `ctx.agendaChunk()` | `diaViewActive()` + `dayGuide` present | `makeFcProButton` | none |

fc mounts' `anchor` already implies the Agenda page (`ctx.agendaChunk()` is
null elsewhere); features that today also check `onAgendaPage()` keep that
in `when` via the memoized `ctx.onAgenda()`.

Button order within a toolbar chunk stays manifest-order: registration
order equals initial-tick order (agenda-csv → slot-checks → date-picker →
day-guide → agenda-map), unchanged from today.

## Error handling

Each mount's tick runs inside try/catch with a `console.warn`; a throwing
`anchor`/`when`/`build` must never kill the dispatch loop for other mounts.
This preserves the isolation the per-feature IIFEs provide today.

## Testing / QA

### Automated tests (new)

`bun test` (built into bun; no node) with `happy-dom` via
`@happy-dom/global-registrator` for a DOM with a working
`MutationObserver`. Dev-only `package.json` + `bunfig.toml` test preload;
nothing ships in the store ZIP (the build packs `extension/` only). Tests
live in `tests/`, loading `sigc-common.js` as a script against the
registered `window`.

Coverage:

- **Mount lifecycle** (the regression net for this refactor):
  - anchor appearing via DOM mutation → widget mounts, exactly once;
  - `when()` flipping false → widget unmounts; flipping back → remounts;
  - existing-widget O(1) skip (build not called again);
  - a throwing `anchor`/`when`/`build` doesn't break other mounts;
  - only one observer attaches regardless of registrations;
  - registration order = insertion order within a shared anchor.
- **Factories:** expected ids/classes/labels, `onClick` wiring.
- **Pure-helper pinning:** `parseCoord`, `buildCsv`/`escapeCsvField`,
  `slug`, `parseAgendaSlotTitle`, `agendaMinScheduleDate`,
  `exportFileBase`.

Out of automated scope (browser QA still owns these): real
FullCalendar/DataTables re-render behavior, Preact fiber walking
(date-picker), pdfMake, the F5 gateway.

### Syntax / manual QA

- `bun build --no-bundle` syntax pass on every touched file.
- Manual browser QA, both pages:
  - **Lista de Endereços:** PDF/KML/CSV-pro buttons appear, survive report
    re-render (open another controle), and disappear on SPA-nav away.
  - **Agenda:** CSV-PRO, Verificar Slots, date picker appear in both views;
    Dia/Semana toggle inserts/removes Guia do Dia and Guia + Mapa; buttons
    survive date navigation; date picker still opens and navigates.
- One version bump (pre-commit hook auto-bumps on `extension/` changes);
  commits not pushed (user pushes).

## Expected impact

~270 duplicated lines collapse into ~80–100 new lines in sigc-common.js;
each feature's mount block shrinks to ~5–10 declarative lines. Observer
count drops from 7+ to 1; steady-state per-mutation cost becomes one
callback with 8 cheap (mostly memoized / O(1)-guarded) checks. The 200 ms
polling loops for DOM-only prereqs disappear entirely.
