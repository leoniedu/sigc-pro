# Fix: Agência via Relatório Distribuição Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix a live bug where Último Movimento's fail-closed column
matching silently zeroed out BOTH Agência and Entrevistador on every
"Guia do Dia" card (Agência was never a real column on that table), and
correctly source Agência from a different endpoint that does have it.

**Architecture:** (1) `parseUltimoMovimentoTable` drops its requirement
for an `Agência` column — it never existed there — so `Entrevistador`
starts resolving again on its own. (2) A new, symmetric per-Controle
fetch/parse/merge trio (`fetchDistribuicao`/`parseDistribuicaoTable`/
`mergeDistribuicao`) targets `/RelatorioDistribuicao/Filtrar`'s
`#tb_distribuir` table for the real Agência value ("Agência
Distribuida", not "Agência Sugerida"). (3) `exportGuideMap` sequences
three fetches (endereços, Último Movimento, Distribuição), merging each
in turn with the same fail-open error handling already in place.

**Tech Stack:** Vanilla JS (MV3 extension, MAIN-world content scripts),
`bun:test`, `DOMParser`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-06-fix-agencia-distribuicao-design.md`.
- Live-verified Último Movimento headers: `Controle`, `Domicilio`, `Entrevistador`, `Tipo de Entrevista`, `Última Posição`, `Data`, `Observação` — no `Agência`.
- Live-verified Distribuição headers: `Controle`, `Município`, `Agência Sugerida`, `Agência Distribuida`, `Data Distribuição`, `Usuário da Distribuição`. Table id: `tb_distribuir`. **"Distribuida" has no accent** — match verbatim.
- Only `Agência Distribuida` is parsed — never `Agência Sugerida`, a distinct column with different meaning.
- Distribuição filtro body: `{"IdFiltro": "", "IdUf": "<uf>", "IdMunicipio": "*", "Controle": "<controle>"}` — no `IdAgencia` field.
- No new consent prompt: the third fetch rides the existing `CONSENT_MSG` confirm — wording already covers "agência e entrevistador", no change needed.
- Every network-touching function (`postUltimoMovimento`, `postDistribuicao`, `fetchDistribuicao`, `exportGuideMap`) stays manually-verified-only — only the pure parse/merge functions get unit tests.
- A failure in either Último Movimento or Distribuição must never block the guide or the other fetch — same fail-open, per-Controle try/catch/log/continue pattern already used by `fetchUltimoMovimento`.
- No manifest/permission change; `agenda-map.js` is already fetch-sanctioned in `scripts/check-privacy.sh`.

---

## Task 1: Drop Agência from `parseUltimoMovimentoTable`, guard against regression

**Files:**
- Modify: `extension/features/agenda-map/agenda-map.js:112-133` (`ULTIMO_MOVIMENTO_LABELS`, `parseUltimoMovimentoTable`)
- Modify: `tests/agenda-map.test.js` (update `parseUltimoMovimentoTable` describe block)

**Interfaces:**
- Consumes: nothing new.
- Produces: `parseUltimoMovimentoTable(headers, rows)` → `Map<string, {entrevistador: string}> | null` (was `{agencia, entrevistador}` — the shape change is this task's whole point). `fetchUltimoMovimento`'s existing merge into `all` (unchanged code) and Task 3's `exportGuideMap` wiring both consume this new shape.

- [ ] **Step 1: Update the existing tests to the corrected shape and add a regression guard using the real live header set**

Replace the entire `describe('parseUltimoMovimentoTable', ...)` block in
`tests/agenda-map.test.js` with:

```js
describe('parseUltimoMovimentoTable', () => {
  test('maps Controle to {entrevistador} by header label', () => {
    const headers = ['Controle', 'Entrevistador', 'Situação'];
    const rows = [
      ['290570120000125', 'Fulano de Tal', 'Entrevistado'],
      ['290570120000999', 'Beltrano da Silva', 'Pendente'],
    ];
    const map = AM.parseUltimoMovimentoTable(headers, rows);
    expect(map.get('290570120000125')).toEqual({ entrevistador: 'Fulano de Tal' });
    expect(map.get('290570120000999')).toEqual({ entrevistador: 'Beltrano da Silva' });
  });

  test('is tolerant of header order and extra columns', () => {
    const headers = ['Situação', 'Entrevistador', 'Controle'];
    const rows = [['Entrevistado', 'Fulano', 'C1']];
    const map = AM.parseUltimoMovimentoTable(headers, rows);
    expect(map.get('C1')).toEqual({ entrevistador: 'Fulano' });
  });

  test('returns null when a required header is missing', () => {
    const headers = ['Controle', 'Situação'];
    const rows = [['C1', 'Entrevistado']];
    expect(AM.parseUltimoMovimentoTable(headers, rows)).toBeNull();
  });

  test('skips rows with a blank Controle', () => {
    const headers = ['Controle', 'Entrevistador'];
    const rows = [['', 'Fulano'], ['C1', 'Fulano']];
    const map = AM.parseUltimoMovimentoTable(headers, rows);
    expect(map.size).toBe(1);
    expect(map.has('C1')).toBe(true);
  });

  test('trims whitespace from cell values', () => {
    const headers = ['Controle', 'Entrevistador'];
    const rows = [[' C1 ', ' Fulano de Tal ']];
    const map = AM.parseUltimoMovimentoTable(headers, rows);
    expect(map.get('C1')).toEqual({ entrevistador: 'Fulano de Tal' });
  });

  // Regression guard: this is the REAL header row captured live from
  // #tb_ultimo_movimento (2026-08-06) — it has no Agência column. A
  // prior version of this parser required Agência to be present and
  // silently returned null for every real response as a result, which
  // zeroed out Entrevistador too even though its own column was fine.
  // This test pins the parser against the live shape so that regression
  // can't recur silently.
  test('resolves against the real live header row (no Agência column)', () => {
    const headers = ['Controle ', 'Domicilio', 'Entrevistador', 'Tipo de Entrevista', 'Última Posição', 'Data', 'Observação'];
    const rows = [['292740805220571', '1', 'Fulano de Tal', 'Entrevista', '01/01/2026', '01/01/2026 10:00:00', '']];
    const map = AM.parseUltimoMovimentoTable(headers, rows);
    expect(map.get('292740805220571')).toEqual({ entrevistador: 'Fulano de Tal' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/agenda-map.test.js`
Expected: FAIL — current `parseUltimoMovimentoTable` still requires
`Agência` and returns `{agencia, entrevistador}`, so every assertion
above mismatches or gets `null`.

- [ ] **Step 3: Fix `parseUltimoMovimentoTable`**

In `extension/features/agenda-map/agenda-map.js`, replace lines 106-133
(the comment block, `ULTIMO_MOVIMENTO_LABELS`, and
`parseUltimoMovimentoTable`) with:

```js
  // Último Movimento's own results table (#tb_ultimo_movimento), resolved
  // by header label the same way tableToEnderecosMap resolves Lista de
  // Endereços — a live column reorder can never silently join the wrong
  // fields. Unlike Lista de Endereços this table isn't pesquisa-scoped
  // (Último Movimento has no per-pesquisa registry entry), so the labels
  // are matched directly rather than via LISTA_COMMON_LABELS.
  //
  // NO Agência column: confirmed against the live table (2026-08-06) —
  // its real headers are Controle/Domicilio/Entrevistador/Tipo de
  // Entrevista/Última Posição/Data/Observação. An earlier version of
  // this parser wrongly required Agência here, which made every
  // required-header check fail and silently zeroed out Entrevistador
  // too (fail-closed, no error, no warning). Agência is now sourced
  // separately from Relatório Distribuição — see
  // parseDistribuicaoTable below.
  const ULTIMO_MOVIMENTO_LABELS = { controle: 'Controle', entrevistador: 'Entrevistador' };

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
        entrevistador: String(cells[idx.entrevistador] || '').trim(),
      });
    });
    return map;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/agenda-map.test.js`
Expected: PASS (6 tests in this describe block).

- [ ] **Step 5: Commit**

```bash
git add extension/features/agenda-map/agenda-map.js tests/agenda-map.test.js
git commit -m "fix: drop nonexistent Agência column from Último Movimento parser"
```

---

## Task 2: Fix `mergeUltimoMovimento`'s merged shape (no more `agencia` key)

**Files:**
- Modify: `extension/features/agenda-map/agenda-map.js` (`mergeUltimoMovimento`, around line 147-154)
- Modify: `tests/agenda-map.test.js` (`mergeUltimoMovimento` describe block)

**Interfaces:**
- Consumes: `parseUltimoMovimentoTable`'s new `Map<controle, {entrevistador}>` shape (Task 1).
- Produces: `mergeUltimoMovimento(enderecos, umMap)` unchanged signature, but merged entries now carry only `entrevistador` (never `agencia`) from this source. `exportGuideMap` (Task 3) and `buildSlotCard` (unchanged, agenda-day-guide.js) consume this.

- [ ] **Step 1: Update the existing merge tests to the corrected shape**

Replace the `describe('mergeUltimoMovimento', ...)` block in
`tests/agenda-map.test.js` with:

```js
describe('mergeUltimoMovimento', () => {
  test('adds entrevistador to every entry sharing that Controle', () => {
    const enderecos = new Map([
      ['C1|D1', { lat: -12.9, lon: -38.5, zona: 'Centro', idZona: 'Z1' }],
      ['C1|D2', { lat: -12.8, lon: -38.4, zona: 'Centro', idZona: 'Z1' }],
      ['C2|D1', { lat: -13.0, lon: -38.6, zona: 'Norte', idZona: 'Z2' }],
    ]);
    const umMap = new Map([
      ['C1', { entrevistador: 'Fulano' }],
    ]);
    const merged = AM.mergeUltimoMovimento(enderecos, umMap);
    expect(merged.get('C1|D1')).toEqual({ lat: -12.9, lon: -38.5, zona: 'Centro', idZona: 'Z1', entrevistador: 'Fulano' });
    expect(merged.get('C1|D2')).toEqual({ lat: -12.8, lon: -38.4, zona: 'Centro', idZona: 'Z1', entrevistador: 'Fulano' });
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
    AM.mergeUltimoMovimento(enderecos, new Map([['C1', { entrevistador: 'Fulano' }]]));
    expect(original).toEqual({ lat: -12.9, lon: -38.5 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/agenda-map.test.js`
Expected: FAIL — `mergeUltimoMovimento` currently spreads
`{agencia: um.agencia, entrevistador: um.entrevistador}`, so
`merged.get('C1|D1')` includes `agencia: undefined` and mismatches the
new `toEqual` (which expects no `agencia` key at all).

- [ ] **Step 3: Fix `mergeUltimoMovimento`**

In `extension/features/agenda-map/agenda-map.js`, find:

```js
  function mergeUltimoMovimento(enderecos, umMap) {
    const merged = new Map();
    enderecos.forEach((v, k) => {
      const um = umMap.get(controleFromKey(k));
      merged.set(k, um ? { ...v, agencia: um.agencia, entrevistador: um.entrevistador } : v);
    });
    return merged;
  }
```

Replace with:

```js
  function mergeUltimoMovimento(enderecos, umMap) {
    const merged = new Map();
    enderecos.forEach((v, k) => {
      const um = umMap.get(controleFromKey(k));
      merged.set(k, um ? { ...v, entrevistador: um.entrevistador } : v);
    });
    return merged;
  }
```

(`controleFromKey` is unchanged — reused as-is by Task 4's
`mergeDistribuicao` too.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/agenda-map.test.js`
Expected: PASS (all `mergeUltimoMovimento` tests, 3 of them).

- [ ] **Step 5: Run the full test suite to confirm no other regression**

Run: `bun test`
Expected: PASS — note `tests/agenda-day-guide-agencia-entrevistador.test.js`
builds its own `enderecos` fixtures directly (not through
`mergeUltimoMovimento`), so it is unaffected by this shape change and
should still pass unchanged.

- [ ] **Step 6: Commit**

```bash
git add extension/features/agenda-map/agenda-map.js tests/agenda-map.test.js
git commit -m "fix: mergeUltimoMovimento no longer merges a nonexistent agencia field"
```

---

## Task 3: Add `parseDistribuicaoTable` (new pure parser)

**Files:**
- Modify: `extension/features/agenda-map/agenda-map.js` (new function, placed after `parseUltimoMovimentoTable`)
- Test: `tests/agenda-map.test.js` (new describe block)

**Interfaces:**
- Consumes: `window.__sigcPro.normalizeLabel` (existing).
- Produces: `parseDistribuicaoTable(headers, rows)` → `Map<string, {agencia: string}> | null` (fails closed when `Controle` or `Agência Distribuida` is missing — `Agência Sugerida` is never read). Task 5 (fetch + merge) consumes this.

- [ ] **Step 1: Write the failing test**

Append to `tests/agenda-map.test.js`:

```js
describe('parseDistribuicaoTable', () => {
  test('maps Controle to {agencia} using Agência Distribuida (not Sugerida)', () => {
    const headers = ['Controle', 'Município', 'Agência Sugerida', 'Agência Distribuida', 'Data Distribuição', 'Usuário da Distribuição'];
    const rows = [
      ['292370405000008', 'PARATINGA', 'BOM JESUS DA LAPA (sugerida)', 'BOM JESUS DA LAPA', '07/07/2026 00:00:00', 'EDUARDO LACRETA LEONI'],
    ];
    const map = AM.parseDistribuicaoTable(headers, rows);
    expect(map.get('292370405000008')).toEqual({ agencia: 'BOM JESUS DA LAPA' });
  });

  test('is tolerant of header order and extra columns', () => {
    const headers = ['Usuário da Distribuição', 'Agência Distribuida', 'Controle', 'Agência Sugerida'];
    const rows = [['Fulano', 'A1', 'C1', 'A0 (sugerida)']];
    const map = AM.parseDistribuicaoTable(headers, rows);
    expect(map.get('C1')).toEqual({ agencia: 'A1' });
  });

  test('returns null when Agência Distribuida is missing (Sugerida alone does not satisfy it)', () => {
    const headers = ['Controle', 'Agência Sugerida'];
    const rows = [['C1', 'A0']];
    expect(AM.parseDistribuicaoTable(headers, rows)).toBeNull();
  });

  test('returns null when Controle is missing', () => {
    const headers = ['Agência Distribuida'];
    const rows = [['A1']];
    expect(AM.parseDistribuicaoTable(headers, rows)).toBeNull();
  });

  test('skips rows with a blank Controle', () => {
    const headers = ['Controle', 'Agência Distribuida'];
    const rows = [['', 'A1'], ['C1', 'A1']];
    const map = AM.parseDistribuicaoTable(headers, rows);
    expect(map.size).toBe(1);
    expect(map.has('C1')).toBe(true);
  });

  test('trims whitespace from cell values', () => {
    const headers = ['Controle', 'Agência Distribuida'];
    const rows = [[' C1 ', ' BOM JESUS DA LAPA ']];
    const map = AM.parseDistribuicaoTable(headers, rows);
    expect(map.get('C1')).toEqual({ agencia: 'BOM JESUS DA LAPA' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/agenda-map.test.js`
Expected: FAIL — `AM.parseDistribuicaoTable` is undefined.

- [ ] **Step 3: Implement `parseDistribuicaoTable`**

In `extension/features/agenda-map/agenda-map.js`, add right after
`parseUltimoMovimentoTable` (i.e. right before the `controleFromKey`
comment block):

```js
  // Relatório Distribuição's own results table (#tb_distribuir),
  // resolved by header label the same way parseUltimoMovimentoTable
  // resolves Último Movimento. Real live headers (2026-08-06): Controle,
  // Município, Agência Sugerida, Agência Distribuida, Data Distribuição,
  // Usuário da Distribuição. Only "Agência Distribuida" (no accent on
  // "Distribuida" in the live markup — matched verbatim) is read — it
  // is the agência the household was actually assigned to, distinct
  // from "Agência Sugerida" (the system's suggestion, which the coord
  // may have overridden). Confusing the two would silently show the
  // wrong agência, so this table requires "Agência Distribuida"
  // specifically and never falls back to "Sugerida".
  const DISTRIBUICAO_LABELS = { controle: 'Controle', agencia: 'Agência Distribuida' };

  function parseDistribuicaoTable(headers, rows) {
    const P = window.__sigcPro;
    const idx = {};
    for (const key of Object.keys(DISTRIBUICAO_LABELS)) {
      const i = headers.findIndex(
        (h) => P.normalizeLabel(h) === P.normalizeLabel(DISTRIBUICAO_LABELS[key]));
      if (i === -1) return null;
      idx[key] = i;
    }
    const map = new Map();
    rows.forEach((cells) => {
      const controle = String(cells[idx.controle] || '').trim();
      if (!controle) return;
      map.set(controle, {
        agencia: String(cells[idx.agencia] || '').trim(),
      });
    });
    return map;
  }
```

Add `parseDistribuicaoTable` to the test-only internals export:

```js
  window.__sigcProAgendaMapInternals = { parseUltimoMovimentoTable, mergeUltimoMovimento, parseDistribuicaoTable };
```

(Task 5 will add `mergeDistribuicao` to this same export.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/agenda-map.test.js`
Expected: PASS (6 new tests).

- [ ] **Step 5: Commit**

```bash
git add extension/features/agenda-map/agenda-map.js tests/agenda-map.test.js
git commit -m "feat: parse Relatório Distribuição table for Agência"
```

---

## Task 4: Add `mergeDistribuicao` (new pure merge)

**Files:**
- Modify: `extension/features/agenda-map/agenda-map.js` (new function, placed after `mergeUltimoMovimento`)
- Test: `tests/agenda-map.test.js` (new describe block)

**Interfaces:**
- Consumes: `controleFromKey` (existing, unchanged), `parseDistribuicaoTable`'s `Map<controle, {agencia}>` (Task 3).
- Produces: `mergeDistribuicao(enderecos, distMap)` → new `Map`, same non-mutating merge contract as `mergeUltimoMovimento` but adds `agencia` instead of `entrevistador`. Task 5 (`exportGuideMap` wiring) consumes this.

- [ ] **Step 1: Write the failing test**

Append to `tests/agenda-map.test.js`:

```js
describe('mergeDistribuicao', () => {
  test('adds agencia to every entry sharing that Controle', () => {
    const enderecos = new Map([
      ['C1|D1', { lat: -12.9, lon: -38.5, entrevistador: 'Fulano' }],
      ['C1|D2', { lat: -12.8, lon: -38.4, entrevistador: 'Fulano' }],
      ['C2|D1', { lat: -13.0, lon: -38.6 }],
    ]);
    const distMap = new Map([
      ['C1', { agencia: 'BOM JESUS DA LAPA' }],
    ]);
    const merged = AM.mergeDistribuicao(enderecos, distMap);
    expect(merged.get('C1|D1')).toEqual({ lat: -12.9, lon: -38.5, entrevistador: 'Fulano', agencia: 'BOM JESUS DA LAPA' });
    expect(merged.get('C1|D2')).toEqual({ lat: -12.8, lon: -38.4, entrevistador: 'Fulano', agencia: 'BOM JESUS DA LAPA' });
    expect(merged.get('C2|D1')).toEqual({ lat: -13.0, lon: -38.6 });
  });

  test('returns entries unchanged when distMap is empty', () => {
    const enderecos = new Map([['C1|D1', { lat: -12.9, lon: -38.5 }]]);
    const merged = AM.mergeDistribuicao(enderecos, new Map());
    expect(merged.get('C1|D1')).toEqual({ lat: -12.9, lon: -38.5 });
  });

  test('does not mutate the input enderecos map', () => {
    const original = { lat: -12.9, lon: -38.5 };
    const enderecos = new Map([['C1|D1', original]]);
    AM.mergeDistribuicao(enderecos, new Map([['C1', { agencia: 'A1' }]]));
    expect(original).toEqual({ lat: -12.9, lon: -38.5 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/agenda-map.test.js`
Expected: FAIL — `AM.mergeDistribuicao` is undefined.

- [ ] **Step 3: Implement `mergeDistribuicao`**

In `extension/features/agenda-map/agenda-map.js`, add right after
`mergeUltimoMovimento`:

```js
  // Same non-mutating, per-Controle merge contract as
  // mergeUltimoMovimento, adding agencia instead of entrevistador — kept
  // as a separate function rather than folding into
  // mergeUltimoMovimento since the two sources are independently
  // fallible with different key sets; one small function per source is
  // clearer than one juggling both.
  function mergeDistribuicao(enderecos, distMap) {
    const merged = new Map();
    enderecos.forEach((v, k) => {
      const dist = distMap.get(controleFromKey(k));
      merged.set(k, dist ? { ...v, agencia: dist.agencia } : v);
    });
    return merged;
  }
```

Update the test-only internals export:

```js
  window.__sigcProAgendaMapInternals = { parseUltimoMovimentoTable, mergeUltimoMovimento, parseDistribuicaoTable, mergeDistribuicao };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/agenda-map.test.js`
Expected: PASS (3 new tests).

- [ ] **Step 5: Commit**

```bash
git add extension/features/agenda-map/agenda-map.js tests/agenda-map.test.js
git commit -m "feat: merge Distribuição's agência into enderecos"
```

---

## Task 5: Fetch Distribuição per Controle, wire into `exportGuideMap`

**Files:**
- Modify: `extension/features/agenda-map/agenda-map.js` (`filtroBodyDistribuicao`, `postDistribuicao`, `distribuicaoCache`, `fetchDistribuicao`, `exportGuideMap` wiring)

**Interfaces:**
- Consumes: `window.__sigcPro.fetchViaGateway` (existing), `parseDistribuicaoTable` (Task 3), `mergeDistribuicao` (Task 4).
- Produces: `fetchDistribuicao(uf, controles)` → `Promise<Map<controle, {agencia}>>`, same per-Controle cache/try-catch/continue shape as `fetchUltimoMovimento`. `exportGuideMap` (existing, modified) consumes it directly — no other task depends on this one.

- [ ] **Step 1: Implement the fetch functions**

In `extension/features/agenda-map/agenda-map.js`, add right after
`fetchUltimoMovimento` (after its closing brace, before the `// ---
UI ---` comment):

```js
  function filtroBodyDistribuicao(uf, controle) {
    return 'filtro=' + encodeURIComponent(JSON.stringify({
      IdFiltro: '',
      IdUf: String(uf),
      IdMunicipio: '*',
      Controle: String(controle),
    }));
  }

  async function postDistribuicao(uf, controle) {
    const res = await window.__sigcPro.fetchViaGateway('/RelatorioDistribuicao/Filtrar', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: filtroBodyDistribuicao(uf, controle),
    });
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    const table = doc.getElementById('tb_distribuir');
    if (!table) return null;
    const headers = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    const rows = [...table.querySelectorAll('tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()));
    return parseDistribuicaoTable(headers, rows);
  }

  // In-memory only, mirrors ultimoMovimentoCache: controle ->
  // Map(controle -> {agencia}) | null.
  const distribuicaoCache = new Map();

  // One sequential POST per distinct Controle not already cached. Same
  // per-Controle failure isolation as fetchUltimoMovimento: one bad
  // Controle is logged and skipped, never fatal to the run.
  async function fetchDistribuicao(uf, controles) {
    const all = new Map();
    for (const c of controles) {
      if (!distribuicaoCache.has(c)) {
        try {
          distribuicaoCache.set(c, await postDistribuicao(uf, c));
        } catch (err) {
          console.warn(`${TAG} Distribuição lookup for Controle ${c} failed:`, err);
          distribuicaoCache.set(c, null);
        }
      }
      const result = distribuicaoCache.get(c);
      if (result) result.forEach((v, k) => all.set(k, v));
    }
    return all;
  }
```

- [ ] **Step 2: Wire the fetch into `exportGuideMap`**

Find the existing block inside `exportGuideMap` (currently):

```js
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
```

Replace with:

```js
      try {
        enderecos = await fetchEnderecos(uf, controles);
        console.log(`${TAG} ${enderecos.size} endereço(s) de ${controles.length} controle(s).`);
        const umMap = await fetchUltimoMovimento(uf, controles);
        enderecos = mergeUltimoMovimento(enderecos, umMap);
        console.log(`${TAG} ${umMap.size} controle(s) com entrevistador.`);
        const distMap = await fetchDistribuicao(uf, controles);
        enderecos = mergeDistribuicao(enderecos, distMap);
        console.log(`${TAG} ${distMap.size} controle(s) com agência.`);
      } catch (err) {
        alert(`SIGC-PRO: não foi possível obter coordenadas (${err && err.message}); ` +
          'o guia será gerado sem mapa.');
      } finally {
        btn.disabled = false;
      }
```

(`CONSENT_MSG` already says "coordenadas, zona, agência e
entrevistador" — no change needed, per Global Constraints.)

- [ ] **Step 3: Run the full test suite**

Run: `bun test`
Expected: PASS, all suites green (`postDistribuicao`/`fetchDistribuicao`/
`exportGuideMap` are network-touching and intentionally untested here,
per Global Constraints — only the pure functions from Tasks 1-4 are
covered).

- [ ] **Step 4: Run the privacy gate**

Run: `bash scripts/check-privacy.sh`
Expected: `privacy gate: CLEAN` — no new file touches `fetch`, this task
only adds code inside the already-sanctioned `agenda-map.js`.

- [ ] **Step 5: Commit**

```bash
git add extension/features/agenda-map/agenda-map.js
git commit -m "feat: fetch Distribuição and merge agência into the guide"
```

---

## Task 6: Update ROADMAP.md

**Files:**
- Modify: `ROADMAP.md`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed by other tasks.

- [ ] **Step 1: Add a corrective entry**

Append to the "Done" section of `ROADMAP.md`, right after the existing
entry for the original zona-nome/agência/entrevistador feature (search
for "Guia + Mapa: visit cards show the zona's nome"):

```markdown
- [x] Fix: the Agência lookup above was broken from the start — Último
      Movimento's live table has no Agência column at all (only
      Controle/Domicilio/Entrevistador/Tipo de Entrevista/Última
      Posição/Data/Observação), so the fail-closed column matcher
      silently returned null for every request, zeroing out
      Entrevistador too. Entrevistador now resolves correctly again;
      Agência is sourced from a separate Relatório Distribuição query
      (`/RelatorioDistribuicao/Filtrar`, table `#tb_distribuir`,
      column "Agência Distribuida" — not "Agência Sugerida", a
      different column), same opt-in consulta, same fail-open handling
      (`2026-08-06-fix-agencia-distribuicao-design.md`)
```

- [ ] **Step 2: Commit**

```bash
git add ROADMAP.md
git commit -m "docs: log the agência/distribuição fix in ROADMAP"
```

---

## Manual Verification (post-implementation, live server)

Not automatable — perform against the live SIGC session:

1. On the Agenda Dia view with at least one reserved slot, click "Guia do
   Dia", confirm the consulta prompt.
2. In the browser console, confirm three non-informational log lines
   from `[sigc-agenda-map]`:
   - `N endereço(s) de M controle(s).`
   - `N controle(s) com entrevistador.` (should be > 0 this time)
   - `N controle(s) com agência.` (should be > 0)
3. Open the downloaded guide and confirm a visit card shows real
   Agência and Entrevistador values, in the existing confirmed order
   (`Tel · Agência · Controle · Dom · Zona · Entrevistador`).
4. Confirm `bash scripts/check-privacy.sh` still passes.
