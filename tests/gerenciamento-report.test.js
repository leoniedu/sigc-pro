import { describe, test, expect, beforeEach, afterEach, afterAll } from 'bun:test';

await import('../extension/common/sigc-common.js');
await import('../extension/common/municipios.js');
await import('../extension/common/sigc-panel.js');
await import('../extension/features/gerenciamento-coleta/gerenciamento-parse.js');
await import('../extension/features/gerenciamento-coleta/gerenciamento-aggregate.js');
await import('../extension/features/gerenciamento-coleta/gerenciamento-report.js');
const G = window.__sigcProGerenciamento;
const FIXTURE = await Bun.file(new URL('./fixtures/gerenciamento-coleta.html', import.meta.url)).text();
const PARSED = G.parseGerenciamentoHtml(FIXTURE);

const ORIGINAL_URL = window.location.href;
const ORIGIN = 'https://portalweb.ibge.gov.br';
const F5_HEX = '68747470733a2f2f773373696763706e73323032352e696267652e676f762e6272';
const PAGE = `/f5-w-${F5_HEX}$$/relatorio/relatorio-aprov-coleta-gerencial`;
afterAll(() => window.happyDOM.setURL(ORIGINAL_URL));

const realPost = window.__sigcPro.postRelatorio;
const realDownload = window.__sigcPro.downloadFile;
const realAlert = globalThis.alert;
let posts;
let downloads;
let alerts;

beforeEach(() => {
  G.resetCache();
  document.body.innerHTML = '';
  posts = [];
  downloads = [];
  alerts = [];
  globalThis.alert = (m) => alerts.push(m);
  window.__sigcPro.downloadFile = (nome, texto) => downloads.push({ nome, texto });
  window.__sigcPro.postRelatorio = async (args) => {
    posts.push(args);
    return args.parse(FIXTURE);
  };
});
afterEach(() => {
  window.__sigcPro.postRelatorio = realPost;
  window.__sigcPro.downloadFile = realDownload;
  globalThis.alert = realAlert;
  G.fecharPainel();
});

describe('onGerenciamento', () => {
  test('matches the report slug, behind the gateway or not', () => {
    expect(G.onGerenciamento(PAGE)).toBe(true);
    expect(G.onGerenciamento('/relatorio/relatorio-aprov-coleta-gerencial')).toBe(true);
    expect(G.onGerenciamento('/relatorio/relatorio-aprov-coleta-gerencial/')).toBe(true);
  });
  test('does not match other report pages', () => {
    expect(G.onGerenciamento('/relatorio/relatorio-ultimo-movimento')).toBe(false);
    expect(G.onGerenciamento(`/f5-w-${F5_HEX}$$/relatorio/relatorio-aprov-coleta-gerencial-x`)).toBe(false);
    expect(G.onGerenciamento('/')).toBe(false);
  });
});

describe('getUf', () => {
  test('reads the (select2-hidden) #IdUf select', () => {
    document.body.innerHTML = '<select id="IdUf"><option value="29" selected>29 - BAHIA</option></select>';
    expect(G.getUf()).toBe('29');
  });
  test('falls back to the submitted filter, ignoring a wildcard UF', () => {
    document.body.innerHTML = '<select id="IdUf"><option value="*" selected>Todas</option></select>' +
      '<input id="filtroJson" value=\'{"IdUf":"31"}\'>';
    expect(G.getUf()).toBe('31');
  });
  test('empty when neither source has a UF, and survives broken JSON', () => {
    document.body.innerHTML = '<input id="filtroJson" value="{nao json">';
    expect(G.getUf()).toBe('');
    expect(G.getUf()).toBe('');
  });
});

describe('filtroBody', () => {
  test('whole UF: every other field is the wildcard', () => {
    const body = G.filtroBody('29');
    expect(body.startsWith('filtro=')).toBe(true);
    expect(JSON.parse(decodeURIComponent(body.slice(7)))).toEqual({
      IdFiltro: 'relatorio-aprov-coleta-gerencial', IdUf: '29', IdAgencia: '*',
      IdMunicipio: '*', Controle: '*', IdTipoAcompanhamento: '*',
    });
  });
});

