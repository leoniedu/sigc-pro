import { describe, test, expect, beforeEach, afterEach, afterAll } from 'bun:test';

await import('../extension/common/sigc-common.js');
await import('../extension/common/municipios.js');
await import('../extension/common/sigc-panel.js');
await import('../extension/features/gerenciamento-coleta/gerenciamento-parse.js');
await import('../extension/features/gerenciamento-coleta/gerenciamento-aggregate.js');
await import('../extension/features/gerenciamento-historico/historico-agregar.js');
await import('../extension/features/gerenciamento-historico/historico-view.js');
await import('../extension/features/gerenciamento-coleta/gerenciamento-report.js');
const G = window.__sigcProGerenciamento;
const A = window.__sigcProHistoricoAgregar;
const FIXTURE = await Bun.file(new URL('./fixtures/gerenciamento-coleta.html', import.meta.url)).text();
const PARSED = G.parseGerenciamentoHtml(FIXTURE);
const ROWS = PARSED.rows;

const realPost = window.__sigcPro.postRelatorio;
const realDownload = window.__sigcPro.downloadFile;
const realAlert = globalThis.alert;
const realConfirm = globalThis.confirm;

// An in-memory stand-in for historico-client.js (the real one is covered by
// historico-bridge.test.js); it keeps what the report saves.
function fakeHistorico() {
  const exec = new Map();
  const prefs = new Map();
  const f = {
    exec, prefs, calls: [],
    async salvarExecucao(rec) { f.calls.push(['salvar', rec.dia]); exec.set(`${rec.uf}|${rec.dia}`, { ...rec, chave: `${rec.uf}|${rec.dia}` }); },
    async getResumo(uf) { return [...exec.values()].filter((r) => r.uf === uf).map((r) => ({ chave: r.chave, dia: r.dia, run_ts: r.run_ts, total: r.total })); },
    async listar(uf) { return [...exec.values()].filter((r) => r.uf === uf).sort((a, b) => a.dia.localeCompare(b.dia)); },
    async contar() { return { execucoes: exec.size, ufs: [...new Set([...exec.values()].map((r) => r.uf))] }; },
    async limpar() { exec.clear(); },
    async getPref(k) { return prefs.has(k) ? prefs.get(k) : null; },
    async setPref(k, v) { prefs.set(k, v); },
  };
  return f;
}

const ts = (dia) => Date.parse(`${dia}T15:00:00Z`);
let H;
let downloads;
let alerts;
beforeEach(() => {
  G.resetCache();
  document.body.innerHTML = '';
  H = fakeHistorico();
  window.__sigcProHistorico = H;
  downloads = []; alerts = [];
  globalThis.alert = (m) => alerts.push(m);
  globalThis.confirm = () => true;
  window.__sigcPro.downloadFile = (nome, texto) => downloads.push({ nome, texto });
  window.__sigcPro.postRelatorio = async (args) => args.parse(FIXTURE);
});
afterEach(() => {
  G.fecharPainel();
  delete window.__sigcProHistorico;
  window.__sigcPro.postRelatorio = realPost;
  window.__sigcPro.downloadFile = realDownload;
  globalThis.alert = realAlert;
  globalThis.confirm = realConfirm;
});

const tick = () => new Promise((r) => setTimeout(r, 0));
async function seed(dias, rowsDe = () => ROWS) {
  for (const dia of dias) await H.salvarExecucao(A.construirExecucao('29', rowsDe(dia), ts(dia)));
}
async function abrirHistorico() {
  const dados = { rows: ROWS, warnings: [], em: ts('2026-10-21') };
  const p = G.abrirPainel('29', dados, null);
  p.querySelector('.sigc-gc-aba-btn[data-aba="historico"]').click();
  await tick(); await tick(); await tick();
  return p;
}
const mudar = async (p, sel, valor) => {
  const el = p.querySelector(sel);
  el.value = valor;
  el.dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick(); await tick(); await tick();
};
// The option the page was drawn with ("selected" in the markup): read from the
// attribute because happy-dom's select.value is unreliable with <optgroup>.
const escolhido = (p, campo) => {
  const o = [...p.querySelectorAll(`[data-hist="${campo}"] option`)].find((x) => x.hasAttribute('selected'));
  return o ? o.value : '';
};
const ths = (p) => [...p.querySelectorAll('#sigc-gc-tab-historico thead th')].map((t) => t.textContent);

