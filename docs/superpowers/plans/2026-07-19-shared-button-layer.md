# Shared Button Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the 8 hand-rolled button-mount rituals into one `mountWidget` helper + two button factories in `sigc-common.js`, served by a single shared `MutationObserver`, with a new `bun test` suite pinning the behavior.

**Architecture:** `sigc-common.js` gains a mount registry, a per-batch memoized tick context, and ONE lazy `MutationObserver` on `document.body` (union config: `childList + subtree + attributes:['class']`). Every mount becomes insert-or-remove: each tick, a widget exists iff its `anchor(ctx)` returns an element and its `when(ctx)` gate passes. Features shrink to declarative `mountWidget({id, anchor, when, build})` calls; two factories (`makeDtProButton`, `makeFcProButton`) own the copy-pasted styling blocks.

**Tech Stack:** Vanilla JS content scripts (Manifest V3, MAIN world). Tests: `bun test` (bun 1.3.x built-in) + `@happy-dom/global-registrator` for DOM/MutationObserver. **No node on this machine — bun only.** Syntax checks via `bun build --no-bundle <file>`.

**Spec:** `docs/superpowers/specs/2026-07-19-shared-button-layer-design.md`

## Global Constraints

- All extension code runs in MAIN world content scripts; **no network calls** anywhere except agenda-map's existing sanctioned fetch (untouched). The pre-commit privacy gate enforces this.
- The pre-commit hook auto-bumps the manifest patch version on any `extension/` change — expected on Tasks 3–8's commits; do not bump manually.
- Commit after every task; conventional commits (`feat:`, `refactor:`, `test:`, `docs:`), subjects < 72 chars. **Never push** — the user pushes.
- User-facing strings (button labels, titles, alerts) are pt-BR and must be preserved byte-for-byte during migration.
- `package.json`/`bunfig.toml`/`tests/` are dev-only, live at repo root, and must NOT go under `extension/` (nothing new ships in the store ZIP).
- Existing exported names on `window.__sigcPro` must not change (features and the console rely on them); this plan only adds `mountWidget`, `makeDtProButton`, `makeFcProButton`.

---

### Task 1: Test infrastructure (bun test + happy-dom)

**Files:**
- Create: `package.json` (via `bun add`), `bun.lock`, `bunfig.toml`, `tests/setup.js`, `tests/smoke.test.js`
- Modify: `.gitignore` (add `node_modules/` if absent)

**Interfaces:**
- Consumes: `extension/common/sigc-common.js` as-is (IIFE that populates `window.__sigcPro`).
- Produces: a working `bun test` command where test files can `await import('../extension/common/sigc-common.js')` against a registered happy-dom `window`. All later test tasks rely on this.

- [ ] **Step 1: Install the dev dependency (creates package.json + bun.lock)**

```bash
cd /Users/eleon/github/sigc-pro
bun add -d @happy-dom/global-registrator
```

Then edit `package.json` so it is minimal and clearly dev-only (keep the version `bun add` picked):

```json
{
  "name": "sigc-pro-dev",
  "private": true,
  "devDependencies": {
    "@happy-dom/global-registrator": "<version bun add chose>"
  }
}
```

- [ ] **Step 2: Create `bunfig.toml`**

```toml
[test]
preload = ["./tests/setup.js"]
```

- [ ] **Step 3: Create `tests/setup.js`**

```js
// Registers happy-dom globals (window, document, MutationObserver, …)
// before any test file loads sigc-common.js.
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register();
```

- [ ] **Step 4: Create `tests/smoke.test.js`**

```js
import { test, expect } from 'bun:test';

await import('../extension/common/sigc-common.js');

test('sigc-common loads against happy-dom and exposes __sigcPro', () => {
  expect(typeof window.__sigcPro).toBe('object');
  expect(typeof window.__sigcPro.whenReady).toBe('function');
  expect(typeof window.__sigcPro.readAgendaSlots).toBe('function');
});
```

- [ ] **Step 5: Ignore node_modules**

```bash
grep -qx 'node_modules/' .gitignore 2>/dev/null || echo 'node_modules/' >> .gitignore
```

- [ ] **Step 6: Run the suite**

Run: `bun test`
Expected: 1 pass, 0 fail. If `window` is undefined, the preload didn't run — check `bunfig.toml` is at repo root.

- [ ] **Step 7: Commit**

```bash
git add package.json bun.lock bunfig.toml tests/setup.js tests/smoke.test.js .gitignore
git commit -m "test: add bun test + happy-dom infrastructure"
```

---

### Task 2: Characterization tests for existing pure helpers

**Files:**
- Create: `tests/sigc-common-helpers.test.js`

**Interfaces:**
- Consumes: existing `window.__sigcPro` exports: `parseCoord`, `escapeCsvField` is NOT exported — test via `buildCsv`; `buildCsv(header, rows)`, `slug(s)`, `parseAgendaSlotTitle(text)`, `agendaMinScheduleDate(refDate)`, `dateToIso(d)`, `parseZonaEntries(s)`, `exportFileBase(pesquisa, rows)`, `PESQUISAS`.
- Produces: nothing for later tasks; this is the regression net. **These tests pin CURRENT behavior — they must pass immediately. If one fails, the expectation is wrong: fix the test, never the production code.**

- [ ] **Step 1: Write `tests/sigc-common-helpers.test.js`**

