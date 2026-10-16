import { describe, test, expect, beforeEach } from 'bun:test';
import { createRequire } from 'module';

await import('../extension/common/sigc-common.js');
await import('../extension/common/municipios.js');
await import('../extension/features/carta-notificacao/carta-notificacao.js');

const C = window.__sigcProCarta;

// The vendored UMD bundle and the assets script, loaded the way the
// browser would end up with them: as globals.
const require = createRequire(import.meta.url);
const PDFLib = require('../extension/vendor/pdf-lib/pdf-lib.min.js');
window.PDFLib = PDFLib;
await import('../extension/vendor/carta-assets/carta-assets.js');
const assets = window.__sigcProCartaAssets;

const LINHA = {
  controle: '292740801234567', domicilio: '3',
  entrevistador: '1234567 - ALEXANDRE SILVA DE SANTANA',
  logradouro: 'RUA SILVEIRA MARTINS', numero: '3200', complemento: 'URBIS I QUADRA II CASA 12',
  bairro: 'CABULA', biomarcadores: 'Sim', agencia: '29XJYY - SALVADOR',
};
const CADASTRO = {
  id: '98765', nome: 'ALEXANDRE SILVA DE SANTANA', siape: '1234567',
  funcao: 'Agente de Pesquisas e Mapeamento', email: 'alexandre.santana@ibge.gov.br',
  telefone: '+557133333333', celular: '+5571990000000', agencia: '29XJYY - SALVADOR',
};
const MODO_DEMANDA = { comDemanda: true };
const MODO_MOVIMENTO = { comDemanda: false };

describe('titleCasePt', () => {
  test.each([
    ['RUA SILVEIRA MARTINS 3200', 'Rua Silveira Martins 3200'],
    ['ALEXANDRE SILVA DE SANTANA', 'Alexandre Silva de Santana'],
    ['URBIS I', 'Urbis I'],
    ['QUADRA II LOTE XIV', 'Quadra II Lote XIV'],
    ['S/N', 'S/N'],
    ['AVENIDA DAS NAÇÕES UNIDAS', 'Avenida das Nações Unidas'],
    ['CENTRO ADMINISTRATIVO DA BAHIA', 'Centro Administrativo da Bahia'],
    ['MARIA JOSÉ DOS SANTOS E SILVA', 'Maria José dos Santos e Silva'],
    ['DE', 'De'],
    ['RUA A', 'Rua A'],
    ['BLOCO E', 'Bloco E'],
    ['POLÍCIA CIVIL', 'Polícia Civil'],
    ['1ª TRAVESSA MIL', '1ª Travessa Mil'],
    ['', ''],
    [null, ''],
  ])('%p -> %p', (input, expected) => {
    expect(C.titleCasePt(input)).toBe(expected);
  });
});

describe('formatTelefone', () => {
  test.each([
    ['+557190000000', '(71) 9000-0000'],
    ['+5571990000000', '(71) 99000-0000'],
    ['5571990000000', '(71) 99000-0000'],
    ['(71) 3333-0000', '(71) 3333-0000'],
    ['71990000000', '71990000000'],
    ['', ''],
    [null, ''],
  ])('%p -> %p', (input, expected) => {
    expect(C.formatTelefone(input)).toBe(expected);
  });
});

describe('superintendência by UF', () => {
  const esperado = {
    11: 'em Rondônia', 12: 'no Acre', 13: 'no Amazonas', 14: 'em Roraima',
    15: 'no Pará', 16: 'no Amapá', 17: 'no Tocantins', 21: 'no Maranhão',
    22: 'no Piauí', 23: 'no Ceará', 24: 'no Rio Grande do Norte', 25: 'na Paraíba',
    26: 'em Pernambuco', 27: 'em Alagoas', 28: 'em Sergipe', 29: 'na Bahia',
    31: 'em Minas Gerais', 32: 'no Espírito Santo', 33: 'no Rio de Janeiro', 35: 'em São Paulo',
    41: 'no Paraná', 42: 'em Santa Catarina', 43: 'no Rio Grande do Sul', 50: 'em Mato Grosso do Sul',
    51: 'em Mato Grosso', 52: 'em Goiás', 53: 'no Distrito Federal',
  };
  test('all 27 codes', () => {
    expect(Object.keys(esperado).length).toBe(27);
    for (const [code, prep] of Object.entries(esperado)) {
      expect(C.prepUf(code)).toBe(prep);
      expect(C.superintendencia(code)).toBe(`Superintendência Estadual do IBGE ${prep}`);
    }
  });
  test('unknown code -> the phrase alone', () => {
    expect(C.superintendencia('99')).toBe('Superintendência Estadual do IBGE');
    expect(C.superintendencia('')).toBe('Superintendência Estadual do IBGE');
    expect(C.superintendencia(undefined)).toBe('Superintendência Estadual do IBGE');
  });
  test('accepts a controle (first two digits)', () => {
    expect(C.prepUf('292740801234567')).toBe('na Bahia');
  });
});

