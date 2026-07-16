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
// reading logic with agenda-lead-time-alert.js.
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

  function slug(s) {
    return String(s ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
  }

  // sigc-pro-agenda_<uf>_<período do cabeçalho>_<data>_<hora>. Period comes
  // straight from the calendar's own toolbar title (e.g. "12/07/2026 –
  // 18/07/2026" or a single date in Dia view), so it always matches what
  // was actually exported; data/hora are the export timestamp itself (same
  // fields csv-export's generic filename uses, via timestampSlug()).
  function agendaFileBase() {
    const titleEl = document.querySelector('.fc-toolbar-title');
    const periodo = titleEl ? titleEl.textContent.trim() : '';
    const ufSelect = document.getElementById('selectUf');
    const uf = ufSelect && ufSelect.selectedIndex > 0
      ? ufSelect.options[ufSelect.selectedIndex].text.trim()
      : '';
    const { data, hora } = window.__sigcPro.timestampSlug();
    return ['sigc-pro-agenda', slug(uf), slug(periodo), data, hora].filter(Boolean).join('_');
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

  function insertButton(chunk) {
    if (document.getElementById(BUTTON_ID)) return;

    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    // FullCalendar's own button classes give correct box metrics/spacing
    // next to Dia/Semana; only color is overridden to read as SIGC-PRO,
    // same reasoning as csv-export.js reusing dt-btn-icon.
    btn.className = 'fc-button fc-button-primary';
    btn.textContent = 'CSV-PRO';
    btn.title = 'Exportar slots da agenda (SIGC-PRO)';
    btn.style.background = '#005a9c';
    btn.style.borderColor = '#005a9c';
    btn.style.marginLeft = '4px';
    btn.addEventListener('click', exportAgendaCsv);
    chunk.appendChild(btn);

    console.log(`${TAG} Agenda CSV-pro button added.`);
  }

  // FullCalendar re-renders its toolbar (virtual-DOM diffed) on view/date
  // navigation, which can wipe a foreign button we injected — same failure
  // mode ROADMAP.md notes for the Lista de Endereços toolbar, same fix:
  // idempotent insert + MutationObserver re-insert.
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
