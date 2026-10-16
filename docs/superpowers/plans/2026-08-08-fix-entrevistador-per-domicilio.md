# Fix: Entrevistador collapses per Controle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `parseUltimoMovimentoTable` currently keys its output map by
Controle alone, so when a Controle has multiple Domicílios (the normal
case — Último Movimento has one row per Domicílio), every row silently
overwrites the previous one and every household but the last loses its
real Entrevistador. Fix: key by `controle|domicilio`, matching the
convention already used elsewhere in this codebase.

**Architecture:** One function's map-key changes
(`parseUltimoMovimentoTable`), one function's lookup simplifies
(`mergeUltimoMovimento`, no longer needs `controleFromKey`).
`parseDistribuicaoTable`/`mergeDistribuicao` are explicitly untouched —
Relatório Distribuição has no Domicílio column, agência assignment is
genuinely Controle-scoped.

**Tech Stack:** Vanilla JS (MV3 extension, MAIN-world content scripts),
`bun:test`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-08-fix-entrevistador-per-domicilio-design.md`.
- Live header column order (confirmed 2026-08-07/08): `Controle`, `Domicilio`, `Entrevistador`, `Tipo Entrevista`, `Última Posição`, `Data`, `Observação` — the new `domicilio` label to match is `'Domicilio'` (unaccented, matching the live header exactly; `normalizeLabel` handles case, `stripHeaderMarker` handles the leading `#!`/`!`).
- `parseDistribuicaoTable`/`mergeDistribuicao`/`DISTRIBUICAO_LABELS` (agenda-map.js lines ~160-191, 214-225) are OUT OF SCOPE — do not touch them, Relatório Distribuição stays per-Controle.
- `controleFromKey` (agenda-map.js:197-199) stays defined — still used by `mergeDistribuicao` — but `mergeUltimoMovimento` no longer calls it.
- `mergeUltimoMovimento`'s non-mutating contract (returns a new Map, never mutates `enderecos`) is unchanged — only its lookup key changes.
- No manifest/permission change; no network code touched.

---

## Task 1: Key `parseUltimoMovimentoTable`/`mergeUltimoMovimento` by Controle+Domicílio

**Files:**
- Modify: `extension/features/agenda-map/agenda-map.js:128,140-158,201-212` (`ULTIMO_MOVIMENTO_LABELS`, `parseUltimoMovimentoTable`, `mergeUltimoMovimento`)
- Modify: `tests/agenda-map.test.js` (update the `parseUltimoMovimentoTable` and `mergeUltimoMovimento` describe blocks)

**Interfaces:**
- Consumes: nothing new.
- Produces: `parseUltimoMovimentoTable(headers, rows)` → `Map<string, {entrevistador: string}> | null`, now keyed by `` `${controle}|${domicilio}` `` instead of bare `controle` (return type/nullability unchanged, only the key shape). `mergeUltimoMovimento(enderecos, umMap)` → unchanged external signature and non-mutating contract, now looks `umMap` up by the full key `k` directly instead of `controleFromKey(k)`.

- [ ] **Step 1: Write the failing regression test for the collision**

Add to `tests/agenda-map.test.js`, inside the existing
`describe('parseUltimoMovimentoTable', ...)` block:

```js
  test('two Domicílios under the same Controle keep their own distinct Entrevistador (regression: used to collapse to one per Controle)', () => {
    const headers = ['Controle', 'Domicilio', 'Entrevistador'];
    const rows = [
      ['292740805180317', '1', 'Fulano de Tal'],
      ['292740805180317', '2', 'Beltrano da Silva'],
    ];
    const map = AM.parseUltimoMovimentoTable(headers, rows);
    expect(map.get('292740805180317|1')).toEqual({ entrevistador: 'Fulano de Tal' });
    expect(map.get('292740805180317|2')).toEqual({ entrevistador: 'Beltrano da Silva' });
    expect(map.size).toBe(2);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/agenda-map.test.js`
Expected: FAIL — the current parser keys by bare `controle`, so
`map.get('292740805180317|1')` is `undefined` and `map.size` is `1`
(the second row overwrote the first).

- [ ] **Step 3: Update all 6 existing `parseUltimoMovimentoTable` tests to the new key shape**

In `tests/agenda-map.test.js`, replace the entire
`describe('parseUltimoMovimentoTable', ...)` block (all tests before
the one you just added in Step 1) with:

```js
describe('parseUltimoMovimentoTable', () => {
  test('maps Controle+Domicílio to {entrevistador} by header label', () => {
    const headers = ['Controle', 'Domicilio', 'Entrevistador', 'Situação'];
    const rows = [
      ['290570120000125', '1', 'Fulano de Tal', 'Entrevistado'],
      ['290570120000999', '3', 'Beltrano da Silva', 'Pendente'],
    ];
    const map = AM.parseUltimoMovimentoTable(headers, rows);
    expect(map.get('290570120000125|1')).toEqual({ entrevistador: 'Fulano de Tal' });
    expect(map.get('290570120000999|3')).toEqual({ entrevistador: 'Beltrano da Silva' });
  });

  test('is tolerant of header order and extra columns', () => {
    const headers = ['Situação', 'Entrevistador', 'Domicilio', 'Controle'];
    const rows = [['Entrevistado', 'Fulano', 'D1', 'C1']];
    const map = AM.parseUltimoMovimentoTable(headers, rows);
    expect(map.get('C1|D1')).toEqual({ entrevistador: 'Fulano' });
  });

  test('returns null when a required header is missing', () => {
    const headers = ['Controle', 'Domicilio', 'Situação'];
    const rows = [['C1', 'D1', 'Entrevistado']];
    expect(AM.parseUltimoMovimentoTable(headers, rows)).toBeNull();
  });

  test('returns null when Domicilio itself is missing (fail-closed, same as Controle/Entrevistador)', () => {
    const headers = ['Controle', 'Entrevistador'];
    const rows = [['C1', 'Fulano']];
    expect(AM.parseUltimoMovimentoTable(headers, rows)).toBeNull();
  });

  test('skips rows with a blank Controle', () => {
    const headers = ['Controle', 'Domicilio', 'Entrevistador'];
    const rows = [['', 'D1', 'Fulano'], ['C1', 'D1', 'Fulano']];
    const map = AM.parseUltimoMovimentoTable(headers, rows);
    expect(map.size).toBe(1);
    expect(map.has('C1|D1')).toBe(true);
  });

  test('tolerates the live #!/! header marker (real live header row, 2026-08-07)', () => {
    const headers = ['#!Controle', '!Domicílio', 'Entrevistador', 'Tipo Entrevista', 'Última Posição', 'Data', 'Observação'];
    const rows = [['292740805220571', '1', 'Fulano de Tal', 'Realizada', 'Descarregado', '07/08/2026 10:27:20', '']];
    const map = AM.parseUltimoMovimentoTable(headers, rows);
    expect(map.get('292740805220571|1')).toEqual({ entrevistador: 'Fulano de Tal' });
  });

  test('still resolves the old unmarked header form (no #!/! prefix)', () => {
    const headers = ['Controle', 'Domicilio', 'Entrevistador'];
    const rows = [['C1', 'D1', 'Fulano']];
    const map = AM.parseUltimoMovimentoTable(headers, rows);
    expect(map.get('C1|D1')).toEqual({ entrevistador: 'Fulano' });
  });

  test('trims whitespace from cell values, including Domicilio', () => {
    const headers = ['Controle', 'Domicilio', 'Entrevistador'];
    const rows = [[' C1 ', ' D1 ', ' Fulano de Tal ']];
    const map = AM.parseUltimoMovimentoTable(headers, rows);
    expect(map.get('C1|D1')).toEqual({ entrevistador: 'Fulano de Tal' });
  });

  test('two Domicílios under the same Controle keep their own distinct Entrevistador (regression: used to collapse to one per Controle)', () => {
    const headers = ['Controle', 'Domicilio', 'Entrevistador'];
    const rows = [
      ['292740805180317', '1', 'Fulano de Tal'],
      ['292740805180317', '2', 'Beltrano da Silva'],
    ];
    const map = AM.parseUltimoMovimentoTable(headers, rows);
    expect(map.get('292740805180317|1')).toEqual({ entrevistador: 'Fulano de Tal' });
    expect(map.get('292740805180317|2')).toEqual({ entrevistador: 'Beltrano da Silva' });
    expect(map.size).toBe(2);
  });
});
```

(This replaces the whole block wholesale — including the test you
added in Step 1, now folded in as the last test — rather than editing
each test individually, since every existing test's fixture needs a
`Domicilio` column and every expectation's key needs the `|D...`
suffix.)

- [ ] **Step 4: Run test to verify it still fails, for the right reason**

Run: `bun test tests/agenda-map.test.js`
Expected: FAIL — all `parseUltimoMovimentoTable` tests now expect
`controle|domicilio` keys and a `Domicilio` header requirement the
current implementation doesn't have yet.