describe('row -> letter data', () => {
  test('agenteDaLinha splits "<siape> - NOME"; bare names have no siape', () => {
    expect(C.agenteDaLinha('1234567 - ALEXANDRE SILVA DE SANTANA'))
      .toEqual({ siape: '1234567', nome: 'ALEXANDRE SILVA DE SANTANA' });
    expect(C.agenteDaLinha('MARIA')).toEqual({ siape: '', nome: 'MARIA' });
    expect(C.agenteDaLinha('')).toEqual({ siape: '', nome: '' });
  });

  test('enderecoDaLinha: título, S/N for número 0/empty, "SN " dropped from complemento', () => {
    expect(C.enderecoDaLinha(LINHA)).toEqual({
      endereco: 'Rua Silveira Martins, 3200', complemento: 'Urbis I Quadra II Casa 12',
      bairro: 'Cabula', temEndereco: true,
    });
    expect(C.enderecoDaLinha({ logradouro: 'RUA A', numero: '0', complemento: 'SN CASA 2', bairro: '' }))
      .toEqual({ endereco: 'Rua A, S/N', complemento: 'Casa 2', bairro: '', temEndereco: true });
    expect(C.enderecoDaLinha({ logradouro: 'RUA A', numero: '', complemento: 'SN', bairro: 'X' }))
      .toEqual({ endereco: 'Rua A, S/N', complemento: '', bairro: 'X', temEndereco: true });
    expect(C.enderecoDaLinha({})).toEqual({ endereco: '', complemento: '', bairro: '', temEndereco: false });
  });

  test('municipioDaLinha renders Nome/UF from the controle', () => {
    expect(C.municipioDaLinha('292740801234567')).toBe('Salvador/BA');
    expect(C.municipioDaLinha('')).toBe('');
  });

  test('agenciaDoFiltroSelect reads the selected option text, blank for a wildcard or no select', () => {
    document.body.innerHTML = '<select id="IdAgencia"><option value="0">Todas</option>' +
      '<option value="2905">29XJYY - SALVADOR</option></select>';
    expect(C.agenciaDoFiltroSelect({ IdAgencia: '2905' })).toBe('29XJYY - SALVADOR');
    expect(C.agenciaDoFiltroSelect({ IdAgencia: '0' })).toBe('');
    expect(C.agenciaDoFiltroSelect({ IdAgencia: '9999' })).toBe('');
    document.body.innerHTML = '';
    expect(C.agenciaDoFiltroSelect({ IdAgencia: '2905' })).toBe('');
  });

  test('agenciaDoFiltro falls back to the UF agência list (one request per UF), blank without an agência filter', async () => {
    document.body.innerHTML = '';
    const calls = [];
    const prev = window.__sigcProUltimoMovimentoExportInternals;
    window.__sigcProUltimoMovimentoExportInternals = {
      fetchAgenciaList: async (uf) => { calls.push(uf); return [
        { key: '2905', description: '29XJYY - SALVADOR' }, { key: '2906', description: '29XJZZ - FEIRA DE SANTANA' }]; },
    };
    try {
      expect(await C.agenciaDoFiltro({ IdUf: '29', IdAgencia: '2905' })).toBe('29XJYY - SALVADOR');
      expect(await C.agenciaDoFiltro({ IdUf: '29', IdAgencia: 2906 })).toBe('29XJZZ - FEIRA DE SANTANA');
      expect(calls).toEqual(['29']);
      expect(await C.agenciaDoFiltro({ IdUf: '29', IdAgencia: '*', IdMunicipio: '2927408' })).toBe('');
      expect(await C.agenciaDoFiltro({ IdUf: '29', IdAgencia: '' })).toBe('');
      expect(await C.agenciaDoFiltro(null)).toBe('');
      expect(calls).toEqual(['29']);
      // The select, when present, wins without a request.
      document.body.innerHTML = '<select id="IdAgencia"><option value="2907">29XJWW - ILHÉUS</option></select>';
      expect(await C.agenciaDoFiltro({ IdUf: '29', IdAgencia: '2907' })).toBe('29XJWW - ILHÉUS');
      expect(calls).toEqual(['29']);
    } finally {
      window.__sigcProUltimoMovimentoExportInternals = prev;
      document.body.innerHTML = '';
    }
  });

  test('dadosDaCarta with a cadastro fills all 13 fields', () => {
    const d = C.dadosDaCarta({ row: LINHA, modo: MODO_DEMANDA, filtro: { IdUf: '29' }, cadastro: CADASTRO });
    expect(Object.keys(d.campos).sort()).toEqual([...C.CAMPOS].sort());
    expect(d.campos).toEqual({
      saudacao: 'Prezado(a) morador(a),',
      endereco: 'Rua Silveira Martins, 3200',
      complemento: 'Urbis I Quadra II Casa 12',
      bairro: 'Cabula',
      municipio: 'Salvador/BA',
      controle: '292740801234567',
      domicilio: '3',
      nome: 'Alexandre Silva de Santana',
      siape: '1234567',
      cargo_descricao: 'Agente de Pesquisas e Mapeamento',
      celular_pessoal: '(71) 99000-0000',
      email_institucional: 'alexandre.santana@ibge.gov.br',
      agencia_descricao: '29XJYY - SALVADOR',
      assinante: '',
      superintendencia: 'Superintendência Estadual do IBGE na Bahia',
    });
    expect(d.uf).toBe('29');
    expect(d.biomarcadores).toBe(true);
    expect(d.temEndereco).toBe(true);
    expect(d.nomeAgente).toBe('Alexandre Silva de Santana');
  });

  test('without a cadastro: nome and siape from the row, the rest blank; agência from the filter', () => {
    const d = C.dadosDaCarta({
      row: { ...LINHA, biomarcadores: 'Não', agencia: '' }, modo: MODO_MOVIMENTO,
      filtro: { IdUf: '29', IdAgencia: '2905' }, cadastro: null, agenciaFiltro: '29XJYY - SALVADOR',
    });
    expect(d.campos.nome).toBe('Alexandre Silva de Santana');
    expect(d.campos.siape).toBe('1234567');
    expect(d.campos.cargo_descricao).toBe('');
    expect(d.campos.celular_pessoal).toBe('');
    expect(d.campos.email_institucional).toBe('');
    expect(d.campos.agencia_descricao).toBe('29XJYY - SALVADOR');
    expect(d.biomarcadores).toBe(false);
  });

  test('an Agência on an Último Movimento row is used too', () => {
    const d = C.dadosDaCarta({ row: { ...LINHA, agencia: '29XJZZ - FEIRA' }, modo: MODO_MOVIMENTO, filtro: null,
      cadastro: null, agenciaFiltro: '29XJYY - SALVADOR' });
    expect(d.campos.agencia_descricao).toBe('29XJZZ - FEIRA');
  });

  test('the row Agência wins on the biomarcadores page; cadastro telefone backs up celular', () => {
    const d = C.dadosDaCarta({
      row: { ...LINHA, agencia: '29XJZZ - FEIRA' }, modo: MODO_DEMANDA, filtro: null,
      cadastro: { ...CADASTRO, celular: '', agencia: '29XJYY - SALVADOR' },
    });
    expect(d.campos.agencia_descricao).toBe('29XJZZ - FEIRA');
    expect(d.campos.celular_pessoal).toBe('(71) 3333-3333');
  });

  test('no address: blank address fields, temEndereco false; UF falls back to the filter', () => {
    const d = C.dadosDaCarta({ row: { controle: '', domicilio: '1', entrevistador: '' }, modo: MODO_MOVIMENTO,
      filtro: { IdUf: '29' }, cadastro: null });
    expect(d.campos.endereco).toBe('');
    expect(d.campos.municipio).toBe('');
    expect(d.temEndereco).toBe(false);
    expect(d.uf).toBe('29');
    expect(d.nomeAgente).toBe('');
  });

  test('nomeArquivo', () => {
    expect(C.nomeArquivo({ controle: '292740801234567', domicilio: '3' })).toBe('carta_292740801234567_3.pdf');
    expect(C.nomeArquivo({ controle: 'a/b', domicilio: '' })).toBe('carta_ab_x.pdf');
  });
});

