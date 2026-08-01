# Maps Links, Tipo de Entrevista and Zona Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google Maps links per domicílio, a Tipo de Entrevista column, and a two-week calendar of the zona's slots to the AGENDA PRO export — none of which needs a new network request.

**Architecture:** Three independent additions to `extension/features/lista-agenda/lista-agenda.js`, each a pure function feeding the existing downloaded-HTML builder. One shared-helper move (`toMin`/`fmtMin` → `sigc-common.js`) removes a duplication that would otherwise reach three copies.

**Tech Stack:** Vanilla JS (IIFE modules, no build step), `bun test` + happy-dom, Chrome MV3 content scripts.

**Spec:** `docs/superpowers/specs/2026-08-01-lista-agenda-calendar-design.md`

## Global Constraints

- **No `node`.** Syntax-check with `bun build --no-bundle <file>`; run tests with `bun test`.
- **Privacy gate must pass** on every commit: `bash scripts/check-privacy.sh`. It runs as a pre-commit hook.
- **Never push.** Commit only.
- **Conventional commits**, subject under 72 chars, English.
- **No new network request.** Every field in this plan comes from data already fetched or already on screen. Adding a `fetch(` anywhere is out of scope.
- **The parse boundary still narrows.** `parseSlots` gains exactly one field (`end`). Name, sex, birth date, address and telephone stay discarded and must never be retained.
- **Zero structural changes to the portal's table.** This feature reads it; it never writes to it.
- **No new MutationObserver** in the feature module — the shared observer in `sigc-common.js` covers it.
- **All interpolated values** go through `window.__sigcPro.escapeHtml`. The export is built by string concatenation and injected as a file.
- Portuguese for user-facing strings; English for code comments. Comments explain **why**, not what.

---

## File Structure

| File | Responsibility |
|---|---|
| `extension/common/sigc-common.js` (modify) | Gains exported `toMin`/`fmtMin` (Task 1). |
| `extension/features/agenda-slots-abertos/agenda-slots-abertos.js` (modify) | Drops its local `toMin` (Task 1). |
| `extension/features/agenda-day-guide/agenda-day-guide.js` (modify) | Drops its local `toMin`/`fmtMin` (Task 1). |
| `extension/features/lista-agenda/lista-agenda.js` (modify) | Maps links (T2), Tipo de Entrevista (T3), calendar (T4-T5). |
| `tests/sigc-common-helpers.test.js` (modify) | Covers the moved helpers. |
| `tests/lista-agenda.test.js` (modify) | Covers T2-T5. |

Tasks 2, 3 and 4/5 are independent of each other; all depend on Task 1 only for the calendar's time handling.

---

### Task 1: Move `toMin`/`fmtMin` into sigc-common

**Files:**
- Modify: `extension/common/sigc-common.js` (add both functions + exports)
- Modify: `extension/features/agenda-slots-abertos/agenda-slots-abertos.js:49-52` (delete local, use export)
- Modify: `extension/features/agenda-day-guide/agenda-day-guide.js:642-647` (delete locals, use exports)
- Test: `tests/sigc-common-helpers.test.js`

**Interfaces:**
- Produces: `window.__sigcPro.toMin(hhmm)` → `number | null` (minutes since midnight); `window.__sigcPro.fmtMin(min)` → `"HH:MM"`.

The two existing `toMin` copies are **byte-identical in body** (verified). `fmtMin` exists only in the day guide.

- [ ] **Step 1: Write the failing tests**

Append to `tests/sigc-common-helpers.test.js`:

```javascript
describe('toMin / fmtMin', () => {
  test('parses HH:MM to minutes since midnight', () => {
    expect(window.__sigcPro.toMin('00:00')).toBe(0);
    expect(window.__sigcPro.toMin('09:30')).toBe(570);
    expect(window.__sigcPro.toMin('23:59')).toBe(1439);
  });

  // A one-digit hour is what the agenda's own slot text emits.
  test('accepts a one-digit hour', () => {
    expect(window.__sigcPro.toMin('9:05')).toBe(545);
  });

  // Callers branch on null, so an unparseable value must not become 0 —
  // midnight and "no time at all" are different things.
  test('returns null when there is no parseable time', () => {
    expect(window.__sigcPro.toMin('')).toBeNull();
    expect(window.__sigcPro.toMin(null)).toBeNull();
    expect(window.__sigcPro.toMin('LIVRE')).toBeNull();
  });

  test('ignores trailing text after the time', () => {
    expect(window.__sigcPro.toMin('09:30 - 10:00')).toBe(570);
  });

  test('fmtMin renders zero-padded HH:MM', () => {
    expect(window.__sigcPro.fmtMin(0)).toBe('00:00');
    expect(window.__sigcPro.fmtMin(570)).toBe('09:30');
    expect(window.__sigcPro.fmtMin(1439)).toBe('23:59');
  });

  test('fmtMin round-trips toMin', () => {
    expect(window.__sigcPro.fmtMin(window.__sigcPro.toMin('14:45'))).toBe('14:45');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/sigc-common-helpers.test.js`
