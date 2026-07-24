// SIGC-PRO feature: advanced-flags settings. MAIN-world half of the
// settings feature — settings-relay.js (ISOLATED world) is the only file
// in this directory allowed to touch chrome.storage; this file never
// does, since chrome.* is unavailable in MAIN world. The two communicate
// via CustomEvents on the shared DOM window (MAIN/ISOLATED worlds have
// separate `window` objects but the same document, and DOM event
// dispatch crosses that boundary).
//
// Advanced flags gate features whose request pattern is riskier than the
// rest of the extension's read-only DOM access (e.g. ultimo-movimento-export's
// multi-agência fetch loop) — off by default, so the feature is invisible
// until a user deliberately opts in.
// Spec: docs/superpowers/specs/2026-07-24-ultimo-movimento-multi-agencia-export-design.md
(function () {
  'use strict';

  const TAG = '[sigc-settings]';
  const BUTTON_ID = 'sigc-pro-settings-button';

  // In-memory cache of the last known flag values, kept in sync with
  // chrome.storage via settings-relay.js's events. Starts empty: every
  // flag defaults to false (isEnabled) until the relay's first message
  // lands, which happens automatically on load — no feature should ever
  // block waiting for it, since "off by default" is itself a safe value.
  let flagsCache = {};

  window.addEventListener('sigc-pro-advanced-flags', (e) => {
    flagsCache = (e.detail && e.detail.flags) || {};
    console.log(`${TAG} flags updated:`, flagsCache);
    if (window.__sigcPro && window.__sigcPro.recheckMounts) {
      window.__sigcPro.recheckMounts();
    }
  });

  function isEnabled(name) {
    return flagsCache[name] === true;
  }

  function setFlag(name, value) {
    flagsCache = Object.assign({}, flagsCache, { [name]: value });
    window.dispatchEvent(new CustomEvent('sigc-pro-set-advanced-flag', {
      detail: { name, value },
    }));
  }

  function toggleUltimoMovimentoExport() {
    const next = !isEnabled('ultimoMovimentoExport');
    const msg = next
      ? 'SIGC-PRO: ativar a exportação avançada de Último Movimento ' +
        '(multi-agência)? Isso fará várias requisições ao próprio ' +
        'servidor do SIGC quando usada.'
      : 'SIGC-PRO: desativar a exportação avançada de Último Movimento?';
    if (!confirm(msg)) return;
    setFlag('ultimoMovimentoExport', next);
    alert(next
      ? 'SIGC-PRO: exportação avançada ativada — o botão aparecerá em Último Movimento.'
      : 'SIGC-PRO: exportação avançada desativada.');
  }

  // Mounted on every SIGC page (no report-specific anchor exists that's
  // guaranteed present everywhere), fixed-position so it doesn't depend
  // on any particular page's layout.
  window.__sigcPro.mountWidget({
    id: BUTTON_ID,
    anchor: () => document.body,
    when: () => true,
    build: () => {
      const btn = document.createElement('button');
      btn.id = BUTTON_ID;
      btn.type = 'button';
      btn.textContent = '⚙ SIGC-PRO';
      btn.title = 'SIGC-PRO: configurações avançadas';
      btn.style.position = 'fixed';
      btn.style.bottom = '8px';
      btn.style.right = '8px';
      btn.style.zIndex = '2147483647';
      btn.style.background = '#005a9c';
      btn.style.color = '#fff';
      btn.style.border = 'none';
      btn.style.borderRadius = '4px';
      btn.style.padding = '4px 8px';
      btn.style.fontSize = '11px';
      btn.style.cursor = 'pointer';
      btn.addEventListener('click', toggleUltimoMovimentoExport);
      return btn;
    },
  });

  window.__sigcPro.settings = { isEnabled, setFlag };
  console.log(`${TAG} settings runtime loaded.`);
})();
