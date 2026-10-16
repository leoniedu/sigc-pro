// SIGC-PRO feature: GEREN-PRO — the Histórico tab. One column per ISO week;
// a table shows ONE metric at a time (agências x weeks) or one agência with
// the metrics as rows, so the columns are the weeks and nothing else.
// It holds no storage API: the runs come from historico-client.js.
// Spec: docs/superpowers/specs/2026-10-15-gerenciamento-historico-design.md
(function () {
  'use strict';

  const TAG = '[sigc-historico]';
  const PREF_KEY = (uf) => `ui:${uf}`;
  const A = () => window.__sigcProHistoricoAgregar;
  const G = () => window.__sigcProGerenciamento;
  const esc = (s) => window.__sigcPro.escapeHtml(String(s ?? ''));

  const MODOS = [['agencias', 'Agências × semanas'], ['agencia', 'Uma agência × semanas']];
  const PADRAO = { modo: 'agencias', metrica: 'concluido', agencia: '' };

  // Chooses the cell markup of the report (counts or % of the row total).
  // Empty where the week or the agência has no data — never a zero.
  function celula(v, visao) {
    return v ? G().celulaN(v.n, v.total, visao) : '<td class="sigc-gc-n" data-order=""></td>';
  }

  function cabecalhoSemanas(colunas) {
    return colunas.map((c) => G().thNum(esc(c.rotulo))).join('');
  }

  function htmlAgencias(execs, h, est) {
    const t = A().tabelaAgencias(execs, {
      metrica: h.metrica, bio: est.escopo.bio,
    });
    const linha = (l, rotulo) => `<td>${esc(rotulo || l.nome)}</td>` + l.celulas.map((v) => celula(v, est.visao)).join('');
    return '<table class="sigc-gc-dados" id="sigc-gc-tab-historico"><thead><tr><th>Agência</th>' +
      `${cabecalhoSemanas(t.colunas)}</tr></thead><tbody>` +
      `${t.linhas.map((l) => `<tr>${linha(l)}</tr>`).join('')}</tbody>` +
      `<tfoot><tr>${linha(t.uf)}</tr></tfoot></table>`;
  }

  function htmlUmaAgencia(execs, h, est) {
    const t = A().tabelaUmaAgencia(execs, {
      agencia: h.agencia, bio: est.escopo.bio,
    });
    return '<table class="sigc-gc-dados" id="sigc-gc-tab-historico"><thead><tr><th>Métrica</th>' +
      `${cabecalhoSemanas(t.colunas)}</tr></thead><tbody>` +
      t.linhas.map((l) => `<tr><td>${esc(l.nome)}</td>${l.celulas.map((v) => celula(v, est.visao)).join('')}</tr>`).join('') +
      '</tbody></table>';
  }

  function opcoes(lista, sel) {
    return lista.map(([v, nome]) => `<option value="${esc(v)}"${String(v) === String(sel) ? ' selected' : ''}>${esc(nome)}</option>`).join('');
  }

  function htmlControles(execs, h) {
    const metricas = A().METRICAS.map((m) => [m.id, m.nome]);
    const rotulos = A().rotulosVistos(execs).map((r) => [`${A().ROTULO}${r}`, r]);
    const ags = A().agenciasVistas(A().colunasSemanas(execs));
    return `<label>Visão <select data-hist="modo">${opcoes(MODOS, h.modo)}</select></label>` +
      (h.modo === 'agencias'
        ? `<label>Métrica <select data-hist="metrica">${opcoes(metricas, h.metrica)}` +
          `<optgroup label="Rótulo do portal">${opcoes(rotulos, h.metrica)}</optgroup></select></label>`
        : `<label>Agência <select data-hist="agencia">${opcoes([['', 'UF inteira'], ...ags.map((a) => [a.id, a.nome])], h.agencia)}</select></label>`) +
      '<button type="button" data-hist="exportar" class="btn btn-sm btn-default">Exportar histórico (CSV)</button>' +
      '<button type="button" data-hist="limpar" class="btn btn-sm btn-default">Limpar histórico</button>';
  }

  const NOTA = 'O histórico fica guardado neste navegador (uma foto por dia por UF: só contagens por agência, ' +
    'nenhum dado de domicílio). As duas consultas mais recentes aparecem dia a dia; antes delas, cada coluna é a última consulta de uma semana, ' +
    'e semanas sem consulta não têm coluna. O cabeçalho é a data da consulta. Com Amostra Bio = Todas, domicílios com e sem biomarcadores têm ' +
    'desfechos diferentes: use o filtro para compará-los. Limpar os dados da extensão ou removê-la apaga o histórico; ' +
    '"Exportar histórico" gera uma cópia diária em CSV.';

  // A remembered choice may name something this UF's history does not have (a
  // portal label seen only in another UF, an agência outside the weeks on
  // screen). The <select> would silently show another option while the table
  // used the stale value, so such a choice falls back to the default.
  function validarEscolhas(h) {
    if (!h.execs.length) return;
    const metricas = new Set(A().METRICAS.map((m) => m.id));
    A().rotulosVistos(h.execs).forEach((r) => metricas.add(`${A().ROTULO}${r}`));
    if (!metricas.has(h.metrica)) h.metrica = PADRAO.metrica;
    if (!['agencias', 'agencia'].includes(h.modo)) h.modo = PADRAO.modo;
    const ags = new Set(A().agenciasVistas(A().colunasSemanas(h.execs)).map((a) => a.id));
    if (h.agencia && !ags.has(h.agencia)) h.agencia = '';
  }

  // Draws the tab into `secao`. Async: the runs are read through the bridge
  // once per panel open (est.hist.execs) and again after Atualizar. A draw
  // that is overtaken by a newer one (est.hist.token) is dropped.
  async function desenhar(secao, est) {
    const H = window.__sigcProHistorico;
    const P = window.__sigcPro.panel;
    est.hist = est.hist || { ...PADRAO, execs: null, token: 0, prefsLidas: false };
    const h = est.hist;
    h.token += 1;
    const meu = h.token;
    if (!H) {
      secao.innerHTML = '<p class="sigc-gc-nota">Histórico indisponível: a camada de armazenamento da extensão não foi carregada.</p>';
      return;
    }
    // Takes the tables down BEFORE their markup is replaced: a DataTable
    // whose DOM is already gone cannot be destroyed cleanly.
    P.destruirTabelas(secao);
    try {
      if (!h.prefsLidas) {
        const salvas = await H.getPref(PREF_KEY(est.uf));
        if (salvas) Object.assign(h, salvas);
        h.prefsLidas = true;
      }
      if (!h.execs) {
        secao.innerHTML = '<p class="sigc-gc-nota">Carregando o histórico…</p>';
        h.execs = await H.listar(est.uf, false);
      }
    } catch (err) {
      console.warn(`${TAG} não foi possível ler o histórico:`, err);
      if (meu === h.token) secao.innerHTML = `<p class="sigc-gc-aviso">⚠ Não foi possível ler o histórico (${esc(err && err.message)}).</p>`;
      return;
    }
    if (meu !== h.token) return;
    validarEscolhas(h);

    if (!h.execs.length) {
      secao.innerHTML = `<p class="sigc-gc-nota">Ainda não há histórico desta UF. A cada consulta do GEREN-PRO ` +
        `a extensão guarda uma foto do dia; uma coluna por semana aparece aqui.</p><p class="sigc-gc-nota">${esc(NOTA)}</p>`;
      return;
    }
    secao.innerHTML = `<div class="sigc-gc-hist-bar">${htmlControles(h.execs, h)}</div>` +
      (h.modo === 'agencias' ? htmlAgencias(h.execs, h, est) : htmlUmaAgencia(h.execs, h, est)) +
      `<p class="sigc-gc-nota">${esc(NOTA)}</p>`;
    P.initPanelTables(secao);
  }

  // Wires the tab's own controls once per section; they redraw through
  // `redesenhar`, which the panel supplies.
  function ligar(secao, est, redesenhar) {
    if (secao.dataset.histLigado) return;
    secao.dataset.histLigado = '1';
    secao.addEventListener('change', (e) => {
      const campo = e.target && e.target.dataset && e.target.dataset.hist;
      if (!campo || !est.hist) return;
      est.hist[campo] = e.target.value;
      const { modo, metrica, agencia } = est.hist;
      window.__sigcProHistorico.setPref(PREF_KEY(est.uf), { modo, metrica, agencia }).catch(() => {});
      redesenhar();
    });
    secao.addEventListener('click', async (e) => {
      const alvo = e.target.closest('button');
      const acao = alvo && alvo.dataset.hist;
      if (!acao) return;
      const H = window.__sigcProHistorico;
      if (acao === 'exportar') {
        // Every day, not just the last run of each week the tab shows.
        const { header, rows } = A().linhasCsvLongo(await H.listar(est.uf, true));
        const { data } = window.__sigcPro.timestampSlug();
        window.__sigcPro.downloadFile(`sigc-pro-historico_uf${est.uf}_${data}.csv`,
          window.__sigcPro.buildCsv(header, rows));
      } else if (acao === 'limpar') {
        try {
          const { execucoes, ufs } = await H.contar();
          if (!execucoes) { alert('SIGC-PRO: não há histórico guardado.'); return; }
          if (!confirm(`SIGC-PRO: apagar TODO o histórico guardado neste navegador (${execucoes} foto(s) diária(s), UF ${ufs.join(', ')})? Isto não pode ser desfeito.`)) return;
          await H.limpar();
          est.hist.execs = null;
          redesenhar();
        } catch (err) {
          alert(`SIGC-PRO: não foi possível limpar o histórico (${err && err.message}).`);
        }
      }
    });
  }

  window.__sigcProHistoricoView = { desenhar, ligar, PADRAO, NOTA };
})();
