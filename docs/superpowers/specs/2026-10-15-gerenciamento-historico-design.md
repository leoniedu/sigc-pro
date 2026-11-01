# GEREN-PRO history by agência — design

2026-10-15. Status: draft for review, pre-implementation.
Builds on `2026-10-15-gerenciamento-coleta-design.md`. Pattern borrowed from
munic-pro (`situacao-store/`), simplified.

## Purpose

GEREN-PRO shows a point in time. The people who run the collection want to
know whether each **agência** is moving: how many households finished since
last week, how many are still without an interview, where refusals are
growing. The portal keeps no history, so the extension has to keep it.

Granularity is the **agência** (and the UF as a whole). Not município, not
domicílio: no household-level data is ever stored.

## Decision: store it inside sigc-pro

Considered and rejected: downloadable snapshot files the user reloads by hand
(manual, easy to forget), analysis in R only (colleagues have no R), and a
sister extension (a second codebase and a second store listing for one tab).

So sigc-pro stores data locally, **for the first time**. This reverses a
guarantee the project has made since 0.1 ("nothing is stored"), and the
change is the main cost of the feature, not the code. Everything that states
or enforces the guarantee changes with it:

| What | Change |
|---|---|
| `scripts/check-privacy.sh` | `STORAGE_DIRS` gets one directory, `extension/features/gerenciamento-historico/`; `indexedDB` stays banned everywhere else; that directory may not call `fetch()` |
| `scripts/test-privacy-gate.sh` | self-test plants a storage call outside the directory and a `fetch()` inside it; both must fail |
| `README.md`, `LEIA-ME.txt`, `docs/PRIVACY_POLICY.html`, `docs/index.html`, `docs/store-listing.md` | the "nothing stored" claim is replaced by an exact one (below) |
| `extension/manifest.json` | adds a `background` service worker and one ISOLATED content script; **no new permission, no new host** |

The replacement claim, to be used verbatim in the policy: *"A cada consulta do
GEREN-PRO a extensão guarda, no seu navegador, as contagens por agência
(quantos domicílios em cada andamento). Nenhum dado de domicílio, morador ou
endereço é guardado, e nada é enviado a ninguém. O botão 'Limpar histórico'
apaga tudo."*

munic-pro's store listing documents that this needs **no `permissions`
entry**: IndexedDB in the extension's own origin needs none, and
`chrome.storage` is not used. Checking the same is part of the implementation.

## Where the database lives

Same hard-won lesson as munic-pro: IndexedDB opened from a content script (either
world) belongs to the **portal's origin**, which differs between `portalweb`
and `portalweb2`, and is erased when the user clears the portal's site data
(the usual fix for an F5 login loop). So:

- **`historico-worker.js`** — module service worker, on the extension's own
  origin; the **only** code that opens IndexedDB.
- **`historico-bridge.js`** — ISOLATED content script, `document_start`. Opens
  no database; relays each request to the worker with
  `chrome.runtime.sendMessage` (no permission needed).
- **`historico-client.js`** — MAIN world, no storage API at all. Talks to the
  bridge through two attributes on `<html>`, one request in flight at a time
  (queue), 10 s timeout with a message that says to reload the page and then
  the extension. Not `postMessage`: the portal's F5 rewriting layer
  swallows it — confirmed in munic-pro, and the reason `ultimo-movimento-map-relay.js`
  already uses DOM attributes.
