// SIGC-PRO feature: on-demand check for open (unbooked) Agenda slots that
// fall before the minimum scheduling lead time — a coordination rule, not
// anything SIGC itself enforces: a new visit normally needs 3 calendar
// days' notice, or 4 if today is a Friday (decided: Sat/Sun get no special
// treatment, plain +3 applies then too). An open slot dated before that
// cutoff is one nobody can realistically fill in time — this button
// surfaces those so a coordinator can clean them up or replace them.
//
// Deliberately a separate, non-blocking button (not folded into CSV-PRO's
// download): the check is useful on its own, any time the agenda is open,
// without needing to export anything. Shares window.__sigcPro.
// readAgendaSlots() (sigc-common.js) with agenda-csv-export.js — same data
// source (already-rendered FullCalendar DOM, no network calls), see
// docs/superpowers/specs/2026-07-16-agenda-csv-export-design.md.
//
// "Open" = not evento-reservado (title is just "Zonas: …", no Controle/
// Domicílio/Nome yet) — already-reserved slots are out of scope per
// coordination decision (2026-07-16): those aren't flagged even if their
// date is inside the window.
(function () {
  'use strict';

  const TAG = '[sigc-agenda-lead-time-alert]';
  const BUTTON_ID = 'sigc-pro-agenda-prazo-button';
  const MAX_LISTED = 15;

  const WEEKDAYS_PT = [
    'domingo', 'segunda-feira', 'terça-feira', 'quarta-feira',
    'quinta-feira', 'sexta-feira', 'sábado',
  ];

  function formatDateLong(d) {
    return `${window.__sigcPro.isoToBr(window.__sigcPro.dateToIso(d))} (${WEEKDAYS_PT[d.getDay()]})`;
  }

  function buildMessage(today, minDate, violations, openCount, totalCount) {
    const lines = [
      'SIGC-PRO — Prazo mínimo para novos agendamentos',
      '',
      `Hoje: ${formatDateLong(today)}`,
      `Só é possível agendar a partir de: ${formatDateLong(minDate)}`,
      '',
    ];
    if (violations.length === 0) {
      lines.push(
        `Nenhum slot aberto antes do prazo mínimo (${openCount} aberto(s) de ` +
          `${totalCount} slot(s) no total, nesta visualização).`
      );
    } else {
      lines.push(`${violations.length} slot(s) aberto(s) antes do prazo mínimo:`);
      violations.slice(0, MAX_LISTED).forEach((v) => {
        const zonas = v.zonas ? ` — ${v.zonas}` : '';
        lines.push(`  • ${v.data} ${v.horaInicio}-${v.horaFim} — ${v.equipe}${zonas}`);
      });
      if (violations.length > MAX_LISTED) {
        lines.push(`  … e mais ${violations.length - MAX_LISTED}.`);
      }
    }
    return lines.join('\n');
  }

  function checkLeadTime() {
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

    alert(buildMessage(today, minDate, violations, openRows.length, rows.length));
    console.log(`${TAG} ${violations.length} open slot(s) before ${minDateIso} (of ${openRows.length} open).`);
  }

  function insertButton(chunk) {
    if (document.getElementById(BUTTON_ID)) return;

    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    btn.className = 'fc-button fc-button-primary';
    btn.textContent = 'Verificar Prazo';
    btn.title = 'Verificar slots abertos antes do prazo mínimo de agendamento (SIGC-PRO)';
    btn.style.background = '#005a9c';
    btn.style.borderColor = '#005a9c';
    btn.style.marginLeft = '4px';
    btn.addEventListener('click', checkLeadTime);
    chunk.appendChild(btn);

    console.log(`${TAG} Verificar Prazo button added.`);
  }

  // Same re-insertion posture as agenda-csv-export.js: FullCalendar's
  // toolbar is virtual-DOM diffed and can drop a foreign button on
  // view/date navigation.
  window.__sigcPro.whenReadyGeneric(
    () => window.__sigcPro.onAgendaPage() && window.__sigcPro.findAgendaToolbarChunk(),
    () => {
      const tryInsert = () => {
        if (document.getElementById(BUTTON_ID)) return;
        const chunk = window.__sigcPro.findAgendaToolbarChunk();
        if (chunk) insertButton(chunk);
      };
      tryInsert();
      new MutationObserver(tryInsert).observe(document.body, {
        childList: true,
        subtree: true,
      });
    }
  );
})();