```js
import { describe, test, expect } from 'bun:test';

await import('../extension/common/sigc-common.js');
const P = window.__sigcPro;

describe('parseCoord', () => {
  test('DMS with hemisphere letters and comma seconds', () => {
    expect(P.parseCoord('12 34 56.7 S')).toBeCloseTo(-12.5824167, 5);
    expect(P.parseCoord('38 30 15,5 O')).toBeCloseTo(-38.5043056, 5);
    expect(P.parseCoord('12 34 56.7 N')).toBeCloseTo(12.5824167, 5);
  });
  test('plain decimals, dot or comma', () => {
    expect(P.parseCoord('-23,55')).toBe(-23.55);
    expect(P.parseCoord('-23.55')).toBe(-23.55);
  });
  test('missing/invalid → null', () => {
    expect(P.parseCoord('-')).toBeNull();
    expect(P.parseCoord('')).toBeNull();
    expect(P.parseCoord('12 61 00 S')).toBeNull(); // minutes >= 60
  });
});

describe('buildCsv (incl. field escaping)', () => {
  test('semicolon-delimited with CRLF and trailing newline', () => {
    expect(P.buildCsv(['a', 'b'], [['1', '2']])).toBe('a;b\r\n1;2\r\n');
  });
  test('quotes fields containing delimiter/quotes', () => {
    expect(P.buildCsv(['h'], [['a;b']])).toBe('h\r\n"a;b"\r\n');
    expect(P.buildCsv(['h'], [['say "hi"']])).toBe('h\r\n"say ""hi"""\r\n');
  });
  test('formula-injection guard, numbers exempt', () => {
    expect(P.buildCsv(['h'], [['=1+1']])).toBe("h\r\n'=1+1\r\n");
    expect(P.buildCsv(['h'], [['-12,5']])).toBe('h\r\n-12,5\r\n');
  });
});

describe('slug', () => {
  test('deaccents, collapses non-alphanumerics, trims, lowercases', () => {
    expect(P.slug('São Paulo — Área 1')).toBe('sao-paulo-area-1');
    expect(P.slug('  -já-  ')).toBe('ja');
  });
});

describe('parseAgendaSlotTitle', () => {
  test('label: value lines; placeholder values dropped', () => {
    expect(P.parseAgendaSlotTitle('Controle: 123\nNome: Ana\nSexo: -')).toEqual({
      Controle: '123',
      Nome: 'Ana',
    });
  });
});

describe('agendaMinScheduleDate', () => {
  test('+3 calendar days normally', () => {
    // 2026-07-16 is a Thursday
    const d = P.agendaMinScheduleDate(new Date(2026, 6, 16));
    expect(P.dateToIso(d)).toBe('2026-07-19');
  });
  test('+4 when refDate is a Friday', () => {
    // 2026-07-17 is a Friday
    const d = P.agendaMinScheduleDate(new Date(2026, 6, 17));
    expect(P.dateToIso(d)).toBe('2026-07-21');
  });
});

describe('parseZonaEntries', () => {
  test('splits on commas, trims, drops empties', () => {
    expect(P.parseZonaEntries('a, b ,,c ')).toEqual(['a', 'b', 'c']);
  });
});

describe('exportFileBase', () => {
  const pesquisa = { id: 'PNS2026', columns: P.PESQUISAS.PNS2026.columns };
  const today = new Date().toISOString().slice(0, 10);
  // Lista de Endereços row: 19 columns, controle at 0, selecionado at 14.
  function listaRow({ controle = 'C1', selecionado = 'Sim' } = {}) {
    const row = new Array(19).fill('');
    row[0] = controle;
    row[14] = selecionado;
    return row;
  }

  test('single controle, all selected', () => {
    expect(P.exportFileBase(pesquisa, [listaRow(), listaRow()])).toBe(
      `lista-enderecos-pns2026_C1_selecionados_${today}`
    );
  });
  test('mixed controles, not all selected', () => {
    const rows = [listaRow(), listaRow({ controle: 'C2', selecionado: 'Não' })];
    expect(P.exportFileBase(pesquisa, rows)).toBe(
      `lista-enderecos-pns2026_varios-controles_completos_${today}`
    );
  });
});
```

- [ ] **Step 2: Run the suite**

Run: `bun test`
Expected: all pass. A failure here means a wrong expectation in the test — recompute it against `sigc-common.js`'s actual code and fix the test.

- [ ] **Step 3: Commit**

```bash
git add tests/sigc-common-helpers.test.js
git commit -m "test: pin sigc-common pure-helper behavior"
```

---

### Task 3: mountWidget + shared observer (TDD)

**Files:**
- Create: `tests/mount-widget.test.js`
- Modify: `extension/common/sigc-common.js` (add mount layer + export)

**Interfaces:**
- Consumes: `findAgendaToolbarChunk`, `onListaEnderecos`, `onAgendaPage`, `TAG` — module-local names inside the sigc-common IIFE.
- Produces: `window.__sigcPro.mountWidget(spec)` where `spec = { id: string, anchor: (ctx) => Element|null, when?: (ctx) => boolean, build: () => Element }` and `ctx` has memoized `dtToolbar()`, `agendaChunk()`, `onLista()`, `onAgenda()`. Tasks 5–8 call this exact signature.

- [ ] **Step 1: Write the failing tests — `tests/mount-widget.test.js`**