describe('carregar (in-memory cache)', () => {
  test('a second call inside the TTL makes no request', async () => {
    const a = await G.carregar('29');
    const b = await G.carregar('29');
    expect(posts).toHaveLength(1);
    expect(a.doCache).toBe(false);
    expect(b.doCache).toBe(true);
    expect(b.rows).toHaveLength(PARSED.rows.length);
    expect(posts[0].slug).toBe('relatorio-aprov-coleta-gerencial');
  });
  test('forcar bypasses the cache', async () => {
    await G.carregar('29');
    await G.carregar('29', { forcar: true });
    expect(posts).toHaveLength(2);
  });
  test('each UF has its own entry', async () => {
    await G.carregar('29');
    await G.carregar('31');
    expect(posts).toHaveLength(2);
  });
  test('an expired entry is fetched again', async () => {
    const realNow = Date.now;
    try {
      await G.carregar('29');
      Date.now = () => realNow() + G.TTL_MS + 1;
      await G.carregar('29');
    } finally {
      Date.now = realNow;
    }
    expect(posts).toHaveLength(2);
  });
  test('concurrent calls share one request', async () => {
    await Promise.all([G.carregar('29'), G.carregar('29')]);
    expect(posts).toHaveLength(1);
  });
  test('a forced reload does not join a request already in flight', async () => {
    const p1 = G.carregar('29');
    const p2 = G.carregar('29', { forcar: true });
    await Promise.all([p1, p2]);
    expect(posts).toHaveLength(2);
  });
  test('a failure is not cached and the next call retries', async () => {
    window.__sigcPro.postRelatorio = async () => { throw new Error('HTTP 500'); };
    await expect(G.carregar('29')).rejects.toThrow('HTTP 500');
    window.__sigcPro.postRelatorio = async (a) => { posts.push(a); return a.parse(FIXTURE); };
    const r = await G.carregar('29');
    expect(r.rows.length).toBeGreaterThan(0);
  });
});

describe('launcher mount', () => {
  test('appears right after Filtrar on the Gerenciamento page only', () => {
    document.body.innerHTML = '<div><a id="btnFiltrar">Filtrar</a><span id="outro"></span></div>';
    window.happyDOM.setURL(`${ORIGIN}/relatorio/relatorio-ultimo-movimento`);
    window.__sigcPro.recheckMounts();
    expect(document.getElementById(G.BUTTON_ID)).toBeNull();

    window.happyDOM.setURL(`${ORIGIN}${PAGE}`);
    window.__sigcPro.recheckMounts();
    const btn = document.getElementById(G.BUTTON_ID);
    expect(btn).not.toBeNull();
    expect(document.getElementById('btnFiltrar').nextElementSibling).toBe(btn);
    expect(btn.textContent.replace(/\s+/g, '')).toBe('GEREN-PRO');
  });
});