Expected: FAIL — `toMin is not a function`.

- [ ] **Step 3: Add both functions to sigc-common.js**

Place them near the other small pure helpers (e.g. beside `isoToBr`/`dateToIso`):

```javascript
  // "HH:MM" -> minutes since midnight, null when there is no parseable
  // time. Callers branch on null, so an unparseable value must never
  // collapse to 0 — midnight and "no time" are different. Shared because
  // three features need it (agenda-slots-abertos, agenda-day-guide,
  // lista-agenda) and the copies had already drifted apart in form.
  function toMin(hhmm) {
    const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || '');
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }

  function fmtMin(min) {
    return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  }
```

Add `toMin,` and `fmtMin,` to the `window.__sigcPro = { ... }` exports object.

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/sigc-common-helpers.test.js`
Expected: PASS.

- [ ] **Step 5: Update agenda-slots-abertos.js**

Delete the local `toMin` (lines ~49-52). Its one call site (line ~58, `const min = toMin(r.horaInicio);`) becomes `window.__sigcPro.toMin(r.horaInicio)`.

- [ ] **Step 6: Update agenda-day-guide.js**

Inside `buildDayGrid`, delete the local `const toMin = ...` and `const fmtMin = ...` (lines ~642-647). Update the three call sites (~648, ~658, ~698) to `window.__sigcPro.toMin(...)` / `window.__sigcPro.fmtMin(...)`.

- [ ] **Step 7: Verify nothing regressed**

```bash
bun test
bun build --no-bundle extension/common/sigc-common.js > /dev/null
bun build --no-bundle extension/features/agenda-slots-abertos/agenda-slots-abertos.js > /dev/null
bun build --no-bundle extension/features/agenda-day-guide/agenda-day-guide.js > /dev/null
bash scripts/check-privacy.sh
```
Expected: all tests PASS (both features' existing suites prove the move was behaviour-preserving); all three parse; gate CLEAN.

- [ ] **Step 8: Commit**

```bash
git add extension/common/sigc-common.js extension/features/agenda-slots-abertos/agenda-slots-abertos.js extension/features/agenda-day-guide/agenda-day-guide.js tests/sigc-common-helpers.test.js
git commit -m "refactor: share toMin/fmtMin from sigc-common"
```

---

### Task 2: Google Maps link per domicílio

**Files:**
- Modify: `extension/features/lista-agenda/lista-agenda.js`
- Test: `tests/lista-agenda.test.js`

**Interfaces:**
- Consumes: `window.__sigcPro.parseCoord` (already exported; parses SIGC's DMS forms, returns null on junk).
- Produces: `mapsUrl(lat, lon)` → `string | ''`; `buildDomiciliosTable` renders the address as a link when coordinates parse.

The Lista de Endereços carries Latitude at column index 10 and Longitude at 11 (`pesquisa.columns.latitude` / `.longitude`). `anotar` must pass them into the `domicilios` objects it builds (~line 593).

- [ ] **Step 1: Write the failing tests**

Append to `tests/lista-agenda.test.js`:

```javascript
const { mapsUrl } = window.__sigcPro.listaAgenda;

describe('mapsUrl', () => {
  test('builds a destination link from coordinates', () => {
    const url = mapsUrl(-12.9, -38.5);
    expect(url).toContain('google.com/maps');
    expect(url).toContain('-12.9');
    expect(url).toContain('-38.5');
  });

  // A dead link is worse than plain text: it looks actionable and goes
  // nowhere useful.
  test('returns empty string when either coordinate is missing', () => {
    expect(mapsUrl(null, -38.5)).toBe('');
    expect(mapsUrl(-12.9, null)).toBe('');
    expect(mapsUrl(null, null)).toBe('');
  });
});