- [ ] **Step 5: Fix `ULTIMO_MOVIMENTO_LABELS` and `parseUltimoMovimentoTable`**

In `extension/features/agenda-map/agenda-map.js`, find:

```js
  // NO Agência column: confirmed against the live table (2026-08-06) —
  // its real headers are Controle/Domicilio/Entrevistador/Tipo de
  // Entrevista/Última Posição/Data/Observação. An earlier version of
  // this parser wrongly required Agência here, which made every
  // required-header check fail and silently zeroed out Entrevistador
  // too (fail-closed, no error, no warning). Agência is now sourced
  // separately from Relatório Distribuição — see
  // parseDistribuicaoTable below.
  const ULTIMO_MOVIMENTO_LABELS = { controle: 'Controle', entrevistador: 'Entrevistador' };
```

Replace with:

```js
  // NO Agência column: confirmed against the live table (2026-08-06) —
  // its real headers are Controle/Domicilio/Entrevistador/Tipo de
  // Entrevista/Última Posição/Data/Observação. An earlier version of
  // this parser wrongly required Agência here, which made every
  // required-header check fail and silently zeroed out Entrevistador
  // too (fail-closed, no error, no warning). Agência is now sourced
  // separately from Relatório Distribuição — see
  // parseDistribuicaoTable below.
  //
  // Domicilio IS required (2026-08-08 fix): this table has one row PER
  // Domicílio under a Controle, each with its own Entrevistador — an
  // earlier version of this parser keyed its map by Controle alone, so
  // every row for the same Controle silently overwrote the previous
  // one and every household but the last in the table lost its real
  // Entrevistador (no error, present-only rendering hid the loss
  // entirely). Keying by controle|domicilio, the same convention
  // agenda-day-guide.js's enderecoKey already uses, fixes this.
  const ULTIMO_MOVIMENTO_LABELS = { controle: 'Controle', domicilio: 'Domicilio', entrevistador: 'Entrevistador' };
```

Then find `parseUltimoMovimentoTable`:

```js
  function parseUltimoMovimentoTable(headers, rows) {
    const P = window.__sigcPro;
    const idx = {};
    for (const key of Object.keys(ULTIMO_MOVIMENTO_LABELS)) {
      const i = headers.findIndex(
        (h) => P.normalizeLabel(stripHeaderMarker(h)) === P.normalizeLabel(ULTIMO_MOVIMENTO_LABELS[key]));
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

Replace with:

```js
  function parseUltimoMovimentoTable(headers, rows) {
    const P = window.__sigcPro;
    const idx = {};
    for (const key of Object.keys(ULTIMO_MOVIMENTO_LABELS)) {
      const i = headers.findIndex(
        (h) => P.normalizeLabel(stripHeaderMarker(h)) === P.normalizeLabel(ULTIMO_MOVIMENTO_LABELS[key]));
      if (i === -1) return null;
      idx[key] = i;
    }
    const map = new Map();
    rows.forEach((cells) => {
      const controle = String(cells[idx.controle] || '').trim();
      if (!controle) return;
      const domicilio = String(cells[idx.domicilio] || '').trim();
      map.set(`${controle}|${domicilio}`, {
        entrevistador: String(cells[idx.entrevistador] || '').trim(),
      });
    });
    return map;
  }
