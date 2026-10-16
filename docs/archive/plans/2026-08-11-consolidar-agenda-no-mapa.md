# Consolidar AGENDA PRO no Mapa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Último Movimento the single home for the agenda/coordinate join — a Domicílios tab, agendamentos in map popups, and real open-slot lists per zona — then retire AGENDA PRO from Lista de Endereços.

**Architecture:** The pure agenda helpers move out of `lista-agenda.js` into `agenda-lookups.js` (already fetch-sanctioned and already the home of the `controle|domicilio` join). `ultimo-movimento-map.js` keeps issuing zero network calls itself, delegating to `agenda-lookups.js` exactly as it does today for coordinates. Coordinate traffic goes DOWN: `fetchEnderecosByAgencia` gains a `uf|agencia` cache, and the whole-state case never fetches at all.

**Tech Stack:** Vanilla ES2020 browser JS, no build step. Tests: `bun test` (happy-dom). Syntax check: `bun build --no-bundle <file>`. No framework, no bundler, no TypeScript.

## Global Constraints

- **Zero storage.** All caches in-memory only, never `localStorage`/`sessionStorage`/`chrome.storage`. Verbatim from the codebase: "In-memory only, never persisted (zero-storage guarantee)."
- **Privacy gate must stay CLEAN.** Run `./scripts/check-privacy.sh` before every commit. `FETCH_DIRS` currently sanctions network calls ONLY in `extension/common`, `extension/features/agenda-lookups`, `extension/features/ultimo-movimento-export`, `extension/features/lista-agenda`. **`ultimo-movimento-map/` is NOT fetch-sanctioned** — it must never contain a `fetch(`. All new network code goes in `agenda-lookups.js`.
- **No coordinate ever leaves the IBGE origin.** No third-party query may be constructed from lat/lon; Google Maps links are user-clicked `href`s only, built via the existing `gmapsPontoUrl` / `gmapsDestinoUrl`.
- **Agenda cache TTL is 5 minutes**, unlike the coordinate cache which has none. Verbatim reason from `lista-agenda.js`: "someone else booking a slot makes these counts wrong within a page's life." `TTL_MS = 5 * 60 * 1000`.
- **Buttons stay VISIBLE.** Verbatim from `lista-agenda.js`: "an absent button is indistinguishable from a broken extension, a mistake already made once in this project." Disabled + Portuguese tooltip instead.
- **Portuguese** for every user-facing string (buttons, tooltips, consent, alerts, table headers).
- Run `bun test` after every code change. All tests must pass before commit.

---

### Task 1: Cache `fetchEnderecosByAgencia` by `uf|agencia`

**Files:**
- Modify: `extension/features/agenda-lookups/agenda-lookups.js:400-410`
- Test: `tests/agenda-lookups.test.js`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: `fetchEnderecosByAgencia(uf, agencia)` — unchanged signature, now returns a cached `Map("controle|domicilio" -> {lat, lon, zona, idZona})` on repeat calls within the page lifetime. Adds `resetEnderecosAgenciaCache()` to `window.__sigcProAgendaLookups` as a test-only seam.

Today the function carries the comment "Deliberately NOT cached … The call happens once per Mapa click." That premise dies once the panel has three tabs and can be reopened. Cache it.

- [ ] **Step 1: Write the failing test**

Add to `tests/agenda-lookups.test.js`:

```js
describe('fetchEnderecosByAgencia caching', () => {
  test('a second call for the same uf|agencia does not refetch', async () => {
    const AM = window.__sigcProAgendaLookups;
    AM.resetEnderecosAgenciaCache();
    let calls = 0;
    const original = window.__sigcPro.fetchViaGateway;
    window.__sigcPro.fetchViaGateway = async () => {
      calls += 1;
      return { ok: true, status: 200, text: async () => '<table id="tableRelatorio"></table>' };
    };
    try {
      await AM.fetchEnderecosByAgencia('29', 'AG1');
      await AM.fetchEnderecosByAgencia('29', 'AG1');
      expect(calls).toBe(1);
    } finally {
      window.__sigcPro.fetchViaGateway = original;
    }
  });

  test('a different agência is fetched separately', async () => {
    const AM = window.__sigcProAgendaLookups;
    AM.resetEnderecosAgenciaCache();
    let calls = 0;
    const original = window.__sigcPro.fetchViaGateway;
    window.__sigcPro.fetchViaGateway = async () => {
      calls += 1;
      return { ok: true, status: 200, text: async () => '<table id="tableRelatorio"></table>' };
    };
    try {
      await AM.fetchEnderecosByAgencia('29', 'AG1');
      await AM.fetchEnderecosByAgencia('29', 'AG2');
      expect(calls).toBe(2);
    } finally {
      window.__sigcPro.fetchViaGateway = original;
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/agenda-lookups.test.js`
Expected: FAIL — `AM.resetEnderecosAgenciaCache is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `agenda-lookups.js`, replace the `fetchEnderecosByAgencia` body and its "Deliberately NOT cached" paragraph:

```js
  // ONE Lista de Endereços call covering an entire agência, keyed the
  // same "controle|domicilio" way fetchEnderecos' per-Controle results
  // are — the caller joins them identically either way.
  //
  // Cached by uf|agencia for the page's lifetime (in-memory only). The
  // previous "deliberately not cached, it happens once per Mapa click"
  // reasoning stopped holding when the Mapa panel gained tabs that can
  // be reopened and re-rendered: without this, every reopen re-downloaded
  // an entire agência's addresses.
  //
  // No TTL, matching enderecosCache: coordinates do not go stale within
  // a page's life the way free-slot counts do.
  const enderecosAgenciaCache = new Map();

  function resetEnderecosAgenciaCache() {
    enderecosAgenciaCache.clear();
  }

  function fetchEnderecosByAgencia(uf, agencia) {
    const chave = `${uf}|${agencia}`;
    const hit = enderecosAgenciaCache.get(chave);
    if (hit) return hit;
    const p = postRelatorio({
      slug: 'ListaEnderecos',
      body: filtroBody(uf, '*', 'ListaEnderecos', agencia),
      parse: parseEnderecosHtml,
    }).catch((err) => {
      // A failed fetch must not poison the cache — the next click retries.
      enderecosAgenciaCache.delete(chave);
      throw err;
    });
    enderecosAgenciaCache.set(chave, p);
    return p;
  }
