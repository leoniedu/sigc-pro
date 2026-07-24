import { describe, test, expect } from 'bun:test';

await import('../extension/common/sigc-common.js');
await import('../extension/features/ultimo-movimento-export/ultimo-movimento-export.js');
const UME = window.__sigcProUltimoMovimentoExportInternals;

// Real F5-rewritten hex prefix confirmed against the live portal — hex-
// decodes to https://w3sigcpns2025.ibge.gov.br. Same fixture value used
// by the reference ultimo_movimento.py script's own hardcoded BASE_URL.
const F5_HEX = '68747470733a2f2f773373696763706e73323032352e696267652e676f762e6272';
const F5_PATHNAME = `/f5-w-${F5_HEX}$$/UltimoMovimento`;

describe('f5Prefix', () => {
  test('extracts prefix and hex from an F5-rewritten pathname', () => {
    expect(UME.f5Prefix(F5_PATHNAME)).toEqual({ prefix: `/f5-w-${F5_HEX}$$`, hex: F5_HEX });
  });
  test('null on a plain (non-gateway) pathname', () => {
    expect(UME.f5Prefix('/UltimoMovimento')).toBeNull();
  });
  test('null on empty/undefined input', () => {
    expect(UME.f5Prefix('')).toBeNull();
    expect(UME.f5Prefix(undefined)).toBeNull();
  });
});

describe('gatewayUrl', () => {
  const origin = 'https://portalweb.ibge.gov.br';

  test('plain origin+path when not behind the F5 gateway', () => {
    expect(UME.gatewayUrl(origin, '/UltimoMovimento', '/Filtro/CarregarAgencias', true))
      .toBe(`${origin}/Filtro/CarregarAgencias`);
  });

  test('simple mode: prepends the captured F5 prefix to the path', () => {
    expect(UME.gatewayUrl(origin, F5_PATHNAME, '/Filtro/CarregarAgencias', true))
      .toBe(`${origin}/f5-w-${F5_HEX}$$/Filtro/CarregarAgencias`);
  });

  test('fallback mode: full f5-h-$$ form with F5_origin/F5CH params', () => {
    expect(UME.gatewayUrl(origin, F5_PATHNAME, '/Filtro/CarregarAgencias', false))
      .toBe(`${origin}/f5-w-${F5_HEX}$$/f5-h-$$/Filtro/CarregarAgencias;F5_origin=${F5_HEX}&F5CH=I`);
  });
});

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
