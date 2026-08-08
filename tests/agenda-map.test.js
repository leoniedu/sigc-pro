import { describe, test, expect } from 'bun:test';

await import('../extension/common/sigc-common.js');
await import('../extension/features/agenda-map/agenda-map.js');

const AM = window.__sigcProAgendaMapInternals;

describe('filtrarUrl', () => {
  const origin = 'https://portalweb.ibge.gov.br';
  const F5_HEX = '68747470733a2f2f773373696763706e73323032352e696267652e676f762e6272';
  const F5_PATHNAME = `/f5-w-${F5_HEX}$$/UltimoMovimento`;

  test('ListaEnderecos slug, simple mode, direct host', () => {
    expect(AM.filtrarUrl(origin, '/Agenda', 'ListaEnderecos', true))
      .toBe(`${origin}/relatorio/filtrar?slug=ListaEnderecos`);
  });

  test('relatorio-ultimo-movimento slug, simple mode, F5 gateway', () => {
    expect(AM.filtrarUrl(origin, F5_PATHNAME, 'relatorio-ultimo-movimento', true))
      .toBe(`${origin}/f5-w-${F5_HEX}$$/relatorio/filtrar?slug=relatorio-ultimo-movimento`);
  });

  test('relatorio-ultimo-movimento slug, fallback mode, F5 gateway', () => {
    expect(AM.filtrarUrl(origin, F5_PATHNAME, 'relatorio-ultimo-movimento', false))
      .toBe(`${origin}/f5-w-${F5_HEX}$$/relatorio/f5-h-$$/relatorio/filtrar?slug=relatorio-ultimo-movimento;F5_origin=${F5_HEX}&F5CH=I`);
  });
});

describe('parseUltimoMovimentoTable', () => {
  test('maps Controle+Domicílio to {entrevistador} by header label', () => {
    const headers = ['Controle', 'Domicilio', 'Entrevistador', 'Situação'];
    const rows = [
      ['290570120000125', '1', 'Fulano de Tal', 'Entrevistado'],
      ['290570120000999', '3', 'Beltrano da Silva', 'Pendente'],
    ];
    const map = AM.parseUltimoMovimentoTable(headers, rows);
    expect(map.get('290570120000125|1')).toEqual({ entrevistador: 'Fulano de Tal' });
    expect(map.get('290570120000999|3')).toEqual({ entrevistador: 'Beltrano da Silva' });
  });

  test('is tolerant of header order and extra columns', () => {
    const headers = ['Situação', 'Entrevistador', 'Domicilio', 'Controle'];
    const rows = [['Entrevistado', 'Fulano', 'D1', 'C1']];
    const map = AM.parseUltimoMovimentoTable(headers, rows);
    expect(map.get('C1|D1')).toEqual({ entrevistador: 'Fulano' });
  });

  test('returns null when a required header is missing', () => {
    const headers = ['Controle', 'Domicilio', 'Situação'];
    const rows = [['C1', 'D1', 'Entrevistado']];
    expect(AM.parseUltimoMovimentoTable(headers, rows)).toBeNull();
  });

  test('returns null when Domicilio itself is missing (fail-closed, same as Controle/Entrevistador)', () => {
    const headers = ['Controle', 'Entrevistador'];
    const rows = [['C1', 'Fulano']];
    expect(AM.parseUltimoMovimentoTable(headers, rows)).toBeNull();
  });

  test('skips rows with a blank Controle', () => {
    const headers = ['Controle', 'Domicilio', 'Entrevistador'];
    const rows = [['', 'D1', 'Fulano'], ['C1', 'D1', 'Fulano']];
    const map = AM.parseUltimoMovimentoTable(headers, rows);
    expect(map.size).toBe(1);
    expect(map.has('C1|D1')).toBe(true);
  });

  test('tolerates the live #!/! header marker (real live header row, 2026-08-07)', () => {
    const headers = ['#!Controle', '!Domicílio', 'Entrevistador', 'Tipo Entrevista', 'Última Posição', 'Data', 'Observação'];
    const rows = [['292740805220571', '1', 'Fulano de Tal', 'Realizada', 'Descarregado', '07/08/2026 10:27:20', '']];
    const map = AM.parseUltimoMovimentoTable(headers, rows);
    expect(map.get('292740805220571|1')).toEqual({ entrevistador: 'Fulano de Tal' });
  });

  test('still resolves the old unmarked header form (no #!/! prefix)', () => {
    const headers = ['Controle', 'Domicilio', 'Entrevistador'];
    const rows = [['C1', 'D1', 'Fulano']];
    const map = AM.parseUltimoMovimentoTable(headers, rows);
    expect(map.get('C1|D1')).toEqual({ entrevistador: 'Fulano' });
  });

  test('trims whitespace from cell values, including Domicilio', () => {
    const headers = ['Controle', 'Domicilio', 'Entrevistador'];
    const rows = [[' C1 ', ' D1 ', ' Fulano de Tal ']];
    const map = AM.parseUltimoMovimentoTable(headers, rows);
    expect(map.get('C1|D1')).toEqual({ entrevistador: 'Fulano de Tal' });
  });

  test('two Domicílios under the same Controle keep their own distinct Entrevistador (regression: used to collapse to one per Controle)', () => {
    const headers = ['Controle', 'Domicilio', 'Entrevistador'];
    const rows = [
      ['292740805180317', '1', 'Fulano de Tal'],
      ['292740805180317', '2', 'Beltrano da Silva'],
    ];
    const map = AM.parseUltimoMovimentoTable(headers, rows);
    expect(map.get('292740805180317|1')).toEqual({ entrevistador: 'Fulano de Tal' });
    expect(map.get('292740805180317|2')).toEqual({ entrevistador: 'Beltrano da Silva' });
    expect(map.size).toBe(2);
  });
});

