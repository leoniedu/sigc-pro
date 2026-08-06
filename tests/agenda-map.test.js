import { describe, test, expect } from 'bun:test';

await import('../extension/common/sigc-common.js');
await import('../extension/features/agenda-map/agenda-map.js');

const AM = window.__sigcProAgendaMapInternals;

describe('parseUltimoMovimentoTable', () => {
  test('maps Controle to {agencia, entrevistador} by header label', () => {
    const headers = ['Controle', 'Agência', 'Entrevistador', 'Situação'];
    const rows = [
      ['290570120000125', '290570100', 'Fulano de Tal', 'Entrevistado'],
      ['290570120000999', '290570200', 'Beltrano da Silva', 'Pendente'],
    ];
    const map = AM.parseUltimoMovimentoTable(headers, rows);
    expect(map.get('290570120000125')).toEqual({ agencia: '290570100', entrevistador: 'Fulano de Tal' });
    expect(map.get('290570120000999')).toEqual({ agencia: '290570200', entrevistador: 'Beltrano da Silva' });
  });

  test('is tolerant of header order and extra columns', () => {
    const headers = ['Situação', 'Entrevistador', 'Controle', 'Agência'];
    const rows = [['Entrevistado', 'Fulano', 'C1', 'A1']];
    const map = AM.parseUltimoMovimentoTable(headers, rows);
    expect(map.get('C1')).toEqual({ agencia: 'A1', entrevistador: 'Fulano' });
  });

  test('returns null when a required header is missing', () => {
    const headers = ['Controle', 'Situação'];
    const rows = [['C1', 'Entrevistado']];
    expect(AM.parseUltimoMovimentoTable(headers, rows)).toBeNull();
  });

  test('skips rows with a blank Controle', () => {
    const headers = ['Controle', 'Agência', 'Entrevistador'];
    const rows = [['', 'A1', 'Fulano'], ['C1', 'A1', 'Fulano']];
    const map = AM.parseUltimoMovimentoTable(headers, rows);
    expect(map.size).toBe(1);
    expect(map.has('C1')).toBe(true);
  });

  test('trims whitespace from cell values', () => {
    const headers = ['Controle', 'Agência', 'Entrevistador'];
    const rows = [[' C1 ', ' A1 ', ' Fulano de Tal ']];
    const map = AM.parseUltimoMovimentoTable(headers, rows);
    expect(map.get('C1')).toEqual({ agencia: 'A1', entrevistador: 'Fulano de Tal' });
  });
});