- **`historico-db.js`** — the operations, bound to an `IDBFactory` (so tests
  use `fake-indexeddb`, as munic-pro's do). Written against `globalThis` for
  the worker.

No legacy-migration code: nothing ever opens IndexedDB on the portal origin
here, so there is nothing to migrate.

## What is stored

Database `sigc-pro-historico`, stores:

- `execucoes` — one record per **UF per day**. Key `"<uf>|<yyyy-mm-dd>"`
  (America/Sao_Paulo date). The last run of a day replaces the earlier ones, so
  growth is bounded at one record per UF per day.
- `prefs` — `{ key, value }` for the panel's remembered choices.

An `execucoes` record:

```
{ chave, uf, dia, run_ts,            // run_ts: epoch ms of the fetch
  total,                             // households in the response
  agencias:  { "<idAgencia>": "<nome>" },
  contagens: [ ["<idAgencia>", "<andamento portal>", "S"|"N", n], ... ],
  recusaDomicilio: [ ["<idAgencia>", "S"|"N", n], ... ] }
```

`contagens` is agência × andamento label × Amostra Bio → count (BA: about
40 × 19 × 2, at most ~1.5k tuples, ~25 KB JSON; a year of daily runs ≈ 9 MB
for that UF). The portal's raw label is stored, not a bucket, so a later
change of metric definitions re-reads old runs correctly. The household
refusal comes from `situacao_entrevista` and overlaps `andamento`, hence its own
list (split by Bio too, so the Amostra Bio filter applies to it). Nothing else is stored: no controle, domicílio, município name or any
personal data.

### When a run is saved

After every **real** fetch (a hit on the 5-minute in-memory cache does not
save; Atualizar does). Saving never blocks or fails the panel: an error is
shown in the warnings strip and the panel still opens.

**Not saved when the response looks short.** The portal answers with a partial
page when a POST does not look like it came from the report (180 rows for a
1,185-row scope was seen). A run is skipped, with a visible warning, when it
has no rows or fewer than 70 % of the households of the UF's most recent
stored run. There is no override; Atualizar again is the retry.

## The Histórico tab

A fourth tab after Agência, laid out like munic-pro's: **one column per ISO
week**, taking the last run (the last day with a record) of that week. Weeks
with no run appear as **empty columns**, so a gap in monitoring is visible.
Headers show the week and the date behind it, `2026-W42 (15/10)`, so a stale
column is not mistaken for a fresh one.

The columns are the weeks and nothing else, because a table shows **one
metric at a time**:

1. **Agências × semanas** — one row per agência plus a UF total row; the
   cell is the chosen metric.
2. **Uma agência × semanas** — an agência (or the UF) is chosen and the rows
   are the metrics, in a fixed short list (the metrics below), cells counts or %.

Controls: *Métrica* (view 1), *Agência* (view 2), *Valores* (Contagem /
% do total da agência, the existing switch), *Semanas* (últimas 8 · 12 · todas;
default 12), and the existing *Amostra Bio* filter, which applies because
Bio is part of every stored count. Rows sort and filter like the other tabs;
the CSV button exports what is shown.

### Metrics

Derived from the stored raw labels, in the aggregate code only:

| Metric | Labels |
|---|---|
| Questionário concluído | Finalizada (sem Bio; com Bio e não elegível) + every 25A and 25B label |
| Sem entrevista iniciada | Não iniciada |
| Em andamento | Todos os moradores em andamento; selecionado(a) a realizar; selecionado(a) em andamento |
| Recusa no questionário | Todos os moradores … recusa; selecionado(a) com recusa |
| Recusa Bio (25A) | 25A não iniciada por recusa |
| Recusa do domicílio | from `recusaDomicilio` |
| Bio 25B realizada | 25B realizada |
| Total | all |
| Qualquer rótulo do portal | one label picked from the list (this is where a new label shows up) |

The three refusals stay separate metrics, never summed. "Questionário
concluído" is a proposed definition: a 25A or 25B household has, by the
portal's flow, completed the questionnaire. To be confirmed.

Agências that appear or disappear between runs are the union over the shown
weeks; a cell where the agência was absent is empty, not zero.

## Panel controls for the history itself

- **Limpar histórico** — deletes every record, after a confirm that names how
  many runs and weeks go. (Per-UF deletion is not needed: the tab shows one
  UF at a time and the button says which.)
- **Exportar histórico (CSV)** — long format, one line per
  `(uf, dia, idAgencia, agência, andamento, bio, n)`, for analysis outside the
  extension and as the backup the extension does not make for itself.
- The tab footer states the durability plainly: the history lives in this
  browser profile; clearing the extension's data or removing the extension
  erases it.

## Files

```
extension/features/gerenciamento-historico/
  historico-db.js       IndexedDB operations (worker + tests)
  historico-worker.js   service worker, owns the database
  historico-bridge.js   ISOLATED relay, no storage
  historico-client.js   MAIN-world RPC client, no storage API
  historico-agregar.js  build a run from rows; metrics; week columns (pure)
  historico-view.js     the tab
extension/features/gerenciamento-coleta/gerenciamento-report.js
                        saves after a real fetch; mounts the 4th tab
```

## Tests

`fake-indexeddb` as a dev dependency (munic-pro already does this).

- **db:** save replaces the same UF-day, keeps other days and UFs; get by UF;
  clear; prefs round-trip.
- **run building:** counts equal the rows (sum of `contagens` = total);
  household refusal counted once and kept out of the label counts; no
  controle/domicílio/município leaves the function.
- **short-response guard:** skipped under 70 %, saved at 70 %, saved when
  there is no prior run, skipped when empty.
- **weeks:** ISO week from the São Paulo date (year boundary, Sunday/Monday);
  last run of the week wins; gap weeks are empty columns; header format.
- **metrics:** each metric's labels; refusals not merged; unknown label
  reachable under "Qualquer rótulo"; % uses the agência's total.
- **bridge/client end to end** through the DOM attributes, as munic-pro's
  `situacao-store.test.js` does; a source-shape test proves the client and
  the view contain no storage API.
- **gate:** `check-privacy.sh` clean; self-test fails on a storage call
  outside the directory and on `fetch()` inside it.
- **view:** one column per week plus empty weeks; Bio filter; both views;
  CSV carries bare numbers; Limpar and Exportar.

## Rollout

1. Gate, policy and listing text (the decision, reviewed on its own).
2. db, worker, bridge, client, with their tests.
3. Run building and the save hook in GEREN-PRO.
4. Aggregation and the Histórico tab.
5. Docs, store listing (reviewer note: a service worker and local IndexedDB
   are added; no permission, no host), version.

Store review is the external risk: the item changes the listing's data-handling
statements, so the dashboard's privacy fields are updated in the same release.

## Open questions

Implemented on 2026-10-15 with the defaults below; none was contradicted.

1. **"Questionário concluído"** = Finalizada + all 25A/25B. *Default used.*
2. **Default window** = 12 weeks (8 / 12 / todas selectable).
3. **Retention** = every day kept (≈ 9 MB per UF-year), no pruning yet.

Implementation notes: the history save lives in `carregar()` of the report, so
a fresh fetch and Atualizar both save and a cache hit never does; the
short-response guard compares against the UF's most recent stored run; the
tab keeps its choices (visão, métrica, agência, semanas) under one `ui` pref;
`historico-view.js` and `historico-agregar.js` are pure of storage and the
source-shape test enforces that the client, bridge-side and tab files never
name `indexedDB`.

## Revision 2026-10-15 (after a clean-session review)

Supersedes the sections above where they differ.

- **No empty-week columns.** Runs are saved when someone opens the panel, not
  on a schedule, so a blank week says nothing about the agências. One column
  per ISO week *that has a run* (the last day with a record); where weeks were
  skipped the header says so (`2026-W43 (21/10) · +2 sem`). The window counts
  runs, not calendar weeks: "Últimas 8 / 12 coletas" or "Todas".
- **Guard baseline.** A run is skipped when it is under 70 % of the LARGEST run
  of the last 14 days (not the latest: that ratcheted down, 100 → 71 → 51, and
  accepted a partial page repeated twice). No repeat-confirmation. Cost: a
  sample that really shrinks by more than 30 % is only accepted again when the
  large runs are 14 days old; the warning says so. A same-day run smaller than
  the one already saved for that day is skipped silently (the last run of a day
  wins, but not with a worse one).
- **Storing the split of "Não iniciada".** The record gains `semEntrevista:
  [[ag, "P"|"E", "S"|"N", n]]` and `semana`: "Não iniciada" households are
  "E" (encerrado: fechado, vago/uso ocasional, recusa do domicílio, fora de
  âmbito, outro motivo) or "P" (still to be worked, and anything not known to
  be closed). In BA about half of "Não iniciada" is each, and per agência the
  pending share runs from 0 % to 94 %. A run saved before this field leaves
  those cells empty.
- **Metrics.** "Questionário concluído" is kept, and no longer pretends to be an
  end state: households without a biomarker sample end at *Finalizada sem Bio*,
  those with it continue through 25A/25B. Added: *Ciclo encerrado* (Finalizada
  sem Bio + não elegível + 25B + 25A recusa / outro motivo), *Bio a coletar*
  (25A agendada + não agendada; concluído − ciclo encerrado = exactly this),
  *Bio 25B não realizada*, *Bio 25A: outro motivo*, *Finalizada, não elegível*,
  *Indefinido*, *Sem entrevista — ainda a trabalhar / encerrado*. The three
  refusals stay separate. Only *Total* contains every label.
- **Reading the history.** `listar(uf)` returns only the last run of each ISO
  week, so the reply (one DOM attribute) stays small however long the history
  grows; `listar(uf, true)` returns every day, for the CSV export.
- **Per-UF choices.** The remembered choices are keyed by UF, and a remembered
  value this UF's history cannot honour (a portal label from another UF, an
  agência outside the weeks on screen) falls back to the default.
- **Empty means empty.** An agência with no household on that side of the
  Amostra Bio filter is an empty cell, not a 0 (or a bare "%").
- **Recent granularity (as munic-pro).** The two most recent days with a run
  are columns of their own (this morning against yesterday); before them, one
  column per ISO week (its last day). `listar(uf)` over the bridge returns
  exactly that set; the CSV export still gets every day.
- **No window selector.** The "Semanas" control (8 / 12 / todas) is gone, with
  its saved choice: columns are one per run kept (the two latest days, then one
  per week), about 12 for a quarter and 55 for a year, and the table already
  scrolls sideways. munic-pro has no window control either. A window can come
  back if a year of columns proves unwieldy.
