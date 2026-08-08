import { describe, test, expect } from 'bun:test';

await import('../extension/common/sigc-common.js');
await import('../extension/features/ultimo-movimento-map/ultimo-movimento-map.js');

const UM = window.__sigcProUltimoMovimentoMapInternals;

describe('parseUltimoMovimentoRows', () => {
  test('maps Controle+Domicilio to full row data by header label', () => {
    const headers = ['Controle', 'Domicilio', 'Entrevistador', 'Tipo de Entrevista', 'Última Posição', 'Data'];
    const rows = [
      ['290570120000125', '1', 'Fulano de Tal', 'Realizada', 'Transmitido', '01/08/2026'],
      ['290570120000125', '2', 'Fulano de Tal', 'Não Iniciada', 'Distribuido', ''],
    ];
    const map = UM.parseUltimoMovimentoRows(headers, rows);
    expect(map.get('290570120000125|1')).toEqual({
      controle: '290570120000125', domicilio: '1', entrevistador: 'Fulano de Tal',
      tipoEntrevista: 'Realizada', ultimaPosicao: 'Transmitido', data: '01/08/2026',
    });
    expect(map.get('290570120000125|2').tipoEntrevista).toBe('Não Iniciada');
  });

  test('is tolerant of header order', () => {
    const headers = ['Data', 'Última Posição', 'Tipo de Entrevista', 'Entrevistador', 'Domicilio', 'Controle'];
    const rows = [['01/08/2026', 'Transmitido', 'Realizada', 'Fulano', 'D1', 'C1']];
    const map = UM.parseUltimoMovimentoRows(headers, rows);
    expect(map.get('C1|D1').entrevistador).toBe('Fulano');
  });

  test('returns null when a required header is missing', () => {
    const headers = ['Controle', 'Domicilio', 'Situação'];
    const rows = [['C1', 'D1', 'x']];
    expect(UM.parseUltimoMovimentoRows(headers, rows)).toBeNull();
  });
});

describe('joinEnderecos', () => {
  const movimentoMap = new Map([
    ['C1|1', { controle: 'C1', domicilio: '1', entrevistador: 'A', tipoEntrevista: 'Realizada', ultimaPosicao: 'Transmitido', data: '01/08/2026' }],
    ['C1|2', { controle: 'C1', domicilio: '2', entrevistador: 'A', tipoEntrevista: 'Não Iniciada', ultimaPosicao: 'Distribuido', data: '' }],
  ]);

  test('joins coordinates and zona by controle|domicilio', () => {
    const enderecosMap = new Map([
      ['C1|1', { lat: -8.5, lon: -63.8, zona: 'ESCOLA POLICIA', idZona: '11.1.01.08' }],
    ]);
    const joined = UM.joinEnderecos(movimentoMap, enderecosMap);
    const d1 = joined.find((r) => r.domicilio === '1');
    expect(d1).toMatchObject({ lat: -8.5, lon: -63.8, zona: 'ESCOLA POLICIA', idZona: '11.1.01.08', temCoordenadas: true, temZona: true });
  });

  test('a household missing from enderecosMap gets temCoordenadas/temZona false, not dropped', () => {
    const joined = UM.joinEnderecos(movimentoMap, new Map());
    expect(joined).toHaveLength(2);
    joined.forEach((r) => {
      expect(r.temCoordenadas).toBe(false);
      expect(r.temZona).toBe(false);
      expect(r.lat).toBeNull();
      expect(r.lon).toBeNull();
    });
  });

  test('a household with zona but no valid coordinates keeps temZona true, temCoordenadas false', () => {
    const enderecosMap = new Map([
      ['C1|1', { lat: null, lon: null, zona: 'ESCOLA POLICIA', idZona: '11.1.01.08' }],
    ]);
    const joined = UM.joinEnderecos(movimentoMap, enderecosMap);
    const d1 = joined.find((r) => r.domicilio === '1');
    expect(d1.temZona).toBe(true);
    expect(d1.temCoordenadas).toBe(false);
  });
});
