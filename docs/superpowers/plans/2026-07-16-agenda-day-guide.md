# Agenda Day Guide ("Guia do Dia") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Guia do Dia" button on the SIGC Agenda (Dia view only) that downloads a self-contained HTML day guide — a Resumo stats tab plus one tab per equipe with visit cards.

**Architecture:** New MAIN-world content script `agenda-day-guide.js` consuming `window.__sigcPro.readAgendaSlots()` (no new DOM scraping, no network). Pure helpers (grouping, stats, HTML builders) live at the top of the feature IIFE; wiring (button visibility tied to Dia view, download) at the bottom. Two tiny shared helpers (`slug`, `WEEKDAYS_PT`) move into `sigc-common.js` because a second feature now needs them.

**Tech Stack:** Vanilla ES2020 in a Chrome MV3 content script (MAIN world). `bun build --no-bundle` for syntax checks, `bun <file>` for mirror tests (node is NOT on PATH — always use bun). Spec: `docs/superpowers/specs/2026-07-16-agenda-day-guide-design.md`.

## Global Constraints

- Zero permissions / zero network / zero storage: never introduce any API matched by `scripts/check-privacy.sh` (`fetch(`, `XMLHttpRequest`, `sendBeacon`, `WebSocket`, `EventSource`, `RTCPeerConnection`, `importScripts`, `new Image`, `.src =`, `chrome.storage`, `localStorage`, `sessionStorage`, `indexedDB`, `document.cookie`, `eval(`, `new Function`, `import(`, quoted `"fetch"`).
- The generated guide file must be self-contained: inline CSS only, **no `<script>` at all** (CSS-only radio tabs), no external references of any kind.
- All dynamic values inserted into the guide HTML go through `escapeHtml`.
- UI strings in pt-BR. Em dash/`–` usage as shown in the code blocks.
- Never edit `extension/manifest.json`'s `version` — the pre-commit hook bumps it and rebuilds `dist/` zips automatically on any `extension/` change.
- Commit after each task; do NOT push (the user pushes).
- Tests are bun "mirror" tests in `/tmp` (this repo has no test framework): copies of the pure functions plus assertions. Keep each mirror byte-identical to the feature source; they are throwaway and never committed.

---

### Task 1: Move `slug()` and `WEEKDAYS_PT` into sigc-common.js

Two features will now need them (agenda-csv-export / agenda-slot-checks today, agenda-day-guide next) — same move `timestampSlug()` already made.

**Files:**
- Modify: `extension/common/sigc-common.js` (add both, export both)
- Modify: `extension/features/agenda-csv-export/agenda-csv-export.js` (drop local `slug`)
- Modify: `extension/features/agenda-slot-checks/agenda-slot-checks.js` (drop local `WEEKDAYS_PT`)

**Interfaces:**
- Produces: `window.__sigcPro.slug(s: any) -> string` (NFD-deaccented, non-alphanumerics collapsed to `-`, trimmed, lowercase) and `window.__sigcPro.WEEKDAYS_PT: string[]` (index = `Date.getDay()`, `['domingo', …, 'sábado']`).

- [ ] **Step 1: Write the failing mirror test**

Create `/tmp/sigc-slug-test.js`:

```js
// Mirror of slug() as it will exist in sigc-common.js.
function slug(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}
let fail = 0;
const eq = (got, want, label) => {
  if (got !== want) { console.log(`FAIL ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); fail++; }
};
eq(slug('São Paulo'), 'sao-paulo', 'deaccent + space');
eq(slug('12/07/2026 – 18/07/2026'), '12-07-2026-18-07-2026', 'dates + en dash');
eq(slug('  Bahia  '), 'bahia', 'trim');
eq(slug(''), '', 'empty');
console.log(fail === 0 ? 'ALL PASS' : `${fail} FAILURES`);
```

- [ ] **Step 2: Run it**

Run: `bun /tmp/sigc-slug-test.js`
Expected: `ALL PASS` (this validates the implementation you are about to move — it is copied verbatim from agenda-csv-export.js).

- [ ] **Step 3: Add both helpers to sigc-common.js**

In `extension/common/sigc-common.js`, directly after the `timestampSlug` function (after its closing `}`), insert:

```js
  // Filename-safe slug: deaccented, non-alphanumerics collapsed to "-".
  // Shared by agenda-csv-export and agenda-day-guide filename builders.
  function slug(s) {
    return String(s ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
  }

  // Index = Date.getDay(). Shared by agenda-slot-checks (alert dates) and
  // agenda-day-guide (guide header).
  const WEEKDAYS_PT = [
    'domingo', 'segunda-feira', 'terça-feira', 'quarta-feira',
    'quinta-feira', 'sexta-feira', 'sábado',
  ];
```

In the `window.__sigcPro = {` export block, add two lines after `timestampSlug,`:

```js
    slug,
    WEEKDAYS_PT,
```

- [ ] **Step 4: Consume from the two existing features**

In `extension/features/agenda-csv-export/agenda-csv-export.js`, delete the whole local `slug` function (the block starting `function slug(s) {` through its closing `}`), and change the two call sites in `agendaFileBase` from `slug(uf)` / `slug(periodo)` to `window.__sigcPro.slug(uf)` / `window.__sigcPro.slug(periodo)`.

In `extension/features/agenda-slot-checks/agenda-slot-checks.js`, delete the local `WEEKDAYS_PT` const (the array literal block) and change its one use in `formatDateLong` from `WEEKDAYS_PT[d.getDay()]` to `window.__sigcPro.WEEKDAYS_PT[d.getDay()]`.

- [ ] **Step 5: Syntax-check all three files and run the privacy gate**

Run (from repo root):
```bash
bun build --no-bundle extension/common/sigc-common.js > /dev/null && \
bun build --no-bundle extension/features/agenda-csv-export/agenda-csv-export.js > /dev/null && \
bun build --no-bundle extension/features/agenda-slot-checks/agenda-slot-checks.js > /dev/null && \
echo SYNTAX-OK && ./scripts/check-privacy.sh
```
Expected: `SYNTAX-OK` then `privacy gate: CLEAN`.

Also confirm no stale references remain:
```bash
git grep -n "function slug(" extension/features/ ; git grep -n "WEEKDAYS_PT = \[" extension/features/
```
Expected: no output from either.

- [ ] **Step 6: Commit**

```bash
git add extension/ && git commit -m "refactor: share slug() and WEEKDAYS_PT via sigc-common"
```
(The hook will bump the patch version and rebuild dist zips — expected.)

---

### Task 2: agenda-day-guide.js — grouping and stats helpers

Creates the feature file with its pure data helpers. The file is inert until Task 4 registers it in the manifest, so committing mid-feature is safe.

**Files:**
- Create: `extension/features/agenda-day-guide/agenda-day-guide.js`

**Interfaces:**
- Consumes: rows from `window.__sigcPro.readAgendaSlots()`; each row is `{ isoDate, data, equipe, resourceId, reservado, horaInicio, horaFim, controle, domicilio, nome, sexo, dtNascimento, idade, endereco, telefone, zonas, observacao }` (all strings except `reservado: boolean`), sorted by `isoDate`, then `horaInicio`, then `equipe`.
- Produces (private to the IIFE, used by Tasks 3–4):
  - `groupByEquipe(rows) -> [{ equipe: string, rows: row[] }]` sorted by equipe name; row order preserved (time order).
  - `computeStats(rows) -> { total, reservados, livres: number, ocupacaoPct: number|null, primeiro: {hora, equipe}|null, ultimo: {hora, equipe}|null, controles: string[] }` (reserved-only fields; `controles` distinct, non-empty).
  - `zonasUnion(rows) -> string[]` distinct comma-separated zona entries, first-seen order.
  - `media1(num, den) -> string|null` one decimal, pt-BR comma; `null` when `den` is 0.

- [ ] **Step 1: Write the failing mirror test**

Create `/tmp/day-guide-logic-test.js`:

```js
// Mirrors of the pure data helpers in agenda-day-guide.js.
function groupByEquipe(rows) {
  const map = new Map();
  rows.forEach((r) => {
    const k = r.equipe || '(sem equipe)';
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  });
  return [...map.keys()].sort().map((equipe) => ({ equipe, rows: map.get(equipe) }));
}

function computeStats(rows) {
  const reservados = rows.filter((r) => r.reservado);
  const total = rows.length;
  const primeiro = reservados[0] || null;
  const ultimo = reservados[reservados.length - 1] || null;
  const controles = [...new Set(reservados.map((r) => r.controle).filter(Boolean))];
  return {
    total,
    reservados: reservados.length,
    livres: total - reservados.length,
    ocupacaoPct: total > 0 ? Math.round((100 * reservados.length) / total) : null,
    primeiro: primeiro ? { hora: primeiro.horaInicio, equipe: primeiro.equipe } : null,
    ultimo: ultimo ? { hora: ultimo.horaInicio, equipe: ultimo.equipe } : null,
    controles,
  };
}

function zonasUnion(rows) {
  const set = new Set();
  rows.forEach((r) => String(r.zonas || '').split(',').map((s) => s.trim())
    .filter(Boolean).forEach((z) => set.add(z)));
  return [...set];
}

function media1(num, den) {
  return den > 0 ? (num / den).toFixed(1).replace('.', ',') : null;
}

let fail = 0;
const eq = (got, want, label) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { console.log(`FAIL ${label}: got ${g} want ${w}`); fail++; }
};

const R = (equipe, horaInicio, reservado, controle, zonas) =>
  ({ equipe, horaInicio, reservado, controle: controle || '', zonas: zonas || '' });

// grouping: sorted by equipe, row order kept
const rows = [
  R('29_B_Y_1', '08:00', true,  'C1', '29.1 29_B_Y'),
  R('29_A_X_1', '08:00', false, '',   ''),
  R('29_A_X_1', '09:00', true,  'C2', '29.2 29_A_X'),
  R('29_B_Y_1', '10:00', true,  'C1', '29.1 29_B_Y'),
];
const groups = groupByEquipe(rows);
eq(groups.map((g) => g.equipe), ['29_A_X_1', '29_B_Y_1'], 'groups sorted by equipe');
eq(groups[0].rows.map((r) => r.horaInicio), ['08:00', '09:00'], 'row order preserved');

// day stats
const day = computeStats(rows);
eq(day.total, 4, 'total');
eq(day.reservados, 3, 'reservados');
eq(day.livres, 1, 'livres');
eq(day.ocupacaoPct, 75, 'ocupacao');
eq(day.primeiro, { hora: '08:00', equipe: '29_B_Y_1' }, 'primeiro (first reserved in given order)');
eq(day.ultimo, { hora: '10:00', equipe: '29_B_Y_1' }, 'ultimo');
eq(day.controles, ['C1', 'C2'], 'distinct controles');

// no reservations edge
const empty = computeStats([R('29_A_X_1', '08:00', false)]);
eq(empty.primeiro, null, 'primeiro null when no reservations');
eq(empty.ultimo, null, 'ultimo null');
eq(empty.controles, [], 'controles empty');
eq(empty.ocupacaoPct, 0, 'ocupacao 0');
eq(computeStats([]).ocupacaoPct, null, 'ocupacao null on zero rows');

// zonas union: distinct, first-seen order, comma-split
eq(zonasUnion(rows), ['29.1 29_B_Y', '29.2 29_A_X'], 'zonas union');
eq(zonasUnion([R('e', 'h', true, '', 'a 1, b 2'), R('e', 'h', true, '', 'b 2, c 3')]),
   ['a 1', 'b 2', 'c 3'], 'union across rows');

// pt-BR averages
eq(media1(3, 2), '1,5', 'media 1 decimal comma');
eq(media1(3, 0), null, 'media null on zero denominator');

console.log(fail === 0 ? 'ALL PASS' : `${fail} FAILURES`);
```

- [ ] **Step 2: Run it**

Run: `bun /tmp/day-guide-logic-test.js`
Expected: `ALL PASS`. (Mirror-first: the assertions define the behavior; if any FAIL, fix the mirror functions until all pass, then copy exactly that code into the feature file in Step 3.)

- [ ] **Step 3: Create the feature file with the same helpers**

Create `extension/features/agenda-day-guide/agenda-day-guide.js`:

```js
// SIGC-PRO feature: "Guia do Dia" — downloads a self-contained HTML day
// guide from the Agenda's Dia view: a Resumo tab (day stats) plus one tab
// per equipe with a card per slot (reserved: endereço/morador/telefone/
// Controle/observação; open: LIVRE row). Data comes exclusively from
// window.__sigcPro.readAgendaSlots() (already-rendered FullCalendar DOM,
// no network); the file itself is inline-CSS-only with CSS radio tabs —
// no <script>, no external refs — so it opens anywhere from file:// and
// Ctrl+P on a tab prints that team's guide. Dia view only: the button is
// inserted/removed by the MutationObserver as the active view toggles.
// Spec: docs/superpowers/specs/2026-07-16-agenda-day-guide-design.md
(function () {
  'use strict';

  const TAG = '[sigc-agenda-day-guide]';
  const BUTTON_ID = 'sigc-pro-agenda-guia-button';

  // --- pure data helpers -------------------------------------------

  // rows (readAgendaSlots order) -> [{ equipe, rows }], teams sorted by
  // name, each team's rows kept in time order.
  function groupByEquipe(rows) {
    const map = new Map();
    rows.forEach((r) => {
      const k = r.equipe || '(sem equipe)';
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(r);
    });
    return [...map.keys()].sort().map((equipe) => ({ equipe, rows: map.get(equipe) }));
  }

  // Stat block for any row set (whole day or one team). Rows arrive
  // time-sorted, so first/last reserved row = primeiro/último.
  function computeStats(rows) {
    const reservados = rows.filter((r) => r.reservado);
    const total = rows.length;
    const primeiro = reservados[0] || null;
    const ultimo = reservados[reservados.length - 1] || null;
    const controles = [...new Set(reservados.map((r) => r.controle).filter(Boolean))];
    return {
      total,
      reservados: reservados.length,
      livres: total - reservados.length,
      ocupacaoPct: total > 0 ? Math.round((100 * reservados.length) / total) : null,
      primeiro: primeiro ? { hora: primeiro.horaInicio, equipe: primeiro.equipe } : null,
      ultimo: ultimo ? { hora: ultimo.horaInicio, equipe: ultimo.equipe } : null,
      controles,
    };
  }

  // Distinct comma-separated zona entries across rows, first-seen order.
  function zonasUnion(rows) {
    const set = new Set();
    rows.forEach((r) => String(r.zonas || '').split(',').map((s) => s.trim())
      .filter(Boolean).forEach((z) => set.add(z)));
    return [...set];
  }

  // One-decimal pt-BR average ("1,5"), or null when the denominator is 0.
  function media1(num, den) {
    return den > 0 ? (num / den).toFixed(1).replace('.', ',') : null;
  }
})();
```

- [ ] **Step 4: Syntax-check**

Run: `bun build --no-bundle extension/features/agenda-day-guide/agenda-day-guide.js > /dev/null && echo SYNTAX-OK`
Expected: `SYNTAX-OK`

- [ ] **Step 5: Commit**

```bash
git add extension/features/agenda-day-guide/ && \
git commit -m "feat: day guide data helpers (grouping, stats)"
```

---

### Task 3: agenda-day-guide.js — HTML builders

**Files:**
- Modify: `extension/features/agenda-day-guide/agenda-day-guide.js` (append inside the IIFE, after `media1`)

**Interfaces:**
- Consumes: `groupByEquipe`, `computeStats`, `zonasUnion`, `media1` (Task 2, same file).
- Produces (private, used by Task 4):
  - `escapeHtml(s: any) -> string`
  - `buildSlotCard(r: row) -> string`
  - `buildTeamPanel(group: {equipe, rows}) -> string`
  - `buildSummaryPanel(groups, allRows) -> string`
  - `buildGuideHtml(meta: { uf, dataBr, diaSemana, geradoEm }, groups, allRows) -> string` (complete `<!doctype html>` document)

- [ ] **Step 1: Write the failing mirror test**

Create `/tmp/day-guide-html-test.js`. It must start with byte-identical copies of the four Task-2 helpers (copy them from `extension/features/agenda-day-guide/agenda-day-guide.js`), then the new builders exactly as in Step 3 below, then:

```js
let fail = 0;
const ok = (cond, label) => { if (!cond) { console.log(`FAIL ${label}`); fail++; } };

const reserved = {
  isoDate: '2026-07-20', data: '20/07/2026', equipe: '29_Linus_Pituba_1',
  reservado: true, horaInicio: '09:00', horaFim: '10:00',
  controle: '2901234', domicilio: '02', nome: 'Maria <b>Silva</b>',
  sexo: 'F', dtNascimento: '12/03/1984', idade: '42',
  endereco: 'Rua das Flores, 123', telefone: '(71) 99999-0000',
  zonas: '29.3.03.03 29_Linus_Pituba', observacao: 'portão azul & fundos',
};
const open = { ...reserved, reservado: false, horaInicio: '10:00', horaFim: '11:00',
  nome: '', sexo: '', dtNascimento: '', idade: '', endereco: '', telefone: '',
  controle: '', domicilio: '', observacao: '' };

// escaping
ok(escapeHtml('<b>&"\'') === '&lt;b&gt;&amp;&quot;&#39;', 'escapeHtml all five');

// cards
const card = buildSlotCard(reserved);
ok(card.includes('Maria &lt;b&gt;Silva&lt;/b&gt;'), 'nome escaped in card');
ok(card.includes('F, 42 anos (12/03/1984)'), 'sexo/idade/nascimento line');
ok(card.includes('Rua das Flores, 123'), 'endereco present');
ok(card.includes('RESERVADO'), 'badge');
ok(card.includes('portão azul &amp; fundos'), 'observacao escaped');
const livre = buildSlotCard(open);
ok(livre.includes('LIVRE') && !livre.includes('RESERVADO'), 'open slot is LIVRE row');
ok(!livre.includes('undefined'), 'no undefined leaks');

// missing fields are omitted, card never breaks
const sparse = buildSlotCard({ ...reserved, telefone: '', observacao: '', dtNascimento: '' });
ok(!sparse.includes('Tel:') && !sparse.includes('Obs:'), 'missing fields omitted');

// full document
const rows = [ { ...reserved, horaInicio: '08:00', horaFim: '09:00' }, open, reserved ];
const groups = groupByEquipe(rows);
const html = buildGuideHtml(
  { uf: 'Bahia', dataBr: '20/07/2026', diaSemana: 'segunda-feira', geradoEm: '2026-07-16 21:00' },
  groups, rows);
ok(html.startsWith('<!doctype html>'), 'doctype');
ok(!/<script/i.test(html), 'no script tags');
ok(!/https?:\/\//.test(html), 'no external URLs');
ok((html.match(/type="radio"/g) || []).length === groups.length + 1, 'one radio per tab + Resumo');
ok(html.includes('id="tab-0" checked'), 'Resumo selected by default');
ok(html.includes('Resumo do dia'), 'summary panel present');
ok(html.includes('Equipes ativas'), 'day stats present');
ok(html.includes('29_Linus_Pituba_1'), 'team tab label present');
ok(html.includes('@media print'), 'print CSS present');

console.log(fail === 0 ? 'ALL PASS' : `${fail} FAILURES`);
```

- [ ] **Step 2: Run it against stubs to see it fail**

Run: `bun /tmp/day-guide-html-test.js`
Expected: crash with `escapeHtml is not defined` until the builder functions from Step 3 are pasted in; then `ALL PASS`. Iterate on the mirror until all assertions pass, then copy the final builder code verbatim into the feature file (Step 3).

- [ ] **Step 3: Append the builders to the feature file**

In `extension/features/agenda-day-guide/agenda-day-guide.js`, insert after the closing `}` of `media1` (still inside the IIFE):

```js
  // --- HTML builders ------------------------------------------------

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // One card per reserved slot; a slim dashed row for open slots.
  // Missing fields (already normalized to '' by readAgendaSlots) are
  // omitted line by line — a sparse card never breaks.
  function buildSlotCard(r) {
    const e = escapeHtml;
    const hora = `${e(r.horaInicio)}–${e(r.horaFim)}`;
    if (!r.reservado) return `<div class="livre">${hora} — LIVRE</div>`;

    const detalhes = [r.sexo && e(r.sexo), r.idade && `${e(r.idade)} anos`]
      .filter(Boolean).join(', ');
    const nasc = r.dtNascimento ? ` (${e(r.dtNascimento)})` : '';
    const morador = r.nome || detalhes || nasc
      ? `<div class="morador"><strong>${e(r.nome)}</strong>` +
        `${r.nome && (detalhes || nasc) ? ' — ' : ''}${detalhes}${nasc}</div>`
      : '';
    const ids = [
      r.telefone && `Tel: ${e(r.telefone)}`,
      r.controle && `Controle: ${e(r.controle)}`,
      r.domicilio && `Dom: ${e(r.domicilio)}`,
    ].filter(Boolean).join(' &nbsp;·&nbsp; ');

    return [
      '<div class="card">',
      `<div class="hora">${hora} <span class="badge">RESERVADO</span></div>`,
      r.endereco ? `<div class="endereco">${e(r.endereco)}</div>` : '',
      morador,
      ids ? `<div class="ids">${ids}</div>` : '',
      r.zonas ? `<div class="zonas">Zonas: ${e(r.zonas)}</div>` : '',
      r.observacao ? `<div class="obs">Obs: ${e(r.observacao)}</div>` : '',
      '</div>',
    ].filter(Boolean).join('\n');
  }

  function buildTeamPanel(group) {
    const e = escapeHtml;
    const s = computeStats(group.rows);
    const zonas = zonasUnion(group.rows);
    const statBits = [
      `${s.reservados} reservado(s) × ${s.livres} livre(s)`,
      s.ocupacaoPct != null ? `ocupação ${s.ocupacaoPct}%` : null,
      s.primeiro ? `primeiro ${e(s.primeiro.hora)}` : null,
      s.ultimo ? `último ${e(s.ultimo.hora)}` : null,
      s.controles.length ? `${s.controles.length} controle(s) distinto(s)` : null,
    ].filter(Boolean).join(' &nbsp;·&nbsp; ');
    return [
      `<h2>${e(group.equipe)}</h2>`,
      `<div class="teamstats">${statBits}</div>`,
      zonas.length ? `<div class="zonas">Zonas: ${zonas.map(e).join(', ')}</div>` : '',
      ...group.rows.map(buildSlotCard),
    ].filter(Boolean).join('\n');
  }

  function buildSummaryPanel(groups, allRows) {
    const e = escapeHtml;
    const day = computeStats(allRows);
    const comReserva = groups.filter((g) => g.rows.some((r) => r.reservado)).length;
    const linhas = [
      ['Equipes ativas', String(groups.length)],
      ['Equipes com reserva', String(comReserva)],
      ['Agendamentos (reservados)', String(day.reservados)],
      ['Slots livres', String(day.livres)],
      ['Total de slots', String(day.total)],
      ['Taxa de ocupação', day.ocupacaoPct != null ? `${day.ocupacaoPct}%` : '—'],
      ['Primeiro agendamento', day.primeiro ? `${day.primeiro.hora} — ${day.primeiro.equipe}` : '—'],
      ['Último agendamento', day.ultimo ? `${day.ultimo.hora} — ${day.ultimo.equipe}` : '—'],
      ['Controles distintos', String(day.controles.length)],
      ['Média de agendamentos por equipe ativa', media1(day.reservados, groups.length) ?? '—'],
      ['Média de agendamentos por controle', media1(day.reservados, day.controles.length) ?? '—'],
    ].map(([k, v]) => `<tr><th>${e(k)}</th><td>${e(v)}</td></tr>`).join('\n');
    const porEquipe = groups.map((g) => {
      const s = computeStats(g.rows);
      const oc = s.ocupacaoPct != null ? `${s.ocupacaoPct}%` : '—';
      return `<tr><td>${e(g.equipe)}</td><td>${s.reservados}</td><td>${s.livres}</td><td>${oc}</td></tr>`;
    }).join('\n');
    return [
      '<h2>Resumo do dia</h2>',
      `<table class="stats">\n${linhas}\n</table>`,
      '<h3>Por equipe</h3>',
      '<table class="stats"><tr><th>Equipe</th><th>Reservados</th><th>Livres</th><th>Ocupação</th></tr>',
      porEquipe,
      '</table>',
    ].join('\n');
  }

  // Complete standalone document. Tabs are CSS-only: one hidden radio per
  // tab as direct children of <main>, so #tab-i:checked ~ #panel-i works;
  // @media print hides the tab bar and prints only the checked panel.
  function buildGuideHtml(meta, groups, allRows) {
    const e = escapeHtml;
    const panels = [
      { label: 'Resumo', html: buildSummaryPanel(groups, allRows) },
      ...groups.map((g) => ({ label: g.equipe, html: buildTeamPanel(g) })),
    ];
    const radios = panels.map((_, i) =>
      `<input type="radio" name="tab" id="tab-${i}"${i === 0 ? ' checked' : ''}>`).join('\n');
    const labels = panels.map((p, i) =>
      `<label for="tab-${i}">${e(p.label)}</label>`).join('\n');
    const sections = panels.map((p, i) =>
      `<section class="panel" id="panel-${i}">\n${p.html}\n</section>`).join('\n');
    const tabRules = panels.map((_, i) =>
      `#tab-${i}:checked ~ #panel-${i} { display: block; }\n` +
      `#tab-${i}:checked ~ .tabs label[for="tab-${i}"] { background: #005a9c; color: #fff; }`
    ).join('\n');

    return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SIGC-PRO — Guia do Dia — ${e(meta.dataBr)}</title>
<style>
body { margin: 0; font: 14px/1.45 -apple-system, "Segoe UI", Roboto, sans-serif; color: #1a1a1a; }
header { padding: 1rem 1.2rem .6rem; border-bottom: 2px solid #005a9c; }
header h1 { margin: 0; font-size: 1.3rem; color: #005a9c; }
header .meta { color: #555; font-size: .9rem; }
main { padding: 0 1.2rem 2rem; max-width: 52rem; }
input[type="radio"] { display: none; }
.tabs { display: flex; flex-wrap: wrap; gap: .3rem; margin: 1rem 0; }
.tabs label { border: 1px solid #005a9c; color: #005a9c; border-radius: 4px; padding: .3rem .7rem; cursor: pointer; font-size: .9rem; }
.panel { display: none; }
h2 { margin: .6rem 0 .2rem; font-size: 1.15rem; }
h3 { margin: .8rem 0 .2rem; font-size: 1rem; }
.card { border: 1px solid #d0d7de; border-radius: 6px; padding: .6rem .8rem; margin: .5rem 0; page-break-inside: avoid; }
.card .hora { font-weight: 600; }
.badge { background: #005a9c; color: #fff; border-radius: 3px; font-size: .7rem; padding: .1rem .4rem; vertical-align: middle; }
.endereco { font-size: 1.05rem; font-weight: 600; margin: .15rem 0; }
.morador, .ids, .zonas, .obs { font-size: .92rem; margin-top: .1rem; }
.ids, .zonas { color: #555; }
.livre { color: #666; border: 1px dashed #bbb; border-radius: 6px; padding: .25rem .8rem; margin: .5rem 0; }
.teamstats { color: #333; margin: .2rem 0 .4rem; font-size: .92rem; }
table.stats { border-collapse: collapse; margin: .6rem 0; }
table.stats th, table.stats td { border: 1px solid #d0d7de; padding: .25rem .6rem; text-align: left; font-size: .92rem; }
${tabRules}
@media print { .tabs { display: none; } }
</style>
</head>
<body>
<header>
<h1>SIGC-PRO — Guia do Dia</h1>
<div class="meta">${[e(meta.uf), `${e(meta.dataBr)} (${e(meta.diaSemana)})`, `gerado em ${e(meta.geradoEm)}`].filter(Boolean).join(' · ')}</div>
</header>
<main>
${radios}
<div class="tabs">
${labels}
</div>
${sections}
</main>
</body>
</html>
`;
  }
```

- [ ] **Step 4: Run the mirror test and syntax-check**

Run:
```bash
bun /tmp/day-guide-html-test.js && \
bun build --no-bundle extension/features/agenda-day-guide/agenda-day-guide.js > /dev/null && echo SYNTAX-OK
```
Expected: `ALL PASS` then `SYNTAX-OK`.

- [ ] **Step 5: Visual smoke test of a generated file**

Append temporarily to `/tmp/day-guide-html-test.js`:
```js
await Bun.write('/tmp/guia-sample.html', html);
```
Run `bun /tmp/day-guide-html-test.js`, then `open /tmp/guia-sample.html` and check: tab bar renders, clicking tabs switches panels with no JS, Resumo table populated, cards match the approved mockup, Ctrl+P preview shows only the selected tab.

- [ ] **Step 6: Commit**

```bash
git add extension/features/agenda-day-guide/ && \
git commit -m "feat: day guide HTML builders (tabs, summary, cards)"
```

---

### Task 4: Wiring — Dia-only button, download, manifest registration

**Files:**
- Modify: `extension/features/agenda-day-guide/agenda-day-guide.js` (append after `buildGuideHtml`, before the IIFE's closing `})();`)
- Modify: `extension/manifest.json`

**Interfaces:**
- Consumes: `window.__sigcPro.{readAgendaSlots, downloadFile, timestampSlug, slug, isoToBr, WEEKDAYS_PT, onAgendaPage, findAgendaToolbarChunk, whenReadyGeneric}` and Task 2/3 builders.
- Produces: the user-visible feature; nothing consumed downstream.

- [ ] **Step 1: Append the wiring code**

```js
  // --- wiring ---------------------------------------------------------

  function diaViewActive() {
    return !!document.querySelector(
      '.fc-resourceTimeGridDay-button.fc-button-active, ' +
        '.fc-timeGridDay-button.fc-button-active'
    );
  }

  function guideMeta(rows) {
    const ufSelect = document.getElementById('selectUf');
    const uf = ufSelect && ufSelect.selectedIndex > 0
      ? ufSelect.options[ufSelect.selectedIndex].text.trim()
      : '';
    const isoDate = (rows.find((r) => r.isoDate) || {}).isoDate || '';
    const d = isoDate ? new Date(`${isoDate}T00:00:00`) : new Date();
    const { data, hora } = window.__sigcPro.timestampSlug();
    return {
      uf,
      dataBr: window.__sigcPro.isoToBr(isoDate),
      diaSemana: window.__sigcPro.WEEKDAYS_PT[d.getDay()],
      geradoEm: `${data} ${hora.slice(0, 2)}:${hora.slice(2, 4)}`,
    };
  }

  // sigc-pro-guia_<uf>_<dd-mm-aaaa do dia>_<data>_<hora>.html
  function fileName(meta) {
    const { data, hora } = window.__sigcPro.timestampSlug();
    const dia = meta.dataBr.replace(/\//g, '-');
    return ['sigc-pro-guia', window.__sigcPro.slug(meta.uf), dia, data, hora]
      .filter(Boolean).join('_') + '.html';
  }

  function exportGuide() {
    // Never expected: the button only exists in Dia view. Kept as a
    // fallback in case a click lands mid view-switch.
    if (!diaViewActive()) {
      alert('SIGC-PRO: mude para a visualização "Dia" para gerar o Guia do Dia.');
      return;
    }
    const rows = window.__sigcPro.readAgendaSlots();
    if (rows.length === 0) {
      alert('SIGC-PRO: nenhum slot encontrado na agenda — confira se UF/dia já carregaram.');
      return;
    }
    const groups = groupByEquipe(rows);
    const meta = guideMeta(rows);
    const html = buildGuideHtml(meta, groups, rows);
    window.__sigcPro.downloadFile(fileName(meta), html, 'text/html;charset=utf-8');
    console.log(`${TAG} guide exported: ${groups.length} equipe(s), ${rows.length} slot(s).`);
  }

  function insertButton(chunk) {
    if (document.getElementById(BUTTON_ID)) return;
    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    btn.className = 'fc-button fc-button-primary';
    btn.textContent = 'Guia do Dia';
    btn.title = 'Baixar guia do dia por equipe (SIGC-PRO)';
    btn.style.background = '#005a9c';
    btn.style.borderColor = '#005a9c';
    btn.style.marginLeft = '4px';
    btn.addEventListener('click', exportGuide);
    chunk.appendChild(btn);
    console.log(`${TAG} Guia do Dia button added.`);
  }

  // Unlike the other agenda buttons, this one exists only while the Dia
  // view is active: each observer tick inserts or REMOVES it. attributes:
  // ['class'] is observed so the fc-button-active toggle itself fires a
  // tick even if the toolbar isn't re-rendered.
  window.__sigcPro.whenReadyGeneric(
    () => window.__sigcPro.onAgendaPage() && window.__sigcPro.findAgendaToolbarChunk(),
    () => {
      const tryUpdate = () => {
        const existing = document.getElementById(BUTTON_ID);
        const chunk = window.__sigcPro.findAgendaToolbarChunk();
        if (window.__sigcPro.onAgendaPage() && chunk && diaViewActive()) {
          if (!existing) insertButton(chunk);
        } else if (existing) {
          existing.remove();
        }
      };
      tryUpdate();
      new MutationObserver(tryUpdate).observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class'],
      });
    }
  );
```

- [ ] **Step 2: Register in the manifest**

In `extension/manifest.json`, append the new script as the last entry of `content_scripts[0].js` (after `agenda-slot-checks`). The array must become:

```json
      "js": [
        "common/sigc-common.js",
        "features/pdf-export/pdf-export.js",
        "features/kml-export/kml-export.js",
        "features/csv-export/csv-export.js",
        "features/agenda-csv-export/agenda-csv-export.js",
        "features/agenda-slot-checks/agenda-slot-checks.js",
        "features/agenda-day-guide/agenda-day-guide.js"
      ],
```

Do not touch the `version` field.

- [ ] **Step 3: Syntax-check and privacy gate**

Run:
```bash
bun build --no-bundle extension/features/agenda-day-guide/agenda-day-guide.js > /dev/null && \
echo SYNTAX-OK && ./scripts/check-privacy.sh
```
Expected: `SYNTAX-OK` then `privacy gate: CLEAN`.

- [ ] **Step 4: Live verification (needs SIGC access — hand to the user if the executor has none)**

1. `chrome://extensions` → reload SIGC-PRO → F5 on the SIGC tab.
2. Agenda in **Semana** view: no "Guia do Dia" button; other PRO buttons unaffected.
3. Switch to **Dia**: button appears. Switch back to Semana: button disappears.
4. In Dia view with slots loaded, click: an `.html` file downloads with name `sigc-pro-guia_<uf>_<dd-mm-aaaa>_<data>_<hora>.html`.
5. Open the file: Resumo tab first with day stats + per-equipe table; one tab per team; cards match live slots (reserved details, LIVRE rows); no console errors; browser devtools Network tab shows zero requests from the file.
6. Ctrl+P on a team tab: only that team prints.

- [ ] **Step 5: Commit**

```bash
git add extension/ && git commit -m "feat: Guia do Dia — per-team HTML day guide from the Agenda"
```

---

### Task 5: Docs — Pages card and ROADMAP

**Files:**
- Modify: `docs/index.html` (new feature card)
- Modify: `ROADMAP.md` (Done entry)

**Interfaces:** none (docs only).

- [ ] **Step 1: Add the feature card**

In `docs/index.html`, after the "⏰ Verificar Slots — Agenda" card's closing `</div>`, insert:

```html
  <div class="card">
    <h3>🗒️ Guia do Dia — Agenda</h3>
    <p>Na visualização Dia, gera um guia HTML autônomo com abas por equipe:
    resumo do dia (equipes, agendamentos, ocupação, controles), e por
    equipe os cartões de cada visita — endereço, morador (nome, sexo,
    idade), telefone, Controle/Domicílio e observações — além dos horários
    livres. Pronto para imprimir por equipe (Ctrl+P na aba).</p>
  </div>
```

Do not touch the `versão x.y.z` marker — the pre-commit hook syncs it.

- [ ] **Step 2: Add the ROADMAP Done entry**

In `ROADMAP.md`, in the `## Done (v0.1.x)` list, after the "Verificar Slots" entry, insert:

```markdown
- [x] Agenda "Guia do Dia": Dia-view-only button downloading a
      self-contained HTML day guide (CSS-only tabs, no JS/network) —
      Resumo tab with day stats plus one tab per equipe with visit cards
      and LIVRE rows; printable per team
      (`2026-07-16-agenda-day-guide-design.md`)
```

- [ ] **Step 3: Commit**

```bash
git add docs/index.html ROADMAP.md && \
git commit -m "docs: Guia do Dia feature card and ROADMAP entry"
```

---

## Self-review notes

- Spec coverage: gating/visibility (Task 4), data flow (Task 2), file constraints + structure + print (Task 3), filename + slug move (Tasks 1, 4), edge cases (empty-team tabs render via groupByEquipe pass-through; zero-denominator stats in `media1`/`computeStats` nulls rendered as "—"; missing fields omitted per `buildSlotCard`), testing (mirror tests Tasks 1–3, live check Task 4), docs (Task 5).
- `primeiro/último` rely on `readAgendaSlots` time-sorting; noted in `computeStats` comment.
- Types/names consistent across tasks (`groupByEquipe`, `computeStats`, `zonasUnion`, `media1`, `escapeHtml`, `buildSlotCard`, `buildTeamPanel`, `buildSummaryPanel`, `buildGuideHtml`, `diaViewActive`, `guideMeta`, `fileName`, `exportGuide`).
