# Lista de Endereços × Agenda + Último Movimento Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Annotate the Lista de Endereços (selecionados view) with each household's scheduled interview date and collection status, plus a per-Controle count of bookable slots per zona.

**Architecture:** One new feature module in three seams — *acquire* (two independent same-origin fetches), *index* (pure functions producing lookup Maps), *render* (three appended DataTable columns + a header line). The two fetches run independently so either can fail without costing the other's output. All pure functions are unit-tested; the fetches are not, matching `agenda-map`'s existing posture.

**Tech Stack:** Vanilla JS (IIFE modules, no build step), `bun test` + happy-dom, Chrome MV3 content scripts.

**Spec:** `docs/superpowers/specs/2026-07-31-lista-agenda-design.md`

## Global Constraints

- **No `node`.** Syntax-check with `bun build --no-bundle <file>`; run tests with `bun test`.
- **Privacy gate must pass** on every commit: `bash scripts/check-privacy.sh`. It runs as a pre-commit hook and will block a commit that violates it.
- **Never push.** Commit only; the user pushes.
- **Conventional commits**, subject under 72 chars, English.
- **Discard non-essential response fields at the parse boundary.** From agenda slots keep only Controle, Domicílio, Zonas, start. Never hold name, sex, birth date, address or telephone in memory.
- **Append DataTable columns only** — never insert. Indexes 0–19 must stay intact (`tableMatchesLayout` validates by index; PDF/KML read fixed indexes).
- **In-memory caches only.** Never `chrome.storage`, never persisted — the zero-storage guarantee.
- **No fetch on page load.** Click + confirm, always.
- Comments explain *why*, not *what*, matching surrounding style. Portuguese for user-facing strings, English for code comments.

---

## File Structure

| File | Responsibility |
|---|---|
| `extension/features/lista-agenda/lista-agenda.js` (create) | The whole feature: acquire, index, render, mount. Single IIFE, exports pure functions on `window.__sigcPro.listaAgenda` for tests. |
| `tests/lista-agenda.test.js` (create) | Unit tests for every pure function. |
| `extension/common/sigc-common.js` (modify) | Export `parseAgendaSlotTitle`, currently internal (Task 0). |
| `tests/sigc-common-helpers.test.js` (modify) | Cover that export. |
| `scripts/check-privacy.sh` (modify) | Add the new dir to `FETCH_DIRS` + header comment. |
| `extension/manifest.json` (modify) | Register the module. |
| `tests/manifest-load-order.test.js` (modify) | Assert the new script is listed. |
| `docs/store-listing.md`, `docs/PRIVACY_POLICY.html`, `ROADMAP.md` (modify) | User-facing disclosure of the new fetch. |

---

### Task 0: Export `parseAgendaSlotTitle` from sigc-common

**Files:**
- Modify: `extension/common/sigc-common.js` (the exports object, ~line 665)
- Test: `tests/sigc-common-helpers.test.js`

`parseAgendaSlotTitle` is currently **internal** to `sigc-common.js` — used
by `readAgendaSlots` but absent from the `window.__sigcPro` exports object.
Every later task calls it from a separate module, so without this they fail
at runtime with "not a function". (`parseZonaEntries` and `MISSING_VALUES`
are already exported; only this one is missing.)

- [ ] **Step 1: Write the failing test**

Append to `tests/sigc-common-helpers.test.js`:

```javascript
describe('parseAgendaSlotTitle', () => {
  test('is exported for other modules to reuse', () => {
    expect(typeof window.__sigcPro.parseAgendaSlotTitle).toBe('function');
  });

  // Splits on the FIRST colon only: Endereço values contain more.
  test('splits each line on the first colon', () => {
    const f = window.__sigcPro.parseAgendaSlotTitle(
      'Controle: 292740805060337\nEndereço: RUA X, Nº: 237: - Compl: APTO');
    expect(f['Controle']).toBe('292740805060337');
    expect(f['Endereço']).toBe('RUA X, Nº: 237: - Compl: APTO');
  });

  // SIGC renders an empty field as a literal " - ", which MISSING_VALUES
  // collapses, so the key is absent rather than present-and-blank.
  test('omits empty fields rather than storing blanks', () => {
    const f = window.__sigcPro.parseAgendaSlotTitle('Nome:  - \nTelefone: ');
    expect(f['Nome']).toBeUndefined();
    expect(f['Telefone']).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/sigc-common-helpers.test.js`
Expected: FAIL — `expect(typeof …).toBe('function')` receives `"undefined"`.

- [ ] **Step 3: Add it to the exports object**

In `extension/common/sigc-common.js`, in the `window.__sigcPro = { … }`
object, add `parseAgendaSlotTitle,` immediately after `parseZonaEntries,`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test`
Expected: all PASS (the whole suite — this file is shared).

- [ ] **Step 5: Commit**

```bash
git add extension/common/sigc-common.js tests/sigc-common-helpers.test.js
git commit -m "refactor: export parseAgendaSlotTitle for reuse"
```

---

### Task 1: Pure indexing functions (no network, no DOM)

**Files:**
- Create: `extension/features/lista-agenda/lista-agenda.js`
- Test: `tests/lista-agenda.test.js`

**Interfaces:**
- Consumes: `window.__sigcPro.parseAgendaSlotTitle` (exported by Task 0 — this task fails at runtime without it), `parseZonaEntries`, `agendaMinScheduleDate`, `dateToIso`, `isoToBr` (all from `sigc-common.js`).
- Produces: `window.__sigcPro.listaAgenda = { parseSlots, zonaIdOf, indexByControle, indexZonaLivres, pickAgendado }`.
  - `parseSlots(json)` → `[{ isoDate, start, controle, domicilio, zonas, aberto }]`
  - `zonaIdOf(entry)` → `string` (leading ID of `"29JDM8 - 29.2.01.02 29_Linus_Lauro"`)
  - `indexByControle(slots)` → `Map<"controle|domicilio", [slot]>`
  - `indexZonaLivres(slots, minDateIso)` → `Map<zonaId, { inteiro, peso, compartilhado }>`
  - `pickAgendado(slots, todayIso)` → `{ data, futura } | null`

- [ ] **Step 1: Write the failing tests**

Create `tests/lista-agenda.test.js`:

```javascript
import { describe, test, expect } from 'bun:test';

// Order matters: sigc-common.js assigns window.__sigcPro wholesale.
await import('../extension/common/sigc-common.js');
await import('../extension/features/lista-agenda/lista-agenda.js');

const {
  parseSlots, zonaIdOf, indexByControle, indexZonaLivres, pickAgendado,
} = window.__sigcPro.listaAgenda;

// A reserved slot's title carries every field; an open slot's title is
// ONLY "Zonas: …" — confirmed live in
// docs/superpowers/specs/2026-07-16-agenda-csv-export-design.md (addendum).
const tituloReservado = [
  'Zonas: 29JDM8 - 29.2.01.02 29_Linus_Lauro',
  'Controle: 292740805060337',
  'Domicílio: 1',
  'Nome:  - ',
  'Endereço: RUA X, Nº: 237: - Compl: APTO 303  - SALVADOR',
  'Telefone: 71 99999-0000',
].join('\n');

