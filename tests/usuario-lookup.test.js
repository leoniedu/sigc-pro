import { describe, test, expect, beforeEach, beforeAll, afterAll } from 'bun:test';

await import('../extension/common/sigc-common.js');
await import('../extension/features/usuario-lookup/usuario-lookup.js');

const U = window.__sigcProUsuarioLookup;
const P = window.__sigcPro;

const fixture = (name) => Bun.file(new URL(`./fixtures/${name}`, import.meta.url)).text();

describe('usuário origin hex (sigc-common)', () => {
  test('decodes to the usuário module origin, lowercase hex of the origin string', () => {
    const decoded = Buffer.from(P.USUARIO_ORIGIN_HEX, 'hex').toString('utf8');
    expect(decoded).toBe('https://w3servicosigc.ibge.gov.br');
    expect(P.USUARIO_ORIGIN_HEX).toBe(P.USUARIO_ORIGIN_HEX.toLowerCase());
  });

  test('the usuário module survey code is PNS2025, not the report page\'s PNS2026', () => {
    expect(P.USUARIO_CODIGO_PESQUISA).toBe('PNS2025');
    expect(Object.keys(P.PESQUISAS)).not.toContain('PNS2025');
  });

  test('usuarioGatewayUrl goes to the page origin with the usuário hex prefix behind the gateway', () => {
    const pageHex = Buffer.from('https://w3sigcpns2025.ibge.gov.br').toString('hex');
    const url = P.usuarioGatewayUrl('https://portalweb.ibge.gov.br', `/f5-w-${pageHex}$$/UltimoMovimento`, '/usuario/Grid');
    expect(url).toBe(`https://portalweb.ibge.gov.br/f5-w-${P.USUARIO_ORIGIN_HEX}$$/usuario/Grid`);
    expect(url.startsWith('https://portalweb.ibge.gov.br/')).toBe(true);
  });

  test('usuarioGatewayUrl on the direct host falls back to the page origin', () => {
    expect(P.usuarioGatewayUrl('https://w3sigcpns2025.ibge.gov.br', '/UltimoMovimento', '/usuario/Grid'))
      .toBe('https://w3sigcpns2025.ibge.gov.br/usuario/Grid');
  });
});

describe('request shapes', () => {
  test('gridBody is the live form body with only Login and StatusUsuario filled', () => {
    expect(U.gridBody('1234567')).toBe(
      'CodigoPesquisa=PNS2025&Nome=&IdUFSelecionada=&IdPostoSelecionado=&IdFuncaoSelecionada=' +
      '&Patrimonio=&UnidadeTrabalho=&Login=1234567&StatusUsuario=true');
  });
  test('editarPath carries codigoPesquisa and id', () => {
    expect(U.editarPath('98765')).toBe('/usuario/EditarUsuario?codigoPesquisa=PNS2025&id=98765');
  });
  test('refererPath is the usuário index for the survey', () => {
    expect(U.refererPath()).toBe('/usuario/?codigoPesquisa=PNS2025');
  });
});

describe('parseGridHtml', () => {
  test('maps cells by header text and reads the id from the action button value', async () => {
    const rec = U.parseGridHtml(await fixture('usuario-grid.html'));
    expect(rec).toEqual({
      id: '98765',
      nome: 'ALEXANDRE SILVA DE SANTANA',
      siape: '1234567',
      uf: 'BA',
      funcao: 'Agente de Pesquisas e Mapeamento',
      posto: '29XJYY - SALVADOR',
    });
    // Matrícula is the SIAPE, never the id.
    expect(rec.id).not.toBe(rec.siape);
  });

  test('is position-independent: no Ações column, reordered headers', async () => {
    const rec = U.parseGridHtml(await fixture('usuario-grid-sem-acoes.html'));
    expect(rec.id).toBe('98765');
    expect(rec.nome).toBe('ALEXANDRE SILVA DE SANTANA');
    expect(rec.siape).toBe('1234567');
    expect(rec.funcao).toBe('Agente de Pesquisas e Mapeamento');
    expect(rec.posto).toBe('');
  });

  test('empty table (unknown siape) -> null', async () => {
    expect(U.parseGridHtml(await fixture('usuario-grid-vazio.html'))).toBeNull();
    expect(U.parseGridHtml('')).toBeNull();
    expect(U.parseGridHtml('<p>login</p>')).toBeNull();
  });
});

