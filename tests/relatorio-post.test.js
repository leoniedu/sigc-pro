import { describe, test, expect, beforeEach, afterEach, afterAll } from 'bun:test';

await import('../extension/common/sigc-common.js');
const { relatorioFiltrarUrl, refererDoSlug, postRelatorio, FORM_POST_HEADERS } = window.__sigcPro;

const ORIGIN = 'https://portalweb.ibge.gov.br';
const F5_HEX = '68747470733a2f2f773373696763706e73323032352e696267652e676f762e6272';
const F5_PATHNAME = `/f5-w-${F5_HEX}$$/relatorio/relatorio-aprov-coleta-gerencial`;
const SLUG = 'relatorio-aprov-coleta-gerencial';
// happy-dom's window is shared by every test file in the process.
const ORIGINAL_URL = window.location.href;
afterAll(() => window.happyDOM.setURL(ORIGINAL_URL));

// The URL shapes captured live; a drift in the builder breaks every
// /relatorio/filtrar report at once, so they are pinned literally.
describe('relatorioFiltrarUrl', () => {
  test('direct host', () => {
    expect(relatorioFiltrarUrl(ORIGIN, '/x', SLUG, true))
      .toBe(`${ORIGIN}/relatorio/filtrar?slug=${SLUG}`);
  });
  test('gateway, simple', () => {
    expect(relatorioFiltrarUrl(ORIGIN, F5_PATHNAME, SLUG, true))
      .toBe(`${ORIGIN}/f5-w-${F5_HEX}$$/relatorio/filtrar?slug=${SLUG}`);
  });
  test('gateway, full: raw $$, ";" before F5_origin', () => {
    expect(relatorioFiltrarUrl(ORIGIN, F5_PATHNAME, SLUG, false))
      .toBe(`${ORIGIN}/f5-w-${F5_HEX}$$/relatorio/f5-h-$$/relatorio/filtrar?slug=${SLUG};F5_origin=${F5_HEX}&F5CH=I`);
  });
});

describe('postRelatorio', () => {
  const realFetch = globalThis.fetch;
  let calls;

  function stubFetch(responses) {
    calls = [];
    globalThis.fetch = async (url, opts) => {
      calls.push({ url, opts });
      const r = responses.shift();
      if (r instanceof Error) throw r;
      return r;
    };
  }
  const ok = (text) => ({ ok: true, status: 200, text: async () => text });
  const bad = (status) => ({ ok: false, status, text: async () => '' });

  beforeEach(() => {
    window.happyDOM.setURL(`${ORIGIN}${F5_PATHNAME}`);
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test('POSTs the simple URL with form headers, same-origin credentials and the report referrer', async () => {
    stubFetch([ok('<t/>')]);
    const out = await postRelatorio({ slug: SLUG, body: 'filtro=x', parse: (h) => ({ h }) });
    expect(out).toEqual({ h: '<t/>' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(relatorioFiltrarUrl(ORIGIN, F5_PATHNAME, SLUG, true));
    expect(calls[0].opts.method).toBe('POST');
    expect(calls[0].opts.credentials).toBe('same-origin');
    expect(calls[0].opts.headers).toEqual(FORM_POST_HEADERS);
    expect(calls[0].opts.referrer).toBe(`${ORIGIN}/f5-w-${F5_HEX}$$/relatorio/${SLUG}`);
    expect(calls[0].opts.body).toBe('filtro=x');
  });

  test('falls back to the full URL after a non-2xx', async () => {
    stubFetch([bad(404), ok('<t/>')]);
    await postRelatorio({ slug: SLUG, body: 'b', parse: () => ({}) });
    expect(calls.map((c) => c.url)).toEqual([
      relatorioFiltrarUrl(ORIGIN, F5_PATHNAME, SLUG, true),
      relatorioFiltrarUrl(ORIGIN, F5_PATHNAME, SLUG, false),
    ]);
  });

  test('a null parse (table not recognised) tries the next URL, then throws', async () => {
    stubFetch([ok('a'), ok('b')]);
    await expect(postRelatorio({ slug: SLUG, body: 'b', parse: () => null }))
      .rejects.toThrow('tabela não reconhecida');
    expect(calls).toHaveLength(2);
  });

  test('transport errors fall through; the last error is thrown', async () => {
    stubFetch([new Error('rede'), bad(500)]);
    await expect(postRelatorio({ slug: SLUG, body: 'b', parse: () => ({}) }))
      .rejects.toThrow('HTTP 500');
  });
});

describe('refererDoSlug', () => {
  test('prefixes the F5 gateway', () => {
    window.happyDOM.setURL(`${ORIGIN}${F5_PATHNAME}`);
    expect(refererDoSlug(SLUG)).toBe(`${ORIGIN}/f5-w-${F5_HEX}$$/relatorio/${SLUG}`);
  });
});
