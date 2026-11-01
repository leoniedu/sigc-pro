// SIGC-PRO feature: Gerenciamento da Coleta — launcher, cache and panel.
// One click fetches the WHOLE UF (every other filter is "*"); the Amostra
// Bio filter is then applied inside the panel to the rows in memory, so
// changing it never re-requests. The page's own filter selections are
// deliberately ignored: only the UF is read.
//
// Makes no request of its own: the POST is window.__sigcPro.postRelatorio
// (common/, the fetch-sanctioned place). In-memory cache only — the
// privacy gate bans storage everywhere in this extension.
// Spec: docs/superpowers/specs/2026-10-15-gerenciamento-coleta-design.md
(function () {
  'use strict';

  const TAG = '[sigc-gerenciamento]';
  const SLUG = 'relatorio-aprov-coleta-gerencial';
  const BUTTON_ID = 'sigc-pro-gerenciamento-button';
  const PANEL_ID = 'sigc-pro-gerenciamento-panel';
  const STYLE_ID = 'sigc-pro-gerenciamento-style';
  const TTL_MS = 5 * 60 * 1000;

  const G = () => window.__sigcProGerenciamento;
  const esc = (s) => window.__sigcPro.escapeHtml(String(s ?? ''));
  // 12,3 (no sign); '' when there is nothing to divide by.
  const pctNum = (n, total) => (total ? String(Math.round((n / total) * 1000) / 10).replace('.', ',') : '');

  // --- page / request ----------------------------------------------------

  // The page is identified by its own slug: #btnFiltrar exists on every
  // SIGC report page, so the button alone would also match Último Movimento.
  function onGerenciamento(pathname) {
    return new RegExp(`/relatorio/${SLUG}/?$`).test(String(pathname ?? location.pathname));
  }

  // The UF the user has selected, from #IdUf (select2 hides the <select>
  // but keeps its .value) or, failing that, the filter last submitted.
  function getUf() {
    const sel = document.getElementById('IdUf');
    const v = sel ? String(sel.value || '').trim() : '';
    if (v && v !== '*') return v;
    const el = document.getElementById('filtroJson');
    if (el && String(el.value || '').trim()) {
      try {
        const uf = String(JSON.parse(el.value).IdUf || '').trim();
        if (uf && uf !== '*') return uf;
      } catch (err) {
        console.warn(`${TAG} #filtroJson inválido:`, err);
      }
    }
    return '';
  }

  // EXACTLY the fields this report accepts. Tipo Acompanhamento is always
  // "*": 1/2/3 only return subsets and its option loader answers 404.
  function filtroBody(uf) {
    return 'filtro=' + encodeURIComponent(JSON.stringify({
      IdFiltro: SLUG,
      IdUf: String(uf),
      IdAgencia: '*',
      IdMunicipio: '*',
      Controle: '*',
      IdTipoAcompanhamento: '*',
    }));
  }

  // --- cache -------------------------------------------------------------

  const cache = new Map();
  const emVoo = new Map();

  function resetCache() {
    cache.clear();
    emVoo.clear();
  }

  // Keeps the run in the history (agência counts only). Returns a warning
  // for the panel when it was not saved — a skipped short response or a
  // storage failure — and null when it was saved or the history is not
  // loaded. It never throws: the report must open either way.
  // How long opening the report waits for the history. The bridge's own
  // ceiling is 10 s per call; the report must not wait for that.
  let esperaHistoricoMs = 3000;

  async function registrarHistorico(uf, dados) {
    const H = window.__sigcProHistorico;
    const A = window.__sigcProHistoricoAgregar;
    if (!H || !A) return null;
    const gravar = (async () => {
      const rec = A.construirExecucao(uf, dados.rows, dados.em);
      const veredito = A.avaliarGravacao(rec, await H.getResumo(String(uf)));
      // A same-day run smaller than the one already saved is skipped without
      // a word: nothing is wrong, the better run simply stays.
      if (!veredito.salvar) return veredito.silencioso ? null : `Histórico não gravado: ${veredito.motivo}.`;
      await H.salvarExecucao(rec);
      return null;
    })();
    let timer;
    const limite = new Promise((resolve) => {
      timer = setTimeout(() => resolve('Histórico: a extensão não respondeu a tempo; a gravação desta consulta não foi confirmada.'), esperaHistoricoMs);
    });
    try {
      return await Promise.race([gravar, limite]);
    } catch (err) {
      console.warn(`${TAG} histórico não confirmado:`, err);
      return `Histórico não confirmado: ${err && err.message}.`;
    } finally {
      clearTimeout(timer);
      gravar.catch(() => {});
    }
  }

  // { rows, warnings, em, doCache }. Within TTL the cached answer is
  // returned; `forcar` bypasses it (the Atualizar button — a reload that
  // returns a cached answer is worse than no button). Concurrent calls for
  // one UF share one request.
  async function carregar(uf, { forcar = false } = {}) {
    const hit = cache.get(uf);
    if (!forcar && hit && Date.now() - hit.em < TTL_MS) return { ...hit, doCache: true, avisoHistorico: null };
    // A forced reload never joins a request already in flight: that one may
    // have been sent before the user asked for fresh data.
    if (!forcar && emVoo.has(uf)) return emVoo.get(uf);
    const p = (async () => {
      const r = await window.__sigcPro.postRelatorio({
        slug: SLUG,
        body: filtroBody(uf),
        parse: G().parseGerenciamentoHtml,
      });
      const dados = { rows: r.rows, warnings: r.warnings, em: Date.now() };
      dados.avisoHistorico = await registrarHistorico(uf, dados);
      cache.set(uf, dados);
      return { ...dados, doCache: false };
    })();
    emVoo.set(uf, p);
    try {
      return await p;
    } finally {
      if (emVoo.get(uf) === p) emVoo.delete(uf);
    }
  }

  // --- rendering ---------------------------------------------------------

  const ABAS = [
    ['domicilios', 'Domicílios'],
    ['municipio', 'Município'],
    ['agencia', 'Agência'],
    ['historico', 'Histórico'],
  ];

  const CSS = `
    #${PANEL_ID} { position: fixed; inset: 1.5vh 1vw; z-index: 99999; background: #fff; color: #1f2933;
      border-radius: 8px; box-shadow: 0 10px 40px rgba(0,0,0,.4); overflow: hidden;
      display: flex; flex-direction: column; font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
    #${PANEL_ID} .sigc-gc-head { display: flex; gap: 12px; align-items: center; padding: 10px 16px;
      background: #005a9c; color: #fff; }
    #${PANEL_ID} .sigc-gc-head h2 { margin: 0; font-size: 16px; font-weight: 600; flex: 1; color: #fff; }
    #${PANEL_ID} .sigc-gc-head small { font-weight: 400; opacity: .85; margin-left: 8px; }
    #${PANEL_ID} .sigc-gc-head button { cursor: pointer; color: #fff; background: transparent;
      border: 1px solid rgba(255,255,255,.75); }
    #${PANEL_ID} .sigc-gc-head button:hover { background: rgba(255,255,255,.18); color: #fff; }
    #${PANEL_ID} .sigc-gc-bar { display: flex; flex-wrap: wrap; gap: 8px 18px; align-items: center;
      padding: 10px 16px; background: #eef3f8; border-bottom: 1px solid #d5dee8; }
    #${PANEL_ID} .sigc-gc-bar label { display: flex; gap: 6px; align-items: center; margin: 0; font-weight: 600; }
    #${PANEL_ID} .sigc-gc-bar select { max-width: 260px; font-weight: 400; }
    #${PANEL_ID} .sigc-gc-bar span[data-gc="info"] { margin-left: auto; color: #52606d; }
    #${PANEL_ID} .sigc-gc-aviso { margin: 0; padding: 6px 16px; background: #fff4ce; color: #5c4300;
      border-bottom: 1px solid #e8d48b; }
    #${PANEL_ID} .sigc-gc-abas { display: flex; gap: 4px; padding: 8px 16px 0; background: #fff;
      border-bottom: 2px solid #005a9c; }
    #${PANEL_ID} .sigc-gc-aba-btn { border: 0; background: transparent; padding: 7px 18px; cursor: pointer;
      border-radius: 6px 6px 0 0; color: #3e4c59; font-weight: 600; }
    #${PANEL_ID} .sigc-gc-aba-btn:hover { background: #eef3f8; }
    #${PANEL_ID} .sigc-gc-aba-btn.sigc-gc-ativa { background: #005a9c; color: #fff; }
    #${PANEL_ID} .sigc-gc-corpo { flex: 1; overflow: auto; padding: 14px 16px 24px; }
    #${PANEL_ID} .sigc-gc-secao { display: none; }
    #${PANEL_ID} .sigc-gc-secao.sigc-gc-ativa { display: block; }
    #${PANEL_ID} table { border-collapse: collapse; margin: 6px 0 18px; font-size: 12.5px; }
    #${PANEL_ID} th, #${PANEL_ID} td { border-bottom: 1px solid #e4eaf0; padding: 5px 10px; vertical-align: top; }
    #${PANEL_ID} thead th { background: #e3ecf5; color: #0b3d66; text-align: left; white-space: normal; }
    #${PANEL_ID} tbody tr:nth-child(even) { background: #f8fafc; }
    #${PANEL_ID} tbody tr:hover { background: #e9f2fb; }
    #${PANEL_ID} td.sigc-gc-n { text-align: right; font-variant-numeric: tabular-nums; }
    #${PANEL_ID} .sigc-gc-pct { color: #7b8794; font-size: 11px; margin-left: 5px; }
    #${PANEL_ID} .sigc-gc-novo, #${PANEL_ID} tr.sigc-gc-novo { background: #ffe3e3 !important; }
    #${PANEL_ID} tfoot td { font-weight: 700; background: #e3ecf5; border-top: 2px solid #005a9c; }
    #${PANEL_ID} .sigc-gc-nota { color: #52606d; margin: 6px 0; }
    #${PANEL_ID} .sigc-gc-hist-bar { display: flex; flex-wrap: wrap; gap: 8px 18px; align-items: center; margin-bottom: 8px; }
    #${PANEL_ID} .sigc-gc-hist-bar label { display: flex; gap: 6px; align-items: center; margin: 0; font-weight: 600; }
    #${PANEL_ID} .sigc-pro-filtro-col { width: 100%; box-sizing: border-box; min-width: 56px; font-weight: 400; }
  `;

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  // Sort keys are fixed-width and zero-padded ("033.3333", "100.0000",
  // "0000123"), so they order correctly whether DataTables compares them as
  // numbers OR as strings. As plain numbers they only sorted right when the
  // column was typed numeric: typed as text, "100" came before "33.3" — and
  // a column of "12,3%" cells is exactly what a type detector reads as text.
  const chaveN = (n) => String(Math.round(n)).padStart(7, '0');
  const chavePct = (n, total) => (total ? (n / total) * 100 : 0).toFixed(4).padStart(8, '0');

  // A value cell: the count (visao 'n') or its percentage of `total`
  // (visao 'pct'), never both, so the table stays narrow. The value sits in
  // a .sigc-pro-csv-valor span so the CSV exports it bare ("12,3", not
  // "12,3%"); data-order carries the sort key.
  function celulaN(n, total, visao) {
    if (visao === 'pct') {
      return `<td class="sigc-gc-n" data-order="${chavePct(n, total)}"><span class="sigc-pro-csv-valor">${pctNum(n, total)}</span>%</td>`;
    }
    return `<td class="sigc-gc-n" data-order="${chaveN(n)}"><span class="sigc-pro-csv-valor">${n}</span></td>`;
  }

  // Header of a numeric column: declares its type so DataTables does not
  // auto-detect "12,3%" cells as text (see initPanelTables).
  const thNum = (texto, extra) => `<th data-sigc-type="num"${extra || ''}>${texto}</th>`;

  function htmlAgrupado(rows, grupo, visao, comBio) {
    const t = G().tabelaPor(rows, grupo);
    const rot = grupo === 'agencia' ? 'Agência' : 'Município';
    const head = `<tr><th>${rot}</th>${thNum('Domicílios')}` +
      (comBio ? `${thNum('Bio Sim')}${thNum('Bio Não')}` : '') +
      t.colunas.map((c) => thNum(`${esc(c.nome)}${c.novo ? ' (novo)' : ''}`,
        `${c.novo ? ' class="sigc-gc-novo"' : ''}${c.dica ? ` title="${esc(c.dica)}"` : ''}`)).join('') +
      thNum('Recusa do domicílio', ' title="Não se soma às colunas de andamento: é a situação do domicílio, não o andamento"') +
      '</tr>';
    const linha = (nome, l) => `<td>${esc(nome)}</td>${celulaN(l.total, l.total, 'n')}` +
      (comBio ? `${celulaN(l.sim, l.total, visao)}${celulaN(l.nao, l.total, visao)}` : '') +
      t.colunas.map((c) => celulaN(l.celulas[c.id] || 0, l.total, visao)).join('') +
      celulaN(l.recusaDomicilio, l.total, visao);
    const corpo = t.linhas.map((l) => `<tr>${linha(l.nome, l)}</tr>`).join('');
    const rodape = `<tfoot><tr>${linha('Total do escopo', t.totais).replace('<td>Total do escopo</td>',
      '<td title="Soma do escopo escolhido; não acompanha o filtro das colunas da tabela">Total do escopo</td>')}</tr></tfoot>`;
    return `<table class="sigc-gc-dados" id="sigc-gc-tab-${grupo}"><thead>${head}</thead><tbody>${corpo}</tbody>${rodape}</table>`;
  }

  function htmlDomicilios(rows, comBio) {
    const corpo = rows.map((r) =>
      `<tr><td>${esc(r.controle)}</td><td data-order="${chaveN(Number(r.domicilio) || 0)}">${esc(r.domicilio)}</td>` +
      `<td>${esc(G().nomeMunicipio(r.municipio))}</td>` +
      `<td>${esc(r.agenciaNome || r.idAgencia)}</td>${comBio ? `<td>${esc(r.bio)}</td>` : ''}<td>${esc(r.andamento)}</td>` +
      `<td>${esc(r.statusColeta)}</td><td>${esc(r.situacaoEntrevista)}</td><td>${esc(r.ultimaPosicao)}</td></tr>`).join('');
    return '<table class="sigc-gc-dados" id="sigc-gc-tab-domicilios"><thead><tr><th>Controle</th>' +
      `${thNum('Domicílio')}<th>Município</th><th>Agência</th>` +
      `${comBio ? '<th>Amostra Bio</th>' : ''}<th>Andamento</th><th>Status da coleta</th>` +
      `<th>Situação da entrevista</th><th>Última posição</th></tr></thead><tbody>${corpo}</tbody></table>`;
  }

  function htmlBarra(est) {
    const hora = new Date(est.dados.em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return '<label>Amostra Bio <select data-gc="bio">' +
        ['', 'sim', 'nao'].map((v) => `<option value="${v}"${est.escopo.bio === v ? ' selected' : ''}>${{ '': 'Todas', sim: 'Sim', nao: 'Não' }[v]}</option>`).join('') +
      '</select></label>' +
      '<label>Valores <select data-gc="visao">' +
        `<option value="n"${est.visao === 'n' ? ' selected' : ''}>Contagem</option>` +
        `<option value="pct"${est.visao === 'pct' ? ' selected' : ''}>% da linha</option></select></label>` +
      `<span data-gc="info">${est.escopoRows.length} de ${est.dados.rows.length} domicílios · UF ${esc(est.uf)} · dados de ${hora}${est.doCache ? ' (em memória)' : ''}</span>` +
      '<button type="button" data-gc="atualizar" class="btn btn-sm btn-default">Atualizar</button>' +
      '<button type="button" data-gc="csv" class="btn btn-sm btn-default">CSV da aba</button>';
  }

  // --- panel -------------------------------------------------------------

  function recalcular(est) {
    est.escopoRows = G().filtrar(est.dados.rows, est.escopo);
    est.avisos = [
      ...est.dados.warnings,
      ...(est.dados.avisoHistorico ? [est.dados.avisoHistorico] : []),
      ...G().avisos(est.escopoRows),
    ];
  }

  // Renders the active tab only (the Domicílios table can be ~9k rows); a
  // tab is redrawn when first shown after a change of scope or values.
  function desenhar(panelEl, est) {
    const P = window.__sigcPro.panel;
    panelEl.querySelector('.sigc-gc-bar').innerHTML = htmlBarra(est);
    panelEl.querySelector('.sigc-gc-avisos').innerHTML =
      est.avisos.map((a) => `<p class="sigc-gc-aviso">⚠ ${esc(a)}</p>`).join('');
    panelEl.querySelectorAll('.sigc-gc-aba-btn').forEach((b) => b.classList.toggle('sigc-gc-ativa', b.dataset.aba === est.aba));
    panelEl.querySelectorAll('.sigc-gc-secao').forEach((s) => s.classList.toggle('sigc-gc-ativa', s.dataset.aba === est.aba));

    const secao = panelEl.querySelector(`.sigc-gc-secao[data-aba="${est.aba}"]`);
    if (est.aba === 'historico') {
      // Async (it reads the stored runs), and its own redraw hook: the
      // controls inside the tab change what the tab shows, not the scope.
      secao.dataset.versao = String(est.versao);
      const HV = window.__sigcProHistoricoView;
      // Re-read the runs each time the tab is shown: another tab or portal
      // host shares the database and may have saved since.
      if (est.hist) est.hist.execs = null;
      if (HV) {
        HV.ligar(secao, est, () => HV.desenhar(secao, est));
        HV.desenhar(secao, est);
      } else {
        secao.innerHTML = '<p class="sigc-gc-nota">Histórico indisponível.</p>';
      }
      return;
    }
    if (secao.dataset.versao === String(est.versao)) return;
    // The Bio split is redundant once the scope is one side of it.
    const comBio = !est.escopo.bio;
    P.destruirTabelas(secao);
    secao.innerHTML = {
      domicilios: () => htmlDomicilios(est.escopoRows, comBio),
      municipio: () => htmlAgrupado(est.escopoRows, 'municipio', est.visao, comBio),
      agencia: () => htmlAgrupado(est.escopoRows, 'agencia', est.visao, comBio),
    }[est.aba]();
    secao.dataset.versao = String(est.versao);
    P.initPanelTables(secao);
  }

  function baixarCsv(panelEl, est) {
    const tabela = panelEl.querySelector(`#sigc-gc-tab-${est.aba}`);
    const dados = window.__sigcPro.panel.tabelaParaCsv(tabela);
    if (!dados || dados.rows.length === 0) {
      alert('SIGC-PRO: nada para exportar nesta aba.');
      return;
    }
    const { data } = window.__sigcPro.timestampSlug();
    window.__sigcPro.downloadFile(
      `sigc-pro-gerenciamento-${est.aba}_uf${est.uf}_${data}.csv`,
      window.__sigcPro.buildCsv(dados.header, dados.rows));
  }

  function fecharPainel() {
    const el = document.getElementById(PANEL_ID);
    if (el) {
      window.__sigcPro.panel.destruirTabelas(el);
      el.remove();
    }
  }

  // Opens (or replaces) the panel over `dados`. `recarregar` is called by
  // Atualizar and must resolve to the fresh { rows, warnings, em, doCache }.
  function abrirPainel(uf, dados, recarregar) {
    injectStyle();
    fecharPainel();
    const est = {
      uf, dados, doCache: !!dados.doCache,
      escopo: { bio: '' }, aba: 'domicilios', visao: 'n', versao: 0, escopoRows: [], avisos: [],
    };
    recalcular(est);
    const panelEl = document.createElement('div');
    panelEl.id = PANEL_ID;
    // Marks the subtree as ours: sigc-common's getDataTable() excludes every
    // table inside it from the "find the page's report table" lookup, so
    // CSV-pro and the others never read this panel's tables as the report.
    panelEl.setAttribute('data-sigc-pro', '');
    panelEl.innerHTML =
      '<div class="sigc-gc-head"><h2>GEREN-PRO · Gerenciamento da Coleta<small>UF inteira — os filtros da página não se aplicam</small></h2>' +
      '<button type="button" data-gc="fechar" class="btn btn-sm btn-default">Fechar</button></div>' +
      '<div class="sigc-gc-bar"></div><div class="sigc-gc-avisos"></div>' +
      `<div class="sigc-gc-abas">${ABAS.map(([id, nome]) => `<button type="button" class="sigc-gc-aba-btn" data-aba="${id}">${nome}</button>`).join('')}</div>` +
      `<div class="sigc-gc-corpo">${ABAS.map(([id]) => `<div class="sigc-gc-secao" data-aba="${id}"></div>`).join('')}</div>`;
    document.body.appendChild(panelEl);

    const mudou = () => { est.versao += 1; recalcular(est); desenhar(panelEl, est); };

    panelEl.addEventListener('click', async (e) => {
      const alvo = e.target.closest('button');
      if (!alvo) return;
      if (alvo.dataset.aba) { est.aba = alvo.dataset.aba; desenhar(panelEl, est); return; }
      const acao = alvo.dataset.gc;
      if (acao === 'fechar') fecharPainel();
      else if (acao === 'csv') baixarCsv(panelEl, est);
      else if (acao === 'atualizar' && recarregar) {
        alvo.disabled = true;
        try {
          est.dados = await recarregar();
          est.doCache = false;
          if (est.hist) est.hist.execs = null;
          mudou();
        } catch (err) {
          alert(`SIGC-PRO: não foi possível atualizar (${err && err.message}).`);
          alvo.disabled = false;
        }
      }
    });
    panelEl.addEventListener('change', (e) => {
      const campo = e.target && e.target.dataset && e.target.dataset.gc;
      if (campo === 'visao') est.visao = e.target.value;
      else if (campo === 'bio') est.escopo.bio = e.target.value;
      else return;
      mudou();
    });
    mudou();
    return panelEl;
  }

  // --- launcher ------------------------------------------------------------

  async function abrir(btn) {
    const uf = getUf();
    if (!uf) {
      alert('SIGC-PRO: não foi possível identificar a UF atual.');
      return;
    }
    btn.disabled = true;
    const rotulo = btn.textContent;
    btn.textContent = '…';
    try {
      let dados;
      try {
        dados = await carregar(uf);
      } catch (err) {
        alert(`SIGC-PRO: não foi possível obter o relatório (${err && err.message}).`);
        return;
      }
      if (dados.rows.length === 0) {
        alert('SIGC-PRO: o portal não devolveu domicílios para esta UF.');
        return;
      }
      console.log(`${TAG} UF ${uf}: ${dados.rows.length} domicílios${dados.doCache ? ' (memória)' : ''}.`);
      abrirPainel(uf, dados, () => carregar(uf, { forcar: true }));
    } finally {
      btn.disabled = false;
      btn.textContent = rotulo;
    }
  }

  window.__sigcPro.mountWidget({
    id: BUTTON_ID,
    anchor: (ctx) => ctx.ultimoMovimentoFiltrarBtn(),
    insert: 'after',
    when: () => onGerenciamento(),
    build: () => {
      console.log(`${TAG} button added.`);
      const btn = window.__sigcPro.makeSigcFormButton({
        id: BUTTON_ID,
        text: 'GEREN-PRO',
        title: 'Resumo da UF inteira por município e agência (SIGC-PRO)',
        onClick: () => abrir(btn),
        small: true,
      });
      return btn;
    },
  });

  // Exposed only for tests.
  window.__sigcProGerenciamento = Object.assign(window.__sigcProGerenciamento || {}, {
    onGerenciamento, getUf, filtroBody, carregar, resetCache, abrirPainel, fecharPainel,
    celulaN, thNum, pctNum, registrarHistorico,
    _setEsperaHistoricoMs: (ms) => { esperaHistoricoMs = ms; },
    PANEL_ID, BUTTON_ID, TTL_MS,
  });
  console.log(`${TAG} loaded.`);
})();