describe('text', () => {
  test('every static string and field default encodes in WinAnsi', async () => {
    const doc = await PDFLib.PDFDocument.create();
    const helv = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    for (const t of C.TEXTOS) expect(() => helv.encodeText(t.replace(/\*\*/g, ''))).not.toThrow();
    for (const t of Object.values(C.PREP_UF)) expect(() => helv.encodeText(t)).not.toThrow();
    expect(() => helv.encodeText('Decreto‑Lei')).toThrow();
  });

  test('palavras keeps "(PNS)" one word with a bold run inside', () => {
    const w = C.palavras('Saúde (**PNS**) 2026, **com urgência**.');
    expect(w.length).toBe(5);
    expect(w[1]).toEqual([{ text: '(', bold: false }, { text: 'PNS', bold: true }, { text: ')', bold: false }]);
    expect(w[3]).toEqual([{ text: 'com', bold: true }]);
    expect(w[4]).toEqual([{ text: 'urgência', bold: true }, { text: '.', bold: false }]);
  });

  test('year and collection period are the named constants, in the text', () => {
    expect(C.PESQUISA_ANO).toBe('2026');
    expect(C.PERIODO_COLETA).toBe('julho a novembro');
    expect(C.TEXTOS.join('\n')).toContain('PESQUISA NACIONAL DE SAÚDE 2026');
    expect(C.TEXTOS.join('\n')).toContain('A coleta vai de julho a novembro');
  });
});

