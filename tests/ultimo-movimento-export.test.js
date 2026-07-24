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
  test('true when the page header h6 reads "Último Movimento", even before any Filtrar click', () => {
    document.body.innerHTML =
      '<div class="card-header py-2 col-md-12 sigc-header-page">' +
      '<h6 class="font-weight-bold mb-0">Último Movimento</h6></div>';
    expect(UME.onUltimoMovimento()).toBe(true);
  });
  test('true even without the accent (tolerant, like onListaEnderecos)', () => {
    document.body.innerHTML = '<h6>Ultimo Movimento</h6>';
    expect(UME.onUltimoMovimento()).toBe(true);
  });
  test('false otherwise', () => {
    document.body.innerHTML = '<div>outra página</div><h6>Outro Relatório</h6>';
    expect(UME.onUltimoMovimento()).toBe(false);
  });
});

describe('getCurrentUf', () => {
  test('reads the value of the select2-backed #IdUf select', () => {
    document.body.innerHTML = '<select id="IdUf"><option value="29" selected>29 - BAHIA</option></select>';
    expect(UME.getCurrentUf()).toBe('29');
  });
  test('empty string when #IdUf is absent', () => {
    document.body.innerHTML = '<div>sem select</div>';
    expect(UME.getCurrentUf()).toBe('');
  });
});

describe('collectAllAgencias', () => {
  test('tags each row with IdUf/IdAgencia/AgenciaDescricao, in that order', async () => {
    const html = `
      <table id="tb_ultimo_movimento">
        <thead><tr><th>Controle</th><th>Situação</th></tr></thead>
        <tbody><tr><td>111</td><td>Entrevistado</td></tr></tbody>
      </table>`;
    const originalFetch = global.fetch;
    global.fetch = async () => ({ ok: true, text: async () => html });
    try {
      const result = await UME.collectAllAgencias(
        '29',
        [{ key: 'A1', description: 'Agência 1' }],
        () => {},
      );
      expect(result.header).toEqual(['IdUf', 'IdAgencia', 'AgenciaDescricao', 'Controle', 'Situação']);
      expect(result.rows).toEqual([['29', 'A1', 'Agência 1', '111', 'Entrevistado']]);
      expect(result.failed).toEqual([]);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('records a failed agência and continues, without aborting the run', async () => {
    const html = `
      <table id="tb_ultimo_movimento">
        <thead><tr><th>Controle</th></tr></thead>
        <tbody><tr><td>222</td></tr></tbody>
      </table>`;
    const originalFetch = global.fetch;
    let call = 0;
    global.fetch = async () => {
      call += 1;
      if (call === 1) return { ok: false, status: 500, text: async () => '' };
      return { ok: true, text: async () => html };
    };
    try {
      const result = await UME.collectAllAgencias(
        '29',
        [
          { key: 'BAD', description: 'Falha' },
          { key: 'OK', description: 'Sucesso' },
        ],
        () => {},
      );
      expect(result.failed).toEqual(['BAD (Falha)']);
      expect(result.rows).toEqual([['29', 'OK', 'Sucesso', '222']]);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
