import { describe, test, expect } from 'bun:test';

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

  test('calls recheckMounts when a flags event arrives', () => {
    let called = false;
    const original = P.recheckMounts;
    P.recheckMounts = () => { called = true; };
    try {
      window.dispatchEvent(new CustomEvent('sigc-pro-advanced-flags', {
        detail: { flags: { ultimoMovimentoExport: false } },
      }));
      expect(called).toBe(true);
    } finally {
      P.recheckMounts = original;
    }
  });
});
