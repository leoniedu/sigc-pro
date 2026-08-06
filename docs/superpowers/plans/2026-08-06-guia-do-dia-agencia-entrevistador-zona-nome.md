# Guia do Dia: zona nome + agência/entrevistador Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On each RESERVADO visit card in the Guia do Dia, show the zona's
nome alongside its ID, and add Agência + Entrevistador — all sourced from
data already reachable via the existing opt-in "Guia + Mapa" consulta,
with no new consent prompt.

**Architecture:** (1) `agenda-day-guide.js` gains a `zonaFullLabel` helper
that appends the already-fetched-but-discarded zona nome to the existing
ID, used only by the two card-facing render paths (grid cells keep
ID-only). (2) The F5 gateway URL helpers duplicated in
`ultimo-movimento-export.js` move into `sigc-common.js` so `agenda-map.js`
can reuse them for a second endpoint. (3) `agenda-map.js` gains a
per-Controle POST to `/UltimoMovimento/Filtrar` (`IdAgencia: '*'`), parses
Agência/Entrevistador by header label, and merges them into the same
`enderecos` map already built from Lista de Endereços. (4) `buildSlotCard`
renders the two new fields in the confirmed position.

**Tech Stack:** Vanilla JS (MV3 extension, MAIN-world content scripts),
`bun:test` for unit tests, DOM parsing via `DOMParser`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-06-guia-do-dia-agencia-entrevistador-zona-nome-design.md`.
- Card field order (confirmed): `Tel · Agência · Controle · Dom · Zona · Entrevistador`.
- Zona nome shown on card + team `Zonas:` line + route-selector stop detail only — grid cells (`buildDayGrid`) stay ID-only, unchanged.
- No new consent dialog: both fetches ride the existing `CONSENT_MSG` confirm in `agenda-map.js`'s `exportGuideMap`.
- No manifest/permission change; `agenda-map.js` is already in `scripts/check-privacy.sh`'s `FETCH_DIRS` allowlist — do not edit that script.
- Live Último Movimento column headers: `Controle`, `Agência`, `Entrevistador`. Endpoint accepts `IdAgencia: '*'` + a specific `Controle` (confirmed against the live server).
- Network-touching functions (`fetchUltimoMovimento`, `postFiltrar`, `exportGuideMap`) stay manually-verified-only, per existing project convention — do not attempt to unit-test the fetch itself, only its pure helpers (parsing, merging).
- Missing/failed lookups degrade silently to blank fields (existing `.filter(Boolean)` pattern in the `ids` line already does this) — never block guide generation.

---

## Task 1: `zonaFullLabel` — zona ID + nome on the card

**Files:**
- Modify: `extension/features/agenda-day-guide/agenda-day-guide.js:104-106` (add new function near `zonaLabel`)
- Modify: `extension/features/agenda-day-guide/agenda-day-guide.js` (`buildSlotCard`, `routeCheckboxHtml`, `zonasUnion` — swap `zonaLabel` call for `zonaFullLabel`)
- Test: `tests/agenda-day-guide-zona-full-label.test.js` (new)

**Interfaces:**
- Consumes: existing `slotInfo(r, enderecos)` → `{ lat, lon, zona, idZona } | null`.
- Produces: `zonaFullLabel(info)` → `string`. `''` when `info` is null or has no `idZona` (same no-nome-only-fallback rule as `zonaLabel`); `` `${idZona} ${zona}`.trim() `` otherwise (so a present ID with no nome still renders as ID-only, matching current behavior).

- [ ] **Step 1: Write the failing test**

Create `tests/agenda-day-guide-zona-full-label.test.js`:

```js
import { describe, test, expect } from 'bun:test';

await import('../extension/common/sigc-common.js');
await import('../extension/features/agenda-day-guide/agenda-day-guide.js');

const { zonaFullLabel } = window.__sigcProAgendaDayGuideInternals;

