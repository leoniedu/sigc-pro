# Maps Links, Tipo de Entrevista and Turno Counts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google Maps links per domicílio, a Tipo de Entrevista column, and a per-turno free-slot count bounded to the next two weeks — none of which needs a new network request.

**Architecture:** Three independent additions to `extension/features/lista-agenda/lista-agenda.js`, each a pure function feeding the existing renderers. One shared-helper move (`toMin`/`fmtMin` → `sigc-common.js`) removes a duplication that would otherwise reach three copies.

**A calendar was specified and rejected before implementation** — occupied slots are already in the household table, and the real question ("free slots per turno, next 2 weeks?") is a count, not a 14-day grid. See the spec.

**Tech Stack:** Vanilla JS (IIFE modules, no build step), `bun test` + happy-dom, Chrome MV3 content scripts.

**Spec:** `docs/superpowers/specs/2026-08-01-lista-agenda-calendar-design.md`

## Global Constraints

- **No `node`.** Syntax-check with `bun build --no-bundle <file>`; run tests with `bun test`.
- **Privacy gate must pass** on every commit: `bash scripts/check-privacy.sh`. It runs as a pre-commit hook.
- **Never push.** Commit only.
- **Conventional commits**, subject under 72 chars, English.
- **No new network request.** Every field in this plan comes from data already fetched or already on screen. Adding a `fetch(` anywhere is out of scope.
- **The parse boundary is unchanged.** No new field is retained — `end` and `resourceId` stay discarded along with name, sex, birth date, address and telephone.
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
| `extension/features/lista-agenda/lista-agenda.js` (modify) | Maps links (T2), Tipo de Entrevista (T3), turno counts (T4). |
| `tests/sigc-common-helpers.test.js` (modify) | Covers the moved helpers. |
| `tests/lista-agenda.test.js` (modify) | Covers T2-T4. |

Tasks 2, 3 and 4 are independent of each other; only Task 4 depends on Task 1 (for `toMin`).

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

### Task 4: Free slots per turno, bounded to the next 2 weeks

**Files:**
- Modify: `extension/features/lista-agenda/lista-agenda.js`
- Test: `tests/lista-agenda.test.js`

**Interfaces:**
- Consumes: Task 1's `window.__sigcPro.toMin`.
- Changes: `indexZonaLivres(slots, minDateIso, fimIso)` — gains an upper
  date bound and splits its counts by turno. Cell shape becomes
  `{ manha, tarde, inteiro, peso, compartilhado }` where `manha`/`tarde`
  are whole counts and `inteiro` stays the total (`manha + tarde`).
- `buildResumoHtml` renders the split and states the window.

**A calendar was specified here and rejected before implementation.**
Occupied slots are already in the household table; the real question is
"are there free slots, per turno, in the next 2 weeks?" — a count, not a
14-day grid. See the spec's "A calendar was designed and then rejected".

**Turno boundary:** before 13:00 is Manhã, 13:00 on is Tarde — the same
cut `agenda-slots-abertos.js` uses (`TARDE_FROM_MIN = 13 * 60`). Do not
restate the arithmetic differently or the two features drift.

- [ ] **Step 1: Write the failing tests**

Append to `tests/lista-agenda.test.js`:

```javascript
describe('indexZonaLivres — turno split and 2-week window', () => {
  const LIMITE = '2026-08-04';
  const FIM = '2026-08-15';
  const Z = '29JDM8 - 29.2.01.02 29_Linus_Lauro';
  const aberto = (isoDate, hora) => parseSlots([slotJson({
    start: `${isoDate}T${hora}:00`, title: `Zonas: ${Z}`,
  })]);

  test('counts a morning slot as manha', () => {
    const idx = indexZonaLivres(aberto('2026-08-10', '09:00'), LIMITE, FIM);
    expect(idx.get('29JDM8').manha).toBe(1);
    expect(idx.get('29JDM8').tarde).toBe(0);
  });

  // 13:00 itself is Tarde — the boundary must match Slots Abertos.
  test('13:00 counts as tarde, 12:59 as manha', () => {
    const t = indexZonaLivres(aberto('2026-08-10', '13:00'), LIMITE, FIM);
    expect(t.get('29JDM8').tarde).toBe(1);
    const m = indexZonaLivres(aberto('2026-08-10', '12:59'), LIMITE, FIM);
    expect(m.get('29JDM8').manha).toBe(1);
  });

  test('manha plus tarde equals the total', () => {
    const slots = [
      ...aberto('2026-08-10', '09:00'), ...aberto('2026-08-10', '14:00'),
      ...aberto('2026-08-11', '10:00'),
    ];
    const c = indexZonaLivres(slots, LIMITE, FIM).get('29JDM8');
    expect(c.manha).toBe(2);
    expect(c.tarde).toBe(1);
    expect(c.inteiro).toBe(3);
  });

  test('excludes slots beyond the window end', () => {
    expect(indexZonaLivres(aberto('2026-08-20', '09:00'), LIMITE, FIM).size).toBe(0);
  });

  test('excludes free slots before the prazo, keeps the prazo date itself', () => {
    expect(indexZonaLivres(aberto('2026-08-02', '09:00'), LIMITE, FIM).size).toBe(0);
    expect(indexZonaLivres(aberto(LIMITE, '09:00'), LIMITE, FIM).get('29JDM8').inteiro).toBe(1);
  });

  test('a slot with no readable time counts in neither turno', () => {
    const semHora = parseSlots([slotJson({ start: '', title: `Zonas: ${Z}` })]);
    expect(indexZonaLivres(semHora, LIMITE, FIM).size).toBe(0);
  });
});

describe('buildResumoHtml — turno line', () => {
  const livres = new Map([
    ['29JDM8', { manha: 7, tarde: 5, inteiro: 12, peso: 12, compartilhado: false }],
  ]);
  const meta = { minDateBr: '04/08/2026', agendaEm: '09:31', movimentoEm: '09:31', falhas: [] };

  test('shows manha, tarde and total', () => {
    const html = buildResumoHtml(['29JDM8'], livres, meta, '');
    expect(html).toContain('7');
    expect(html).toContain('5');
    expect(html).toContain('12');
    expect(html).toMatch(/Manh/);
    expect(html).toContain('Tarde');
  });

  // Bounding the count changes a number the user has been reading, so
  // the window has to be stated or capacity looks like it vanished.
  test('states the 2-week window', () => {
    const html = buildResumoHtml(['29JDM8'], livres, meta, '');
    expect(html).toContain('04/08/2026');
    expect(html).toMatch(/2 semanas|duas semanas/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/lista-agenda.test.js`
Expected: FAIL — cells have no `manha`/`tarde`.

- [ ] **Step 3: Implement the turno split**

In `indexZonaLivres`, add the `fimIso` parameter and the turno logic:

```javascript
  // Manhã before 13:00, Tarde from 13:00 — the same cut Slots Abertos
  // uses. Shared boundary, or the two features drift.
  const TARDE_FROM_MIN = 13 * 60;

  // minDateIso: earliest bookable date (prazo mínimo).
  // fimIso: end of the 2-week horizon — a slot months out is not
  // realistically bookable, and counting it overstated capacity.
  function indexZonaLivres(slots, minDateIso, fimIso) {
    const map = new Map();
    slots.forEach((s) => {
      if (!s.aberto) return;
      if (s.isoDate && s.isoDate < minDateIso) return;
      if (fimIso && s.isoDate && s.isoDate > fimIso) return;
      const min = window.__sigcPro.toMin(horaDeIso(s.start));
      if (min == null) return;
      const turno = min < TARDE_FROM_MIN ? 'manha' : 'tarde';
      const ids = new Set(
        window.__sigcPro.parseZonaEntries(s.zonas).map(zonaIdOf).filter(Boolean));
      if (ids.size === 0) return;
      const peso = 1 / ids.size;
      ids.forEach((id) => {
        if (!map.has(id)) {
          map.set(id, { manha: 0, tarde: 0, inteiro: 0, peso: 0, compartilhado: false });
        }
        const cell = map.get(id);
        cell[turno] += 1;
        cell.inteiro += 1;
        cell.peso += peso;
        if (ids.size > 1) cell.compartilhado = true;
      });
    });
    return map;
  }
```

Add the `horaDeIso` helper if not already present:

```javascript
  const horaDeIso = (iso) => String(iso || '').slice(11, 16);
```