```js
import { test, expect } from 'bun:test';

// Count observer constructions to prove the layer creates exactly ONE no
// matter how many widgets register. sigc-common resolves the bare
// `MutationObserver` global at call time (lazy start on first
// mountWidget), so installing the wrapper here — before any mountWidget
// call — counts correctly even if another test file imported
// sigc-common first.
let observerCount = 0;
const RealMutationObserver = globalThis.MutationObserver;
globalThis.MutationObserver = class extends RealMutationObserver {
  constructor(cb) {
    super(cb);
    observerCount += 1;
  }
};

await import('../extension/common/sigc-common.js');
const P = window.__sigcPro;

// happy-dom delivers MutationObserver batches asynchronously.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// Unique ids/classes per test: the registry is append-only (like in the
// real page), so stale mounts from earlier tests must never find their
// anchors again.
let n = 0;
const uid = (name) => `t-${name}-${++n}`;

function makeButton(id) {
  const b = document.createElement('button');
  b.id = id;
  return b;
}

test('mounts immediately when the anchor already exists', () => {
  const id = uid('now');
  const anchor = document.createElement('div');
  anchor.className = id;
  document.body.appendChild(anchor);
  P.mountWidget({
    id,
    anchor: () => document.querySelector(`.${id}`),
    build: () => makeButton(id),
  });
  expect(document.getElementById(id)?.parentElement).toBe(anchor);
});

test('mounts when the anchor appears via DOM mutation', async () => {
  const id = uid('appear');
  P.mountWidget({
    id,
    anchor: () => document.querySelector(`.${id}`),
    build: () => makeButton(id),
  });
  expect(document.getElementById(id)).toBeNull();

  const anchor = document.createElement('div');
  anchor.className = id;
  document.body.appendChild(anchor);
  await flush();
  expect(document.getElementById(id)?.parentElement).toBe(anchor);
});

test('build runs once while the widget stays mounted', async () => {
  const id = uid('once');
  const anchor = document.createElement('div');
  anchor.className = id;
  document.body.appendChild(anchor);
  let builds = 0;
  P.mountWidget({
    id,
    anchor: () => document.querySelector(`.${id}`),
    build: () => {
      builds += 1;
      return makeButton(id);
    },
  });
  document.body.appendChild(document.createElement('div'));
  document.body.appendChild(document.createElement('div'));
  await flush();
  expect(builds).toBe(1);
});

test('when() gate removes and re-inserts the widget', async () => {
  const id = uid('gate');
  const anchor = document.createElement('div');
  anchor.className = id;
  document.body.appendChild(anchor);
  let visible = true;
  P.mountWidget({
    id,
    anchor: () => document.querySelector(`.${id}`),
    when: () => visible,
    build: () => makeButton(id),
  });
  expect(document.getElementById(id)).not.toBeNull();

  visible = false;
  anchor.classList.add('poke'); // class mutation → shared observer tick
  await flush();
  expect(document.getElementById(id)).toBeNull();

  visible = true;
  anchor.classList.remove('poke');
  await flush();
  expect(document.getElementById(id)).not.toBeNull();
});

test('a throwing mount does not break the others', async () => {
  const bad = uid('bad');
  const good = uid('good');
  P.mountWidget({
    id: bad,
    anchor: () => {
      throw new Error('boom');
    },
    build: () => makeButton(bad),
  });
  P.mountWidget({
    id: good,
    anchor: () => document.querySelector(`.${good}`),
    build: () => makeButton(good),
  });
  const anchor = document.createElement('div');
  anchor.className = good;
  document.body.appendChild(anchor);
  await flush();
  expect(document.getElementById(good)).not.toBeNull();
});

test('widgets sharing an anchor insert in registration order', async () => {
  const a = uid('ord-a');
  const b = uid('ord-b');
  const cls = uid('ord-anchor');
  P.mountWidget({ id: a, anchor: () => document.querySelector(`.${cls}`), build: () => makeButton(a) });
  P.mountWidget({ id: b, anchor: () => document.querySelector(`.${cls}`), build: () => makeButton(b) });
  const anchor = document.createElement('div');
  anchor.className = cls;
  document.body.appendChild(anchor);
  await flush();
  expect([...anchor.children].map((el) => el.id)).toEqual([a, b]);
});

// Declaration order matters: this must be the LAST test in the file so
// every registration above has already happened.
test('exactly one MutationObserver serves all mounts', () => {
  expect(observerCount).toBe(1);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/mount-widget.test.js`
Expected: FAIL — `P.mountWidget is not a function`.

- [ ] **Step 3: Implement the mount layer in `extension/common/sigc-common.js`**

Insert immediately BEFORE the `window.__sigcPro = {` assignment (after the `exportFileBase` function):

