# Último Movimento Multi-Agência CSV Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a button on SIGC's "Último Movimento" report page that, when an
"advanced flags" setting is enabled, fetches every agência's report for the
current UF via same-origin requests and downloads one combined CSV.

**Architecture:** Two new features. (1) `extension/features/settings/` — an
ISOLATED-world relay that reads/writes a boolean flag via
`chrome.storage.local` and broadcasts it to the page's MAIN-world scripts via
a `CustomEvent`, plus a small MAIN-world button that lets the user flip the
flag. (2) `extension/features/ultimo-movimento-export/` — a MAIN-world
feature that mounts only when the flag is on and the current page is Último
Movimento; on click it confirms, fetches the UF's agência list, then loops
agências (2s apart) POSTing the same filter Último Movimento's own page uses,
parses each HTML response into rows, and downloads one CSV. Both are new,
audited exceptions to `scripts/check-privacy.sh`'s zero-network/zero-storage
gate, following the precedent already established by `agenda-map`'s fetch
exception.

**Tech Stack:** Vanilla JS (no framework, no bundler), Manifest V3 content
scripts (MAIN + ISOLATED worlds), bun + `@happy-dom/global-registrator` for
tests, shell (`scripts/check-privacy.sh`) for the privacy gate.

## Global Constraints

- Zero network calls and zero storage anywhere in `extension/` except the
  two audited exceptions below — enforced by `scripts/check-privacy.sh` via
  git pre-commit hook.
- `agenda-map/` may use `fetch` only (no other request/storage API), and
  only with `location.origin`-relative URLs (no absolute URLs) — existing
  rule, unchanged by this plan.
- New exception (this plan): `settings/` may use `chrome.storage.local`
  get/set only — no `fetch`/`XMLHttpRequest`/other request APIs, no other
  storage API.
- New exception (this plan): `ultimo-movimento-export/` may use `fetch`
  only, `location.origin`-relative URLs only — same rule as `agenda-map/`.
- pt-BR CSV conventions apply: `;`-delimited, CRLF line endings, UTF-8 BOM,
  via the existing `buildCsv`/`downloadFile` helpers in `sigc-common.js` —
  do not reimplement CSV building.
- 2 seconds between each per-agência request (fixed delay, not
  configurable).
- A failed agência is skipped, not fatal — the run continues and the final
  CSV/alert reflects partial success.
- No UI to pick a subset of agências — always all agências in the current
  UF.
- Feature ships in the same manifest/zip for both Web Store and dev
  distribution; gating is via the settings flag only, default `false`.
- Commit messages: conventional commits (`feat:`, `test:`, `docs:`, etc.),
  English, subject under 72 chars.

---

## File Structure

- `extension/manifest.json` — modify: add `content_scripts` entries for the
  new ISOLATED-world settings relay and the two new MAIN-world scripts.
- `extension/features/settings/settings-relay.js` — new, ISOLATED world.
  Reads/writes `chrome.storage.local`, broadcasts flag value via
  `CustomEvent('sigc-pro-advanced-flags', { detail })` on `window`,
  listens for a `sigc-pro-set-advanced-flag` event from the MAIN-world
  toggle button to persist changes.
- `extension/features/settings/settings.js` — new, MAIN world. Caches the
  latest flag value it receives from the relay, exposes
  `window.__sigcPro.settings.isEnabled(name)` and
  `window.__sigcPro.settings.setFlag(name, value)` (the latter dispatches
  the relay-facing event), and mounts a small toggle button on every SIGC
  page.