describe('buildDomiciliosTable — maps link', () => {
  const comCoord = [{
    endereco: 'RUA DAS FLORES, 100', nDomicilio: '1',
    lat: -12.9, lon: -38.5,
    agendado: '', futura: false, situacao: '', transmissao: '',
  }];
  const semCoord = [{
    endereco: 'RUA SEM COORDENADA, 5', nDomicilio: '2',
    lat: null, lon: null,
    agendado: '', futura: false, situacao: '', transmissao: '',
  }];

  test('links the address when coordinates are present', () => {
    const html = buildDomiciliosTable(comCoord);
    expect(html).toContain('<a href="https://www.google.com/maps');
    expect(html).toContain('RUA DAS FLORES, 100');
  });

  test('renders plain text, never an anchor, without coordinates', () => {
    const html = buildDomiciliosTable(semCoord);
    expect(html).toContain('RUA SEM COORDENADA, 5');
    expect(html).not.toContain('<a href');
  });

  test('escapes the address inside the link', () => {
    const html = buildDomiciliosTable([{
      ...comCoord[0], endereco: 'RUA <b>X</b> & CIA',
    }]);
    expect(html).not.toContain('<b>X</b>');
    expect(html).toContain('&lt;b&gt;');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/lista-agenda.test.js`
Expected: FAIL — `mapsUrl is not a function`.

- [ ] **Step 3: Implement**

Add near the other pure render helpers in `lista-agenda.js`:

```javascript
  // Single-destination Google Maps link. Deliberately NOT reusing
  // agenda-day-guide's gmapsRouteUrl: that builds multi-point routes
  // with waypoints, and exporting a route-builder for a one-pin use
  // would be a worse dependency than this line.
  //
  // Returns '' when either coordinate is missing, so callers render
  // plain text — a dead link looks actionable and goes nowhere.
  function mapsUrl(lat, lon) {
    if (lat == null || lon == null) return '';
    return 'https://www.google.com/maps/dir/?api=1&travelmode=driving' +
      `&destination=${encodeURIComponent(`${lat},${lon}`)}`;
  }
```

In `buildDomiciliosTable`, replace the plain address cell with:

```javascript
      const endereco = d.endereco || `Domicílio ${d.nDomicilio ?? ''}`.trim();
      const url = mapsUrl(d.lat, d.lon);
      const enderecoCell = url
        ? `<a href="${e(url)}" target="_blank" rel="noopener">${e(endereco || '—')}</a>`
        : e(endereco || '—');
```

and use `enderecoCell` in the first `<td>`.

Add `mapsUrl` to the exports object.

- [ ] **Step 4: Wire the coordinates through `anotar`**

In `anotar`, where the `domicilios` array is built (~line 593), add `lat` and `lon` to each object, parsed from the row:

```javascript
        lat: window.__sigcPro.parseCoord(r[cols.latitude.index]),
        lon: window.__sigcPro.parseCoord(r[cols.longitude.index]),
```

- [ ] **Step 5: Run to verify it passes**

Run: `bun test tests/lista-agenda.test.js`
Expected: PASS.

- [ ] **Step 6: Tighten the self-contained assertion**

`tests/lista-agenda.test.js:543-546` currently asserts the document contains no `http://` or `https://` at all. Maps links break that. Replace the body with an assertion that the ONLY external URLs are Google Maps links, so a CDN or font import still fails:

```javascript
  test('the only external URLs are Google Maps links', () => {
    const html = docHtml();
    // Links, not loaded resources: nothing is fetched when the file
    // opens — clicking one is an explicit navigation. A CDN script or
    // font import would still be a privacy regression, so the rule is
    // tightened rather than dropped.
    expect(html).not.toContain('http://');
    const externos = [...html.matchAll(/https:\/\/[^"'\s)]+/g)].map((m) => m[0]);
    externos.forEach((u) => expect(u).toStartWith('https://www.google.com/maps'));
    expect(html).not.toContain('<script src');
    expect(html).not.toContain('@import');
  });
```

Adjust `docHtml()` to whatever the existing test's fixture helper is called — reuse it, do not build a second one.

- [ ] **Step 7: Verify and commit**

```bash
bun test
bun build --no-bundle extension/features/lista-agenda/lista-agenda.js > /dev/null
bash scripts/check-privacy.sh
git add extension/features/lista-agenda/lista-agenda.js tests/lista-agenda.test.js
git commit -m "feat: link each domicílio's address to Google Maps"
```

---

### Task 3: Tipo de Entrevista column

**Files:**
- Modify: `extension/features/lista-agenda/lista-agenda.js`
- Test: `tests/lista-agenda.test.js`

**Interfaces:**
- Extends: `indexMovimento` values gain `tipo`; `annotateRow`'s returned object gains `tipo`; `buildDomiciliosTable` renders it.

Live header captured 2026-07-31:
`["Controle","Domicilio","Entrevistador","Tipo de Entrevista","Última Posição","Data","Observação"]`

- [ ] **Step 1: Write the failing tests**

Append to `tests/lista-agenda.test.js`:

```javascript
describe('indexMovimento — tipo de entrevista', () => {
  const header = ['Controle', 'Domicilio', 'Entrevistador', 'Tipo de Entrevista',
    'Última Posição', 'Data', 'Observação'];
  const rows = [
    ['292740805060337', '1', 'JOÃO', 'PRESENCIAL', 'TRANSMITIDO', '28/07/2026', ''],
  ];

  test('captures Tipo de Entrevista', () => {
    const { index } = indexMovimento(header, rows);
    expect(index.get('292740805060337|1').tipo).toBe('PRESENCIAL');
  });

  // A missing column must still surface via colunasNaoEncontradas, not
  // silently empty the column.
  test('a missing Tipo column flags colunasNaoEncontradas', () => {
    const semTipo = ['Controle', 'Domicilio', 'Entrevistador',
      'Última Posição', 'Data', 'Observação'];
    const r = indexMovimento(semTipo, [['292740805060337', '1', 'JOÃO', 'X', '28/07/2026', '']]);
    expect(r.colunasNaoEncontradas).toBe(true);
  });
});

describe('annotateRow / table — tipo', () => {
  test('annotateRow carries tipo through, empty when absent', () => {
    const idx = new Map([['C1|1', { situacao: 'X', transmissao: '', tipo: 'PRESENCIAL' }]]);
    const r = annotateRow('C1', '1', {
      agendaIdx: new Map(), movimentoIdx: idx, todayIso: '2026-07-31',
    });
    expect(r.tipo).toBe('PRESENCIAL');
    const vazio = annotateRow('C9', '9', {
      agendaIdx: new Map(), movimentoIdx: idx, todayIso: '2026-07-31',
    });
    expect(vazio.tipo).toBe('');
  });

  test('the table renders tipo, and — when absent', () => {
    const html = buildDomiciliosTable([
      { endereco: 'R X, 1', nDomicilio: '1', lat: null, lon: null,
        agendado: '', futura: false, situacao: 'EM COLETA', transmissao: '', tipo: 'PRESENCIAL' },
      { endereco: 'R Y, 2', nDomicilio: '2', lat: null, lon: null,
        agendado: '', futura: false, situacao: '', transmissao: '', tipo: '' },
    ]);
    expect(html).toContain('PRESENCIAL');
    expect(html).toContain('Tipo');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/lista-agenda.test.js`
Expected: FAIL — `tipo` is `undefined`.

- [ ] **Step 3: Implement**

In `indexMovimento`: add `const iTipo = acharColuna(header, 'Tipo de Entrevista');`, include `iTipo === -1` in the existing missing-column check that sets `colunasNaoEncontradas`, and add `tipo: String(r[iTipo] ?? '').trim()` to each stored value.

In `annotateRow`: add `tipo: mv ? mv.tipo : '',` to the returned object.

In `buildDomiciliosTable`: add a `<th>Tipo</th>` header **immediately after Situação** (the two describe the same thing) and the matching `<td>` cell with `e(d.tipo || '—')`. Give the new `<th>` `data-tipo="texto"` so the existing sorter handles it.

In `anotar`, where `domicilios` objects are built: add `tipo: a.tipo,`.

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/lista-agenda.test.js`
Expected: PASS.

- [ ] **Step 5: Verify and commit**

```bash
bun test
bun build --no-bundle extension/features/lista-agenda/lista-agenda.js > /dev/null
bash scripts/check-privacy.sh
git add extension/features/lista-agenda/lista-agenda.js tests/lista-agenda.test.js
git commit -m "feat: show tipo de entrevista per domicílio"
```

---

### Task 4: Calendar data — retain `end`, select the window's slots

**Files:**
- Modify: `extension/features/lista-agenda/lista-agenda.js`
- Test: `tests/lista-agenda.test.js`

**Interfaces:**
- Extends: `parseSlots` output gains `end`.
- Produces: `slotsDaJanela(slots, zonaId, hojeIso, limiteIso, fimIso)` → `[{isoDate, horaInicio, horaFim, aberto, controle, domicilio}]`, sorted by date then start time.

**THE CORE RULE — free and filled slots are filtered differently:**
- A **free** slot appears only when `isoDate >= limiteIso` (the prazo mínimo). Before that it cannot be booked, so showing it advertises capacity that does not exist.
- A **filled** slot appears across the whole window, including before the prazo. It is an appointment somebody must keep; hiding it would make the coming days look empty when they are the busiest.
- Both are bounded by `isoDate <= fimIso` (today + 14 days) and `isoDate >= hojeIso`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/lista-agenda.test.js`:

```javascript
const { slotsDaJanela } = window.__sigcPro.listaAgenda;

describe('parseSlots — end retained', () => {
  test('keeps end alongside start', () => {
    const [s] = parseSlots([slotJson({ end: '2026-08-10T09:30:00' })]);
    expect(s.end).toBe('2026-08-10T09:30:00');
  });

  // The privacy narrowing is unchanged by adding a timestamp.
  test('still discards personal data', () => {
    const json = JSON.stringify(parseSlots([slotJson()]));
    expect(json).not.toContain('RUA X');
    expect(json).not.toContain('71 99999-0000');
  });
});

describe('slotsDaJanela', () => {
  const HOJE = '2026-08-01';
  const LIMITE = '2026-08-04';   // prazo mínimo
  const FIM = '2026-08-15';      // hoje + 14

  const slot = (isoDate, hora, aberto) => parseSlots([slotJson({
    start: `${isoDate}T${hora}:00`,
    end: `${isoDate}T${hora}:00`,
    title: aberto
      ? 'Zonas: 29JDM8 - 29.2.01.02 29_Linus_Lauro'
      : `Zonas: 29JDM8 - 29.2.01.02 29_Linus_Lauro\nControle: C1\nDomicílio: 1`,
  })])[0];

  test('a free slot before the prazo is omitted', () => {
    const r = slotsDaJanela([slot('2026-08-02', '09:00', true)], '29JDM8', HOJE, LIMITE, FIM);
    expect(r).toHaveLength(0);
  });

  // The asymmetry: a booked visit in the next 3 days is real work that
  // must stay visible.
  test('a FILLED slot before the prazo is kept', () => {
    const r = slotsDaJanela([slot('2026-08-02', '09:00', false)], '29JDM8', HOJE, LIMITE, FIM);
    expect(r).toHaveLength(1);
    expect(r[0].aberto).toBe(false);
  });

  test('a free slot on the prazo date itself is kept', () => {
    const r = slotsDaJanela([slot(LIMITE, '09:00', true)], '29JDM8', HOJE, LIMITE, FIM);
    expect(r).toHaveLength(1);
  });

  test('slots past the window end are omitted, free or filled', () => {
    const r = slotsDaJanela([
      slot('2026-08-20', '09:00', true), slot('2026-08-20', '10:00', false),
    ], '29JDM8', HOJE, LIMITE, FIM);
    expect(r).toHaveLength(0);
  });

  test('slots before today are omitted', () => {
    const r = slotsDaJanela([slot('2026-07-20', '09:00', false)], '29JDM8', HOJE, LIMITE, FIM);
    expect(r).toHaveLength(0);
  });

  test('only this zona\'s slots are included', () => {
    const outra = parseSlots([slotJson({
      start: '2026-08-10T09:00:00',
      title: 'Zonas: 29ZZZZ - 29.9.09.09 29_Linus_Outra',
    })])[0];
    const r = slotsDaJanela([outra], '29JDM8', HOJE, LIMITE, FIM);
    expect(r).toHaveLength(0);
  });

  test('sorted by date then start time', () => {
    const r = slotsDaJanela([
      slot('2026-08-10', '14:00', true),
      slot('2026-08-05', '09:00', true),
      slot('2026-08-10', '09:00', true),
    ], '29JDM8', HOJE, LIMITE, FIM);
    expect(r.map((s) => `${s.isoDate} ${s.horaInicio}`)).toEqual([
      '2026-08-05 09:00', '2026-08-10 09:00', '2026-08-10 14:00',
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/lista-agenda.test.js`
Expected: FAIL — `s.end` undefined and `slotsDaJanela is not a function`.

- [ ] **Step 3: Implement**

In `parseSlots`, add `end: String((s && s.end) || ''),` to the returned object. Update its comment to note that `end` is a timestamp, so the narrowing rule is unchanged.

Add:

```javascript
  const horaDeIso = (iso) => String(iso || '').slice(11, 16);

  // Free and filled slots are filtered DIFFERENTLY, deliberately:
  // a free slot before the prazo mínimo cannot be booked, so showing it
  // would advertise capacity that does not exist — but a FILLED slot in
  // that same window is an appointment somebody must keep, and hiding it
  // would make the coming days look empty when they are the busiest.
  function slotsDaJanela(slots, zonaId, hojeIso, limiteIso, fimIso) {
    return (slots || [])
      .filter((s) => {
        if (!s.isoDate || s.isoDate < hojeIso || s.isoDate > fimIso) return false;
        if (s.aberto && s.isoDate < limiteIso) return false;
        const ids = window.__sigcPro.parseZonaEntries(s.zonas).map(zonaIdOf);
        return ids.includes(zonaId);
      })
      .map((s) => ({
        isoDate: s.isoDate,
        horaInicio: horaDeIso(s.start),
        horaFim: horaDeIso(s.end),
        aberto: s.aberto,
        controle: s.controle,
        domicilio: s.domicilio,
      }))
      .sort((a, b) => a.isoDate.localeCompare(b.isoDate) ||
        a.horaInicio.localeCompare(b.horaInicio));
  }
```

Add `slotsDaJanela` to the exports object.

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/lista-agenda.test.js`
Expected: PASS.

- [ ] **Step 5: Verify and commit**

```bash
bun test
bun build --no-bundle extension/features/lista-agenda/lista-agenda.js > /dev/null
bash scripts/check-privacy.sh
git add extension/features/lista-agenda/lista-agenda.js tests/lista-agenda.test.js
git commit -m "feat: select the zona's bookable and booked slots"
```

---

### Task 5: Render the calendar into the export

**Files:**
- Modify: `extension/features/lista-agenda/lista-agenda.js`
- Test: `tests/lista-agenda.test.js`

**Interfaces:**
- Consumes: Task 4's `slotsDaJanela` output, Task 1's `toMin`/`fmtMin`.
- Produces: `buildCalendarioHtml(slots)` → HTML string; embedded by `buildDomiciliosDocHtml` **above** the household table.

**Shape:** rows = half-hour marks, columns = days. Slot starts do not necessarily align to :00/:30, so each slot lands in the mark **containing** its start and the cell shows the real start time — the same treatment `agenda-day-guide`'s grid uses. Two states: **livre** and **preenchido** (showing Controle/Domicílio).

- [ ] **Step 1: Write the failing tests**

Append to `tests/lista-agenda.test.js`:

```javascript
const { buildCalendarioHtml } = window.__sigcPro.listaAgenda;

describe('buildCalendarioHtml', () => {
  const s = (isoDate, horaInicio, aberto, controle = '', domicilio = '') =>
    ({ isoDate, horaInicio, horaFim: '', aberto, controle, domicilio });

  test('renders a column per distinct day and a row per half-hour mark', () => {
    const html = buildCalendarioHtml([
      s('2026-08-05', '09:00', true), s('2026-08-06', '09:00', true),
    ]);
    expect(html).toContain('05/08');
    expect(html).toContain('06/08');
    expect(html).toContain('09:00');
  });

  test('marks free and filled slots distinguishably', () => {
    const html = buildCalendarioHtml([
      s('2026-08-05', '09:00', true),
      s('2026-08-05', '10:00', false, 'C1', '1'),
    ]);
    expect(html).toContain('sp-cal-livre');
    expect(html).toContain('sp-cal-cheio');
  });

  test('a filled slot names the household', () => {
    const html = buildCalendarioHtml([s('2026-08-05', '10:00', false, 'C1', '7')]);
    expect(html).toContain('C1');
    expect(html).toContain('7');
  });

  // A 09:15 start belongs in the 09:00 mark but must show its real time,
  // or the reader books the wrong slot.
  test('an off-mark start lands in its containing mark, showing the real time', () => {
    const html = buildCalendarioHtml([s('2026-08-05', '09:15', true)]);
    expect(html).toContain('09:15');
  });

  test('says so when there is nothing to show', () => {
    expect(buildCalendarioHtml([])).toContain('Nenhum slot');
  });

  test('escapes household text', () => {
    const html = buildCalendarioHtml([
      s('2026-08-05', '10:00', false, '<script>alert(1)</script>', '1'),
    ]);
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('buildDomiciliosDocHtml — calendar placement', () => {
  test('the calendar precedes the household table', () => {
    const html = buildDomiciliosDocHtml(
      { controle: 'C1', quando: 'dados de 09:31' },
      '<div class="sp-titulo">resumo</div>',
      [{ endereco: 'R X, 1', nDomicilio: '1', lat: null, lon: null,
         agendado: '', futura: false, situacao: '', transmissao: '', tipo: '' }],
      buildCalendarioHtml([{ isoDate: '2026-08-05', horaInicio: '09:00',
        horaFim: '', aberto: true, controle: '', domicilio: '' }])
    );
    expect(html.indexOf('sp-calendario')).toBeGreaterThan(-1);
    expect(html.indexOf('sp-calendario')).toBeLessThan(html.indexOf('sp-tabela-domicilios'));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/lista-agenda.test.js`
Expected: FAIL — `buildCalendarioHtml is not a function`.

- [ ] **Step 3: Implement**

```javascript
  // Days × half-hour marks. Slot starts do not necessarily align to
  // :00/:30, so each slot lands in the mark CONTAINING its start and the
  // cell shows the real start time — the same treatment
  // agenda-day-guide's grid uses, and for the same reason: a reader who
  // sees only the mark books the wrong slot.
  function buildCalendarioHtml(slots) {
    const e = window.__sigcPro.escapeHtml;
    const lista = slots || [];
    if (lista.length === 0) {
      return '<p class="sp-cal-vazio">Nenhum slot nesta zona no período.</p>';
    }
    const toMin = window.__sigcPro.toMin;
    const fmtMin = window.__sigcPro.fmtMin;

    const dias = [...new Set(lista.map((s) => s.isoDate))].sort();
    const mins = lista.map((s) => toMin(s.horaInicio)).filter((v) => v != null);
    const marks = [];
    for (let t = Math.min(...mins) - (Math.min(...mins) % 30);
      t <= Math.max(...mins); t += 30) marks.push(t);

    const diaLabel = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
    const head = `<tr><th>Hora</th>${dias
      .map((d) => `<th>${e(diaLabel(d))}</th>`).join('')}</tr>`;

    const corpo = marks.map((t) => {
      const celulas = dias.map((d) => {
        const noMark = lista.filter((s) => {
          const m = toMin(s.horaInicio);
          return s.isoDate === d && m != null && m - (m % 30) === t;
        });
        if (noMark.length === 0) return '<td class="sp-cal-vazia"></td>';
        const conteudo = noMark.map((s) => {
          const hora = `<span class="sp-cal-hora">${e(s.horaInicio)}</span>`;
          if (s.aberto) return `${hora} <span class="sp-cal-livre">LIVRE</span>`;
          const dom = s.domicilio ? ` / ${e(s.domicilio)}` : '';
          return `${hora} <span class="sp-cal-cheio">${e(s.controle) || '—'}${dom}</span>`;
        }).join('<br>');
        return `<td>${conteudo}</td>`;
      }).join('');
      return `<tr><th>${e(fmtMin(t))}</th>${celulas}</tr>`;
    }).join('\n');

    return [
      '<table class="sp-tabela" id="sp-calendario">',
      head, corpo,
      '</table>',
    ].join('\n');
  }
```

Add `buildCalendarioHtml` to the exports object.

- [ ] **Step 4: Embed it in the document**

Give `buildDomiciliosDocHtml` a `calendarioHtml` parameter and render it **between the resumo and the household table**, under a heading (e.g. `<h2>Agenda da zona (próximas 2 semanas)</h2>`). Add CSS for `.sp-cal-livre` (green, bold — matching the panel's `sp-livre`), `.sp-cal-cheio` (muted), `.sp-cal-vazia`, `.sp-cal-hora`, `.sp-cal-vazio`. Follow the existing `<style>` block's conventions.

Give the household table the id `sp-tabela-domicilios` if it does not already have one, so the placement test can locate it.

- [ ] **Step 5: Wire it in `anotar`**

Compute the window and pass the rendered calendar through:

```javascript
    const hojeIso = window.__sigcPro.dateToIso(new Date());
    const fim = new Date();
    fim.setDate(fim.getDate() + 14);
    const fimIso = window.__sigcPro.dateToIso(fim);
    // One zona per Controle, so the calendar is unambiguous — these are
    // THE slots for these households.
    const zonaId = zonaIds[0] || '';
    const calendarioHtml = buildCalendarioHtml(
      zonaId ? slotsDaJanela(slots, zonaId, hojeIso, minDateIso, fimIso) : []);
```

`minDateIso` already exists in `anotar` (the prazo mínimo). Use the zona id list already computed for the resumo — take its first entry.

- [ ] **Step 6: Run to verify it passes**

Run: `bun test tests/lista-agenda.test.js`
Expected: PASS.

- [ ] **Step 7: Verify and commit**

```bash
bun test
bun build --no-bundle extension/features/lista-agenda/lista-agenda.js > /dev/null
bash scripts/check-privacy.sh
git add extension/features/lista-agenda/lista-agenda.js tests/lista-agenda.test.js
git commit -m "feat: add a two-week zona calendar to the agenda export"
```

---

### Task 6: Live verification (human)

**Files:** none.

The unit tests cover every pure function; none proves the rendering is usable or that the live data matches. This task is performed by a human with a browser — the controller cannot do it.

- [ ] **Step 1: Reload and export**

Reload at `chrome://extensions`, open a Lista de Endereços, click **AGENDA PRO**, accept the prompt, open the downloaded file.

- [ ] **Step 2: Check the three additions**

- **Maps links:** addresses are clickable and open the right location; rows without coordinates are plain text, not dead links.
- **Tipo de Entrevista:** the column populates. If every row shows `—`, check the panel for a `colunasNaoEncontradas` message — the live label may differ from `'Tipo de Entrevista'`.
- **Calendar:** shows the coming two weeks; free slots start at the prazo mínimo (+3 days, +4 on Friday); **filled slots in the next 3 days are still visible**; off-mark starts (e.g. 09:15) show their real time.

- [ ] **Step 3: Check the still-open questions from the previous round**

- Does the Último Movimento report have more than one column headed exactly `Data`? `findIndex` takes the leftmost silently.
- Is `controle.slice(0, 2)` the right UF? A wrong UF returns a valid EMPTY response, which renders as "0 free slots" rather than an error.

- [ ] **Step 4: Commit any fixes**

If nothing needed fixing, note that instead of committing.

---

## Self-Review

**Spec coverage:** maps link from existing lat/lon columns (T2), plain text without coordinates (T2), Tipo de Entrevista from the already-fetched response (T3), `colunasNaoEncontradas` on a missing Tipo column (T3), calendar with no new fetch (T4), `end` retained at the parse boundary (T4), today→+14 window (T4), free slots gated by the prazo (T4), **filled slots kept inside the prazo** (T4), single zona (T4/T5), two states (T5), half-hour marks with real start times (T5), placement above the table (T5), `toMin`/`fmtMin` shared (T1), `gmapsRouteUrl` and F5 helpers deliberately NOT shared (T2 comment), tightened self-contained assertion (T2). All covered.

**Placeholders:** none. Task 5 step 4 asks the implementer to match the existing `<style>` conventions rather than dictating CSS values — a style-matching instruction, not a TBD.

**Type consistency:** `slotsDaJanela` emits `{isoDate, horaInicio, horaFim, aberto, controle, domicilio}`; `buildCalendarioHtml` consumes exactly those names. `mapsUrl(lat, lon)` returns `''` (never null), and `buildDomiciliosTable` branches on truthiness. `domicilios` objects gain `lat`/`lon` (T2) and `tipo` (T3), both produced in `anotar` and consumed in `buildDomiciliosTable`. `toMin` returns `number | null` and every caller branches on null.

**Verified while writing:** the two `toMin` copies are byte-identical in body (so T1's move is behaviour-preserving, and both features' existing suites will prove it); `parseCoord` is already exported; the live Último Movimento header was captured from the browser on 2026-07-31; the current self-contained test lives at `tests/lista-agenda.test.js:543-546`.
