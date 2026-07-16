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
