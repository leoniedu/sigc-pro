// SIGC-PRO feature: date-picker button on the Agenda toolbar. SIGC's own
// page holds a live FullCalendar instance, but not at a stable global —
// `window.calendar` resolves to the `<div id="calendar">` element itself
// (DOM's automatic named-element access), not the Calendar object.
// The real instance only lives inside Preact's internal fiber tree
// attached to that element (confirmed 2026-07-17 via DevTools: walking
// __k/__reactFiber*/__reactProps* until an object exposes both
// getDate/gotoDate finds it, and calendar.gotoDate(iso) navigates the
// real calendar exactly like SIGC's own atualizarCalendario() helper
// does internally). Visible in both Dia and Semana view, next to the
// other Agenda buttons.
(function () {
  'use strict';

  const TAG = '[sigc-agenda-date-picker]';
  const BUTTON_ID = 'sigc-pro-agenda-date-picker';

  function isoDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // Preact re-renders can replace the fiber tree, so this is re-run on
  // every use rather than cached — same reasoning as the MutationObserver
  // below that keeps re-inserting our own button.
  function findCalendarApi(el, depth) {
    depth = depth || 0;
    if (!el || depth > 25) return null;
    if (typeof el === 'object' && typeof el.getDate === 'function' && typeof el.gotoDate === 'function') {
      return el;
    }
    if (typeof el !== 'object') return null;
    for (const key of Object.keys(el)) {
      if (key.startsWith('__k') || key.startsWith('__reactFiber') || key.startsWith('__reactProps')) {
        const found = findCalendarApi(el[key], depth + 1);
        if (found) return found;
      }
    }
    return null;
  }

  function getCalendarApi() {
    const root = document.getElementById('calendar');
    return root ? findCalendarApi(root) : null;
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
    input.style.color = 'transparent';
    input.style.marginLeft = '4px';
    input.style.colorScheme = 'dark';
    // Icon-only: shrink to the native picker-indicator's width and hide
    // the dd/mm/yyyy text (still present, just transparent) so only the
    // calendar glyph the browser draws is visible/clickable.
    input.style.width = '2.1em';
    input.style.padding = '.35em .3em';
    input.style.overflow = 'hidden';

    input.addEventListener('focus', () => {
      const api = getCalendarApi();
      if (api) input.value = isoDate(api.getDate());
    });

    function goToPicked() {
      if (!input.value) return;
      const api = getCalendarApi();
      if (!api) {
        console.warn(`${TAG} instância do FullCalendar não encontrada — não foi possível navegar.`);
        return;
      }
      api.gotoDate(input.value);
    }
    input.addEventListener('change', goToPicked);

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