describe('buildCartaPdf', () => {
  const LONGOS = {
    ...LINHA,
    logradouro: 'AVENIDA LUÍS VIANA FILHO TRAVESSA DAS ACÁCIAS CENTRO ADMINIST',
    complemento: 'CONDOMÍNIO RESIDENCIAL PARQUE DAS ÁRVORES BLOCO B APARTAMENTO 1',
  };
  const CAD_LONGO = { ...CADASTRO, nome: 'MARIA APARECIDA DOS SANTOS OLIVEIRA SILVA' };

  async function gerar(row, cadastro, modo = MODO_DEMANDA) {
    const dados = C.dadosDaCarta({ row, modo, filtro: { IdUf: '29' }, cadastro });
    const bytes = await C.buildCartaPdf(dados, { PDFLib, assets });
    const doc = await PDFLib.PDFDocument.load(bytes);
    return { dados, bytes, doc };
  }

  test('one A4 page with the 15 named fields holding the values', async () => {
    const { dados, doc } = await gerar(LINHA, CADASTRO);
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(Math.round(width)).toBe(595);
    expect(Math.round(height)).toBe(842);
    const form = doc.getForm();
    const names = form.getFields().map((f) => f.getName()).sort();
    expect(names).toEqual([...C.CAMPOS].sort());
    for (const name of C.CAMPOS) {
      expect(form.getTextField(name).getText() ?? '').toBe(dados.campos[name]);
    }
    expect(doc.getTitle()).toContain('292740801234567/3');
  });

  test('the longest realistic values still fit on one page, fields editable', async () => {
    const { doc, dados } = await gerar(LONGOS, CAD_LONGO);
    expect(doc.getPageCount()).toBe(1);
    expect(dados.campos.endereco.length).toBeGreaterThanOrEqual(60);
    const f = doc.getForm().getTextField('endereco');
    expect(f.getText()).toBe(dados.campos.endereco);
    expect(f.isReadOnly()).toBe(false);
    f.setText('Rua Editada, 1');
    expect(f.getText()).toBe('Rua Editada, 1');
  });

  test('paragraph 2 follows the Biomarcadores flag', async () => {
    const sim = await gerar({ ...LINHA, biomarcadores: 'Sim' }, CADASTRO);
    const nao = await gerar({ ...LINHA, biomarcadores: 'Não' }, CADASTRO);
    const desc = await gerar({ ...LINHA, biomarcadores: '' }, CADASTRO);
    // The paragraphs are drawn as (justified) text runs; the page content
    // stream carries the words, so their presence is checked there.
    const texto = (b) => {
      const s = Buffer.from(b).toString('latin1');
      return s;
    };
    expect(sim.dados.biomarcadores).toBe(true);
    expect(nao.dados.biomarcadores).toBe(false);
    expect(desc.dados.biomarcadores).toBe(false);
    // Content streams are flate-compressed by default; compare the
    // uncompressed stream text through pdf-lib's own page access instead.
    const stream = async (d) => {
      const page = d.doc.getPage(0);
      const contents = page.node.Contents();
      const refs = contents instanceof PDFLib.PDFArray ? contents.asArray() : [contents];
      let out = '';
      for (const ref of refs) {
        const st = d.doc.context.lookup(ref);
        out += Buffer.from(PDFLib.decodePDFRawStream(st).decode()).toString('latin1');
      }
      return out;
    };
    // Text operands are hex strings (<...> Tj) in WinAnsi.
    const palavrasDe = (s) => (s.match(/<([0-9A-Fa-f]+)>\s*Tj/g) || [])
      .map((m) => Buffer.from(m.replace(/[<>]|\s*Tj/g, ''), 'hex').toString('latin1')).join(' ');
    const sSim = palavrasDe(await stream(sim));
    const sNao = palavrasDe(await stream(nao));
    expect(sSim).toContain('sangue');
    expect(sNao).not.toContain('sangue');
    expect(sNao).toContain('question');
    expect(texto(sim.bytes).length).toBeGreaterThan(1000);
  });

  test('blank cadastro and address still produce a letter with empty fields', async () => {
    const { doc } = await gerar({ controle: '292740801234567', domicilio: '1', entrevistador: '' }, null, MODO_MOVIMENTO);
    const form = doc.getForm();
    expect(form.getTextField('nome').getText() ?? '').toBe('');
    expect(form.getTextField('endereco').getText() ?? '').toBe('');
    expect(form.getTextField('municipio').getText()).toBe('Salvador/BA');
    expect(form.getTextField('saudacao').getText()).toBe('Prezado(a) morador(a),');
    expect(form.getTextField('superintendencia').getText()).toBe('Superintendência Estadual do IBGE na Bahia');
    expect(form.getTextField('superintendencia').isReadOnly()).toBe(false);
    expect(form.getTextField('assinante').getText() ?? '').toBe('');
    expect(form.getTextField('assinante').isReadOnly()).toBe(false);
  });

  test('writes a sample for visual inspection', async () => {
    const { bytes } = await gerar(LINHA, CADASTRO);
    const out = process.env.SIGC_CARTA_SAMPLE;
    if (out) await Bun.write(out, bytes);
    expect(bytes.length).toBeGreaterThan(10000);
  });
});

