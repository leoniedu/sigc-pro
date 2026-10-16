import { describe, test, expect } from 'bun:test';

await import('../extension/common/sigc-common.js');
await import('../extension/common/municipios.js');
await import('../extension/features/gerenciamento-coleta/gerenciamento-parse.js');
await import('../extension/features/gerenciamento-coleta/gerenciamento-aggregate.js');
const G = window.__sigcProGerenciamento;
const FIXTURE = await Bun.file(new URL('./fixtures/gerenciamento-coleta.html', import.meta.url)).text();
const ROWS = G.parseGerenciamentoHtml(FIXTURE).rows;

const soma = (o) => Object.values(o).reduce((s, n) => s + n, 0);

describe('classificar', () => {
  const k = (l) => G.classificar(l);
  test('every label the portal is known to send is recognised', () => {
    [
      'Não iniciada', 'Todos os moradores em andamento',
      'Todos os moradores iniciada e interrompida por recusa',
      'Homem selecionado a realizar', 'Mulher selecionada a realizar',
      'Homem selecionado em andamento (partes 13 a 24)', 'Mulher selecionada em andamento (partes 13 a 24)',
      'Homem selecionado com recusa (inicial ou durante entrevista)',
      'Mulher selecionada com recusa (inicial ou durante entrevista)',
      'Finalizada completa (até parte 24) – UPA sem Bio',
      'Finalizada completa (até parte 24) – UPA com Bio e selecionado não elegível',
      '25A (Bio) agendada', '25A (Bio) não agendada', '25A (Bio) não iniciada por recusa',
      '25A (Bio) não iniciada por outro motivo', '25B (coleta Bio) realizada',
      '25B (coleta Bio) não realizada', 'Indefinido',
    ].forEach((l) => expect(k(l).conhecido).toBe(true));
  });
  test('Mulher follows Homem, and the funnel order is kept', () => {
    expect(k('Homem selecionado a realizar').ordem).toBeLessThan(k('Mulher selecionada a realizar').ordem);
    expect(k('Mulher selecionada a realizar').ordem).toBeLessThan(k('Homem selecionado em andamento (partes 13 a 24)').ordem);
    expect(k('Não iniciada').ordem).toBeLessThan(k('25B (coleta Bio) realizada').ordem);
  });
  test('tolerates a hyphen for the en dash and case/spacing noise', () => {
    expect(k('FINALIZADA completa (até parte 24)  -  UPA sem Bio').conhecido).toBe(true);
  });
  test('an unknown label is flagged, not guessed', () => {
    expect(k('Rótulo novo de teste')).toEqual({ conhecido: false, ordem: Infinity });
  });
});

describe('filtrar', () => {
  test('bio splits the rows in two and no scope keeps all', () => {
    const sim = G.filtrar(ROWS, { bio: 'sim' });
    const nao = G.filtrar(ROWS, { bio: 'nao' });
    expect(sim.length).toBeGreaterThan(0);
    expect(sim.length + nao.length).toBe(ROWS.length);
    expect(G.filtrar(ROWS, {})).toHaveLength(ROWS.length);
    expect(G.filtrar(ROWS, null)).toHaveLength(ROWS.length);
  });
});

describe('avisos', () => {
  test('a new label raises a visible warning naming it', () => {
    expect(G.avisos(ROWS).join('\n')).toContain('Rótulo novo de teste');
  });
  test('none on a clean scope', () => {
    expect(G.avisos(ROWS.filter((r) => r.andamento !== 'Rótulo novo de teste'))).toEqual([]);
  });
  test('UPA sem Bio with a biomarker sample is flagged', () => {
    const ruim = [{ ...ROWS[0], andamento: 'Finalizada completa (até parte 24) – UPA sem Bio', bio: 'Sim' }];
    expect(G.avisos(ruim).join('\n')).toContain('UPA sem Bio');
  });
  test('a Bio value other than Sim/Não is flagged', () => {
    expect(G.avisos([{ ...ROWS[0], bio: 'Talvez' }]).join('\n')).toContain('diferente de Sim/Não');
  });
  test('empty scope: no warnings, no throw', () => {
    expect(G.avisos([])).toEqual([]);
  });
});

describe('tabelaPor', () => {
  for (const grupo of ['municipio', 'agencia']) {
    test(`${grupo}: every row's cells add up to its total, rows to the scope`, () => {
      const t = G.tabelaPor(ROWS, grupo);
      t.linhas.forEach((l) => {
        expect(soma(l.celulas)).toBe(l.total);
        expect(l.sim + l.nao).toBe(l.total);
      });
      expect(t.totais.total).toBe(ROWS.length);
      expect(soma(t.totais.celulas)).toBe(ROWS.length);
      expect(t.linhas.reduce((s, l) => s + l.total, 0)).toBe(ROWS.length);
    });
  }
  test('one column per portal label present, known in funnel order, the new one last and flagged', () => {
    const t = G.tabelaPor(ROWS, 'municipio');
    expect(t.colunas).toHaveLength(19);
    expect(t.colunas.at(-1)).toMatchObject({ id: 'Rótulo novo de teste', novo: true });
    expect(t.colunas.filter((c) => c.novo)).toHaveLength(1);
    expect(t.colunas[0].id).toBe('Não iniciada');
  });
  test('only labels present in the scope get a column', () => {
    const t = G.tabelaPor(G.filtrar(ROWS, { bio: 'nao' }), 'agencia');
    expect(t.colunas.map((c) => c.id)).not.toContain('25B (coleta Bio) realizada');
    expect(soma(t.totais.celulas)).toBe(t.totais.total);
  });
  test('"Não iniciada" is shown under a clearer name, with an explanation', () => {
    const c = G.tabelaPor(ROWS, 'agencia').colunas.find((x) => x.id === 'Não iniciada');
    expect(c.nome).toBe('Sem entrevista iniciada');
    expect(c.dica).toContain('Não iniciada');
  });
  test('household refusal rides beside the cells and is not summed into them', () => {
    const t = G.tabelaPor(ROWS, 'municipio');
    expect(t.totais.recusaDomicilio).toBe(1);
    expect(soma(t.totais.celulas)).toBe(ROWS.length);
  });
  test('município is named from the controle table', () => {
    expect(G.tabelaPor(ROWS, 'municipio').linhas.map((l) => l.nome).join()).toContain('SALVADOR');
    expect(G.nomeMunicipio('2927408')).toContain('SALVADOR');
  });
  test('empty scope yields no rows and no throw', () => {
    const t = G.tabelaPor([], 'agencia');
    expect(t.linhas).toEqual([]);
    expect(t.totais.total).toBe(0);
  });
});
