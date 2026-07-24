import { describe, test, expect } from 'bun:test';

await import('../extension/common/sigc-common.js');
await import('../extension/features/ultimo-movimento-export/ultimo-movimento-export.js');
const UME = window.__sigcProUltimoMovimentoExportInternals;

describe('buildAgenciaFilterBody', () => {
  test('URL-encodes a filtro JSON payload matching the known SIGC shape', () => {
    const body = UME.buildAgenciaFilterBody('29', '290570100');
    expect(body.startsWith('filtro=')).toBe(true);
    const decoded = JSON.parse(decodeURIComponent(body.slice('filtro='.length)));
    expect(decoded).toEqual({
      IdFiltro: '',
      IdUf: '29',
      IdAgencia: '290570100',
      IdMunicipio: '*',
      Controle: '*',
      IdEntrevistadores: '*',
      IdTipoAcompanhamento: '*',
    });
  });
});

describe('parseUltimoMovimentoHtml', () => {
  test('parses header and rows from the tb_ultimo_movimento table', () => {
    const html = `
      <table id="tb_ultimo_movimento">
        <thead><tr><th>Controle</th><th>Situação</th></tr></thead>
        <tbody>
          <tr><td>1234567890123</td><td>Entrevistado</td></tr>
          <tr><td>9876543210987</td><td>Pendente</td></tr>
        </tbody>
      </table>`;
    const result = UME.parseUltimoMovimentoHtml(html);
    expect(result.header).toEqual(['Controle', 'Situação']);
    expect(result.rows).toEqual([
      ['1234567890123', 'Entrevistado'],
      ['9876543210987', 'Pendente'],
    ]);
  });

  test('returns null when the table is absent (e.g. agência with no data)', () => {
    expect(UME.parseUltimoMovimentoHtml('<div>sem dados</div>')).toBeNull();
  });

  test('trims cell whitespace', () => {
    const html = `
      <table id="tb_ultimo_movimento">
        <thead><tr><th> Controle </th></tr></thead>
        <tbody><tr><td>  1234  </td></tr></tbody>
      </table>`;
    expect(UME.parseUltimoMovimentoHtml(html).rows).toEqual([['1234']]);
  });
});

describe('onUltimoMovimento', () => {
  test('true when the page has the tb_ultimo_movimento table or its filter form', () => {
    document.body.innerHTML = '<div id="tb_ultimo_movimento"></div>';
    expect(UME.onUltimoMovimento()).toBe(true);
  });
  test('false otherwise', () => {
    document.body.innerHTML = '<div>outra página</div>';
    expect(UME.onUltimoMovimento()).toBe(false);
  });
});