```js
  // --- shared widget mounting ----------------------------------------
  // ONE registry + ONE MutationObserver on document.body for every
  // SIGC-PRO widget, replacing the per-feature observers (7+ of them,
  // each fanning out on every DOM mutation on busy FullCalendar/
  // DataTables pages). Every mount is insert-or-remove: each tick, a
  // widget exists iff its anchor exists and its `when` gate passes, so
  // toolbar re-renders that wipe a widget are healed on the next batch
  // and SPA-navigating away removes it.
  const mounts = [];
  let mountObserver = null;

  // Per-batch context: memoizes the lookups several mounts share, so a
  // batch costs one document-wide query per lookup, not one per mount.
  function makeTickCtx() {
    const memo = new Map();
    const once = (key, fn) => {
      if (!memo.has(key)) memo.set(key, fn());
      return memo.get(key);
    };
    return {
      dtToolbar: () => once('dtToolbar', () => document.querySelector('.dt-buttons')),
      agendaChunk: () => once('agendaChunk', findAgendaToolbarChunk),
      onLista: () => once('onLista', onListaEnderecos),
      onAgenda: () => once('onAgenda', onAgendaPage),
    };
  }

  // try/catch per mount: one broken mount must never break the others —
  // the isolation the per-feature IIFEs used to provide.
  function tickMount(m, ctx) {
    try {
      const existing = document.getElementById(m.id);
      const anchorEl = m.anchor(ctx);
      const ok = anchorEl && (!m.when || m.when(ctx));
      if (ok && !existing) anchorEl.appendChild(m.build());
      else if (!ok && existing) existing.remove();
    } catch (err) {
      console.warn(`${TAG} mount "${m.id}" tick failed:`, err);
    }
  }

  function tickAllMounts() {
    const ctx = makeTickCtx();
    mounts.forEach((m) => tickMount(m, ctx));
  }

  // { id, anchor: (ctx) => Element|null, when?: (ctx) => bool,
  //   build: () => Element }. Registers the widget, ticks it once
  // immediately (covers already-loaded pages), and lazily starts the
  // shared observer. The union config (childList + subtree + class
  // attributes) serves every mount — class attributes because the
  // Dia/Semana toggle flips fc-button-active without re-rendering the
  // toolbar; ticks are cheap (memoized ctx + O(1) getElementById), so
  // the extra firings don't matter.
  function mountWidget(spec) {
    mounts.push(spec);
    tickMount(spec, makeTickCtx());
    if (!mountObserver) {
      mountObserver = new MutationObserver(tickAllMounts);
      mountObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class'],
      });
    }
  }
```

Then add to the `window.__sigcPro = { … }` export object, after `agendaMinScheduleDate,`:

```js
    mountWidget,
```

- [ ] **Step 4: Run tests**

Run: `bun test`
Expected: all pass (mount-widget, helpers, smoke).

- [ ] **Step 5: Syntax check**

Run: `bun build --no-bundle extension/common/sigc-common.js > /dev/null && echo OK`
Expected: `OK`

- [ ] **Step 6: Commit** (pre-commit hook will auto-bump the manifest version — expected)

```bash
git add tests/mount-widget.test.js extension/common/sigc-common.js
git commit -m "feat: shared mountWidget registry with single MutationObserver"
```

---

### Task 4: Button factories (TDD)

**Files:**
- Create: `tests/button-factories.test.js`
- Modify: `extension/common/sigc-common.js` (add factories + exports)

**Interfaces:**
- Consumes: nothing new.
- Produces: `window.__sigcPro.makeDtProButton({ id, lines, title, onClick })` (`lines` = array of strings joined with `<br>`, e.g. `['KML', 'PRO']`) and `window.__sigcPro.makeFcProButton({ id, text, title, onClick })` (`id` and `onClick` optional). Both return a `<button>`. Tasks 5–8 call these exact signatures.

- [ ] **Step 1: Write the failing tests — `tests/button-factories.test.js`**

```js
import { describe, test, expect } from 'bun:test';

await import('../extension/common/sigc-common.js');
const P = window.__sigcPro;

describe('makeDtProButton', () => {
  test('produces a native-classed 36px toolbar button', () => {
    let clicked = 0;
    const btn = P.makeDtProButton({
      id: 'dt-x',
      lines: ['KML', 'PRO'],
      title: 'Exportar KML (SIGC-PRO)',
      onClick: () => (clicked += 1),
    });
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.id).toBe('dt-x');
    expect(btn.type).toBe('button');
    expect(btn.className).toBe('dt-button buttons-html5 dt-btn-icon');
    expect(btn.title).toBe('Exportar KML (SIGC-PRO)');
    expect(btn.querySelector('span').innerHTML).toBe('KML<br>PRO');
    expect(btn.style.width).toBe('36px');
    expect(btn.style.background).toBe('#005a9c');
    btn.click();
    expect(clicked).toBe(1);
  });
});

describe('makeFcProButton', () => {
  test('produces an fc-classed toolbar button', () => {
    let clicked = 0;
    const btn = P.makeFcProButton({
      id: 'fc-x',
      text: 'CSV-PRO',
      title: 'Exportar slots da agenda (SIGC-PRO)',
      onClick: () => (clicked += 1),
    });
    expect(btn.className).toBe('fc-button fc-button-primary');
    expect(btn.textContent).toBe('CSV-PRO');
    expect(btn.style.marginLeft).toBe('4px');
    expect(btn.style.background).toBe('#005a9c');
    btn.click();
    expect(clicked).toBe(1);
  });

  test('id and onClick are optional (date-picker wraps its own)', () => {
    const btn = P.makeFcProButton({ text: '📅', title: 'Ir para a data (SIGC-PRO)' });
    expect(btn.id).toBe('');
    btn.click(); // must not throw
  });
});
```