describe('mergeUltimoMovimento', () => {
  test('adds entrevistador by matching the full controle|domicilio key, not just controle', () => {
    const enderecos = new Map([
      ['C1|D1', { lat: -12.9, lon: -38.5, zona: 'Centro', idZona: 'Z1' }],
      ['C1|D2', { lat: -12.8, lon: -38.4, zona: 'Centro', idZona: 'Z1' }],
      ['C2|D1', { lat: -13.0, lon: -38.6, zona: 'Norte', idZona: 'Z2' }],
    ]);
    const umMap = new Map([
      ['C1|D1', { entrevistador: 'Fulano' }],
      ['C1|D2', { entrevistador: 'Beltrano' }],
    ]);
    const merged = AM.mergeUltimoMovimento(enderecos, umMap);
    expect(merged.get('C1|D1')).toEqual({ lat: -12.9, lon: -38.5, zona: 'Centro', idZona: 'Z1', entrevistador: 'Fulano' });
    expect(merged.get('C1|D2')).toEqual({ lat: -12.8, lon: -38.4, zona: 'Centro', idZona: 'Z1', entrevistador: 'Beltrano' });
    // C2|D1 has no Último Movimento match: passes through untouched.
    expect(merged.get('C2|D1')).toEqual({ lat: -13.0, lon: -38.6, zona: 'Norte', idZona: 'Z2' });
  });

  test('returns the original map unchanged when umMap is empty', () => {
    const enderecos = new Map([['C1|D1', { lat: -12.9, lon: -38.5 }]]);
    const merged = AM.mergeUltimoMovimento(enderecos, new Map());
    expect(merged.get('C1|D1')).toEqual({ lat: -12.9, lon: -38.5 });
  });

  test('does not mutate the input enderecos map', () => {
    const original = { lat: -12.9, lon: -38.5 };
    const enderecos = new Map([['C1|D1', original]]);
    AM.mergeUltimoMovimento(enderecos, new Map([['C1|D1', { entrevistador: 'Fulano' }]]));
    expect(original).toEqual({ lat: -12.9, lon: -38.5 });
  });
});

