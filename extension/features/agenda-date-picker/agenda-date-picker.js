// SIGC-PRO feature: date-picker button on the Agenda toolbar. SIGC's own
// page exposes a live FullCalendar instance at window.calendar (confirmed
// 2026-07-17 via DevTools: window.calendar.gotoDate(iso) navigates the
// real calendar, same as its own atualizarCalendario() helper does
// internally) — so this jumps straight to a date instead of simulating
// clicks on the prev/next arrows. Visible in both Dia and Semana view,
// next to the other Agenda buttons.
(function () {
  'use strict';

  const TAG = '[sigc-agenda-date-picker]';
  const BUTTON_ID = 'sigc-pro-agenda-date-picker';

  function isoDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function insertButton(chunk) {
    if (document.getElementById(BUTTON_ID)) return;

    const input = document.createElement('input');
    input.id = BUTTON_ID;
    input.type = 'date';
    input.title = 'Ir para a data (SIGC-PRO)';
    input.className = 'fc-button fc-button-primary';
    input.style.background = '#005a9c';
    input.style.borderColor = '#005a9c';
    input.style.color = '#fff';
    input.style.marginLeft = '4px';
    input.style.colorScheme = 'dark';

    input.addEventListener('focus', () => {
      if (typeof window.calendar !== 'object' || !window.calendar) return;
      input.value = isoDate(window.calendar.getDate());
    });

    input.addEventListener('change', () => {
      if (!input.value) return;
      if (typeof window.calendar !== 'object' || !window.calendar) {
        console.warn(`${TAG} window.calendar não encontrado — não foi possível navegar.`);
        return;
      }
      window.calendar.gotoDate(input.value);
    });

    chunk.appendChild(input);
    console.log(`${TAG} date picker added.`);
  }

  window.__sigcPro.whenReadyGeneric(
    () => window.__sigcPro.onAgendaPage() && window.__sigcPro.findAgendaToolbarChunk(),
    () => {
      const tryUpdate = () => {
        const existing = document.getElementById(BUTTON_ID);
        const chunk = window.__sigcPro.findAgendaToolbarChunk();
        if (window.__sigcPro.onAgendaPage() && chunk) {
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
})();