describe('loader', () => {
  test('readCartaUrls needs both relay attributes', () => {
    const ds = document.documentElement.dataset;
    delete ds.sigcProPdfLibJsUrl; delete ds.sigcProCartaAssetsJsUrl;
    expect(C.readCartaUrls()).toBeNull();
    ds.sigcProPdfLibJsUrl = 'chrome-extension://abc/vendor/pdf-lib/pdf-lib.min.js';
    expect(C.readCartaUrls()).toBeNull();
    ds.sigcProCartaAssetsJsUrl = 'chrome-extension://abc/vendor/carta-assets/carta-assets.js';
    expect(C.readCartaUrls()).toEqual({
      pdfLib: { jsUrl: 'chrome-extension://abc/vendor/pdf-lib/pdf-lib.min.js' },
      assets: { jsUrl: 'chrome-extension://abc/vendor/carta-assets/carta-assets.js' },
    });
    delete ds.sigcProPdfLibJsUrl; delete ds.sigcProCartaAssetsJsUrl;
  });

  test('loadCartaDeps resolves from the globals without injecting anything', async () => {
    const before = document.querySelectorAll('script').length;
    const deps = await C.loadCartaDeps();
    expect(deps.PDFLib).toBe(PDFLib);
    expect(deps.assets).toBe(assets);
    expect(document.querySelectorAll('script').length).toBe(before);
  });
});