describe('parseEditarUsuarioHtml', () => {
  test('reads every field by input name/id, selects by selected option text', async () => {
    const cad = U.parseEditarUsuarioHtml(await fixture('usuario-editar.html'));
    expect(cad).toEqual({
      nome: 'ALEXANDRE SILVA DE SANTANA',
      siape: '1234567',
      email: 'alexandre.santana@ibge.gov.br',
      telefone: '+557133333333',
      celular: '+5571990000000',
      funcao: 'Agente de Pesquisas e Mapeamento',
      agencia: '29XJYY - SALVADOR',
    });
  });

  test('falls back to label text; missing inputs are blank, never an error', async () => {
    const cad = U.parseEditarUsuarioHtml(await fixture('usuario-editar-por-rotulo.html'));
    expect(cad).toEqual({
      nome: 'MARIA JOSÉ DOS SANTOS',
      siape: '7654321',
      email: '',
      telefone: '(71) 3333-0000',
      celular: '',
      funcao: 'Supervisor de Coleta e Qualidade',
      agencia: '29XJZZ - FEIRA DE SANTANA',
    });
  });

  test('unrecognised markup yields all blanks', () => {
    expect(U.parseEditarUsuarioHtml('<div>sessão expirada</div>')).toEqual({
      nome: '', siape: '', email: '', telefone: '', celular: '', funcao: '', agencia: '',
    });
  });
});

describe('lookupUsuario (network + cache)', () => {
  let calls;
  let gridHtml;
  let editarHtml;
  const originalFetch = global.fetch;
  let clock;

  beforeEach(async () => {
    calls = [];
    gridHtml = await fixture('usuario-grid.html');
    editarHtml = await fixture('usuario-editar.html');
    clock = 1_000_000;
    U._setNow(() => clock);
    U.resetUsuarioCache();
    global.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      const body = String(url).includes('/usuario/Grid') ? gridHtml : editarHtml;
      return { ok: true, status: 200, text: async () => body };
    };
  });

  const restore = () => { global.fetch = originalFetch; U._setNow(null); };

  test('two same-origin requests, via the gateway, with referrer and X-Requested-With', async () => {
    try {
      const rec = await U.lookupUsuario('1234567');
      expect(calls.length).toBe(2);
      const [grid, editar] = calls;
      expect(grid.url).toBe(`${location.origin}/usuario/Grid`);
      expect(grid.init.method).toBe('POST');
      expect(grid.init.headers['X-Requested-With']).toBe('XMLHttpRequest');
      expect(grid.init.body).toContain('Login=1234567');
      expect(grid.init.referrer).toBe(`${location.origin}/usuario/?codigoPesquisa=PNS2025`);
      expect(grid.init.credentials).toBe('same-origin');
      // No Referer HEADER: forbidden name, silently dropped by browsers.
      expect(Object.keys(grid.init.headers).map((k) => k.toLowerCase())).not.toContain('referer');
      expect(editar.url).toBe(`${location.origin}/usuario/EditarUsuario?codigoPesquisa=PNS2025&id=98765`);
      expect(editar.init.method).toBe('GET');
      expect(editar.init.referrer).toBe(grid.init.referrer);
      for (const c of calls) expect(c.url.startsWith(location.origin)).toBe(true);
      expect(rec).toEqual({
        id: '98765',
        nome: 'ALEXANDRE SILVA DE SANTANA',
        siape: '1234567',
        funcao: 'Agente de Pesquisas e Mapeamento',
        email: 'alexandre.santana@ibge.gov.br',
        telefone: '+557133333333',
        celular: '+5571990000000',
        agencia: '29XJYY - SALVADOR',
      });
    } finally { restore(); }
  });

  test('second call within 60 s makes no request; after 60 s it does', async () => {
    try {
      await U.lookupUsuario('1234567');
      expect(calls.length).toBe(2);
      clock += 59_000;
      await U.lookupUsuario('1234567');
      expect(calls.length).toBe(2);
      clock += 2_000;
      await U.lookupUsuario('1234567');
      expect(calls.length).toBe(4);
    } finally { restore(); }
  });

  test('unknown siape (empty grid) -> null, one request, cached too', async () => {
    try {
      gridHtml = await fixture('usuario-grid-vazio.html');
      expect(await U.lookupUsuario('0000000')).toBeNull();
      expect(calls.length).toBe(1);
      expect(await U.lookupUsuario('0000000')).toBeNull();
      expect(calls.length).toBe(1);
    } finally { restore(); }
  });

  test('HTTP failure rejects and is not cached', async () => {
    try {
      global.fetch = async () => ({ ok: false, status: 500, text: async () => '' });
      await expect(U.lookupUsuario('1234567')).rejects.toThrow('HTTP 500');
      global.fetch = async (url) => ({ ok: true, status: 200, text: async () =>
        (String(url).includes('/usuario/Grid') ? gridHtml : editarHtml) });
      expect((await U.lookupUsuario('1234567')).id).toBe('98765');
    } finally { restore(); }
  });

  test('blank siape resolves null without a request', async () => {
    try {
      expect(await U.lookupUsuario('')).toBeNull();
      expect(calls.length).toBe(0);
    } finally { restore(); }
  });
});