describe('panel', () => {
  const abrir = () => {
    const dados = { rows: PARSED.rows, warnings: [], em: Date.now() };
    return G.abrirPainel('29', dados, async () => ({ ...dados, em: Date.now() }));
  };
  const aba = (p, id) => p.querySelector(`.sigc-gc-aba-btn[data-aba="${id}"]`).click();
  const mudar = (p, campo, valor) => {
    const el = p.querySelector(`[data-gc="${campo}"]`);
    el.value = valor;
    el.dispatchEvent(new window.Event('change', { bubbles: true }));
  };
  const cabecalhos = (p, id) => [...p.querySelectorAll(`#sigc-gc-tab-${id} thead tr:first-child th`)].map((t) => t.textContent);

  test('tabs are Domicílios, Município, Agência, Histórico, in that order, opening on Domicílios', () => {
    const p = abrir();
    expect([...p.querySelectorAll('.sigc-gc-aba-btn')].map((b) => b.textContent))
      .toEqual(['Domicílios', 'Município', 'Agência', 'Histórico']);
    expect(p.querySelector('.sigc-gc-aba-btn.sigc-gc-ativa').textContent).toBe('Domicílios');
    expect(p.querySelector('#sigc-gc-tab-domicilios')).not.toBeNull();
  });

  test('there are no agência/município selectors above the table; Amostra Bio and Valores remain', () => {
    const p = abrir();
    expect(p.querySelector('[data-gc="agencia"]')).toBeNull();
    expect(p.querySelector('[data-gc="municipio"]')).toBeNull();
    expect(p.querySelector('[data-gc="bio"]')).not.toBeNull();
    expect(p.querySelector('[data-gc="visao"]')).not.toBeNull();
    expect(p.textContent).toContain('38 de 38 domicílios');
  });

  test('a new label raises a visible warning', () => {
    const p = abrir();
    expect(p.querySelector('.sigc-gc-avisos').textContent).toContain('Rótulo novo de teste');
  });

  test('Domicílios names the município (no code column) and lists every household', () => {
    const p = abrir();
    expect(cabecalhos(p, 'domicilios')).toContain('Município');
    expect(cabecalhos(p, 'domicilios')).not.toContain('Cód. município');
    const linhas = p.querySelectorAll('#sigc-gc-tab-domicilios tbody tr');
    expect(linhas).toHaveLength(38);
    const texto = [...linhas].map((l) => l.textContent).join('|');
    expect(texto).toContain('SALVADOR');
  });

  test('Município and Agência have one column per portal label; "Não iniciada" is renamed', () => {
    const p = abrir();
    aba(p, 'municipio');
    const th = cabecalhos(p, 'municipio');
    expect(th).toContain('Sem entrevista iniciada');
    expect(th).toContain('Homem selecionado a realizar');
    expect(th).toContain('Mulher selecionada a realizar');
    expect(th).toContain('Rótulo novo de teste (novo)');
    expect(th).not.toContain('Não iniciada');
    expect(p.querySelectorAll('#sigc-gc-tab-municipio tbody tr')).toHaveLength(2);
    aba(p, 'agencia');
    expect(p.querySelectorAll('#sigc-gc-tab-agencia tbody tr')).toHaveLength(2);
  });

  test('filtering Amostra Bio hides the Bio Sim/Não columns and narrows every tab', () => {
    const p = abrir();
    aba(p, 'agencia');
    expect(cabecalhos(p, 'agencia')).toContain('Bio Sim');
    mudar(p, 'bio', 'sim');
    aba(p, 'agencia');
    expect(cabecalhos(p, 'agencia')).not.toContain('Bio Sim');
    expect(cabecalhos(p, 'agencia')).not.toContain('Bio Não');
    aba(p, 'domicilios');
    expect(cabecalhos(p, 'domicilios')).not.toContain('Amostra Bio');
    const n = p.querySelectorAll('#sigc-gc-tab-domicilios tbody tr').length;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(38);
    expect(p.textContent).toContain(`${n} de 38 domicílios`);
    mudar(p, 'bio', '');
    expect(cabecalhos(p, 'domicilios')).toContain('Amostra Bio');
  });

  test('numeric columns declare their type so DataTables cannot sort them as text', () => {
    const p = abrir();
    aba(p, 'municipio');
    mudar(p, 'visao', 'pct');
    const numericos = [...p.querySelectorAll('#sigc-gc-tab-municipio thead tr:first-child th')]
      .filter((t) => t.dataset.sigcType === 'num');
    expect(numericos.length).toBe(cabecalhos(p, 'municipio').length - 1);
    expect(p.querySelector('#sigc-gc-tab-municipio th').dataset.sigcType).toBeUndefined();
    aba(p, 'domicilios');
    expect([...p.querySelectorAll('#sigc-gc-tab-domicilios th')].find((t) => t.textContent === 'Domicílio').dataset.sigcType).toBe('num');
  });

  test('sort keys are fixed-width, so text order equals numeric order in both views', () => {
    const p = abrir();
    const chaves = (id, col) => [...p.querySelectorAll(`#sigc-gc-tab-${id} tbody tr td:nth-child(${col})`)]
      .map((td) => td.getAttribute('data-order'));
    const iguais = (ks) => {
      const porTexto = [...ks].sort();
      const porNumero = [...ks].sort((a, b) => Number(a) - Number(b));
      expect(porTexto).toEqual(porNumero);
      expect(new Set(ks.map((k) => k.length)).size).toBe(1);
    };
    aba(p, 'agencia');
    for (let col = 2; col <= 6; col += 1) iguais(chaves('agencia', col));
    mudar(p, 'visao', 'pct');
    aba(p, 'agencia');
    for (let col = 2; col <= 6; col += 1) iguais(chaves('agencia', col));
    expect(chaves('agencia', 3).every((k) => /^\d{3}\.\d{4}$/.test(k))).toBe(true);
    aba(p, 'domicilios');
    iguais(chaves('domicilios', 2));
  });

  test('the Valores switch: counts by default, percentage of the row on request', () => {
    const p = abrir();
    aba(p, 'agencia');
    const celula = () => p.querySelector('#sigc-gc-tab-agencia tbody tr td:nth-child(3)');
    expect(celula().textContent).not.toContain('%');
    mudar(p, 'visao', 'pct');
    expect(celula().textContent).toMatch(/^\d+(,\d)?%$/);
    mudar(p, 'visao', 'n');
    expect(celula().textContent).not.toContain('%');
  });

  test('CSV of a tab: header + numeric cells, percentages without the sign', () => {
    const p = abrir();
    aba(p, 'municipio');
    mudar(p, 'visao', 'pct');
    aba(p, 'municipio');
    p.querySelector('[data-gc="csv"]').click();
    expect(downloads).toHaveLength(1);
    expect(downloads[0].nome).toMatch(/^sigc-pro-gerenciamento-municipio_uf29_\d{4}-?\d{2}-?\d{2}.*\.csv$/);
    const linhas = downloads[0].texto.replace(/^\uFEFF/, '').trim().split('\n');
    expect(linhas[0]).toContain('Município');
    expect(linhas[0]).toContain('Recusa do domicílio');
    expect(linhas.length).toBe(3);
    expect(linhas[1]).not.toContain('%');
    const cols = linhas[1].split(';');
    expect(cols[1]).toMatch(/^\d+$/);
    expect(cols.slice(2, 4).every((c) => /^\d+(,\d)?$/.test(c))).toBe(true);
  });

  test('CSV of Domicílios carries the município name', () => {
    const p = abrir();
    p.querySelector('[data-gc="csv"]').click();
    const linhas = downloads[0].texto.replace(/^\uFEFF/, '').trim().split('\n');
    expect(linhas).toHaveLength(39);
    expect(linhas[0]).toContain('Município');
    expect(linhas.slice(1).join('\n')).toContain('SALVADOR');
  });

  test('values are escaped', () => {
    const rows = [{ ...PARSED.rows[0], agenciaNome: '<img src=x onerror=alert(1)>', andamento: '<b>x</b>' }];
    const p = G.abrirPainel('29', { rows, warnings: ['<i>w</i>'], em: Date.now() }, null);
    expect(p.querySelector('img') === null).toBe(true);
    expect(p.querySelector('.sigc-gc-avisos i') === null).toBe(true);
    expect(p.innerHTML).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(p.innerHTML).toContain('&lt;b&gt;x&lt;/b&gt;');
  });

  test('Atualizar re-requests and keeps the Bio scope', async () => {
    let n = 0;
    const dados = { rows: PARSED.rows, warnings: [], em: Date.now() };
    const p = G.abrirPainel('29', dados, async () => { n += 1; return { ...dados, em: Date.now() }; });
    mudar(p, 'bio', 'sim');
    p.querySelector('[data-gc="atualizar"]').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(n).toBe(1);
    expect(p.querySelector('[data-gc="bio"]').value).toBe('sim');
  });

  test('the panel is marked as SIGC-PRO so the page-table lookup skips its tables', () => {
    const p = abrir();
    expect(p.hasAttribute('data-sigc-pro')).toBe(true);
    expect(window.__sigcPro.isSigcProTable(p.querySelector('#sigc-gc-tab-domicilios'))).toBe(true);
  });

  test('Fechar is white on the blue header, not the page\'s dark button text', () => {
    abrir();
    const css = document.getElementById('sigc-pro-gerenciamento-style').textContent;
    expect(css).toMatch(/\.sigc-gc-head button \{[^}]*color: #fff/);
  });

  test('Fechar removes the panel', () => {
    const p = abrir();
    p.querySelector('[data-gc="fechar"]').click();
    expect(document.getElementById(G.PANEL_ID)).toBeNull();
  });
});
