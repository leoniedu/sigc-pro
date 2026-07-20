// SIGC-PRO feature: CSV export of the Agenda (Administrar Agenda) slots
// currently shown in the calendar (Dia/Semana view, whatever UF/equipe
// filter is active) — including fields folded into each slot's free-text
// "title" (Controle, Domicílio, Nome, endereço, etc.), parsed out.
//
// Data source: window.__sigcPro.readAgendaSlots() (sigc-common.js) — reads
// the ALREADY-RENDERED FullCalendar DOM, not a new network request. See
// that function's comment and docs/superpowers/specs/
// 2026-07-16-agenda-csv-export-design.md for how AdministracaoAgenda's
// FullCalendar resource-timegrid markup was reverse-engineered, and why
// this keeps SIGC-PRO's zero-network-calls guarantee intact. Exports both
// reserved and open/unbooked slots — "all the slots" — sharing this
// reading logic with agenda-slot-checks.js.
(function () {
  'use strict';

  const TAG = '[sigc-agenda-csv-export]';
  const BUTTON_ID = 'sigc-pro-agenda-csv-button';

  const HEADER = [
    'Data', 'Equipe', 'Hora Início', 'Hora Fim', 'Controle', 'Domicílio',
    'Nome', 'Sexo', 'Dt. Nascimento', 'Idade', 'Endereço', 'Telefone',
    'Zonas', 'Observação',
  ];

  function toCsvRow(r) {
    return [
      r.data, r.equipe, r.horaInicio, r.horaFim, r.controle, r.domicilio,
      r.nome, r.sexo, r.dtNascimento, r.idade, r.endereco, r.telefone,
      r.zonas, r.observacao,
    ];
  }


  // sigc-pro-agenda_<uf>_<período do cabeçalho>_<data>_<hora>. Period comes
  // straight from the calendar's own toolbar title (e.g. "12/07/2026 –
  // 18/07/2026" or a single date in Dia view), so it always matches what
  // was actually exported; data/hora are the export timestamp itself (same
  // fields csv-export's generic filename uses, via timestampSlug()).
  function agendaFileBase() {
    const titleEl = document.querySelector('.fc-toolbar-title');
    const periodo = titleEl ? titleEl.textContent.trim() : '';
    const uf = window.__sigcPro.getAgendaUf().name;
    const { data, hora } = window.__sigcPro.timestampSlug();
    return ['sigc-pro-agenda', window.__sigcPro.slug(uf), window.__sigcPro.slug(periodo), data, hora].filter(Boolean).join('_');
  }

  function exportAgendaCsv() {
    const rows = window.__sigcPro.readAgendaSlots();
    if (rows.length === 0) {
      alert('SIGC-PRO: nenhum slot encontrado na agenda — confira se UF/semana já carregaram.');
      return;
    }
    const csv = window.__sigcPro.buildCsv(HEADER, rows.map(toCsvRow));
    window.__sigcPro.downloadFile(`${agendaFileBase()}.csv`, csv);
    console.log(`${TAG} CSV exported: ${rows.length} slots.`);
  }

  // FullCalendar re-renders its toolbar (virtual-DOM diffed) on
  // view/date navigation, which can wipe a foreign button — the shared
  // observer re-mounts on the next mutation batch.
  window.__sigcPro.mountWidget({
    id: BUTTON_ID,
    anchor: (ctx) => ctx.agendaChunk(),
    when: (ctx) => ctx.onAgenda(),
    build: () => {
      console.log(`${TAG} Agenda CSV-pro button added.`);
      return window.__sigcPro.makeFcProButton({
        id: BUTTON_ID,
        text: 'CSV-PRO',
        title: 'Exportar slots da agenda (SIGC-PRO)',
        onClick: exportAgendaCsv,
      });
    },
  });
})();
