import { describe, test, expect, beforeEach } from 'bun:test';

await import('../extension/common/sigc-common.js');
await import('../extension/features/settings/settings.js');
const P = window.__sigcPro;

describe('settings.isEnabled', () => {
  test('defaults to false before any flags event arrives', () => {
    expect(P.settings.isEnabled('ultimoMovimentoExport')).toBe(false);
  });

  test('reflects the value from a sigc-pro-advanced-flags event', () => {
    window.dispatchEvent(new CustomEvent('sigc-pro-advanced-flags', {
      detail: { flags: { ultimoMovimentoExport: true } },
    }));
    expect(P.settings.isEnabled('ultimoMovimentoExport')).toBe(true);
  });

  test('unknown flag name defaults to false', () => {
    expect(P.settings.isEnabled('somethingNeverSet')).toBe(false);
  });
});

describe('settings.setFlag', () => {
  test('dispatches a sigc-pro-set-advanced-flag event with the given name/value', () => {
    let received = null;
    window.addEventListener('sigc-pro-set-advanced-flag', (e) => { received = e.detail; }, { once: true });
    P.settings.setFlag('ultimoMovimentoExport', true);
    expect(received).toEqual({ name: 'ultimoMovimentoExport', value: true });
  });

  test('updates the local cache optimistically before the relay confirms', () => {
    P.settings.setFlag('ultimoMovimentoExport', false);
    expect(P.settings.isEnabled('ultimoMovimentoExport')).toBe(false);
  });
});