describe('parseDistribuicaoTable', () => {
  test('maps Controle to {agencia} using Agência Distribuida (not Sugerida)', () => {
    const headers = ['Controle', 'Município', 'Agência Sugerida', 'Agência Distribuida', 'Data Distribuição', 'Usuário da Distribuição'];
    const rows = [
      ['292370405000008', 'PARATINGA', 'BOM JESUS DA LAPA (sugerida)', 'BOM JESUS DA LAPA', '07/07/2026 00:00:00', 'EDUARDO LACRETA LEONI'],
    ];
    const map = AM.parseDistribuicaoTable(headers, rows);
    expect(map.get('292370405000008')).toEqual({ agencia: 'BOM JESUS DA LAPA' });
  });

  test('is tolerant of header order and extra columns', () => {
    const headers = ['Usuário da Distribuição', 'Agência Distribuida', 'Controle', 'Agência Sugerida'];
    const rows = [['Fulano', 'A1', 'C1', 'A0 (sugerida)']];
    const map = AM.parseDistribuicaoTable(headers, rows);
    expect(map.get('C1')).toEqual({ agencia: 'A1' });
  });

  test('returns null when Agência Distribuida is missing (Sugerida alone does not satisfy it)', () => {
    const headers = ['Controle', 'Agência Sugerida'];
    const rows = [['C1', 'A0']];
    expect(AM.parseDistribuicaoTable(headers, rows)).toBeNull();
  });

  test('returns null when Controle is missing', () => {
    const headers = ['Agência Distribuida'];
    const rows = [['A1']];
    expect(AM.parseDistribuicaoTable(headers, rows)).toBeNull();
  });

  test('skips rows with a blank Controle', () => {
    const headers = ['Controle', 'Agência Distribuida'];
    const rows = [['', 'A1'], ['C1', 'A1']];
    const map = AM.parseDistribuicaoTable(headers, rows);
    expect(map.size).toBe(1);
    expect(map.has('C1')).toBe(true);
  });

  test('trims whitespace from cell values', () => {
    const headers = ['Controle', 'Agência Distribuida'];
    const rows = [[' C1 ', ' BOM JESUS DA LAPA ']];
    const map = AM.parseDistribuicaoTable(headers, rows);
    expect(map.get('C1')).toEqual({ agencia: 'BOM JESUS DA LAPA' });
  });
});

describe('mergeDistribuicao', () => {
  test('adds agencia to every entry sharing that Controle', () => {
    const enderecos = new Map([
      ['C1|D1', { lat: -12.9, lon: -38.5, entrevistador: 'Fulano' }],
      ['C1|D2', { lat: -12.8, lon: -38.4, entrevistador: 'Fulano' }],
      ['C2|D1', { lat: -13.0, lon: -38.6 }],
    ]);
    const distMap = new Map([
      ['C1', { agencia: 'BOM JESUS DA LAPA' }],
    ]);
    const merged = AM.mergeDistribuicao(enderecos, distMap);
    expect(merged.get('C1|D1')).toEqual({ lat: -12.9, lon: -38.5, entrevistador: 'Fulano', agencia: 'BOM JESUS DA LAPA' });
    expect(merged.get('C1|D2')).toEqual({ lat: -12.8, lon: -38.4, entrevistador: 'Fulano', agencia: 'BOM JESUS DA LAPA' });
    expect(merged.get('C2|D1')).toEqual({ lat: -13.0, lon: -38.6 });
  });

  test('returns entries unchanged when distMap is empty', () => {
    const enderecos = new Map([['C1|D1', { lat: -12.9, lon: -38.5 }]]);
    const merged = AM.mergeDistribuicao(enderecos, new Map());
    expect(merged.get('C1|D1')).toEqual({ lat: -12.9, lon: -38.5 });
  });

  test('does not mutate the input enderecos map', () => {
    const original = { lat: -12.9, lon: -38.5 };
    const enderecos = new Map([['C1|D1', original]]);
    AM.mergeDistribuicao(enderecos, new Map([['C1', { agencia: 'A1' }]]));
    expect(original).toEqual({ lat: -12.9, lon: -38.5 });
  });
});
