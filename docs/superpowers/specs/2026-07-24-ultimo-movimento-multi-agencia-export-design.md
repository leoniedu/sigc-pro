# Último Movimento multi-agência CSV export — design

## Context

`scripts/ultimo_movimento.py` (in a separate repo, `ibgeba.pns2026`) already
solves this problem outside the browser: given a UF, it loops every agência,
POSTs the same filter SIGC's own "Último Movimento" page uses
(`/UltimoMovimento/Filtrar`), parses the returned HTML table, and concatenates
everything into one CSV. It works, but requires Python, `browser_cookie3`,
and running a script outside the portal.

This feature brings that capability into sigc-pro as a button on the Último
Movimento page: click it, and it fetches every agência in the current UF and
downloads one combined CSV — no separate tooling required.

This is sigc-pro's second feature (after `agenda-map`) that makes network
requests, and its first that persists any state via `chrome.storage`. Both
require deliberate exceptions to the existing zero-network, zero-storage
privacy gate (`scripts/check-privacy.sh`), so this design leans on that
precedent throughout rather than inventing new patterns.

## Goals

- One click on the Último Movimento page exports a single CSV covering every
  agência in the current UF, matching `ultimo_movimento.py`'s output shape
  (original columns + `IdUf`, `IdAgencia`, `AgenciaDescricao` prepended).
- Ships disabled by default, gated behind a new "advanced flags" settings
  toggle — the multi-agência loop's request pattern (dozens of sequential
  POSTs to an internal government endpoint) is a materially different risk
  profile than sigc-pro's existing one-shot same-origin fetch, and should be
  opt-in for users who understand that.
- Same codebase, same manifest, same zip for both Web Store and dev-mode
  distribution — no build-time feature split.
- A failed agência doesn't abort the run; the export finishes with whatever
  succeeded plus a summary of what didn't.

## Non-goals

- Reports other than Último Movimento. The design establishes the pattern
  (fetch-based multi-agência export, gated by the same advanced flag) so
  future reports can be added as separate features reusing the same
  settings flag and helper, but no other report is in scope now.
- A UI to pick a subset of agências. Always all agências in the current UF,
  matching the Python script's default (`--agencias all`).
- Persisting or syncing settings across devices (`chrome.storage.local` only,
  no `chrome.storage.sync`).

## Architecture

Two new pieces:

### 1. `extension/features/settings/` — advanced flags toggle

A small settings feature, mounted on every SIGC page (like `csv-export`),
that:
- Reads `chrome.storage.local` for `{ advancedFlags: { ultimoMovimentoExport: boolean } }`
  on load, defaulting to `false` when unset.
- Exposes a small UI (a gear/flag icon button opening a native `confirm`-style
  toggle, or a minimal inline checkbox panel — exact UI is an implementation
  detail, not load-bearing for this design) to flip the flag and persist it.
- Exposes the current flag value to other features via
  `window.__sigcPro.settings.isEnabled('ultimoMovimentoExport')`, so
  `ultimo-movimento-export` (and any future advanced feature) can gate its
  own `mountWidget` on it.

This is the **second privacy-gate exception**, alongside `agenda-map`'s
fetch exception:
- `chrome.storage.local` (get/set only) permitted solely inside
  `extension/features/settings/`.
- The stored value is a plain boolean flag object — no user-identifying or
  survey data.

`scripts/check-privacy.sh` gets a new carve-out mirroring the existing
`agenda-map` one: a `PATTERN_NOSTORAGE` variant that still bans
`fetch`/`XMLHttpRequest`/etc. inside `settings/` (it has no reason to make
network calls), while allowing `chrome.storage`. `test-privacy-gate.sh` gets
matching plant/cleanup cases proving the gate still rejects storage
elsewhere and still rejects fetch inside `settings/`.

**Manifest world note:** content scripts currently run in `"world": "MAIN"`,
where `chrome.*` APIs are not available (they only exist in the isolated
content-script world). `settings.js` will need `"world": "ISOLATED"` for
itself specifically, or a small isolated-world relay script that reads
storage and exposes the value to the MAIN-world scripts via a custom DOM
event or a value stamped onto `window` before the MAIN-world scripts run.
Exact mechanism is an implementation detail to resolve against how
`manifest.json`'s `content_scripts` ordering/worlds actually behave — flagged
here so it isn't missed, not designed in full now.

### 2. `extension/features/ultimo-movimento-export/`