describe('saving after a real fetch', () => {
  test('the first real fetch saves one run; a cache hit does not save again', async () => {
    await G.carregar('29');
    await G.carregar('29');
    expect(H.calls).toHaveLength(1);
    const [rec] = await H.listar('29');
    expect(rec.total).toBe(ROWS.length);
  });

  test('Atualizar (forced) saves again, replacing the same day', async () => {
    await G.carregar('29');
    await G.carregar('29', { forcar: true });
    expect(H.calls).toHaveLength(2);
    expect(H.exec.size).toBe(1);
  });

  test('a short response is not saved and the panel says so', async () => {
    await seed(['2026-10-14']);
    window.__sigcPro.postRelatorio = async (args) => {
      const poucas = ROWS.slice(0, 5);
      return { rows: poucas, warnings: [] };
    };
    const dados = await G.carregar('29');
    expect(H.calls).toHaveLength(1);                       // only the seed
    expect(dados.avisoHistorico).toContain('Histórico não gravado');
    const p = G.abrirPainel('29', dados, null);
    expect(p.querySelector('.sigc-gc-avisos').textContent).toContain('Histórico não gravado');
  });

  test('a partial page repeated is refused every time, with a warning each time', async () => {
    const hoje = A.diaLocal(Date.now());
    await H.salvarExecucao(A.construirExecucao('29', ROWS, Date.parse(`${A.somarDias(hoje, -2)}T15:00:00Z`)));
    window.__sigcPro.postRelatorio = async () => ({ rows: ROWS.slice(0, 10), warnings: [] });
    const a = await G.carregar('29', { forcar: true });
    const b = await G.carregar('29', { forcar: true });
    expect(a.avisoHistorico).toContain('Histórico não gravado');
    expect(b.avisoHistorico).toContain('Histórico não gravado');
    expect(H.exec.size).toBe(1);
  });

  test('a smaller run than today\'s earlier one is skipped without a warning', async () => {
    await G.carregar('29');                                         // saves the full run today
    window.__sigcPro.postRelatorio = async () => ({ rows: ROWS.slice(0, ROWS.length - 3), warnings: [] });
    const b = await G.carregar('29', { forcar: true });
    expect(b.avisoHistorico).toBeNull();
    expect([...H.exec.values()][0].total).toBe(ROWS.length);
  });

  test('a cache hit does not bring back an old history warning', async () => {
    const hoje = A.diaLocal(Date.now());
    await H.salvarExecucao(A.construirExecucao('29', ROWS, Date.parse(`${A.somarDias(hoje, -2)}T15:00:00Z`)));
    window.__sigcPro.postRelatorio = async () => ({ rows: ROWS.slice(0, 10), warnings: [] });
    const a = await G.carregar('29');
    expect(a.avisoHistorico).toContain('Histórico não gravado');
    expect((await G.carregar('29')).avisoHistorico).toBeNull();
  });

  test('a history that does not answer cannot hold the report back', async () => {
    G._setEsperaHistoricoMs(40);
    H.getResumo = () => new Promise(() => {});
    const t0 = Date.now();
    const dados = await G.carregar('29');
    G._setEsperaHistoricoMs(3000);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(dados.rows).toHaveLength(ROWS.length);
    expect(dados.avisoHistorico).toContain('não foi confirmada');
  });

  test('a storage failure never blocks the report', async () => {
    H.salvarExecucao = async () => { throw new Error('armazenamento indisponível'); };
    const dados = await G.carregar('29');
    expect(dados.rows).toHaveLength(ROWS.length);
    expect(dados.avisoHistorico).toContain('armazenamento indisponível');
  });

  test('without the history loaded the report works as before', async () => {
    delete window.__sigcProHistorico;
    const dados = await G.carregar('29');
    expect(dados.avisoHistorico).toBeNull();
    expect(dados.rows).toHaveLength(ROWS.length);
  });
});

