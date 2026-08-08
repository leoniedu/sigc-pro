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
  test('maps Controle to {entrevistador} by header label', () => {
    const headers = ['Controle', 'Entrevistador', 'Situação'];
    const rows = [
      ['290570120000125', 'Fulano de Tal', 'Entrevistado'],
      ['290570120000999', 'Beltrano da Silva', 'Pendente'],
    ];
    const map = AM.parseUltimoMovimentoTable(headers, rows);
    expect(map.get('290570120000125')).toEqual({ entrevistador: 'Fulano de Tal' });
    expect(map.get('290570120000999')).toEqual({ entrevistador: 'Beltrano da Silva' });
  });

  test('is tolerant of header order and extra columns', () => {
    const headers = ['Situação', 'Entrevistador', 'Controle'];
    const rows = [['Entrevistado', 'Fulano', 'C1']];
    const map = AM.parseUltimoMovimentoTable(headers, rows);
    expect(map.get('C1')).toEqual({ entrevistador: 'Fulano' });
  });

  test('returns null when a required header is missing', () => {
    const headers = ['Controle', 'Situação'];
    const rows = [['C1', 'Entrevistado']];
    expect(AM.parseUltimoMovimentoTable(headers, rows)).toBeNull();
  });

  test('skips rows with a blank Controle', () => {
    const headers = ['Controle', 'Entrevistador'];
    const rows = [['', 'Fulano'], ['C1', 'Fulano']];
    const map = AM.parseUltimoMovimentoTable(headers, rows);
    expect(map.size).toBe(1);
    expect(map.has('C1')).toBe(true);
  });

  test('tolerates the live #!/! header marker (real live header row, 2026-08-07)', () => {
    const headers = ['#!Controle', '!Domicílio', 'Entrevistador', 'Tipo Entrevista', 'Última Posição', 'Data', 'Observação'];
    const rows = [['292740805220571', '1', 'Fulano de Tal', 'Realizada', 'Descarregado', '07/08/2026 10:27:20', '']];
    const map = AM.parseUltimoMovimentoTable(headers, rows);
    expect(map.get('292740805220571')).toEqual({ entrevistador: 'Fulano de Tal' });
  });

  test('still resolves the old unmarked header form (no #!/! prefix)', () => {
    const headers = ['Controle', 'Entrevistador'];
    const rows = [['C1', 'Fulano']];
    const map = AM.parseUltimoMovimentoTable(headers, rows);
    expect(map.get('C1')).toEqual({ entrevistador: 'Fulano' });
  });

  test('trims whitespace from cell values', () => {
    const headers = ['Controle', 'Entrevistador'];
    const rows = [[' C1 ', ' Fulano de Tal ']];
    const map = AM.parseUltimoMovimentoTable(headers, rows);
    expect(map.get('C1')).toEqual({ entrevistador: 'Fulano de Tal' });
  });

  // Regression guard: this is the REAL header row captured live from
  // #tb_ultimo_movimento (2026-08-06) — it has no Agência column. A
  // prior version of this parser required Agência to be present and
  // silently returned null for every real response as a result, which
  // zeroed out Entrevistador too even though its own column was fine.
  // This test pins the parser against the live shape so that regression
  // can't recur silently.
  test('resolves against the real live header row (no Agência column)', () => {
    const headers = ['Controle ', 'Domicilio', 'Entrevistador', 'Tipo de Entrevista', 'Última Posição', 'Data', 'Observação'];
    const rows = [['292740805220571', '1', 'Fulano de Tal', 'Entrevista', '01/01/2026', '01/01/2026 10:00:00', '']];
    const map = AM.parseUltimoMovimentoTable(headers, rows);
    expect(map.get('292740805220571')).toEqual({ entrevistador: 'Fulano de Tal' });
  });
});

describe('mergeUltimoMovimento', () => {
  test('adds entrevistador to every entry sharing that Controle', () => {
    const enderecos = new Map([
      ['C1|D1', { lat: -12.9, lon: -38.5, zona: 'Centro', idZona: 'Z1' }],
      ['C1|D2', { lat: -12.8, lon: -38.4, zona: 'Centro', idZona: 'Z1' }],
      ['C2|D1', { lat: -13.0, lon: -38.6, zona: 'Norte', idZona: 'Z2' }],
    ]);
    const umMap = new Map([
      ['C1', { entrevistador: 'Fulano' }],
    ]);
    const merged = AM.mergeUltimoMovimento(enderecos, umMap);
    expect(merged.get('C1|D1')).toEqual({ lat: -12.9, lon: -38.5, zona: 'Centro', idZona: 'Z1', entrevistador: 'Fulano' });
    expect(merged.get('C1|D2')).toEqual({ lat: -12.8, lon: -38.4, zona: 'Centro', idZona: 'Z1', entrevistador: 'Fulano' });
    // C2 has no Último Movimento match: passes through untouched.
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
    AM.mergeUltimoMovimento(enderecos, new Map([['C1', { entrevistador: 'Fulano' }]]));
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