```

Add `resetEnderecosAgenciaCache` to the `window.__sigcProAgendaLookups` export object at the end of the file.

- [ ] **Step 4: Run tests**

Run: `bun test` and `bun build --no-bundle extension/features/agenda-lookups/agenda-lookups.js`
Expected: all PASS, SYNTAX OK.

- [ ] **Step 5: Commit**

```bash
./scripts/check-privacy.sh
git add extension/features/agenda-lookups/agenda-lookups.js tests/agenda-lookups.test.js
git commit -m "perf: cache the agência-wide Lista de Endereços fetch"
```

---

### Task 2: MAPA PRO visible-but-disabled outside a single agência

**Files:**
- Modify: `extension/features/ultimo-movimento-map/ultimo-movimento-map.js:927-947` (the `when:`/`build:` block)
- Test: `tests/ultimo-movimento-map.test.js`

**Interfaces:**
- Consumes: `filteredAgencia()` (existing, unchanged)
- Produces: `atualizarEstadoBotaoMapa()` — reads `filteredAgencia()` and sets `btn.disabled` + `btn.title`; exported on `window.__sigcProUltimoMovimentoMapInternals`. Constants `TITLE_MAPA_ATIVO` and `TITLE_MAPA_SEM_AGENCIA`.

Today `when:` returns `hasTable && !!filteredAgencia()`, so on a whole-state report the button VANISHES. Mount on `hasTable` alone and express the agência requirement as disabled state, matching the convention in `lista-agenda.js`.

- [ ] **Step 1: Write the failing test**

Add to `tests/ultimo-movimento-map.test.js`:

```js
describe('MAPA PRO button state', () => {
  test('disabled with an explanatory tooltip when no single agência is filtered', () => {
    const I = window.__sigcProUltimoMovimentoMapInternals;
    I.resetFilteredAgencia();
    const btn = document.createElement('button');
    btn.id = 'sigc-pro-ultimo-movimento-map-btn';
    document.body.appendChild(btn);
    try {
      I.atualizarEstadoBotaoMapa();
      expect(btn.disabled).toBe(true);
      expect(btn.title).toContain('agência');
    } finally {
      btn.remove();
    }
  });

  test('enabled once a single agência is filtered', () => {
    const I = window.__sigcProUltimoMovimentoMapInternals;
    I.resetFilteredAgencia();
    const sel = document.createElement('select');
    sel.id = 'IdAgencia';
    const opt = document.createElement('option');
    opt.value = 'AG1';
    sel.appendChild(opt);
    sel.value = 'AG1';
    document.body.appendChild(sel);
    const btn = document.createElement('button');
    btn.id = 'sigc-pro-ultimo-movimento-map-btn';
    document.body.appendChild(btn);
    try {
      I.captureFilteredAgencia();
      I.atualizarEstadoBotaoMapa();
      expect(btn.disabled).toBe(false);
    } finally {
      btn.remove();
      sel.remove();
    }
  });
});
```

Note: confirm the real `BUTTON_ID` constant value at the top of `ultimo-movimento-map.js` and use it verbatim in both tests.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/ultimo-movimento-map.test.js`
Expected: FAIL — `I.atualizarEstadoBotaoMapa is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add near the other button code in `ultimo-movimento-map.js`:

```js
  const TITLE_MAPA_ATIVO = 'Mapa de domicílios por zona (SIGC-PRO)';
  const TITLE_MAPA_SEM_AGENCIA =
    'Filtre por uma agência (e clique em Filtrar) para ver o mapa — ' +
    'um relatório de estado inteiro é grande demais para buscar coordenadas.';

  // Button stays VISIBLE either way — an absent button is
  // indistinguishable from a broken extension, the same rule
  // lista-agenda.js states. Now that Último Movimento is the only home
  // for this feature, "the button disappeared" is a worse failure than
  // it was when Lista de Endereços still carried AGENDA PRO.
  function atualizarEstadoBotaoMapa() {
    const btn = document.getElementById(BUTTON_ID);
    if (!btn) return;
    const ok = !!filteredAgencia();
    btn.disabled = !ok;
    btn.title = ok ? TITLE_MAPA_ATIVO : TITLE_MAPA_SEM_AGENCIA;
  }