describe('the Histórico tab', () => {
  test('says so when there is no history yet', async () => {
    const p = await abrirHistorico();
    expect(p.querySelector('.sigc-gc-secao[data-aba="historico"]').textContent).toContain('Ainda não há histórico');
    expect(p.querySelector('.sigc-gc-secao[data-aba="historico"]').textContent).toContain('nenhum dado de domicílio');
  });

  test('one column per week WITH a run, the header carrying the date and the jump over missing weeks', async () => {
    await seed(['2026-10-06', '2026-10-20']);
    const p = await abrirHistorico();
    expect(ths(p)).toEqual(['Agência', '06/10', '20/10']);
    const linhas = [...p.querySelectorAll('#sigc-gc-tab-historico tbody tr')];
    expect(linhas.map((l) => l.firstChild.textContent)).toEqual(['CACHOEIRA', 'SALVADOR 1']);
    const celulas = [...linhas[0].querySelectorAll('td')].map((td) => td.textContent);
    expect(celulas).toHaveLength(3);
    expect(Number(celulas[1])).toBeGreaterThan(0);
    expect(Number(celulas[2])).toBeGreaterThan(0);
  });

  test('an agência absent from a run has an empty cell there, not a zero', async () => {
    await seed(['2026-10-06']);
    await seed(['2026-10-20'], () => ROWS.filter((r) => r.idAgencia === '292740800'));
    const p = await abrirHistorico();
    const cach = [...p.querySelectorAll('#sigc-gc-tab-historico tbody tr')][0];
    expect(cach.firstChild.textContent).toBe('CACHOEIRA');
    expect([...cach.querySelectorAll('td')].map((td) => td.textContent)[2]).toBe('');
  });

  test('the UF row is the footer; metric defaults to questionário concluído', async () => {
    await seed(['2026-10-20']);
    const p = await abrirHistorico();
    expect(escolhido(p, 'metrica')).toBe('concluido');
    const uf = [...p.querySelectorAll('#sigc-gc-tab-historico tfoot td')].map((td) => td.textContent);
    expect(uf[0]).toBe('UF inteira');
    expect(Number(uf[1])).toBe(A.valorMetrica(H.exec.get('29|2026-10-20'), 'concluido', null, '').n);
  });

  test('changing the metric redraws the table', async () => {
    await seed(['2026-10-20']);
    const p = await abrirHistorico();
    await mudar(p, '[data-hist="metrica"]', 'total');
    const uf = [...p.querySelectorAll('#sigc-gc-tab-historico tfoot td')].map((td) => td.textContent);
    expect(Number(uf[1])).toBe(ROWS.length);
    expect(H.prefs.get('ui:29').metrica).toBe('total');
  });

  test('a portal label can be the metric, a new one included', async () => {
    await seed(['2026-10-20']);
    const p = await abrirHistorico();
    const opcoes = [...p.querySelectorAll('[data-hist="metrica"] option')].map((o) => o.value);
    expect(opcoes).toContain(`${A.ROTULO}Rótulo novo de teste`);
    await mudar(p, '[data-hist="metrica"]', `${A.ROTULO}Rótulo novo de teste`);
    const uf = [...p.querySelectorAll('#sigc-gc-tab-historico tfoot td')].map((td) => td.textContent);
    expect(Number(uf[1])).toBe(2);
  });

  test('the Valores switch of the bar applies: % of the agência total', async () => {
    await seed(['2026-10-20']);
    const p = await abrirHistorico();
    const sel = p.querySelector('[data-gc="visao"]'); sel.value = 'pct';
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
    await tick(); await tick(); await tick();
    const celula = p.querySelector('#sigc-gc-tab-historico tbody tr td:nth-child(2)').textContent;
    expect(celula).toMatch(/^\d+(,\d)?%$/);
  });

  test('the Amostra Bio filter of the bar narrows the metric and its denominator', async () => {
    await seed(['2026-10-20']);
    const p = await abrirHistorico();
    await mudar(p, '[data-hist="metrica"]', 'total');
    const bio = p.querySelector('[data-gc="bio"]'); bio.value = 'sim';
    bio.dispatchEvent(new window.Event('change', { bubbles: true }));
    await tick(); await tick(); await tick();
    const uf = [...p.querySelectorAll('#sigc-gc-tab-historico tfoot td')].map((td) => td.textContent);
    expect(Number(uf[1])).toBe(ROWS.filter((r) => r.bio === 'Sim').length);
  });

  test('one agência: the metrics are the rows', async () => {
    await seed(['2026-10-20']);
    const p = await abrirHistorico();
    await mudar(p, '[data-hist="modo"]', 'agencia');
    expect(ths(p)[0]).toBe('Métrica');
    const nomes = [...p.querySelectorAll('#sigc-gc-tab-historico tbody tr')].map((l) => l.firstChild.textContent);
    expect(nomes).toEqual(A.METRICAS.map((m) => m.nome));
    await mudar(p, '[data-hist="agencia"]', '292740800');
    const total = [...p.querySelectorAll('#sigc-gc-tab-historico tbody tr')].find((l) => l.firstChild.textContent === 'Total');
    expect(Number(total.querySelectorAll('td')[1].textContent)).toBe(ROWS.filter((r) => r.idAgencia === '292740800').length);
  });

  test('every column is shown, however many runs there are, and there is no window selector', async () => {
    await seed(['2026-08-04', '2026-08-11', '2026-08-18', '2026-08-25', '2026-09-01', '2026-09-08',
      '2026-09-15', '2026-09-22', '2026-09-29', '2026-10-06', '2026-10-13', '2026-10-20']);
    const p = await abrirHistorico();
    expect(p.querySelector('[data-hist="semanas"]')).toBeNull();
    expect(ths(p)).toHaveLength(1 + 12);
  });

  test('remembered choices are per UF: another UF starts from the defaults', async () => {
    await seed(['2026-10-20']);
    H.prefs.set('ui:31', { modo: 'agencia', metrica: 'sem_inicio', agencia: '290490200' });
    const p = await abrirHistorico();
    expect(escolhido(p, 'metrica')).toBe('concluido');
  });

  test('a remembered choice this UF cannot honour falls back instead of showing an empty table', async () => {
    await seed(['2026-10-20']);
    H.prefs.set('ui:29', { modo: 'agencia', metrica: `${A.ROTULO}Rótulo que só existe em outra UF`, agencia: '999999999' });
    const p = await abrirHistorico();
    expect(escolhido(p, 'agencia')).toBe('');
    const total = [...p.querySelectorAll('#sigc-gc-tab-historico tbody tr')].find((l) => l.firstChild.textContent === 'Total');
    expect(Number(total.querySelectorAll('td')[1].textContent)).toBe(ROWS.length);
    await mudar(p, '[data-hist="modo"]', 'agencias');
    expect(escolhido(p, 'metrica')).toBe('concluido');
  });

  test('remembered choices are read back the next time', async () => {
    await seed(['2026-10-20']);
    H.prefs.set('ui:29', { modo: 'agencias', metrica: 'sem_inicio', agencia: '' });
    const p = await abrirHistorico();
    expect(escolhido(p, 'metrica')).toBe('sem_inicio');
  });

  test('exports EVERY day as a long CSV, not just the last run of each week', async () => {
    await seed(['2026-10-06', '2026-10-07', '2026-10-08']);
    const p = await abrirHistorico();
    p.querySelector('[data-hist="exportar"]').click();
    await tick(); await tick(); await tick();
    expect(downloads).toHaveLength(1);
    const dias = new Set(downloads[0].texto.replace(/^\uFEFF/, '').trim().split(/\r?\n/).slice(1).map((l) => l.split(';')[1]));
    expect([...dias].sort()).toEqual(['2026-10-06', '2026-10-07', '2026-10-08']);
  });

  test('the export carries the Não iniciada split', async () => {
    await seed(['2026-10-06']);
    const p = await abrirHistorico();
    p.querySelector('[data-hist="exportar"]').click();
    await tick(); await tick(); await tick();
    expect(downloads[0].texto).toContain('(situação) Não iniciada — encerrado');
    expect(downloads[0].texto).toContain('(situação) Não iniciada — ainda a trabalhar');
  });

  test('exports the whole history as a long CSV', async () => {
    await seed(['2026-10-06', '2026-10-20']);
    const p = await abrirHistorico();
    p.querySelector('[data-hist="exportar"]').click();
    await tick(); await tick(); await tick();
    expect(downloads).toHaveLength(1);
    expect(downloads[0].nome).toMatch(/^sigc-pro-historico_uf29_/);
    const linhas = downloads[0].texto.replace(/^﻿/, '').trim().split(/\r?\n/);
    expect(linhas[0]).toBe('uf;dia;idAgencia;agencia;andamento;amostraBio;n');
    expect(linhas.length).toBeGreaterThan(2 * 20);
  });

  test('the panel CSV button exports the table on screen, numbers bare', async () => {
    await seed(['2026-10-20']);
    const p = await abrirHistorico();
    p.querySelector('[data-gc="csv"]').click();
    expect(downloads).toHaveLength(1);
    const linhas = downloads[0].texto.replace(/^﻿/, '').trim().split(/\r?\n/);
    expect(linhas[0]).toBe('Agência;20/10');
    expect(linhas[1].split(';')[1]).toMatch(/^\d+$/);
  });

  test('Limpar asks first, names what goes, and empties the history', async () => {
    await seed(['2026-10-06', '2026-10-20']);
    let pergunta = '';
    globalThis.confirm = (m) => { pergunta = m; return true; };
    const p = await abrirHistorico();
    p.querySelector('[data-hist="limpar"]').click();
    await tick(); await tick(); await tick(); await tick();
    expect(pergunta).toContain('2 foto(s)');
    expect(pergunta).toContain('29');
    expect(H.exec.size).toBe(0);
    expect(p.querySelector('.sigc-gc-secao[data-aba="historico"]').textContent).toContain('Ainda não há histórico');
  });

  test('declining the confirmation keeps everything', async () => {
    await seed(['2026-10-20']);
    globalThis.confirm = () => false;
    const p = await abrirHistorico();
    p.querySelector('[data-hist="limpar"]').click();
    await tick(); await tick(); await tick();
    expect(H.exec.size).toBe(1);
  });

  test('Atualizar re-reads the history so the new run shows', async () => {
    const dados = { rows: ROWS, warnings: [], em: ts('2026-10-21') };
    let n = 0;
    const p = G.abrirPainel('29', dados, async () => { n += 1; await seed(['2026-10-20']); return dados; });
    p.querySelector('.sigc-gc-aba-btn[data-aba="historico"]').click();
    await tick(); await tick(); await tick();
    expect(p.querySelector('.sigc-gc-secao[data-aba="historico"]').textContent).toContain('Ainda não há histórico');
    p.querySelector('[data-gc="atualizar"]').click();
    await tick(); await tick(); await tick(); await tick();
    expect(n).toBe(1);
    expect(ths(p)).toEqual(['Agência', '20/10']);
  });

  test('the runs are re-read every time the tab is shown', async () => {
    await seed(['2026-10-06']);
    const p = await abrirHistorico();
    expect(ths(p)).toEqual(['Agência', '06/10']);
    await seed(['2026-10-13']);                                   // saved from elsewhere
    p.querySelector('.sigc-gc-aba-btn[data-aba="municipio"]').click();
    p.querySelector('.sigc-gc-aba-btn[data-aba="historico"]').click();
    await tick(); await tick(); await tick();
    expect(ths(p)).toEqual(['Agência', '06/10', '13/10']);
  });

  test('the agência list covers every agência in the history', async () => {
    await seed(['2026-06-02'], () => ROWS.filter((r) => r.idAgencia === '290490200'));
    await seed(['2026-09-22'], () => ROWS.filter((r) => r.idAgencia === '292740800'));
    const p = await abrirHistorico();
    await mudar(p, '[data-hist="modo"]', 'agencia');
    expect([...p.querySelectorAll('[data-hist="agencia"] option')].map((o) => o.value))
      .toEqual(['', '290490200', '292740800']);
  });

  test('old tables are taken down before their markup is replaced', async () => {
    await seed(['2026-10-20']);
    const p = await abrirHistorico();
    const real = window.__sigcPro.panel.destruirTabelas;
    const vistos = [];
    window.__sigcPro.panel.destruirTabelas = (raiz) => {
      vistos.push(raiz.querySelector('table') !== null);
      return real(raiz);
    };
    await mudar(p, '[data-hist="metrica"]', 'total');
    window.__sigcPro.panel.destruirTabelas = real;
    expect(vistos[0]).toBe(true);        // the previous table was still in the DOM when destruirTabelas ran
  });

  test('reading failure is shown, not thrown', async () => {
    H.listar = async () => { throw new Error('banco travado'); };
    const p = await abrirHistorico();
    expect(p.querySelector('.sigc-gc-secao[data-aba="historico"]').textContent).toContain('banco travado');
  });

  test('without the storage layer the tab explains instead of failing', async () => {
    delete window.__sigcProHistorico;
    const p = await abrirHistorico();
    expect(p.querySelector('.sigc-gc-secao[data-aba="historico"]').textContent).toContain('Histórico indisponível');
  });

  test('values are escaped', async () => {
    const rows = ROWS.map((r) => ({ ...r, agenciaNome: r.idAgencia === '290490200' ? '<img src=x onerror=alert(1)>' : r.agenciaNome }));
    await H.salvarExecucao(A.construirExecucao('29', rows, ts('2026-10-20')));
    const p = await abrirHistorico();
    expect(p.querySelector('#sigc-gc-tab-historico img') === null).toBe(true);
    expect(p.innerHTML).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});