describe('gerarCarta: usuário-module session via a tab', () => {
  const P = window.__sigcPro;
  let downloads, opened, lookups, prevLookup, prevOpen, prevDownload;
  const authErr = () => Object.assign(new Error('sem sessão'), { code: 'auth', loginUrl: 'https://portalweb.ibge.gov.br/x$$/usuario/?codigoPesquisa=PNS2025' });
  const fakeWin = () => ({ closed: false, close() { this.closed = true; } });

  const setup = (lookupImpl, openImpl) => {
    downloads = []; opened = []; lookups = 0;
    prevLookup = window.__sigcProUsuarioLookup; prevOpen = window.open; prevDownload = P.downloadFile;
    window.__sigcProUsuarioLookup = { lookupUsuario: async (s) => { lookups += 1; return lookupImpl(s, lookups); } };
    window.open = (url, name) => { opened.push({ url, name }); return openImpl(); };
    P.downloadFile = (name, bytes) => downloads.push({ name, size: bytes.length });
    C.ESPERA.intervaloMs = 5; C.ESPERA.maxMs = 200;
  };
  const teardown = () => {
    window.__sigcProUsuarioLookup = prevLookup; window.open = prevOpen; P.downloadFile = prevDownload;
    C.ESPERA.intervaloMs = 2000; C.ESPERA.maxMs = 90000;
    document.getElementById('sigc-pro-carta-toast')?.remove();
  };
  // precisaSessao() is module state; each test starts without it.
  const limparFlag = async () => {
    setup(() => CADASTRO, () => fakeWin());
    try { await C.gerarCarta({ row: LINHA, modo: MODO_DEMANDA, filtro: null, panelEl: panel() }); } finally { teardown(); }
  };
  beforeEach(limparFlag);
  const panel = () => { const d = document.createElement('div'); d.innerHTML = '<span class="sigc-pro-carta-status"></span>'; return d; };

  test('no session: opens the module in a tab, retries until the lookup answers, closes the tab, fills the letter', async () => {
    const win = fakeWin();
    setup((s, n) => { if (n < 3) throw authErr(); return CADASTRO; }, () => win);
    try {
      const p = panel();
      const dados = await C.gerarCarta({ row: LINHA, modo: MODO_DEMANDA, filtro: { IdUf: '29' }, panelEl: p });
      expect(opened).toEqual([{ url: 'https://portalweb.ibge.gov.br/x$$/usuario/?codigoPesquisa=PNS2025', name: 'sigc-pro-usuario-login' }]);
      expect(lookups).toBe(3);
      expect(win.closed).toBe(true);
      expect(dados.campos.email_institucional).toBe('alexandre.santana@ibge.gov.br');
      expect(downloads).toEqual([{ name: 'carta_292740801234567_3.pdf', size: expect.any(Number) }]);
      expect(p.querySelector('.sigc-pro-carta-status').textContent).toContain('gerada para Alexandre Silva de Santana');
      expect(document.getElementById('sigc-pro-carta-toast')).toBeNull();
    } finally { teardown(); }
  });

  test('session never comes (timeout): letter without cadastro, toast with the login link, tab left open', async () => {
    const win = fakeWin();
    setup(() => { throw authErr(); }, () => win);
    try {
      const dados = await C.gerarCarta({ row: LINHA, modo: MODO_DEMANDA, filtro: null, panelEl: panel() });
      expect(opened.length).toBe(1);
      expect(lookups).toBeGreaterThan(2);
      expect(win.closed).toBe(false);
      expect(dados.campos.email_institucional).toBe('');
      expect(dados.campos.nome).toBe('Alexandre Silva de Santana');
      expect(downloads.length).toBe(1);
      const toast = document.getElementById('sigc-pro-carta-toast');
      expect(toast.textContent).toContain('módulo de usuários');
      expect(toast.querySelector('a').getAttribute('href')).toContain('/usuario/?codigoPesquisa=PNS2025');
    } finally { teardown(); }
  });

  test('user closes the tab: stops polling, letter without cadastro', async () => {
    const win = fakeWin();
    setup((s, n) => { if (n === 2) win.closed = true; throw authErr(); }, () => win);
    try {
      await C.gerarCarta({ row: LINHA, modo: MODO_DEMANDA, filtro: null, panelEl: panel() });
      expect(lookups).toBe(2);
      expect(downloads.length).toBe(1);
    } finally { teardown(); }
  });

  test('popup blocked: no polling, letter without cadastro, toast says click again; next click pre-opens the tab', async () => {
    setup(() => { throw authErr(); }, () => null);
    try {
      expect(C.precisaSessao()).toBe(false);
      await C.gerarCarta({ row: LINHA, modo: MODO_DEMANDA, filtro: null, panelEl: panel() });
      expect(lookups).toBe(1);
      expect(downloads.length).toBe(1);
      const toast = document.getElementById('sigc-pro-carta-toast');
      expect(toast.textContent).toContain('Clique em Carta de novo');
      expect(toast.querySelector('a')).not.toBeNull();
      expect(C.precisaSessao()).toBe(true);
    } finally { teardown(); }
    // Second click: the map handler opens the tab synchronously and
    // hands it in; gerarCarta polls on it and closes it on success.
    const win = fakeWin();
    const prevL = window.__sigcProUsuarioLookup;
    setup((s, n) => { if (n < 2) throw authErr(); return CADASTRO; }, () => win);
    window.__sigcProUsuarioLookup.loginUrl = () => 'https://portalweb.ibge.gov.br/x$$/usuario/?codigoPesquisa=PNS2025';
    try {
      const janela = C.abrirModuloUsuarios();
      expect(janela).toBe(win);
      expect(opened[0].url).toContain('/usuario/?codigoPesquisa=PNS2025');
      const dados = await C.gerarCarta({ row: LINHA, modo: MODO_DEMANDA, filtro: null, panelEl: panel(), janela });
      expect(opened.length).toBe(1); // no second window
      expect(win.closed).toBe(true);
      expect(dados.campos.email_institucional).toBe('alexandre.santana@ibge.gov.br');
      expect(C.precisaSessao()).toBe(false);
    } finally { teardown(); window.__sigcProUsuarioLookup = prevL; }
  });

  test('a pre-opened tab is closed at once when the session turns out to be fine', async () => {
    const win = fakeWin();
    setup(() => CADASTRO, () => win);
    try {
      await C.gerarCarta({ row: LINHA, modo: MODO_DEMANDA, filtro: null, panelEl: panel(), janela: win });
      expect(win.closed).toBe(true);
      expect(opened.length).toBe(0);
    } finally { teardown(); }
  });

  test('other lookup failures do not open anything', async () => {
    setup(() => { throw new Error('HTTP 500'); }, () => fakeWin());
    try {
      await C.gerarCarta({ row: LINHA, modo: MODO_DEMANDA, filtro: null, panelEl: panel() });
      expect(opened.length).toBe(0);
      expect(lookups).toBe(1);
      expect(downloads.length).toBe(1);
      expect(document.getElementById('sigc-pro-carta-toast').textContent).toContain('não pôde ser lido');
    } finally { teardown(); }
  });
});