- `extension/common/sigc-common.js` — modify: export a `recheckMounts`
  function (thin wrapper around the existing internal `tickAllMounts`) so
  `settings.js` can force a re-evaluation of every mounted widget's `when`
  the moment a flag value arrives asynchronously (mounts already exist
  before the relay's first message lands).
- `extension/features/ultimo-movimento-export/ultimo-movimento-export.js`
  — new, MAIN world. Page detection, agência-list fetch, per-agência
  fetch+parse loop, CSV assembly, button.
- `scripts/check-privacy.sh` — modify: add the `settings/`
  storage-allowed/fetch-banned exception alongside the existing
  `agenda-map/` fetch-allowed exception; add the
  `ultimo-movimento-export/` fetch-allowed/no-absolute-URL exception
  (identical shape to `agenda-map/`'s).
- `scripts/test-privacy-gate.sh` — modify: add plant/cleanup cases proving
  the new exceptions are exactly as narrow as intended.
- `tests/settings.test.js` — new. Unit tests for the flag cache/isEnabled
  logic in `settings.js` (the relay's `chrome.storage` calls are exercised
  via a stub, not real `chrome.storage`, since happy-dom has no
  `chrome.*`).
- `tests/ultimo-movimento-export.test.js` — new. Unit tests for the
  HTML-table parser, row-tagging, and UF/agência URL building — pure
  functions, no live fetch.
- `README.md` — modify: document the new "advanced flags" setting and the
  Último Movimento export button, following the existing feature-list
  style.

## Interfaces produced by this plan (for later tasks/reviewers)

- `window.__sigcPro.recheckMounts()` — no args, no return; re-runs every
  mounted widget's `when` immediately (Task 2).
- `window.__sigcPro.settings.isEnabled(name: string) => boolean` — reads
  the in-memory flag cache, defaults `false` if unset/not yet loaded
  (Task 3).
- `window.__sigcPro.settings.setFlag(name: string, value: boolean) => void`
  — dispatches the persist-request event; fire-and-forget (Task 3).
- Custom events: `'sigc-pro-advanced-flags'` (relay → page, `detail:
  {flags: Record<string, boolean>}`), `'sigc-pro-set-advanced-flag'`
  (page → relay, `detail: {name: string, value: boolean}`) (Tasks 2–3).
- `parseUltimoMovimentoHtml(html: string) => {header: string[], rows:
  string[][]} | null` (Task 5) — parses the `#tb_ultimo_movimento`
  fragment; `null` if the table isn't found.
- `buildAgenciaFilterBody(uf: string, agencia: string) => string` (Task 5)
  — URL-encoded `filtro=` POST body, mirrors `ultimo_movimento.py`'s
  `fetch_report_html` payload shape.

---

### Task 1: Privacy gate exceptions for `settings/` and `ultimo-movimento-export/`

**Files:**
- Modify: `scripts/check-privacy.sh`
- Modify: `scripts/test-privacy-gate.sh`

**Interfaces:**
- Consumes: nothing (shell-only, no JS interfaces).
- Produces: a gate that will accept the code Tasks 2–5 are about to add,
  proven by the self-test additions here (written before that code
  exists, so this task's self-test additions must plant/remove their own
  fixture files exactly like the existing `agenda-map` self-test cases
  do).

This task must land first: later tasks add `fetch`/`chrome.storage` calls
that the *current* gate would reject, and the pre-commit hook runs the
gate on every commit.

- [ ] **Step 1: Read the current gate to confirm exact pattern variables**

Run: `cat scripts/check-privacy.sh`

Confirm the two pattern variables `PATTERN` (everything, used outside
`agenda-map`) and `PATTERN_NOFETCH` (used inside `agenda-map`, allows only
`fetch`) still match the earlier read in this session. If they've
changed, adjust the steps below accordingly — the diff shape must stay
the same either way.

- [ ] **Step 2: Add the `settings/` exception (storage allowed, fetch banned) and the `ultimo-movimento-export/` exception (fetch allowed, same as agenda-map)**

Edit `scripts/check-privacy.sh`. Replace the whole file with:

```sh
#!/bin/sh
# SIGC-PRO privacy gate: extension code must make no outbound requests and
# keep no storage. With --staged, checks the content being committed (used
# by the pre-commit hook); otherwise checks the working tree.
#
# This is a heuristic tripwire, not a proof: the hard guarantees remain the
# empty permissions list in manifest.json and code review of extension/.

# Blanket ban. Sanctioned exceptions, each narrow and audited:
#   - extension/features/agenda-map/       : fetch() only, same-origin only
#     (queries SIGC's own server; see
#     docs/superpowers/specs/2026-07-16-agenda-map-design.md)
#   - extension/features/ultimo-movimento-export/ : fetch() only, same-origin
#     only (same rationale, see
#     docs/superpowers/specs/2026-07-24-ultimo-movimento-multi-agencia-export-design.md)
#   - extension/features/settings/         : chrome.storage only, no fetch
#     (persists the advanced-flags toggle; same spec as above)
# Every other API stays banned everywhere, including inside these
# directories except for the one API each is sanctioned for. Fetch-sanctioned
# directories may not contain absolute URLs, so their requests physically
# cannot leave location.origin. XMLHttpRequest is matched only as `new
# XMLHttpRequest` (actual API usage), not as a bare identifier — the
# standard AJAX header value "X-Requested-With: XMLHttpRequest" is a string
# literal, not a call, and the fetch-sanctioned directories legitimately
# send that header.
FETCH_DIRS='extension/features/agenda-map extension/features/ultimo-movimento-export'
STORAGE_DIRS='extension/features/settings'

PATTERN='fetch\(|["'\''"]fetch["'\''"]|import\(|new\s+XMLHttpRequest|sendBeacon|WebSocket|EventSource|RTCPeerConnection|importScripts|new Image|\.src\s*=|chrome\.storage|localStorage|sessionStorage|indexedDB|document\.cookie|eval\(|new Function'
PATTERN_NOFETCH='import\(|new\s+XMLHttpRequest|sendBeacon|WebSocket|EventSource|RTCPeerConnection|importScripts|new Image|\.src\s*=|chrome\.storage|localStorage|sessionStorage|indexedDB|document\.cookie|eval\(|new Function'
PATTERN_NOSTORAGE='fetch\(|["'\''"]fetch["'\''"]|import\(|new\s+XMLHttpRequest|sendBeacon|WebSocket|EventSource|RTCPeerConnection|importScripts|new Image|\.src\s*=|localStorage|sessionStorage|indexedDB|document\.cookie|eval\(|new Function'
URL_PATTERN='https?://'

if [ "$1" = "--staged" ]; then
  EXCLUDES=""
  for d in $FETCH_DIRS $STORAGE_DIRS; do EXCLUDES="$EXCLUDES ':!$d'"; done
  MATCHES=$(eval git grep --cached -nE "\"$PATTERN\"" -- extension/ $EXCLUDES 2>/dev/null)
  FETCH_MATCHES=""
  FETCH_URLS=""
  for d in $FETCH_DIRS; do
    FETCH_MATCHES="$FETCH_MATCHES
$(git grep --cached -nE "$PATTERN_NOFETCH" -- "$d" 2>/dev/null)"
    FETCH_URLS="$FETCH_URLS
$(git grep --cached -nE "$URL_PATTERN" -- "$d" 2>/dev/null)"
  done
  STORAGE_MATCHES=""
  for d in $STORAGE_DIRS; do
    STORAGE_MATCHES="$STORAGE_MATCHES
$(git grep --cached -nE "$PATTERN_NOSTORAGE" -- "$d" 2>/dev/null)"
  done
else
  EXCLUDE_GREP=""
  for d in $FETCH_DIRS $STORAGE_DIRS; do EXCLUDE_GREP="$EXCLUDE_GREP -e ^$d/"; done
  MATCHES=$(grep -rnE "$PATTERN" extension/ 2>/dev/null | grep -vE "$(echo $EXCLUDE_GREP | sed 's/-e //g' | tr ' ' '|')")
  FETCH_MATCHES=""
  FETCH_URLS=""
  for d in $FETCH_DIRS; do
    FETCH_MATCHES="$FETCH_MATCHES
$(grep -rnE "$PATTERN_NOFETCH" "$d/" 2>/dev/null)"
    FETCH_URLS="$FETCH_URLS
$(grep -rnE "$URL_PATTERN" "$d/" 2>/dev/null)"
  done
  STORAGE_MATCHES=""
  for d in $STORAGE_DIRS; do
    STORAGE_MATCHES="$STORAGE_MATCHES
$(grep -rnE "$PATTERN_NOSTORAGE" "$d/" 2>/dev/null)"
  done
fi

if [ -n "$MATCHES" ]; then
  echo "PRIVACY GATE FAILED — request/storage APIs found outside sanctioned directories:" >&2
  echo "$MATCHES" >&2
  exit 1
fi
if [ -n "$(echo "$FETCH_MATCHES" | tr -d '[:space:]')" ]; then
  echo "PRIVACY GATE FAILED — non-fetch request/storage APIs in a fetch-sanctioned directory:" >&2
  echo "$FETCH_MATCHES" >&2
  exit 1
fi
if [ -n "$(echo "$FETCH_URLS" | tr -d '[:space:]')" ]; then
  echo "PRIVACY GATE FAILED — absolute URL in a fetch-sanctioned directory (must use location.origin only):" >&2
  echo "$FETCH_URLS" >&2
  exit 1
fi
if [ -n "$(echo "$STORAGE_MATCHES" | tr -d '[:space:]')" ]; then
  echo "PRIVACY GATE FAILED — fetch/other request API in a storage-sanctioned directory (only chrome.storage is allowed there):" >&2
  echo "$STORAGE_MATCHES" >&2
  exit 1
fi

# Unlisted-distribution gate: the Chrome Web Store item is unlisted, so its
# URL must never land in this public repo (docs, README, Pages, anywhere) —
# publishing the link would effectively de-unlist it. Checked repo-wide,
# not just extension/.
STORE_PATTERN='chromewebstore\.google\.com/detail|chrome\.google\.com/webstore/detail'
if [ "$1" = "--staged" ]; then
  STORE_MATCHES=$(git grep --cached -nE "$STORE_PATTERN" -- . 2>/dev/null)
else
  STORE_MATCHES=$(grep -rnE "$STORE_PATTERN" . 2>/dev/null)
fi

if [ -n "$STORE_MATCHES" ]; then
  echo "PRIVACY GATE FAILED — unlisted Chrome Web Store URL found in repo:" >&2
  echo "$STORE_MATCHES" >&2
  exit 1
fi
echo "privacy gate: CLEAN"
```

- [ ] **Step 3: Verify the gate still passes on the current (unmodified) tree**

Run: `scripts/check-privacy.sh`
Expected: `privacy gate: CLEAN`

- [ ] **Step 4: Add self-test cases for the two new exceptions**

Edit `scripts/test-privacy-gate.sh`. Find the `cleanup()` function near the
top and add the new fixture paths, then add test cases after the existing
`agenda-map` cases. Read the full current file first:

Run: `cat scripts/test-privacy-gate.sh`

Then edit it: extend `cleanup()`'s `rm -f` list with:

```sh
PLANT_SETTINGS_FETCH="extension/features/settings/__privacy_tripwire_fetch__.js"
PLANT_UME_XHR="extension/features/ultimo-movimento-export/__privacy_tripwire_xhr__.js"
PLANT_UME_URL="extension/features/ultimo-movimento-export/__privacy_tripwire_url__.js"
PLANT_UME_STORAGE="extension/features/ultimo-movimento-export/__privacy_tripwire_storage__.js"
```

(add these three `PLANT_*` variable declarations next to the existing
`PLANT_MAP_XHR`/`PLANT_MAP_URL` declarations, and add the corresponding
paths to the `cleanup()` function's `rm -f` line).

Then, after the existing case 3 (`Non-fetch request API inside agenda-map
must fail`), add:

```sh
# 4. fetch( inside settings/ must fail (only chrome.storage is sanctioned
#    there, not fetch).
echo 'fetch("/x");' > "$PLANT_SETTINGS_FETCH"
if scripts/check-privacy.sh >/dev/null 2>&1; then
  fail "gate missed fetch( inside settings/"
fi
rm -f "$PLANT_SETTINGS_FETCH"

# 5. chrome.storage inside settings/ must PASS (it's the sanctioned API
#    there) — proves the exception isn't accidentally too narrow.
echo 'chrome.storage.local.get(["x"], () => {});' > "extension/features/settings/__privacy_tripwire_storage_ok__.js"
if ! scripts/check-privacy.sh >/dev/null 2>&1; then
  fail "gate rejected sanctioned chrome.storage inside settings/"
fi
rm -f "extension/features/settings/__privacy_tripwire_storage_ok__.js"

# 6. Non-fetch request API inside ultimo-movimento-export/ must fail.
echo 'var x = new XMLHttpRequest();' > "$PLANT_UME_XHR"
if scripts/check-privacy.sh >/dev/null 2>&1; then
  fail "gate missed new XMLHttpRequest inside ultimo-movimento-export/"
fi
rm -f "$PLANT_UME_XHR"

# 7. Absolute URL inside ultimo-movimento-export/ must fail.
echo 'const u = "https://evil.example/x";' > "$PLANT_UME_URL"
if scripts/check-privacy.sh >/dev/null 2>&1; then
  fail "gate missed absolute URL inside ultimo-movimento-export/"
fi
rm -f "$PLANT_UME_URL"

# 8. chrome.storage inside ultimo-movimento-export/ must fail (only fetch
#    is sanctioned there, not storage).
echo 'chrome.storage.local.set({x: 1});' > "$PLANT_UME_STORAGE"
if scripts/check-privacy.sh >/dev/null 2>&1; then
  fail "gate missed chrome.storage inside ultimo-movimento-export/"
fi
rm -f "$PLANT_UME_STORAGE"
```

These fixtures target directories that don't exist yet (`settings/`,
`ultimo-movimento-export/`) — `echo > path` creates the directory only if
it already exists, so add `mkdir -p` before each `echo` targeting a new
directory. Prepend `mkdir -p extension/features/settings
extension/features/ultimo-movimento-export` as its own line right after
the existing `trap cleanup EXIT INT TERM` line.

- [ ] **Step 5: Run the self-test**

Run: `scripts/test-privacy-gate.sh`
Expected: no `SELF-TEST FAILED` output; script exits 0.

- [ ] **Step 6: Commit**

```bash
git add scripts/check-privacy.sh scripts/test-privacy-gate.sh
git commit -m "chore: add privacy-gate exceptions for settings/ and ultimo-movimento-export/"
```

---

### Task 2: `recheckMounts` export on `sigc-common.js`

**Files:**
- Modify: `extension/common/sigc-common.js:503-528` (the `tickAllMounts`
  function and the `window.__sigcPro` export object at the end of the
  file)
- Test: `tests/mount-widget.test.js` (existing file — add to it)

**Interfaces:**
- Consumes: nothing new — wraps the existing internal `tickAllMounts`.
- Produces: `window.__sigcPro.recheckMounts(): void` — used by Task 3's
  settings relay listener to force mounts to re-evaluate the instant an
  async flag value arrives.

- [ ] **Step 1: Read the existing mount-widget test file to match its style**

Run: `cat tests/mount-widget.test.js`

- [ ] **Step 2: Write the failing test**

Add to `tests/mount-widget.test.js` (append; keep existing tests
untouched):

```js
describe('recheckMounts', () => {
  test('re-evaluates when() immediately without waiting for a mutation', () => {
    document.body.innerHTML = '<div id="anchor"></div>';
    let gate = false;
    P.mountWidget({
      id: 'recheck-test-widget',
      anchor: () => document.getElementById('anchor'),
      when: () => gate,
      build: () => document.createElement('span'),
    });
    expect(document.getElementById('recheck-test-widget')).toBeNull();
    gate = true;
    P.recheckMounts();
    expect(document.getElementById('recheck-test-widget')).not.toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/mount-widget.test.js`
Expected: FAIL — `P.recheckMounts is not a function`

- [ ] **Step 4: Implement `recheckMounts`**

In `extension/common/sigc-common.js`, add a thin export right after the
existing `tickAllMounts` function (around line 506, immediately after its
closing brace):

```js
  // Forces every mounted widget's `when` to be re-evaluated right now,
  // without waiting for a DOM mutation to trigger the shared observer.
  // Needed by features whose gating condition can flip asynchronously
  // with no DOM change of its own (e.g. settings.js, once the
  // chrome.storage-backed flag value arrives from the ISOLATED-world
  // relay).
  function recheckMounts() {
    tickAllMounts();
  }
```

Then add `recheckMounts,` to the `window.__sigcPro = { ... }` export
object (alongside `mountWidget,` near the end of the file).

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/mount-widget.test.js`
Expected: PASS

- [ ] **Step 6: Run the full test suite to confirm no regressions**

Run: `bun test`
Expected: all tests PASS

- [ ] **Step 7: Commit**

```bash
git add extension/common/sigc-common.js tests/mount-widget.test.js
git commit -m "feat: export recheckMounts for async mount-gate updates"
```

---

### Task 3: Settings feature — flag cache, isEnabled/setFlag, ISOLATED-world relay

**Files:**
- Create: `extension/features/settings/settings.js` (MAIN world)
- Create: `extension/features/settings/settings-relay.js` (ISOLATED world)
- Modify: `extension/manifest.json`
- Test: `tests/settings.test.js`

**Interfaces:**
- Consumes: `window.__sigcPro.mountWidget`, `window.__sigcPro.makeFcProButton`
  or a plain `<button>` (this is not a DataTables/FullCalendar toolbar —
  see Step 4), `window.__sigcPro.recheckMounts` (Task 2).
- Produces: `window.__sigcPro.settings.isEnabled(name: string): boolean`,
  `window.__sigcPro.settings.setFlag(name: string, value: boolean): void`.
  Custom events `'sigc-pro-advanced-flags'` and
  `'sigc-pro-set-advanced-flag'` on `window`. These are what Task 4
  (Último Movimento export's mount gate) depends on.

`settings.js` runs in MAIN world (same world as every other feature, so
it can populate `window.__sigcPro`). `settings-relay.js` runs in ISOLATED
world (the only world with `chrome.*` access) and never touches
`window.__sigcPro` — MAIN and ISOLATED worlds have separate `window`
objects, so `CustomEvent`/`postMessage` on the DOM's shared `window`
target is the only channel between them (both worlds do share the same
DOM, so `window.dispatchEvent`/`addEventListener` work across the
world boundary).

- [ ] **Step 1: Write the failing test for the MAIN-world flag cache**

Create `tests/settings.test.js`:

```js
import { describe, test, expect, beforeEach } from 'bun:test';

await import('../extension/common/sigc-common.js');
await import('../extension/features/settings/settings.js');
const P = window.__sigcPro;

describe('settings.isEnabled', () => {
  test('defaults to false before any flags event arrives', () => {
    expect(P.settings.isEnabled('ultimoMovimentoExport')).toBe(false);
  });

  test('reflects the value from a sigc-pro-advanced-flags event', () => {
    window.dispatchEvent(new CustomEvent('sigc-pro-advanced-flags', {
      detail: { flags: { ultimoMovimentoExport: true } },
    }));
    expect(P.settings.isEnabled('ultimoMovimentoExport')).toBe(true);
  });

  test('unknown flag name defaults to false', () => {
    expect(P.settings.isEnabled('somethingNeverSet')).toBe(false);
  });
});

describe('settings.setFlag', () => {
  test('dispatches a sigc-pro-set-advanced-flag event with the given name/value', () => {
    let received = null;
    window.addEventListener('sigc-pro-set-advanced-flag', (e) => { received = e.detail; }, { once: true });
    P.settings.setFlag('ultimoMovimentoExport', true);
    expect(received).toEqual({ name: 'ultimoMovimentoExport', value: true });
  });

  test('updates the local cache optimistically before the relay confirms', () => {
    P.settings.setFlag('ultimoMovimentoExport', false);
    expect(P.settings.isEnabled('ultimoMovimentoExport')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/settings.test.js`
Expected: FAIL — cannot find module `../extension/features/settings/settings.js`

- [ ] **Step 3: Implement `settings.js` (MAIN world)**

Create `extension/features/settings/settings.js`:

```js
// SIGC-PRO feature: advanced-flags settings. MAIN-world half of the
// settings feature — settings-relay.js (ISOLATED world) is the only file
// in this directory allowed to touch chrome.storage; this file never
// does, since chrome.* is unavailable in MAIN world. The two communicate
// via CustomEvents on the shared DOM window (MAIN/ISOLATED worlds have
// separate `window` objects but the same document, and DOM event
// dispatch crosses that boundary).
//
// Advanced flags gate features whose request pattern is riskier than the
// rest of the extension's read-only DOM access (e.g. ultimo-movimento-export's
// multi-agência fetch loop) — off by default, so the feature is invisible
// until a user deliberately opts in.
// Spec: docs/superpowers/specs/2026-07-24-ultimo-movimento-multi-agencia-export-design.md
(function () {
  'use strict';

  const TAG = '[sigc-settings]';
  const BUTTON_ID = 'sigc-pro-settings-button';

  // In-memory cache of the last known flag values, kept in sync with
  // chrome.storage via settings-relay.js's events. Starts empty: every
  // flag defaults to false (isEnabled) until the relay's first message
  // lands, which happens automatically on load — no feature should ever
  // block waiting for it, since "off by default" is itself a safe value.
  let flagsCache = {};

  window.addEventListener('sigc-pro-advanced-flags', (e) => {
    flagsCache = (e.detail && e.detail.flags) || {};
    console.log(`${TAG} flags updated:`, flagsCache);
    if (window.__sigcPro && window.__sigcPro.recheckMounts) {
      window.__sigcPro.recheckMounts();
    }
  });

  function isEnabled(name) {
    return flagsCache[name] === true;
  }

  function setFlag(name, value) {
    flagsCache = Object.assign({}, flagsCache, { [name]: value });
    window.dispatchEvent(new CustomEvent('sigc-pro-set-advanced-flag', {
      detail: { name, value },
    }));
  }

  function toggleUltimoMovimentoExport() {
    const next = !isEnabled('ultimoMovimentoExport');
    const msg = next
      ? 'SIGC-PRO: ativar a exportação avançada de Último Movimento ' +
        '(multi-agência)? Isso fará várias requisições ao próprio ' +
        'servidor do SIGC quando usada.'
      : 'SIGC-PRO: desativar a exportação avançada de Último Movimento?';
    if (!confirm(msg)) return;
    setFlag('ultimoMovimentoExport', next);
    alert(next
      ? 'SIGC-PRO: exportação avançada ativada — o botão aparecerá em Último Movimento.'
      : 'SIGC-PRO: exportação avançada desativada.');
  }

  // Mounted on every SIGC page (no report-specific anchor exists that's
  // guaranteed present everywhere), fixed-position so it doesn't depend
  // on any particular page's layout.
  window.__sigcPro.mountWidget({
    id: BUTTON_ID,
    anchor: () => document.body,
    when: () => true,
    build: () => {
      const btn = document.createElement('button');
      btn.id = BUTTON_ID;
      btn.type = 'button';
      btn.textContent = '⚙ SIGC-PRO';
      btn.title = 'SIGC-PRO: configurações avançadas';
      btn.style.position = 'fixed';
      btn.style.bottom = '8px';
      btn.style.right = '8px';
      btn.style.zIndex = '2147483647';
      btn.style.background = '#005a9c';
      btn.style.color = '#fff';
      btn.style.border = 'none';
      btn.style.borderRadius = '4px';
      btn.style.padding = '4px 8px';
      btn.style.fontSize = '11px';
      btn.style.cursor = 'pointer';
      btn.addEventListener('click', toggleUltimoMovimentoExport);
      return btn;
    },
  });

  window.__sigcPro.settings = { isEnabled, setFlag };
  console.log(`${TAG} settings runtime loaded.`);
})();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/settings.test.js`
Expected: PASS

- [ ] **Step 5: Implement `settings-relay.js` (ISOLATED world) — no test, exercised manually**

Create `extension/features/settings/settings-relay.js`:

```js
// SIGC-PRO feature: advanced-flags settings. ISOLATED-world half — the
// only file in this extension allowed to touch chrome.storage (see
// scripts/check-privacy.sh). Never touches window.__sigcPro (that object
// lives in MAIN world's separate `window`); communicates with
// settings.js purely via CustomEvents on the shared DOM window.
// Spec: docs/superpowers/specs/2026-07-24-ultimo-movimento-multi-agencia-export-design.md
(function () {
  'use strict';

  const STORAGE_KEY = 'advancedFlags';

  function broadcast(flags) {
    window.dispatchEvent(new CustomEvent('sigc-pro-advanced-flags', {
      detail: { flags: flags || {} },
    }));
  }

  chrome.storage.local.get([STORAGE_KEY], (result) => {
    broadcast(result && result[STORAGE_KEY]);
  });

  window.addEventListener('sigc-pro-set-advanced-flag', (e) => {
    const { name, value } = e.detail || {};
    if (!name) return;
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      const flags = Object.assign({}, result && result[STORAGE_KEY], { [name]: value });
      chrome.storage.local.set({ [STORAGE_KEY]: flags }, () => broadcast(flags));
    });
  });
})();
```

- [ ] **Step 6: Wire both files into `manifest.json`**

Read the current manifest:

Run: `cat extension/manifest.json`

Edit `extension/manifest.json`. Add a new `content_scripts` array entry
for the ISOLATED-world relay (must run in its own entry, since
`content_scripts` entries don't mix worlds), and add `settings.js` to the
existing MAIN-world entry's `js` array, first in the list (before
`sigc-common.js` is fine to keep as first — settings.js only needs
`window.__sigcPro` to exist by the time its `mountWidget` call runs, and
`mountWidget` is synchronous/immediate-tick, so `settings.js` must load
**after** `sigc-common.js`, not before). Resulting file:

```json
{
  "manifest_version": 3,
  "name": "SIGC-PRO",
  "version": "0.2.63",
  "description": "Melhorias não oficiais para o SIGC (IBGE): exportação de PDF, KML e CSV da Lista de Endereços, e CSV da Agenda.",
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "permissions": ["storage"],
  "content_scripts": [
    {
      "matches": [
        "https://portalweb.ibge.gov.br/*",
        "https://portalweb2.ibge.gov.br/*",
        "https://w3sigcpns2025.ibge.gov.br/*"
      ],
      "js": ["features/settings/settings-relay.js"],
      "run_at": "document_idle"
    },
    {
      "matches": [
        "https://portalweb.ibge.gov.br/*",
        "https://portalweb2.ibge.gov.br/*",
        "https://w3sigcpns2025.ibge.gov.br/*"
      ],
      "js": [
        "common/sigc-common.js",
        "features/settings/settings.js",
        "features/pdf-export/pdf-export.js",
        "features/kml-export/kml-export.js",
        "features/csv-export/csv-export.js",
        "features/agenda-csv-export/agenda-csv-export.js",
        "features/agenda-slot-checks/agenda-slot-checks.js",
        "features/agenda-date-picker/agenda-date-picker.js",
        "features/agenda-day-guide/agenda-day-guide.js",
        "features/agenda-map/agenda-map.js",
        "features/ultimo-movimento-export/ultimo-movimento-export.js"
      ],
      "run_at": "document_idle",
      "world": "MAIN"
    }
  ]
}
```

Note the new top-level `"permissions": ["storage"]` — required for
`chrome.storage` to work at all; this is the first permission the
extension has ever requested (README's "não solicita nenhuma permissão"
claim needs updating — done in Task 6). The `ultimo-movimento-export.js`
reference is added here even though Task 4 creates that file next — this
keeps the manifest edit in one place; if Task 4 runs later as a separate
review unit, confirm this line is still present rather than re-adding it.

- [ ] **Step 7: Run the full test suite**

Run: `bun test`
Expected: all tests PASS (settings-relay.js has no unit test — ISOLATED
world / chrome.storage can't be exercised under happy-dom; verified
manually in Task 6's browser QA step instead)

- [ ] **Step 8: Run the privacy gate**

Run: `scripts/check-privacy.sh`
Expected: `privacy gate: CLEAN`

- [ ] **Step 9: Commit**

```bash
git add extension/manifest.json extension/features/settings/ tests/settings.test.js
git commit -m "feat: add advanced-flags settings toggle"
```

---

### Task 4: Último Movimento page detection + agência list fetch

**Files:**
- Create: `extension/features/ultimo-movimento-export/ultimo-movimento-export.js`
- Test: `tests/ultimo-movimento-export.test.js`

**Interfaces:**
- Consumes: `window.__sigcPro.settings.isEnabled` (Task 3),
  `window.__sigcPro.mountWidget`, `window.__sigcPro.makeDtProButton`,
  `window.__sigcPro.buildCsv`, `window.__sigcPro.downloadFile`,
  `window.__sigcPro.timestampSlug`.
- Produces: `buildAgenciaFilterBody(uf: string, agencia: string): string`
  and `parseUltimoMovimentoHtml(html: string): {header: string[], rows:
  string[][]} | null` — both pure, exported only for testing via a
  test-only hook (see Step 3), not on `window.__sigcPro` (they're
  internal to this feature, unlike the shared helpers in
  `sigc-common.js`).

This task builds the parsing/URL-building pure functions and the page
detection, with tests. Task 5 wires them into the actual fetch loop and
button (fetch-loop orchestration is hard to unit-test meaningfully — it's
covered by the error-handling design instead, and verified live).

- [ ] **Step 1: Write the failing tests for the pure functions**

Create `tests/ultimo-movimento-export.test.js`:

```js
import { describe, test, expect } from 'bun:test';

await import('../extension/common/sigc-common.js');
await import('../extension/features/ultimo-movimento-export/ultimo-movimento-export.js');
const UME = window.__sigcProUltimoMovimentoExportInternals;

describe('buildAgenciaFilterBody', () => {
  test('URL-encodes a filtro JSON payload matching the known SIGC shape', () => {
    const body = UME.buildAgenciaFilterBody('29', '290570100');
    expect(body.startsWith('filtro=')).toBe(true);
    const decoded = JSON.parse(decodeURIComponent(body.slice('filtro='.length)));
    expect(decoded).toEqual({
      IdFiltro: '',
      IdUf: '29',
      IdAgencia: '290570100',
      IdMunicipio: '*',
      Controle: '*',
      IdEntrevistadores: '*',
      IdTipoAcompanhamento: '*',
    });
  });
});

describe('parseUltimoMovimentoHtml', () => {
  test('parses header and rows from the tb_ultimo_movimento table', () => {
    const html = `
      <table id="tb_ultimo_movimento">
        <thead><tr><th>Controle</th><th>Situação</th></tr></thead>
        <tbody>
          <tr><td>1234567890123</td><td>Entrevistado</td></tr>
          <tr><td>9876543210987</td><td>Pendente</td></tr>
        </tbody>
      </table>`;
    const result = UME.parseUltimoMovimentoHtml(html);
    expect(result.header).toEqual(['Controle', 'Situação']);
    expect(result.rows).toEqual([
      ['1234567890123', 'Entrevistado'],
      ['9876543210987', 'Pendente'],
    ]);
  });

  test('returns null when the table is absent (e.g. agência with no data)', () => {
    expect(UME.parseUltimoMovimentoHtml('<div>sem dados</div>')).toBeNull();
  });

  test('trims cell whitespace', () => {
    const html = `
      <table id="tb_ultimo_movimento">
        <thead><tr><th> Controle </th></tr></thead>
        <tbody><tr><td>  1234  </td></tr></tbody>
      </table>`;
    expect(UME.parseUltimoMovimentoHtml(html).rows).toEqual([['1234']]);
  });
});

describe('onUltimoMovimento', () => {
  test('true when the page has the tb_ultimo_movimento table or its filter form', () => {
    document.body.innerHTML = '<div id="tb_ultimo_movimento"></div>';
    expect(UME.onUltimoMovimento()).toBe(true);
  });
  test('false otherwise', () => {
    document.body.innerHTML = '<div>outra página</div>';
    expect(UME.onUltimoMovimento()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/ultimo-movimento-export.test.js`
Expected: FAIL — cannot find module
`../extension/features/ultimo-movimento-export/ultimo-movimento-export.js`

- [ ] **Step 3: Implement the pure functions, page detection, and test-only hook**

Create `extension/features/ultimo-movimento-export/ultimo-movimento-export.js`:

```js
// SIGC-PRO feature: Último Movimento multi-agência CSV export. One of two
// files in this extension allowed to make network requests (the other is
// agenda-map/) — see scripts/check-privacy.sh. Gated behind the
// "ultimoMovimentoExport" advanced flag (off by default): loops every
// agência in the current UF, fetching /UltimoMovimento/Filtrar per
// agência (same payload shape as the standalone ultimo_movimento.py
// script this feature replaces), and downloads one combined CSV.
// Spec: docs/superpowers/specs/2026-07-24-ultimo-movimento-multi-agencia-export-design.md
(function () {
  'use strict';

  const TAG = '[sigc-ultimo-movimento-export]';
  const BUTTON_ID = 'sigc-pro-ultimo-movimento-export-button';
  const TABLE_ID = 'tb_ultimo_movimento';
  const REQUEST_DELAY_MS = 2000;

  // --- pure helpers ----------------------------------------------------

  // True on the Último Movimento report page: the table (once loaded) or
  // its container/filter form (before the user has filtered anything)
  // both use this id — SIGC renders the empty table shell up front.
  function onUltimoMovimento() {
    return !!document.getElementById(TABLE_ID);
  }

  // Mirrors ultimo_movimento.py's fetch_report_html filtro payload
  // exactly (IdFiltro left blank there too — confirmed against the
  // working script, not a placeholder).
  function buildAgenciaFilterBody(uf, agencia) {
    const filtro = {
      IdFiltro: '',
      IdUf: String(uf),
      IdAgencia: String(agencia),
      IdMunicipio: '*',
      Controle: '*',
      IdEntrevistadores: '*',
      IdTipoAcompanhamento: '*',
    };
    return 'filtro=' + encodeURIComponent(JSON.stringify(filtro));
  }

  // HTML fragment -> {header, rows} | null. DOMParser is inert — nothing
  // in the fetched markup can load resources or run handlers, same
  // guarantee agenda-map's parser relies on.
  function parseUltimoMovimentoHtml(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const table = doc.getElementById(TABLE_ID);
    if (!table) return null;
    const header = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    const rows = [...table.querySelectorAll('tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()));
    return { header, rows };
  }

  // Exposed only for tests — not part of the extension's runtime public
  // surface (window.__sigcPro), since these are internal to this one
  // feature and no other feature needs them.
  window.__sigcProUltimoMovimentoExportInternals = {
    onUltimoMovimento,
    buildAgenciaFilterBody,
    parseUltimoMovimentoHtml,
  };

  console.log(`${TAG} loaded.`);
})();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/ultimo-movimento-export.test.js`
Expected: PASS

- [ ] **Step 5: Run the full test suite and the privacy gate**

Run: `bun test && scripts/check-privacy.sh`
Expected: all tests PASS; `privacy gate: CLEAN`

- [ ] **Step 6: Commit**

```bash
git add extension/features/ultimo-movimento-export/ultimo-movimento-export.js tests/ultimo-movimento-export.test.js
git commit -m "feat: add Último Movimento page detection and payload/parser helpers"
```

---

### Task 5: Agência-list fetch, export loop, button, manifest wiring

**Files:**
- Modify: `extension/features/ultimo-movimento-export/ultimo-movimento-export.js`
- Modify: `extension/manifest.json:22-31` (the MAIN-world `js` array —
  add this file; already added in Task 3 Step 6, verify it's present)

**Interfaces:**
- Consumes: everything from Task 4's internals plus
  `window.__sigcPro.settings.isEnabled('ultimoMovimentoExport')` (Task 3),
  `window.__sigcPro.mountWidget`, `window.__sigcPro.makeDtProButton`,
  `window.__sigcPro.buildCsv`, `window.__sigcPro.downloadFile`,
  `window.__sigcPro.timestampSlug`.
- Produces: the mounted button;
  `window.__sigcProUltimoMovimentoExportInternals.collectAllAgencias(uf:
  string, agenciaList: {key: string, description: string}[], onProgress:
  (done: number, total: number) => void) => Promise<{header: string[] |
  null, rows: string[][], failed: string[]}>` — test-only, no other task
  depends on it.

Fetch orchestration (agência-list call, the sequential per-agência loop,
button disabled/progress-label state) is intentionally not covered by
automated tests — it requires a live, authenticated SIGC session, same as
`agenda-map`'s `postFiltrar`/`fetchEnderecos` have no automated test
today. It's verified manually in Task 6.

- [ ] **Step 1: Add the fetch/loop/button code to `ultimo-movimento-export.js`**

Edit `extension/features/ultimo-movimento-export/ultimo-movimento-export.js`.
Insert the following after the `parseUltimoMovimentoHtml` function and
before the `window.__sigcProUltimoMovimentoExportInternals` assignment:

```js
  // --- UF / agência-list reading ---------------------------------------

  // Último Movimento's own filter form has a UF <select> — same pattern
  // as sigc-common's getAgendaUf(), but this page's select has a
  // different id (confirmed against the live page during Task 6's manual
  // QA; if the id differs from what's assumed here, Task 6 corrects this
  // one line and re-verifies — see Task 6 Step 2).
  function getCurrentUf() {
    const s = document.getElementById('selectUf');
    return s ? s.value : '';
  }

  // Mirrors ultimo_movimento.py's get_agencias(): CarregarAgencias
  // returns {items: [{key, description}, ...]}; entries with a blank key
  // are placeholder options, dropped same as the script drops them.
  async function fetchAgenciaList(uf) {
    const url = `${location.origin}/Filtro/CarregarAgencias?IdUf=${encodeURIComponent(uf)}`;
    const res = await fetch(url, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const items = (data && data.items) || [];
    return items.filter((it) => it && it.key && String(it.key).trim());
  }

  async function fetchAgenciaReport(uf, agencia) {
    const url = `${location.origin}/UltimoMovimento/Filtrar`;
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: buildAgenciaFilterBody(uf, agencia),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseUltimoMovimentoHtml(await res.text());
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Sequential, REQUEST_DELAY_MS apart, one agência at a time — matches
  // ultimo_movimento.py's --delay default and keeps the request pattern
  // as far as possible from anything that could look like abuse of
  // SIGC's own infrastructure. A failed agência is logged and skipped,
  // never fatal to the run (mirrors the script's try/except + continue).
  // Returns { header, rows, failed } — rows are already tagged with
  // IdUf/IdAgencia/AgenciaDescricao, in that column order, matching the
  // script's df.insert(0/1/2, ...) order.
  async function collectAllAgencias(uf, agenciaList, onProgress) {
    let header = null;
    const rows = [];
    const failed = [];
    for (let i = 0; i < agenciaList.length; i += 1) {
      const { key: code, description = '' } = agenciaList[i];
      onProgress(i + 1, agenciaList.length);
      try {
        const result = await fetchAgenciaReport(uf, code);
        if (result && result.rows.length > 0) {
          if (!header) header = ['IdUf', 'IdAgencia', 'AgenciaDescricao', ...result.header];
          result.rows.forEach((r) => rows.push([uf, code, description, ...r]));
        }
      } catch (err) {
        console.warn(`${TAG} agência ${code} (${description}) failed:`, err);
        failed.push(`${code} (${description})`);
      }
      if (i < agenciaList.length - 1) await sleep(REQUEST_DELAY_MS);
    }
    return { header, rows, failed };
  }

  // --- UI ----------------------------------------------------------------

  const CONSENT_MSG =
    'SIGC-PRO: isto buscará o relatório Último Movimento de TODAS as ' +
    'agências da UF atual, uma de cada vez (pode levar alguns minutos). ' +
    'Cada requisição vai apenas ao próprio servidor do SIGC. Continuar?';

  async function exportAllAgencias(btn) {
    if (!confirm(CONSENT_MSG)) return;
    const uf = getCurrentUf();
    if (!uf) {
      alert('SIGC-PRO: não foi possível identificar a UF atual.');
      return;
    }

    btn.disabled = true;
    const originalLabel = btn.textContent;
    try {
      let agenciaList;
      try {
        agenciaList = await fetchAgenciaList(uf);
      } catch (err) {
        alert(`SIGC-PRO: não foi possível obter a lista de agências (${err && err.message}).`);
        return;
      }
      if (agenciaList.length === 0) {
        alert('SIGC-PRO: nenhuma agência encontrada para esta UF.');
        return;
      }

      const { header, rows, failed } = await collectAllAgencias(uf, agenciaList, (done, total) => {
        btn.textContent = `${done}/${total}`;
      });

      if (rows.length === 0) {
        alert('SIGC-PRO: nenhum dado coletado — nada para exportar.');
        return;
      }

      const csv = window.__sigcPro.buildCsv(header, rows);
      const { data, hora } = window.__sigcPro.timestampSlug();
      window.__sigcPro.downloadFile(`sigc-pro-ultimo-movimento_uf${uf}_${data}_${hora}.csv`, csv);
      console.log(`${TAG} exported ${rows.length} rows from ${agenciaList.length - failed.length}/${agenciaList.length} agências.`);

      if (failed.length > 0) {
        alert(`SIGC-PRO: exportação concluída com ${failed.length} agência(s) que falharam:\n${failed.join('\n')}`);
      }
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  }

  window.__sigcPro.mountWidget({
    id: BUTTON_ID,
    anchor: (ctx) => ctx.dtToolbar(),
    when: () => onUltimoMovimento() &&
      window.__sigcPro.settings.isEnabled('ultimoMovimentoExport') &&
      !!window.__sigcPro.getDataTable(),
    build: () => {
      console.log(`${TAG} multi-agência export button added.`);
      const btn = window.__sigcPro.makeDtProButton({
        id: BUTTON_ID,
        lines: ['CSV', 'TODAS'],
        title: 'Exportar Último Movimento de todas as agências (SIGC-PRO, avançado)',
        onClick: () => exportAllAgencias(btn),
      });
      return btn;
    },
  });

  // Exposed only for tests — collectAllAgencias is the row-tagging logic
  // the design's testing section calls out explicitly; everything else
  // in this block (fetchAgenciaList/fetchAgenciaReport/exportAllAgencias)
  // needs a live authenticated session and stays manually verified only
  // (Task 6), same as agenda-map's postFiltrar/fetchEnderecos today.
  window.__sigcProUltimoMovimentoExportInternals.collectAllAgencias = collectAllAgencias;
```

Note: `build()`'s `onClick` references `btn` before `makeDtProButton`
returns it — this works because `onClick` is only invoked later, on
click, by which point `btn` (the `const` from the enclosing scope) is
assigned. This matches the existing `agenda-map.js` pattern
(`onClick: exportGuideMap` takes the click event's button via a similar
closure-after-return shape — confirmed by re-reading that file's Step
above).

- [ ] **Step 2: Write the failing test for row-tagging**

Add to `tests/ultimo-movimento-export.test.js` (append):

```js
describe('collectAllAgencias', () => {
  test('tags each row with IdUf/IdAgencia/AgenciaDescricao, in that order', async () => {
    const html = `
      <table id="tb_ultimo_movimento">
        <thead><tr><th>Controle</th><th>Situação</th></tr></thead>
        <tbody><tr><td>111</td><td>Entrevistado</td></tr></tbody>
      </table>`;
    const originalFetch = global.fetch;
    global.fetch = async () => ({ ok: true, text: async () => html });
    try {
      const result = await UME.collectAllAgencias(
        '29',
        [{ key: 'A1', description: 'Agência 1' }],
        () => {},
      );
      expect(result.header).toEqual(['IdUf', 'IdAgencia', 'AgenciaDescricao', 'Controle', 'Situação']);
      expect(result.rows).toEqual([['29', 'A1', 'Agência 1', '111', 'Entrevistado']]);
      expect(result.failed).toEqual([]);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('records a failed agência and continues, without aborting the run', async () => {
    const html = `
      <table id="tb_ultimo_movimento">
        <thead><tr><th>Controle</th></tr></thead>
        <tbody><tr><td>222</td></tr></tbody>
      </table>`;
    const originalFetch = global.fetch;
    let call = 0;
    global.fetch = async () => {
      call += 1;
      if (call === 1) return { ok: false, status: 500, text: async () => '' };
      return { ok: true, text: async () => html };
    };
    try {
      const result = await UME.collectAllAgencias(
        '29',
        [
          { key: 'BAD', description: 'Falha' },
          { key: 'OK', description: 'Sucesso' },
        ],
        () => {},
      );
      expect(result.failed).toEqual(['BAD (Falha)']);
      expect(result.rows).toEqual([['29', 'OK', 'Sucesso', '222']]);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
```

This test relies on `REQUEST_DELAY_MS` (2000ms) between requests, which
would make a 2-agência test slow — the second test above only has 2
agências so it's ~2s, acceptable for a one-off test. Note the test
default timeout in bun is 5000ms; if this test is later extended to more
agências, stub `sleep` instead of letting it run for real (not needed at
this size).

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/ultimo-movimento-export.test.js`
Expected: FAIL — `UME.collectAllAgencias is not a function`

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/ultimo-movimento-export.test.js`
Expected: PASS (second test takes ~2s due to the real delay — expected,
not a hang)

- [ ] **Step 5: Run the full test suite**

Run: `bun test`
Expected: all tests PASS (Task 4's tests for `buildAgenciaFilterBody` /
`parseUltimoMovimentoHtml` / `onUltimoMovimento` still pass unchanged —
this task only adds new code around them)

- [ ] **Step 6: Run the privacy gate**

Run: `scripts/check-privacy.sh`
Expected: `privacy gate: CLEAN` (confirms `fetch` + no absolute URLs holds
for the new code)

- [ ] **Step 7: Confirm manifest wiring from Task 3 already includes this file**

Run: `grep -n "ultimo-movimento-export" extension/manifest.json`
Expected: one match, inside the MAIN-world `js` array. If missing, add
`"features/ultimo-movimento-export/ultimo-movimento-export.js"` as the
last entry in that array.

- [ ] **Step 8: Commit**

```bash
git add extension/features/ultimo-movimento-export/ultimo-movimento-export.js extension/manifest.json
git commit -m "feat: implement Último Movimento multi-agência export loop and button"
```

---

### Task 6: Manual browser verification, README, LEIA-ME.txt

**Files:**
- Modify: `README.md`
- Modify: `LEIA-ME.txt`
- Possibly modify: `extension/features/ultimo-movimento-export/ultimo-movimento-export.js`
  (only if `getCurrentUf`'s assumed `#selectUf` id is wrong — see Step 2)

This task has no automated test — it's the live-portal verification every
fetch-based feature in this codebase requires (same as `agenda-map`
shipped without an automated fetch test). Do not skip it or mark the
feature done without it: Tasks 1–5 only prove the pure logic and gating
are correct, not that the real endpoints behave as assumed.

- [ ] **Step 1: Load the unpacked extension**

Run: `open chrome://extensions` (or navigate there manually), enable
Modo do desenvolvedor if not already, click "Carregar sem compactação",
select the `extension/` folder.

- [ ] **Step 2: Verify the settings toggle persists and gates the button**

In Chrome, log into SIGC, navigate to any SIGC page. Confirm the
bottom-right "⚙ SIGC-PRO" button appears. Click it, confirm the dialog,
accept — an alert should confirm it's enabled. Reload the page: navigate
to the Último Movimento report page and confirm the "CSV / TODAS" button
now appears in the DataTables toolbar. Click the settings button again to
disable, reload, confirm the "CSV / TODAS" button is now absent.

If `getCurrentUf()`'s `document.getElementById('selectUf')` doesn't match
the real page (Único Movimento may use a different id/selector than the
Agenda page's UF select) — inspect the real page's DOM via Chrome
DevTools, find the correct selector, and update `getCurrentUf()` in
`extension/features/ultimo-movimento-export/ultimo-movimento-export.js`
accordingly. Re-run `bun test` after any such change to confirm nothing
broke.

- [ ] **Step 3: Verify the export loop against a real UF with a small agência count**

With the flag enabled and on the Último Movimento page, filter/select a
UF with few agências if the page allows narrowing that first (to keep the
manual test under a minute or two given the 2s per-agência delay).
Click "CSV / TODAS", confirm the dialog. Watch the button label cycle
`1/N`, `2/N`, etc. Confirm a CSV downloads with columns `IdUf, IdAgencia,
AgenciaDescricao, <original Último Movimento columns...>` and one row per
record across every agência. Cross-check row count/content against
`ultimo_movimento.py --uf <code> --agencias all` run separately, if
convenient (not required, but the strongest available correctness check
since both hit the same live endpoint).

- [ ] **Step 4: Verify partial-failure handling**

If possible, trigger at least one agência failure (e.g. temporarily throttle
network via Chrome DevTools, or trust the code review instead if
reproducing a live failure isn't practical) and confirm the final alert
lists the failed agência(s) and the CSV still contains the successful
ones.

- [ ] **Step 5: Update `README.md`**

Read the current file first:

Run: `cat README.md`

Add a new bullet under the "Em qualquer relatório do SIGC" section (after
the existing CSV-pro bullet), and update the permissions/privacy section.
Edit `README.md`:

Find this block:
```
Em **qualquer relatório do SIGC** com tabela (DataTables):

- **CSV-pro** — exporta a tabela como CSV (`;`-separado, compatível com
  Excel pt-BR), contornando um bug do portalweb: os botões nativos de CSV e
  Excel lançam um erro (`MouseEvent`) da proteção anti-bot F5 do portal fora
  da VPN — o CSV-pro lê os dados diretamente via API do DataTables, sem
  depender desses botões.
```

Replace with:
```
Em **qualquer relatório do SIGC** com tabela (DataTables):

- **CSV-pro** — exporta a tabela como CSV (`;`-separado, compatível com
  Excel pt-BR), contornando um bug do portalweb: os botões nativos de CSV e
  Excel lançam um erro (`MouseEvent`) da proteção anti-bot F5 do portal fora
  da VPN — o CSV-pro lê os dados diretamente via API do DataTables, sem
  depender desses botões.

No relatório **Último Movimento**, com o flag avançado "Exportação
Último Movimento (multi-agência)" ativado (veja Configurações abaixo):

- **CSV TODAS** — baixa o relatório Último Movimento de TODAS as agências
  da UF atual (não só a agência filtrada na tela) e combina tudo em um
  único CSV, com IdUf/IdAgencia/AgenciaDescricao adicionados às colunas
  originais. Faz uma requisição por agência, com 2 segundos de intervalo
  entre elas, ao próprio servidor do SIGC — pode levar alguns minutos.
  Uma agência que falhar é pulada (o CSV final é gerado com o restante, e
  um alerta lista quais falharam), não interrompe a exportação inteira.
```

Then find the "## Configuração" section:
```
## Configuração

Não há tela de opções: os ajustes (colunas mantidas no PDF, colunas
promovidas ao subtítulo, título) ficam em
`extension/common/sigc-common.js`, na entrada da pesquisa em `PESQUISAS`.
Novas pesquisas são adicionadas como novas entradas no mesmo formato.
```

Replace with:
```
## Configuração

Colunas mantidas no PDF, colunas promovidas ao subtítulo e título ficam em
`extension/common/sigc-common.js`, na entrada da pesquisa em `PESQUISAS`.
Novas pesquisas são adicionadas como novas entradas no mesmo formato.

Um botão **⚙ SIGC-PRO**, fixo no canto inferior direito de qualquer
página do SIGC, abre um flag avançado desativado por padrão: "Exportação
Último Movimento (multi-agência)". Esse flag existe porque a
funcionalidade que ele libera faz várias requisições em sequência ao
servidor do SIGC (uma por agência da UF) — um padrão de uso mais
sensível do que o resto da extensão, que só lê a página já carregada na
tela. O valor do flag fica salvo localmente via `chrome.storage.local`
(a única funcionalidade da extensão que usa armazenamento; veja
Privacidade abaixo).
```

Then find the "## Privacidade" section and its `Nenhum dado sai do seu
computador` paragraph — update the storage claim:
```
**Nenhum dado sai do seu computador.** A extensão não solicita nenhuma
permissão do navegador, não faz chamadas de rede — exceto o recurso opcional "Guia + Mapa", que consulta o próprio servidor do SIGC mediante clique e confirmação (nada vai a terceiros), não armazena nada
(nem `localStorage`) e não tem código remoto — o arquivo KML é gerado em
memória e salvo localmente. Detalhes em
[PRIVACY_POLICY](docs/PRIVACY_POLICY.html).
```

Replace with:
```
**Nenhum dado sai do seu computador.** A extensão solicita apenas a
permissão `storage` do navegador (usada exclusivamente para lembrar o
estado do flag avançado — veja Configuração acima) e não faz chamadas de
rede, exceto dois recursos opcionais, ambos mediante clique e
confirmação, ambos apenas ao próprio servidor do SIGC (nada vai a
terceiros): "Guia + Mapa" (coordenadas de endereços) e, com o flag
avançado ativado, a exportação Último Movimento multi-agência. Fora
esses dois casos a extensão não tem código remoto — o arquivo KML, por
exemplo, é gerado em memória e salvo localmente. Detalhes em
[PRIVACY_POLICY](docs/PRIVACY_POLICY.html).
```

Also update the earlier gate-description paragraph:
```
Essa garantia é verificada por um *gate* automático
(`scripts/check-privacy.sh`): um hook de pre-commit bloqueia qualquer commit
que introduza APIs de rede ou armazenamento em `extension/` (exceção única e auditada: `fetch` em `features/agenda-map/`, que não pode conter URLs absolutas). Para ativá-lo
após clonar o repositório:
```

Replace with:
```
Essa garantia é verificada por um *gate* automático
(`scripts/check-privacy.sh`): um hook de pre-commit bloqueia qualquer commit
que introduza APIs de rede ou armazenamento em `extension/` fora de
exceções únicas e auditadas: `fetch` (sem URLs absolutas) em
`features/agenda-map/` e `features/ultimo-movimento-export/`, e
`chrome.storage` em `features/settings/`. Para ativá-lo
após clonar o repositório:
```

- [ ] **Step 6: Update `LEIA-ME.txt` if it duplicates the feature list**

Run: `cat LEIA-ME.txt`

If it lists features (mirroring the README for the zip distribution), add
the equivalent line about the advanced-flag Último Movimento export and
the settings button, matching whatever level of detail the existing
entries use there.

- [ ] **Step 7: Final full verification**

Run: `bun test && scripts/check-privacy.sh && scripts/test-privacy-gate.sh`
Expected: all tests PASS, both gate scripts report clean/no failures.

- [ ] **Step 8: Commit**

```bash
git add README.md LEIA-ME.txt
git commit -m "docs: document advanced-flags settings and Último Movimento export"
```

If Step 2 required a code fix (wrong `selectUf` id), that was already
committed inline in Task 5's follow-up — do not bundle a code fix into
this docs commit; commit it separately with `fix:` before this step.