```

(No blank-Domicílio skip: unlike Controle, a blank Domicílio still
produces a usable key — `` `${controle}|` `` — which simply won't match
any real `enderecoKey` downstream and is harmless, matching how the
rest of this codebase treats an unset optional field.)

- [ ] **Step 6: Run test to verify Step 3's tests pass**

Run: `bun test tests/agenda-map.test.js`
Expected: PASS (all `parseUltimoMovimentoTable` tests).

- [ ] **Step 7: Write the failing test for `mergeUltimoMovimento`'s updated lookup**

In `tests/agenda-map.test.js`, replace the existing
`describe('mergeUltimoMovimento', ...)` block with:

```js
describe('mergeUltimoMovimento', () => {
  test('adds entrevistador by matching the full controle|domicilio key, not just controle', () => {
    const enderecos = new Map([
      ['C1|D1', { lat: -12.9, lon: -38.5, zona: 'Centro', idZona: 'Z1' }],
      ['C1|D2', { lat: -12.8, lon: -38.4, zona: 'Centro', idZona: 'Z1' }],
      ['C2|D1', { lat: -13.0, lon: -38.6, zona: 'Norte', idZona: 'Z2' }],
    ]);
    const umMap = new Map([
      ['C1|D1', { entrevistador: 'Fulano' }],
      ['C1|D2', { entrevistador: 'Beltrano' }],
    ]);
    const merged = AM.mergeUltimoMovimento(enderecos, umMap);
    expect(merged.get('C1|D1')).toEqual({ lat: -12.9, lon: -38.5, zona: 'Centro', idZona: 'Z1', entrevistador: 'Fulano' });
    expect(merged.get('C1|D2')).toEqual({ lat: -12.8, lon: -38.4, zona: 'Centro', idZona: 'Z1', entrevistador: 'Beltrano' });
    // C2|D1 has no Último Movimento match: passes through untouched.
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
    AM.mergeUltimoMovimento(enderecos, new Map([['C1|D1', { entrevistador: 'Fulano' }]]));
    expect(original).toEqual({ lat: -12.9, lon: -38.5 });
  });
});
```

- [ ] **Step 8: Run test to verify it fails**

Run: `bun test tests/agenda-map.test.js`
Expected: FAIL — `mergeUltimoMovimento` still calls
`umMap.get(controleFromKey(k))`, so it looks up `'C1'` instead of
`'C1|D1'`/`'C1|D2'` and finds nothing (or, worse under the OLD parser
behavior, whatever collapsed entry survived — but since Step 5 already
fixed the parser, `umMap` in this test is hand-built directly with the
new key shape, so the merge simply fails to find any match at all).

- [ ] **Step 9: Fix `mergeUltimoMovimento`**

Find:

```js
  // New Map: every enderecos entry sharing a Controle present in umMap
  // gets entrevistador added; entries for controles with no
  // Último Movimento match pass through unchanged (never blocks the
  // guide — see buildSlotCard's existing present-only rendering).
  function mergeUltimoMovimento(enderecos, umMap) {
    const merged = new Map();
    enderecos.forEach((v, k) => {
      const um = umMap.get(controleFromKey(k));
      merged.set(k, um ? { ...v, entrevistador: um.entrevistador } : v);
    });
    return merged;
  }
```

Replace with:

```js
  // New Map: every enderecos entry whose full controle|domicilio key
  // matches an entry in umMap gets entrevistador added (2026-08-08 fix:
  // umMap is now keyed the same way enderecos already is — see
  // parseUltimoMovimentoTable — since Último Movimento has one
  // Entrevistador per Domicílio, not one per Controle); entries with no
  // match pass through unchanged (never blocks the guide — see
  // buildSlotCard's existing present-only rendering).
  function mergeUltimoMovimento(enderecos, umMap) {
    const merged = new Map();
    enderecos.forEach((v, k) => {
      const um = umMap.get(k);
      merged.set(k, um ? { ...v, entrevistador: um.entrevistador } : v);
    });
    return merged;
  }
```

(`controleFromKey` stays defined in the file — `mergeDistribuicao`
below still uses it, unchanged, per this task's Global Constraints.)

- [ ] **Step 10: Run test to verify it passes**

Run: `bun test tests/agenda-map.test.js`
Expected: PASS (all `mergeUltimoMovimento` tests).

- [ ] **Step 11: Run the full test suite**

Run: `bun test`
Expected: PASS, all suites green — in particular confirm
`describe('mergeDistribuicao', ...)` and `describe('parseDistribuicaoTable', ...)`
in the same test file are untouched and still passing (they weren't
part of this task's edits), and `tests/ultimo-movimento-url-parity.test.js`
(unrelated to this bug — URL building, not table parsing) is unaffected.

- [ ] **Step 12: Run the privacy gate**

Run: `bash scripts/check-privacy.sh`
Expected: `privacy gate: CLEAN`.

- [ ] **Step 13: Commit**

```bash
git add extension/features/agenda-map/agenda-map.js tests/agenda-map.test.js
git commit -m "fix: key Último Movimento's Entrevistador by Controle+Domicílio, not Controle alone"
```

---

## Manual Verification (post-implementation, live server)

Not automatable — the failure mode was silent (no test caught it before
this fix, no console warning at runtime):

1. Guia do Dia, a day with a Controle scheduling multiple Domicílios —
   confirm each visit card shows its own distinct Entrevistador (not
   every card under one Controle showing the same name).
2. Confirm the console's `[sigc-agenda-map] N controle(s) com
   entrevistador.` log — this count is controle|domicilio entries now,
   not distinct controles, so it may report a higher number than
   before for a day with multi-Domicílio Controles; that's expected and
   correct, not a regression.