describe('zonaFullLabel', () => {
  test('ID + nome when both are present', () => {
    expect(zonaFullLabel({ idZona: '29A3OI', zona: 'Centro' })).toBe('29A3OI Centro');
  });

  test('ID alone when nome is missing', () => {
    expect(zonaFullLabel({ idZona: '29A3OI', zona: '' })).toBe('29A3OI');
    expect(zonaFullLabel({ idZona: '29A3OI', zona: null })).toBe('29A3OI');
  });

  test('empty string when there is no idZona, even with a nome present', () => {
    expect(zonaFullLabel({ idZona: '', zona: 'Centro' })).toBe('');
    expect(zonaFullLabel({ idZona: null, zona: 'Centro' })).toBe('');
  });

  test('empty string when info is null', () => {
    expect(zonaFullLabel(null)).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/agenda-day-guide-zona-full-label.test.js`
Expected: FAIL — `window.__sigcProAgendaDayGuideInternals` is undefined (doesn't exist yet).

- [ ] **Step 3: Add an internals export and the function**

In `extension/features/agenda-day-guide/agenda-day-guide.js`, right after
the existing `zonaLabel` function (around line 104-106):

```js
  // Card-facing variant of zonaLabel: ID plus nome when both are present,
  // same no-nome-only-fallback rule (a row with no idZona renders blank
  // even if it somehow carries a nome). Used by buildSlotCard,
  // routeCheckboxHtml and the team Zonas: line — never by buildDayGrid,
  // which stays ID-only (grid cells are space-constrained).
  function zonaFullLabel(info) {
    const id = zonaLabel(info);
    if (!id) return '';
    const nome = info && info.zona ? String(info.zona).trim() : '';
    return nome ? `${id} ${nome}` : id;
  }
```

Then replace the three call sites:
- In `routeCheckboxHtml` (currently `const zona = zonaLabel(info);`) → `const zona = zonaFullLabel(info);`
- In `buildSlotCard` (currently `const zona = zonaLabel(info);`) → `const zona = zonaFullLabel(info);`
- In `zonasUnion` (currently `const real = zonaLabel(slotInfo(r, enderecos));`) → `const real = zonaFullLabel(slotInfo(r, enderecos));`

Leave `buildDayGrid`'s own `const zona = zonaLabel(slotInfo(r, enderecos));` untouched.

Add a test-only internals export near the bottom of the file, right
before the final `window.__sigcPro.dayGuide = {...}` assignment:

```js
  // Exposed only for tests — not part of the runtime public surface.
  window.__sigcProAgendaDayGuideInternals = { zonaFullLabel };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/agenda-day-guide-zona-full-label.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the full existing day-guide test suite to confirm no regression**

Run: `bun test tests/agenda-day-guide-lab-grid.test.js tests/agenda-day-guide-route-selector.test.js`
Expected: PASS, all existing tests green — in particular
`buildDayGrid — zona › shows the ID alone when both ID and name are present`
must still pass unchanged (grid untouched).

- [ ] **Step 6: Commit**

```bash
git add extension/features/agenda-day-guide/agenda-day-guide.js tests/agenda-day-guide-zona-full-label.test.js
git commit -m "feat: show zona nome alongside ID on the visit card"
```

---

## Task 2: Move F5 gateway helpers into `sigc-common.js`

**Files:**
- Modify: `extension/common/sigc-common.js` (add `f5Prefix`, `gatewayUrl`, `fetchViaGateway`; export on `window.__sigcPro`)
- Modify: `extension/features/ultimo-movimento-export/ultimo-movimento-export.js` (delete the local copies, call the shared ones)
- Modify: `tests/ultimo-movimento-export.test.js` (point `f5Prefix`/`gatewayUrl` assertions at `window.__sigcPro` instead of `UME`)
- Test: existing tests in `tests/ultimo-movimento-export.test.js` (moved, not new)

**Interfaces:**
- Consumes: nothing new.
- Produces: `window.__sigcPro.f5Prefix(pathname)` → `{prefix, hex} | null`; `window.__sigcPro.gatewayUrl(origin, pathname, path, simple)` → `string`; `window.__sigcPro.fetchViaGateway(path, options)` → `Promise<Response>` (throws on total failure, same semantics as today). Task 3 (`agenda-map.js`) consumes `gatewayUrl`/`fetchViaGateway` from `window.__sigcPro`.

This is a pure relocation — no behavior change. Do it test-first by moving
the assertions, watching them fail against the old location, then making
them pass against the new one.

- [ ] **Step 1: Move the F5 gateway tests to assert against `window.__sigcPro`**

In `tests/ultimo-movimento-export.test.js`, change the `f5Prefix` and
`gatewayUrl` `describe` blocks (currently `UME.f5Prefix(...)` /
`UME.gatewayUrl(...)`) to read from `window.__sigcPro` instead. At the
top of the file, alongside the existing `const UME = ...` line, add:

```js
const { f5Prefix, gatewayUrl } = window.__sigcPro;
```

Then replace every `UME.f5Prefix` → `f5Prefix` and `UME.gatewayUrl` →
`gatewayUrl` within those two `describe` blocks only (leave
`buildAgenciaFilterBody` and everything else on `UME`).

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/ultimo-movimento-export.test.js`
Expected: FAIL — `f5Prefix`/`gatewayUrl` are `undefined` on
`window.__sigcPro` (they still only exist on `UME`).

- [ ] **Step 3: Add the functions to `sigc-common.js`**

In `extension/common/sigc-common.js`, add near the other pure helpers
(e.g. right after `parseCoord`, before `gmapsDestinoUrl`, around line 246):

```js
  // F5 BIG-IP URL-rewriting prefix ("/f5-w-<hex>$$"); the hex decodes to
  // the real backend origin. null on the direct host (e.g. via VPN).
  // Shared by every feature that talks to portalweb behind the gateway
  // (agenda-map, ultimo-movimento-export) — each hitting a different
  // path, hence the parametrized gatewayUrl/fetchViaGateway below rather
  // than a single hardcoded endpoint.
  function f5Prefix(pathname) {
    const m = /^\/f5-w-([0-9a-f]+)\$\$/.exec(String(pathname || ''));
    return m ? { prefix: m[0], hex: m[1] } : null;
  }

  // simple=true: plain prefixed path. simple=false: replicate the fuller
  // shape captured from the live gateway (f5-h-$$ segment + F5_origin/
  // F5CH params). On the direct host (f5Prefix returns null), both modes
  // collapse to the plain origin+path.
  function gatewayUrl(origin, pathname, path, simple) {
    const f5 = f5Prefix(pathname);
    if (!f5) return `${origin}${path}`;
    return simple
      ? `${origin}${f5.prefix}${path}`
      : `${origin}${f5.prefix}/f5-h-$$${path};F5_origin=${f5.hex}&F5CH=I`;
  }

  // Tries the simple prefixed URL first, then the full captured F5 form —
  // which form the live gateway actually needs isn't knowable in advance.
  async function fetchViaGateway(path, options) {
    const urls = [...new Set([
      gatewayUrl(location.origin, location.pathname, path, true),
      gatewayUrl(location.origin, location.pathname, path, false),
    ])];
    let lastErr = new Error('sem resposta');
    for (const url of urls) {
      try {
        const res = await fetch(url, options);
        if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); continue; }
        return res;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }
```

Add the three names to the `window.__sigcPro = {...}` export block
(around line 670-699), next to `parseCoord`:

```js
    f5Prefix,
    gatewayUrl,
    fetchViaGateway,
```

- [ ] **Step 4: Delete the now-duplicated copies from `ultimo-movimento-export.js`**

Remove the `f5Prefix`, `gatewayUrl`, and `fetchViaGateway` function
definitions (currently lines 74-109) from
`extension/features/ultimo-movimento-export/ultimo-movimento-export.js`.
Replace their two call sites with the shared versions:

- `fetchAgenciaList` and `fetchAgenciaReport` call `fetchViaGateway(...)` → change to `window.__sigcPro.fetchViaGateway(...)`.

Also remove `f5Prefix` and `gatewayUrl` from the
`window.__sigcProUltimoMovimentoExportInternals` export object near the
bottom of the file (they're covered by `window.__sigcPro` now).

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/ultimo-movimento-export.test.js`
Expected: PASS, all tests including `buildAgenciaFilterBody`,
`parseUltimoMovimentoHtml`, `collectAllAgencias` (untouched) and the
relocated `f5Prefix`/`gatewayUrl` tests.

- [ ] **Step 6: Run the full test suite to confirm no other regression**

Run: `bun test`
Expected: PASS, all suites green.

- [ ] **Step 7: Commit**

```bash
git add extension/common/sigc-common.js extension/features/ultimo-movimento-export/ultimo-movimento-export.js tests/ultimo-movimento-export.test.js
git commit -m "refactor: move F5 gateway helpers into sigc-common"
```

---

## Task 3: Parse Último Movimento's table into a `controle -> {agencia, entrevistador}` map

**Files:**
- Modify: `extension/features/agenda-map/agenda-map.js` (new pure helpers)
- Test: `tests/agenda-map.test.js` (new file)

**Interfaces:**
- Consumes: `window.__sigcPro.normalizeLabel(s)` (existing, `sigc-common.js`).
- Produces: `parseUltimoMovimentoTable(headers, rows)` → `Map<string, {agencia: string, entrevistador: string}> | null` (`null` when Controle/Agência/Entrevistador headers aren't all found — fail closed, same pattern as `tableToEnderecosMap`). Task 4 (fetch + merge) consumes this.

- [ ] **Step 1: Write the failing test**

Create `tests/agenda-map.test.js`:

```js
import { describe, test, expect } from 'bun:test';

await import('../extension/common/sigc-common.js');
await import('../extension/features/agenda-map/agenda-map.js');

const AM = window.__sigcProAgendaMapInternals;

describe('parseUltimoMovimentoTable', () => {
  test('maps Controle to {agencia, entrevistador} by header label', () => {
    const headers = ['Controle', 'Agência', 'Entrevistador', 'Situação'];
    const rows = [
      ['290570120000125', '290570100', 'Fulano de Tal', 'Entrevistado'],
      ['290570120000999', '290570200', 'Beltrano da Silva', 'Pendente'],
    ];
    const map = AM.parseUltimoMovimentoTable(headers, rows);
    expect(map.get('290570120000125')).toEqual({ agencia: '290570100', entrevistador: 'Fulano de Tal' });
    expect(map.get('290570120000999')).toEqual({ agencia: '290570200', entrevistador: 'Beltrano da Silva' });
  });

  test('is tolerant of header order and extra columns', () => {
    const headers = ['Situação', 'Entrevistador', 'Controle', 'Agência'];
    const rows = [['Entrevistado', 'Fulano', 'C1', 'A1']];
    const map = AM.parseUltimoMovimentoTable(headers, rows);
    expect(map.get('C1')).toEqual({ agencia: 'A1', entrevistador: 'Fulano' });
  });

  test('returns null when a required header is missing', () => {
    const headers = ['Controle', 'Situação'];
    const rows = [['C1', 'Entrevistado']];
    expect(AM.parseUltimoMovimentoTable(headers, rows)).toBeNull();
  });

  test('skips rows with a blank Controle', () => {
    const headers = ['Controle', 'Agência', 'Entrevistador'];
    const rows = [['', 'A1', 'Fulano'], ['C1', 'A1', 'Fulano']];
    const map = AM.parseUltimoMovimentoTable(headers, rows);
    expect(map.size).toBe(1);
    expect(map.has('C1')).toBe(true);
  });

  test('trims whitespace from cell values', () => {
    const headers = ['Controle', 'Agência', 'Entrevistador'];
    const rows = [[' C1 ', ' A1 ', ' Fulano de Tal ']];
    const map = AM.parseUltimoMovimentoTable(headers, rows);
    expect(map.get('C1')).toEqual({ agencia: 'A1', entrevistador: 'Fulano de Tal' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/agenda-map.test.js`
Expected: FAIL — `window.__sigcProAgendaMapInternals` is undefined.

- [ ] **Step 3: Implement `parseUltimoMovimentoTable`**

In `extension/features/agenda-map/agenda-map.js`, add near
`tableToEnderecosMap` (after it, since it follows the same shape):

```js
  // Último Movimento's own results table (#tb_ultimo_movimento), resolved
  // by header label the same way tableToEnderecosMap resolves Lista de
  // Endereços — a live column reorder can never silently join the wrong
  // fields. Unlike Lista de Endereços this table isn't pesquisa-scoped
  // (Último Movimento has no per-pesquisa registry entry), so the three
  // labels are matched directly rather than via LISTA_COMMON_LABELS.
  const ULTIMO_MOVIMENTO_LABELS = { controle: 'Controle', agencia: 'Agência', entrevistador: 'Entrevistador' };

  function parseUltimoMovimentoTable(headers, rows) {
    const P = window.__sigcPro;
    const idx = {};
    for (const key of Object.keys(ULTIMO_MOVIMENTO_LABELS)) {
      const i = headers.findIndex(
        (h) => P.normalizeLabel(h) === P.normalizeLabel(ULTIMO_MOVIMENTO_LABELS[key]));
      if (i === -1) return null;
      idx[key] = i;
    }
    const map = new Map();
    rows.forEach((cells) => {
      const controle = String(cells[idx.controle] || '').trim();
      if (!controle) return;
      map.set(controle, {
        agencia: String(cells[idx.agencia] || '').trim(),
        entrevistador: String(cells[idx.entrevistador] || '').trim(),
      });
    });
    return map;
  }
```

Add a test-only internals export at the bottom of the file, before the
closing `})();`:

```js
  // Exposed only for tests — not part of the runtime public surface.
  window.__sigcProAgendaMapInternals = { parseUltimoMovimentoTable };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/agenda-map.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add extension/features/agenda-map/agenda-map.js tests/agenda-map.test.js
git commit -m "feat: parse Último Movimento table by Controle"
```

---

## Task 4: Fetch Último Movimento per Controle and merge into `enderecos`

**Files:**
- Modify: `extension/features/agenda-map/agenda-map.js` (`fetchUltimoMovimentoPorControle`, `fetchUltimoMovimento`, merge into `fetchEnderecos`'s caller, updated `CONSENT_MSG`)
- Test: `tests/agenda-map.test.js` (extend from Task 3)

**Interfaces:**
- Consumes: `parseUltimoMovimentoTable` (Task 3), `window.__sigcPro.fetchViaGateway`/`escapeHtml` are NOT needed here (no HTML escaping on the fetch side); `enderecosCache`/`fetchEnderecos` (existing, same file).
- Produces: `mergeUltimoMovimento(enderecos, umMap)` → mutates nothing, returns a **new** `Map` with `agencia`/`entrevistador` added to every entry whose Controle (the part of its `controle|domicilio` key before `|`) is present in `umMap`; entries for controles absent from `umMap` pass through unchanged (no `agencia`/`entrevistador` keys added). `exportGuideMap` (existing) consumes this to build the final `enderecos` passed to `dayGuide.generate`.

- [ ] **Step 1: Write the failing test for the merge function**

Append to `tests/agenda-map.test.js`:

```js
describe('mergeUltimoMovimento', () => {
  test('adds agencia/entrevistador to every entry sharing that Controle', () => {
    const enderecos = new Map([
      ['C1|D1', { lat: -12.9, lon: -38.5, zona: 'Centro', idZona: 'Z1' }],
      ['C1|D2', { lat: -12.8, lon: -38.4, zona: 'Centro', idZona: 'Z1' }],
      ['C2|D1', { lat: -13.0, lon: -38.6, zona: 'Norte', idZona: 'Z2' }],
    ]);
    const umMap = new Map([
      ['C1', { agencia: 'A1', entrevistador: 'Fulano' }],
    ]);
    const merged = AM.mergeUltimoMovimento(enderecos, umMap);
    expect(merged.get('C1|D1')).toEqual({ lat: -12.9, lon: -38.5, zona: 'Centro', idZona: 'Z1', agencia: 'A1', entrevistador: 'Fulano' });
    expect(merged.get('C1|D2')).toEqual({ lat: -12.8, lon: -38.4, zona: 'Centro', idZona: 'Z1', agencia: 'A1', entrevistador: 'Fulano' });
    // C2 has no Último Movimento match: passes through untouched.
    expect(merged.get('C2|D1')).toEqual({ lat: -13.0, lon: -38.6, zona: 'Norte', idZona: 'Z2' });
  });

  test('returns the original map unchanged when umMap is empty', () => {
    const enderecos = new Map([['C1|D1', { lat: -12.9, lon: -38.5 }]]);
    const merged = AM.mergeUltimoMovimento(enderecos, new Map());
    expect(merged.get('C1|D1')).toEqual({ lat: -12.9, lon: -38.5 });
  });

  test('does not mutate the input enderecos map', () => {
    const original = { lat: -12.9, lon: -38.5 };
    const enderecos = new Map([['C1|D1', original]]);
    AM.mergeUltimoMovimento(enderecos, new Map([['C1', { agencia: 'A1', entrevistador: 'Fulano' }]]));
    expect(original).toEqual({ lat: -12.9, lon: -38.5 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/agenda-map.test.js`
Expected: FAIL — `AM.mergeUltimoMovimento` is undefined.

- [ ] **Step 3: Implement `mergeUltimoMovimento` and the fetch functions**

In `extension/features/agenda-map/agenda-map.js`, add near
`fetchEnderecos` (the pure merge function first, network functions after):

```js
  // enderecoKey is "controle|domicilio" (see agenda-day-guide.js's own
  // enderecoKey) — split on the FIRST "|" only, since a domicilio value
  // can theoretically contain no "|" itself (matches how the key was
  // built, string concatenation with a literal "|" separator).
  function controleFromKey(key) {
    return key.slice(0, key.indexOf('|'));
  }

  // New Map: every enderecos entry sharing a Controle present in umMap
  // gets agencia/entrevistador added; entries for controles with no
  // Último Movimento match pass through unchanged (never blocks the
  // guide — see buildSlotCard's existing present-only rendering).
  function mergeUltimoMovimento(enderecos, umMap) {
    const merged = new Map();
    enderecos.forEach((v, k) => {
      const um = umMap.get(controleFromKey(k));
      merged.set(k, um ? { ...v, agencia: um.agencia, entrevistador: um.entrevistador } : v);
    });
    return merged;
  }
```

Add the network functions after `fetchEnderecos` (around line 154):

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

  // In-memory only, mirrors enderecosCache: controle -> Map(controle ->
  // {agencia, entrevistador}) | null (null = fetched, no usable table).
  const ultimoMovimentoCache = new Map();

  // One sequential POST per distinct Controle not already cached. A
  // failed or empty-table Controle is logged and skipped — never fatal
  // to the run, matching fetchEnderecos/postFiltrar's own failure mode.
  async function fetchUltimoMovimento(uf, controles) {
    const all = new Map();
    for (const c of controles) {
      if (!ultimoMovimentoCache.has(c)) {
        try {
          ultimoMovimentoCache.set(c, await postUltimoMovimento(uf, c));
        } catch (err) {
          console.warn(`${TAG} Último Movimento lookup for Controle ${c} failed:`, err);
          ultimoMovimentoCache.set(c, null);
        }
      }
      const result = ultimoMovimentoCache.get(c);
      if (result) result.forEach((v, k) => all.set(k, v));
    }
    return all;
  }
```

Update `CONSENT_MSG` (currently around line 162-164):

```js
  const CONSENT_MSG =
    'SIGC-PRO: isto fará uma consulta ao próprio servidor do SIGC para ' +
    'obter as coordenadas, zona, agência e entrevistador dos endereços. ' +
    'Nenhum dado sai do IBGE. Continuar?';
```

Update `exportGuideMap`'s fetch block (currently only calls
`fetchEnderecos`) to also fetch and merge Último Movimento:

```js
    } else if (uf && controles.length > 0) {
      btn.disabled = true;
      try {
        enderecos = await fetchEnderecos(uf, controles);
        console.log(`${TAG} ${enderecos.size} endereço(s) de ${controles.length} controle(s).`);
        const umMap = await fetchUltimoMovimento(uf, controles);
        enderecos = mergeUltimoMovimento(enderecos, umMap);
        console.log(`${TAG} ${umMap.size} controle(s) com agência/entrevistador.`);
      } catch (err) {
        alert(`SIGC-PRO: não foi possível obter coordenadas (${err && err.message}); ` +
          'o guia será gerado sem mapa.');
      } finally {
        btn.disabled = false;
      }
    } else {
```

Add `mergeUltimoMovimento` to the test-only internals export from Task 3:

```js
  window.__sigcProAgendaMapInternals = { parseUltimoMovimentoTable, mergeUltimoMovimento };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/agenda-map.test.js`
Expected: PASS (8 tests total: 5 from Task 3 + 3 new).

- [ ] **Step 5: Run the full test suite**

Run: `bun test`
Expected: PASS, all suites green.

- [ ] **Step 6: Commit**

```bash
git add extension/features/agenda-map/agenda-map.js tests/agenda-map.test.js
git commit -m "feat: fetch and merge agência/entrevistador into enderecos"
```

---

## Task 5: Render Agência + Entrevistador on the visit card

**Files:**
- Modify: `extension/features/agenda-day-guide/agenda-day-guide.js:487-493` (`buildSlotCard`'s `ids` line)
- Test: `tests/agenda-day-guide-agencia-entrevistador.test.js` (new)

**Interfaces:**
- Consumes: `slotInfo(r, enderecos)` entries now possibly carrying `agencia`/`entrevistador` (Task 4's merge output — `buildSlotCard` itself doesn't know or care how they got there).
- Produces: updated `ids` line HTML in `buildSlotCard`'s output.

- [ ] **Step 1: Write the failing test**

Create `tests/agenda-day-guide-agencia-entrevistador.test.js`:

```js
import { describe, test, expect } from 'bun:test';

await import('../extension/common/sigc-common.js');
await import('../extension/features/agenda-day-guide/agenda-day-guide.js');

const { buildSlotCard } = window.__sigcPro.dayGuide;

function row({ reservado = true, horaInicio = '09:00', horaFim = '09:30', nome = 'Sileide da Silva Eufrazio',
  controle = '290570120000125', domicilio = '14', telefone = '(71)999093137' } = {}) {
  return { reservado, horaInicio, horaFim, nome, controle, domicilio, telefone, equipe: 'A' };
}

function info(extra = {}) {
  return { lat: -12.9, lon: -38.5, zona: 'Nome-da-Zona', idZona: '29Z9XU', ...extra };
}

describe('buildSlotCard — Agência / Entrevistador', () => {
  test('renders Agência and Entrevistador in the confirmed order', () => {
    const enderecos = new Map([['290570120000125|14',
      info({ agencia: '290570100', entrevistador: 'Fulano de Tal' })]]);
    const html = buildSlotCard(row(), enderecos, null, '#005a9c', 'team-0', true);
    const tel = html.indexOf('Tel:');
    const agencia = html.indexOf('Agência:');
    const controle = html.indexOf('Controle:');
    const dom = html.indexOf('Dom:');
    const zona = html.indexOf('Zona:');
    const entrevistador = html.indexOf('Entrevistador:');
    expect([tel, agencia, controle, dom, zona, entrevistador].every((i) => i !== -1)).toBe(true);
    expect(tel).toBeLessThan(agencia);
    expect(agencia).toBeLessThan(controle);
    expect(controle).toBeLessThan(dom);
    expect(dom).toBeLessThan(zona);
    expect(zona).toBeLessThan(entrevistador);
    expect(html).toContain('Agência: 290570100');
    expect(html).toContain('Entrevistador: Fulano de Tal');
    expect(html).toContain('Zona: 29Z9XU Nome-da-Zona');
  });

  test('omits Agência and Entrevistador when absent from the endereços entry', () => {
    const enderecos = new Map([['290570120000125|14', info()]]);
    const html = buildSlotCard(row(), enderecos, null, '#005a9c', 'team-0', true);
    expect(html).not.toContain('Agência:');
    expect(html).not.toContain('Entrevistador:');
  });

  test('omits both when there is no endereços map at all', () => {
    const html = buildSlotCard(row(), null, null, '#005a9c', 'team-0', true);
    expect(html).not.toContain('Agência:');
    expect(html).not.toContain('Entrevistador:');
  });

  test('escapes HTML in agencia/entrevistador values', () => {
    const enderecos = new Map([['290570120000125|14',
      info({ agencia: '<b>A1</b>', entrevistador: '<script>x</script>' })]]);
    const html = buildSlotCard(row(), enderecos, null, '#005a9c', 'team-0', true);
    expect(html).not.toContain('<script>x</script>');
    expect(html).not.toContain('<b>A1</b>');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/agenda-day-guide-agencia-entrevistador.test.js`
Expected: FAIL — no `Agência:`/`Entrevistador:` text in the output.

- [ ] **Step 3: Update `buildSlotCard`'s `ids` line**

In `extension/features/agenda-day-guide/agenda-day-guide.js`, the current
`ids` block (around lines 487-493):

```js
    const info = slotInfo(r, enderecos);
    const zona = zonaFullLabel(info);
    const ids = [
      r.telefone && `Tel: ${e(r.telefone)}`,
      r.controle && `Controle: ${e(r.controle)}`,
      r.domicilio && `Dom: ${e(r.domicilio)}`,
      zona && `Zona: ${e(zona)}`,
    ].filter(Boolean).join(' &nbsp;·&nbsp; ');
```

becomes:

```js
    const info = slotInfo(r, enderecos);
    const zona = zonaFullLabel(info);
    const ids = [
      r.telefone && `Tel: ${e(r.telefone)}`,
      info && info.agencia && `Agência: ${e(info.agencia)}`,
      r.controle && `Controle: ${e(r.controle)}`,
      r.domicilio && `Dom: ${e(r.domicilio)}`,
      zona && `Zona: ${e(zona)}`,
      info && info.entrevistador && `Entrevistador: ${e(info.entrevistador)}`,
    ].filter(Boolean).join(' &nbsp;·&nbsp; ');
```

(Note: `zonaFullLabel` and this `zona` line already exist from Task 1 —
this step only adds the two new array entries around the existing ones.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/agenda-day-guide-agencia-entrevistador.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the full test suite**

Run: `bun test`
Expected: PASS, all suites green — in particular the existing
`buildSlotCard route checkbox` tests in
`tests/agenda-day-guide-route-selector.test.js` must still pass (they use
`enderecos` entries without `agencia`/`entrevistador`, which must keep
omitting those segments).

- [ ] **Step 6: Commit**

```bash
git add extension/features/agenda-day-guide/agenda-day-guide.js tests/agenda-day-guide-agencia-entrevistador.test.js
git commit -m "feat: show Agência and Entrevistador on the visit card"
```

---

## Task 6: Update ROADMAP.md

**Files:**
- Modify: `ROADMAP.md`

**Interfaces:**
- Consumes: nothing (documentation only).
- Produces: nothing consumed by other tasks.

- [ ] **Step 1: Add a checklist entry**

Append to the "Done" section of `ROADMAP.md`, following the existing
entry style for Guia do Dia features (see the `agenda-map` design's
"[x] Guia + Mapa:" entries for the exact tone/format to match):

```markdown
- [x] Guia + Mapa: visit cards show the zona's nome alongside its ID, and
      Agência/Entrevistador fetched from Último Movimento per Controle
      (IdAgencia: '*') — rides the same opt-in consulta as coordinates/
      zona, no new consent prompt; grid cells stay ID-only
      (`2026-08-06-guia-do-dia-agencia-entrevistador-zona-nome-design.md`)
```

- [ ] **Step 2: Commit**

```bash
git add ROADMAP.md
git commit -m "docs: log zona nome + agência/entrevistador in ROADMAP"
```

---

## Manual Verification (post-implementation, live server)

Not automatable — perform against the live SIGC session, same as every
other network path in this codebase:

1. On the Agenda Dia view with at least one reserved slot, click "Guia do
   Dia", confirm the consulta prompt.
2. Confirm the downloaded guide's visit cards show, in order: Tel,
   Agência, Controle, Dom, Zona (ID + nome), Entrevistador.
3. Decline the consulta prompt on a fresh page load — confirm the guide
   still generates, with no Agência/Entrevistador/zona-nome/map (same
   degraded output as before this change).
4. Confirm `scripts/check-privacy.sh` still passes (no fetch outside the
   allowed directories) — run `bash scripts/check-privacy.sh`.