Note: if `btn.style.background` serializes as `rgb(0, 90, 156)` in happy-dom instead of `#005a9c`, adjust the two background assertions to that value — pin whatever happy-dom actually returns.

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/button-factories.test.js`
Expected: FAIL — `P.makeDtProButton is not a function`.

- [ ] **Step 3: Implement in `extension/common/sigc-common.js`**

Insert right after the mount-layer section from Task 3 (still before the export object):

```js
  // --- SIGC-PRO button factories --------------------------------------
  // The two toolbar button styles used across features, each defined
  // exactly once (previously copy-pasted 3× each).

  // DataTables toolbar button (Lista de Endereços). Same classes as
  // SIGC's own icon buttons (dt-btn-icon etc.) — their CSS controls the
  // exact box metrics (size, padding, vertical position) that keep
  // native buttons aligned with each other. Matching pixel values by
  // hand kept drifting; reusing the classes guarantees identical
  // alignment since it's the same rules. We only override color and
  // font to make ours read as SIGC-PRO, not layout.
  function makeDtProButton({ id, lines, title, onClick }) {
    const btn = document.createElement('button');
    btn.id = id;
    btn.type = 'button';
    btn.className = 'dt-button buttons-html5 dt-btn-icon';
    const span = document.createElement('span');
    lines.forEach((line, i) => {
      if (i > 0) span.appendChild(document.createElement('br'));
      span.appendChild(document.createTextNode(line));
    });
    btn.appendChild(span);
    btn.title = title;
    btn.style.background = '#005a9c';
    btn.style.borderColor = '#005a9c';
    btn.style.color = '#fff';
    btn.style.fontWeight = '700';
    btn.style.fontSize = '7px';
    btn.style.lineHeight = '1.15';
    btn.style.textAlign = 'center';
    btn.style.textTransform = 'uppercase';
    // The native icon glyph is small/fixed-size; our two-line text label
    // is wider, so the class's width: auto grows to fit it. Pin box
    // dimensions only (not display/align-items, which broke vertical
    // alignment before) to force the same square footprint as the icon
    // buttons.
    btn.style.width = '36px';
    btn.style.minWidth = '36px';
    btn.style.maxWidth = '36px';
    btn.style.borderRadius = '4px';
    btn.addEventListener('click', onClick);
    return btn;
  }

  // FullCalendar toolbar button (Agenda). FullCalendar's own button
  // classes give correct box metrics/spacing next to Dia/Semana; only
  // color is overridden to read as SIGC-PRO. id/onClick optional: the
  // date-picker composes this inside a wrapper that owns the widget id
  // and wires its own listeners.
  function makeFcProButton({ id, text, title, onClick }) {
    const btn = document.createElement('button');
    if (id) btn.id = id;
    btn.type = 'button';
    btn.className = 'fc-button fc-button-primary';
    btn.textContent = text;
    btn.title = title;
    btn.style.background = '#005a9c';
    btn.style.borderColor = '#005a9c';
    btn.style.marginLeft = '4px';
    if (onClick) btn.addEventListener('click', onClick);
    return btn;
  }
```

Then add to the export object, after `mountWidget,`:

```js
    makeDtProButton,
    makeFcProButton,
```

- [ ] **Step 4: Run tests + syntax check**

Run: `bun test && bun build --no-bundle extension/common/sigc-common.js > /dev/null && echo OK`
Expected: all pass, `OK`.

- [ ] **Step 5: Commit**

```bash
git add tests/button-factories.test.js extension/common/sigc-common.js
git commit -m "feat: makeDtProButton/makeFcProButton shared factories"
```

---

### Task 5: Migrate the DataTables trio (csv, kml, pdf)

**Files:**
- Modify: `extension/features/csv-export/csv-export.js:54-108`
- Modify: `extension/features/kml-export/kml-export.js:127-188`
- Modify: `extension/features/pdf-export/pdf-export.js:274-333`

**Interfaces:**
- Consumes: `window.__sigcPro.mountWidget({id, anchor, when, build})`, `window.__sigcPro.makeDtProButton({id, lines, title, onClick})` (Tasks 3–4), plus each file's existing `exportCsv`/`exportKml(pesquisa)`/`exportPdf(toolbar, pesquisa)`/`installHook(pesquisa, pdfMake)` and `BUTTON_ID` constants (unchanged).
- Produces: nothing new; behavior preserved with one improvement — buttons now explicitly remove themselves when their gate goes false.

- [ ] **Step 1: csv-export.js — replace the mount code**

Delete the entire `insertButton` function AND the `whenReadyGeneric(...)` block at the bottom (everything from `function insertButton(toolbar) {` through the closing `);` of `whenReadyGeneric`, currently lines 54–108). Replace with:

```js
  // Generic: mounts wherever a DataTables Buttons toolbar and a live
  // DataTable both exist, on ANY SIGC report — not limited to Lista de
  // Endereços or a recognized pesquisa, since CSV export is
  // schema-agnostic. The shared observer replaces the old 200 ms poll:
  // the toolbar appearing IS a DOM mutation.
  window.__sigcPro.mountWidget({
    id: BUTTON_ID,
    anchor: (ctx) => ctx.dtToolbar(),
    when: () => !!window.__sigcPro.getDataTable(),
    build: () => {
      console.log(`${TAG} CSV-pro button added.`);
      return window.__sigcPro.makeDtProButton({
        id: BUTTON_ID,
        lines: ['CSV', 'PRO'],
        title: 'Exportar CSV (SIGC-PRO)',
        onClick: exportCsv,
      });
    },
  });
