import { describe, test, expect } from 'bun:test';

await import('../extension/common/sigc-common.js');
await import('../extension/features/agenda-day-guide/agenda-day-guide.js');

const { zonaFullLabel } = window.__sigcProAgendaDayGuideInternals;

describe('zonaFullLabel', () => {
  test('ID + nome when both are present', () => {
    expect(zonaFullLabel({ idZona: '29A3OI', zona: 'Centro' })).toBe('29A3OI Centro');
  });

  test('ID alone when nome is missing', () => {
    expect(zonaFullLabel({ idZona: '29A3OI', zona: '' })).toBe('29A3OI');
    expect(zonaFullLabel({ idZona: '29A3OI', zona: null })).toBe('29A3OI');
  });

  test('empty string when there is no idZona, even with a nome present', () => {
    expect(zonaFullLabel({ idZona: '', zona: 'Centro' })).toBe('');
    expect(zonaFullLabel({ idZona: null, zona: 'Centro' })).toBe('');
  });

  test('empty string when info is null', () => {
    expect(zonaFullLabel(null)).toBe('');
  });
});
