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
// internally. Visible in both Dia and Semana view, right after the
// toolbar's date-range title.
(function () {
  'use strict';

  const TAG = '[sigc-agenda-date-picker]';
  const WRAP_ID = 'sigc-pro-agenda-date-picker';

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

  // Placed right after the toolbar's date-range title (e.g. "12/07/2026 –
  // 18/07/2026"), not the Dia/Semana chunk other SIGC-PRO buttons use —
  // this reads more like "the date, and a way to change it" together.
  function findTitle() {
    return document.querySelector('.fc-toolbar-title');
  }

  // Native <input type="date"> can't be styled down to just its icon —
  // Chrome renders dd/mm/yyyy as separate focusable segments that fight
  // shrinking/hiding. Instead: a plain icon button the user actually
  // sees/clicks, plus an invisible (opacity:0, but layout-participating —
  // showPicker() throws on display:none) date input right behind it that
  // supplies the native calendar popup and fires gotoDate on change.
  function buildPicker() {
    const wrap = document.createElement('span');
    wrap.id = WRAP_ID;
    wrap.style.position = 'relative';
    wrap.style.display = 'inline-flex';
    wrap.style.verticalAlign = 'middle';
    wrap.style.marginLeft = '.5em';

    // 🗓️ (spiral calendar), not 📅: several platforms render 📅 as a
    // torn-page desk calendar with a fixed "17" printed on it — decorative
    // art baked into the glyph, not a live date — which reads as a stuck
    // clock. 🗓️ has no date printed on it.
    const btn = window.__sigcPro.makeFcProButton({
      text: '🗓️',
      title: 'Ir para a data (SIGC-PRO)',
    });
    // Icon-only button: tighter box than the factory's toolbar default;
    // the wrap owns the outer margin.
    btn.style.marginLeft = '0';
    btn.style.lineHeight = '1';
    btn.style.padding = '.2em .3em';

    const input = document.createElement('input');
    input.type = 'date';
    input.tabIndex = -1;
    input.style.position = 'absolute';
    input.style.inset = '0';
    input.style.width = '100%';
    input.style.height = '100%';
    input.style.opacity = '0';
    input.style.pointerEvents = 'none';

    btn.addEventListener('click', () => {
      const api = getCalendarApi();
      if (api) input.value = window.__sigcPro.dateToIso(api.getDate());
      if (typeof input.showPicker === 'function') input.showPicker();
    });

    input.addEventListener('change', () => {
      if (!input.value) return;
      const api = getCalendarApi();
      if (!api) {
        console.warn(`${TAG} instância do FullCalendar não encontrada — não foi possível navegar.`);
        return;
      }
      api.gotoDate(input.value);
    });

    wrap.appendChild(btn);
    wrap.appendChild(input);
    console.log(`${TAG} date picker added.`);
    return wrap;
  }

  window.__sigcPro.mountWidget({
    id: WRAP_ID,
    anchor: () => findTitle(),
    when: (ctx) => ctx.onAgenda(),
    build: buildPicker,
  });
})();
