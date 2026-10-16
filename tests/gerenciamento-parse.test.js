import { describe, test, expect } from 'bun:test';

await import('../extension/common/sigc-common.js');
await import('../extension/features/gerenciamento-coleta/gerenciamento-parse.js');
const G = window.__sigcProGerenciamento;
const FIXTURE = await Bun.file(new URL('./fixtures/gerenciamento-coleta.html', import.meta.url)).text();

const tabela = (ths, trs) =>
  `<table id="tableRelatorio"><thead><tr>${ths.map((h) => `<th>${h}</th>`).join('')}</tr></thead>` +
  `<tbody>${trs.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const HDR = ['^UF', '@IdUf', 'Agência', '^@IdAgencia', '#!Controle', '!Domicílio',
  'Amostra Biomarcadores', 'Última Posição', 'Status Coleta', 'Situação da Entrevista',
  'Andamento da Entrevista'];
const ROW = ['BA', '29', '290490200 - CACHOEIRA', '290490200', '290490205000001', '03',
  'Sim', 'Descarregado', 'Finalizado', 'Domicílio concluído', '25B (coleta Bio) realizada'];

describe('headerKey', () => {
  test('strips every DataTables decoration and folds accents', () => {
    expect(G.headerKey('^@IdAgencia')).toBe('idagencia');
    expect(G.headerKey('#!Controle')).toBe('controle');
    expect(G.headerKey('!Domicílio')).toBe('domicilio');
    expect(G.headerKey('Situação  da Entrevista')).toBe('situacao da entrevista');
    expect(G.headerKey('^UF')).toBe('uf');
  });
});

describe('normalizeDomicilio / splitAgencia', () => {
  test('drops zero padding, leaves non-numeric alone', () => {
    expect(G.normalizeDomicilio('03')).toBe('3');
    expect(G.normalizeDomicilio('15')).toBe('15');
    expect(G.normalizeDomicilio('0')).toBe('0');
    expect(G.normalizeDomicilio('A1')).toBe('A1');
  });
  test('splits "code - NAME" at the first dash only', () => {
    expect(G.splitAgencia('290490200 - CACHOEIRA')).toEqual({ codigo: '290490200', nome: 'CACHOEIRA' });
    expect(G.splitAgencia('290490200 - SÃO FÉLIX - CENTRO')).toEqual({ codigo: '290490200', nome: 'SÃO FÉLIX - CENTRO' });
    expect(G.splitAgencia('sem código')).toEqual({ codigo: '', nome: 'sem código' });
  });
});

describe('parseGerenciamentoHtml', () => {
  test('one row per household with normalised fields', () => {
    const { rows, warnings } = G.parseGerenciamentoHtml(tabela(HDR, [ROW]));
    expect(warnings).toEqual([]);
    expect(rows).toEqual([{
      uf: '29', idAgencia: '290490200', agenciaNome: 'CACHOEIRA',
      controle: '290490205000001', domicilio: '3', municipio: '2904902',
      bio: 'Sim', ultimaPosicao: 'Descarregado', statusColeta: 'Finalizado',
      situacaoEntrevista: 'Domicílio concluído', andamento: '25B (coleta Bio) realizada',
    }]);
  });

  test('no table = zero rows, not an error', () => {
    expect(G.parseGerenciamentoHtml('<div>sem dados</div>')).toEqual({ rows: [], warnings: [] });
    expect(G.parseGerenciamentoHtml('')).toEqual({ rows: [], warnings: [] });
    expect(G.parseGerenciamentoHtml(undefined)).toEqual({ rows: [], warnings: [] });
  });

  test('fails closed (null) when a required header is missing or renamed', () => {
    const semAndamento = HDR.filter((h) => h !== 'Andamento da Entrevista');
    expect(G.parseGerenciamentoHtml(tabela(semAndamento, [ROW.slice(0, 10)]))).toBeNull();
    const renomeado = HDR.map((h) => (h === 'Status Coleta' ? 'Status da Coleta' : h));
    expect(G.parseGerenciamentoHtml(tabela(renomeado, [ROW]))).toBeNull();
  });

  test('column order does not matter: fields are bound by header', () => {
    const idx = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
    const { rows } = G.parseGerenciamentoHtml(tabela(idx.map((i) => HDR[i]), [idx.map((i) => ROW[i])]));
    expect(rows[0].controle).toBe('290490205000001');
    expect(rows[0].andamento).toBe('25B (coleta Bio) realizada');
  });

  test('IdUf and the agência text are optional', () => {
    const hdr = HDR.filter((h) => h !== '@IdUf' && h !== 'Agência');
    const row = ROW.filter((_, i) => i !== 1 && i !== 2);
    const { rows } = G.parseGerenciamentoHtml(tabela(hdr, [row]));
    expect(rows[0].agenciaNome).toBe('');
    expect(rows[0].idAgencia).toBe('290490200');
  });

  test('a DataTables empty-state row is counted as skipped, not parsed', () => {
    const html = tabela(HDR, [ROW]).replace('</tbody>',
      '<tr><td colspan="11" class="dataTables_empty">Sem dados</td></tr></tbody>');
    const { rows, warnings } = G.parseGerenciamentoHtml(html);
    expect(rows).toHaveLength(1);
    expect(warnings[0]).toContain('1 linha(s) ignorada(s)');
  });

  test('a repeated household is kept once, so no total is inflated, and the panel is told', () => {
    const { rows, warnings } = G.parseGerenciamentoHtml(tabela(HDR, [ROW, [...ROW]]));
    expect(rows).toHaveLength(1);
    expect(warnings.join('\n')).toContain('1 linha(s) repetida(s)');
  });

  test('warns on agência mismatch and short controle, keeping those rows', () => {
    const outraAg = [...ROW]; outraAg[2] = '111111111 - OUTRA'; outraAg[5] = '04';
    const curto = [...ROW]; curto[4] = '123'; curto[5] = '05';
    const { rows, warnings } = G.parseGerenciamentoHtml(tabela(HDR, [ROW, outraAg, curto]));
    expect(rows).toHaveLength(3);
    expect(warnings.join('\n')).toContain('1 linha(s) em que o código da agência difere');
    expect(warnings.join('\n')).toContain('1 controle(s) fora do formato');
  });

  test('parses the recorded-shape fixture: every row, all 11 columns', () => {
    const { rows, warnings } = G.parseGerenciamentoHtml(FIXTURE);
    expect(warnings).toEqual([]);
    expect(rows).toHaveLength(38);
    expect(new Set(rows.map((r) => r.andamento)).size).toBe(19);
    expect(rows.every((r) => /^\d{15}$/.test(r.controle))).toBe(true);
    expect(rows.every((r) => !/^0\d/.test(r.domicilio))).toBe(true);
    expect(new Set(rows.map((r) => r.municipio))).toEqual(new Set(['2904902', '2927408']));
  });
});
