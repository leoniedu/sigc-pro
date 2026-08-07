# Fix: Último Movimento's moved endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix a live breakage where SIGC moved Último Movimento's report
onto the generic `/relatorio/filtrar?slug=...` mechanism (new URL,
`IdFiltro` value, response table id, and header text with a leading
`#!`/`!` marker) — restoring the Guia do Dia's Entrevistador field and
the "CSV TODAS" advanced export, which currently fetch successfully but
parse zero rows.

**Architecture:** Two independent files each get the same three fixes,
matching their existing (non-shared) network patterns: `agenda-map.js`
parametrizes its existing `filtrarUrl`/`filtroBody` with a slug/IdFiltro
argument and reuses that for `postUltimoMovimento`; parser header
matching tolerates a leading `#!`/`!` marker.
`ultimo-movimento-export.js` gets its own small local URL builder (same
shape, deliberately not shared — see spec) plus the corrected
`IdFiltro`/table id.

**Tech Stack:** Vanilla JS (MV3 extension, MAIN-world content scripts),
`bun:test`, `DOMParser`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-07-fix-ultimo-movimento-endpoint-design.md`.
- Live-verified new URL (per-agência shape, captured 2026-08-07):
  `POST /relatorio/filtrar?slug=relatorio-ultimo-movimento`, F5-gateway
  fallback shape `/relatorio/f5-h-$$/relatorio/filtrar?slug=relatorio-ultimo-movimento;F5_origin=<hex>&F5CH=I`.
- New `IdFiltro` value: `'relatorio-ultimo-movimento'` (was `''` at both call sites).
- New response table id: `tableRelatorio` (was `tb_ultimo_movimento`).
- New live header row: `#!Controle`, `!Domicílio`, `Entrevistador`, `Tipo Entrevista`, `Última Posição`, `Data`, `Observação`.
- `ULTIMO_MOVIMENTO_LABELS`'s label VALUES stay `'Controle'`/`'Entrevistador'` (no `#!`/`!` baked into the constant) — the match itself strips a leading run of `#`/`!` characters from the header text before calling `normalizeLabel`, so both marked and unmarked headers resolve.
- `filtrarUrl`/`filtroBody` in `agenda-map.js` are parametrized (slug / idFiltro argument added), NOT duplicated — existing Lista de Endereços call sites pass `'ListaEnderecos'` explicitly and must be unaffected.
- `ultimo-movimento-export.js` gets its OWN local URL builder (deliberate small duplicate, not shared with `agenda-map.js` — see spec's "Out of scope"/rationale section). Do not introduce a cross-file dependency between these two files.
- `postUltimoMovimento`/`fetchAgenciaReport` (the actual network-calling functions) stay manually-verified-only — do not attempt to unit-test the fetch itself, only its pure helpers (URL building, parsing).
- No manifest/permission change; both files are already in `scripts/check-privacy.sh`'s allowlist.

---

## Task 1: Parametrize `filtrarUrl`/`filtroBody`, fix `postUltimoMovimento`'s URL/table-id, tolerate the header marker

**Files:**
- Modify: `extension/features/agenda-map/agenda-map.js` (`filtrarUrl`, `filtroBody`, `postFiltrar`'s call sites, `filtroBodyUltimoMovimento`, `postUltimoMovimento`, `ULTIMO_MOVIMENTO_LABELS`/`parseUltimoMovimentoTable`)
- Test: `tests/agenda-map.test.js` (new `filtrarUrl` coverage, extended `parseUltimoMovimentoTable` coverage)

**Interfaces:**
- Consumes: nothing new.
- Produces: `filtrarUrl(origin, pathname, slug, simple)` → `string` (4-arg, was 3-arg — `slug` inserted before `simple`). `filtroBody(uf, controle, idFiltro)` → `string` (3-arg, was 2-arg). `parseUltimoMovimentoTable(headers, rows)` → unchanged signature, now tolerant of a leading `#!`/`!` header marker. `postUltimoMovimento`'s internal behavior changes (URL, table id) but its own signature (`async (uf, controle) => Map | null`) is unchanged — Task 4 (nothing else in this plan) depends on it directly, but downstream callers in `exportGuideMap` (unmodified) keep working unchanged.

- [ ] **Step 1: Write the failing test for the parametrized `filtrarUrl`**

Add to `tests/agenda-map.test.js` (create the describe block near the
top, after the existing imports — check the file's current top-of-file
structure first for where `AM` is destructured from
`window.__sigcProAgendaMapInternals`):

```js
describe('filtrarUrl', () => {
  const origin = 'https://portalweb.ibge.gov.br';
  const F5_HEX = '68747470733a2f2f773373696763706e73323032352e696267652e676f762e6272';
  const F5_PATHNAME = `/f5-w-${F5_HEX}$$/UltimoMovimento`;

  test('ListaEnderecos slug, simple mode, direct host', () => {
    expect(AM.filtrarUrl(origin, '/Agenda', 'ListaEnderecos', true))
      .toBe(`${origin}/relatorio/filtrar?slug=ListaEnderecos`);
  });

  test('relatorio-ultimo-movimento slug, simple mode, F5 gateway', () => {
    expect(AM.filtrarUrl(origin, F5_PATHNAME, 'relatorio-ultimo-movimento', true))
      .toBe(`${origin}/f5-w-${F5_HEX}$$/relatorio/filtrar?slug=relatorio-ultimo-movimento`);
  });

  test('relatorio-ultimo-movimento slug, fallback mode, F5 gateway', () => {
    expect(AM.filtrarUrl(origin, F5_PATHNAME, 'relatorio-ultimo-movimento', false))
      .toBe(`${origin}/f5-w-${F5_HEX}$$/relatorio/f5-h-$$/relatorio/filtrar?slug=relatorio-ultimo-movimento;F5_origin=${F5_HEX}&F5CH=I`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/agenda-map.test.js`
Expected: FAIL — `AM.filtrarUrl` is undefined (not yet exported for
tests), and even once exported, the current 3-arg signature doesn't
accept a slug parameter.

- [ ] **Step 3: Parametrize `filtrarUrl` and `filtroBody`**

In `extension/features/agenda-map/agenda-map.js`, find:

```js
  // simple=true: plain prefixed path. simple=false: replicate the shape
  // captured from the live gateway (f5-h-$$ segment + F5_origin/F5CH
  // params). postFiltrar tries simple first, then falls back.
  function filtrarUrl(origin, pathname, simple) {
    const f5 = f5Prefix(pathname);
    if (!f5) return `${origin}/relatorio/filtrar?slug=ListaEnderecos`;
    return simple
      ? `${origin}${f5.prefix}/relatorio/filtrar?slug=ListaEnderecos`
      : `${origin}${f5.prefix}/relatorio/f5-h-$$/relatorio/filtrar?slug=ListaEnderecos;F5_origin=${f5.hex}&F5CH=I`;
  }

  function filtroBody(uf, controle) {
    return 'filtro=' + encodeURIComponent(JSON.stringify({
      IdFiltro: 'ListaEnderecos',
      IdUf: String(uf),
      IdAgencia: '*',
      IdMunicipio: '*',
      Controle: String(controle),
      TipoVisualizacao: 'S',
    }));
  }
```

Replace with:

```js
  // simple=true: plain prefixed path. simple=false: replicate the shape
  // captured from the live gateway (f5-h-$$ segment + F5_origin/F5CH
  // params). postFiltrar tries simple first, then falls back. slug
  // selects which /relatorio/filtrar report to hit — SIGC serves both
  // Lista de Endereços (slug=ListaEnderecos) and, as of 2026-08-07,
  // Último Movimento (slug=relatorio-ultimo-movimento) through this
  // same generic endpoint.
  function filtrarUrl(origin, pathname, slug, simple) {
    const f5 = f5Prefix(pathname);
    if (!f5) return `${origin}/relatorio/filtrar?slug=${slug}`;
    return simple
      ? `${origin}${f5.prefix}/relatorio/filtrar?slug=${slug}`
      : `${origin}${f5.prefix}/relatorio/f5-h-$$/relatorio/filtrar?slug=${slug};F5_origin=${f5.hex}&F5CH=I`;
  }

  function filtroBody(uf, controle, idFiltro) {
    return 'filtro=' + encodeURIComponent(JSON.stringify({
      IdFiltro: idFiltro,
      IdUf: String(uf),
      IdAgencia: '*',
      IdMunicipio: '*',
      Controle: String(controle),
      TipoVisualizacao: 'S',
    }));
  }
```

Update `postFiltrar`'s call sites (existing Lista de Endereços fetch —
must keep working unchanged) from:

```js
  async function postFiltrar(uf, controle) {
    const urls = [...new Set([
      filtrarUrl(location.origin, location.pathname, true),
      filtrarUrl(location.origin, location.pathname, false),
    ])];
```

to:

```js
  async function postFiltrar(uf, controle) {
    const urls = [...new Set([
      filtrarUrl(location.origin, location.pathname, 'ListaEnderecos', true),
      filtrarUrl(location.origin, location.pathname, 'ListaEnderecos', false),
    ])];
```

And further down in the same function, `filtroBody(uf, controle)` →
`filtroBody(uf, controle, 'ListaEnderecos')`.

- [ ] **Step 4: Export `filtrarUrl` for tests**

Add `filtrarUrl` to the test-only internals export near the bottom of
the file:

```js
  window.__sigcProAgendaMapInternals = { parseUltimoMovimentoTable, mergeUltimoMovimento, parseDistribuicaoTable, mergeDistribuicao, filtrarUrl };
```

- [ ] **Step 5: Run test to verify Step 1's tests pass**

Run: `bun test tests/agenda-map.test.js`
Expected: PASS (3 new `filtrarUrl` tests).

- [ ] **Step 6: Write the failing test for `parseUltimoMovimentoTable`'s marker tolerance**

Append to `tests/agenda-map.test.js`, inside (or right after) the
existing `describe('parseUltimoMovimentoTable', ...)` block:

```js
  test('tolerates the live #!/! header marker (real live header row, 2026-08-07)', () => {
    const headers = ['#!Controle', '!Domicílio', 'Entrevistador', 'Tipo Entrevista', 'Última Posição', 'Data', 'Observação'];
    const rows = [['292740805220571', '1', 'Fulano de Tal', 'Realizada', 'Descarregado', '07/08/2026 10:27:20', '']];
    const map = AM.parseUltimoMovimentoTable(headers, rows);
    expect(map.get('292740805220571')).toEqual({ entrevistador: 'Fulano de Tal' });
  });

  test('still resolves the old unmarked header form (no #!/! prefix)', () => {
    const headers = ['Controle', 'Entrevistador'];
    const rows = [['C1', 'Fulano']];
    const map = AM.parseUltimoMovimentoTable(headers, rows);
    expect(map.get('C1')).toEqual({ entrevistador: 'Fulano' });
  });
```

- [ ] **Step 7: Run test to verify it fails**

Run: `bun test tests/agenda-map.test.js`
Expected: FAIL — `'#!controle'` (after `normalizeLabel`'s lowercasing)
does not equal `'controle'`, so the marked-header test returns `null`.

- [ ] **Step 8: Make the header match tolerant of a leading `#!`/`!` marker**

In `extension/features/agenda-map/agenda-map.js`, find
`parseUltimoMovimentoTable`:

```js
  function parseUltimoMovimentoTable(headers, rows) {
    const P = window.__sigcPro;
    const idx = {};
    for (const key of Object.keys(ULTIMO_MOVIMENTO_LABELS)) {
      const i = headers.findIndex(
        (h) => P.normalizeLabel(h) === P.normalizeLabel(ULTIMO_MOVIMENTO_LABELS[key]));
      if (i === -1) return null;
      idx[key] = i;
    }
```

Replace with:

```js
  // Strips a leading run of "#"/"!" characters some SIGC report grids
  // prepend to a sortable/filterable column's header text (confirmed
  // live 2026-08-07: "#!Controle", "!Domicílio") — a UI decoration, not
  // part of the label's identity, so it must not be baked into
  // ULTIMO_MOVIMENTO_LABELS itself (that would break the day this
  // decoration is toggled off again).
  function stripHeaderMarker(h) {
    return String(h ?? '').replace(/^[#!]+/, '');
  }

  function parseUltimoMovimentoTable(headers, rows) {
    const P = window.__sigcPro;
    const idx = {};
    for (const key of Object.keys(ULTIMO_MOVIMENTO_LABELS)) {
      const i = headers.findIndex(
        (h) => P.normalizeLabel(stripHeaderMarker(h)) === P.normalizeLabel(ULTIMO_MOVIMENTO_LABELS[key]));
      if (i === -1) return null;
      idx[key] = i;
    }
```

- [ ] **Step 9: Run test to verify it passes**

Run: `bun test tests/agenda-map.test.js`
Expected: PASS (all `parseUltimoMovimentoTable` tests, including the two new ones).

- [ ] **Step 10: Fix `postUltimoMovimento`'s URL, IdFiltro, and table id**

Find:

```js
  function filtroBodyUltimoMovimento(uf, controle) {
    return 'filtro=' + encodeURIComponent(JSON.stringify({
      IdFiltro: '',
      IdUf: String(uf),
      IdAgencia: '*',
      IdMunicipio: '*',
      Controle: String(controle),
      IdEntrevistadores: '*',
      IdTipoAcompanhamento: '*',
    }));
  }

  async function postUltimoMovimento(uf, controle) {
    const res = await window.__sigcPro.fetchViaGateway('/UltimoMovimento/Filtrar', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: filtroBodyUltimoMovimento(uf, controle),
    });
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    const table = doc.getElementById('tb_ultimo_movimento');
    if (!table) return null;
    const headers = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    const rows = [...table.querySelectorAll('tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()));
    return parseUltimoMovimentoTable(headers, rows);
  }
```

Replace with:

```js
  const ULTIMO_MOVIMENTO_SLUG = 'relatorio-ultimo-movimento';

  function filtroBodyUltimoMovimento(uf, controle) {
    return 'filtro=' + encodeURIComponent(JSON.stringify({
      IdFiltro: ULTIMO_MOVIMENTO_SLUG,
      IdUf: String(uf),
      IdAgencia: '*',
      IdMunicipio: '*',
      Controle: String(controle),
      IdEntrevistadores: '*',
      IdTipoAcompanhamento: '*',
    }));
  }

  // As of 2026-08-07, Último Movimento is served through the same
  // generic /relatorio/filtrar?slug=... endpoint Lista de Endereços
  // already used — so this now needs the same simple/full two-mode F5
  // retry loop as postFiltrar, not the plain-path fetchViaGateway this
  // call used before the migration.
  async function postUltimoMovimento(uf, controle) {
    const urls = [...new Set([
      filtrarUrl(location.origin, location.pathname, ULTIMO_MOVIMENTO_SLUG, true),
      filtrarUrl(location.origin, location.pathname, ULTIMO_MOVIMENTO_SLUG, false),
    ])];
    let lastErr = new Error('sem resposta');
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: filtroBodyUltimoMovimento(uf, controle),
        });
        if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); continue; }
        const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
        const table = doc.querySelector('#tableRelatorio');
        if (!table) { lastErr = new Error('tabela não reconhecida'); continue; }
        const headers = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
        const rows = [...table.querySelectorAll('tbody tr')].map((tr) =>
          [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()));
        return parseUltimoMovimentoTable(headers, rows);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }
```

(This mirrors `postFiltrar`'s exact retry-loop shape — same two-URL
`Set`, same try/catch/continue pattern, same `throw lastErr` at the
end. `postUltimoMovimento`'s caller, `fetchUltimoMovimento`, already
wraps this call in its own try/catch — see agenda-map.js's existing
`fetchUltimoMovimento` function, unmodified by this task — so a thrown
error here is still handled the same way it was before.)

- [ ] **Step 11: Run the full test suite**

Run: `bun test`
Expected: PASS, all suites green — in particular confirm
`tests/agenda-map.test.js`'s `mergeUltimoMovimento` tests (which don't
touch the fetch/URL code) are unaffected.

- [ ] **Step 12: Run the privacy gate**

Run: `bash scripts/check-privacy.sh`
Expected: `privacy gate: CLEAN`.

- [ ] **Step 13: Commit**

```bash
git add extension/features/agenda-map/agenda-map.js tests/agenda-map.test.js
git commit -m "fix: follow Último Movimento's move to /relatorio/filtrar (agenda-map.js)"
```

---

## Task 2: Fix `ultimo-movimento-export.js`'s independent implementation

**Files:**
- Modify: `extension/features/ultimo-movimento-export/ultimo-movimento-export.js` (`buildAgenciaFilterBody`, `TABLE_ID`, `fetchAgenciaReport`, new local URL builder)
- Test: `tests/ultimo-movimento-export.test.js` (update `buildAgenciaFilterBody`, `parseUltimoMovimentoHtml`'s table-id fixtures; new URL-builder coverage)

**Interfaces:**
- Consumes: `window.__sigcPro.f5Prefix` (existing, shared — this file already uses `f5Prefix`/`gatewayUrl`/`fetchViaGateway` from `sigc-common.js` for its OTHER endpoint, `/Filtro/CarregarAgencias`, which is unaffected by this fix and keeps using the shared `fetchViaGateway` unchanged).
- Produces: a new local URL-builder function (name your own, e.g. `relatorioFiltrarUrl`) used only by `fetchAgenciaReport`. No other task in this plan depends on this file's internals.

- [ ] **Step 1: Write the failing tests**

In `tests/ultimo-movimento-export.test.js`, update the existing
`describe('buildAgenciaFilterBody', ...)` block's expectation from
`IdFiltro: ''` to `IdFiltro: 'relatorio-ultimo-movimento'`:

```js
describe('buildAgenciaFilterBody', () => {
  test('URL-encodes a filtro JSON payload matching the known SIGC shape', () => {
    const body = UME.buildAgenciaFilterBody('29', '290570100');
    expect(body.startsWith('filtro=')).toBe(true);
    const decoded = JSON.parse(decodeURIComponent(body.slice('filtro='.length)));
    expect(decoded).toEqual({
      IdFiltro: 'relatorio-ultimo-movimento',
      IdUf: '29',
      IdAgencia: '290570100',
      IdMunicipio: '*',
      Controle: '*',
      IdEntrevistadores: '*',
      IdTipoAcompanhamento: '*',
    });
  });
});
```

Update the existing `describe('parseUltimoMovimentoHtml', ...)` block's
table id from `tb_ultimo_movimento` to `tableRelatorio` in all three
tests (`table id="tb_ultimo_movimento"` → `table id="tableRelatorio"`
in each inline HTML fixture; the "table is absent" test needs no
change since it already tests absence generically).

Add a new describe block for the local URL builder (name it to match
whatever you called the function in Step 3 below — this example uses
`relatorioFiltrarUrl`):

```js
describe('relatorioFiltrarUrl', () => {
  const origin = 'https://portalweb.ibge.gov.br';

  test('plain origin+path when not behind the F5 gateway', () => {
    expect(UME.relatorioFiltrarUrl(origin, '/UltimoMovimento', true))
      .toBe(`${origin}/relatorio/filtrar?slug=relatorio-ultimo-movimento`);
  });

  test('simple mode: prepends the captured F5 prefix', () => {
    expect(UME.relatorioFiltrarUrl(origin, F5_PATHNAME, true))
      .toBe(`${origin}/f5-w-${F5_HEX}$$/relatorio/filtrar?slug=relatorio-ultimo-movimento`);
  });

  test('fallback mode: full f5-h-$$ form with the doubled /relatorio segment', () => {
    expect(UME.relatorioFiltrarUrl(origin, F5_PATHNAME, false))
      .toBe(`${origin}/f5-w-${F5_HEX}$$/relatorio/f5-h-$$/relatorio/filtrar?slug=relatorio-ultimo-movimento;F5_origin=${F5_HEX}&F5CH=I`);
  });
});
```

(`F5_HEX`/`F5_PATHNAME` are already defined at the top of this test
file — reuse them, don't redefine.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/ultimo-movimento-export.test.js`
Expected: FAIL — `IdFiltro` mismatch, table-id mismatch,
`UME.relatorioFiltrarUrl` undefined.

- [ ] **Step 3: Implement the fixes**

In `extension/features/ultimo-movimento-export/ultimo-movimento-export.js`:

Change `TABLE_ID`:

```js
  const TABLE_ID = 'tableRelatorio';
```

Change `buildAgenciaFilterBody`:

```js
  // Mirrors ultimo_movimento.py's fetch_report_html filtro payload,
  // updated 2026-08-07 to match SIGC's move of this report onto the
  // generic /relatorio/filtrar?slug=relatorio-ultimo-movimento endpoint
  // (IdFiltro used to be blank when this hit its own dedicated
  // endpoint — confirmed against a live capture of the new shape).
  function buildAgenciaFilterBody(uf, agencia) {
    const filtro = {
      IdFiltro: 'relatorio-ultimo-movimento',
      IdUf: String(uf),
      IdAgencia: String(agencia),
      IdMunicipio: '*',
      Controle: '*',
      IdEntrevistadores: '*',
      IdTipoAcompanhamento: '*',
    };
    return 'filtro=' + encodeURIComponent(JSON.stringify(filtro));
  }
```

Add a local URL builder, placed near `buildAgenciaFilterBody` (this
file already has `f5Prefix` available via `window.__sigcPro.f5Prefix`,
shared from `sigc-common.js` — confirm this by checking how
`fetchAgenciaList` already uses `window.__sigcPro.fetchViaGateway`
elsewhere in this file before writing this function):

```js
  // As of 2026-08-07, Último Movimento moved onto the same generic
  // /relatorio/filtrar?slug=... mechanism Lista de Endereços already
  // used (agenda-map.js has its own equivalent, filtrarUrl — this is a
  // deliberate small local duplicate, not shared: these two files have
  // no cross-file dependency by design, see this file's header
  // comment). simple=true: plain prefixed path. simple=false: the
  // fuller captured shape with a doubled /relatorio segment before
  // /f5-h-$$.
  function relatorioFiltrarUrl(origin, pathname, simple) {
    const f5 = window.__sigcPro.f5Prefix(pathname);
    const slug = 'relatorio-ultimo-movimento';
    if (!f5) return `${origin}/relatorio/filtrar?slug=${slug}`;
    return simple
      ? `${origin}${f5.prefix}/relatorio/filtrar?slug=${slug}`
      : `${origin}${f5.prefix}/relatorio/f5-h-$$/relatorio/filtrar?slug=${slug};F5_origin=${f5.hex}&F5CH=I`;
  }
```

Change `fetchAgenciaReport` from calling the shared
`window.__sigcPro.fetchViaGateway('/UltimoMovimento/Filtrar', ...)` to
its own retry loop using `relatorioFiltrarUrl` (mirroring
`agenda-map.js`'s `postFiltrar`/`postUltimoMovimento` shape):

```js
  async function fetchAgenciaReport(uf, agencia) {
    const urls = [...new Set([
      relatorioFiltrarUrl(location.origin, location.pathname, true),
      relatorioFiltrarUrl(location.origin, location.pathname, false),
    ])];
    let lastErr = new Error('sem resposta');
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: buildAgenciaFilterBody(uf, agencia),
        });
        if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); continue; }
        return parseUltimoMovimentoHtml(await res.text());
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }
```

Add `relatorioFiltrarUrl` to the test-only internals export near the
bottom of the file:

```js
  window.__sigcProUltimoMovimentoExportInternals = {
    onUltimoMovimento,
    buildAgenciaFilterBody,
    parseUltimoMovimentoHtml,
    getCurrentUf,
    relatorioFiltrarUrl,
  };
```

(Check the exact current shape of this export object before editing —
it may have more or fewer entries than shown here; add
`relatorioFiltrarUrl` to whatever is already there without removing
anything.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/ultimo-movimento-export.test.js`
Expected: PASS, all tests including the updated `buildAgenciaFilterBody`,
`parseUltimoMovimentoHtml`, and new `relatorioFiltrarUrl` tests.

- [ ] **Step 5: Run the full test suite**

Run: `bun test`
Expected: PASS, all suites green.

- [ ] **Step 6: Run the privacy gate**

Run: `bash scripts/check-privacy.sh`
Expected: `privacy gate: CLEAN`.

- [ ] **Step 7: Commit**

```bash
git add extension/features/ultimo-movimento-export/ultimo-movimento-export.js tests/ultimo-movimento-export.test.js
git commit -m "fix: follow Último Movimento's move to /relatorio/filtrar (ultimo-movimento-export.js)"
```

---

## Manual Verification (post-implementation, live server)

Not automatable — perform against the live SIGC session:

1. Agenda Dia view, "Guia do Dia", confirm the consulta prompt, confirm
   the console now shows a non-zero "controle(s) com entrevistador"
   count (was 0 before this fix), and a generated card shows a real
   Entrevistador value.
2. Último Movimento page, enable the "ultimoMovimentoExport" advanced
   flag in Options if not already on, click "CSV TODAS", confirm the
   exported CSV has real Entrevistador/Situação data in its rows (not
   an empty or header-only file).
3. Specifically confirm the PER-CONTROLE shape (`agenda-map.js`'s
   `IdAgencia: '*'`, `Controle: <specific>`) works under the new
   endpoint — this plan's one unconfirmed assumption, since the live
   capture that informed this fix used the per-agência shape
   (`IdAgencia: <specific>`, `Controle: '*'`) instead.
4. Confirm `bash scripts/check-privacy.sh` still passes on the final
   merged state.