describe('review fixes', () => {
  test.each([
    ['DI PIETRO', 'Di Pietro'],
    ['RUA (FUNDOS)', 'Rua (Fundos)'],
    ["D'ÁVILA", "D'Ávila"],
    ['QUADRA XIV LOTE VI', 'Quadra XIV Lote VI'],
    ['CONJUNTO MIL', 'Conjunto Mil'],
    ['LOTE CD', 'Lote Cd'],
  ])('titleCasePt %p -> %p', (a, b) => { expect(C.titleCasePt(a)).toBe(b); });

  test.each([['SN'], ['S N'], ['s/n'], ['S/N.'], ['0'], ['']])('número %p -> S/N', (n) => {
    expect(C.enderecoDaLinha({ logradouro: 'RUA A', numero: n }).endereco).toBe('Rua A, S/N');
  });

  test('siape from the row wins; agência precedence is row, filter, cadastro', () => {
    const d = C.dadosDaCarta({ row: { ...LINHA, agencia: '' }, modo: MODO_DEMANDA, filtro: null,
      cadastro: { ...CADASTRO, siape: '9999999', agencia: 'DO AGENTE' }, agenciaFiltro: 'DO FILTRO' });
    expect(d.campos.siape).toBe('1234567');
    expect(d.campos.agencia_descricao).toBe('DO FILTRO');
    const semFiltro = C.dadosDaCarta({ row: { ...LINHA, agencia: '' }, modo: MODO_DEMANDA, filtro: null,
      cadastro: { ...CADASTRO, agencia: 'DO AGENTE' }, agenciaFiltro: '' });
    expect(semFiltro.campos.agencia_descricao).toBe('DO AGENTE');
  });

  test('a field value outside WinAnsi does not kill the letter', async () => {
    const dados = C.dadosDaCarta({ row: { ...LINHA, complemento: 'BLOCO → Ł' }, modo: MODO_DEMANDA, filtro: null,
      cadastro: { ...CADASTRO, nome: 'JOÃO ŁUKASZ' } });
    const bytes = await C.buildCartaPdf(dados, { PDFLib, assets });
    const doc = await PDFLib.PDFDocument.load(bytes);
    expect(doc.getForm().getTextField('complemento').getText()).toBe('Bloco ? ?');
    expect(doc.getForm().getTextField('nome').getText()).toBe('João ?ukasz');
  });
});