```

- [ ] **Step 2: kml-export.js — replace the mount code**

Delete `insertButton` and the `whenReady(...)` block (lines 127–188). Replace with:

```js
  // Pesquisa gate (whenReady, 10 s give-up) kept: the KML columns are
  // pesquisa-specific. Mounting itself moves to the shared observer;
  // `when` re-checks the page each tick, so the button now also REMOVES
  // itself on SPA-nav away from the Lista de Endereços.
  window.__sigcPro.whenReady(
    () => document.body,
    (pesquisa) => {
      window.__sigcPro.mountWidget({
        id: BUTTON_ID,
        anchor: (ctx) => ctx.dtToolbar(),
        when: (ctx) => ctx.onLista(),
        build: () => {
          console.log(`${TAG} KML-pro button added (${pesquisa.id}).`);
          return window.__sigcPro.makeDtProButton({
            id: BUTTON_ID,
            lines: ['KML', 'PRO'],
            title: 'Exportar KML (SIGC-PRO)',
            onClick: () => exportKml(pesquisa),
          });
        },
      });
    }
  );
```

- [ ] **Step 3: pdf-export.js — replace the mount code**

Delete `insertButton` and the `whenReady(...)` block (lines 274–333, keeping `installHook` and everything above). Replace with:

```js
  // pdfMake prereq + pesquisa gate kept (whenReady): the hook must be
  // installed before the button is usable. exportPdf needs the toolbar
  // to find the native PDF button — derived from the clicked button
  // itself, since build() no longer receives the toolbar.
  window.__sigcPro.whenReady(
    () =>
      window.pdfMake && typeof window.pdfMake.createPdf === 'function'
        ? window.pdfMake
        : null,
    (pesquisa, pdfMake) => {
      installHook(pesquisa, pdfMake);
      window.__sigcPro.mountWidget({
        id: BUTTON_ID,
        anchor: (ctx) => ctx.dtToolbar(),
        when: (ctx) => ctx.onLista(),
        build: () => {
          console.log(`${TAG} PDF-pro button added.`);
          return window.__sigcPro.makeDtProButton({
            id: BUTTON_ID,
            lines: ['PDF', 'PRO'],
            title: 'Exportar PDF no formato listagem (SIGC-PRO)',
            onClick: (e) =>
              exportPdf(e.currentTarget.closest('.dt-buttons'), pesquisa),
          });
        },
      });
    }
  );