describe('usuário-module session detection', () => {
  const PAGE_URL = 'https://portalweb.ibge.gov.br/f5-w-' +
    Buffer.from('https://w3sigcpns2025.ibge.gov.br').toString('hex') + '$$/UltimoMovimento';
  beforeAll(() => { window.happyDOM.setURL(PAGE_URL); });
  afterAll(() => { window.happyDOM.setURL('about:blank'); });
  const originalFetch = global.fetch;
  const restore = () => { global.fetch = originalFetch; U.resetUsuarioCache(); };

  test('isAuthRedirect recognises the "Working..." page; isLoginPage the login form; a Grid is neither', async () => {
    expect(U.isAuthRedirect(await fixture('usuario-grid-auth-redirect.html'))).toBe(true);
    expect(U.isAuthRedirect(await fixture('usuario-grid.html'))).toBe(false);
    expect(U.isLoginPage('<form><input type="text" name="Username"><input type="password" name="Password"></form>')).toBe(true);
    expect(U.isLoginPage(await fixture('usuario-grid-auth-redirect.html'))).toBe(false);
    expect(U.isAuthRedirect('')).toBe(false);
  });

  test('no session: ErroAutenticacao with the module login URL, no further request, not cached', async () => {
    const authForm = await fixture('usuario-grid-auth-redirect.html');
    const calls = [];
    global.fetch = async (url) => {
      calls.push(String(url));
      return { ok: true, status: 200, text: async () => authForm };
    };
    try {
      let err;
      try { await U.lookupUsuario('1234567'); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(U.ErroAutenticacao);
      expect(err.code).toBe('auth');
      expect(err.loginUrl).toBe(`${location.origin}/f5-w-${P.USUARIO_ORIGIN_HEX}$$/usuario/?codigoPesquisa=PNS2025`);
      // Only the Grid was requested: the auth form is never posted.
      expect(calls).toEqual([`${location.origin}/f5-w-${P.USUARIO_ORIGIN_HEX}$$/usuario/Grid`]);
      await U.lookupUsuario('1234567').catch(() => {});
      expect(calls.length).toBe(2);
    } finally { restore(); }
  });
});

describe('review fixes', () => {
  test('parseGridHtml picks the row whose Matrícula is the siape, not the first row', async () => {
    const html = await fixture('usuario-grid-duas-linhas.html');
    expect(U.parseGridHtml(html, '1234567').id).toBe('98765');
    expect(U.parseGridHtml(html, '12345678').id).toBe('11111');
    expect(U.parseGridHtml(html, '123456')).toBeNull();
    expect(U.parseGridHtml(html).id).toBe('11111');
  });

  test('EditarUsuario: the layout\'s search boxes are ignored; an unselected select is blank', async () => {
    const cad = U.parseEditarUsuarioHtml(await fixture('usuario-editar-com-busca.html'));
    expect(cad.nome).toBe('ALEXANDRE SILVA DE SANTANA');
    expect(cad.siape).toBe('1234567');
    expect(cad.email).toBe('alexandre.santana@ibge.gov.br');
    expect(cad.celular).toBe('+5571990000000');
    expect(cad.funcao).toBe('');
  });

  test('a redirect answer (opaqueredirect) is "no session", never followed', async () => {
    const original = global.fetch;
    const calls = [];
    global.fetch = async (url, init) => { calls.push(init); return { type: 'opaqueredirect', status: 0, ok: false, text: async () => '' }; };
    try {
      U.resetUsuarioCache();
      await expect(U.lookupUsuario('1234567')).rejects.toBeInstanceOf(U.ErroAutenticacao);
      expect(calls.length).toBe(1);
      expect(calls[0].redirect).toBe('manual');
    } finally { global.fetch = original; U.resetUsuarioCache(); }
  });

  test('the record\'s nome comes from the matched Grid row, siape from the request', async () => {
    const original = global.fetch;
    const grid = (await fixture('usuario-grid.html')).replace('ALEXANDRE SILVA DE SANTANA', 'NOME DA GRADE');
    const editar = await fixture('usuario-editar.html');
    global.fetch = async (url) => ({ ok: true, status: 200, text: async () => (String(url).includes('/usuario/Grid') ? grid : editar) });
    try {
      U.resetUsuarioCache();
      const rec = await U.lookupUsuario('1234567');
      expect(rec.nome).toBe('NOME DA GRADE');
      expect(rec.siape).toBe('1234567');
    } finally { global.fetch = original; U.resetUsuarioCache(); }
  });
});