describe('gerarCarta: review fixes', () => {
  const P = window.__sigcPro;
  let prevLookup, prevOpen, prevDownload, prevExport, downloads, agenciaCalls;
  const authErr = () => Object.assign(new Error('sem sessão'), { code: 'auth', loginUrl: 'https://portalweb.ibge.gov.br/x$$/usuario/' });
  const setup = (lookupImpl) => {
    prevLookup = window.__sigcProUsuarioLookup; prevOpen = window.open; prevDownload = P.downloadFile;
    prevExport = window.__sigcProUltimoMovimentoExportInternals;
    downloads = []; agenciaCalls = [];
    let n = 0;
    window.__sigcProUsuarioLookup = { lookupUsuario: async (s) => { n += 1; return lookupImpl(s, n); } };
    window.open = () => ({ closed: false, close() { this.closed = true; } });
    P.downloadFile = (name, bytes) => downloads.push(name);
    window.__sigcProUltimoMovimentoExportInternals = { fetchAgenciaList: async (uf) => { agenciaCalls.push(uf); return [{ key: '2905', description: 'DA LISTA' }]; } };
    C.ESPERA.intervaloMs = 5; C.ESPERA.maxMs = 300;
  };
  const teardown = () => {
    window.__sigcProUsuarioLookup = prevLookup; window.open = prevOpen; P.downloadFile = prevDownload;
    window.__sigcProUltimoMovimentoExportInternals = prevExport;
    C.ESPERA.intervaloMs = 2000; C.ESPERA.maxMs = 90000;
    document.getElementById('sigc-pro-carta-toast')?.remove();
  };
  const panel = () => { const d = document.createElement('div'); d.innerHTML = '<span class="sigc-pro-carta-status"></span>'; return d; };

  test('the sign-in poll survives a transient HTTP error', async () => {
    setup((s, n) => { if (n === 1) throw authErr(); if (n === 2) throw new Error('HTTP 401'); return CADASTRO; });
    try {
      const dados = await C.gerarCarta({ row: LINHA, modo: MODO_DEMANDA, filtro: null, panelEl: panel() });
      expect(dados.campos.email_institucional).toBe('alexandre.santana@ibge.gov.br');
      expect(C.precisaSessao()).toBe(false);
    } finally { teardown(); }
  });

  test('unknown or inactive siape: letter without cadastro and a toast saying so', async () => {
    setup(() => null);
    try {
      const dados = await C.gerarCarta({ row: LINHA, modo: MODO_DEMANDA, filtro: null, panelEl: panel() });
      expect(dados.campos.email_institucional).toBe('');
      expect(dados.campos.nome).toBe('Alexandre Silva de Santana');
      expect(document.getElementById('sigc-pro-carta-toast').textContent).toContain('não encontrada');
    } finally { teardown(); }
  });

  test('the agência list is only requested when the row has no agência', async () => {
    setup(() => CADASTRO);
    try {
      // UF 33: the per-UF list cache is module state and an earlier test
      // already filled UF 29.
      await C.gerarCarta({ row: LINHA, modo: MODO_DEMANDA, filtro: { IdUf: '33', IdAgencia: '2905' }, panelEl: panel() });
      expect(agenciaCalls).toEqual([]);
      const d = await C.gerarCarta({ row: { ...LINHA, agencia: '' }, modo: MODO_MOVIMENTO, filtro: { IdUf: '33', IdAgencia: '2905' }, panelEl: panel() });
      expect(agenciaCalls).toEqual(['33']);
      expect(d.campos.agencia_descricao).toBe('DA LISTA');
    } finally { teardown(); }
  });
});