Mirrors `csv-export`'s structure but is Último Movimento-specific and
fetch-based:

- **Mount condition:** only on the Último Movimento page (URL/DOM detection
  similar to how `pdf-export`/`kml-export` detect Lista de Endereços) **and**
  `window.__sigcPro.settings.isEnabled('ultimoMovimentoExport')` is true. If
  the flag is off, the button never appears — the feature is invisible by
  default, not just disabled.
- **On click:**
  1. `confirm()` gate, same pattern as `agenda-map`'s `CONSENT_MSG`: explains
     this will make dozens of same-origin requests to SIGC's own server and
     may take a few minutes.
  2. Read the current UF from the page (same helper family as
     `getAgendaUf()` if applicable, or the equivalent for this page).
  3. Fetch the live agência list for that UF via the same-origin
     `/Filtro/CarregarAgencias` endpoint (mirrors `get_agencias()` in the
     Python script).
  4. Loop agências sequentially, **2 seconds between requests**: POST to
     `/UltimoMovimento/Filtrar` with the same filter payload shape the
     Python script uses (`IdFiltro`, `IdUf`, `IdAgencia`, `IdMunicipio: "*"`,
     `Controle: "*"`, `IdEntrevistadores: "*"`, `IdTipoAcompanhamento: "*"`).
  5. Parse the returned HTML fragment's `#tb_ultimo_movimento` table into
     rows (new small HTML-table-string parser — this is the one place the
     feature can't reuse `readDataTable()`, since that reads a live
     DataTables instance, not a raw HTML string). Prepend `IdUf`,
     `IdAgencia`, `AgenciaDescricao` to each row, matching the Python
     script's column order.
  6. On a per-agência failure (network error, non-2xx, table not found):
     log a console warning, record the agência as failed, continue to the
     next one. Does not abort the run.
  7. While running: button is `disabled`, its label updates to show
     progress (`"12/47"` style, reusing the two-line label style
     `makeDtProButton` already supports), console logs each agência as it
     completes or fails.
  8. When done: build one combined CSV (same `buildCsv`/`downloadFile`
     helpers `csv-export.js` already uses) and trigger the download. If any
     agências failed, `alert()` a summary (count + codes) after the download
     starts, matching the Python script's stderr warnings but surfaced in
     the UI instead of a terminal.

### Data flow

```
click → confirm() → getCurrentUf() → fetch CarregarAgencias
  → for each agência (2s apart):
      fetch Filtrar → parse HTML table → tag rows with IdUf/IdAgencia/Descrição
      → accumulate rows, or record failure
  → buildCsv(all rows) → downloadFile()
  → if failures: alert(summary)
```

## Error handling

- **Settings flag off:** button doesn't render. No error state — this is
  the default, silent case.
- **Consent declined:** no-op, same as `agenda-map`.
- **`CarregarAgencias` fails or returns empty:** `alert()` and abort before
  the loop starts — nothing to export.
- **Per-agência `Filtrar` failure or empty table:** skip, continue, tally.
- **All agências fail:** `alert()` "nothing collected", no download
  (matches the Python script's `sys.exit` when `frames` is empty).
- **Partial failure:** CSV downloads with whatever succeeded; `alert()`
  lists which agências didn't make it in.

## Testing

- Unit tests (bun + happy-dom, matching the existing suite) for:
  - The HTML-table-string parser, against a fixture fragment shaped like a
    real `#tb_ultimo_movimento` response.
  - Row-tagging (`IdUf`/`IdAgencia`/`AgenciaDescricao` prepended correctly).
  - The settings read/default-false/write round trip.
  - `check-privacy.sh` self-test additions: storage allowed in `settings/`,
    still banned elsewhere; fetch still banned in `settings/`.
- No automated test drives the actual fetch loop against a live SIGC
  server — that's manually verified against the real portal (same as
  `agenda-map`'s coordinate fetch today has no live-server test).

## Open questions for implementation time (not blocking design approval)

- Exact settings UI (icon/panel placement) — cosmetic, decide during
  implementation.
- Exact mechanism for exposing `chrome.storage` results from an ISOLATED
  world into the MAIN-world scripts — needs a quick spike against the real
  manifest before locking in.
- Whether `getCurrentUf()`-equivalent already exists for the Último
  Movimento page or needs to be written fresh (the agenda page has
  `getAgendaUf()`; Último Movimento's UF may be sourced differently, e.g.
  from a `<select>` already on that page).
