// SIGC-PRO feature: "Slots Abertos" — an on-page panel answering the
// question the Guia do Dia can't: across the whole WEEK, where is there
// still capacity to open? The Guia do Dia is one day × equipe; opening
// new slots is a zona × turno decision made over a multi-day horizon.
//
// The panel is a zona × turno table: one row per distinct zona entry, one
// column pair per turno (Manhã = start before 13:00, Tarde = 13:00 on),
// each cell "abertos/total" — open slots still fillable over the total
// slots existing there, so a zona reading 0/8 has nothing left to open
// while 5/6 is nearly untouched.
//
// "Still fillable" is the operative word: abertos counts only free slots
// at or after the SIGC prazo mínimo (+3 days, +4 on Fridays), since a
// free slot before that cutoff can no longer be filled and would
// otherwise advertise capacity that does not exist. The denominator is
// deliberately NOT filtered — those slots still occupy the zona.
//
// A slot listing several zonas is shown TWO ways in the same cell,
// because the two answer different questions and neither alone is
// enough. The whole count (top) counts the slot in every zona it lists —
// "de quantos slots esta zona pode ser preenchida?", the number that
// matters when deciding where to open, but one that makes zona rows sum
// past the slot total. The weighted share (below, grey) divides the slot
// evenly across its zonas, so each slot contributes exactly 1.0 and the
// rows reconcile with the TOTAL row — at the cost of naming no single
// fillable slot. The share line is omitted where nothing is shared.
//
// Zona entries are kept WHOLE ("29001001 - Lab 1 Oeste"), never split
// into código/rota/laboratório: the name after " - " is free text with no
// reliable token count (compare "Lab 1 Oeste" with "29001002"), so any
// split would silently mangle or drop rows.
//
// Semana view only — a single day is too thin a base to decide where to
// open slots, and the Guia do Dia already covers the per-day picture.
// Data comes exclusively from window.__sigcPro.readAgendaSlots()
// (already-rendered FullCalendar DOM, no network), same source and
// zero-network-calls guarantee as agenda-csv-export.js.
(function () {
  'use strict';

  const TAG = '[sigc-agenda-slots-abertos]';
  const BUTTON_ID = 'sigc-pro-agenda-abertos-button';
  const PANEL_ID = 'sigc-pro-slots-abertos-panel';

  // Slots starting before 13:00 are Manhã, the rest Tarde — the same
  // cut the coordination's own turno reporting uses.
  const TARDE_FROM_MIN = 13 * 60;

  // null when the row carries no parseable start time — such a row can't
  // be attributed to a turno and is excluded from the table rather than
  // guessed into one.
  function turnoOf(r) {
    const min = window.__sigcPro.toMin(r.horaInicio);
    if (min == null) return null;
    return min < TARDE_FROM_MIN ? 'manha' : 'tarde';
  }

  // Sort key only: everything after the first " - ", which for the full
  // entry shape "<ID> - <setor código> <nome>" is the SETOR CÓDIGO first
  // ("292WD9 - 29.3.01.04 29_Linus_Pituba" -> "29.3.01.04 29_Linus_
  // Pituba"). The código is hierarchical (UF, then progressively finer
  // subdivisions), so ordering by it groups geographically adjacent
  // setores together — which is what a scheduler scanning the table
  // wants. The leading ID is opaque and orders nothing; the trailing
  // name leads with the equipe, so keying on it would group by team
  // instead of by area.
  //
  // This does not contradict the whole-entry rule above: the entry is
  // still displayed and counted whole, and an entry with no " - " (the
  // slot-text shape, "29.3.03.03 29_Linus_Pituba", which already starts
  // with its código) keys on itself rather than being dropped. Splitting
  // only ever decides order here, so a surprising shape misplaces a row
  // at worst — it cannot mangle or lose one. Ties fall back to the whole
  // entry, keeping the order total and independent of input order.
  function zonaSortKey(zona) {
    const s = String(zona ?? '').trim();
    const i = s.indexOf(' - ');
    return i === -1 ? s : s.slice(i + 3);
  }

  // rows -> { zonas: [{ zona, manha: {abertos, total}, tarde: {…},
  //           abertos, total }], totals: {…}, semZona, semHora }
  // sorted by SETOR CÓDIGO — the part after the first " - " — with pt-BR
  // collation, so acentos sort naturally (see zonaSortKey).
  // A row with no zonas at all can't be placed in any zona row; it's
  // counted in semZona so the panel can say so instead of dropping it.
  // minDateIso: the earliest date a slot can still be filled — the SIGC
  // prazo mínimo, +3 days from today and +4 on Fridays (so a Friday's
  // horizon clears the weekend), via the shared agendaMinScheduleDate.
  // Defaults to that rule applied to today; passed explicitly by tests.
  function aggregateByZonaTurno(rows, minDateIso) {
    const limite = minDateIso != null ? minDateIso : window.__sigcPro.dateToIso(
      window.__sigcPro.agendaMinScheduleDate(new Date()));
    const map = new Map();
    const totals = { manha: { abertos: 0, total: 0 }, tarde: { abertos: 0, total: 0 } };
    let semZona = 0;
    let semHora = 0;
    let foraDoPrazo = 0;

    rows.forEach((r) => {
      const turno = turnoOf(r);
      if (!turno) {
        semHora += 1;
        return;
      }
      const entries = window.__sigcPro.parseZonaEntries(r.zonas);
      if (entries.length === 0) {
        semZona += 1;
        return;
      }
      // Open = not reserved (matching readAgendaSlots' own `reservado`
      // flag: an open slot's title is just "Zonas: …", no Controle) AND
      // still within the prazo — a slot before the cutoff cannot be filled
      // anymore, so counting it as open would point schedulers at capacity
      // that does not exist.
      //
      // Only `abertos` is filtered, never `total`: an unfillable slot
      // still occupies the zona's capacity, so dropping it from the
      // denominator would overstate how free the zona is and stop the
      // TOTAL row reconciling with the week actually on screen.
      const noPrazo = !r.isoDate || r.isoDate >= limite;
      const aberto = !r.reservado && noPrazo;
      if (!r.reservado && !noPrazo) foraDoPrazo += 1;
      totals[turno].total += 1;
      if (aberto) totals[turno].abertos += 1;

      // Two readings of the same slot, kept side by side because they
      // answer different questions. Whole counts ("de quantos slots esta
      // zona pode ser preenchida?") double count a shared slot, so zona
      // rows overshoot the slot total. The weighted share divides the
      // slot evenly across the zonas it lists, so every slot contributes
      // exactly 1.0 in total and the rows reconcile with TOTAL — at the
      // cost of no longer naming anything actually fillable on its own.
      const zonasDoSlot = new Set(entries);
      const peso = 1 / zonasDoSlot.size;
      zonasDoSlot.forEach((zona) => {
        if (!map.has(zona)) {
          map.set(zona, {
            zona,
            manha: { abertos: 0, total: 0, abertosPeso: 0, totalPeso: 0 },
            tarde: { abertos: 0, total: 0, abertosPeso: 0, totalPeso: 0 },
          });
        }
        const cell = map.get(zona)[turno];
        cell.total += 1;
        cell.totalPeso += peso;
        if (aberto) {
          cell.abertos += 1;
          cell.abertosPeso += peso;
        }
      });
    });

    const zonas = [...map.values()].map((z) => ({
      ...z,
      abertos: z.manha.abertos + z.tarde.abertos,
      total: z.manha.total + z.tarde.total,
      abertosPeso: z.manha.abertosPeso + z.tarde.abertosPeso,
      totalPeso: z.manha.totalPeso + z.tarde.totalPeso,
    }));
    zonas.sort((a, b) => {
      const porNome = zonaSortKey(a.zona).localeCompare(zonaSortKey(b.zona), 'pt-BR');
      return porNome || a.zona.localeCompare(b.zona, 'pt-BR');
    });

    return {
      zonas,
      totals: {
        ...totals,
        abertos: totals.manha.abertos + totals.tarde.abertos,
        total: totals.manha.total + totals.tarde.total,
      },
      semZona,
      semHora,
      foraDoPrazo,
      limite,
    };
  }

  // --- rendering ------------------------------------------------------

  const escapeHtml = (s) => window.__sigcPro.escapeHtml(s);

  // One decimal, pt-BR comma — same shape the day guide's media1 uses.
  function num1(n) {
    return n.toFixed(1).replace('.', ',');
  }

  // "abertos/total" on top, the weighted share beneath it, plus a
  // saturated marker when nothing is left open — the cell a scheduler is
  // looking for is the one that ISN'T 0. The share line is omitted when
  // it would merely repeat the whole counts (no shared slot in this
  // cell), so it only appears where it actually says something new.
  function cellHtml(c, extraClass) {
    const classes = [extraClass].filter(Boolean);
    if (c.total === 0) {
      classes.push('sp-vazio');
      return `<td class="${classes.join(' ')}">—</td>`;
    }
    if (c.abertos === 0) classes.push('sp-cheio');
    else if (c.abertos === c.total) classes.push('sp-livre');
    const compartilhado =
      Math.abs(c.abertosPeso - c.abertos) > 1e-9 || Math.abs(c.totalPeso - c.total) > 1e-9;
    const peso = compartilhado
      ? `<br><span class="sp-peso">${num1(c.abertosPeso)}/${num1(c.totalPeso)}</span>`
      : '';
    const attr = classes.length ? ` class="${classes.join(' ')}"` : '';
    return `<td${attr}>${c.abertos}/${c.total}${peso}</td>`;
  }

  function buildTableHtml(agg, periodo) {
    const e = escapeHtml;
    if (agg.zonas.length === 0) {
      return '<p class="sp-vazio-msg">Nenhum slot com zona nesta semana.</p>';
    }
    const linhas = agg.zonas.map((z) =>
      `<tr><th class="sp-zona">${e(z.zona)}</th>` +
      cellHtml(z.manha) + cellHtml(z.tarde) + cellHtml(z, 'sp-tot') +
      '</tr>'
    ).join('\n');
    const t = agg.totals;
    const rodape =
      '<tr class="sp-foot"><th>TOTAL (slots)</th>' +
      `<td>${t.manha.abertos}/${t.manha.total}</td>` +
      `<td>${t.tarde.abertos}/${t.tarde.total}</td>` +
      `<td>${t.abertos}/${t.total}</td></tr>`;
    const notas = [
      'Cada célula: <strong>abertos/total</strong> em contagem inteira.',
      `<strong>Abertos</strong> conta só o que ainda dá para preencher: ` +
        `slots livres a partir de ${e(window.__sigcPro.isoToBr(agg.limite))} ` +
        '(prazo mínimo de agendamento). O total segue contando todos os ' +
        'slots da zona, inclusive os que já passaram do prazo.',
      agg.foraDoPrazo
        ? `${agg.foraDoPrazo} slot(s) livre(s) já fora do prazo não entram ` +
          'em "abertos".'
        : '',
      'Um slot que lista várias zonas conta inteiro em cada uma delas ' +
        '(de quantos slots a zona pode ser preenchida), portanto a soma ' +
        'das linhas passa do TOTAL, que conta slots.',
      'A segunda linha da célula (<span class="sp-peso">cinza</span>) ' +
        'divide cada slot entre as zonas que ele lista, então soma ' +
        'exatamente o TOTAL. Só aparece onde há slot compartilhado.',
      agg.semZona
        ? `${agg.semZona} slot(s) sem zona não entram na tabela nem no TOTAL.`
        : '',
      agg.semHora
        ? `${agg.semHora} slot(s) sem horário legível não entram na tabela ` +
          'nem no TOTAL.'
        : '',
    ].filter(Boolean).join(' ');
    return [
      `<div class="sp-periodo">${e(periodo)}</div>`,
      '<table class="sp-tabela">',
      '<tr><th>Zona</th><th>Manhã</th><th>Tarde</th><th>Total</th></tr>',
      linhas,
      rodape,
      '</table>',
      `<div class="sp-notas">${notas}</div>`,
    ].join('\n');
  }

  const PANEL_CSS = `
#${PANEL_ID} { position: fixed; top: 64px; right: 16px; z-index: 99999;
  width: 460px; max-height: 78vh; overflow: auto;
  background: #fff; border: 1px solid #d0d7de; border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0,0,0,.18); padding: .6rem .8rem;
  font: 13px/1.4 -apple-system, "Segoe UI", Roboto, sans-serif; color: #1a1a1a; }
#${PANEL_ID} .sp-head { display: flex; align-items: center; justify-content: space-between; gap: .5rem; }
#${PANEL_ID} h3 { margin: 0; font-size: 1rem; color: #005a9c; }
#${PANEL_ID} .sp-fechar { border: 0; background: transparent; font-size: 1.2rem;
  line-height: 1; cursor: pointer; color: #555; padding: 0 .2rem; }
#${PANEL_ID} .sp-periodo { color: #555; font-size: .85rem; margin: .2rem 0 .4rem; }
#${PANEL_ID} table.sp-tabela { border-collapse: collapse; width: 100%; margin-bottom: .4rem; }
#${PANEL_ID} table.sp-tabela th, #${PANEL_ID} table.sp-tabela td {
  border: 1px solid #d0d7de; padding: .2rem .4rem; font-size: .85rem; text-align: center; }
#${PANEL_ID} table.sp-tabela th.sp-zona { text-align: left; font-weight: 600; }
#${PANEL_ID} .sp-cheio { background: #ffeaea; color: #a11; }
#${PANEL_ID} .sp-livre { background: #eaffea; color: #161; font-weight: 600; }
#${PANEL_ID} .sp-vazio { color: #bbb; }
#${PANEL_ID} .sp-peso { color: #777; font-size: .78em; font-weight: 400; }
#${PANEL_ID} .sp-tot { font-weight: 600; }
#${PANEL_ID} tr.sp-foot th, #${PANEL_ID} tr.sp-foot td { background: #f6f8fa; font-weight: 600; }
#${PANEL_ID} .sp-notas { color: #666; font-size: .78rem; }
#${PANEL_ID} .sp-vazio-msg { color: #666; }
`;

  function ensureStyle() {
    const id = 'sigc-pro-slots-abertos-style';
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = PANEL_CSS;
    document.head.appendChild(style);
  }

  // Calendar's own toolbar title ("13/07/2026 – 19/07/2026"), so the panel
  // always names the period it actually summarized.
  function periodoAtual() {
    const el = document.querySelector('.fc-toolbar-title');
    return el ? el.textContent.trim() : '';
  }

  function removePanel() {
    const el = document.getElementById(PANEL_ID);
    if (el) el.remove();
  }

  function renderPanel(agg) {
    ensureStyle();
    removePanel();
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    const head = document.createElement('div');
    head.className = 'sp-head';
    const h = document.createElement('h3');
    h.textContent = 'Slots abertos por zona';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'sp-fechar';
    close.title = 'Fechar';
    close.textContent = '×';
    close.addEventListener('click', removePanel);
    head.appendChild(h);
    head.appendChild(close);
    panel.appendChild(head);
    const body = document.createElement('div');
    // Built from escaped strings only (escapeHtml on every zona entry);
    // counts are numbers.
    body.innerHTML = buildTableHtml(agg, periodoAtual());
    panel.appendChild(body);
    document.body.appendChild(panel);
  }

  // --- wiring ---------------------------------------------------------

  function semanaViewActive() {
    return !!document.querySelector(
      '.fc-resourceTimeGridWeek-button.fc-button-active, ' +
        '.fc-timeGridWeek-button.fc-button-active'
    );
  }

  function showSlotsAbertos() {
    // Toggle: a second click on the button closes the panel, so it never
    // becomes a fixed overlay the user has to hunt a close button for.
    if (document.getElementById(PANEL_ID)) {
      removePanel();
      return;
    }
    const rows = window.__sigcPro.readAgendaSlots();
    if (rows.length === 0) {
      alert('SIGC-PRO: nenhum slot encontrado na agenda — confira se UF/semana já carregaram.');
      return;
    }
    const agg = aggregateByZonaTurno(rows);
    renderPanel(agg);
    console.log(
      `${TAG} panel: ${agg.zonas.length} zona(s), ` +
        `${agg.totals.abertos}/${agg.totals.total} slot(s) abertos.`
    );
  }

  window.__sigcPro.slotsAbertos = { aggregateByZonaTurno, buildTableHtml, turnoOf, zonaSortKey };

  // Semana-view-only, same class-flip gating the Dia-only Guia do Dia
  // button uses (the shared observer watches attributes: ['class']).
  // Leaving Semana also removes the panel: its contents describe a week
  // that is no longer on screen.
  window.__sigcPro.mountWidget({
    id: BUTTON_ID,
    anchor: (ctx) => ctx.agendaChunk(),
    when: (ctx) => {
      const ok = ctx.onAgenda() && semanaViewActive();
      if (!ok) removePanel();
      return ok;
    },
    build: () => {
      console.log(`${TAG} Slots Abertos button added.`);
      return window.__sigcPro.makeFcProButton({
        id: BUTTON_ID,
        text: 'Slots Abertos',
        title: 'Slots abertos por zona e turno na semana (SIGC-PRO)',
        onClick: showSlotsAbertos,
      });
    },
  });
})();