const tituloAberto = 'Zonas: 29JDM8 - 29.2.01.02 29_Linus_Lauro, 29LR9E - 29.2.01.01 29_Linus_Lauro';

const slotJson = (over = {}) => ({
  id: 'x', end: '2026-08-10T10:00:00', resourceId: 'r1',
  status: 1, backgroundColor: '#fff',
  start: '2026-08-10T09:00:00', title: tituloReservado, ...over,
});

describe('parseSlots', () => {
  test('keeps only the sanctioned fields', () => {
    const [s] = parseSlots([slotJson()]);
    expect(Object.keys(s).sort()).toEqual(
      ['aberto', 'controle', 'domicilio', 'isoDate', 'start', 'zonas'].sort());
  });

  // The response carries name, address and telephone per slot. Dropping
  // them at the parse boundary is a privacy requirement, not tidiness.
  test('discards personal data', () => {
    const json = JSON.stringify(parseSlots([slotJson()]));
    expect(json).not.toContain('RUA X');
    expect(json).not.toContain('71 99999-0000');
  });

  test('an open slot has no controle and is flagged aberto', () => {
    const [s] = parseSlots([slotJson({ title: tituloAberto })]);
    expect(s.aberto).toBe(true);
    expect(s.controle).toBe('');
  });

  test('a reserved slot is not aberto', () => {
    expect(parseSlots([slotJson()])[0].aberto).toBe(false);
  });

  test('derives isoDate from start', () => {
    expect(parseSlots([slotJson()])[0].isoDate).toBe('2026-08-10');
  });

  test('tolerates an empty or malformed response', () => {
    expect(parseSlots([])).toEqual([]);
    expect(parseSlots(null)).toEqual([]);
  });
});

describe('zonaIdOf', () => {
  test('takes the ID before the first " - "', () => {
    expect(zonaIdOf('29JDM8 - 29.2.01.02 29_Linus_Lauro')).toBe('29JDM8');
  });

  test('falls back to the whole entry with no separator', () => {
    expect(zonaIdOf('29.3.03.03 29_Linus_Pituba')).toBe('29.3.03.03 29_Linus_Pituba');
  });

  test('tolerates empty and missing input', () => {
    expect(zonaIdOf('')).toBe('');
    expect(zonaIdOf(null)).toBe('');
  });
});

describe('indexByControle', () => {
  test('keys on controle|domicilio', () => {
    const idx = indexByControle(parseSlots([slotJson()]));
    expect(idx.get('292740805060337|1')).toHaveLength(1);
  });

  test('groups repeat schedules under one key', () => {
    const idx = indexByControle(parseSlots([
      slotJson(), slotJson({ start: '2026-09-01T09:00:00' }),
    ]));
    expect(idx.get('292740805060337|1')).toHaveLength(2);
  });

  test('skips open slots, which belong to no household', () => {
    const idx = indexByControle(parseSlots([slotJson({ title: tituloAberto })]));
    expect(idx.size).toBe(0);
  });
});

describe('indexZonaLivres', () => {
  const abertoEm = (isoDate, zonas) => slotJson({
    start: `${isoDate}T09:00:00`, title: `Zonas: ${zonas}`,
  });

  test('counts open slots on or after the cutoff', () => {
    const idx = indexZonaLivres(
      parseSlots([abertoEm('2026-08-10', '29JDM8 - 29.2.01.02 29_Linus_Lauro')]),
      '2026-08-01');
    expect(idx.get('29JDM8').inteiro).toBe(1);
  });

  test('excludes open slots before the cutoff', () => {
    const idx = indexZonaLivres(
      parseSlots([abertoEm('2026-07-20', '29JDM8 - 29.2.01.02 29_Linus_Lauro')]),
      '2026-08-01');
    expect(idx.size).toBe(0);
  });

  test('the cutoff date itself counts', () => {
    const idx = indexZonaLivres(
      parseSlots([abertoEm('2026-08-01', '29JDM8 - 29.2.01.02 29_Linus_Lauro')]),
      '2026-08-01');
    expect(idx.get('29JDM8').inteiro).toBe(1);
  });

  test('excludes reserved slots however future', () => {
    const idx = indexZonaLivres(parseSlots([slotJson()]), '2026-01-01');
    expect(idx.size).toBe(0);
  });

  // A shared slot counts whole in each zona (how many slots could I book
  // into?) and 1/n in the weighted figure (how many are really mine?).
  test('a shared slot counts whole in each zona and 1/n weighted', () => {
    const idx = indexZonaLivres(parseSlots([
      abertoEm('2026-08-10',
        '29JDM8 - 29.2.01.02 29_Linus_Lauro, 29LR9E - 29.2.01.01 29_Linus_Lauro'),
    ]), '2026-08-01');
    expect(idx.get('29JDM8').inteiro).toBe(1);
    expect(idx.get('29JDM8').peso).toBeCloseTo(0.5, 9);
    expect(idx.get('29JDM8').compartilhado).toBe(true);
  });

  test('an exclusive slot is not flagged compartilhado', () => {
    const idx = indexZonaLivres(
      parseSlots([abertoEm('2026-08-10', '29JDM8 - 29.2.01.02 29_Linus_Lauro')]),
      '2026-08-01');
    expect(idx.get('29JDM8').compartilhado).toBe(false);
  });

  test('a zona repeated in one slot is not double counted', () => {
    const idx = indexZonaLivres(parseSlots([
      abertoEm('2026-08-10',
        '29JDM8 - 29.2.01.02 29_Linus_Lauro, 29JDM8 - 29.2.01.02 29_Linus_Lauro'),
    ]), '2026-08-01');
    expect(idx.get('29JDM8').inteiro).toBe(1);
    expect(idx.get('29JDM8').peso).toBeCloseTo(1, 9);
  });
});

