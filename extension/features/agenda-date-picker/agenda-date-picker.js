// SIGC-PRO feature: date-picker button on the Agenda toolbar. SIGC's own
// page holds a live FullCalendar instance, but not at a stable global —
// `window.calendar` resolves to the `<div id="calendar">` element itself
// (DOM's automatic named-element access), not the Calendar object.
// The real instance lives deep inside Preact's fiber tree (confirmed
// 2026-07-17 via DevTools), at __k.props.children[0].props.emitter.
// thisContext — an ordinary-looking property path, not a
// framework-prefixed one, so the search below walks any object property
// (with a visited-set to survive the tree's circular refs) rather than
// filtering by key name. calendar.gotoDate(iso) navigates the real
// calendar exactly like SIGC's own atualizarCalendario() helper does
// internally. Visible in both Dia and Semana view, next to the other
// Agenda buttons.
(function () {
  'use strict';

  const TAG = '[sigc-agenda-date-picker]';
  const BUTTON_ID = 'sigc-pro-agenda-date-picker';

  function isoDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // Preact re-renders can replace the fiber tree, so this is re-run on
  // every use rather than cached — same reasoning as the MutationObserver
  // below that keeps re-inserting our own button. The tree has circular
  // references (fiber.__ / .__P / .base point back at ancestors), hence
  // the visited set; depth is capped as a second safety net.
  function findCalendarApi(root) {
    const seen = new Set();
    function walk(el, depth) {
      if (!el || typeof el !== 'object' || depth > 12 || seen.has(el)) return null;
      seen.add(el);
      if (typeof el.getDate === 'function' && typeof el.gotoDate === 'function') return el;
      for (const key of Object.keys(el)) {
        const found = walk(el[key], depth + 1);
        if (found) return found;
      }
      return null;
    }
    return walk(root, 0);
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