- [ ] **Step 4: Render the split**

In `buildResumoHtml`, change the per-zona cell from `${c.inteiro}` to a
Manhã/Tarde/Total breakdown, and extend the title line to state the
window. Keep the existing weighted-figure suppression (shown only when
`compartilhado`) and the `livresIdx === null` "?" behaviour unchanged —
both are load-bearing and separately tested.

Portuguese, matching the existing register, e.g.
`Slots livres (a partir de ${minDateBr}, próximas 2 semanas)` and
`<strong>29JDM8</strong> — Manhã: 7 Tarde: 5 Total: 12`.

- [ ] **Step 5: Pass the window bound in `anotar`**

`anotar` already computes `minDateIso`. Add the end of the horizon and
pass it through:

```javascript
    const fim = new Date();
    fim.setDate(fim.getDate() + 14);
    const fimIso = window.__sigcPro.dateToIso(fim);
    const livresIdx = ag ? indexZonaLivres(slots, minDateIso, fimIso) : null;
```

- [ ] **Step 6: Run to verify it passes**

Run: `bun test tests/lista-agenda.test.js`
Expected: PASS. Existing `indexZonaLivres` tests may need their call
updated to the new arity — update them, do NOT weaken their assertions.

- [ ] **Step 7: Verify and commit**

```bash
bun test
bun build --no-bundle extension/features/lista-agenda/lista-agenda.js > /dev/null
bash scripts/check-privacy.sh
git add extension/features/lista-agenda/lista-agenda.js tests/lista-agenda.test.js
git commit -m "feat: split free slots by turno over a 2-week window"
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
- **Turno counts:** the free-slots line shows Manhã/Tarde/Total and names the 2-week window. Sanity-check the split against the Agenda's own Semana view for the same zona — Manhã + Tarde must equal the total, and the total should be smaller than the old year-wide figure.

- [ ] **Step 3: Check the still-open questions from the previous round**

- Does the Último Movimento report have more than one column headed exactly `Data`? `findIndex` takes the leftmost silently.
- Is `controle.slice(0, 2)` the right UF? A wrong UF returns a valid EMPTY response, which renders as "0 free slots" rather than an error.

- [ ] **Step 4: Commit any fixes**

If nothing needed fixing, note that instead of committing.

---

## Self-Review

**Spec coverage:** maps link from existing lat/lon columns (T2), plain text without coordinates (T2), Tipo de Entrevista from the already-fetched response (T3), `colunasNaoEncontradas` on a missing Tipo column (T3), turno split at 13:00 matching Slots Abertos (T4), 2-week upper bound (T4), free slots still gated by the prazo (T4), window stated in the rendered line (T4), weighted-figure suppression and the `livresIdx === null` "?" behaviour preserved (T4), `toMin`/`fmtMin` shared (T1), `gmapsRouteUrl` and F5 helpers deliberately NOT shared (T2 comment), tightened self-contained assertion (T2). All covered.

The calendar the spec first proposed is deliberately absent: it was rejected before implementation (occupied slots already appear in the household table; the question is a count, not a grid; and multiple equipes per zona would need a third axis). The spec records the reasoning so it is not re-proposed.

**Placeholders:** none. Task 5 step 4 asks the implementer to match the existing `<style>` conventions rather than dictating CSS values — a style-matching instruction, not a TBD.

**Type consistency:** `indexZonaLivres` cells are `{manha, tarde, inteiro, peso, compartilhado}` in both producer and consumer, with `inteiro === manha + tarde`. `mapsUrl(lat, lon)` returns `''` (never null), and `buildDomiciliosTable` branches on truthiness. `domicilios` objects gain `lat`/`lon` (T2) and `tipo` (T3), both produced in `anotar` and consumed in `buildDomiciliosTable`. `toMin` returns `number | null` and every caller branches on null.

**Verified while writing:** the two `toMin` copies are byte-identical in body (so T1's move is behaviour-preserving, and both features' existing suites will prove it); `parseCoord` is already exported; the live Último Movimento header was captured from the browser on 2026-07-31; the current self-contained test lives at `tests/lista-agenda.test.js:543-546`; `TARDE_FROM_MIN = 13 * 60` in `agenda-slots-abertos.js:47` is the turno boundary T4 must match.