```

- [ ] **Step 4: Syntax checks + full suite**

Run:
```bash
bun build --no-bundle extension/features/csv-export/csv-export.js > /dev/null &&
bun build --no-bundle extension/features/kml-export/kml-export.js > /dev/null &&
bun build --no-bundle extension/features/pdf-export/pdf-export.js > /dev/null &&
bun test && echo OK
```
Expected: `OK`.

- [ ] **Step 5: Grep for leftovers**

Run: `grep -n 'new MutationObserver' extension/features/csv-export/*.js extension/features/kml-export/*.js extension/features/pdf-export/*.js`
Expected: no matches.

- [ ] **Step 6: Commit**

```bash
git add extension/features/csv-export extension/features/kml-export extension/features/pdf-export
git commit -m "refactor: migrate dt-toolbar buttons to shared mountWidget"
```

---

### Task 6: Migrate agenda-csv-export and agenda-slot-checks

**Files:**
- Modify: `extension/features/agenda-csv-export/agenda-csv-export.js:59-98`
- Modify: `extension/features/agenda-slot-checks/agenda-slot-checks.js:149-184`

**Interfaces:**
- Consumes: `mountWidget`, `makeFcProButton` (Tasks 3–4); existing `exportAgendaCsv`/`checkSlots` and `BUTTON_ID` constants (unchanged).
- Produces: nothing new. Registration is now synchronous at script eval, so within the Agenda toolbar chunk the order is manifest order: CSV-PRO, Verificar Slots (then Guia do Dia, Guia + Mapa from Task 8) — same as today.

- [ ] **Step 1: agenda-csv-export.js — replace the mount code**

Delete `insertButton` and the `whenReadyGeneric(...)` block (lines 59–98). Replace with:

```js
  // FullCalendar re-renders its toolbar (virtual-DOM diffed) on
  // view/date navigation, which can wipe a foreign button — the shared
  // observer re-mounts on the next mutation batch.
  window.__sigcPro.mountWidget({
    id: BUTTON_ID,
    anchor: (ctx) => ctx.agendaChunk(),
    when: (ctx) => ctx.onAgenda(),
    build: () => {
      console.log(`${TAG} Agenda CSV-pro button added.`);
      return window.__sigcPro.makeFcProButton({
        id: BUTTON_ID,
        text: 'CSV-PRO',
        title: 'Exportar slots da agenda (SIGC-PRO)',
        onClick: exportAgendaCsv,
      });
    },
  });
```

- [ ] **Step 2: agenda-slot-checks.js — replace the mount code**

Delete `insertButton` and the `whenReadyGeneric(...)` block (lines 149–184). Replace with:

```js
  // Same mount posture as agenda-csv-export.
  window.__sigcPro.mountWidget({
    id: BUTTON_ID,
    anchor: (ctx) => ctx.agendaChunk(),
    when: (ctx) => ctx.onAgenda(),
    build: () => {
      console.log(`${TAG} Verificar Slots button added.`);
      return window.__sigcPro.makeFcProButton({
        id: BUTTON_ID,
        text: 'Verificar Slots',
        title: 'Verificar prazo mínimo e nomes zona/equipe dos slots (SIGC-PRO)',
        onClick: checkSlots,
      });
    },
  });
```

- [ ] **Step 3: Syntax checks + suite**

Run:
```bash
bun build --no-bundle extension/features/agenda-csv-export/agenda-csv-export.js > /dev/null &&
bun build --no-bundle extension/features/agenda-slot-checks/agenda-slot-checks.js > /dev/null &&
bun test && echo OK
```
Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add extension/features/agenda-csv-export extension/features/agenda-slot-checks
git commit -m "refactor: migrate agenda csv/slot-check buttons to mountWidget"
```

---

### Task 7: Migrate agenda-date-picker

**Files:**
- Modify: `extension/features/agenda-date-picker/agenda-date-picker.js:58-131`

**Interfaces:**
- Consumes: `mountWidget`, `makeFcProButton` (id/onClick omitted); existing `findTitle`, `getCalendarApi`, `WRAP_ID` (unchanged).
- Produces: nothing new. The widget id stays on the wrap `<span>`; the inner button keeps its icon-only overrides.

- [ ] **Step 1: Replace `insertButton` and the `whenReadyGeneric(...)` block (lines 58–131)**

```js
  // Native <input type="date"> can't be styled down to just its icon —
  // Chrome renders dd/mm/yyyy as separate focusable segments that fight
  // shrinking/hiding. Instead: a plain icon button the user actually
  // sees/clicks, plus an invisible (opacity:0, but layout-participating —
  // showPicker() throws on display:none) date input right behind it that
  // supplies the native calendar popup and fires gotoDate on change.
  function buildPicker() {
    const wrap = document.createElement('span');
    wrap.id = WRAP_ID;
    wrap.style.position = 'relative';
    wrap.style.display = 'inline-flex';
    wrap.style.verticalAlign = 'middle';
    wrap.style.marginLeft = '.5em';

    const btn = window.__sigcPro.makeFcProButton({
      text: '📅',
      title: 'Ir para a data (SIGC-PRO)',
    });
    // Icon-only button: tighter box than the factory's toolbar default;
    // the wrap owns the outer margin.
    btn.style.marginLeft = '0';
    btn.style.lineHeight = '1';
    btn.style.padding = '.2em .3em';

    const input = document.createElement('input');
    input.type = 'date';
    input.tabIndex = -1;
    input.style.position = 'absolute';
    input.style.inset = '0';
    input.style.width = '100%';
    input.style.height = '100%';
    input.style.opacity = '0';
    input.style.pointerEvents = 'none';

    btn.addEventListener('click', () => {
      const api = getCalendarApi();
      if (api) input.value = window.__sigcPro.dateToIso(api.getDate());
      if (typeof input.showPicker === 'function') input.showPicker();
    });

    input.addEventListener('change', () => {
      if (!input.value) return;
      const api = getCalendarApi();
      if (!api) {
        console.warn(`${TAG} instância do FullCalendar não encontrada — não foi possível navegar.`);
        return;
      }
      api.gotoDate(input.value);
    });

    wrap.appendChild(btn);
    wrap.appendChild(input);
    console.log(`${TAG} date picker added.`);
    return wrap;
  }

  window.__sigcPro.mountWidget({
    id: WRAP_ID,
    anchor: () => findTitle(),
    when: (ctx) => ctx.onAgenda(),
    build: buildPicker,
  });
```

- [ ] **Step 2: Syntax check + suite**

Run: `bun build --no-bundle extension/features/agenda-date-picker/agenda-date-picker.js > /dev/null && bun test && echo OK`
Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add extension/features/agenda-date-picker
git commit -m "refactor: migrate agenda date picker to mountWidget"
```

---

### Task 8: Migrate agenda-day-guide and agenda-map

**Files:**
- Modify: `extension/features/agenda-day-guide/agenda-day-guide.js:704-747`
- Modify: `extension/features/agenda-map/agenda-map.js:198-236`

**Interfaces:**
- Consumes: `mountWidget`, `makeFcProButton`; existing `diaViewActive`, `exportGuide`, `exportGuideMap(btn)`, `window.__sigcPro.dayGuide` (set by day-guide, manifest-ordered before agenda-map), `BUTTON_ID` constants (all unchanged).
- Produces: nothing new. Both buttons exist only while the Dia view is active — the fc-button-active class flip is caught by the shared observer's `attributes: ['class']`.

- [ ] **Step 1: agenda-day-guide.js — replace the mount code**

Keep line 721 (`window.__sigcPro.dayGuide = { generate, diaViewActive };`) exactly where it is. Delete `insertButton` (lines 704–718) and the `whenReadyGeneric(...)` block (lines 723–747, including its comment). Replace the deleted observer block (after the `dayGuide` assignment) with:

```js
  // Dia-view-only: `when` flips with the fc-button-active class, which
  // the shared observer watches (attributes: ['class']), so toggling
  // Dia/Semana inserts/removes the button even when the toolbar isn't
  // re-rendered.
  window.__sigcPro.mountWidget({
    id: BUTTON_ID,
    anchor: (ctx) => ctx.agendaChunk(),
    when: (ctx) => ctx.onAgenda() && diaViewActive(),
    build: () => {
      console.log(`${TAG} Guia do Dia button added.`);
      return window.__sigcPro.makeFcProButton({
        id: BUTTON_ID,
        text: 'Guia do Dia',
        title: 'Baixar guia do dia por equipe (SIGC-PRO)',
        onClick: exportGuide,
      });
    },
  });
```

- [ ] **Step 2: agenda-map.js — replace the mount code**

Delete `insertButton` (lines 198–212) and the `whenReadyGeneric(...)` block (lines 214–236). Replace with:

```js
  // Same Dia-only visibility as Guia do Dia. The old dayGuide-presence
  // poll is gone: manifest load order guarantees agenda-day-guide ran
  // first, and `when` re-checks it defensively each tick anyway.
  // exportGuideMap needs the button itself (to disable it during the
  // fetch) — taken from the click event.
  window.__sigcPro.mountWidget({
    id: BUTTON_ID,
    anchor: (ctx) => ctx.agendaChunk(),
    when: (ctx) =>
      ctx.onAgenda() && !!window.__sigcPro.dayGuide &&
      window.__sigcPro.dayGuide.diaViewActive(),
    build: () => {
      console.log(`${TAG} Guia + Mapa button added.`);
      return window.__sigcPro.makeFcProButton({
        id: BUTTON_ID,
        text: 'Guia + Mapa',
        title: 'Guia do dia com mapa — faz uma consulta ao servidor do SIGC (SIGC-PRO)',
        onClick: (e) => exportGuideMap(e.currentTarget),
      });
    },
  });
```

- [ ] **Step 3: Syntax checks + suite + final leftover grep**

Run:
```bash
bun build --no-bundle extension/features/agenda-day-guide/agenda-day-guide.js > /dev/null &&
bun build --no-bundle extension/features/agenda-map/agenda-map.js > /dev/null &&
bun test &&
grep -rn 'new MutationObserver' extension/features/ ; echo "grep exit $? (1 = clean)"
```
Expected: tests pass; the grep finds NO matches in `extension/features/` (exit 1).

- [ ] **Step 4: Commit**

```bash
git add extension/features/agenda-day-guide extension/features/agenda-map
git commit -m "refactor: migrate day-guide and agenda-map buttons to mountWidget"
```

---

### Task 9: Close out ROADMAP + spec status

**Files:**
- Modify: `ROADMAP.md:81-87` (the "Shared button layer" pending item)
- Modify: `docs/superpowers/specs/2026-07-19-shared-button-layer-design.md:4` (`**Status:** approved` → `**Status:** implemented`)

**Interfaces:** none.

- [ ] **Step 1: Read ROADMAP.md lines 75–95** to see the item's exact current text, then replace the whole `- [ ] **Shared button layer** …` bullet (through its last continuation line) with:

```markdown
- [x] **Shared button layer**: `mountWidget(...)` + `makeDtProButton`/
      `makeFcProButton` factories in sigc-common; ONE shared
      MutationObserver on document.body dispatches to all registered
      mounts (was 7+ observers). All 8 features migrated; bun test suite
      (tests/) pins mount lifecycle, factories, and pure helpers. See
      docs/superpowers/specs/2026-07-19-shared-button-layer-design.md.
```

- [ ] **Step 2: Update the spec status line** from `**Status:** approved` to `**Status:** implemented`.

- [ ] **Step 3: Commit**

```bash
git add ROADMAP.md docs/superpowers/specs/2026-07-19-shared-button-layer-design.md
git commit -m "docs: mark shared button layer done in ROADMAP"
```

---

### Task 10: Manual browser QA (user-performed)

**Files:** none — checklist only. This task cannot be automated: it needs a live SIGC session (VPN or F5 gateway). Present this checklist to the user; do not mark the task complete yourself.

Load the unpacked extension from `extension/` (chrome://extensions → Load unpacked), then:

**Lista de Endereços:**
- [ ] PDF-PRO, KML-PRO, CSV-PRO buttons appear in the DataTables toolbar, 36px, aligned with native buttons.
- [ ] Each button still downloads its file correctly.
- [ ] Open another controle (in-app re-render): buttons re-appear, exactly once each.
- [ ] SPA-navigate to a different SIGC page: PDF/KML buttons disappear (new behavior — explicit removal); CSV-PRO appears on any report with a DataTable.

**Agenda (AdministracaoAgenda):**
- [ ] CSV-PRO and Verificar Slots appear next to Dia/Semana in both views and still work.
- [ ] Date-picker 📅 appears after the toolbar title; opens the native picker; navigates the calendar.
- [ ] Toggle Semana → Dia: Guia do Dia and Guia + Mapa appear; toggle back: both disappear.
- [ ] Navigate dates (setas / date-picker): all buttons survive the toolbar re-render, no duplicates.
- [ ] Guia + Mapa still asks consent, fetches, and generates the guide with map.

**Console:** no `[sigc-pro]` mount warnings; each "button added" log appears once per mount, not repeatedly (repeated logs = build() looping — a regression).

---

## Self-review notes

- Spec coverage: mount layer (Task 3), factories (Task 4), all 8 features (Tasks 5–8, matching the spec's migration map), automated tests (Tasks 1–4), ROADMAP/docs (Task 9), browser QA (Task 10). The spec's "registration order = manifest order" holds because Tasks 6–8 register synchronously at script eval; the dt trio's order depends on whenReady/pdfMake timing, same as today.
- Line numbers cited for Modify targets are pre-change positions from the current working tree (v0.2.38+); implementers should locate by the named functions if drift occurred.
- Type consistency: `mountWidget`/`makeDtProButton`/`makeFcProButton` signatures identical across Tasks 3–8; `ctx` getters (`dtToolbar`, `agendaChunk`, `onLista`, `onAgenda`) used consistently.