```

Change `when:` to mount on the table alone and refresh state each tick:

```js
    when: () => {
      if (!onUltimoMovimento()) return false;
      bindFiltrarCapture();
      const hasTable = !!window.__sigcPro.getDataTable();
      adoptRenderedAgencia(hasTable);
      if (hasTable) atualizarEstadoBotaoMapa();
      return hasTable;
    },
```

In `build:`, set the initial title from the same helper — change `title: 'Mapa de domicílios por zona (SIGC-PRO)'` to `title: TITLE_MAPA_ATIVO`, and call `atualizarEstadoBotaoMapa()` on the created button before returning it. Add `atualizarEstadoBotaoMapa` to `window.__sigcProUltimoMovimentoMapInternals`.

Also update the stale block comment above `when:` that says the button "stays absent there rather than appearing and refusing on click" — it now describes the opposite behavior.

- [ ] **Step 4: Run tests**

Run: `bun test` and `bun build --no-bundle extension/features/ultimo-movimento-map/ultimo-movimento-map.js`
Expected: all PASS, SYNTAX OK. Existing gate tests asserting the button is ABSENT on a TODOS report will now fail — update them to assert `disabled === true` instead, since that is the intended behavior change.

- [ ] **Step 5: Commit**

```bash
./scripts/check-privacy.sh
git add extension/features/ultimo-movimento-map/ultimo-movimento-map.js tests/ultimo-movimento-map.test.js
git commit -m "fix: keep MAPA PRO visible and disabled outside a single agência"
```

---

### Task 3: Move the pure agenda helpers into `agenda-lookups.js`

**Files:**
- Modify: `extension/features/agenda-lookups/agenda-lookups.js` (add the helpers + the agenda fetch)
- Modify: `extension/features/lista-agenda/lista-agenda.js` (delete the moved copies, consume from the new home)
- Test: `tests/agenda-lookups.test.js`

**Interfaces:**
- Consumes: Task 1's module.
- Produces, all on `window.__sigcProAgendaLookups`:
  - `parseSlots(json) -> [{start, isoDate, controle, domicilio, zonas, aberto}]`
  - `zonaIdOf(entry) -> string`
  - `indexByControle(slots) -> Map("controle|domicilio" -> slot[])`
  - `pickAgendado(slots, todayIso) -> {data, hora, ordenavel, futura} | null`
  - `fmtAgendado(data, hora) -> string`
  - `slotsLivresDaJanela(slots, zonaId, minDateIso, fimIso) -> [{isoDate, hora}]`
  - `agruparPorDia(livres) -> [{isoDate, horas}]`
  - `buildSlotsLivresHtml(grupos) -> string`
  - `fetchAgendaSlots(uf, startIso, endIso) -> Promise<{dados, em, cache}>` — the cached wrapper, TTL 5 min, keyed `uf|startIso|endIso`
  - `resetAgendaCache()` — test-only seam

Move, do not rewrite. These functions are already pure and already tested; copy them verbatim, then delete the originals. The network call MUST live here, not in `ultimo-movimento-map/` (not fetch-sanctioned).

- [ ] **Step 1: Write the failing test**

Add to `tests/agenda-lookups.test.js`:

```js
describe('agenda helpers moved from lista-agenda', () => {
  const AM = () => window.__sigcProAgendaLookups;

  test('parseSlots keeps only the sanctioned fields', () => {
    const [s] = AM().parseSlots([{
      start: '2026-08-10T09:00:00',
      title: 'Zonas: 29JDM8 - x\nControle: 292740805060337\nDomicílio: 1\nTelefone: 71 99999-0000',
    }]);
    expect(Object.keys(s).sort())
      .toEqual(['aberto', 'controle', 'domicilio', 'isoDate', 'start', 'zonas'].sort());
    expect(JSON.stringify(s)).not.toContain('71 99999-0000');
  });

  test('pickAgendado prefers the next future visit', () => {
    const slots = [
      { start: '2026-07-01T09:00:00', isoDate: '2026-07-01' },
      { start: '2026-09-01T09:00:00', isoDate: '2026-09-01' },
    ];
    const r = AM().pickAgendado(slots, '2026-08-01');
    expect(r.futura).toBe(true);
    expect(r.ordenavel).toBe('2026-09-01T09:00:00');
  });

  test('slotsLivresDaJanela + agruparPorDia list open slots by day', () => {
    const slots = [
      { aberto: true, isoDate: '2026-08-12', start: '2026-08-12T09:00:00', zonas: '29JDM8 - x' },
      { aberto: true, isoDate: '2026-08-12', start: '2026-08-12T14:00:00', zonas: '29JDM8 - x' },
      { aberto: false, isoDate: '2026-08-12', start: '2026-08-12T10:00:00', zonas: '29JDM8 - x' },
    ];
    const livres = AM().slotsLivresDaJanela(slots, '29JDM8', '2026-08-01', '2026-08-31');
    expect(livres).toHaveLength(2);
    const grupos = AM().agruparPorDia(livres);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].horas).toEqual(['09:00', '14:00']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/agenda-lookups.test.js`
Expected: FAIL — `AM().parseSlots is not a function`.

- [ ] **Step 3: Move the code**

From `lista-agenda.js`, move VERBATIM (keeping their comments) into `agenda-lookups.js`: `parseSlots`, `zonaIdOf`, `chaveDomicilio`, `indexByControle`, `pickAgendado`, `fmtAgendado`, `horaDoStart`, `horaDeIso`, `slotsLivresDaJanela`, `agruparPorDia`, `buildSlotsLivresHtml`, `TARDE_FROM_MIN`, and `indexZonaLivres`.

Move `fetchAgenda` (lista-agenda.js:526) verbatim, renaming it `fetchAgendaSlots`, together with the `doCache`/`TTL_MS`/`fetchLabel` machinery it needs — keep the 5-minute TTL and its comment ("someone else booking a slot makes these counts wrong within a page's life"), which is the reason this cache differs from the coordinate one.

Add every name in the Interfaces block to the `window.__sigcProAgendaLookups` export object.

In `lista-agenda.js`, delete the moved definitions and reference them through `window.__sigcProAgendaLookups` so the file keeps working until Task 6 removes it. Its own exports on `window.__sigcPro.listaAgenda` must keep the same names so `tests/lista-agenda.test.js` still passes.

Manifest load order: `agenda-lookups.js` currently loads AFTER `lista-agenda.js`. Since these are function references resolved at call time (not load time), no reorder is required — but if any moved constant is read at module scope, move `agenda-lookups.js` earlier in `manifest.json` and update `tests/manifest-load-order.test.js`.

- [ ] **Step 4: Run tests**

Run: `bun test`, plus `bun build --no-bundle` on both changed files.
Expected: all PASS (both the new tests and the whole existing `lista-agenda.test.js` suite, unchanged).

- [ ] **Step 5: Commit**

```bash
./scripts/check-privacy.sh
git add extension/features/agenda-lookups/agenda-lookups.js extension/features/lista-agenda/lista-agenda.js tests/agenda-lookups.test.js
git commit -m "refactor: move the pure agenda helpers into agenda-lookups"
```

---

### Task 4: Fetch the agenda on Mapa click and join it

**Files:**
- Modify: `extension/features/ultimo-movimento-map/ultimo-movimento-map.js` (`onMapaClick`, `FETCH_CONSENT_MSG`, `joinEnderecos`)
- Test: `tests/ultimo-movimento-map.test.js`

**Interfaces:**
- Consumes: `fetchAgendaSlots`, `parseSlots`, `indexByControle`, `pickAgendado`, `fmtAgendado` from Task 3.
- Produces: `joinAgenda(joined, agendaIdx, todayIso) -> rows` — each row gains `agendado` (`'dd/mm/yyyy HH:MM'` or `''`), `agendadoOrdenavel` (raw ISO or `''`), `futura` (boolean). Exported on `window.__sigcProUltimoMovimentoMapInternals`.

Per the spec: UF-wide, current calendar year, filtered client-side. Past agendamentos are the point on a "último movimento" screen, so the window must not be narrowed.

- [ ] **Step 1: Write the failing test**

```js
describe('joinAgenda', () => {
  test('attaches the chosen agendamento to the matching household', () => {
    const I = window.__sigcProUltimoMovimentoMapInternals;
    const joined = [{ controle: 'C1', domicilio: '1' }, { controle: 'C1', domicilio: '2' }];
    const agendaIdx = new Map([
      ['C1|1', [{ start: '2026-09-01T09:00:00', isoDate: '2026-09-01' }]],
    ]);
    const rows = I.joinAgenda(joined, agendaIdx, '2026-08-11');
    expect(rows[0].agendado).toBe('01/09/2026 09:00');
    expect(rows[0].futura).toBe(true);
    expect(rows[0].agendadoOrdenavel).toBe('2026-09-01T09:00:00');
    expect(rows[1].agendado).toBe('');
  });

  test('a past visit is kept and flagged not futura', () => {
    const I = window.__sigcProUltimoMovimentoMapInternals;
    const joined = [{ controle: 'C1', domicilio: '1' }];
    const agendaIdx = new Map([
      ['C1|1', [{ start: '2026-07-01T14:30:00', isoDate: '2026-07-01' }]],
    ]);
    const rows = I.joinAgenda(joined, agendaIdx, '2026-08-11');
    expect(rows[0].agendado).toBe('01/07/2026 14:30');
    expect(rows[0].futura).toBe(false);
  });

  test('an empty agenda index leaves every row blank, never undefined', () => {
    const I = window.__sigcProUltimoMovimentoMapInternals;
    const rows = I.joinAgenda([{ controle: 'C1', domicilio: '1' }], new Map(), '2026-08-11');
    expect(rows[0].agendado).toBe('');
    expect(rows[0].agendadoOrdenavel).toBe('');
    expect(rows[0].futura).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/ultimo-movimento-map.test.js`
Expected: FAIL — `I.joinAgenda is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
  // Agenda rows joined onto the already-coordinate-joined households, on
  // the same controle|domicilio key. Empty strings (never undefined) so
  // the renderers can write cells without guarding — the convention
  // lista-agenda.js's annotateRow established.
  function joinAgenda(joined, agendaIdx, todayIso) {
    const AM = window.__sigcProAgendaLookups;
    return (joined || []).map((r) => {
      const slots = (agendaIdx && agendaIdx.get(`${r.controle}|${r.domicilio}`)) || [];
      const ag = AM.pickAgendado(slots, todayIso);
      return {
        ...r,
        agendado: ag ? AM.fmtAgendado(ag.data, ag.hora) : '',
        agendadoOrdenavel: ag ? ag.ordenavel : '',
        futura: ag ? ag.futura : false,
      };
    });
  }
```

In `onMapaClick`, after the coordinate fetch, fetch the agenda for the current year and build the index:

```js
      const ano = new Date().getFullYear();
      const agenda = await AM.fetchAgendaSlots(
        uf, `${ano}-01-01T00:00:00`, `${ano + 1}-01-01T00:00:00`);
      const agendaIdx = AM.indexByControle(agenda.dados);
      const todayIso = new Date().toISOString().slice(0, 10);
      const comAgenda = joinAgenda(joined, agendaIdx, todayIso);
```

Pass `comAgenda` (not `joined`) to the panel builder and the map renderer.

A failed agenda fetch must NOT cost the map: wrap it so a rejection logs a warning and falls back to an empty index, leaving every `agendado` blank. The coordinate join is the feature's core; the agenda is an enrichment.

Update `FETCH_CONSENT_MSG` to name both purposes, per the spec's single-prompt decision:

```js
  const FETCH_CONSENT_MSG =
    'SIGC-PRO: isto fará duas consultas ao próprio servidor do SIGC — a ' +
    'Lista de Endereços (coordenadas e zona) da agência filtrada e a ' +
    'agenda da UF. Nenhum dado sai do IBGE. Continuar?';
```

Delete the now-wrong "Says 'uma consulta', singular, because that is now literally true" comment above it.

- [ ] **Step 4: Run tests**

Run: `bun test`, `bun build --no-bundle extension/features/ultimo-movimento-map/ultimo-movimento-map.js`, `./scripts/check-privacy.sh`
Expected: all PASS, SYNTAX OK, privacy gate CLEAN (no `fetch(` added to this file — the call goes through `agenda-lookups`).

- [ ] **Step 5: Commit**

```bash
git add extension/features/ultimo-movimento-map/ultimo-movimento-map.js tests/ultimo-movimento-map.test.js
git commit -m "feat: join agenda data into the Último Movimento map"
```

---

### Task 5a: Every zona in the agência, with agendamento stats

**Files:**
- Modify: `extension/features/ultimo-movimento-map/ultimo-movimento-map.js:107-127` (`aggregateZonas`)
- Test: `tests/ultimo-movimento-map.test.js`

**Interfaces:**
- Consumes: `joinAgenda` rows from Task 4; the endereços `Map` from Task 1.
- Produces: `aggregateZonas(joined, enderecosMap)` — second parameter is new. Each returned bucket gains `agendados` and `semAgendamento` (integers) alongside the existing `realizada`/`naoIniciada`/`domicilioFechado`/`recusa`/`outros`/`totalDomicilios`/`semCoordenadas`.

Today `aggregateZonas` iterates only `joined`, so a zona with coordinates but no movimento rows never gets a bucket — precisely the zona worth seeing (nothing collected, slots presumably open). Seed buckets from the agência-complete endereços map first, then fill from movimento rows.

Denominator is selecionados throughout: the Lista de Endereços response is already selecionados-only (see the comment at `agenda-lookups.js:91`), so no extra filtering is needed — just don't claim otherwise in labels.

- [ ] **Step 1: Write the failing test**

```js
describe('aggregateZonas coverage and agenda stats', () => {
  test('a zona with coordinates but no movimento rows still appears, with zeros', () => {
    const I = window.__sigcProUltimoMovimentoMapInternals;
    const enderecos = new Map([
      ['C1|1', { lat: -12.9, lon: -38.5, zona: '29JDM8 - x', idZona: '29JDM8' }],
      ['C9|1', { lat: -12.8, lon: -38.4, zona: '29LR9E - y', idZona: '29LR9E' }],
    ]);
    const joined = [{
      controle: 'C1', domicilio: '1', idZona: '29JDM8', zona: '29JDM8 - x',
      temZona: true, temCoordenadas: true, tipoEntrevista: 'REALIZADA', agendado: '',
    }];
    const rows = I.aggregateZonas(joined, enderecos);
    const ids = rows.map((r) => r.idZona).sort();
    expect(ids).toContain('29LR9E');
    const vazia = rows.find((r) => r.idZona === '29LR9E');
    expect(vazia.totalDomicilios).toBe(0);
    expect(vazia.realizada).toBe(0);
  });

  test('counts agendados and semAgendamento per zona', () => {
    const I = window.__sigcProUltimoMovimentoMapInternals;
    const enderecos = new Map([
      ['C1|1', { lat: -12.9, lon: -38.5, zona: '29JDM8 - x', idZona: '29JDM8' }],
      ['C1|2', { lat: -12.9, lon: -38.5, zona: '29JDM8 - x', idZona: '29JDM8' }],
    ]);
    const joined = [
      { controle: 'C1', domicilio: '1', idZona: '29JDM8', zona: '29JDM8 - x',
        temZona: true, temCoordenadas: true, tipoEntrevista: 'REALIZADA',
        agendado: '01/09/2026 09:00' },
      { controle: 'C1', domicilio: '2', idZona: '29JDM8', zona: '29JDM8 - x',
        temZona: true, temCoordenadas: true, tipoEntrevista: 'REALIZADA', agendado: '' },
    ];
    const z = I.aggregateZonas(joined, enderecos).find((r) => r.idZona === '29JDM8');
    expect(z.agendados).toBe(1);
    expect(z.semAgendamento).toBe(1);
  });
});
```

Read the real `joined` row shape from `joinEnderecos` before finalizing these fixtures and use its actual property names.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/ultimo-movimento-map.test.js`
Expected: FAIL — `29LR9E` missing, and `agendados` undefined.

- [ ] **Step 3: Implement**

Seed from `enderecosMap` before folding in `joined`:

```js
  // Seeded from the endereços map, NOT only from the movimento rows: the
  // coordinate fetch is agência-complete, so a zona where nothing has been
  // collected yet has addresses but no movimento rows. Iterating `joined`
  // alone silently dropped exactly the zonas most worth looking at.
  function aggregateZonas(joined, enderecosMap) {
    const byZona = new Map();
    const SEM_ZONA_KEY = '__SEM_ZONA__';
    const novoBucket = (idZona, nomeZona) => ({
      idZona, nomeZona,
      realizada: 0, naoIniciada: 0, domicilioFechado: 0, recusa: 0, outros: 0,
      totalDomicilios: 0, semCoordenadas: 0, agendados: 0, semAgendamento: 0,
    });

    (enderecosMap || new Map()).forEach((info) => {
      const id = info && info.idZona;
      if (!id) return;
      if (!byZona.has(id)) byZona.set(id, novoBucket(id, info.zona || id));
    });

    (joined || []).forEach((r) => {
      const key = r.temZona ? r.idZona : SEM_ZONA_KEY;
      if (!byZona.has(key)) {
        byZona.set(key, novoBucket(r.temZona ? r.idZona : null,
          r.temZona ? r.zona : 'Sem zona'));
      }
      const bucket = byZona.get(key);
      const coluna = TIPO_COLUNA[r.tipoEntrevista] || 'outros';
      bucket[coluna] += 1;
      bucket.totalDomicilios += 1;
      if (!r.temCoordenadas) bucket.semCoordenadas += 1;
      if (r.agendado) bucket.agendados += 1;
      else bucket.semAgendamento += 1;
    });

    return Array.from(byZona.values());
  }
```

Update the `aggregateZonas(joined)` call site in `onMapaClick` to pass the endereços map, and make sure it receives the `joinAgenda` output (which carries `agendado`) rather than the pre-agenda rows.

- [ ] **Step 4: Run tests**

Run: `bun test`, `bun build --no-bundle extension/features/ultimo-movimento-map/ultimo-movimento-map.js`
Expected: all PASS. Existing `aggregateZonas` tests calling it with one argument need the second — pass `new Map()` where the test doesn't care about seeding.

- [ ] **Step 5: Commit**

```bash
./scripts/check-privacy.sh
git add extension/features/ultimo-movimento-map/ultimo-movimento-map.js tests/ultimo-movimento-map.test.js
git commit -m "feat: cover every agência zona and count agendamentos per zona"
```

---

### Task 5: Three surfaces — popup, Zonas expansion, Domicílios tab

**Files:**
- Modify: `extension/features/ultimo-movimento-map/ultimo-movimento-map.js` (`buildPanelHtml`, `buildZonasTableHtml`, the marker popup block ~line 552, the panel CSS block ~line 213)
- Test: `tests/ultimo-movimento-map.test.js`

**Interfaces:**
- Consumes: `joinAgenda` rows from Task 4; `slotsLivresDaJanela`/`agruparPorDia`/`buildSlotsLivresHtml` from Task 3.
- Produces: `buildDomiciliosTabHtml(rows) -> string` (a `<table class="sigc-pro-domicilios-table">` with a `<thead>` of Endereço, Domicílio, Agendado, Situação, Tipo, Entrevistador, Data). `buildPanelHtml(joined, zonaRows, slotsPorZona)` gains a third parameter: `Map(idZona -> [{isoDate, horas}])`.

- [ ] **Step 1: Write the failing tests**

```js
describe('agendamento in the marker popup', () => {
  test('the popup shows Agendado when one exists', () => {
    const I = window.__sigcProUltimoMovimentoMapInternals;
    const html = I.buildPopupHtml({
      controle: 'C1', domicilio: '1', entrevistador: 'MARIA',
      tipoEntrevista: 'PRESENCIAL', idZona: '29JDM8',
      lat: -12.9, lon: -38.5, agendado: '01/09/2026 09:00', futura: true,
    });
    expect(html).toContain('Agendado');
    expect(html).toContain('01/09/2026 09:00');
  });

  test('the popup omits the Agendado line entirely when there is none', () => {
    const I = window.__sigcProUltimoMovimentoMapInternals;
    const html = I.buildPopupHtml({
      controle: 'C1', domicilio: '1', entrevistador: 'MARIA',
      tipoEntrevista: 'PRESENCIAL', idZona: '29JDM8',
      lat: -12.9, lon: -38.5, agendado: '', futura: false,
    });
    expect(html).not.toContain('Agendado');
  });
});

describe('buildDomiciliosTabHtml', () => {
  test('renders one row per household with every column', () => {
    const I = window.__sigcProUltimoMovimentoMapInternals;
    const html = I.buildDomiciliosTabHtml([{
      endereco: 'R X, Nº 1', domicilio: '1', agendado: '01/09/2026 09:00',
      ultimaPosicao: 'TRANSMITIDO', tipoEntrevista: 'PRESENCIAL',
      entrevistador: 'MARIA', data: '28/07/2026',
    }]);
    expect(html).toContain('Entrevistador');
    expect(html).toContain('MARIA');
    expect(html).toContain('R X, Nº 1');
  });

  test('missing values render as —', () => {
    const I = window.__sigcProUltimoMovimentoMapInternals;
    const html = I.buildDomiciliosTabHtml([{
      endereco: '', domicilio: '2', agendado: '', ultimaPosicao: '',
      tipoEntrevista: '', entrevistador: '', data: '',
    }]);
    expect((html.match(/—/g) || []).length).toBeGreaterThanOrEqual(5);
  });

  test('escapes HTML in every field', () => {
    const I = window.__sigcProUltimoMovimentoMapInternals;
    const html = I.buildDomiciliosTabHtml([{
      endereco: '<img src=x onerror=alert(1)>', domicilio: '1', agendado: '',
      ultimaPosicao: '', tipoEntrevista: '', entrevistador: '', data: '',
    }]);
    expect(html).not.toContain('<img');
  });
});

describe('open slots in the Zonas tab', () => {
  test('a zona row carries its open slots', () => {
    const I = window.__sigcProUltimoMovimentoMapInternals;
    const slotsPorZona = new Map([['29JDM8', [{ isoDate: '2026-08-12', horas: ['09:00'] }]]]);
    const html = I.buildZonasTableHtml(
      [{ idZona: '29JDM8', total: 1, comCoordenadas: 1 }], slotsPorZona);
    expect(html).toContain('09:00');
  });

  test('a zona with no open slots says so', () => {
    const I = window.__sigcProUltimoMovimentoMapInternals;
    const html = I.buildZonasTableHtml(
      [{ idZona: '29JDM8', total: 1, comCoordenadas: 1 }], new Map());
    expect(html).toContain('Nenhum slot livre');
  });
});
```

Before writing these, read the real shapes: the zona-row object produced by `aggregateZonas`, and the row fields from `parseUltimoMovimentoRows` (`ultimaPosicao`, `tipoEntrevista`, `data`, `entrevistador`). Use the actual property names, not the ones guessed here, and adjust the fixtures to match.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/ultimo-movimento-map.test.js`
Expected: FAIL — `buildPopupHtml` / `buildDomiciliosTabHtml` not functions.

- [ ] **Step 3: Implement**

Extract the existing inline `marker.bindPopup(...)` string into `buildPopupHtml(r)` (pure, testable), then add the conditional line after Zona:

```js
      const agendadoLinha = r.agendado
        ? `<br>Agendado: <span class="${r.futura ? 'sigc-pro-futura' : 'sigc-pro-passada'}">` +
          `${window.__sigcPro.escapeHtml(r.agendado)}</span>`
        : '';
```

Add `buildDomiciliosTabHtml(rows)` building a `<table>` with the seven columns, `—` for empty values, every field through `window.__sigcPro.escapeHtml`. Reuse the sortable-header pattern already in the panel if one exists; otherwise plain headers are acceptable for this task.

In `buildZonasTableHtml(zonaRows, slotsPorZona)`, add a slots cell per zona rendered by `buildSlotsLivresHtml(slotsPorZona.get(idZona) || [])`. The zona NAME click keeps focusing the map (`wireZonaRowClicks`) — the expansion needs its own target (a caret cell or `<details>`), never that gesture.

Also add the two Task 5a columns to the same table — **Agendados** and **Sem agendamento** — so the row reads: zona · total · [status columns] · agendados · sem agendamento · slots livres. A zona seeded from the endereços map with no movimento rows renders zeros across the status columns; that is the intended display, not a bug to hide.

In `buildPanelHtml`, add the third tab button and panel:

```js
      `      <button type="button" class="sigc-pro-tab-btn" data-tab="domicilios">Domicílios (${joined.length})</button>`,
```

```js
      '    <div id="sigc-pro-domicilios-panel" class="sigc-pro-tab-panel">',
      `      ${buildDomiciliosTabHtml(joined)}`,
      '    </div>',
```

Compute `slotsPorZona` at the call site in `onMapaClick` from the fetched slots, using the same `minDateIso`/`fimIso` window `lista-agenda` used (today → +2 weeks) so the open-slot lists mean "bookable now".

Add CSS for `.sigc-pro-domicilios-table`, `.sigc-pro-futura` (bold green `#161`) and `.sigc-pro-passada` (grey `#777`) to the existing panel style block.

Add `buildPopupHtml` and `buildDomiciliosTabHtml` to `window.__sigcProUltimoMovimentoMapInternals`.

- [ ] **Step 4: Run tests**

Run: `bun test`, `bun build --no-bundle extension/features/ultimo-movimento-map/ultimo-movimento-map.js`, `./scripts/check-privacy.sh`
Expected: all PASS. Existing `buildPanelHtml` and `buildZonasTableHtml` tests will need their new argument — update them.

- [ ] **Step 5: Commit**

```bash
git add extension/features/ultimo-movimento-map/ultimo-movimento-map.js tests/ultimo-movimento-map.test.js
git commit -m "feat: add Domicílios tab, popup agendamentos and per-zona open slots"
```

---

### Task 6: Remove AGENDA PRO from Lista de Endereços

**Files:**
- Delete: `extension/features/lista-agenda/lista-agenda.js`
- Delete: `tests/lista-agenda.test.js`
- Modify: `extension/manifest.json` (drop the content-script entry)
- Modify: `scripts/check-privacy.sh` (drop `extension/features/lista-agenda` from `FETCH_DIRS`)
- Modify: `tests/manifest-load-order.test.js`, `README.md`, `LEIA-ME.txt`

Its own commit, so a revert is surgical.

- [ ] **Step 1: Confirm nothing else depends on it**

Run:

```bash
grep -rn "listaAgenda\|lista-agenda\|ListaAgendaInternals" extension tests README.md LEIA-ME.txt docs/index.html
```

Every remaining hit must be inside the files being deleted or the docs being edited. Anything else — especially in `ultimo-movimento-map.js` — means Task 3 left a dependency behind: move that helper to `agenda-lookups.js` before continuing.

- [ ] **Step 2: Delete and unregister**

```bash
git rm extension/features/lista-agenda/lista-agenda.js tests/lista-agenda.test.js
```

Remove `"features/lista-agenda/lista-agenda.js"` from the `js` array in `extension/manifest.json`, and drop `extension/features/lista-agenda` from `FETCH_DIRS` in `scripts/check-privacy.sh` — a directory that no longer exists must not stay sanctioned for network access.

Update `tests/manifest-load-order.test.js` for the shorter list, and remove the AGENDA PRO mentions from `README.md` (the feature list and the "Instalação" step naming the buttons) and `LEIA-ME.txt` ("Como usar").

- [ ] **Step 3: Run the full suite**

Run: `bun test` and `./scripts/check-privacy.sh`
Expected: all PASS, gate CLEAN. Test count drops by the ~130 `lista-agenda` tests — expected, since the feature is gone.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat!: retire AGENDA PRO from Lista de Endereços"
```

---

### Task 7: Manual verification against the live SIGC

No automated test covers the real portal. Before considering this done, in Chrome with the extension reloaded (`chrome://extensions` → ↻ on SIGC-PRO, then refresh the SIGC page):

- [ ] On a whole-state Último Movimento report: MAPA PRO is **visible and disabled**, tooltip names the agência requirement.
- [ ] Filter one agência → Filtrar → MAPA PRO enables.
- [ ] Click it: one consent prompt naming BOTH purposes; the map draws.
- [ ] A popup on a household with a scheduled visit shows `Agendado:`, styled future vs past; one without shows no Agendado line.
- [ ] Zonas tab: each zona expands to real open slot times; a zona with none says "Nenhum slot livre no período."
- [ ] Zonas tab lists **every zona of the agência**, including ones with no collection yet (zeros across the status columns) — not only those present in the movimento report.
- [ ] Agendados + Sem agendamento per zona sum to that zona's selecionados total.
- [ ] Domicílios tab: every household, seven columns, Entrevistador populated.
- [ ] Close and reopen the panel: **no second network request** (DevTools Network) — the Task 1 cache holds.
- [ ] Lista de Endereços: AGENDA PRO is gone; PDF-pro, KML-pro and CSV-pro still work.

Report results. Fix any failure before declaring completion.

---

## Self-Review

**Spec coverage:** Three tabs (T5), popup agendamentos (T5), per-zona open slots (T5), all-agência zona coverage + agendamento stats (T5a), agência cache (T1), no whole-state fetch (T2), no per-controle path (nowhere — correctly absent), UF-year agenda (T4), single consent (T4), visible-disabled button (T2), AGENDA PRO removal (T6). The spec's open question (a "Baixar" button in the Domicílios tab) is deliberately not planned — it was left out pending demand.

**Type consistency:** `joinAgenda` produces `agendado`/`agendadoOrdenavel`/`futura`; consumed under those names in T5's popup/table and in T5a's `agendados`/`semAgendamento` counters. `aggregateZonas` takes `(joined, enderecosMap)` from T5a onward and is called that way in `onMapaClick`; its buckets gain `agendados`/`semAgendamento`, rendered by T5's `buildZonasTableHtml`. `buildPanelHtml` gains `slotsPorZona` in T5 and is called with it in the same task. `fetchAgendaSlots` returns `{dados, em, cache}`; T4 reads `.dados`.

**Ordering note:** T5a must run after T4 (it reads `agendado`, which `joinAgenda` adds) and before T5 (which renders the columns T5a produces).

**Known risk:** T5's fixtures guess property names (`ultimaPosicao`, `tipoEntrevista`, `data`). The task says to read the real `parseUltimoMovimentoRows`/`aggregateZonas` shapes first and correct them — do that rather than trusting the fixtures.