describe('pickAgendado', () => {
  const em = (isoDate) => parseSlots([slotJson({ start: `${isoDate}T09:00:00` })])[0];

  // Only one schedule is live at a time, so a future date wins outright.
  test('prefers the live (future) date', () => {
    const r = pickAgendado([em('2026-06-01'), em('2026-09-01')], '2026-07-31');
    expect(r).toEqual({ data: '01/09/2026', futura: true });
  });

  test('falls back to the most recent past date', () => {
    const r = pickAgendado([em('2026-05-01'), em('2026-06-01')], '2026-07-31');
    expect(r).toEqual({ data: '01/06/2026', futura: false });
  });

  test('today counts as live', () => {
    expect(pickAgendado([em('2026-07-31')], '2026-07-31').futura).toBe(true);
  });

  test('returns null with no slots', () => {
    expect(pickAgendado([], '2026-07-31')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/lista-agenda.test.js`
Expected: FAIL — cannot find `../extension/features/lista-agenda/lista-agenda.js`.

- [ ] **Step 3: Write the implementation**

Create `extension/features/lista-agenda/lista-agenda.js`:

```javascript
// SIGC-PRO feature: annotates the Lista de Endereços (selecionados view)
// with data the page itself does not carry — each household's scheduled
// interview and collection status, plus how many slots remain bookable
// in its zonas.
//
// Two sources, both same-origin and behind one click+confirm:
//   Agenda          GET  AdministracaoAgenda/ObterSlots  (JSON)
//   Último Movimento POST /relatorio/filtrar             (HTML fragment)
// Both key on (Controle, Domicílio), the table's own key.
//
// Three seams — acquire / index / render — so the fetches stay
// independent (either may fail without costing the other's columns) and
// every decision worth testing lives in a pure function.
//
// Spec: docs/superpowers/specs/2026-07-31-lista-agenda-design.md
(function () {
  'use strict';

  // --- index (pure) ---------------------------------------------------

  // The agenda response carries name, sex, birth date, address and
  // telephone per slot. Keep ONLY what the annotations need, so no richer
  // object is ever held in memory or reachable from a later change.
  function parseSlots(json) {
    if (!Array.isArray(json)) return [];
    return json.map((s) => {
      const f = window.__sigcPro.parseAgendaSlotTitle(s && s.title);
      const start = String((s && s.start) || '');
      return {
        start,
        isoDate: start.slice(0, 10),
        controle: f['Controle'] || '',
        domicilio: f['Domicílio'] || '',
        zonas: f['Zonas'] || '',
        // An open slot's title is only "Zonas: …" — no Controle line,
        // since nothing is assigned yet. The JSON has no CSS class to
        // read, so this IS the open test.
        aberto: !f['Controle'],
      };
    });
  }

  // "29JDM8 - 29.2.01.02 29_Linus_Lauro" -> "29JDM8", the same ID Zona
  // the table carries in column 18. Entries without the separator key on
  // themselves rather than being dropped.
  function zonaIdOf(entry) {
    const s = String(entry ?? '').trim();
    const i = s.indexOf(' - ');
    return i === -1 ? s : s.slice(0, i).trim();
  }

  const chaveDomicilio = (controle, domicilio) => `${controle}|${domicilio}`;

  function indexByControle(slots) {
    const map = new Map();
    slots.forEach((s) => {
      if (s.aberto || !s.controle) return;
      const k = chaveDomicilio(s.controle, s.domicilio);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(s);
    });
    return map;
  }

  // Free = open AND on/after the prazo mínimo. A slot before the cutoff
  // cannot be filled anymore, so counting it would advertise capacity
  // that does not exist.
  function indexZonaLivres(slots, minDateIso) {
    const map = new Map();
    slots.forEach((s) => {
      if (!s.aberto) return;
      if (s.isoDate && s.isoDate < minDateIso) return;
      const ids = new Set(
        window.__sigcPro.parseZonaEntries(s.zonas).map(zonaIdOf).filter(Boolean));
      if (ids.size === 0) return;
      const peso = 1 / ids.size;
      ids.forEach((id) => {
        if (!map.has(id)) map.set(id, { inteiro: 0, peso: 0, compartilhado: false });
        const cell = map.get(id);
        cell.inteiro += 1;
        cell.peso += peso;
        if (ids.size > 1) cell.compartilhado = true;
      });
    });
    return map;
  }

  // Only one schedule is live at a time, so a future date wins outright;
  // otherwise show the most recent past one, flagged so a completed
  // interview does not read as an upcoming appointment.
  function pickAgendado(slots, todayIso) {
    if (!slots || slots.length === 0) return null;
    const ordenado = [...slots].sort((a, b) => a.isoDate.localeCompare(b.isoDate));
    const futura = ordenado.find((s) => s.isoDate >= todayIso);
    const escolhido = futura || ordenado[ordenado.length - 1];
    return {
      data: window.__sigcPro.isoToBr(escolhido.isoDate),
      futura: !!futura,
    };
  }

  window.__sigcPro.listaAgenda = {
    parseSlots, zonaIdOf, indexByControle, indexZonaLivres, pickAgendado,
  };
})();
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/lista-agenda.test.js`
Expected: PASS, 24 tests.

- [ ] **Step 5: Syntax-check and commit**

```bash
bun build --no-bundle extension/features/lista-agenda/lista-agenda.js > /dev/null
git add extension/features/lista-agenda/lista-agenda.js tests/lista-agenda.test.js
git commit -m "feat: add Lista de Endereços agenda indexing functions"
```

---

### Task 2: Último Movimento indexing

**Files:**
- Modify: `extension/features/lista-agenda/lista-agenda.js`
- Test: `tests/lista-agenda.test.js`

**Interfaces:**
- Consumes: Task 1's module.
- Produces: adds `indexMovimento` to `window.__sigcPro.listaAgenda`.
  - `indexMovimento(header, rows)` → `Map<"controle|domicilio", { situacao, transmissao }>`

- [ ] **Step 1: Write the failing tests**

Append to `tests/lista-agenda.test.js`:

```javascript
const { indexMovimento } = window.__sigcPro.listaAgenda;

describe('indexMovimento', () => {
  // Column positions are found by header label, never hardcoded: the
  // Último Movimento report is a different table from the Lista de
  // Endereços and its layout is not pinned by any test we own.
  const header = ['Controle', 'Domicílio', 'Última Posição', 'Data Transmissão'];
  const rows = [
    ['292740805060337', '1', 'TRANSMITIDO', '28/07/2026'],
    ['292740805060337', '2', 'EM COLETA', ''],
  ];

  test('keys on controle|domicilio', () => {
    const idx = indexMovimento(header, rows);
    expect(idx.get('292740805060337|1'))
      .toEqual({ situacao: 'TRANSMITIDO', transmissao: '28/07/2026' });
  });

  test('keeps an empty transmission date as empty', () => {
    expect(indexMovimento(header, rows).get('292740805060337|2').transmissao).toBe('');
  });

  test('tolerates accent and case differences in headers', () => {
    const alt = ['CONTROLE', 'DOMICILIO', 'ULTIMA POSICAO', 'DATA TRANSMISSAO'];
    expect(indexMovimento(alt, rows).get('292740805060337|1').situacao).toBe('TRANSMITIDO');
  });

  test('returns an empty index when a required column is missing', () => {
    expect(indexMovimento(['Controle', 'Domicílio'], rows).size).toBe(0);
  });

  test('tolerates empty input', () => {
    expect(indexMovimento(header, []).size).toBe(0);
    expect(indexMovimento(null, null).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/lista-agenda.test.js`
Expected: FAIL — `indexMovimento is not a function`.

- [ ] **Step 3: Write the implementation**

In `lista-agenda.js`, add before the `window.__sigcPro.listaAgenda` assignment:

```javascript
  // Header labels vary in accent/case between SIGC screens, so match
  // normalized rather than exact.
  function normalizar(s) {
    return String(s ?? '').trim().toUpperCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  function acharColuna(header, alvo) {
    const want = normalizar(alvo);
    return (header || []).findIndex((h) => normalizar(h) === want);
  }

  // The Último Movimento report is a different table from the Lista de
  // Endereços, and no test in this repo pins its layout — so find columns
  // by label and return an empty index if any is missing, rather than
  // reading whatever happens to sit at a guessed position.
  function indexMovimento(header, rows) {
    const map = new Map();
    const iControle = acharColuna(header, 'Controle');
    const iDomicilio = acharColuna(header, 'Domicílio');
    const iPosicao = acharColuna(header, 'Última Posição');
    const iTransmissao = acharColuna(header, 'Data Transmissão');
    if (iControle === -1 || iDomicilio === -1 || iPosicao === -1 || iTransmissao === -1) {
      console.warn(`${TAG} Último Movimento: colunas esperadas não encontradas`,
        JSON.stringify(header));
      return map;
    }
    (rows || []).forEach((r) => {
      const controle = String(r[iControle] ?? '').trim();
      const domicilio = String(r[iDomicilio] ?? '').trim();
      if (!controle) return;
      map.set(chaveDomicilio(controle, domicilio), {
        situacao: String(r[iPosicao] ?? '').trim(),
        transmissao: String(r[iTransmissao] ?? '').trim(),
      });
    });
    return map;
  }
```

Add at the top of the IIFE, after `'use strict';`:

```javascript
  const TAG = '[sigc-lista-agenda]';
```

Add `indexMovimento` to the exports object.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/lista-agenda.test.js`
Expected: PASS, 29 tests.

- [ ] **Step 5: Commit**

```bash
bun build --no-bundle extension/features/lista-agenda/lista-agenda.js > /dev/null
git add extension/features/lista-agenda/lista-agenda.js tests/lista-agenda.test.js
git commit -m "feat: index Último Movimento rows by controle and domicílio"
```

---

### Task 3: Header-line rendering (pure)

**Files:**
- Modify: `extension/features/lista-agenda/lista-agenda.js`
- Test: `tests/lista-agenda.test.js`

**Interfaces:**
- Consumes: Task 1's `indexZonaLivres` output.
- Produces: adds `buildResumoHtml` to `window.__sigcPro.listaAgenda`.
  - `buildResumoHtml(zonaIdsDaTabela, livresIdx, { minDateBr, agendaEm, movimentoEm, falhas })` → `string`

- [ ] **Step 1: Write the failing tests**

Append to `tests/lista-agenda.test.js`:

```javascript
const { buildResumoHtml } = window.__sigcPro.listaAgenda;

describe('buildResumoHtml', () => {
  const livres = new Map([
    ['29JDM8', { inteiro: 12, peso: 3, compartilhado: true }],
    ['29LR9E', { inteiro: 4, peso: 4, compartilhado: false }],
    ['29TBAN', { inteiro: 0, peso: 0, compartilhado: false }],
  ]);
  const meta = { minDateBr: '03/08/2026', agendaEm: '09:31', movimentoEm: '09:31', falhas: [] };

  test('names the cutoff and the fetch time', () => {
    const html = buildResumoHtml(['29JDM8'], livres, meta);
    expect(html).toContain('03/08/2026');
    expect(html).toContain('09:31');
  });

  // The weighted figure says something only where slots are shared;
  // elsewhere it would just repeat the whole count.
  test('shows the weighted figure only where shared', () => {
    const html = buildResumoHtml(['29JDM8', '29LR9E'], livres, meta);
    expect(html).toContain('12');
    expect(html).toContain('3,0 ponderado');
    expect(html).toContain('4');
    expect(html.match(/ponderado/g)).toHaveLength(1);
  });

  test('lists only the zonas present in the table', () => {
    const html = buildResumoHtml(['29JDM8'], livres, meta);
    expect(html).toContain('29JDM8');
    expect(html).not.toContain('29LR9E');
  });

  test('shows zero for a zona of the table with no free slots', () => {
    const html = buildResumoHtml(['29TBAN'], livres, meta);
    expect(html).toContain('29TBAN');
    expect(html).toContain('0');
  });

  test('shows zero for a zona absent from the index entirely', () => {
    const html = buildResumoHtml(['29XXXX'], livres, meta);
    expect(html).toContain('29XXXX');
    expect(html).toContain('0');
  });

  // An all-"—" column must never be mistaken for "nothing scheduled".
  test('names a failed source', () => {
    const html = buildResumoHtml(['29JDM8'], livres,
      { ...meta, falhas: ['Último Movimento: HTTP 500'] });
    expect(html).toContain('Último Movimento: HTTP 500');
  });

  test('shows two fetch times when they differ', () => {
    const html = buildResumoHtml(['29JDM8'], livres,
      { ...meta, agendaEm: '09:31', movimentoEm: '09:47' });
    expect(html).toContain('09:31');
    expect(html).toContain('09:47');
  });

  test('escapes zona ids', () => {
    const html = buildResumoHtml(['<script>alert(1)</script>'], new Map(), meta);
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/lista-agenda.test.js`
Expected: FAIL — `buildResumoHtml is not a function`.

- [ ] **Step 3: Write the implementation**

Add to `lista-agenda.js` before the exports:

```javascript
  // One decimal, pt-BR comma — same shape the day guide uses.
  const num1 = (n) => n.toFixed(1).replace('.', ',');

  // Free slots for the zonas THIS table's households belong to, not the
  // whole UF: the question is "where can I still book these people?".
  // Fetch times are shown because a stale count causes a real
  // double-booking; two are shown when the sources aged differently,
  // since one timestamp would misreport the older.
  function buildResumoHtml(zonaIdsDaTabela, livresIdx, meta) {
    const e = window.__sigcPro.escapeHtml;
    const ids = [...new Set((zonaIdsDaTabela || []).filter(Boolean))].sort();
    const celulas = ids.map((id) => {
      const c = (livresIdx && livresIdx.get(id)) || { inteiro: 0, peso: 0, compartilhado: false };
      const pond = c.compartilhado ? ` (${num1(c.peso)} ponderado)` : '';
      return `<span class="sp-zona-livre"><strong>${e(id)}</strong>: ${c.inteiro}${pond}</span>`;
    }).join(' ');

    const quando = meta.agendaEm === meta.movimentoEm
      ? `dados de ${e(meta.agendaEm)}`
      : `agenda de ${e(meta.agendaEm)}, movimento de ${e(meta.movimentoEm)}`;

    const falhas = (meta.falhas || []).length
      ? `<div class="sp-falha">Sem dados de ${(meta.falhas || []).map(e).join('; ')}. ` +
        'As colunas correspondentes ficam vazias.</div>'
      : '';

    return [
      '<div id="sigc-pro-lista-agenda-resumo">',
      `<div class="sp-titulo">Slots livres (a partir de ${e(meta.minDateBr)}) · ${quando}</div>`,
      `<div class="sp-zonas">${celulas || '<em>Nenhuma zona nesta tabela.</em>'}</div>`,
      falhas,
      '</div>',
    ].join('\n');
  }
```

Add `buildResumoHtml` to the exports object.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/lista-agenda.test.js`
Expected: PASS, 37 tests.

- [ ] **Step 5: Commit**

```bash
bun build --no-bundle extension/features/lista-agenda/lista-agenda.js > /dev/null
git add extension/features/lista-agenda/lista-agenda.js tests/lista-agenda.test.js
git commit -m "feat: render the free-slots-per-zona header line"
```

---

### Task 4: Row annotation (pure)

**Files:**
- Modify: `extension/features/lista-agenda/lista-agenda.js`
- Test: `tests/lista-agenda.test.js`

**Interfaces:**
- Consumes: Tasks 1–2 indexes.
- Produces: adds `annotateRow` to `window.__sigcPro.listaAgenda`.
  - `annotateRow(controle, domicilio, { agendaIdx, movimentoIdx, todayIso })` → `{ agendado, futura, situacao, transmissao }` (strings; `''` where absent)

- [ ] **Step 1: Write the failing tests**

Append to `tests/lista-agenda.test.js`:

```javascript
const { annotateRow } = window.__sigcPro.listaAgenda;

describe('annotateRow', () => {
  const agendaIdx = indexByControle(parseSlots([slotJson({ start: '2026-09-01T09:00:00' })]));
  const movimentoIdx = new Map([
    ['292740805060337|1', { situacao: 'TRANSMITIDO', transmissao: '28/07/2026' }],
  ]);
  const ctx = { agendaIdx, movimentoIdx, todayIso: '2026-07-31' };

  test('combines both sources onto one row', () => {
    expect(annotateRow('292740805060337', '1', ctx)).toEqual({
      agendado: '01/09/2026', futura: true,
      situacao: 'TRANSMITIDO', transmissao: '28/07/2026',
    });
  });

  // A failed source must not cost the other's columns.
  test('annotates from the agenda alone when movimento is empty', () => {
    const r = annotateRow('292740805060337', '1',
      { ...ctx, movimentoIdx: new Map() });
    expect(r.agendado).toBe('01/09/2026');
    expect(r.situacao).toBe('');
  });

  test('annotates from movimento alone when the agenda is empty', () => {
    const r = annotateRow('292740805060337', '1', { ...ctx, agendaIdx: new Map() });
    expect(r.agendado).toBe('');
    expect(r.situacao).toBe('TRANSMITIDO');
  });

  test('an unmatched household yields empty strings, never undefined', () => {
    expect(annotateRow('999', '9', ctx)).toEqual({
      agendado: '', futura: false, situacao: '', transmissao: '',
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/lista-agenda.test.js`
Expected: FAIL — `annotateRow is not a function`.

- [ ] **Step 3: Write the implementation**

Add to `lista-agenda.js` before the exports:

```javascript
  // Returns an OBJECT, not a bare string, so a further source adds a key
  // rather than changing every caller's signature. Empty strings (never
  // undefined) so the render step can write cells without guarding.
  function annotateRow(controle, domicilio, ctx) {
    const k = chaveDomicilio(String(controle ?? '').trim(), String(domicilio ?? '').trim());
    const ag = pickAgendado((ctx.agendaIdx && ctx.agendaIdx.get(k)) || [], ctx.todayIso);
    const mv = (ctx.movimentoIdx && ctx.movimentoIdx.get(k)) || null;
    return {
      agendado: ag ? ag.data : '',
      futura: ag ? ag.futura : false,
      situacao: mv ? mv.situacao : '',
      transmissao: mv ? mv.transmissao : '',
    };
  }
```

Add `annotateRow` to the exports object.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/lista-agenda.test.js`
Expected: PASS, 41 tests.

- [ ] **Step 5: Commit**

```bash
bun build --no-bundle extension/features/lista-agenda/lista-agenda.js > /dev/null
git add extension/features/lista-agenda/lista-agenda.js tests/lista-agenda.test.js
git commit -m "feat: combine agenda and movimento data per household row"
```

---

### Task 5: Privacy gate — sanction the new fetch directory

**Files:**
- Modify: `scripts/check-privacy.sh:10-15` (header comment), `:26` (`FETCH_DIRS`)

This is its own task and its own commit **because it is a privacy decision, not a build step**, and it reverses a documented one: `2026-07-16-agenda-csv-export-design.md` considered calling `ObterSlots` and declined. Landing it alone keeps the reversal reviewable.

- [ ] **Step 1: Verify the gate currently blocks the new module**

Add a temporary `fetch('/x')` line inside `lista-agenda.js`, then run:

```bash
bash scripts/check-privacy.sh; echo "exit=$?"
```

Expected: FAILS (non-zero), naming `lista-agenda.js`. This proves the tripwire works before it is widened. Remove the temporary line afterwards.

- [ ] **Step 2: Widen the allowlist**

In `scripts/check-privacy.sh`, extend the header comment (after the `ultimo-movimento-export` entry at line 13-15):

```bash
#   - extension/features/lista-agenda/     : fetch() only, same-origin
#     (agenda slots + último movimento for the Lista de Endereços;
#     click+confirm, see
#     docs/superpowers/specs/2026-07-31-lista-agenda-design.md)
```

And line 26:

```bash
FETCH_DIRS='extension/features/agenda-map extension/features/ultimo-movimento-export extension/features/lista-agenda'
```

- [ ] **Step 3: Verify the gate passes and still guards elsewhere**

```bash
bash scripts/check-privacy.sh; echo "exit=$?"
```
Expected: `privacy gate: CLEAN`, exit 0.

Then confirm the tripwire still fires outside the sanctioned dirs — temporarily add `fetch('/x')` to `extension/features/csv-export/csv-export.js`, re-run, expect FAILURE, then remove it.

- [ ] **Step 4: Commit**

```bash
git add scripts/check-privacy.sh
git commit -m "chore: sanction same-origin fetch in lista-agenda"
```

Use this commit body (it is the argument, not a description):

```
The Lista de Endereços has no rendered calendar, so the DOM-reading
approach 2026-07-16-agenda-csv-export-design.md chose instead of calling
ObterSlots is unavailable here — the choice is fetch or drop the feature.

That spec's objection was to fetching at all; the extension now fetches
in two shipped features, behind click+confirm, disclosed in the privacy
policy. What is genuinely new is breadth: ObterSlots returns a UF-wide
year where every prior fetch was Controle-scoped, which is why the
response is narrowed to Controle/Domicílio/Zonas/start at the parse
boundary and never held whole.
```

---

### Task 6: The two fetches

**Files:**
- Modify: `extension/features/lista-agenda/lista-agenda.js`

**Interfaces:**
- Consumes: `window.__sigcPro.getAgendaUf` is NOT available here (no Agenda page); read the UF from the pesquisa/table context instead — see step 1.
- Produces: `fetchAgenda(uf, startIso, endIso)` → `Promise<slots[]>`, `fetchMovimento(uf, controle)` → `Promise<{header, rows}|null>`. Neither is exported for tests (untested by design, as `agenda-map`'s fetch is).

- [ ] **Step 1: Add the gateway helpers and both fetches**

These duplicate `ultimo-movimento-export.js`'s `f5Prefix`/`gatewayUrl`/`fetchViaGateway` verbatim. **Do not extract them into `sigc-common.js` in this task** — moving `fetch`-adjacent code across the privacy gate's module boundaries deserves its own commit, and `sigc-common.js` is not a sanctioned fetch directory.

Add to `lista-agenda.js`, after the pure functions:

```javascript
  // --- acquire --------------------------------------------------------
  // F5 BIG-IP rewrites every path to "/f5-w-<hex>$$/<path>" off-VPN.
  // Duplicated from ultimo-movimento-export.js rather than shared: moving
  // fetch-adjacent code into sigc-common.js would put it outside the
  // privacy gate's sanctioned directories.
  function f5Prefix(pathname) {
    const m = /^\/f5-w-([0-9a-f]+)\$\$/.exec(String(pathname || ''));
    return m ? { prefix: m[0], hex: m[1] } : null;
  }

  function gatewayUrl(origin, pathname, path, simple) {
    const f5 = f5Prefix(pathname);
    if (!f5) return `${origin}${path}`;
    return simple
      ? `${origin}${f5.prefix}${path}`
      : `${origin}${f5.prefix}/f5-h-$$${path};F5_origin=${f5.hex}&F5CH=I`;
  }

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

  // Query built by hand: percent-encoding the "$$" in the F5 path turns
  // the URL into a 404 (learned in pns.zonas/R/sigc_agendamentos.R).
  async function fetchAgenda(uf, startIso, endIso) {
    const query = `idUf=${encodeURIComponent(uf)}` +
      `&start=${encodeURIComponent(startIso)}` +
      `&end=${encodeURIComponent(endIso)}` +
      '&semana=true&idEquipe=';
    const res = await fetchViaGateway(`/AdministracaoAgenda/ObterSlots?${query}`, {
      credentials: 'same-origin',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        Referer: `${location.origin}/AdministracaoAgenda`,
      },
    });
    return parseSlots(await res.json());
  }

  // One request for the whole Controle: buildAgenciaFilterBody's payload
  // with Controle set to the real value instead of "*" returns every
  // domicílio at once. NOT the multi-agência loop.
  async function fetchMovimento(uf, controle) {
    const filtro = {
      IdFiltro: '',
      IdUf: String(uf),
      IdAgencia: '*',
      IdMunicipio: '*',
      Controle: String(controle),
      IdEntrevistadores: '*',
      IdTipoAcompanhamento: '*',
    };
    const res = await fetchViaGateway('/relatorio/filtrar?slug=UltimoMovimento', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: 'filtro=' + encodeURIComponent(JSON.stringify(filtro)),
    });
    return parseMovimentoHtml(await res.text());
  }

  // DOMParser is inert — nothing in the fetched markup can load resources
  // or run handlers. Same guarantee ultimo-movimento-export relies on.
  function parseMovimentoHtml(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const table = doc.querySelector('table');
    if (!table) return null;
    const header = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    const rows = [...table.querySelectorAll('tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()));
    return { header, rows };
  }
```

- [ ] **Step 2: Verify the privacy gate accepts it**

```bash
bun build --no-bundle extension/features/lista-agenda/lista-agenda.js > /dev/null
bash scripts/check-privacy.sh
```
Expected: parses; `privacy gate: CLEAN`.

- [ ] **Step 3: Verify existing tests still pass**

Run: `bun test`
Expected: PASS. (`fetch`/`DOMParser` are only referenced inside functions, so importing the module in tests does not invoke them.)

- [ ] **Step 4: Commit**

```bash
git add extension/features/lista-agenda/lista-agenda.js
git commit -m "feat: fetch agenda slots and último movimento same-origin"
```

---

### Task 7: Wiring — button, consent, caches, columns

**Files:**
- Modify: `extension/features/lista-agenda/lista-agenda.js`
- Modify: `extension/manifest.json:41` (after `agenda-slots-abertos`)
- Modify: `tests/manifest-load-order.test.js`

**Interfaces:**
- Consumes: everything above, plus `window.__sigcPro.detectPesquisa`, `onListaEnderecos`, `getTableRows`, `getDataTable`, `mountWidget`, `makeDtProButton`, `agendaMinScheduleDate`, `dateToIso`, `isoToBr`.

- [ ] **Step 1: Add the manifest-registration test**

In `tests/manifest-load-order.test.js`, inside the existing `describe`:

```javascript
  test('lista-agenda.js is registered', () => {
    expect(idx('features/lista-agenda/lista-agenda.js')).toBeGreaterThan(
      idx('common/sigc-common.js'));
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/manifest-load-order.test.js`
Expected: FAIL — `-1` is not greater than the common index.

- [ ] **Step 3: Register the module**

In `extension/manifest.json`, add after `"features/agenda-slots-abertos/agenda-slots-abertos.js",`:

```json
        "features/lista-agenda/lista-agenda.js",
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/manifest-load-order.test.js`
Expected: PASS.

- [ ] **Step 5: Add the caches, consent and mount**

Append to `lista-agenda.js`, before the closing `})();`:

```javascript
  // --- caches ---------------------------------------------------------
  // In-memory only, never persisted (zero-storage guarantee). A TTL is
  // needed where agenda-map's coordinate cache has none: someone else
  // booking a slot makes these counts wrong within a page's life.
  const TTL_MS = 5 * 60 * 1000;
  const cacheAgenda = new Map();
  const cacheMovimento = new Map();

  function doCache(cache, chave, produzir) {
    const hit = cache.get(chave);
    if (hit && Date.now() - hit.em < TTL_MS) return Promise.resolve(hit);
    return produzir().then((dados) => {
      const entrada = { dados, em: Date.now() };
      cache.set(chave, entrada);
      return entrada;
    });
  }

  const horaDe = (ms) => new Date(ms).toTimeString().slice(0, 5);

  // --- render ---------------------------------------------------------
  const COLUNAS = ['Agendado', 'Situação', 'Transmissão'];

  let consentGiven = false;
  const CONSENT_MSG =
    'SIGC-PRO: isto fará duas consultas ao próprio servidor do SIGC — a ' +
    'agenda da UF e o último movimento deste controle. Nenhum dado sai do ' +
    'IBGE. Continuar?';

  async function anotar(btn) {
    if (!consentGiven) {
      if (!confirm(CONSENT_MSG)) return;
      consentGiven = true;
    }
    const pesquisa = window.__sigcPro.detectPesquisa();
    const tabela = pesquisa && window.__sigcPro.getTableRows(pesquisa);
    if (!tabela) {
      alert('SIGC-PRO: tabela não encontrada ou com layout inesperado.');
      return;
    }
    const cols = pesquisa.columns;
    const controle = String(tabela.rows[0][cols.controle.index] || '').trim();
    const uf = controle.slice(0, 2);
    if (!controle) {
      alert('SIGC-PRO: não foi possível ler o Controle da tabela.');
      return;
    }

    const ano = new Date().getFullYear();
    const falhas = [];
    btn.disabled = true;
    // Independent, NOT Promise.all: a failed movimento request must not
    // cost the user their Agendado column.
    const [ag, mv] = await Promise.all([
      doCache(cacheAgenda, uf, () =>
        fetchAgenda(uf, `${ano}-01-01T00:00:00`, `${ano + 1}-01-01T00:00:00`))
        .catch((err) => { falhas.push(`Agenda: ${err && err.message}`); return null; }),
      doCache(cacheMovimento, controle, () => fetchMovimento(uf, controle))
        .catch((err) => { falhas.push(`Último Movimento: ${err && err.message}`); return null; }),
    ]);
    btn.disabled = false;

    if (!ag && !mv) {
      alert(`SIGC-PRO: nenhuma das consultas funcionou — ${falhas.join('; ')}`);
      return;
    }

    const slots = ag ? ag.dados : [];
    const movimento = mv && mv.dados ? mv.dados : { header: [], rows: [] };
    const agendaIdx = indexByControle(slots);
    const movimentoIdx = indexMovimento(movimento.header, movimento.rows);
    const minDate = window.__sigcPro.agendaMinScheduleDate(new Date());
    const minDateIso = window.__sigcPro.dateToIso(minDate);
    const livresIdx = indexZonaLivres(slots, minDateIso);
    const todayIso = window.__sigcPro.dateToIso(new Date());

    const anotacoes = tabela.rows.map((r) => annotateRow(
      r[cols.controle.index], r[cols.nDomicilio.index],
      { agendaIdx, movimentoIdx, todayIso }));

    escreverColunas(anotacoes);
    escreverResumo(
      tabela.rows.map((r) => String(r[cols.idZona.index] || '').trim()),
      livresIdx,
      {
        minDateBr: window.__sigcPro.isoToBr(minDateIso),
        agendaEm: ag ? horaDe(ag.em) : '—',
        movimentoEm: mv ? horaDe(mv.em) : '—',
        falhas,
      });
    console.log(`${TAG} ${anotacoes.length} linha(s) anotadas; ` +
      `${livresIdx.size} zona(s) com slots livres.`);
  }

  // Appended, never inserted: indexes 0-19 must stay put, since
  // tableMatchesLayout validates by index and PDF/KML read fixed ones.
  function escreverColunas(anotacoes) {
    const dt = window.__sigcPro.getDataTable();
    if (!dt) return;
    const thead = dt.table().header();
    const jaTem = [...thead.querySelectorAll('th')]
      .some((th) => th.textContent.trim() === COLUNAS[0]);
    if (!jaTem) {
      const tr = thead.querySelector('tr');
      COLUNAS.forEach((nome) => {
        const th = document.createElement('th');
        th.textContent = nome;
        tr.appendChild(th);
      });
    }
    const corpo = dt.table().body();
    [...corpo.querySelectorAll('tr')].forEach((tr, i) => {
      const a = anotacoes[i];
      if (!a) return;
      // Re-annotating replaces rather than appends again.
      [...tr.querySelectorAll('td.sigc-pro-anotacao')].forEach((td) => td.remove());
      [
        { texto: a.agendado, classe: a.futura ? 'sp-futura' : 'sp-passada' },
        { texto: a.situacao, classe: '' },
        { texto: a.transmissao, classe: '' },
      ].forEach(({ texto, classe }) => {
        const td = document.createElement('td');
        td.className = `sigc-pro-anotacao ${classe}`.trim();
        td.textContent = texto || '—';
        tr.appendChild(td);
      });
    });
  }

  function escreverResumo(zonaIds, livresIdx, meta) {
    const antigo = document.getElementById('sigc-pro-lista-agenda-resumo');
    if (antigo) antigo.remove();
    const alvo = document.querySelector('.dataTables_wrapper') ||
      window.__sigcPro.getDataTable().table().container();
    const div = document.createElement('div');
    // Built from escaped strings only (escapeHtml on every zona id).
    div.innerHTML = buildResumoHtml(zonaIds, livresIdx, meta);
    alvo.parentNode.insertBefore(div.firstElementChild, alvo);
  }

  const STYLE_ID = 'sigc-pro-lista-agenda-style';
  const CSS = `
#sigc-pro-lista-agenda-resumo { margin: .4rem 0; padding: .4rem .6rem;
  border: 1px solid #d0d7de; border-radius: 6px; background: #f6f8fa;
  font: 12px/1.45 -apple-system, "Segoe UI", Roboto, sans-serif; color: #1a1a1a; }
#sigc-pro-lista-agenda-resumo .sp-titulo { color: #555; margin-bottom: .2rem; }
#sigc-pro-lista-agenda-resumo .sp-zona-livre { display: inline-block; margin-right: .9rem; }
#sigc-pro-lista-agenda-resumo .sp-falha { color: #a11; margin-top: .2rem; }
td.sigc-pro-anotacao.sp-futura { font-weight: 700; color: #161; }
td.sigc-pro-anotacao.sp-passada { color: #777; }
`;

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  // Selecionados view only — a correctness requirement, not a
  // preference: zona columns are populated only for selecionado
  // households, so on the completos view the zona index would silently
  // under-count (see agenda-map.js).
  function noSelecionados() {
    const pesquisa = window.__sigcPro.detectPesquisa();
    const tabela = pesquisa && window.__sigcPro.getTableRows(pesquisa);
    if (!tabela || tabela.rows.length === 0) return false;
    const i = pesquisa.columns.selecionado.index;
    return tabela.rows.every((r) => /^sim$/i.test(String(r[i] || '').trim()));
  }

  window.__sigcPro.mountWidget({
    id: 'sigc-pro-lista-agenda-button',
    // dtToolbar() is the ".dt-buttons" bar, the same anchor csv-export
    // uses. onListaEnderecos is a direct __sigcPro export, NOT on ctx.
    anchor: (ctx) => ctx.dtToolbar(),
    when: () => window.__sigcPro.onListaEnderecos() && noSelecionados(),
    build: () => {
      ensureStyle();
      console.log(`${TAG} Agenda button added.`);
      return window.__sigcPro.makeDtProButton({
        id: 'sigc-pro-lista-agenda-button',
        lines: ['AGENDA', 'PRO'],
        title: 'Anotar agendamento e situação de cada domicílio (SIGC-PRO)',
        onClick: (e) => anotar(e.currentTarget),
      });
    },
  });
```

- [ ] **Step 6: Verify everything passes**

```bash
bun build --no-bundle extension/features/lista-agenda/lista-agenda.js > /dev/null
bun test
bash scripts/check-privacy.sh
```
Expected: parses; all tests PASS; gate CLEAN.

- [ ] **Step 7: Commit**

```bash
git add extension/features/lista-agenda/lista-agenda.js extension/manifest.json tests/manifest-load-order.test.js
git commit -m "feat: wire the Lista de Endereços agenda annotation button"
```

---

### Task 8: Live verification

**Files:** none (manual).

Every prior task is unit-tested; none proves the endpoint answers. The one
residual inference in the spec is that a JSON open slot's `title` matches
the DOM sample. Confirm before touching docs.

- [ ] **Step 1: Load the extension and open a Lista de Endereços (selecionados)**

Reload at `chrome://extensions`, open a Lista de Endereços filtered to
selecionados, confirm the **AGENDA PRO** button appears and does **not**
appear on the completos view.

- [ ] **Step 2: Click it, accept the prompt, and inspect the response**

In DevTools Console before clicking, run:

```javascript
const _f = window.fetch;
window.fetch = async (...a) => { const r = await _f(...a); if (String(a[0]).includes('ObterSlots')) console.log('SLOTS', (await r.clone().json()).slice(0, 3)); return r; };
```

Check in the logged sample:
- an **open** slot's `title` is only `"Zonas: …"` (no `Controle:` line);
- a **reserved** slot's `title` carries `Controle:` and `Domicílio:`;
- `start` is `YYYY-MM-DDTHH:MM:SS`.

If any differs, fix `parseSlots` and its tests before continuing.

- [ ] **Step 3: Verify the rendering**

- Three columns appended at the right, existing columns unmoved.
- A scheduled household shows a date; a future one is bold green.
- The header line names the cutoff, the fetch time and per-zona counts.
- Clicking twice does not duplicate columns.
- CSV-pro export now includes the three new columns; PDF-pro and KML-pro
  are unchanged.

- [ ] **Step 4: Verify partial failure**

In DevTools, block `/relatorio/filtrar` (Network → block request URL),
click again after 5+ minutes (or reload), and confirm the Agendado column
still fills while Situação/Transmissão show `—` and the header names the
failure.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: correct <what live testing revealed>"
```

If nothing needed fixing, skip the commit and note that in the report.

---

### Task 9: Documentation

**Files:**
- Modify: `docs/store-listing.md`, `docs/PRIVACY_POLICY.html`, `ROADMAP.md`

The privacy policy currently says **two** optional features make network
calls. This adds a third, so the disclosure is wrong until updated —
required, not optional.

- [ ] **Step 1: Update the privacy policy**

In `docs/PRIVACY_POLICY.html`, change "Dois recursos opcionais fazem
requisições" to "Três recursos opcionais fazem requisições", and add
after the Guia do Dia clause:

```html
  ; e a anotação da Lista de Endereços, que consulta a agenda da UF e o
  último movimento do controle exibido, mediante clique e confirmação,
  para mostrar em cada domicílio se há entrevista agendada e sua situação
  de coleta — a resposta é processada localmente, reduzida aos campos
  exibidos e mantida apenas em memória
```

- [ ] **Step 2: Update the store listing**

In `docs/store-listing.md`, add to the "Na Lista de Endereços" bullets:

```
• Agenda-pro — anota cada domicílio com a data da entrevista agendada e
  a situação do último movimento, e mostra quantos slots ainda livres
  existem em cada zona da tabela, obtendo os dados do próprio servidor do
  SIGC mediante clique e confirmação.
```

And in the PRIVACY paragraph, change "as consultas opcionais do Guia do
Dia e da exportação avançada do Último Movimento" to "as consultas
opcionais do Guia do Dia, da anotação da Lista de Endereços e da
exportação avançada do Último Movimento". Make the same change in the
**Host permission justification** block, which enumerates the same
fetches for reviewers.

- [ ] **Step 3: Update ROADMAP**

Add to the Done section:

```markdown
- [x] **Lista de Endereços × Agenda + Último Movimento**: the selecionados
      view gains Agendado / Situação / Transmissão columns per household
      and a per-zona free-slots header, from two same-origin fetches
      behind one click+confirm (ObterSlots for the UF's year, /relatorio/
      filtrar for this Controle). Reverses 2026-07-16-agenda-csv-export's
      decision not to call ObterSlots — that spec's DOM alternative does
      not exist on this page, so the choice was fetch or drop the feature.
      Agenda responses are narrowed to Controle/Domicílio/Zonas/start at
      the parse boundary; the rest (name, address, telephone) is never
      held. Columns are appended so indexes 0-19 stay intact
      (`2026-07-31-lista-agenda-design.md`)
```

- [ ] **Step 4: Verify and commit**

```bash
bun test
bash scripts/check-privacy.sh
git add docs/ ROADMAP.md
git commit -m "docs: disclose the Lista de Endereços agenda fetches"
```

---

## Self-Review

**Spec coverage:** ObterSlots fetch (T6), Último Movimento per-Controle fetch (T6), open-vs-reserved title test (T1), zona ID matching (T1), prazo filter (T1), weighted counts with suppression (T1/T3), Agendado column with live/past choice (T1/T4/T7), Situação + Transmissão columns (T2/T4/T7), header line (T3/T7), selecionados-only gate (T7), click+confirm (T7), two caches with separate timestamps (T7), partial failure (T7 + T8 step 4), append-only columns (T7), parse-boundary narrowing (T1), privacy gate (T5), docs (T9). All covered.

**Placeholders:** none. Every helper name in Task 7 was resolved against `sigc-common.js` while writing the plan: the anchor is `ctx.dtToolbar()` (`.dt-buttons`, as `csv-export.js` uses), and `onListaEnderecos()` is a direct `__sigcPro` export rather than a context method.

**Type consistency:** `chaveDomicilio(controle, domicilio)` builds every key, used identically in `indexByControle`, `indexMovimento` and `annotateRow`. `indexZonaLivres` cells are `{ inteiro, peso, compartilhado }` in both producer and consumer. `annotateRow` returns `{ agendado, futura, situacao, transmissao }`, consumed with those exact names in `escreverColunas`. `doCache` returns `{ dados, em }`, unwrapped as `ag.dados`/`ag.em` at both call sites.

**Executed check:** Task 1's `parseSlots`, `zonaIdOf`, `indexZonaLivres` and `pickAgendado` were run against the plan's own fixtures before this plan was committed — 9 assertions, all passing, including the shared-slot weighting, the prazo cutoff boundary, and the personal-data-dropped check. That run is what surfaced the missing `parseAgendaSlotTitle` export, now Task 0. Every `__sigcPro` helper the plan calls (`detectPesquisa`, `onListaEnderecos`, `getDataTable`, `getTableRows`, `escapeHtml`, `isoToBr`, `dateToIso`, `parseZonaEntries`, `agendaMinScheduleDate`, `mountWidget`, `makeDtProButton`) was confirmed present in the exports object.

**Not verified:** the fetches (Task 6) and the DOM writing (Task 7), which is what Task 8's live pass is for.
