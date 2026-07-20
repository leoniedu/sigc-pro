// SIGC-PRO feature: on-demand Agenda slot checks ("Verificar Slots") —
// coordination rules, not anything SIGC itself enforces. Two checks per
// click, one alert:
//
// 1. Prazo: open (unbooked) slots dated before the minimum scheduling
//    lead time — a new visit normally needs 3 calendar days' notice, or 4
//    if today is a Friday (decided: Sat/Sun get no special treatment,
//    plain +3 applies then too). An open slot before that cutoff is one
//    nobody can realistically fill in time. "Open" = not evento-reservado
//    (title is just "Zonas: …") — reserved slots are out of scope per
//    coordination decision (2026-07-16).
//
// 2. Nomes: zona names must match the slot's equipe. Both follow
//    <UF>_<Equipe>_<Local> with an optional trailing _<n> (two or three
//    underscores); the comparison key is everything up to the third
//    underscore (29_Linus_Lauro_1 -> 29_Linus_Lauro). Every zona entry in
//    the slot's comma-separated Zonas field (e.g. "29.3.03.03
//    29_Linus_Pituba") must END with the equipe's key (optional _<n>
//    suffix allowed), so the zona code format never needs parsing; equipe
//    names that don't fit the pattern at all are reported as malformed.
//    Runs on ALL slots — a reserved slot hanging in the wrong equipe
//    column is still wrong.
//
// Deliberately a separate, non-blocking button (not folded into CSV-PRO's
// download): the checks are useful on their own, any time the agenda is
// open. Shares window.__sigcPro.readAgendaSlots() (sigc-common.js) with
// agenda-csv-export.js — same data source (already-rendered FullCalendar
// DOM, no network calls), see docs/superpowers/specs/
// 2026-07-16-agenda-csv-export-design.md.
(function () {
  'use strict';

  const TAG = '[sigc-agenda-slot-checks]';
  const BUTTON_ID = 'sigc-pro-agenda-slots-button';
  const MAX_LISTED = 15;

  // <UF>_<Equipe>_<Local> plus optional _<n>: exactly two or three
  // underscores, no empty segments.
  const NAME_PATTERN = /^[^_\s]+_[^_\s]+_[^_\s]+(?:_[^_\s]+)?$/;

  // Comparison key: everything up to the third underscore.
  function nameKey(name) {
    return String(name ?? '').trim().split('_').slice(0, 3).join('_');
  }

  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // A zona entry matches its equipe when the equipe's key ends the entry
  // (whole word, so 29_Linus_Lauro doesn't match …_LauroX), allowing the
  // same optional _<n> suffix zone names may carry (…_Pituba matches both
  // "29.3.03.03 29_Linus_Pituba" and "29.3.03.03 29_Linus_Pituba_1").
  function zonaMatchesKey(entry, key) {
    return new RegExp(`(^|[\\s-])${escapeRegex(key)}(_[^_\\s,]+)?$`).test(entry);
  }

  function formatDateLong(d) {
    return `${window.__sigcPro.isoToBr(window.__sigcPro.dateToIso(d))} (${window.__sigcPro.WEEKDAYS_PT[d.getDay()]})`;
  }

  function slotLabel(r) {
    return `${r.data} ${r.horaInicio}-${r.horaFim} — ${r.equipe}`;
  }

  function listCapped(lines, items, format) {
    items.slice(0, MAX_LISTED).forEach((it) => lines.push(format(it)));
    if (items.length > MAX_LISTED) lines.push(`  … e mais ${items.length - MAX_LISTED}.`);
  }

  function checkNames(rows) {
    const badEquipes = new Set();
    const mismatches = [];
    rows.forEach((r) => {
      if (!r.equipe) return;
      if (!NAME_PATTERN.test(r.equipe)) {
        badEquipes.add(r.equipe);
        return;
      }
      const key = nameKey(r.equipe);
      const badZonas = window.__sigcPro.parseZonaEntries(r.zonas)
        .filter((z) => !zonaMatchesKey(z, key));
      if (badZonas.length > 0) mismatches.push({ row: r, badZonas });
    });
    return { badEquipes: [...badEquipes], mismatches };
  }

  function buildMessage(today, minDate, violations, openCount, totalCount, names) {
    const lines = [
      'SIGC-PRO — Verificação de slots',
      '',
      `Hoje: ${formatDateLong(today)}`,
      `Só é possível agendar a partir de: ${formatDateLong(minDate)}`,
      '',
      '— PRAZO —',
    ];
    if (violations.length === 0) {
      lines.push(
        `Nenhum slot aberto antes do prazo mínimo (${openCount} aberto(s) de ` +
          `${totalCount} slot(s) no total, nesta visualização).`
      );
    } else {
      lines.push(`${violations.length} slot(s) aberto(s) antes do prazo mínimo:`);
      listCapped(lines, violations, (v) => {
        const zonas = v.zonas ? ` — ${v.zonas}` : '';
        return `  • ${slotLabel(v)}${zonas}`;
      });
    }

    lines.push('', '— NOMES (zona × equipe) —');
    if (names.badEquipes.length === 0 && names.mismatches.length === 0) {
      lines.push('Nenhuma divergência de nomes nesta visualização.');
    } else {
      if (names.badEquipes.length > 0) {
        lines.push('Equipe(s) fora do padrão UF_Equipe_Local(_n):');
        listCapped(lines, names.badEquipes, (e) => `  • ${e}`);
      }
      if (names.mismatches.length > 0) {
        lines.push(`${names.mismatches.length} slot(s) com zona de outra equipe:`);
        listCapped(lines, names.mismatches, (m) =>
          `  • ${slotLabel(m.row)} — zona(s): ${m.badZonas.join(', ')}`);
      }
    }
    return lines.join('\n');
  }

  function checkSlots() {
    const rows = window.__sigcPro.readAgendaSlots();
    if (rows.length === 0) {
      alert('SIGC-PRO: nenhum slot encontrado na agenda — confira se UF/semana já carregaram.');
      return;
    }

    const today = new Date();
    const minDate = window.__sigcPro.agendaMinScheduleDate(today);
    const minDateIso = window.__sigcPro.dateToIso(minDate);

    const openRows = rows.filter((r) => !r.reservado);
    const violations = openRows.filter((r) => r.isoDate && r.isoDate < minDateIso);
    const names = checkNames(rows);

    alert(buildMessage(today, minDate, violations, openRows.length, rows.length, names));
    console.log(
      `${TAG} ${violations.length} open slot(s) before ${minDateIso} (of ${openRows.length} open); ` +
        `${names.badEquipes.length} malformed equipe name(s), ${names.mismatches.length} zona/equipe mismatch(es).`
    );
  }

  // Same mount posture as agenda-csv-export.
  window.__sigcPro.mountWidget({
    id: BUTTON_ID,
    anchor: (ctx) => ctx.agendaChunk(),
    when: (ctx) => ctx.onAgenda(),
    build: () => {
      console.log(`${TAG} Verificar Slots button added.`);
      return window.__sigcPro.makeFcProButton({
        id: BUTTON_ID,
        text: 'Verificar Slots',
        title: 'Verificar prazo mínimo e nomes zona/equipe dos slots (SIGC-PRO)',
        onClick: checkSlots,
      });
    },
  });
})();
